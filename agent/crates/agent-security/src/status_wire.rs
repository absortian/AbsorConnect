//! Consulta local de solo lectura. Su respuesta no concede autoridad de captura.
use serde::{Deserialize, Serialize};
pub const MAX_STATUS_FRAME: usize = 512;
#[derive(Debug, PartialEq, Eq)]
pub struct StatusError;
fn hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
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
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Status,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub v: u8,
    pub nonce: String,
    pub operation: Operation,
}
impl Query {
    pub fn new(nonce: String) -> Result<Self, StatusError> {
        if !hex(&nonce, 32) {
            return Err(StatusError);
        }
        Ok(Self {
            v: 1,
            nonce,
            operation: Operation::Status,
        })
    }
    pub fn decode(raw: &[u8]) -> Result<Self, StatusError> {
        let q: Self = decode(raw)?;
        if q.v != 1 || !hex(&q.nonce, 32) {
            return Err(StatusError);
        }
        Ok(q)
    }
    pub fn encode(&self) -> Result<Vec<u8>, StatusError> {
        let raw = encode(self)?;
        Self::decode(&raw)?;
        Ok(raw)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrokerState {
    Idle,
    Active,
    ValidationRequired,
    Revoked,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Owner {
    Agent,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicStatus {
    pub v: u8,
    pub nonce: String,
    pub owner: Owner,
    pub device_id: String,
    pub agent_version: String,
    pub instance: String,
    pub boot_id: String,
    pub pid: u32,
    pub published_at_boottime_millis: u64,
    pub state: BrokerState,
    pub ready_for_unattended: bool,
}
impl PublicStatus {
    pub fn decode(raw: &[u8]) -> Result<Self, StatusError> {
        let s: Self = decode(raw)?;
        if s.v != 1
            || !hex(&s.nonce, 32)
            || !hex(&s.instance, 32)
            || !uuid(&s.device_id)
            || !uuid(&s.boot_id)
            || s.pid == 0
            || s.ready_for_unattended
            || s.published_at_boottime_millis > 9_007_199_254_740_991
            || s.agent_version.is_empty()
            || s.agent_version.len() > 32
            || !s
                .agent_version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
        {
            return Err(StatusError);
        }
        Ok(s)
    }
    pub fn encode(&self) -> Result<Vec<u8>, StatusError> {
        let raw = encode(self)?;
        Self::decode(&raw)?;
        Ok(raw)
    }
    pub fn verify(
        &self,
        nonce: &str,
        boot_id: &str,
        started: u64,
        now: u64,
    ) -> Result<(), StatusError> {
        if self.nonce != nonce
            || self.boot_id != boot_id
            || now < started
            || now - started >= 1500
            || self.published_at_boottime_millis < started
            || self.published_at_boottime_millis > now
        {
            return Err(StatusError);
        }
        Ok(())
    }
}
fn decode<T: serde::de::DeserializeOwned>(raw: &[u8]) -> Result<T, StatusError> {
    if raw.is_empty() || raw.len() > MAX_STATUS_FRAME {
        return Err(StatusError);
    }
    serde_json::from_slice(raw).map_err(|_| StatusError)
}
fn encode(v: &impl Serialize) -> Result<Vec<u8>, StatusError> {
    let raw = serde_json::to_vec(v).map_err(|_| StatusError)?;
    if raw.len() > MAX_STATUS_FRAME {
        return Err(StatusError);
    }
    Ok(raw)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> PublicStatus {
        PublicStatus {
            v: 1,
            nonce: "01".repeat(16),
            owner: Owner::Agent,
            device_id: "01234567-89ab-4def-8123-456789abcdef".into(),
            agent_version: "0.1.0+lab".into(),
            instance: "02".repeat(16),
            boot_id: "11234567-89ab-4def-8123-456789abcdef".into(),
            pid: 100,
            published_at_boottime_millis: 10,
            state: BrokerState::Idle,
            ready_for_unattended: false,
        }
    }
    #[test]
    fn status_has_no_operation_or_capture_authority() {
        let s = value();
        let raw = s.encode().unwrap();
        let s = PublicStatus::decode(&raw).unwrap();
        assert!(!s.ready_for_unattended);
        for word in [
            "credential",
            "password",
            "token",
            "key",
            "sdp",
            "username",
            "command",
        ] {
            assert!(!String::from_utf8_lossy(&raw).contains(word));
        }
        assert!(s.verify(&s.nonce, &s.boot_id, 9, 11).is_ok());
    }
    #[test]
    fn closed_query_rejects_mutation_secrets_duplicates_and_size() {
        for raw in[br#"{"v":1,"nonce":"01010101010101010101010101010101","operation":"shell"}"#.as_slice(),br#"{"v":1,"nonce":"01010101010101010101010101010101","operation":"status","token":"untrusted"}"#,br#"{"v":1,"nonce":"01010101010101010101010101010101","operation":"status","v":1}"#,br#"{"v":2,"nonce":"01010101010101010101010101010101","operation":"status"}"#,&[b'x';513]]{assert!(Query::decode(raw).is_err());}
    }
    #[test]
    fn reply_cannot_claim_readiness_or_free_text() {
        let mut s = value();
        s.ready_for_unattended = true;
        assert!(s.encode().is_err());
        s.ready_for_unattended = false;
        s.device_id = "acg_untrusted".into();
        assert!(s.encode().is_err());
        s = value();
        s.agent_version = "version\nsecret".into();
        assert!(s.encode().is_err());
    }
    #[test]
    fn replay_wrong_boot_and_time_fail_closed() {
        let s = value();
        for (start, end) in [(11, 12), (8, 9), (11, 10), (0, 1500)] {
            assert!(s.verify(&s.nonce, &s.boot_id, start, end).is_err());
        }
        assert!(s.verify(&"03".repeat(16), &s.boot_id, 9, 11).is_err());
        assert!(s
            .verify(&s.nonce, "21234567-89ab-4def-8123-456789abcdef", 9, 11)
            .is_err());
    }
}
