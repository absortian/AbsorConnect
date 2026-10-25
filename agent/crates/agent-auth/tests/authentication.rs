use absor_agent_auth::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::hmac;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

// Credencial pública fija de prueba; no se lee ningún almacén del propietario.
const KEY: [u8; 32] = [0x31; 32];
#[derive(Clone)]
struct Clock(Rc<Cell<u64>>);
impl AttemptClock for Clock {
    fn unix_millis(&self) -> Result<u64, AuthError> {
        Ok(self.0.get())
    }
}
#[derive(Clone)]
struct Store {
    bytes: Rc<RefCell<Vec<u8>>>,
    writes: Rc<Cell<usize>>,
    fail_at: Rc<Cell<Option<usize>>>,
}
impl AttemptStore for Store {
    fn load(&mut self) -> Result<AttemptState, AuthError> {
        serde_json::from_slice(&self.bytes.borrow()).map_err(|_| AuthError::Storage)
    }
    fn commit(&mut self, value: &AttemptState) -> Result<(), AuthError> {
        let n = self.writes.get() + 1;
        self.writes.set(n);
        *self.bytes.borrow_mut() = serde_json::to_vec(value).unwrap();
        // Simula también el caso ambiguo: la escritura llegó a disco antes del error.
        if self.fail_at.get() == Some(n) {
            Err(AuthError::Storage)
        } else {
            Ok(())
        }
    }
}
type Host = Verifier<Store, Clock>;
fn setup() -> (Host, Store, Clock) {
    let store = Store {
        bytes: Rc::new(RefCell::new(
            serde_json::to_vec(&AttemptState::provisioned()).unwrap(),
        )),
        writes: Rc::new(Cell::new(0)),
        fail_at: Rc::new(Cell::new(None)),
    };
    let clock = Clock(Rc::new(Cell::new(1_000_000)));
    (host(store.clone(), clock.clone()), store, clock)
}
fn host(store: Store, clock: Clock) -> Host {
    Host::new(&KEY, &STANDARD.encode([0x17; 16]), ITERATIONS, store, clock).unwrap()
}
fn binding() -> DtlsBinding {
    DtlsBinding::new(
        format!("sha-256 {}", ["AB"; 32].join(":")),
        format!("sha-256 {}", ["CD"; 32].join(":")),
    )
    .unwrap()
}
fn hello(host: &mut Host) -> Hello {
    host.begin(binding(), "Equipo de prueba".into()).unwrap()
}
fn proof(hello: &Hello, binding: &DtlsBinding) -> Vec<u8> {
    let context = format!(
        "absor-remote-auth-v1\n{}\n{}\n{}",
        hello.nonce,
        binding.offer(),
        binding.answer()
    );
    let signature = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, &KEY), context.as_bytes());
    serde_json::to_vec(&serde_json::json!({"v":1,"type":"auth","proof":STANDARD.encode(signature)}))
        .unwrap()
}

#[test]
fn hello_is_compatible_and_changes_nonce_between_connections() {
    let (mut host, _, _) = setup();
    let a = hello(&mut host);
    let value = serde_json::to_value(&a).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 6);
    assert_eq!(value["v"], 1);
    assert_eq!(value["type"], "hello");
    assert_eq!(value["iterations"], 600_000);
    assert_eq!(STANDARD.decode(&a.nonce).unwrap().len(), 32);
    assert!(matches!(
        host.begin(binding(), "otro".into()),
        Err(AuthError::Busy)
    ));
    host.cancel();
    assert_ne!(a.nonce, hello(&mut host).nonce);
}

#[test]
fn correct_proof_consumes_challenge_and_clears_failures_durably() {
    let (mut host, store, _) = setup();
    hello(&mut host);
    assert!(matches!(
        host.authenticate(b"{}"),
        Err(AuthError::WrongPassword)
    ));
    let a = hello(&mut host);
    let raw = proof(&a, &binding());
    let verified = host.authenticate(&raw).unwrap();
    assert_eq!(verified.into_binding().offer(), binding().offer());
    assert!(matches!(
        host.authenticate(&raw),
        Err(AuthError::NoChallenge)
    ));
    assert_eq!(store.writes.get(), 3);
    let state: serde_json::Value = serde_json::from_slice(&store.bytes.borrow()).unwrap();
    assert_eq!(state["failures"], serde_json::json!([]));
    assert_eq!(state["locked_until"], serde_json::Value::Null);
}

#[test]
fn proof_cannot_be_replayed_after_failed_attempt_or_on_another_dtls_binding() {
    let (mut host, _, _) = setup();
    let a = hello(&mut host);
    let raw = proof(&a, &binding());
    assert!(matches!(
        host.authenticate(b"{}"),
        Err(AuthError::WrongPassword)
    ));
    assert!(matches!(
        host.authenticate(&raw),
        Err(AuthError::NoChallenge)
    ));
    hello(&mut host);
    assert!(matches!(
        host.authenticate(&raw),
        Err(AuthError::WrongPassword)
    ));
    let a = hello(&mut host);
    let changed = DtlsBinding::new(binding().answer().into(), binding().offer().into()).unwrap();
    assert!(matches!(
        host.authenticate(&proof(&a, &changed)),
        Err(AuthError::WrongPassword)
    ));
}

