//! Guardián de entrada local. Solo recibe concesiones validadas en el componente confiable.
//! El fd permanece en su propietario; el cierre debe retirar únicamente su dispositivo.
use crate::grant::ValidatedGrant;
use absor_agent_core::clock::Clock;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FixedEvent {
    KeyA { down: bool },
    LeftButton { down: bool },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputFault {
    Closed,
    Clock,
    Authorization,
    AuthorizationChanged,
    Sequence,
    State,
    Device,
}
/// Eventos fijos del laboratorio. No recibe texto, rutas o comandos del SO.
pub trait OwnedInput {
    fn apply(&mut self, event: FixedEvent) -> Result<(), InputFault>;
    fn close(&mut self);
}
pub struct InputLease<C: Clock, D: OwnedInput> {
    clock: C,
    device: Option<D>,
    grant: ValidatedGrant,
    previous: Duration,
    sequence: u64,
    key: bool,
    button: bool,
}
impl<C: Clock, D: OwnedInput> InputLease<C, D> {
    pub fn start(clock: C, grant: ValidatedGrant, device: D) -> Result<Self, InputFault> {
        let mut value = Self {
            clock,
            device: Some(device),
            grant,
            previous: Duration::ZERO,
            sequence: 0,
            key: false,
            button: false,
        };
        value.observe(None)?;
        Ok(value)
    }
    fn fail<T>(&mut self, error: InputFault) -> Result<T, InputFault> {
        self.close();
        Err(error)
    }
    /// Se llama también sin entrada. Una lectura ausente/corrupta no renueva el plazo anterior.
    pub fn observe(&mut self, fresh: Option<ValidatedGrant>) -> Result<(), InputFault> {
        if self.device.is_none() {
            return Err(InputFault::Closed);
        }
        let now = match self.clock.now() {
            Ok(v) if v >= self.previous => v,
            _ => return self.fail(InputFault::Clock),
        };
        self.previous = now;
        let Ok(millis) = u64::try_from(now.as_millis()) else {
            return self.fail(InputFault::Clock);
        };
        // Un refresco tardío nunca resucita un dispositivo cuya concesión venció.
        if millis < self.grant.issued_millis() || millis >= self.grant.deadline_millis() {
            return self.fail(InputFault::Authorization);
        }
        if let Some(fresh) = fresh {
            if !self.grant.same_authorization(&fresh) {
                return self.fail(InputFault::AuthorizationChanged);
            }
            if fresh.issued_millis() < self.grant.issued_millis()
                || fresh.issued_millis() > millis
                || fresh.deadline_millis() <= millis
            {
                return self.fail(InputFault::Authorization);
            }
            self.grant = fresh;
        }
        Ok(())
    }
    pub fn apply(
        &mut self,
        sequence: u64,
        event: FixedEvent,
        fresh: Option<ValidatedGrant>,
    ) -> Result<(), InputFault> {
        self.observe(fresh)?;
        if self.sequence.checked_add(1) != Some(sequence) {
            return self.fail(InputFault::Sequence);
        }
        let (held, down) = match event {
            FixedEvent::KeyA { down } => (self.key, down),
            FixedEvent::LeftButton { down } => (self.button, down),
        };
        // No se libera entrada que este dispositivo no haya pulsado previamente.
        if held == down {
            return self.fail(InputFault::State);
        }
        if self
            .device
            .as_mut()
            .ok_or(InputFault::Closed)?
            .apply(event)
            .is_err()
        {
            return self.fail(InputFault::Device);
        }
        self.sequence = sequence;
        match event {
            FixedEvent::KeyA { down } => self.key = down,
            FixedEvent::LeftButton { down } => self.button = down,
        }
        self.observe(None)
    }
    pub fn close(&mut self) {
        if let Some(mut device) = self.device.take() {
            device.close();
        }
        self.key = false;
        self.button = false;
    }
}
impl<C: Clock, D: OwnedInput> Drop for InputLease<C, D> {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grant::{Grant, WorkerIdentity};
    use absor_agent_core::clock::ClockError;
    use std::sync::{Arc, Mutex};
    #[derive(Clone)]
    struct TestClock(Arc<Mutex<Result<Duration, ClockError>>>);
    impl TestClock {
        fn new() -> Self {
            Self(Arc::new(Mutex::new(Ok(Duration::from_millis(100)))))
        }
        fn set(&self, millis: u64) {
            *self.0.lock().unwrap() = Ok(Duration::from_millis(millis));
        }
    }
    impl Clock for TestClock {
        fn now(&self) -> Result<Duration, ClockError> {
            *self.0.lock().unwrap()
        }
    }
    #[derive(Default)]
    struct Counts {
        events: usize,
        closes: usize,
    }
    struct Device {
        counts: Arc<Mutex<Counts>>,
        clock: TestClock,
        advance: bool,
        fail: bool,
    }
    impl OwnedInput for Device {
        fn apply(&mut self, _: FixedEvent) -> Result<(), InputFault> {
            self.counts.lock().unwrap().events += 1;
            if self.advance {
                self.clock.set(500);
            }
            if self.fail {
                Err(InputFault::Device)
            } else {
                Ok(())
            }
        }
        fn close(&mut self) {
            self.counts.lock().unwrap().closes += 1;
        }
    }
    fn grant(instance: &str, issued: u64, now: u64) -> ValidatedGrant {
        let boot = "01234567-89ab-cdef-0123-456789abcdef";
        let broker = WorkerIdentity {
            pid: 12,
            uid: 2000,
            start_ticks: 88,
        };
        let worker = WorkerIdentity {
            pid: 22,
            uid: 2001,
            start_ticks: 99,
        };
        let seat = crate::tests::snapshot();
        let raw = Grant::issue(instance, boot, issued, issued + 1000, broker, worker, &seat)
            .unwrap()
            .encode()
            .unwrap();
        Grant::validate(&raw, now, boot, broker, worker, &seat).unwrap()
    }
    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "1123456789abcdef0123456789abcdef";
    fn fixture(
        advance: bool,
        fail: bool,
    ) -> (InputLease<TestClock, Device>, TestClock, Arc<Mutex<Counts>>) {
        let clock = TestClock::new();
        let counts = Arc::new(Mutex::new(Counts::default()));
        let device = Device {
            counts: counts.clone(),
            clock: clock.clone(),
            advance,
            fail,
        };
        (
            InputLease::start(clock.clone(), grant(A, 100, 100), device).unwrap(),
            clock,
            counts,
        )
    }
    #[test]
    fn held_input_expires_without_traffic_and_cannot_resurrect() {
        let (mut lease, clock, counts) = fixture(false, false);
        lease
            .apply(1, FixedEvent::KeyA { down: true }, None)
            .unwrap();
        clock.set(500);
        assert_eq!(
            lease.observe(Some(grant(A, 500, 500))),
            Err(InputFault::Authorization)
        );
        assert_eq!(
            lease.apply(2, FixedEvent::KeyA { down: false }, None),
            Err(InputFault::Closed)
        );
        drop(lease);
        assert_eq!(counts.lock().unwrap().events, 1);
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
    #[test]
    fn new_authentication_closes_old_device_even_without_observing_a_gap() {
        let (mut lease, clock, counts) = fixture(false, false);
        lease
            .apply(1, FixedEvent::LeftButton { down: true }, None)
            .unwrap();
        clock.set(200);
        assert_eq!(
            lease.apply(
                2,
                FixedEvent::LeftButton { down: false },
                Some(grant(B, 200, 200))
            ),
            Err(InputFault::AuthorizationChanged)
        );
        assert_eq!(counts.lock().unwrap().events, 1);
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
    #[test]
    fn only_fresh_same_connection_can_extend_and_missing_reads_do_not() {
        let (mut lease, clock, counts) = fixture(false, false);
        clock.set(300);
        lease.observe(Some(grant(A, 300, 300))).unwrap();
        clock.set(699);
        lease.observe(None).unwrap();
        clock.set(700);
        assert_eq!(lease.observe(None), Err(InputFault::Authorization));
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
    #[test]
    fn invalid_sequence_or_unowned_release_cuts_without_sending_it() {
        for (seq, event, fault) in [
            (2, FixedEvent::KeyA { down: true }, InputFault::Sequence),
            (1, FixedEvent::LeftButton { down: false }, InputFault::State),
        ] {
            let (mut lease, _, counts) = fixture(false, false);
            assert_eq!(lease.apply(seq, event, None), Err(fault));
            assert_eq!(counts.lock().unwrap().events, 0);
            assert_eq!(counts.lock().unwrap().closes, 1);
        }
        let (mut lease, _, counts) = fixture(false, false);
        lease
            .apply(1, FixedEvent::KeyA { down: true }, None)
            .unwrap();
        assert_eq!(
            lease.apply(2, FixedEvent::KeyA { down: true }, None),
            Err(InputFault::State)
        );
        assert_eq!(counts.lock().unwrap().events, 1);
    }
    #[test]
    fn a_call_that_outlives_authorization_closes_its_device() {
        let (mut lease, _, counts) = fixture(true, false);
        assert_eq!(
            lease.apply(1, FixedEvent::KeyA { down: true }, None),
            Err(InputFault::Authorization)
        );
        assert_eq!(counts.lock().unwrap().events, 1);
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
    #[test]
    fn clock_regression_and_device_failure_are_terminal() {
        let (mut lease, clock, counts) = fixture(false, false);
        clock.set(99);
        assert_eq!(lease.observe(None), Err(InputFault::Clock));
        assert_eq!(counts.lock().unwrap().closes, 1);
        let (mut lease, clock, counts) = fixture(false, false);
        *clock.0.lock().unwrap() = Err(ClockError);
        assert_eq!(lease.observe(None), Err(InputFault::Clock));
        assert_eq!(counts.lock().unwrap().closes, 1);
        let (mut lease, _, counts) = fixture(false, true);
        assert_eq!(
            lease.apply(1, FixedEvent::KeyA { down: true }, None),
            Err(InputFault::Device)
        );
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
    #[test]
    fn disconnect_drops_both_owned_states_once_without_global_releases() {
        let (mut lease, _, counts) = fixture(false, false);
        lease
            .apply(1, FixedEvent::KeyA { down: true }, None)
            .unwrap();
        lease
            .apply(2, FixedEvent::LeftButton { down: true }, None)
            .unwrap();
        drop(lease);
        assert_eq!(counts.lock().unwrap().events, 2);
        assert_eq!(counts.lock().unwrap().closes, 1);
    }
}
