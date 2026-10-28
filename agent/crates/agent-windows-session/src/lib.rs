//! Ciclo de vida de trabajadores de metadatos Windows. No autoriza captura o entrada.
#![deny(unsafe_code)]
#[cfg(all(windows, feature = "windows-session-lab"))]
#[allow(unsafe_code)]
pub mod native;
pub mod wire;
use absor_agent_core::clock::Clock;
use std::time::Duration;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionId(u32);
impl SessionId {
    pub fn from_console(value: u32) -> Option<Self> {
        if value == 0 || value == u32::MAX {
            None
        } else {
            Some(Self(value))
        }
    }
    pub fn value(self) -> u32 {
        self.0
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Assignment {
    session: SessionId,
    generation: u64,
}
impl Assignment {
    pub fn session(self) -> SessionId {
        self.session
    }
    pub fn generation(self) -> u64 {
        self.generation
    }
}
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Plan {
    pub stop_worker: bool,
    pub start: Option<Assignment>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Fault {
    Clock,
    Epoch,
    StaleAssignment,
    RetryLimit,
    Stopped,
}
pub struct Lifecycle<C: Clock> {
    clock: C,
    previous: Duration,
    stopped: bool,
    session: Option<SessionId>,
    os_epoch: u64,
    generation: u64,
    worker: Option<Assignment>,
    pending: Option<Assignment>,
    failures: u8,
    next_start: Duration,
}
impl<C: Clock> Lifecycle<C> {
    pub fn new(clock: C) -> Result<Self, Fault> {
        let now = clock.now().map_err(|_| Fault::Clock)?;
        Ok(Self {
            clock,
            previous: now,
            stopped: false,
            session: None,
            os_epoch: 0,
            generation: 0,
            worker: None,
            pending: None,
            failures: 0,
            next_start: now,
        })
    }
    fn now(&mut self) -> Result<Duration, Fault> {
        if self.stopped {
            return Err(Fault::Stopped);
        }
        match self.clock.now() {
            Ok(now) if now >= self.previous => {
                self.previous = now;
                Ok(now)
            }
            _ => {
                self.stop();
                Err(Fault::Clock)
            }
        }
    }
    fn failed(&mut self, now: Duration) -> Result<(), Fault> {
        self.failures = match self.failures.checked_add(1) {
            Some(value) => value,
            None => {
                self.stop();
                return Err(Fault::RetryLimit);
            }
        };
        if self.failures > 3 {
            self.stop();
            return Err(Fault::RetryLimit);
        }
        self.next_start =
            match now.checked_add(Duration::from_millis(250_u64 << (self.failures - 1))) {
                Some(value) => value,
                None => {
                    self.stop();
                    return Err(Fault::Clock);
                }
            };
        Ok(())
    }
    /// Solo valores de WTS/SCM y handles del kernel; no los declarados por el trabajador.
    pub fn advance(
        &mut self,
        session: Option<SessionId>,
        os_epoch: u64,
        worker_alive: bool,
    ) -> Result<Plan, Fault> {
        let now = self.now()?;
        let mut plan = Plan::default();
        if os_epoch < self.os_epoch {
            self.stop();
            return Err(Fault::Epoch);
        }
        if session != self.session || os_epoch != self.os_epoch {
            let active = self.worker.take().is_some();
            let pending = self.pending.take().is_some();
            plan.stop_worker = active || pending;
            self.session = session;
            self.os_epoch = os_epoch;
            self.failures = 0;
            self.next_start = now;
        } else if self.worker.is_some() && !worker_alive {
            self.worker.take();
            plan.stop_worker = true;
            self.failed(now)?;
        }
        if self.worker.is_none() && self.pending.is_none() && now >= self.next_start {
            if let Some(session) = self.session {
                self.generation = match self.generation.checked_add(1) {
                    Some(value) => value,
                    None => {
                        self.stop();
                        return Err(Fault::Epoch);
                    }
                };
                let assignment = Assignment {
                    session,
                    generation: self.generation,
                };
                self.pending = Some(assignment);
                plan.start = Some(assignment);
            }
        }
        Ok(plan)
    }
    pub fn started(&mut self, assignment: Assignment, success: bool) -> Result<(), Fault> {
        let now = self.now()?;
        if self.pending != Some(assignment) || self.session != Some(assignment.session) {
            self.stop();
            return Err(Fault::StaleAssignment);
        }
        self.pending = None;
        if success {
            self.worker = Some(assignment);
            Ok(())
        } else {
            self.failed(now)
        }
    }
    pub fn stop(&mut self) -> bool {
        self.stopped = true;
        let worker = self.worker.take().is_some();
        let pending = self.pending.take().is_some();
        worker || pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use absor_agent_core::clock::ClockError;
    use std::sync::{Arc, Mutex};
    #[derive(Clone)]
    struct TestClock(Arc<Mutex<Result<Duration, ClockError>>>);
    impl TestClock {
        fn new() -> Self {
            Self(Arc::new(Mutex::new(Ok(Duration::ZERO))))
        }
        fn set(&self, n: u64) {
            *self.0.lock().unwrap() = Ok(Duration::from_millis(n));
        }
    }
    impl Clock for TestClock {
        fn now(&self) -> Result<Duration, ClockError> {
            *self.0.lock().unwrap()
        }
    }
    fn session() -> Option<SessionId> {
        SessionId::from_console(1)
    }
    #[test]
    fn no_console_never_creates_a_session_zero_worker() {
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        for raw in [0, u32::MAX] {
            assert_eq!(
                life.advance(SessionId::from_console(raw), 0, false)
                    .unwrap(),
                Plan::default()
            );
        }
    }
    #[test]
    fn a_pending_or_running_assignment_is_not_spawned_twice() {
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        let a = life.advance(session(), 0, false).unwrap().start.unwrap();
        assert_eq!(life.advance(session(), 0, false).unwrap(), Plan::default());
        life.started(a, true).unwrap();
        assert_eq!(life.advance(session(), 0, true).unwrap(), Plan::default());
    }
    #[test]
    fn a_console_or_scm_event_cuts_the_previous_generation() {
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        let a = life.advance(session(), 0, false).unwrap().start.unwrap();
        life.started(a, true).unwrap();
        let p = life.advance(session(), 1, true).unwrap();
        assert!(p.stop_worker);
        let b = p.start.unwrap();
        assert!(b.generation() > a.generation());
        life.started(b, true).unwrap();
        let p = life.advance(None, 2, true).unwrap();
        assert!(p.stop_worker);
        assert!(p.start.is_none());
    }
    #[test]
    fn stale_spawn_acknowledgment_is_terminal() {
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        let a = life.advance(session(), 0, false).unwrap().start.unwrap();
        let _ = life.advance(SessionId::from_console(2), 1, false).unwrap();
        assert_eq!(life.started(a, true), Err(Fault::StaleAssignment));
        assert_eq!(life.advance(session(), 1, true), Err(Fault::Stopped));
    }
    #[test]
    fn worker_recovery_has_backoff_and_a_finite_retry_limit() {
        let clock = TestClock::new();
        let mut life = Lifecycle::new(clock.clone()).unwrap();
        let a = life.advance(session(), 0, false).unwrap().start.unwrap();
        life.started(a, true).unwrap();
        let mut now = 0;
        for delay in [250, 500, 1000] {
            assert!(life.advance(session(), 0, false).unwrap().stop_worker);
            clock.set(now + delay - 1);
            assert!(life.advance(session(), 0, false).unwrap().start.is_none());
            now += delay;
            clock.set(now);
            let a = life.advance(session(), 0, false).unwrap().start.unwrap();
            life.started(a, true).unwrap();
        }
        assert_eq!(life.advance(session(), 0, false), Err(Fault::RetryLimit));
        assert_eq!(life.advance(session(), 1, true), Err(Fault::Stopped));
    }
    #[test]
    fn explicit_stop_does_not_reactivate_on_later_events() {
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        assert!(life.advance(session(), 0, false).unwrap().start.is_some());
        assert!(life.stop());
        assert!(!life.stop());
        assert_eq!(life.advance(session(), 1, false), Err(Fault::Stopped));
    }
    #[test]
    fn clock_failure_regression_and_old_scm_epoch_fail_closed() {
        let clock = TestClock::new();
        let mut life = Lifecycle::new(clock.clone()).unwrap();
        clock.set(5);
        life.advance(None, 1, false).unwrap();
        clock.set(4);
        assert_eq!(life.advance(None, 1, false), Err(Fault::Clock));
        let clock = TestClock::new();
        let mut life = Lifecycle::new(clock.clone()).unwrap();
        *clock.0.lock().unwrap() = Err(ClockError);
        assert_eq!(life.advance(None, 0, false), Err(Fault::Clock));
        let mut life = Lifecycle::new(TestClock::new()).unwrap();
        life.advance(None, 5, false).unwrap();
        assert_eq!(life.advance(None, 4, false), Err(Fault::Epoch));
    }
    #[test]
    fn generation_and_deadline_overflow_are_terminal() {
        let clock = TestClock::new();
        let mut life = Lifecycle::new(clock.clone()).unwrap();
        life.generation = u64::MAX;
        assert_eq!(life.advance(session(), 0, false), Err(Fault::Epoch));
        assert_eq!(life.advance(session(), 1, false), Err(Fault::Stopped));
        let mut life = Lifecycle::new(clock.clone()).unwrap();
        let assignment = life.advance(session(), 0, false).unwrap().start.unwrap();
        *clock.0.lock().unwrap() = Ok(Duration::MAX);
        assert_eq!(life.started(assignment, false), Err(Fault::Clock));
        assert_eq!(life.advance(session(), 1, false), Err(Fault::Stopped));
    }
}
