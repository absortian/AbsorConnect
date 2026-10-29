//! Canje único de alta: no admite ni recibe el token de sesión de la cuenta.
use crate::http::{configured_client, uuid, ApiError, Credential};
use serde::Deserialize;
use std::io::Read;

pub struct EnrollmentGrant(String);
impl EnrollmentGrant {
    pub fn new(value: String) -> Result<Self, ApiError> {
        if value.len() != 47
            || !value.starts_with("ace_")
            || !value.as_bytes()[4..]
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
        {
            return Err(ApiError::InvalidConfiguration);
        }
        Ok(Self(value))
    }
}

// Sin Debug/Serialize: la respuesta contiene la credencial que se almacenará cifrada.
pub struct EnrolledHost {
    pub credential: Credential,
    pub device_id: String,
    pub transaction_id: Option<String>,
}
impl EnrolledHost {
    fn for_transaction(self, device: &str, transaction: &str) -> Result<Self, ApiError> {
        if self.device_id != device || self.transaction_id.as_deref() != Some(transaction) {
            return Err(ApiError::InvalidResponse);
        }
        Ok(self)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireEnrollment {
    token: String,
    device_id: String,
    expires_at: String,
    #[serde(default)]
    transaction_id: Option<String>,
}
pub struct EnrollmentClient {
    client: ureq::Agent,
    endpoint: String,
}
impl EnrollmentClient {
    pub fn new(origin: &str) -> Result<Self, ApiError> {
        Self::create(origin, false)
    }
    #[cfg(feature = "lab-http")]
    pub fn local_lab(origin: &str) -> Result<Self, ApiError> {
        Self::create(origin, true)
    }
    fn create(origin: &str, lab: bool) -> Result<Self, ApiError> {
        let (client, url) = configured_client(origin, lab)?;
        Ok(Self {
            client,
            endpoint: url
                .join("api/host-agent/enroll")
                .map_err(|_| ApiError::InvalidConfiguration)?
                .to_string(),
        })
    }
    /// La migración no acepta un canje de otro equipo/transacción ni una respuesta antigua.
    pub fn enroll_transaction_once(
        self,
        grant: EnrollmentGrant,
        expected_device: &str,
        expected_transaction: &str,
    ) -> Result<EnrolledHost, ApiError> {
        if !uuid(expected_device) || !uuid(expected_transaction) {
            return Err(ApiError::InvalidConfiguration);
        }
        let enrolled = self.enroll_once(grant)?;
        enrolled.for_transaction(expected_device, expected_transaction)
    }

    /// Consume el permiso incluso ante un fallo: el llamante debe pedir un alta nueva.
    pub fn enroll_once(self, grant: EnrollmentGrant) -> Result<EnrolledHost, ApiError> {
        let body = serde_json::to_string(&serde_json::json!({
            "enrollmentToken":grant.0,"agentVersion":"0.1.0","capabilities":{}
        }))
        .map_err(|_| ApiError::InvalidRequest)?;
        let response = match self
            .client
            .post(&self.endpoint)
            .set("Accept", "application/json")
            .set("Content-Type", "application/json")
            .send_string(&body)
        {
            Ok(v) | Err(ureq::Error::Status(_, v)) => v,
            Err(_) => return Err(ApiError::Unavailable),
        };
        if response.status() != 201 {
            return Err(ApiError::Unavailable);
        }
        if response
            .header("Content-Type")
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            != "application/json"
            || response
                .header("Content-Encoding")
                .is_some_and(|v| v != "identity")
        {
            return Err(ApiError::InvalidResponse);
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::Unavailable)?;
        if bytes.len() > 4096 {
            return Err(ApiError::InvalidResponse);
        }
        let wire: WireEnrollment =
            serde_json::from_slice(&bytes).map_err(|_| ApiError::InvalidResponse)?;
        if !uuid(&wire.device_id)
            || !super::http::utc_timestamp(&wire.expires_at)
            || wire.transaction_id.as_ref().is_some_and(|id| !uuid(id))
        {
            return Err(ApiError::InvalidResponse);
        }
        Ok(EnrolledHost {
            credential: Credential::new(wire.token).map_err(|_| ApiError::InvalidResponse)?,
            device_id: wire.device_id,
            transaction_id: wire.transaction_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enrollment_is_distinct_from_account_and_agent_credentials_and_requires_https() {
        for prefix in ["acs_", "acg_", "ace!"] {
            assert!(EnrollmentGrant::new(format!("{prefix}{}", "a".repeat(43))).is_err());
        }
        assert!(EnrollmentGrant::new(format!("ace_{}", "a".repeat(43))).is_ok());
        for origin in [
            "http://127.0.0.1:8020",
            "https://a.test/path",
            "https://u:p@a.test",
        ] {
            assert!(EnrollmentClient::new(origin).is_err());
        }
        assert!(EnrollmentClient::new("https://example.invalid").is_ok());
    }
    #[test]
    fn real_transport_bounds_response_and_sends_only_one_use_grant() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let good = serde_json::json!({"token":format!("acg_{}","a".repeat(43)),"deviceId":"00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-27T12:00:00+00:00"});
        let good = serde_json::to_string(&good).unwrap();
        for (status, content_type, body, valid) in [
            (201, "application/json", good.clone(), true),
            (200, "application/json", good.clone(), false),
            (302, "application/json", good.clone(), false),
            (201, "text/html", good.clone(), false),
            (201, "application/json", good.replace("acg_", "acs_"), false),
            (
                201,
                "application/json",
                good.replace("deviceId", "unexpected"),
                false,
            ),
            (201, "application/json", " ".repeat(4097), false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = vec![];
                let (head, payload) = loop {
                    let mut buffer = [0; 2048];
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(split) = bytes.windows(4).position(|p| p == b"\r\n\r\n") {
                        let head = String::from_utf8(bytes[..split].to_vec()).unwrap();
                        let size: usize = head
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(str::to_owned)
                            })
                            .unwrap()
                            .parse()
                            .unwrap();
                        if bytes.len() >= split + 4 + size {
                            break (head, bytes[split + 4..split + 4 + size].to_vec());
                        }
                    }
                };
                assert!(head.starts_with("POST /api/host-agent/enroll "));
                assert!(!head.to_lowercase().contains("authorization:"));
                let sent: serde_json::Value = serde_json::from_slice(&payload).unwrap();
                assert_eq!(sent["enrollmentToken"], format!("ace_{}", "a".repeat(43)));
                let reply=format!("HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nLocation: https://example.invalid/\r\nConnection: close\r\n\r\n{body}",body.len());
                let _ = stream.write_all(reply.as_bytes());
            });
            let result = EnrollmentClient::create(&origin, true)
                .unwrap()
                .enroll_once(EnrollmentGrant::new(format!("ace_{}", "a".repeat(43))).unwrap());
            assert_eq!(result.is_ok(), valid);
            server.join().unwrap();
        }
    }
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    const DEVICE: &str = "12345678-1234-4abc-8def-123456789abc";
    const TRANSACTION: &str = "22345678-1234-4abc-8def-123456789abc";
    fn enrolled(device: &str, transaction: Option<&str>) -> EnrolledHost {
        EnrolledHost {
            credential: Credential::new(format!("acg_{}", "a".repeat(43))).unwrap(),
            device_id: device.into(),
            transaction_id: transaction.map(str::to_owned),
        }
    }
    #[test]
    fn migration_requires_exact_device_and_transaction_without_exporting_credential() {
        assert!(enrolled(DEVICE, Some(TRANSACTION))
            .for_transaction(DEVICE, TRANSACTION)
            .is_ok());
        assert!(enrolled(TRANSACTION, Some(TRANSACTION))
            .for_transaction(DEVICE, TRANSACTION)
            .is_err());
        assert!(enrolled(DEVICE, Some(DEVICE))
            .for_transaction(DEVICE, TRANSACTION)
            .is_err());
        assert!(enrolled(DEVICE, None)
            .for_transaction(DEVICE, TRANSACTION)
            .is_err());
    }
}
