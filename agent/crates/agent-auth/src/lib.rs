//! Verificación v1 para el trabajador confiable. No implementa DTLS, IPC ni almacén del SO.
#![forbid(unsafe_code)]

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};

const WINDOW_MS: u64 = 900_000;
const MAX_FAILURES: usize = 5;
pub const ITERATIONS: u32 = 600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    InvalidConfiguration,
    InvalidBinding,
    Busy,
    NoChallenge,
    WrongPassword,
    Locked { retry_after: u64 },
    Storage,
    Clock,
    Random,
    Stopped,
}

/// El adaptador proporciona hora local UTC, nunca una fecha del controlador.
pub trait AttemptClock {
    fn unix_millis(&self) -> Result<u64, AuthError>;
}

/// Estado protegido, sin K, contraseña, nombres, pruebas HMAC o SDP.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttemptState {
    schema: u8,
    failures: Vec<u64>,
    locked_until: Option<u64>,
    last_seen: u64,
}

impl AttemptState {
    /// Solo durante un alta nueva o migración explícita; nunca por fallo de lectura.
    pub fn provisioned() -> Self {
        Self {
            schema: 1,
            failures: vec![],
            locked_until: None,
            last_seen: 0,
        }
    }

    fn valid(&self) -> bool {
        self.schema == 1
            && self.failures.len() <= MAX_FAILURES
            && self.failures.windows(2).all(|w| w[0] <= w[1])
            && self.failures.iter().all(|t| *t <= self.last_seen)
            && (self.failures.len() < MAX_FAILURES || self.locked_until.is_some())
            && self.locked_until.map_or(true, |end| {
                self.failures.len() == MAX_FAILURES
                    && self.failures.last().and_then(|t| t.checked_add(WINDOW_MS)) == Some(end)
            })
    }
}

/// Un único propietario serializa todos los intentos del host, entre conexiones.
/// load falla ante ausencia/corrupción. commit reemplaza de forma atómica y durable
/// en un almacén protegido del servicio. Nunca usar archivos escribibles por otros
/// usuarios ni restablecer el contador tras un error. No hay adaptador por omisión.
pub trait AttemptStore {
    fn load(&mut self) -> Result<AttemptState, AuthError>;
    fn commit(&mut self, state: &AttemptState) -> Result<(), AuthError>;
}

/// Solo desde el trabajador DTLS: huellas de sus descripciones realmente aplicadas.
/// Analizar SDP de señalización por sí solo no certifica el extremo DTLS.
pub struct DtlsBinding {
    offer: String,
    answer: String,
}
impl DtlsBinding {
    pub fn new(offer: String, answer: String) -> Result<Self, AuthError> {
        fn valid(s: &str) -> bool {
            let Some(digest) = s.strip_prefix("sha-256 ") else {
                return false;
            };
            digest.len() == 95
                && digest.bytes().enumerate().all(|(i, b)| {
                    if i % 3 == 2 {
                        b == b':'
                    } else {
                        b.is_ascii_hexdigit()
                    }
                })
        }
        if !valid(&offer) || !valid(&answer) {
            return Err(AuthError::InvalidBinding);
        }
        Ok(Self { offer, answer })
    }
    pub fn offer(&self) -> &str {
        &self.offer
    }
    pub fn answer(&self) -> &str {
        &self.answer
    }
}

/// Resultado no serializable ni clonable, consumido al activar ESA conexión.
/// El adaptador debe conservar su identidad de PeerConnection, no aceptar este
/// resultado ni sus huellas como una autorización recibida por IPC sin autenticar.
pub struct VerifiedConnection {
    binding: DtlsBinding,
}
impl VerifiedConnection {
    pub fn into_binding(self) -> DtlsBinding {
        self.binding
    }
}

#[derive(Serialize)]
pub struct Hello {
    v: u8,
    #[serde(rename = "type")]
    kind: &'static str,
    salt: String,
    iterations: u32,
    pub nonce: String,
    #[serde(rename = "hostName")]
    host_name: String,
}

