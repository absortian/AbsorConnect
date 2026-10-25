//! Núcleo del broker. No implementa red, autenticación v1 ni privilegios del SO.
#![deny(unsafe_code)]

pub mod clock;
use clock::Clock;
use std::sync::{Arc, Weak};
use std::time::Duration;

pub const MAX_AUTHORIZATION: Duration = Duration::from_secs(30);
pub const MAX_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    NoAuthorization,
    Stopped,
    ClockFault,
    InvalidResponse,
    StaleResponse,
    Busy,
    StaleSession,
    CounterExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    AuthorizationExpired,
    Revoked,
    Stopped,
    ClockFault,
    Disconnected,
    Shutdown,
}

/// Cierre idempotente y sin bloqueo: liberar entrada, cortar captura y transporte.
/// El adaptador real debe garantizarlo también ante la caída del broker.
pub trait Session {
    fn close(&mut self, reason: CloseReason);
}

// Referencias internas; no son credenciales, no se serializan ni se aceptan por IPC.
#[derive(Clone)]
pub struct ValidationTicket {
    owner: Weak<()>,
    sequence: u64,
}
#[derive(Clone)]
pub struct SessionHandle {
    owner: Weak<()>,
    sequence: u64,
}

struct Pending {
    sequence: u64,
    started: Duration,
}
struct Active<S> {
    sequence: u64,
    session: S,
}

/// Solo lo usa el proceso confiable del broker. Todos los accesos al trabajador
/// y el temporizador deben pasar por esta instancia, desde el mismo actor.
pub struct AuthorizationGate<C: Clock, S: Session> {
    clock: C,
    owner: Arc<()>,
    sequence: u64,
    last_sample: Option<Duration>,
    deadline: Option<Duration>,
    pending: Option<Pending>,
    active: Option<Active<S>>,
    stopped: bool,
}

impl<C: Clock, S: Session> AuthorizationGate<C, S> {
    /// Crear tras validar la configuración del alta. Arranca sin autorización.
    pub fn new(clock: C) -> Self {
        Self {
            clock,
            owner: Arc::new(()),
            sequence: 0,
            last_sample: None,
            deadline: None,
            pending: None,
            active: None,
            stopped: false,
        }
    }

    fn close(&mut self, reason: CloseReason) {
        if let Some(mut active) = self.active.take() {
            active.session.close(reason);
        }
    }

    fn invalidate(&mut self, reason: CloseReason) {
        self.deadline = None;
        self.pending = None;
        self.close(reason);
    }

    fn sample(&mut self) -> Result<Duration, Denied> {
        if self.stopped {
            return Err(Denied::Stopped);
        }
        let now = match self.clock.now() {
            Ok(now) if self.last_sample.map_or(true, |previous| now >= previous) => now,
            _ => {
                self.stopped = true;
                self.invalidate(CloseReason::ClockFault);
                return Err(Denied::ClockFault);
            }
        };
        self.last_sample = Some(now);
        if self.deadline.is_some_and(|deadline| now >= deadline) {
            self.deadline = None;
            self.close(CloseReason::AuthorizationExpired);
        }
        Ok(now)
    }

    fn next_sequence(&mut self) -> Result<u64, Denied> {
        let Some(sequence) = self.sequence.checked_add(1) else {
            self.stopped = true;
            self.invalidate(CloseReason::Stopped);
            return Err(Denied::CounterExhausted);
        };
        self.sequence = sequence;
        Ok(sequence)
    }

    /// Registrar el inicio ANTES de la petición HTTPS al backend.
    pub fn begin_validation(&mut self) -> Result<ValidationTicket, Denied> {
        let started = self.sample()?;
        let sequence = self.next_sequence()?;
        self.pending = Some(Pending { sequence, started });
        Ok(ValidationTicket {
            owner: Arc::downgrade(&self.owner),
            sequence,
        })
    }

    fn matches(&self, ticket: &ValidationTicket) -> bool {
        Weak::ptr_eq(&ticket.owner, &Arc::downgrade(&self.owner))
            && self
                .pending
                .as_ref()
                .is_some_and(|pending| pending.sequence == ticket.sequence)
    }

