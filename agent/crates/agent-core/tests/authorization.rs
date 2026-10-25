use absor_agent_core::clock::{BootClock, Clock, ClockError};
use absor_agent_core::{AuthorizationGate, CloseReason, Denied, Session, MAX_AUTHORIZATION};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

#[derive(Clone, Default)]
struct TestClock(Rc<Cell<Option<Duration>>>);
impl TestClock {
    fn at(milliseconds: u64) -> Self {
        let clock = Self::default();
        clock.set(milliseconds);
        clock
    }
    fn set(&self, milliseconds: u64) {
        self.0.set(Some(Duration::from_millis(milliseconds)));
    }
}
impl Clock for TestClock {
    fn now(&self) -> Result<Duration, ClockError> {
        self.0.get().ok_or(ClockError)
    }
}

#[derive(Clone, Default)]
struct Observation {
    closed: Rc<RefCell<Vec<CloseReason>>>,
    operations: Rc<Cell<u32>>,
}
struct TestSession(Observation);
impl Session for TestSession {
    fn close(&mut self, reason: CloseReason) {
        self.0.closed.borrow_mut().push(reason);
    }
}
type Gate = AuthorizationGate<TestClock, TestSession>;
fn authorized(clock: &TestClock) -> Gate {
    let mut gate = Gate::new(clock.clone());
    let request = gate.begin_validation().unwrap();
    gate.accept_validation(&request, MAX_AUTHORIZATION).unwrap();
    gate
}
fn attach(gate: &mut Gate, observation: &Observation) -> absor_agent_core::SessionHandle {
    gate.attach_authenticated(TestSession(observation.clone()))
        .ok()
        .unwrap()
}

#[test]
fn no_worker_access_before_valid_backend_authorization() {
    let clock = TestClock::at(0);
    let mut gate = Gate::new(clock);
    let observed = Observation::default();
    assert!(matches!(
        gate.attach_authenticated(TestSession(observed.clone())),
        Err(Denied::NoAuthorization)
    ));
    assert_eq!(*observed.closed.borrow(), [CloseReason::Disconnected]);
    assert_eq!(observed.operations.get(), 0);
}

#[test]
fn thirty_seconds_is_an_exclusive_deadline_even_without_network_traffic() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let observed = Observation::default();
    let handle = attach(&mut gate, &observed);
    clock.set(29_999);
    gate.with_session(&handle, |s| s.0.operations.set(1))
        .unwrap();
    clock.set(30_000);
    gate.poll().unwrap();
    assert_eq!(
        *observed.closed.borrow(),
        [CloseReason::AuthorizationExpired]
    );
    assert_eq!(
        gate.with_session(&handle, |_| panic!("entrada tras caducar")),
        Err(Denied::NoAuthorization)
    );
    gate.poll().unwrap();
    assert_eq!(observed.closed.borrow().len(), 1);
}

#[test]
fn request_round_trip_is_deducted_from_the_lease() {
    let clock = TestClock::at(0);
    let mut gate: Gate = Gate::new(clock.clone());
    let request = gate.begin_validation().unwrap();
    clock.set(5_000);
    gate.accept_validation(&request, MAX_AUTHORIZATION).unwrap();
    let observed = Observation::default();
    attach(&mut gate, &observed);
    clock.set(29_950);
    assert_eq!(gate.poll().unwrap(), Duration::from_millis(50));
    clock.set(30_000);
    gate.poll().unwrap();
    assert_eq!(
        *observed.closed.borrow(),
        [CloseReason::AuthorizationExpired]
    );
}

#[test]
fn transport_failure_does_not_renew_and_recovery_requires_new_session() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let first = Observation::default();
    let old_handle = attach(&mut gate, &first);
    clock.set(28_000);
    let failed = gate.begin_validation().unwrap();
    gate.validation_failed(&failed).unwrap();
    clock.set(30_000);
    gate.poll().unwrap();
    assert_eq!(*first.closed.borrow(), [CloseReason::AuthorizationExpired]);
    let valid = gate.begin_validation().unwrap();
    gate.accept_validation(&valid, MAX_AUTHORIZATION).unwrap();
    let second = Observation::default();
    let new_handle = attach(&mut gate, &second);
    assert_eq!(
        gate.with_session(&old_handle, |_| ()),
        Err(Denied::StaleSession)
    );
    gate.with_session(&new_handle, |_| ()).unwrap();
}

#[test]
fn renewed_authorization_preserves_only_the_current_session() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let observed = Observation::default();
    let handle = attach(&mut gate, &observed);
    clock.set(20_000);
    let valid = gate.begin_validation().unwrap();
    gate.accept_validation(&valid, MAX_AUTHORIZATION).unwrap();
    clock.set(49_999);
    gate.with_session(&handle, |_| ()).unwrap();
    clock.set(50_000);
    gate.poll().unwrap();
    assert_eq!(
        *observed.closed.borrow(),
        [CloseReason::AuthorizationExpired]
    );
}

#[test]
fn invalid_duration_and_delayed_response_cannot_grant_access() {
    for (duration, delay) in [
        (Duration::ZERO, 0),
        (Duration::from_secs(31), 0),
        (MAX_AUTHORIZATION, 30_000),
    ] {
        let clock = TestClock::at(0);
        let mut gate: Gate = Gate::new(clock.clone());
        let request = gate.begin_validation().unwrap();
        clock.set(delay);
        assert_eq!(
            gate.accept_validation(&request, duration),
            Err(Denied::InvalidResponse)
        );
        assert!(matches!(
            gate.attach_authenticated(TestSession(Observation::default())),
            Err(Denied::NoAuthorization)
        ));
        assert_eq!(
            gate.accept_validation(&request, MAX_AUTHORIZATION),
            Err(Denied::StaleResponse)
        );
    }
}

