use absor_agent_control::*;
use absor_agent_core::{
    clock::{Clock, ClockError},
    AuthorizationGate, CloseReason, Denied, Session,
};
use serde_json::{json, Value};
use std::{cell::Cell, rc::Rc, time::Duration};
const ID: &str = "12345678-1234-4abc-8def-123456789abc";
const ENABLE: &[u8] = br#"{"v":1,"extension":1,"type":"agent-control-enable"}"#;
#[derive(Clone, Default)]
struct Counter {
    calls: Rc<Cell<u32>>,
    closed: Rc<Cell<u32>>,
    fail: Option<ErrorCode>,
}
impl Executor for Counter {
    fn execute(&mut self, _: Action, _: Context) -> Result<(), ErrorCode> {
        self.calls.set(self.calls.get() + 1);
        self.fail.map_or(Ok(()), Err)
    }
    fn close(&mut self, _: CloseReason) {
        self.closed.set(self.closed.get() + 1);
    }
}
fn session(counter: Counter) -> ControlSession<Counter> {
    ControlSession::new(
        counter,
        "0.1.0+test".into(),
        Capabilities {
            restart: true,
            ..Capabilities::NONE
        },
        vec![Action::Restart],
    )
    .unwrap()
}
fn operation(id: &str, action: Action) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"v":1,"extension":1,"type":"host-operation","id":id,"action":action}),
    )
    .unwrap()
}
fn ready(s: &mut ControlSession<Counter>) {
    s.set_context(Context::UserDesktop, true).unwrap();
    let messages = s.receive(ENABLE).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(
        serde_json::to_value(&messages[1]).unwrap()["state"],
        "user_desktop"
    );
}
#[test]
fn controller_shared_vectors_and_raw_limits() {
    let vectors: Value = serde_json::from_str(include_str!(
        "../../../../src/shared/remote/agent-protocol-vectors.json"
    ))
    .unwrap();
    for (group, valid) in [("valid", true), ("invalid", false)] {
        for item in vectors[group].as_array().unwrap() {
            if item["direction"] != "controller" {
                continue;
            }
            let bytes = serde_json::to_vec(&item["message"]).unwrap();
            assert_eq!(parse_controller(&bytes).is_ok(), valid, "{}", item["name"]);
        }
    }
    for raw in [
        vec![b' '; CONTROL_LIMIT + 1],
        b"not-json".to_vec(),
        br#"{"v":1,"v":1,"extension":1,"type":"agent-control-enable"}"#.to_vec(),
        vec![0xff],
    ] {
        assert!(parse_controller(&raw).is_err());
    }
}
#[test]
fn negotiation_is_explicit_and_idempotent() {
    let counter = Counter::default();
    let mut s = session(counter.clone());
    s.set_context(Context::UserDesktop, true).unwrap();
    assert!(s
        .receive(&operation(ID, Action::Restart))
        .unwrap()
        .is_empty());
    assert_eq!(counter.calls.get(), 0);
    assert_eq!(s.receive(ENABLE).unwrap().len(), 2);
    assert!(s.receive(ENABLE).unwrap().is_empty());
}
#[test]
fn duplicate_restart_executes_once_and_changed_action_is_rejected() {
    let counter = Counter::default();
    let mut s = session(counter.clone());
    ready(&mut s);
    let message = operation(ID, Action::Restart);
    let first = s.receive(&message).unwrap();
    assert!(matches!(
        first[0],
        HostMessage::Result {
            status: Status::Accepted,
            code: None,
            ..
        }
    ));
    assert_eq!(s.receive(&message).unwrap(), first);
    assert!(matches!(
        s.receive(&operation(ID, Action::Lock)).unwrap()[0],
        HostMessage::Result {
            status: Status::Rejected,
            code: Some(ErrorCode::NotAllowed),
            ..
        }
    ));
    assert_eq!(counter.calls.get(), 1);
}
#[test]
fn unannounced_unavailable_and_failed_operations_are_not_retried() {
    let counter = Counter {
        fail: Some(ErrorCode::Cancelled),
        ..Counter::default()
    };
    let mut s = session(counter.clone());
    s.receive(ENABLE).unwrap();
    assert!(matches!(
        s.receive(&operation(ID, Action::Restart)).unwrap()[0],
        HostMessage::Result {
            code: Some(ErrorCode::NotAllowed),
            ..
        }
    ));
    s.set_context(Context::UserDesktop, true).unwrap();
    // Un rechazo anterior no se convierte en una orden diferida al cambiar de contexto.
    s.receive(&operation(ID, Action::Restart)).unwrap();
    assert_eq!(counter.calls.get(), 0);
    let other = "12345678-1234-4abc-8def-123456789abd";
    let response = s.receive(&operation(other, Action::Lock)).unwrap();
    assert!(matches!(
        response[0],
        HostMessage::Result {
            code: Some(ErrorCode::NotSupported),
            ..
        }
    ));
    let next = "12345678-1234-4abc-8def-123456789abe";
    let response = s.receive(&operation(next, Action::Restart)).unwrap();
    assert!(matches!(
        response[0],
        HostMessage::Result {
            status: Status::Failed,
            code: Some(ErrorCode::Cancelled),
            ..
        }
    ));
    assert_eq!(
        s.receive(&operation(next, Action::Restart)).unwrap(),
        response
    );
    assert_eq!(counter.calls.get(), 1);
}
#[test]
fn bounded_cache_keeps_early_ids_instead_of_evicting_them() {
    let counter = Counter::default();
    let mut s = session(counter.clone());
    ready(&mut s);
    for i in 0..OPERATION_LIMIT {
        s.receive(&operation(
            &format!("{i:08x}-1234-4abc-8def-123456789abc"),
            Action::Restart,
        ))
        .unwrap();
    }
    assert_eq!(counter.calls.get(), OPERATION_LIMIT as u32);
    let extra = s.receive(&operation(ID, Action::Restart)).unwrap();
    assert!(matches!(
        extra[0],
        HostMessage::Result {
            code: Some(ErrorCode::Busy),
            ..
        }
    ));
    s.receive(&operation(
        "00000000-1234-4abc-8def-123456789abc",
        Action::Restart,
    ))
    .unwrap();
    assert_eq!(counter.calls.get(), OPERATION_LIMIT as u32);
}
#[derive(Clone)]
struct FakeClock(Rc<Cell<u64>>);
impl Clock for FakeClock {
    fn now(&self) -> Result<Duration, ClockError> {
        Ok(Duration::from_millis(self.0.get()))
    }
}
#[test]
fn expiry_and_revocation_prevent_even_a_cached_result_and_close_once() {
    for revoke in [false, true] {
        let time = Rc::new(Cell::new(0));
        let counter = Counter::default();
        let mut s = session(counter.clone());
        ready(&mut s);
        let mut gate = AuthorizationGate::new(FakeClock(time.clone()));
        let ticket = gate.begin_validation().unwrap();
        gate.accept_validation(&ticket, Duration::from_secs(30))
            .unwrap();
        let handle = gate.attach_authenticated(s).unwrap();
        gate.with_session(&handle, |s| s.receive(&operation(ID, Action::Restart)))
            .unwrap()
            .unwrap();
        if revoke {
            gate.revoke();
        } else {
            time.set(30_000);
        }
        assert!(matches!(
            gate.with_session(&handle, |s| s.receive(&operation(ID, Action::Restart))),
            Err(Denied::Stopped | Denied::NoAuthorization)
        ));
        assert_eq!(counter.calls.get(), 1);
        assert_eq!(counter.closed.get(), 1);
        drop(gate);
        assert_eq!(counter.closed.get(), 1);
    }
}
#[test]
fn context_sequence_and_closed_session_are_terminal() {
    let counter = Counter::default();
    let mut s = session(counter.clone());
    ready(&mut s);
    let message = s.set_context(Context::Transition, false).unwrap();
    assert!(matches!(
        message[0],
        HostMessage::Context {
            state: Context::Transition,
            image_available: false,
            sequence: 3,
            ..
        }
    ));
    assert!(s.set_context(Context::Login, true).is_ok());
    assert!(s.set_context(Context::Transition, true).is_err());
    s.close(CloseReason::Disconnected);
    assert_eq!(s.receive(ENABLE), Err(ProtocolError::Closed));
    assert_eq!(
        s.set_context(Context::UserDesktop, true),
        Err(ProtocolError::Closed)
    );
    drop(s);
    assert_eq!(counter.closed.get(), 1);
}
#[test]
fn invalid_configuration_never_announces_impossible_actions() {
    for actions in [
        vec![Action::Restart],
        vec![Action::SecureAttention],
        vec![Action::Lock, Action::Lock],
    ] {
        assert!(ControlSession::new(
            Counter::default(),
            "0.1.0".into(),
            Capabilities::NONE,
            actions
        )
        .is_err());
    }
}