    /// Solo tras validar HTTPS, estado, equipo y contrato de la respuesta de API.
    /// Recibir datos del controlador WebRTC nunca llama a esta función.
    pub fn accept_validation(
        &mut self,
        ticket: &ValidationTicket,
        validity: Duration,
    ) -> Result<(), Denied> {
        let now = self.sample()?;
        if !self.matches(ticket) {
            return Err(Denied::StaleResponse);
        }
        let pending = self
            .pending
            .take()
            .expect("ticket comprobado en el mismo actor");
        let Some(deadline) = pending.started.checked_add(validity) else {
            return Err(Denied::InvalidResponse);
        };
        if validity.is_zero() || validity > MAX_AUTHORIZATION || deadline <= now {
            return Err(Denied::InvalidResponse);
        }
        self.deadline = Some(deadline);
        Ok(())
    }

    /// Un fallo de transporte no prolonga el permiso anterior.
    pub fn validation_failed(&mut self, ticket: &ValidationTicket) -> Result<(), Denied> {
        self.sample()?;
        if !self.matches(ticket) {
            return Err(Denied::StaleResponse);
        }
        self.pending = None;
        Ok(())
    }

    fn authorized(&mut self) -> Result<(), Denied> {
        self.sample()?;
        if self.deadline.is_none() {
            return Err(Denied::NoAuthorization);
        }
        Ok(())
    }

    /// Frontera de confianza: el trabajador ya verificó v1/DTLS/HMAC. Esta API
    /// NO prueba una contraseña ni sustituye ese protocolo todavía pendiente.
    pub fn attach_authenticated(&mut self, mut session: S) -> Result<SessionHandle, Denied> {
        let decision = self.authorized().and_then(|()| {
            if self.active.is_some() {
                Err(Denied::Busy)
            } else {
                self.next_sequence()
            }
        });
        match decision {
            Ok(sequence) => {
                self.active = Some(Active { sequence, session });
                Ok(SessionHandle {
                    owner: Arc::downgrade(&self.owner),
                    sequence,
                })
            }
            Err(error) => {
                session.close(CloseReason::Disconnected);
                Err(error)
            }
        }
    }

    fn current(&self, handle: &SessionHandle) -> bool {
        Weak::ptr_eq(&handle.owner, &Arc::downgrade(&self.owner))
            && self
                .active
                .as_ref()
                .is_some_and(|active| active.sequence == handle.sequence)
    }

    /// Operación breve del actor. Nunca entregar un trabajador fuera de este cierre.
    pub fn with_session<R>(
        &mut self,
        handle: &SessionHandle,
        operation: impl FnOnce(&mut S) -> R,
    ) -> Result<R, Denied> {
        self.authorized()?;
        if !self.current(handle) {
            return Err(Denied::StaleSession);
        }
        let result = operation(&mut self.active.as_mut().expect("sesión comprobada").session);
        self.authorized()?;
        Ok(result)
    }

    pub fn disconnect(&mut self, handle: &SessionHandle) -> Result<(), Denied> {
        self.sample()?;
        if !self.current(handle) {
            return Err(Denied::StaleSession);
        }
        self.close(CloseReason::Disconnected);
        Ok(())
    }

    /// Llamar aun sin tráfico WebRTC. Devuelve la espera máxima del próximo poll.
    pub fn poll(&mut self) -> Result<Duration, Denied> {
        let now = self.sample()?;
        Ok(self.deadline.map_or(MAX_POLL_INTERVAL, |deadline| {
            (deadline - now).min(MAX_POLL_INTERVAL)
        }))
    }

    pub fn revoke(&mut self) {
        self.stopped = true;
        self.invalidate(CloseReason::Revoked);
    }

    pub fn stop(&mut self) {
        self.stopped = true;
        self.invalidate(CloseReason::Stopped);
    }
}

impl<C: Clock, S: Session> Drop for AuthorizationGate<C, S> {
    fn drop(&mut self) {
        self.close(CloseReason::Shutdown);
    }
}
