//! Protocolo LOCAL distinto de WebRTC v1. No acepta rutas, shell, credenciales
//! ni operaciones administrativas; la única operación actual es diagnóstica.
use serde::{Deserialize, Serialize};
pub const MAX_FRAME: usize = 4096;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub v: u8,
    pub sequence: u64,
    pub command: Command,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Status {},
    Challenge {
        offer_fingerprint: String,
        answer_fingerprint: String,
    },
    Authenticate {
        message: String,
    },
    DiagnosticOperation {},
    Disconnect {},
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    AwaitingApi,
    Ready,
    Authenticated,
    Expired,
    Revoked,
    Stopped,
    WrongProof,
    Locked,
    Invalid,
    Storage,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub v: u8,
    pub sequence: u64,
    pub result: Reply,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Reply {
    Status {
        state: State,
        operation_count: u64,
        os_operations_enabled: bool,
    },
    Hello {
        payload: String,
    },
    Denied {
        state: State,
        retry_after: u64,
    },
}
#[derive(Debug, PartialEq, Eq)]
pub struct ProtocolError;
pub fn decode_request(raw: &[u8]) -> Result<Request, ProtocolError> {
    if raw.len() > MAX_FRAME {
        return Err(ProtocolError);
    }
    let request: Request = serde_json::from_slice(raw).map_err(|_| ProtocolError)?;
    if request.v != 1 || request.sequence == 0 {
        return Err(ProtocolError);
    }
    if let Command::Authenticate { message } = &request.command {
        if message.len() > 512 {
            return Err(ProtocolError);
        }
    }
    if let Command::Challenge {
        offer_fingerprint,
        answer_fingerprint,
    } = &request.command
    {
        if offer_fingerprint.len() > 128 || answer_fingerprint.len() > 128 {
            return Err(ProtocolError);
        }
    }
    Ok(request)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arbitrary_actions_extra_identity_and_oversized_messages_are_denied() {
        for raw in [
            br#"{"v":1,"sequence":1,"command":{"op":"exec","command":"whoami"}}"#.as_slice(),
            br#"{"v":1,"sequence":1,"uid":0,"command":{"op":"status"}}"#,
            br#"{"v":2,"sequence":1,"command":{"op":"status"}}"#,
            br#"{"v":1,"sequence":0,"command":{"op":"status"}}"#,
            br#"{"v":1,"sequence":1,"command":{"op":"status","credential":"x"}}"#,
        ] {
            assert!(decode_request(raw).is_err());
        }
        let r = Request {
            v: 1,
            sequence: 1,
            command: Command::Authenticate {
                message: "x".repeat(513),
            },
        };
        assert!(decode_request(&serde_json::to_vec(&r).unwrap()).is_err());
    }
}