struct Pending {
    nonce: String,
    binding: DtlsBinding,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofMessage {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    proof: String,
}

fn message(nonce: &str, offer: &str, answer: &str) -> String {
    format!("absor-remote-auth-v1\n{nonce}\n{offer}\n{answer}")
}

fn verify(key: &hmac::Key, pending: &Pending, raw: &[u8]) -> bool {
    if raw.len() > 512 {
        return false;
    }
    let Ok(proof) = serde_json::from_slice::<ProofMessage>(raw) else {
        return false;
    };
    if proof.v != 1 || proof.kind != "auth" || proof.proof.len() != 44 {
        return false;
    }
    let Ok(bytes) = STANDARD.decode(&proof.proof) else {
        return false;
    };
    bytes.len() == 32
        && hmac::verify(
            key,
            message(
                &pending.nonce,
                &pending.binding.offer,
                &pending.binding.answer,
            )
            .as_bytes(),
            &bytes,
        )
        .is_ok()
}

/// Un actor por host. K viene del alta/almacén del servicio; nunca de la red.
/// No recibe contraseñas, no deriva K ni normaliza Unicode durante la conexión.
pub struct Verifier<L: AttemptStore, C: AttemptClock> {
    key: hmac::Key,
    salt: String,
    store: L,
    clock: C,
    state: AttemptState,
    last_sample: u64,
    pending: Option<Pending>,
    stopped: bool,
}

impl<L: AttemptStore, C: AttemptClock> Verifier<L, C> {
    pub fn new(
        key: &[u8; 32],
        salt: &str,
        iterations: u32,
        mut store: L,
        clock: C,
    ) -> Result<Self, AuthError> {
        if iterations != ITERATIONS || STANDARD.decode(salt).map_or(true, |v| v.len() != 16) {
            return Err(AuthError::InvalidConfiguration);
        }
        let state = store.load().map_err(|_| AuthError::Storage)?;
        if !state.valid() {
            return Err(AuthError::Storage);
        }
        Ok(Self {
            key: hmac::Key::new(hmac::HMAC_SHA256, key),
            salt: salt.to_owned(),
            store,
            clock,
            last_sample: state.last_seen,
            state,
            pending: None,
            stopped: false,
        })
    }

    fn sample(&mut self) -> Result<u64, AuthError> {
        if self.stopped {
            return Err(AuthError::Stopped);
        }
        match self.clock.unix_millis() {
            Ok(now) if now >= self.last_sample => {
                self.last_sample = now;
                Ok(now)
            }
            _ => {
                self.stop();
                Err(AuthError::Clock)
            }
        }
    }

    fn unlocked(&self, now: u64) -> Result<(), AuthError> {
        if let Some(end) = self.state.locked_until.filter(|end| *end > now) {
            return Err(AuthError::Locked {
                retry_after: (end - now).div_ceil(1000),
            });
        }
        Ok(())
    }

    fn commit(&mut self, state: AttemptState) -> Result<(), AuthError> {
        if self.store.commit(&state).is_err() {
            // El adaptador puede haber escrito antes del error: no reutilizar memoria vieja.
            self.stop();
            return Err(AuthError::Storage);
        }
        self.state = state;
        Ok(())
    }

    pub fn begin(&mut self, binding: DtlsBinding, host_name: String) -> Result<Hello, AuthError> {
        let now = self.sample()?;
        self.unlocked(now)?;
        if self.pending.is_some() {
            return Err(AuthError::Busy);
        }
        if host_name.is_empty() || host_name.chars().count() > 255 {
            return Err(AuthError::InvalidConfiguration);
        }
        let mut random = [0; 32];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| AuthError::Random)?;
        let nonce = STANDARD.encode(random);
        self.pending = Some(Pending {
            nonce: nonce.clone(),
            binding,
        });
        Ok(Hello {
            v: 1,
            kind: "hello",
            salt: self.salt.clone(),
            iterations: ITERATIONS,
            nonce,
            host_name,
        })
    }

    /// Una prueba por desafío, incluidos mensajes malformados. Consumir primero
    /// un fallo durable evita intentos gratis al caer el proceso durante HMAC.
    /// Una prueba correcta borra el fallo reservado ANTES de conceder acceso.
    pub fn authenticate(&mut self, raw: &[u8]) -> Result<VerifiedConnection, AuthError> {
        let now = self.sample()?;
        let pending = self.pending.take().ok_or(AuthError::NoChallenge)?;
        self.unlocked(now)?;
        let mut state = self.state.clone();
        state.failures.retain(|t| now - *t < WINDOW_MS);
        state.failures.push(now);
        state.last_seen = now;
        state.locked_until = if state.failures.len() >= MAX_FAILURES {
            Some(now.checked_add(WINDOW_MS).ok_or_else(|| {
                self.stop();
                AuthError::Clock
            })?)
        } else {
            None
        };
        self.commit(state)?;
        if !verify(&self.key, &pending, raw) {
            return Err(AuthError::WrongPassword);
        }
        self.commit(AttemptState {
            schema: 1,
            failures: vec![],
            locked_until: None,
            last_seen: now,
        })?;
        Ok(VerifiedConnection {
            binding: pending.binding,
        })
    }

    /// Al cerrar DTLS, abandonar el reto; el siguiente tendrá otro nonce.
    pub fn cancel(&mut self) {
        self.pending = None;
    }
    pub fn stop(&mut self) {
        self.pending = None;
        self.stopped = true;
    }
}

#[cfg(test)]
mod vectors;
