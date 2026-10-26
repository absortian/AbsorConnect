//! Señalización acotada y separada del carril que renueva la autorización.
//! Responder u obtener ICE nunca concede ni amplía el permiso del broker.
use crate::http::{uuid, AgentApi, ApiError};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};

// Sin Debug: contienen SDP o credenciales TURN temporales.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IceConfiguration {
    #[serde(rename = "iceServers")]
    pub ice_servers: Vec<IceServer>,
    pub ttl: u64,
}
impl IceConfiguration {
    fn decode(bytes: &[u8]) -> Result<Self, ApiError> {
        let value: Self = serde_json::from_slice(bytes).map_err(|_| ApiError::InvalidResponse)?;
        if !(1..=86_400).contains(&value.ttl) || value.ice_servers.len() > 8 {
            return Err(ApiError::InvalidResponse);
        }
        for server in &value.ice_servers {
            if server.urls.is_empty() || server.urls.len() > 8 {
                return Err(ApiError::InvalidResponse);
            }
            let mut turn = false;
            let mut kind = None;
            for url in &server.urls {
                let Some((scheme, authority)) = url.split_once(':') else {
                    return Err(ApiError::InvalidResponse);
                };
                if !["stun", "stuns", "turn", "turns"].contains(&scheme)
                    || authority.is_empty()
                    || url.len() > 512
                    || !authority
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"[]:.-_?=".contains(&b))
                {
                    return Err(ApiError::InvalidResponse);
                }
                let is_turn = scheme.starts_with("turn");
                if kind.is_some_and(|old| old != is_turn) {
                    return Err(ApiError::InvalidResponse);
                }
                kind = Some(is_turn);
                turn |= is_turn;
            }
            match (&server.username, &server.credential) {
                (Some(name), Some(key))
                    if turn
                        && !name.is_empty()
                        && name.len() <= 1024
                        && !name.chars().any(char::is_control)
                        && !key.is_empty()
                        && key.len() <= 1024
                        && !key.chars().any(char::is_control) => {}
                (None, None) if !turn => (),
                _ => return Err(ApiError::InvalidResponse),
            }
        }
        Ok(value)
    }
}
pub struct RequestId(String);
impl RequestId {
    pub fn new(value: String) -> Result<Self, ApiError> {
        if !uuid(&value) {
            return Err(ApiError::InvalidRequest);
        }
        Ok(Self(value))
    }
}
pub struct Answer(String);
impl Answer {
    pub fn new(value: String) -> Result<Self, ApiError> {
        if value.is_empty() || value.len() > 65_536 {
            return Err(ApiError::InvalidRequest);
        }
        Ok(Self(value))
    }
}
pub enum Command {
    Ice,
    Answer(RequestId, Answer),
    Busy(RequestId),
}
pub enum Reply {
    Ice(Result<IceConfiguration, ApiError>),
    Completed(Result<(), ApiError>),
}
pub trait SignalingSource: Send + 'static {
    fn execute(&mut self, command: Command) -> Reply;
}
impl SignalingSource for AgentApi {
    fn execute(&mut self, command: Command) -> Reply {
        match command {
            Command::Ice => Reply::Ice(
                self.signal_request("GET", "api/host-agent/ice-servers", None)
                    .and_then(|v| IceConfiguration::decode(&v)),
            ),
            Command::Answer(id, Answer(answer)) => Reply::Completed(
                self.signal_request(
                    "PUT",
                    &format!("api/host-agent/remote-requests/{}/answer", id.0),
                    Some(serde_json::json!({"answer":answer}).to_string()),
                )
                .map(|_| ()),
            ),
            Command::Busy(id) => Reply::Completed(
                self.signal_request(
                    "PUT",
                    &format!("api/host-agent/remote-requests/{}/answer", id.0),
                    Some("{\"rejected\":{\"reason\":\"busy\"}}".into()),
                )
                .map(|_| ()),
            ),
        }
    }
}
pub struct SignalingLane {
    commands: SyncSender<Command>,
    replies: Receiver<Reply>,
    pending: bool,
}
impl SignalingLane {
    pub fn new(mut source: impl SignalingSource) -> Self {
        let (commands, input) = mpsc::sync_channel(1);
        let (output, replies) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            while let Ok(command) = input.recv() {
                if output.send(source.execute(command)).is_err() {
                    break;
                }
            }
        });
        Self {
            commands,
            replies,
            pending: false,
        }
    }
    pub fn submit(&mut self, command: Command) -> Result<(), ApiError> {
        if self.pending {
            return Err(ApiError::InvalidRequest);
        }
        self.commands
            .try_send(command)
            .map_err(|_| ApiError::Unavailable)?;
        self.pending = true;
        Ok(())
    }
    pub fn poll(&mut self) -> Result<Option<Reply>, ApiError> {
        match self.replies.try_recv() {
            Ok(reply) if self.pending => {
                self.pending = false;
                Ok(Some(reply))
            }
            Ok(_) => Err(ApiError::InvalidResponse),
            Err(TryRecvError::Disconnected) => Err(ApiError::Unavailable),
            Err(TryRecvError::Empty) => Ok(None),
        }
    }
    pub fn idle(&self) -> bool {
        !self.pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_ice_contract_and_typed_requests() {
        for valid in [
            r#"{"iceServers":[],"ttl":86400}"#,
            r#"{"iceServers":[{"urls":["stun:localhost:3478"]},{"urls":["turn:[::1]:3478?transport=udp"],"username":"lab","credential":"temporary"}],"ttl":30}"#,
        ] {
            assert!(IceConfiguration::decode(valid.as_bytes()).is_ok());
        }
        for invalid in [
            r#"{"iceServers":[],"ttl":0}"#,
            r#"{"iceServers":[],"ttl":30,"extra":1}"#,
            r#"{"iceServers":[{"urls":["https://bad"]}],"ttl":30}"#,
            r#"{"iceServers":[{"urls":["turn:host:3478"]}],"ttl":30}"#,
            r#"{"iceServers":[{"urls":["stun:host:3478"],"username":"leak","credential":"leak"}],"ttl":30}"#,
            r#"{"iceServers":[],"ttl":30,"ttl":40}"#,
        ] {
            assert!(IceConfiguration::decode(invalid.as_bytes()).is_err());
        }
        assert!(RequestId::new("../account".into()).is_err());
        assert!(Answer::new("a".repeat(65_537)).is_err());
        assert!(Answer::new("".into()).is_err());
    }
}
