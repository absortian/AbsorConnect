//! AES-256-GCM mediante ring. La clave envolvente y el blob pertenecen al
//! servicio; los tipos no implementan Debug ni permiten exportar K por IPC.
use absor_agent_api::http::{AgentApi, Credential};
use absor_agent_auth::{AttemptClock, AttemptStore, AuthError, Verifier, ITERATIONS};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq)]
pub struct SecretError;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plain {
    schema: u8,
    #[serde(rename = "hostId")]
    host_id: String,
    origin: String,
    credential: String,
    key: String,
    salt: String,
    iterations: u32,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    schema: u8,
    #[serde(rename = "hostId")]
    host_id: String,
    nonce: String,
    ciphertext: String,
}
pub struct WrappingKey([u8; 32]);
impl WrappingKey {
    pub fn generate() -> Result<Self, SecretError> {
        let mut value = [0; 32];
        SystemRandom::new()
            .fill(&mut value)
            .map_err(|_| SecretError)?;
        Ok(Self(value))
    }
    pub fn from_bytes(raw: &[u8]) -> Result<Self, SecretError> {
        Ok(Self(raw.try_into().map_err(|_| SecretError)?))
    }
    /// Solo el instalador local escribe estos bytes en su almacén root 0600.
    pub fn provisioning_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}
pub struct SecretBundle {
    plain: Plain,
    key: [u8; 32],
}
fn uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
fn decode<const N: usize>(s: &str) -> Result<[u8; N], SecretError> {
    let bytes = STANDARD.decode(s).map_err(|_| SecretError)?;
    if STANDARD.encode(&bytes) != s {
        return Err(SecretError);
    }
    bytes.try_into().map_err(|_| SecretError)
}
impl SecretBundle {
    pub fn parse(raw: &[u8]) -> Result<Self, SecretError> {
        if raw.len() > 4096 {
            return Err(SecretError);
        }
        let plain: Plain = serde_json::from_slice(raw).map_err(|_| SecretError)?;
        if plain.schema != 1 || !uuid(&plain.host_id) || plain.iterations != ITERATIONS {
            return Err(SecretError);
        }
        let key = decode(&plain.key)?;
        let _: [u8; 16] = decode(&plain.salt)?;
        Credential::new(plain.credential.clone()).map_err(|_| SecretError)?;
        // El cliente valida además HTTPS/loopback al construir la API.
        if plain.origin.len() > 2048 {
            return Err(SecretError);
        }
        Ok(Self { plain, key })
    }
    pub fn into_authority<L: AttemptStore, C: AttemptClock>(
        self,
        store: L,
        clock: C,
    ) -> Result<(AgentApi, Verifier<L, C>), SecretError> {
        let api = AgentApi::new(
            &self.plain.origin,
            Credential::new(self.plain.credential).map_err(|_| SecretError)?,
        )
        .map_err(|_| SecretError)?;
        let verifier = Verifier::new(
            &self.key,
            &self.plain.salt,
            self.plain.iterations,
            store,
            clock,
        )
        .map_err(|_| SecretError)?;
        Ok((api, verifier))
    }
    #[cfg(feature = "lab-http")]
    pub fn into_lab_authority<L: AttemptStore, C: AttemptClock>(
        self,
        store: L,
        clock: C,
    ) -> Result<(AgentApi, Verifier<L, C>), SecretError> {
        let api = AgentApi::local_lab(
            &self.plain.origin,
            Credential::new(self.plain.credential).map_err(|_| SecretError)?,
        )
        .map_err(|_| SecretError)?;
        let verifier = Verifier::new(
            &self.key,
            &self.plain.salt,
            self.plain.iterations,
            store,
            clock,
        )
        .map_err(|_| SecretError)?;
        Ok((api, verifier))
    }
}
fn aad(id: &str) -> Vec<u8> {
    format!("absorconnect-agent-secrets-v1\n{id}").into_bytes()
}
pub fn seal(raw: &[u8], wrapping: &WrappingKey) -> Result<Vec<u8>, SecretError> {
    let bundle = SecretBundle::parse(raw)?;
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| SecretError)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &wrapping.0).map_err(|_| SecretError)?,
    );
    let mut ciphertext = raw.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(aad(&bundle.plain.host_id)),
        &mut ciphertext,
    )
    .map_err(|_| SecretError)?;
    serde_json::to_vec(&Envelope {
        schema: 1,
        host_id: bundle.plain.host_id,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
    .map_err(|_| SecretError)
}
pub fn open(raw: &[u8], wrapping: &WrappingKey) -> Result<SecretBundle, SecretError> {
    if raw.len() > 8192 {
        return Err(SecretError);
    }
    let envelope: Envelope = serde_json::from_slice(raw).map_err(|_| SecretError)?;
    if envelope.schema != 1 || !uuid(&envelope.host_id) {
        return Err(SecretError);
    }
    let nonce = decode(&envelope.nonce)?;
    let mut ciphertext = STANDARD
        .decode(envelope.ciphertext)
        .map_err(|_| SecretError)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &wrapping.0).map_err(|_| SecretError)?,
    );
    let bytes = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(&envelope.host_id)),
            &mut ciphertext,
        )
        .map_err(|_| SecretError)?;
    let bundle = SecretBundle::parse(bytes)?;
    if bundle.plain.host_id != envelope.host_id {
        return Err(SecretError);
    }
    Ok(bundle)
}
// No se usa la hora del controlador; el retroceso se deniega en Verifier.
pub struct WallClock;
impl AttemptClock for WallClock {
    fn unix_millis(&self) -> Result<u64, AuthError> {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|d| u64::try_from(d.as_millis()).ok())
            .ok_or(AuthError::Clock)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn plain() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"schema":1,"hostId":"00000000-0000-4000-8000-000000000001","origin":"https://example.invalid","credential":format!("acg_{}","a".repeat(43)),"key":STANDARD.encode([7;32]),"salt":STANDARD.encode([8;16]),"iterations":600000})).unwrap()
    }
    #[test]
    fn sealed_roundtrip_unique_nonce_and_no_plaintext_secret() {
        let wrapping = WrappingKey::generate().unwrap();
        let raw = plain();
        let a = seal(&raw, &wrapping).unwrap();
        let b = seal(&raw, &wrapping).unwrap();
        assert_ne!(a, b);
        assert!(!String::from_utf8_lossy(&a).contains("acg_"));
        assert!(open(&a, &wrapping).is_ok());
        assert!(open(&a, &WrappingKey::generate().unwrap()).is_err());
    }
    #[test]
    fn tampering_unknown_fields_and_host_substitution_fail() {
        let wrapping = WrappingKey::generate().unwrap();
        let raw = seal(&plain(), &wrapping).unwrap();
        let mut v: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        v["hostId"] = serde_json::json!("00000000-0000-4000-8000-000000000002");
        assert!(open(&serde_json::to_vec(&v).unwrap(), &wrapping).is_err());
        v = serde_json::from_slice(&raw).unwrap();
        v["extra"] = serde_json::json!(true);
        assert!(open(&serde_json::to_vec(&v).unwrap(), &wrapping).is_err());
        let mut v: serde_json::Value = serde_json::from_slice(&plain()).unwrap();
        v["iterations"] = serde_json::json!(1);
        assert!(seal(&serde_json::to_vec(&v).unwrap(), &wrapping).is_err());
    }
}
