//! Un lector pendiente. Una consulta lenta nunca bloquea el actor de autorización.
use crate::{Fault, Snapshot};
use absor_agent_core::clock::Clock;
use std::{
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    thread,
    time::Duration,
};

pub const FRESH_FOR: Duration = Duration::from_secs(1);
pub const QUERY_LIMIT: Duration = Duration::from_secs(5);
const INTERVAL: Duration = Duration::from_millis(250);
pub trait Source: Send + 'static {
    fn read(&mut self) -> Result<Snapshot, Fault>;
}

pub struct Monitor<C: Clock> {
    clock: C,
    commands: Option<SyncSender<u64>>,
    responses: Receiver<(u64, Result<Snapshot, Fault>)>,
    pending: Option<(u64, Duration)>,
    latest: Option<(Snapshot, Duration)>,
    sequence: u64,
    last_now: Duration,
    next_query: Duration,
    terminal: Option<Fault>,
    last_fault: Option<Fault>,
}
impl<C: Clock> Monitor<C> {
    pub fn new(clock: C, mut source: impl Source) -> Result<Self, Fault> {
        let now = clock.now().map_err(|_| Fault::Clock)?;
        let (commands, requests) = mpsc::sync_channel(1);
        let (output, responses) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("absor-seat-query".into())
            .spawn(move || {
                while let Ok(sequence) = requests.recv() {
                    let snapshot = source.read();
                    if output.try_send((sequence, snapshot)).is_err() {
                        break;
                    }
                }
            })
            .map_err(|_| Fault::Query)?;
        Ok(Self {
            clock,
            commands: Some(commands),
            responses,
            pending: None,
            latest: None,
            sequence: 0,
            last_now: now,
            next_query: now,
            terminal: None,
            last_fault: None,
        })
    }
    /// Antes de utilizar la selección: devuelve None si falta, se ha retrasado o dejó de ser válida.
    pub fn tick(&mut self) -> Result<Option<&Snapshot>, Fault> {
        if let Some(fault) = self.terminal {
            return Err(fault);
        }
        let now = match self.clock.now() {
            Ok(now) if now >= self.last_now => now,
            _ => return self.fail(Fault::Clock),
        };
        self.last_now = now;
        match self.responses.try_recv() {
            Ok((sequence, result)) => {
                let Some((expected, started)) = self.pending.take() else {
                    return self.fail(Fault::Query);
                };
                if expected != sequence {
                    return self.fail(Fault::Query);
                }
                self.next_query = now.checked_add(INTERVAL).ok_or(Fault::Clock)?;
                if now.saturating_sub(started) >= FRESH_FOR {
                    self.latest = None;
                    self.last_fault = Some(Fault::Query);
                } else {
                    match result {
                        Ok(snapshot) => {
                            self.latest = Some((snapshot, started));
                            self.last_fault = None;
                        }
                        Err(fault) => {
                            self.latest = None;
                            self.last_fault = Some(fault);
                        }
                    }
                }
            }
            Err(TryRecvError::Empty) => (),
            Err(TryRecvError::Disconnected) => return self.fail(Fault::Closed),
        }
        if self
            .pending
            .is_some_and(|(_, started)| now.saturating_sub(started) >= QUERY_LIMIT)
        {
            return self.fail(Fault::Stalled);
        }
        if self
            .latest
            .as_ref()
            .is_some_and(|(_, started)| now.saturating_sub(*started) >= FRESH_FOR)
        {
            self.latest = None;
        }
        if self.pending.is_none() && now >= self.next_query {
            self.sequence = match self.sequence.checked_add(1) {
                Some(value) => value,
                None => return self.fail(Fault::Clock),
            };
            let Some(commands) = &self.commands else {
                return self.fail(Fault::Closed);
            };
            if commands.try_send(self.sequence).is_err() {
                return self.fail(Fault::Closed);
            }
            self.pending = Some((self.sequence, now));
        }
        Ok(self.latest.as_ref().map(|(snapshot, _)| snapshot))
    }
    pub fn sample_started_at(&self) -> Option<Duration> {
        self.latest.as_ref().map(|(_, started)| *started)
    }
    pub fn last_fault(&self) -> Option<Fault> {
        self.terminal.or(self.last_fault)
    }
    pub fn close(&mut self) {
        let _: Result<Option<&Snapshot>, _> = self.fail(Fault::Closed);
    }
    fn fail(&mut self, fault: Fault) -> Result<Option<&Snapshot>, Fault> {
        self.terminal = Some(fault);
        self.latest = None;
        self.pending = None;
        self.commands.take();
        Err(fault)
    }
}
impl<C: Clock> Drop for Monitor<C> {
    fn drop(&mut self) {
        self.commands.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use absor_agent_core::clock::ClockError;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };
    #[derive(Clone)]
    struct FakeClock(Arc<AtomicU64>);
    impl Clock for FakeClock {
        fn now(&self) -> Result<Duration, ClockError> {
            let v = self.0.load(Ordering::SeqCst);
            if v == u64::MAX {
                Err(ClockError)
            } else {
                Ok(Duration::from_millis(v))
            }
        }
    }
    struct Controlled {
        started: SyncSender<()>,
        replies: Receiver<Result<Snapshot, Fault>>,
    }
    impl Source for Controlled {
        fn read(&mut self) -> Result<Snapshot, Fault> {
            self.started.send(()).map_err(|_| Fault::Closed)?;
            self.replies.recv().map_err(|_| Fault::Closed)?
        }
    }
    type Fixture = (
        FakeClock,
        Monitor<FakeClock>,
        Receiver<()>,
        SyncSender<Result<Snapshot, Fault>>,
    );
    fn setup() -> Fixture {
        let clock = FakeClock(Arc::new(AtomicU64::new(0)));
        let (started, requests) = mpsc::sync_channel(1);
        let (answers, replies) = mpsc::sync_channel(1);
        let monitor = Monitor::new(clock.clone(), Controlled { started, replies }).unwrap();
        (clock, monitor, requests, answers)
    }
    fn eventually(monitor: &mut Monitor<FakeClock>, ready: bool) {
        for _ in 0..1000 {
            if monitor.tick().unwrap().is_some() == ready {
                return;
            }
            thread::sleep(Duration::from_millis(1));
        }
        panic!("query_response_not_delivered");
    }
    #[test]
    fn fresh_sample_expires_from_request_start_not_response() {
        let (clock, mut monitor, requests, answers) = setup();
        assert!(monitor.tick().unwrap().is_none());
        requests.recv_timeout(Duration::from_secs(1)).unwrap();
        clock.0.store(800, Ordering::SeqCst);
        answers.send(Ok(crate::tests::snapshot())).unwrap();
        eventually(&mut monitor, true);
        clock.0.store(999, Ordering::SeqCst);
        assert!(monitor.tick().unwrap().is_some());
        clock.0.store(1000, Ordering::SeqCst);
        assert!(monitor.tick().unwrap().is_none());
    }
    #[test]
    fn slow_response_does_not_revive_old_selection() {
        let (clock, mut monitor, requests, answers) = setup();
        monitor.tick().unwrap();
        requests.recv_timeout(Duration::from_secs(1)).unwrap();
        clock.0.store(1000, Ordering::SeqCst);
        answers.send(Ok(crate::tests::snapshot())).unwrap();
        for _ in 0..50 {
            assert!(monitor.tick().unwrap().is_none());
            if monitor.last_fault() == Some(Fault::Query) {
                return;
            }
            thread::sleep(Duration::from_millis(1));
        }
        panic!("slow_response_not_received");
    }
    #[test]
    fn hung_query_is_terminal_and_never_spawns_substitute_readers() {
        let (clock, mut monitor, requests, answers) = setup();
        monitor.tick().unwrap();
        requests.recv_timeout(Duration::from_secs(1)).unwrap();
        for ms in [1000, 2000, 4000, 4999] {
            clock.0.store(ms, Ordering::SeqCst);
            assert!(monitor.tick().unwrap().is_none());
            assert!(requests.try_recv().is_err());
        }
        clock.0.store(5000, Ordering::SeqCst);
        assert_eq!(monitor.tick(), Err(Fault::Stalled));
        answers.send(Ok(crate::tests::snapshot())).unwrap();
        assert_eq!(monitor.tick(), Err(Fault::Stalled));
    }
    #[test]
    fn clock_failure_or_rollback_is_terminal() {
        for next in [0, u64::MAX] {
            let (clock, mut monitor, requests, answers) = setup();
            clock.0.store(10, Ordering::SeqCst);
            monitor.tick().unwrap();
            requests.recv_timeout(Duration::from_secs(1)).unwrap();
            clock.0.store(next, Ordering::SeqCst);
            assert_eq!(monitor.tick(), Err(Fault::Clock));
            answers.send(Ok(crate::tests::snapshot())).unwrap();
            assert_eq!(monitor.tick(), Err(Fault::Clock));
        }
    }
    #[test]
    fn closed_monitor_discards_late_result() {
        let (_, mut monitor, requests, answers) = setup();
        monitor.tick().unwrap();
        requests.recv_timeout(Duration::from_secs(1)).unwrap();
        monitor.close();
        answers.send(Ok(crate::tests::snapshot())).unwrap();
        assert_eq!(monitor.tick(), Err(Fault::Closed));
    }
}
