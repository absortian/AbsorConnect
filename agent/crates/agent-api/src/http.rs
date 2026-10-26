//! Cliente limitado a la consulta de autorización del propio agente.
use serde::Deserialize;
use std::collections::HashSet;
use std::fmt;
use std::io::Read;
use std::time::Duration;
use url::Url;

pub const MAX_BODY_BYTES: usize = 8 * 1024 * 1024 + 65_536;
pub const POLL_INTERVAL: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiError {
    InvalidConfiguration,
    Revoked,
    RateLimited(Duration),
    Unavailable,
    InvalidResponse,
    InvalidRequest,
    RequestGone,
    AlreadyAnswered,
}

pub struct Credential(String);
impl Credential {
    /// Consumo explícito para el almacén cifrado del instalador; nunca RPC/logs.
    pub fn into_provisioning_secret(self) -> String {
        self.0
    }

    pub fn new(value: String) -> Result<Self, ApiError> {
        if value.len() != 47
            || !value.starts_with("acg_")
            || !value.as_bytes()[4..]
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
        {
            return Err(ApiError::InvalidConfiguration);
        }
        Ok(Self(value))
    }
}
impl fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Credential([redacted])")
    }
}

// No implementar Debug: contienen nombres y SDP, que no deben ir a logs.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingRequest {
    pub id: String,
    #[serde(rename = "controllerName")]
    pub controller_name: String,
    pub offer: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

pub struct Authorization {
    pub valid_for: Duration,
    pub requests: Vec<PendingRequest>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireAuthorization {
    #[serde(rename = "validForSeconds")]
    valid_for_seconds: u64,
    #[serde(rename = "authorizedUntil")]
    authorized_until: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireResponse {
    authorization: WireAuthorization,
    requests: Vec<PendingRequest>,
}

// La fecha es metadato de API; nunca se usa como reloj de autorización local.
pub(crate) fn utc_timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    (b.len() == 20 && b[19] == b'Z' || b.len() == 25 && &b[19..] == b"+00:00")
        && b[..19].iter().enumerate().all(|(i, byte)| match i {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            _ => byte.is_ascii_digit(),
        })
}
pub(crate) fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

fn decode(body: &[u8]) -> Result<Authorization, ApiError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(ApiError::InvalidResponse);
    }
    let wire: WireResponse = serde_json::from_slice(body).map_err(|_| ApiError::InvalidResponse)?;
    if !(1..=30).contains(&wire.authorization.valid_for_seconds)
        || !utc_timestamp(&wire.authorization.authorized_until)
        || wire.requests.len() > 64
    {
        return Err(ApiError::InvalidResponse);
    }
    let mut ids = HashSet::new();
    for request in &wire.requests {
        if !uuid(&request.id)
            || !ids.insert(&request.id)
            || request.controller_name.is_empty()
            || request.controller_name.chars().count() > 255
            || request.offer.is_empty()
            || request.offer.len() > 65_536
            || !utc_timestamp(&request.created_at)
        {
            return Err(ApiError::InvalidResponse);
        }
    }
    Ok(Authorization {
        valid_for: Duration::from_secs(wire.authorization.valid_for_seconds),
        requests: wire.requests,
    })
}

pub trait HeartbeatSource: Send + 'static {
    fn heartbeat(&mut self) -> Result<Authorization, ApiError>;
}

pub struct AgentApi {
    client: ureq::Agent,
    endpoint: String,
    credential: Credential,
    origin: Url,
}

pub(crate) fn configured_client(origin: &str, lab: bool) -> Result<(ureq::Agent, Url), ApiError> {
    let url = Url::parse(origin).map_err(|_| ApiError::InvalidConfiguration)?;
    let local = lab
        && origin.starts_with("http://127.0.0.1:")
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some();
    if lab && !local
        || origin.len() > 2048
        || (!local && !origin.starts_with("https://"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ApiError::InvalidConfiguration);
    }
    let client = ureq::AgentBuilder::new()
        .https_only(!local)
        .redirects(0)
        .try_proxy_from_env(false)
        .timeout_connect(Duration::from_secs(2))
        .timeout(REQUEST_TIMEOUT)
        .max_idle_connections(0)
        .user_agent("AbsorConnectAgent/0.1.0")
        .build();
    Ok((client, url))
}

impl AgentApi {
    /// El origen viene de configuración protegida del instalador, no del controlador.
    pub fn new(origin: &str, credential: Credential) -> Result<Self, ApiError> {
        Self::create(origin, credential, false)
    }

    /// Solo compilado de manera explícita para la API local de desarrollo.
    #[cfg(feature = "lab-http")]
    pub fn local_lab(origin: &str, credential: Credential) -> Result<Self, ApiError> {
        Self::create(origin, credential, true)
    }

    /// Baja limitada al UUID propio; destinada a revertir un alta local fallida.
    pub fn retire_enrolled_host(&mut self, id: &str) -> Result<(), ApiError> {
        if !uuid(id) {
            return Err(ApiError::InvalidRequest);
        }
        self.signal_request("DELETE", &format!("api/devices/{id}/agent"), None)
            .map(|_| ())
    }