#[test]
fn out_of_order_replay_and_other_broker_tickets_are_rejected() {
    let clock = TestClock::at(0);
    let mut gate: Gate = Gate::new(clock.clone());
    let old = gate.begin_validation().unwrap();
    let current = gate.begin_validation().unwrap();
    let mut other: Gate = Gate::new(clock);
    let foreign = other.begin_validation().unwrap();
    assert_eq!(
        gate.accept_validation(&old, MAX_AUTHORIZATION),
        Err(Denied::StaleResponse)
    );
    assert_eq!(
        gate.accept_validation(&foreign, MAX_AUTHORIZATION),
        Err(Denied::StaleResponse)
    );
    gate.accept_validation(&current, MAX_AUTHORIZATION).unwrap();
    assert_eq!(
        gate.accept_validation(&current, MAX_AUTHORIZATION),
        Err(Denied::StaleResponse)
    );
}

#[test]
fn revocation_cuts_immediately_and_late_response_cannot_resurrect() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let observed = Observation::default();
    let handle = attach(&mut gate, &observed);
    let in_flight = gate.begin_validation().unwrap();
    gate.revoke();
    assert_eq!(*observed.closed.borrow(), [CloseReason::Revoked]);
    assert_eq!(
        gate.accept_validation(&in_flight, MAX_AUTHORIZATION),
        Err(Denied::Stopped)
    );
    assert_eq!(gate.with_session(&handle, |_| ()), Err(Denied::Stopped));
    assert!(matches!(gate.begin_validation(), Err(Denied::Stopped)));
}

#[test]
fn only_one_session_is_owned_and_handles_do_not_cross_brokers() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let first = Observation::default();
    let handle = attach(&mut gate, &first);
    let rejected = Observation::default();
    assert!(matches!(
        gate.attach_authenticated(TestSession(rejected.clone())),
        Err(Denied::Busy)
    ));
    assert!(first.closed.borrow().is_empty());
    assert_eq!(*rejected.closed.borrow(), [CloseReason::Disconnected]);
    let mut other = authorized(&clock);
    attach(&mut other, &Observation::default());
    assert_eq!(
        other.with_session(&handle, |_| ()),
        Err(Denied::StaleSession)
    );
    gate.disconnect(&handle).unwrap();
    let next = attach(&mut gate, &Observation::default());
    assert_eq!(
        gate.with_session(&handle, |_| ()),
        Err(Denied::StaleSession)
    );
    gate.with_session(&next, |_| ()).unwrap();
}

#[test]
fn clock_failure_or_regression_cuts_and_disables_the_gate() {
    for regress in [false, true] {
        let clock = TestClock::at(10_000);
        let mut gate = authorized(&clock);
        let observed = Observation::default();
        attach(&mut gate, &observed);
        if regress {
            clock.set(9_000);
        } else {
            clock.0.set(None);
        }
        assert_eq!(gate.poll(), Err(Denied::ClockFault));
        assert_eq!(*observed.closed.borrow(), [CloseReason::ClockFault]);
        clock.set(11_000);
        assert_eq!(gate.poll(), Err(Denied::Stopped));
    }
}

#[test]
fn suspension_time_expires_the_lease_before_resumed_input() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let observed = Observation::default();
    let handle = attach(&mut gate, &observed);
    clock.set(120_000);
    assert_eq!(
        gate.with_session(&handle, |_| panic!("entrada tras suspensión")),
        Err(Denied::NoAuthorization)
    );
    assert_eq!(
        *observed.closed.borrow(),
        [CloseReason::AuthorizationExpired]
    );
}

#[test]
fn long_operation_is_closed_on_return_and_shutdown_also_closes() {
    let clock = TestClock::at(0);
    let observed = Observation::default();
    {
        let mut gate = authorized(&clock);
        let handle = attach(&mut gate, &observed);
        assert_eq!(
            gate.with_session(&handle, |_| clock.set(30_000)),
            Err(Denied::NoAuthorization)
        );
    }
    assert_eq!(
        *observed.closed.borrow(),
        [CloseReason::AuthorizationExpired]
    );
    let fresh = Observation::default();
    {
        let mut gate = authorized(&clock);
        attach(&mut gate, &fresh);
    }
    assert_eq!(*fresh.closed.borrow(), [CloseReason::Shutdown]);
}

#[test]
fn explicit_stop_does_not_restart_on_a_new_backend_response() {
    let clock = TestClock::at(0);
    let mut gate = authorized(&clock);
    let observed = Observation::default();
    attach(&mut gate, &observed);
    gate.stop();
    assert_eq!(*observed.closed.borrow(), [CloseReason::Stopped]);
    assert_eq!(gate.poll(), Err(Denied::Stopped));
}

#[test]
fn native_clock_is_monotonic_across_a_short_wait() {
    let clock = BootClock;
    let before = clock.now().unwrap();
    std::thread::sleep(Duration::from_millis(2));
    assert!(clock.now().unwrap() >= before + Duration::from_millis(1));
}
