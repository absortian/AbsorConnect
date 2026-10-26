#![cfg(feature = "lab-http")]
use absor_agent_api::{
    http::{AgentApi, ApiError, Credential},
    signaling::{Answer, Command, Reply, RequestId, SignalingSource},
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};
fn token() -> Credential {
    Credential::new(format!("acg_{}", "a".repeat(43))).unwrap()
}
fn wire(
    status: u16,
    headers: &str,
    payload: &str,
    method: &str,
    route: &str,
    expected_body: Option<serde_json::Value>,
    command: Command,
) -> Reply {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status} Result\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{payload}",payload.len());
    let first = format!("{method} {route} HTTP/1.1\r\n");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = vec![];
        let mut byte = [0];
        while !bytes.ends_with(b"\r\n\r\n") {
            assert!(bytes.len() < 4096);
            stream.read_exact(&mut byte).unwrap();
            bytes.push(byte[0]);
        }
        let head = String::from_utf8(bytes).unwrap();
        assert!(head.starts_with(&first));
        assert!(head.contains(&format!("Authorization: Bearer acg_{}\r\n", "a".repeat(43))));
        if let Some(expected) = expected_body {
            let size: usize = head
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            assert!(size <= 400000);
            let mut body = vec![0; size];
            stream.read_exact(&mut body).unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                expected
            );
        }
        stream.write_all(response.as_bytes()).unwrap();
    });
    let reply = AgentApi::local_lab(&origin, token())
        .unwrap()
        .execute(command);
    server.join().unwrap();
    reply
}
fn id() -> RequestId {
    RequestId::new("00000000-0000-4000-8000-000000000001".into()).unwrap()
}
#[test]
fn real_http_answers_and_busy_rejection_use_only_the_bound_request() {
    let route = "/api/host-agent/remote-requests/00000000-0000-4000-8000-000000000001/answer";
    for (command, body) in [
        (
            Command::Answer(id(), Answer::new("v=0\r\n".into()).unwrap()),
            serde_json::json!({"answer":"v=0\r\n"}),
        ),
        (
            Command::Busy(id()),
            serde_json::json!({"rejected":{"reason":"busy"}}),
        ),
    ] {
        assert!(matches!(
            wire(204, "", "", "PUT", route, Some(body), command),
            Reply::Completed(Ok(()))
        ));
    }
}
#[test]
fn real_http_ice_validates_schema_and_never_exposes_credential_in_debug() {
    assert!(!format!("{:?}", token()).contains(&"a".repeat(43)));
    for (body, ok) in [
        (
            r#"{"iceServers":[{"urls":["stun:localhost:3478"]}],"ttl":86400}"#,
            true,
        ),
        (r#"{"iceServers":[],"ttl":30,"ttl":40}"#, false),
        (
            r#"{"iceServers":[{"urls":["turn:host"],"credential":"secret"}],"ttl":30}"#,
            false,
        ),
    ] {
        let reply = wire(
            200,
            "Content-Type: application/json\r\n",
            body,
            "GET",
            "/api/host-agent/ice-servers",
            None,
            Command::Ice,
        );
        assert!(matches!(reply,Reply::Ice(ref value) if value.is_ok()==ok));
    }
}
#[test]
fn signaling_statuses_are_not_authorization_grants() {
    let route = "/api/host-agent/remote-requests/00000000-0000-4000-8000-000000000001/answer";
    for (status, error) in [
        (401, ApiError::Revoked),
        (403, ApiError::Revoked),
        (404, ApiError::RequestGone),
        (410, ApiError::RequestGone),
        (409, ApiError::AlreadyAnswered),
        (429, ApiError::RateLimited(Duration::from_secs(17))),
        (503, ApiError::Unavailable),
    ] {
        assert!(
            matches!(wire(status,"Retry-After: 17\r\n","{}","PUT",route,Some(serde_json::json!({"rejected":{"reason":"busy"}})),Command::Busy(id())),Reply::Completed(Err(actual)) if actual==error)
        );
    }
}
#[test]
fn redirects_are_not_followed_by_signaling() {
    let trap = TcpListener::bind("127.0.0.1:0").unwrap();
    let header = format!(
        "Location: http://{}/credential-trap\r\n",
        trap.local_addr().unwrap()
    );
    assert!(matches!(
        wire(
            302,
            &header,
            "",
            "GET",
            "/api/host-agent/ice-servers",
            None,
            Command::Ice
        ),
        Reply::Ice(Err(ApiError::Unavailable))
    ));
    trap.set_nonblocking(true).unwrap();
    assert!(matches!(trap.accept(),Err(e) if e.kind()==std::io::ErrorKind::WouldBlock));
}
#[test]
fn a_blocked_signaling_call_never_blocks_the_actor_or_grows_threads() {
    use absor_agent_api::signaling::SignalingLane;
    use std::sync::mpsc;
    struct Blocked(mpsc::Receiver<()>);
    impl SignalingSource for Blocked {
        fn execute(&mut self, _: Command) -> Reply {
            self.0.recv().unwrap();
            Reply::Completed(Ok(()))
        }
    }
    let (release, wait) = mpsc::channel();
    let mut lane = SignalingLane::new(Blocked(wait));
    lane.submit(Command::Busy(id())).unwrap();
    for _ in 0..1000 {
        assert!(lane.poll().unwrap().is_none());
        assert!(lane.submit(Command::Ice).is_err());
    }
    release.send(()).unwrap();
}
