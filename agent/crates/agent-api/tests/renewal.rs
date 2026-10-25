use absor_agent_api::http::{ApiError, Authorization, HeartbeatSource};
use absor_agent_api::RenewingAgent;
use absor_agent_core::clock::{Clock, ClockError};
use absor_agent_core::{CloseReason, Denied, Session};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
struct TestClock(Arc<Mutex<Duration>>);
impl TestClock {
    fn set(&self, seconds: u64) {
        *self.0.lock().unwrap() = Duration::from_secs(seconds);
    }
}
impl Clock for TestClock {
    fn now(&self) -> Result<Duration, ClockError> {
        Ok(*self.0.lock().unwrap())
    }
}
struct Worker(Arc<Mutex<Vec<CloseReason>>>);
impl Session for Worker {
    fn close(&mut self, reason: CloseReason) {
        self.0.lock().unwrap().push(reason);
    }
}
struct ControlledSource {
    started: mpsc::Sender<()>,
    responses: mpsc::Receiver<Result<Authorization, ApiError>>,
}
impl HeartbeatSource for ControlledSource {
    fn heartbeat(&mut self) -> Result<Authorization, ApiError> {
        self.started.send(()).unwrap();
        self.responses
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or(Err(ApiError::Unavailable))
    }
}
type Agent = RenewingAgent<TestClock, Worker>;
fn setup() -> (
    TestClock,
    Agent,
    mpsc::Receiver<()>,
    mpsc::Sender<Result<Authorization, ApiError>>,
) {
    let clock = TestClock(Arc::new(Mutex::new(Duration::ZERO)));
    let (started, observed) = mpsc::channel();
    let (reply, responses) = mpsc::channel();
    let agent = Agent::new(clock.clone(), ControlledSource { started, responses });
    (clock, agent, observed, reply)
}
fn validated(agent: &mut Agent) -> Result<(), ApiError> {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let progress = agent.tick().unwrap();
        if let Some(result) = progress.validation {
            return result;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn grant() -> Result<Authorization, ApiError> {
    Ok(Authorization {
        valid_for: Duration::from_secs(30),
        requests: vec![],
    })
}

#[test]
fn blocked_network_does_not_block_expiry_or_resurrect_old_session() {
    let (clock, mut agent, started, reply) = setup();
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply.send(grant()).unwrap();
    assert_eq!(validated(&mut agent), Ok(()));
    let closed = Arc::new(Mutex::new(vec![]));
    let handle = agent
        .attach_authenticated(Worker(closed.clone()))
        .ok()
        .unwrap();
    clock.set(3);
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    clock.set(30);
    agent.tick().unwrap();
    assert_eq!(*closed.lock().unwrap(), [CloseReason::AuthorizationExpired]);
    assert_eq!(
        agent.with_session(&handle, |_| ()),
        Err(Denied::NoAuthorization)
    );
    assert!(started.try_recv().is_err());
    reply.send(grant()).unwrap();
    assert_eq!(validated(&mut agent), Ok(()));
    assert_eq!(
        agent.with_session(&handle, |_| ()),
        Err(Denied::StaleSession)
    );
    let next = agent
        .attach_authenticated(Worker(Arc::new(Mutex::new(vec![]))))
        .ok()
        .unwrap();
    clock.set(33);
    assert_eq!(
        agent.with_session(&next, |_| ()),
        Err(Denied::NoAuthorization)
    );
}

#[test]
fn revoked_backend_response_cuts_current_session_immediately() {
    let (clock, mut agent, started, reply) = setup();
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply.send(grant()).unwrap();
    validated(&mut agent).unwrap();
    let closed = Arc::new(Mutex::new(vec![]));
    let handle = agent
        .attach_authenticated(Worker(closed.clone()))
        .ok()
        .unwrap();
    clock.set(3);
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply.send(Err(ApiError::Revoked)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if matches!(agent.tick(), Err(Denied::Stopped)) {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(*closed.lock().unwrap(), [CloseReason::Revoked]);
    assert_eq!(agent.with_session(&handle, |_| ()), Err(Denied::Stopped));
}

#[test]
fn retry_after_is_respected_while_permission_still_expires() {
    let (clock, mut agent, started, reply) = setup();
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply.send(grant()).unwrap();
    validated(&mut agent).unwrap();
    let closed = Arc::new(Mutex::new(vec![]));
    agent
        .attach_authenticated(Worker(closed.clone()))
        .ok()
        .unwrap();
    clock.set(3);
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply
        .send(Err(ApiError::RateLimited(Duration::from_secs(60))))
        .unwrap();
    assert_eq!(
        validated(&mut agent),
        Err(ApiError::RateLimited(Duration::from_secs(60)))
    );
    clock.set(30);
    agent.tick().unwrap();
    assert_eq!(*closed.lock().unwrap(), [CloseReason::AuthorizationExpired]);
    assert!(started.try_recv().is_err());
    clock.set(62);
    agent.tick().unwrap();
    assert!(started.try_recv().is_err());
    clock.set(63);
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    reply.send(grant()).unwrap();
    validated(&mut agent).unwrap();
}

#[test]
fn late_reply_does_not_grant_a_new_lease() {
    let (clock, mut agent, started, reply) = setup();
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    clock.set(31);
    reply.send(grant()).unwrap();
    assert_eq!(validated(&mut agent), Err(ApiError::InvalidResponse));
    assert!(matches!(
        agent.attach_authenticated(Worker(Arc::new(Mutex::new(vec![])))),
        Err(Denied::NoAuthorization)
    ));
}

#[test]
fn stopping_while_query_is_pending_prevents_new_authorization() {
    let (_, mut agent, started, reply) = setup();
    agent.tick().unwrap();
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    agent.stop();
    reply.send(grant()).unwrap();
    assert!(matches!(agent.tick(), Err(Denied::Stopped)));
}
