//! Mensajes de vida/metadatos de laboratorio: nunca contraseñas, captura o órdenes del SO.
use absor_agent_supervisor::Pulse;
use serde::{Deserialize, Serialize};
use std::time::Duration;
pub const MAX_MESSAGE: usize = 512;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Desktop {
    Default,
    Winlogon,
    Unavailable,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Body {
    Pulse {},
    Status { session: u32, desktop: Desktop },
    Shutdown {},
    Hang {},
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub v: u8,
    pub sequence: u64,
    pub at: u64,
    pub body: Body,
}
#[derive(Debug, PartialEq, Eq)]
pub struct WireError;
impl Message {
    pub fn new(sequence: u64, now: Duration, body: Body) -> Result<Self, WireError> {
        let at = u64::try_from(now.as_nanos()).map_err(|_| WireError)?;
        if sequence == 0 {
            return Err(WireError);
        }
        Ok(Self {
            v: 1,
            sequence,
            at,
            body,
        })
    }
    pub fn decode(raw: &[u8]) -> Result<Self, WireError> {
        if raw.is_empty() || raw.len() > MAX_MESSAGE {
            return Err(WireError);
        }
        let value: Self = serde_json::from_slice(raw).map_err(|_| WireError)?;
        if value.v != 1 || value.sequence == 0 {
            return Err(WireError);
        }
        if let Body::Status { session, .. } = &value.body {
            if crate::SessionId::from_console(*session).is_none() {
                return Err(WireError);
            }
        }
        Ok(value)
    }
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        let value = serde_json::to_vec(self).map_err(|_| WireError)?;
        if value.len() > MAX_MESSAGE {
            Err(WireError)
        } else {
            Ok(value)
        }
    }
    pub fn pulse(&self) -> Result<Pulse, WireError> {
        Pulse::new(self.sequence, Duration::from_nanos(self.at)).map_err(|_| WireError)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_schema_rejects_commands_tokens_versions_and_duplicate_fields() {
        for raw in [br#"{"v":1,"sequence":1,"at":1,"body":{"type":"shell","command":"noop"}}"#.as_slice(),br#"{"v":2,"sequence":1,"at":1,"body":{"type":"pulse"}}"#,br#"{"v":1,"sequence":1,"at":1,"token":"untrusted","body":{"type":"pulse"}}"#,br#"{"v":1,"v":1,"sequence":1,"at":1,"body":{"type":"pulse"}}"#,br#"{"v":1,"sequence":1,"at":1,"body":{"type":"status","session":0,"desktop":"default"}}"#,br#"{"v":1,"sequence":0,"at":1,"body":{"type":"pulse"}}"#] {assert!(Message::decode(raw).is_err());}
        assert!(Message::decode(&[b'x'; MAX_MESSAGE + 1]).is_err());
    }
    #[test]
    fn status_is_only_a_monotonic_pulse_not_capture_authority() {
        let raw = Message::new(
            1,
            Duration::from_millis(3),
            Body::Status {
                session: 1,
                desktop: Desktop::Winlogon,
            },
        )
        .unwrap()
        .encode()
        .unwrap();
        let status = Message::decode(&raw).unwrap();
        assert!(status.pulse().is_ok());
        assert!(matches!(
            status.body,
            Body::Status {
                session: 1,
                desktop: Desktop::Winlogon
            }
        ));
    }
}