#[test]
fn fifth_failure_is_persisted_before_rejection_and_survives_new_verifier() {
    let (mut first, store, clock) = setup();
    for _ in 0..5 {
        hello(&mut first);
        assert!(matches!(
            first.authenticate(b"{}"),
            Err(AuthError::WrongPassword)
        ));
    }
    drop(first);
    let mut restarted = host(store.clone(), clock.clone());
    assert!(matches!(
        restarted.begin(binding(), "x".into()),
        Err(AuthError::Locked { retry_after: 900 })
    ));
    assert_eq!(store.writes.get(), 5);
    clock.0.set(1_899_999);
    assert!(matches!(
        restarted.begin(binding(), "x".into()),
        Err(AuthError::Locked { retry_after: 1 })
    ));
    clock.0.set(1_900_000);
    let a = hello(&mut restarted);
    assert!(restarted.authenticate(&proof(&a, &binding())).is_ok());
}

#[test]
fn window_boundary_drops_old_failures_and_success_resets_remaining_attempts() {
    let (mut host, store, clock) = setup();
    for _ in 0..4 {
        hello(&mut host);
        assert!(host.authenticate(b"{}").is_err());
    }
    clock.0.set(1_900_000);
    hello(&mut host);
    assert!(host.authenticate(b"{}").is_err());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&store.bytes.borrow()).unwrap()["failures"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let a = hello(&mut host);
    assert!(host.authenticate(&proof(&a, &binding())).is_ok());
    for _ in 0..4 {
        hello(&mut host);
        assert!(host.authenticate(b"{}").is_err());
    }
    assert!(host.begin(binding(), "x".into()).is_ok());
}

#[test]
fn failure_to_reserve_or_clear_never_returns_an_authenticated_connection() {
    for failure in [1, 2] {
        let (mut host, store, _) = setup();
        store.fail_at.set(Some(failure));
        let a = hello(&mut host);
        assert!(matches!(
            host.authenticate(&proof(&a, &binding())),
            Err(AuthError::Storage)
        ));
        assert!(matches!(
            host.begin(binding(), "x".into()),
            Err(AuthError::Stopped)
        ));
    }
}

#[test]
fn corrupt_missing_or_inconsistent_state_never_resets_counter() {
    for raw in [
        "",
        "{}",
        "null",
        "{\"schema\":2,\"failures\":[],\"locked_until\":null,\"last_seen\":0}",
        "{\"schema\":1,\"failures\":[1,2,3,4,5],\"locked_until\":null,\"last_seen\":5}",
        "{\"schema\":1,\"failures\":[2,1],\"locked_until\":null,\"last_seen\":2}",
        "{\"schema\":1,\"failures\":[3],\"locked_until\":null,\"last_seen\":2}",
    ] {
        let (_, store, clock) = setup();
        *store.bytes.borrow_mut() = raw.as_bytes().to_vec();
        assert!(matches!(
            Host::new(
                &KEY,
                &STANDARD.encode([0; 16]),
                ITERATIONS,
                store.clone(),
                clock
            ),
            Err(AuthError::Storage)
        ));
        assert_eq!(store.writes.get(), 0);
    }
}

#[test]
fn backwards_clock_stops_current_verifier_and_stored_floor_survives_restart() {
    let (mut first, store, clock) = setup();
    hello(&mut first);
    assert!(first.authenticate(b"{}").is_err());
    clock.0.set(999_999);
    assert!(matches!(
        first.begin(binding(), "x".into()),
        Err(AuthError::Clock)
    ));
    let mut second = host(store, clock);
    assert!(matches!(
        second.begin(binding(), "x".into()),
        Err(AuthError::Clock)
    ));
}

#[test]
fn malformed_wire_messages_consume_one_attempt_without_another_guess() {
    let bodies = [b"{\"v\":2,\"type\":\"auth\",\"proof\":\"x\"}".to_vec(),
        b"{\"v\":1,\"v\":1,\"type\":\"auth\",\"proof\":\"x\"}".to_vec(),
        b"{\"v\":1,\"type\":\"auth\",\"proof\":false}".to_vec(),
        b"{\"v\":1,\"type\":\"auth\",\"proof\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\",\"extra\":1}".to_vec(),
        vec![b' '; 513], vec![0xff]];
    for raw in bodies {
        let (mut host, store, _) = setup();
        hello(&mut host);
        assert!(matches!(
            host.authenticate(&raw),
            Err(AuthError::WrongPassword)
        ));
        assert!(matches!(
            host.authenticate(&raw),
            Err(AuthError::NoChallenge)
        ));
        assert_eq!(store.writes.get(), 1);
    }
}

#[test]
fn binding_configuration_and_explicit_stop_fail_closed() {
    for value in [
        "",
        "sha-1 AB",
        "sha-256 AB\nCD",
        "sha-256 zz",
        "sha-256  AB",
    ] {
        assert!(DtlsBinding::new(value.into(), binding().answer().into()).is_err());
    }
    let (_, store, clock) = setup();
    assert!(matches!(
        Host::new(&KEY, "invalid salt", ITERATIONS, store, clock),
        Err(AuthError::InvalidConfiguration)
    ));
    let (_, store, clock) = setup();
    assert!(matches!(
        Host::new(&KEY, &STANDARD.encode([0; 16]), 1000, store, clock),
        Err(AuthError::InvalidConfiguration)
    ));
    let (mut host, _, _) = setup();
    let a = hello(&mut host);
    host.stop();
    assert!(matches!(
        host.authenticate(&proof(&a, &binding())),
        Err(AuthError::Stopped)
    ));
}
