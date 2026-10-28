//! Canal local independiente: parar el propio host, sin operaciones administrativas.
use serde::{Deserialize, Serialize};
pub const MAX_CONTROL_FRAME: usize = 512;
#[derive(Debug, PartialEq, Eq)]
pub struct ControlError;
fn hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn device(s: &str) -> bool {
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
    Stop,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopRequest {
    pub v: u8,
    pub nonce: String,
    pub device_id: String,
    pub operation: Operation,
}
impl StopRequest {
    pub fn new(nonce: String, device_id: String) -> Result<Self, ControlError> {
        let q = Self {
            v: 1,
            nonce,
            device_id,
            operation: Operation::Stop,
        };
        q.validate()?;
        Ok(q)
    }
    fn validate(&self) -> Result<(), ControlError> {
        if self.v != 1 || !hex(&self.nonce, 32) || !device(&self.device_id) {
            return Err(ControlError);
        }
        Ok(())
    }
    pub fn decode(raw: &[u8]) -> Result<Self, ControlError> {
        if raw.is_empty() || raw.len() > MAX_CONTROL_FRAME {
            return Err(ControlError);
        }
        let q: Self = serde_json::from_slice(raw).map_err(|_| ControlError)?;
        q.validate()?;
        Ok(q)
    }
    pub fn encode(&self) -> Result<Vec<u8>, ControlError> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ControlError)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopReply {
    pub v: u8,
    pub nonce: String,
    pub device_id: String,
    pub stopped: bool,
    pub fresh_enrollment_required: bool,
}
impl StopReply {
    pub fn stopped(query: StopRequest) -> Self {
        Self {
            v: 1,
            nonce: query.nonce,
            device_id: query.device_id,
            stopped: true,
            fresh_enrollment_required: true,
        }
    }
    fn validate(&self) -> Result<(), ControlError> {
        if self.v != 1
            || !hex(&self.nonce, 32)
            || !device(&self.device_id)
            || !self.stopped
            || !self.fresh_enrollment_required
        {
            return Err(ControlError);
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<Vec<u8>, ControlError> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ControlError)
    }
    pub fn decode(raw: &[u8]) -> Result<Self, ControlError> {
        if raw.is_empty() || raw.len() > MAX_CONTROL_FRAME {
            return Err(ControlError);
        }
        let r: Self = serde_json::from_slice(raw).map_err(|_| ControlError)?;
        r.validate()?;
        Ok(r)
    }
    pub fn verify(&self, nonce: &str, device_id: &str) -> Result<(), ControlError> {
        self.validate()?;
        if self.nonce != nonce || self.device_id != device_id {
            return Err(ControlError);
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const DEVICE: &str = "12345678-1234-4abc-8def-123456789abc";
    #[test]
    fn closed_operation_and_exact_fields() {
        let q = StopRequest::new("01".repeat(16), DEVICE.into()).unwrap();
        let raw = String::from_utf8(q.encode().unwrap()).unwrap();
        assert!(StopRequest::decode(raw.as_bytes()).is_ok());
        for s in [
            raw.replace("stop", "restart"),
            raw.replace("stop", "status"),
            raw.replace('{', "{\"v\":1,"),
            raw.replace('}', ",\"path\":\"/tmp\"}"),
            raw.replace("\"v\":1", "\"v\":2"),
            raw.replace(DEVICE, "invalid"),
        ] {
            assert!(StopRequest::decode(s.as_bytes()).is_err());
        }
        assert!(StopRequest::decode(&[b'x'; 513]).is_err());
    }
    #[test]
    fn reply_bound_to_request_and_requires_durable_stop() {
        let q = StopRequest::new("01".repeat(16), DEVICE.into()).unwrap();
        let r = StopReply::stopped(q);
        let raw = r.encode().unwrap();
        let r = StopReply::decode(&raw).unwrap();
        assert!(r.verify(&"01".repeat(16), DEVICE).is_ok());
        assert!(r.verify(&"02".repeat(16), DEVICE).is_err());
        assert!(r
            .verify(&"01".repeat(16), "22345678-1234-4abc-8def-123456789abc")
            .is_err());
        let text = String::from_utf8(raw).unwrap();
        for s in [
            text.replace("true", "false"),
            text.replace('{', "{\"v\":1,"),
            text.replace('}', ",\"token\":\"x\"}"),
        ] {
            assert!(StopReply::decode(s.as_bytes()).is_err());
        }
    }
}