    fn create(origin: &str, credential: Credential, lab: bool) -> Result<Self, ApiError> {
        let (client, url) = configured_client(origin, lab)?;
        let endpoint = url
            .join("api/host-agent/remote-requests")
            .map_err(|_| ApiError::InvalidConfiguration)?
            .to_string();
        Ok(Self {
            client,
            endpoint,
            credential,
            origin: url,
        })
    }

    // Copia exclusivamente interna: el segundo carril no recibe token de cuenta.
    pub fn signaling(&self) -> crate::signaling::SignalingLane {
        crate::signaling::SignalingLane::new(Self {
            client: self.client.clone(),
            endpoint: self.endpoint.clone(),
            origin: self.origin.clone(),
            credential: Credential(self.credential.0.clone()),
        })
    }

    pub(crate) fn signal_request(
        &mut self,
        method: &str,
        route: &str,
        body: Option<String>,
    ) -> Result<Vec<u8>, ApiError> {
        // Las rutas las construye este crate con constantes y UUID validado.
        let endpoint = self
            .origin
            .join(route)
            .map_err(|_| ApiError::InvalidRequest)?;
        let request = self
            .client
            .request(method, endpoint.as_str())
            .set("Accept", "application/json")
            .set("Authorization", &format!("Bearer {}", self.credential.0));
        let result = match body {
            Some(body) => request
                .set("Content-Type", "application/json")
                .send_string(&body),
            None => request.call(),
        };
        let response = match result {
            Ok(value) | Err(ureq::Error::Status(_, value)) => value,
            Err(_) => return Err(ApiError::Unavailable),
        };
        match response.status() {
            401 | 403 => return Err(ApiError::Revoked),
            404 | 410 => return Err(ApiError::RequestGone),
            409 => return Err(ApiError::AlreadyAnswered),
            429 => {
                return Err(ApiError::RateLimited(Duration::from_secs(
                    response
                        .header("Retry-After")
                        .filter(|v| v.len() <= 5 && v.bytes().all(|b| b.is_ascii_digit()))
                        .and_then(|v| v.parse().ok())
                        .filter(|v| (1..=86_400).contains(v))
                        .unwrap_or(3),
                )))
            }
            204 if method == "PUT" || method == "DELETE" => return Ok(vec![]),
            200 if method == "GET" => (),
            _ => return Err(ApiError::Unavailable),
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
            .take(65_537)
            .read_to_end(&mut bytes)
            .map_err(|_| ApiError::Unavailable)?;
        if bytes.len() > 65_536 {
            return Err(ApiError::InvalidResponse);
        }
        Ok(bytes)
    }

    fn fetch(&mut self) -> Result<Authorization, ApiError> {
        let response = self
            .client
            .get(&self.endpoint)
            .set("Accept", "application/json")
            .set("Authorization", &format!("Bearer {}", self.credential.0))
            .call();
        let response = match response {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(ureq::Error::Transport(_)) => return Err(ApiError::Unavailable),
        };
        match response.status() {
            401 | 403 => return Err(ApiError::Revoked),
            429 => {
                let delay = response
                    .header("Retry-After")
                    .filter(|s| s.len() <= 5 && s.bytes().all(|b| b.is_ascii_digit()))
                    .and_then(|s| s.parse::<u64>().ok())
                    .filter(|n| (1..=86_400).contains(n))
                    .unwrap_or(3);
                return Err(ApiError::RateLimited(Duration::from_secs(delay)));
            }
            200 => (),
            _ => return Err(ApiError::Unavailable),
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
        let mut body = Vec::new();
        response
            .into_reader()
            .take((MAX_BODY_BYTES + 1) as u64)
            .read_to_end(&mut body)
            .map_err(|_| ApiError::Unavailable)?;
        decode(&body)
    }
}

impl HeartbeatSource for AgentApi {
    fn heartbeat(&mut self) -> Result<Authorization, ApiError> {
        self.fetch()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    fn valid() -> serde_json::Value {
        serde_json::json!({"requests":[],"authorization":{"validForSeconds":30,"authorizedUntil":"2026-10-25T12:00:00+00:00"}})
    }
    #[test]
    fn parses_contract_and_rejects_invalid_grants() {
        assert_eq!(
            decode(&serde_json::to_vec(&valid()).unwrap())
                .unwrap()
                .valid_for,
            Duration::from_secs(30)
        );
        for value in [
            serde_json::json!(0),
            serde_json::json!(31),
            serde_json::json!(30.5),
            serde_json::json!("30"),
        ] {
            let mut v = valid();
            v["authorization"]["validForSeconds"] = value;
            assert!(matches!(
                decode(&serde_json::to_vec(&v).unwrap()),
                Err(ApiError::InvalidResponse)
            ));
        }
        assert!(matches!(decode(br#"{"requests":[],"authorization":{"validForSeconds":30,"validForSeconds":1,"authorizedUntil":"2026-10-25T12:00:00Z"}}"#),Err(ApiError::InvalidResponse)));
        assert!(matches!(
            decode(&vec![b' '; MAX_BODY_BYTES + 1]),
            Err(ApiError::InvalidResponse)
        ));
    }
    #[test]
    fn credential_and_origin_never_accept_account_tokens_or_url_credentials() {
        let token = || Credential::new(format!("acg_{}", "a".repeat(43))).unwrap();
        assert_eq!(format!("{:?}", token()), "Credential([redacted])");
        assert!(Credential::new(format!("acs_{}", "a".repeat(43))).is_err());
        for origin in [
            "http://absorconnect.absor.top",
            "https://x.test/a",
            "https://x.test?q=a",
            "https://x.test#f",
            "https://user:secret@x.test",
            "https:x.test",
        ] {
            assert!(matches!(
                AgentApi::new(origin, token()),
                Err(ApiError::InvalidConfiguration)
            ));
        }
        assert!(AgentApi::new("https://absorconnect.absor.top", token()).is_ok());
    }

    #[cfg(feature = "lab-http")]
    #[test]
    fn lab_feature_cannot_disable_https_for_production_or_other_hosts() {
        let token = || Credential::new(format!("acg_{}", "a".repeat(43))).unwrap();
        for origin in [
            "https://x.test",
            "http://x.test:8020",
            "http://localhost:8020",
            "http://127.0.0.2:8020",
            "http://127.0.0.1:8020/a",
            "http://127.0.0.1:8020?q=x",
        ] {
            assert!(AgentApi::local_lab(origin, token()).is_err());
        }
        assert!(AgentApi::local_lab("http://127.0.0.1:8020", token()).is_ok());
        assert!(AgentApi::new("http://127.0.0.1:8020", token()).is_err());
    }

    #[test]
    fn actual_http_statuses_and_body_validation_use_the_configured_transport() {
        let body = serde_json::to_string(&valid()).unwrap();
        for (status, headers, payload, expected) in [
            (
                200,
                "Content-Type: application/json\r\n",
                body.as_str(),
                None,
            ),
            (
                401,
                "Content-Type: application/json\r\n",
                "{}",
                Some(ApiError::Revoked),
            ),
            (
                403,
                "Content-Type: text/html\r\n",
                "denied",
                Some(ApiError::Revoked),
            ),
            (
                429,
                "Retry-After: 9\r\n",
                "",
                Some(ApiError::RateLimited(Duration::from_secs(9))),
            ),
            (
                503,
                "Content-Type: application/json\r\n",
                "{}",
                Some(ApiError::Unavailable),
            ),
            (
                200,
                "Content-Type: text/html\r\n",
                "<html>login</html>",
                Some(ApiError::InvalidResponse),
            ),
            (
                200,
                "Content-Type: application/json\r\nContent-Encoding: gzip\r\n",
                "{}",
                Some(ApiError::InvalidResponse),
            ),
            (
                200,
                "Content-Type: application/json\r\n",
                "{",
                Some(ApiError::InvalidResponse),
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let response=format!("HTTP/1.1 {status} Result\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{payload}",payload.len());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = vec![];
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    assert!(request.len() < 4096);
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /api/host-agent/remote-requests HTTP/1.1\r\n"));
                assert!(
                    request.contains(&format!("Authorization: Bearer acg_{}\r\n", "a".repeat(43)))
                );
                stream.write_all(response.as_bytes()).unwrap();
            });
            let token = Credential::new(format!("acg_{}", "a".repeat(43))).unwrap();
            let mut api = AgentApi::create("http://127.0.0.1:8020", token, true).unwrap();
            api.endpoint = format!("http://{address}/api/host-agent/remote-requests");
            let result = api.heartbeat();
            match expected {
                Some(error) => assert!(matches!(result,Err(actual) if actual==error)),
                None => assert!(result.is_ok()),
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn redirect_is_not_followed_and_invalid_tls_cannot_send_http_credentials() {
        for tls in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let trap = TcpListener::bind("127.0.0.1:0").unwrap();
            let trap_address = trap.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut data = [0; 4096];
                let size = stream.read(&mut data).unwrap();
                if tls {
                    assert_eq!(data[0], 0x16);
                    assert!(!data[..size].windows(6).any(|w| w == b"Bearer"));
                }
                let _=stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{trap_address}/forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
            });
            let token = Credential::new(format!("acg_{}", "a".repeat(43))).unwrap();
            let mut api = if tls {
                AgentApi::new(&format!("https://{address}"), token).unwrap()
            } else {
                AgentApi::create("http://127.0.0.1:8020", token, true).unwrap()
            };
            if !tls {
                api.endpoint = format!("http://{address}/api/host-agent/remote-requests");
            }
            assert!(matches!(api.heartbeat(), Err(ApiError::Unavailable)));
            server.join().unwrap();
            trap.set_nonblocking(true).unwrap();
            assert!(
                matches!(trap.accept(),Err(error) if error.kind()==std::io::ErrorKind::WouldBlock)
            );
        }
    }
}
