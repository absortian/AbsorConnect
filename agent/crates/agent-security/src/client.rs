//! Cliente del trabajador fijo: no admite dirección de socket ni secretos externos.
use crate::{
    linux::{self, FramedPeer},
    wire::{Command, Reply, Request, Response, State},
};
use absor_agent_auth::DtlsBinding;
use absor_agent_core::clock::{BootClock, Clock};
use std::{
    fs,
    os::unix::{
        fs::{FileTypeExt, MetadataExt},
        net::UnixStream,
    },
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

#[derive(Debug)]
pub struct ClientError;
fn now() -> Result<u64, ClientError> {
    u64::try_from(BootClock.now().map_err(|_| ClientError)?.as_millis()).map_err(|_| ClientError)
}

/// Capacidad consumible emitida solo tras autenticar IPC + prueba v1 de esa conexión.
/// Conserva el corte independiente; no serializable, no clonable ni construible fuera.
pub struct AuthorizedWorker {
    binding: DtlsBinding,
    alive: Arc<AtomicBool>,
}
impl AuthorizedWorker {
    pub fn into_parts(self) -> (DtlsBinding, Arc<AtomicBool>) {
        (self.binding, self.alive)
    }
}
struct Watch {
    alive: Arc<AtomicBool>,
    deadline: AtomicU64,
    fresh: AtomicU64,
    actor: AtomicU64,
    terminal: AtomicI32,
    closed: AtomicBool,
}
impl Watch {
    fn sample(&self, t: u64) -> Result<(), ClientError> {
        let fresh = self.fresh.load(Ordering::Acquire);
        let actor = self.actor.load(Ordering::Acquire);
        if t < fresh
            || t < actor
            || t.saturating_sub(fresh) >= 2000
            || t.saturating_sub(actor) >= 3000
        {
            self.stop(-3);
            return Err(ClientError);
        }
        let deadline = self.deadline.load(Ordering::Acquire);
        if deadline != 0 && t >= deadline {
            self.stop(-1);
        }
        Ok(())
    }
    fn stop(&self, code: i32) {
        self.terminal
            .compare_exchange(0, code, Ordering::SeqCst, Ordering::SeqCst)
            .ok();
        self.alive.store(false, Ordering::Release);
    }
}
pub struct WorkerClient {
    peer: FramedPeer,
    sequence: u64,
    watch: Arc<Watch>,
    pending: Option<DtlsBinding>,
    authenticated: bool,
}
impl WorkerClient {
    pub fn connect() -> Result<Self, ClientError> {
        let profile = crate::profile::WorkerProfile::load().map_err(|_| ClientError)?;
        if linux::uid() != profile.uid() || linux::gid() != profile.gid() {
            return Err(ClientError);
        }
        linux::disable_dumping().map_err(|_| ClientError)?;
        let parent = Path::new("/run/absorconnect-secure-lab");
        let m = fs::symlink_metadata(parent).map_err(|_| ClientError)?;
        if !m.is_dir() || m.is_symlink() || m.uid() != 0 || m.mode() & 0o022 != 0 {
            return Err(ClientError);
        }
        let path = parent.join("control.sock");
        let m = fs::symlink_metadata(&path).map_err(|_| ClientError)?;
        if !m.file_type().is_socket()
            || [0, profile.uid()].contains(&m.uid())
            || m.gid() != profile.gid()
            || m.mode() & 0o7777 != 0o660
        {
            return Err(ClientError);
        }
        let stream = UnixStream::connect(path).map_err(|_| ClientError)?;
        let identity = linux::peer_credentials(&stream).map_err(|_| ClientError)?;
        if identity.uid != 0 || identity.pid != 1 {
            return Err(ClientError);
        }
        let start = now()?;
        let watch = Arc::new(Watch {
            alive: Arc::new(AtomicBool::new(true)),
            deadline: AtomicU64::new(0),
            fresh: AtomicU64::new(start),
            actor: AtomicU64::new(start),
            terminal: AtomicI32::new(0),
            closed: AtomicBool::new(false),
        });
        let mut value = Self {
            peer: FramedPeer::new(stream).map_err(|_| ClientError)?,
            sequence: 0,
            watch: watch.clone(),
            pending: None,
            authenticated: false,
        };
        // El primer RPC valida también el PID autorizado en el lado del broker.
        value.poll()?;
        linux::notify(b"READY=1").map_err(|_| ClientError)?;
        thread::spawn(move || {
            while !watch.closed.load(Ordering::Acquire) {
                let Ok(t) = now() else { std::process::exit(72) };
                if watch.sample(t).is_err() {
                    std::process::exit(72);
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        Ok(value)
    }
    fn rpc(&mut self, command: Command) -> Result<Reply, ClientError> {
        if self.watch.terminal.load(Ordering::Acquire) < 0 {
            return Err(ClientError);
        }
        let result = (|| {
            self.sequence = self.sequence.checked_add(1).ok_or(ClientError)?;
            let bytes = serde_json::to_vec(&Request {
                v: 1,
                sequence: self.sequence,
                command,
            })
            .map_err(|_| ClientError)?;
            let start = BootClock.now().map_err(|_| ClientError)?;
            self.peer.send(&bytes, start).map_err(|_| ClientError)?;
            loop {
                let at = BootClock.now().map_err(|_| ClientError)?;
                if at < start || at - start >= Duration::from_millis(1500) {
                    return Err(ClientError);
                }
                if let Some(raw) = self.peer.poll(at).map_err(|_| ClientError)? {
                    let response: Response =
                        serde_json::from_slice(&raw).map_err(|_| ClientError)?;
                    if response.v != 1 || response.sequence != self.sequence {
                        return Err(ClientError);
                    }
                    self.watch.fresh.store(now()?, Ordering::Release);
                    return Ok(response.result);
                }
                thread::sleep(Duration::from_millis(2));
            }
        })();
        if result.is_err() {
            self.watch.stop(-3);
        }
        result
    }
    pub fn poll(&mut self) -> Result<i32, ClientError> {
        self.watch.actor.store(now()?, Ordering::Release);
        let result = self.check_lease();
        if result.as_ref().is_ok_and(|s| *s >= 0) {
            linux::notify(b"WATCHDOG=1").map_err(|_| ClientError)?;
        }
        result
    }
    pub fn check_lease(&mut self) -> Result<i32, ClientError> {
        let terminal = self.watch.terminal.load(Ordering::Acquire);
        if terminal < 0 {
            return Ok(terminal);
        }
        let reply = self.rpc(Command::Lease {})?;
        match reply {
            Reply::Lease {
                state,
                deadline_boottime_millis,
            } if matches!(state, State::Ready | State::Authenticated) => {
                let t = now()?;
                if deadline_boottime_millis <= t || deadline_boottime_millis - t > 30_000 {
                    self.watch.stop(-1);
                    return Ok(-1);
                }
                self.watch
                    .deadline
                    .store(deadline_boottime_millis, Ordering::Release);
                if state == State::Authenticated && !self.authenticated {
                    self.watch.stop(-3);
                    return Err(ClientError);
                }
                if self.authenticated && state != State::Authenticated {
                    self.watch.stop(-3);
                    return Ok(-3);
                }
                Ok(if self.authenticated { 2 } else { 1 })
            }
            Reply::Denied {
                state: State::AwaitingApi,
                ..
            } if self.watch.deadline.load(Ordering::Acquire) == 0 => Ok(0),
            Reply::Denied { state, .. } | Reply::Lease { state, .. } => {
                let code = if state == State::Revoked {
                    -2
                } else if state == State::Expired || state == State::AwaitingApi {
                    -1
                } else {
                    -3
                };
                self.watch.stop(code);
                Ok(code)
            }
            _ => {
                self.watch.stop(-3);
                Err(ClientError)
            }
        }
    }
    pub fn offer(&mut self) -> Result<Option<Vec<u8>>, ClientError> {
        if self.check_lease()? != 1 {
            return Err(ClientError);
        }
        match self.rpc(Command::Offer {})? {
            Reply::Pending {} => Ok(None),
            Reply::Offer { payload } if payload.len() <= 262_144 => Ok(Some(payload.into_bytes())),
            _ => Err(ClientError),
        }
    }
    pub fn answer(&mut self, payload: String) -> Result<(), ClientError> {
        if self.check_lease()? != 1 {
            return Err(ClientError);
        }
        match self.rpc(Command::Answer { payload })? {
            Reply::Accepted {} => Ok(()),
            _ => Err(ClientError),
        }
    }
    pub fn hello(&mut self, offer: String, answer: String) -> Result<Option<Vec<u8>>, ClientError> {
        if self.pending.is_some() || self.poll()? != 1 {
            return Err(ClientError);
        }
        let binding = DtlsBinding::new(offer.clone(), answer.clone()).map_err(|_| ClientError)?;
        match self.rpc(Command::Challenge {
            offer_fingerprint: offer,
            answer_fingerprint: answer,
        })? {
            Reply::Pending {} => Ok(None),
            Reply::Hello { payload } if payload.len() <= 4096 => {
                self.pending = Some(binding);
                Ok(Some(payload.into_bytes()))
            }
            _ => Err(ClientError),
        }
    }
    pub fn authenticate(
        &mut self,
        message: &[u8],
    ) -> Result<Option<AuthorizedWorker>, ClientError> {
        if self.check_lease()? != 1 || message.len() > 512 {
            return Err(ClientError);
        }
        let binding = self.pending.take().ok_or(ClientError)?;
        let message = std::str::from_utf8(message)
            .map_err(|_| ClientError)?
            .to_owned();
        match self.rpc(Command::Authenticate { message })? {
            Reply::Status {
                state: State::Authenticated,
                ..
            } => {
                self.authenticated = true;
                if self.check_lease()? != 2 {
                    return Err(ClientError);
                }
                Ok(Some(AuthorizedWorker {
                    binding,
                    alive: self.watch.alive.clone(),
                }))
            }
            Reply::Denied {
                state: State::WrongProof | State::Locked,
                ..
            } => Ok(None),
            _ => Err(ClientError),
        }
    }
    pub fn disconnect(&mut self) {
        if self.watch.terminal.load(Ordering::Acquire) == 0 {
            let _ = self.rpc(Command::Disconnect {});
        }
        self.watch.alive.store(false, Ordering::Release);
    }
    pub fn fail(&self) {
        self.watch.stop(-3);
    }
}
impl Drop for WorkerClient {
    fn drop(&mut self) {
        self.watch.closed.store(true, Ordering::Release);
        self.watch.alive.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn watch() -> Watch {
        Watch {
            alive: Arc::new(AtomicBool::new(true)),
            deadline: AtomicU64::new(1000),
            fresh: AtomicU64::new(100),
            actor: AtomicU64::new(100),
            terminal: AtomicI32::new(0),
            closed: AtomicBool::new(false),
        }
    }
    #[test]
    fn exact_api_deadline_stops_native_access_even_with_fresh_ipc() {
        let w = watch();
        w.sample(999).unwrap();
        assert!(w.alive.load(Ordering::Acquire));
        w.fresh.store(1000, Ordering::Release);
        w.actor.store(1000, Ordering::Release);
        w.sample(1000).unwrap();
        assert!(!w.alive.load(Ordering::Acquire));
        assert_eq!(w.terminal.load(Ordering::Acquire), -1);
        w.deadline.store(30000, Ordering::Release);
        w.sample(1001).unwrap();
        assert!(!w.alive.load(Ordering::Acquire));
    }
    #[test]
    fn fresh_ipc_never_hides_a_stalled_actor_or_a_clock_regression() {
        let w = watch();
        w.deadline.store(30000, Ordering::Release);
        w.fresh.store(3100, Ordering::Release);
        assert!(w.sample(3100).is_err());
        assert!(!w.alive.load(Ordering::Acquire));
        let w = watch();
        assert!(w.sample(99).is_err());
        assert!(!w.alive.load(Ordering::Acquire));
        let w = watch();
        w.actor.store(2100, Ordering::Release);
        assert!(w.sample(2100).is_err());
    }
}
