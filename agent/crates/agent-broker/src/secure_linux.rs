use absor_agent_api::{http::ApiError, session_signaling::ApiSignaling, RenewingAgent};
use absor_agent_auth::{AuthError, DtlsBinding, Verifier};
use absor_agent_broker::audit::{AuditLog, Event};
use absor_agent_core::{
    clock::{BootClock, Clock},
    CloseReason, Session, SessionHandle,
};
use absor_agent_linux_session::{
    binding::SeatBinding,
    grant::{Grant, WorkerIdentity},
    grant_file::{self, Publisher},
    monitor::Monitor,
    query::LogindSource,
};
use absor_agent_security::{
    linux::{self, FramedPeer, HostLock, ProtectedAttemptStore},
    secrets::{self, WallClock, WrappingKey},
    wire::{self, Command, Reply, Request, Response, State},
};
use std::{
    fs::{self, File},
    io::Read,
    os::unix::fs::{FileTypeExt, MetadataExt},
    path::Path,
    process::Command as Process,
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
const STATE: &str = "/var/lib/absorconnect-secure-lab";
const SOCKET: &str = "/run/absorconnect-secure-lab/control.sock";
struct Active {
    flag: Arc<AtomicU8>,
}
impl Session for Active {
    fn close(&mut self, reason: CloseReason) {
        self.flag.store(
            match reason {
                CloseReason::AuthorizationExpired => 1,
                CloseReason::Revoked => 2,
                _ => 3,
            },
            Ordering::SeqCst,
        );
    }
}
type Agent = RenewingAgent<BootClock, Active>;
fn credentials(name: &str, limit: u64) -> Result<Vec<u8>, ()> {
    let directory = std::env::var_os("CREDENTIALS_DIRECTORY").ok_or(())?;
    if Path::new(&directory) != Path::new("/run/credentials/absorconnect-secure-lab.service") {
        return Err(());
    }
    let path = Path::new(&directory).join(name);
    let m = fs::symlink_metadata(&path).map_err(|_| ())?;
    if !m.is_file()
        || m.is_symlink()
        || m.uid() != 0
        || m.gid() != 0
        || m.mode() & 0o7777 != 0o440
        || m.len() > limit
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| ())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > limit {
        return Err(());
    }
    Ok(bytes)
}
fn native_mode() -> Result<bool, ()> {
    let path = Path::new("/etc/systemd/system/absorconnect-protected-worker-lab.service");
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.is_symlink() && m.uid() == 0 && m.mode() & 0o022 == 0 => {
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        _ => Err(()),
    }
}
fn expected_worker(native: bool) -> Result<u32, ()> {
    let unit = if native {
        "absorconnect-protected-worker-lab.service"
    } else {
        "absorconnect-ipc-worker-lab.service"
    };
    let path = Path::new("/etc/systemd/system").join(unit);
    let m = fs::symlink_metadata(path).map_err(|_| ())?;
    if !m.is_file() || m.is_symlink() || m.uid() != 0 || m.mode() & 0o022 != 0 {
        return Err(());
    }
    let result = Process::new("/usr/bin/timeout")
        .args([
            "1s",
            "/usr/bin/systemctl",
            "show",
            unit,
            "-p",
            "MainPID",
            "--value",
        ])
        .output()
        .map_err(|_| ())?;
    if !result.status.success() || result.stdout.len() > 32 {
        return Err(());
    }
    let id = std::str::from_utf8(&result.stdout)
        .map_err(|_| ())?
        .trim()
        .parse::<u32>()
        .map_err(|_| ())?;
    if id == 0 {
        return Err(());
    }
    Ok(id)
}
fn auth_denied(error: AuthError) -> Reply {
    match error {
        AuthError::Locked { retry_after } => Reply::Denied {
            state: State::Locked,
            retry_after,
        },
        AuthError::WrongPassword => Reply::Denied {
            state: State::WrongProof,
            retry_after: 0,
        },
        AuthError::Storage => Reply::Denied {
            state: State::Storage,
            retry_after: 0,
        },
        _ => Reply::Denied {
            state: State::Invalid,
            retry_after: 0,
        },
    }
}
// Una concesión distinta por autenticación, no solo por arranque del broker.
fn new_grant_instance() -> Result<String, ()> {
    let mut random = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut random))
        .map_err(|_| ())?;
    let value = random
        .iter()
        .flat_map(|v| {
            let h = b"0123456789abcdef";
            [h[(v >> 4) as usize] as char, h[(v & 15) as usize] as char]
        })
        .collect();
    Ok(value)
}
struct Authority {
    agent: Agent,
    verifier: Verifier<ProtectedAttemptStore, WallClock>,
    handle: Option<SessionHandle>,
    flag: Arc<AtomicU8>,
    operations: Arc<AtomicU64>,
    terminal: Option<(Duration, i32)>,
    audit: AuditLog,
    signaling: Option<ApiSignaling>,
    seat_monitor: Option<Monitor<BootClock>>,
    seat: SeatBinding,
    grants: Option<Publisher>,
    grant_failed: bool,
    grant_instance: String,
    boot_id: String,
    worker_identity: Option<WorkerIdentity>,
    last_grant: Duration,
}
impl Authority {
    fn disconnect(&mut self) {
        if let Some(h) = self.handle.take() {
            let _ = self.agent.disconnect(&h);
        }
        self.verifier.cancel();
        self.seat.clear();
        if let Some(publisher) = self.grants.as_mut() {
            if publisher.clear().is_err() {
                self.grant_failed = true;
            }
        }
    }
    fn end_connection(&mut self) {
        self.disconnect();
        if let Some(s) = self.signaling.as_mut() {
            s.reset();
        }
    }
    fn publish_grant(&mut self, now: Duration) -> Result<(), ()> {
        if self.grant_failed {
            return Err(());
        }
        if self.grants.is_none() || now.saturating_sub(self.last_grant) < Duration::from_millis(100)
        {
            return Ok(());
        }
        self.last_grant = now;
        let allowed = self.terminal.is_none()
            && self.flag.load(Ordering::SeqCst) == 0
            && self
                .handle
                .as_ref()
                .is_some_and(|h| self.agent.with_session(h, |_| ()).is_ok());
        let grant = if allowed {
            match (self.seat.pinned_snapshot(), self.worker_identity) {
                (Some(seat), Some(worker)) => Some(
                    Grant::issue(
                        &self.grant_instance,
                        &self.boot_id,
                        u64::try_from(now.as_millis()).map_err(|_| ())?,
                        u64::try_from(
                            self.agent
                                .authorization_deadline()
                                .map_err(|_| ())?
                                .as_millis(),
                        )
                        .map_err(|_| ())?,
                        grant_file::process_identity(std::process::id(), linux::uid())
                            .map_err(|_| ())?,
                        worker,
                        seat,
                    )
                    .map_err(|_| ())?,
                ),
                _ => None,
            }
        } else {
            None
        };
        let publisher = self.grants.as_mut().ok_or(())?;
        if let Some(grant) = grant {
            publisher.publish(&grant).map_err(|_| ())
        } else {
            publisher.clear().map_err(|_| ())
        }
    }
    fn refresh_seat(&mut self) -> Result<(), ()> {
        let Some(monitor) = self.seat_monitor.as_mut() else {
            return Ok(());
        };
        let snapshot = monitor.tick().map_err(|_| ())?.cloned();
        if self.seat.update(snapshot) {
            self.end_connection();
            self.flag.store(3, Ordering::SeqCst);
            self.audit.append(Event::WorkerEnded).map_err(|_| ())?;
        }
        Ok(())
    }
    fn seat_eligible(&self) -> bool {
        self.seat_monitor.is_none() || self.seat.eligible()
    }
    fn state(&mut self) -> State {
        if let Some((_, code)) = self.terminal {
            return if code == 77 {
                State::Revoked
            } else {
                State::Stopped
            };
        }
        match self.flag.load(Ordering::SeqCst) {
            1 => return State::Expired,
            2 => return State::Revoked,
            3 => return State::Stopped,
            _ => (),
        }
        if let Some(h) = self.handle.as_ref() {
            if self.agent.with_session(h, |_| ()).is_ok() {
                return State::Authenticated;
            }
        }
        if self.agent.check_authorization().is_ok() && self.seat_eligible() {
            State::Ready
        } else {
            State::AwaitingApi
        }
    }
    fn status(&mut self) -> Reply {
        Reply::Status {
            state: self.state(),
            operation_count: self.operations.load(Ordering::SeqCst),
            os_operations_enabled: false,
        }
    }
    fn command(&mut self, request: Command) -> Result<Reply, ()> {
        self.refresh_seat()?;
        if matches!(request, Command::Status { .. }) {
            return Ok(self.status());
        }
        if matches!(request, Command::Disconnect { .. }) {
            self.end_connection();
            self.flag.store(0, Ordering::SeqCst);
            self.audit.append(Event::WorkerEnded).map_err(|_| ())?;
            return Ok(self.status());
        }
        if self.terminal.is_some()
            || self.agent.check_authorization().is_err()
            || !self.seat_eligible()
        {
            return Ok(Reply::Denied {
                state: self.state(),
                retry_after: 0,
            });
        }
        if matches!(request, Command::Lease { .. }) {
            let state = self.state();
            let deadline = match self.agent.authorization_deadline() {
                Ok(value) => value,
                Err(_) => {
                    return Ok(Reply::Denied {
                        state: self.state(),
                        retry_after: 0,
                    })
                }
            };
            return Ok(Reply::Lease {
                state,
                deadline_boottime_millis: u64::try_from(deadline.as_millis()).map_err(|_| ())?,
            });
        }
        match request {
            Command::Offer {} => {
                let signaling = self.signaling.as_mut().ok_or(())?;
                match signaling.offer().map_err(|_| ())? {
                    Some(payload) => Ok(Reply::Offer {
                        payload: String::from_utf8(payload).map_err(|_| ())?,
                    }),
                    None => Ok(Reply::Pending {}),
                }
            }
            Command::Answer { payload } => {
                self.signaling
                    .as_mut()
                    .ok_or(())?
                    .answer(payload)
                    .map_err(|_| ())?;
                Ok(Reply::Accepted {})
            }
            Command::Challenge {
                offer_fingerprint,
                answer_fingerprint,
            } => {
                if self.signaling.as_ref().is_some_and(|s| !s.ready_for_auth()) {
                    return Ok(Reply::Pending {});
                }
                if self.handle.is_some() && self.flag.load(Ordering::SeqCst) == 0 {
                    return Ok(Reply::Denied {
                        state: State::Invalid,
                        retry_after: 0,
                    });
                }
                self.disconnect();
                self.flag.store(0, Ordering::SeqCst);
                if self.seat_monitor.is_some() && !self.seat.pin() {
                    return Ok(Reply::Denied {
                        state: State::Stopped,
                        retry_after: 0,
                    });
                }
                let binding = match DtlsBinding::new(offer_fingerprint, answer_fingerprint) {
                    Ok(v) => v,
                    Err(e) => return Ok(auth_denied(e)),
                };
                match self
                    .verifier
                    .begin(binding, "AbsorConnect isolated IPC diagnostic".into())
                {
                    Ok(hello) => {
                        self.audit.append(Event::WorkerStarted).map_err(|_| ())?;
                        Ok(Reply::Hello {
                            payload: serde_json::to_string(&hello).map_err(|_| ())?,
                        })
                    }
                    Err(e) => Ok(auth_denied(e)),
                }
            }
            Command::Authenticate { message } => {
                if self.handle.is_some() || (self.seat_monitor.is_some() && !self.seat.is_pinned())
                {
                    self.end_connection();
                    return Ok(Reply::Denied {
                        state: State::Invalid,
                        retry_after: 0,
                    });
                }
                match self.verifier.authenticate(message.as_bytes()) {
                    Ok(verified) => {
                        let _binding = verified.into_binding();
                        self.grant_instance = new_grant_instance()?;
                        self.handle = Some(
                            self.agent
                                .attach_authenticated(Active {
                                    flag: self.flag.clone(),
                                })
                                .map_err(|_| ())?,
                        );
                        Ok(self.status())
                    }
                    Err(e) => {
                        self.audit.append(Event::WorkerDenied).map_err(|_| ())?;
                        Ok(auth_denied(e))
                    }
                }
            }
            Command::DiagnosticOperation { .. } => {
                let Some(h) = self.handle.as_ref() else {
                    return Ok(Reply::Denied {
                        state: State::Invalid,
                        retry_after: 0,
                    });
                };
                let counter = self.operations.clone();
                if self
                    .agent
                    .with_session(h, |_| counter.fetch_add(1, Ordering::SeqCst))
                    .is_err()
                {
                    return Ok(Reply::Denied {
                        state: self.state(),
                        retry_after: 0,
                    });
                }
                Ok(self.status())
            }
            _ => Err(()),
        }
    }
}
pub fn run() -> Result<i32, ()> {
    let uid = linux::uid();
    let worker_profile = absor_agent_security::profile::WorkerProfile::load().map_err(|_| ())?;
    if uid == 0 || uid == worker_profile.uid() || std::env::args_os().len() != 1 {
        return Err(());
    }
    linux::disable_dumping().map_err(|_| ())?;
    let directory = Path::new(STATE);
    let m = fs::symlink_metadata(directory).map_err(|_| ())?;
    if !m.is_dir() || m.is_symlink() || m.uid() != uid || m.mode() & 0o077 != 0 {
        return Err(());
    }
    let _lock = HostLock::acquire(directory).map_err(|_| ())?;
    if directory.join("terminal").symlink_metadata().is_ok() {
        return Ok(77);
    }
    let parent = Path::new(SOCKET).parent().ok_or(())?;
    let m = fs::symlink_metadata(parent).map_err(|_| ())?;
    if !m.is_dir() || m.is_symlink() || m.uid() != 0 || m.mode() & 0o022 != 0 {
        return Err(());
    }
    let m = fs::symlink_metadata(SOCKET).map_err(|_| ())?;
    if !m.file_type().is_socket()
        || m.uid() != uid
        || m.gid() != worker_profile.gid()
        || m.mode() & 0o7777 != 0o660
    {
        return Err(());
    }
    #[cfg(feature = "ui-status-lab")]
    let ui_profile =
        absor_agent_security::ui_profile::UiProfile::load_optional().map_err(|_| ())?;
    #[cfg(feature = "ui-status-lab")]
    let (listener, ui_listener) = if let Some(profile) = ui_profile {
        if profile.broker_uid != uid {
            return Err(());
        }
        profile.validate_socket().map_err(|_| ())?;
        let mut listeners = linux::activation_listeners(&[
            Path::new(SOCKET),
            Path::new(absor_agent_security::ui_profile::SOCKET),
        ])
        .map_err(|_| ())?;
        let ui = listeners.pop().ok_or(())?;
        (listeners.pop().ok_or(())?, Some(ui))
    } else {
        (
            linux::activation_listener(Path::new(SOCKET)).map_err(|_| ())?,
            None,
        )
    };
    #[cfg(not(feature = "ui-status-lab"))]
    let listener = linux::activation_listener(Path::new(SOCKET)).map_err(|_| ())?;
    let key = WrappingKey::from_bytes(&credentials("wrapping.key", 32)?).map_err(|_| ())?;
    let bundle = secrets::open(&credentials("host.sealed.json", 8192)?, &key).map_err(|_| ())?;
    #[cfg(feature = "ui-status-lab")]
    let public_device_id = bundle.host_id().to_owned();
    let (api, verifier) = bundle
        .into_lab_authority(
            ProtectedAttemptStore::open(directory).map_err(|_| ())?,
            WallClock,
        )
        .map_err(|_| ())?;
    let native = native_mode()?;
    let signaling = native.then(|| ApiSignaling::new(api.signaling(), None));
    let grants = Publisher::open_if_provisioned(linux::gid()).map_err(|_| ())?;
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map_err(|_| ())?
        .trim()
        .to_owned();
    if !absor_agent_linux_session::status::is_boot_id(&boot_id) {
        return Err(());
    }
    let grant_instance = new_grant_instance()?;
    #[cfg(feature = "ui-status-lab")]
    let mut ui_server = match (ui_listener, ui_profile) {
        (Some(listener), Some(profile)) => Some(
            absor_agent_security::ui_server::StatusServer::new(
                listener,
                profile,
                public_device_id,
                new_grant_instance()?,
                boot_id.clone(),
            )
            .map_err(|_| ())?,
        ),
        (None, None) => None,
        _ => return Err(()),
    };
    let mut authority = Authority {
        agent: RenewingAgent::new(BootClock, api),
        verifier,
        handle: None,
        flag: Arc::new(AtomicU8::new(0)),
        operations: Arc::new(AtomicU64::new(0)),
        terminal: None,
        signaling,
        seat_monitor: Some(
            Monitor::new(BootClock, LogindSource::new().map_err(|_| ())?).map_err(|_| ())?,
        ),
        seat: SeatBinding::default(),
        grants,
        grant_failed: false,
        grant_instance,
        boot_id,
        worker_identity: None,
        last_grant: Duration::ZERO,
        audit: AuditLog::open(&directory.join("audit.json")).map_err(|_| ())?,
    };
    authority
        .audit
        .append(Event::BrokerStarted)
        .map_err(|_| ())?;
    let mut peer: Option<FramedPeer> = None;
    let mut last_sequence = 0_u64;
    let mut last_message = Duration::ZERO;
    linux::notify(b"READY=1\nSTATUS=IPC de laboratorio; captura deshabilitada").map_err(|_| ())?;
    loop {
        let now = BootClock.now().map_err(|_| ())?;
        linux::notify(b"WATCHDOG=1").map_err(|_| ())?;
        if authority.terminal.is_none() {
            authority.refresh_seat()?;
            let progress = authority.agent.tick();
            let mut failed = progress.is_err();
            let mut signaling_revoked = false;
            let mut signaling_failed = false;
            if let (Ok(progress), Some(signaling)) = (progress, authority.signaling.as_mut()) {
                let authorized = authority.agent.check_authorization().is_ok()
                    && (authority.seat_monitor.is_none() || authority.seat.eligible());
                if let Err(error) = signaling.poll(progress.requests, authorized) {
                    signaling_revoked = error == ApiError::Revoked;
                    if signaling_revoked {
                        failed = true;
                    } else {
                        signaling_failed = true;
                    }
                }
            }
            if signaling_failed {
                authority.end_connection();
                authority.flag.store(3, Ordering::SeqCst);
                authority
                    .audit
                    .append(Event::WorkerFailed)
                    .map_err(|_| ())?;
            }
            if failed {
                let revoked = signaling_revoked
                    || authority.agent.terminal_error() == Some(ApiError::Revoked);
                authority.verifier.stop();
                authority
                    .audit
                    .append(if revoked {
                        Event::AuthorizationRevoked
                    } else {
                        Event::BrokerFailed
                    })
                    .map_err(|_| ())?;
                linux::private_create(
                    &directory.join("terminal"),
                    b"fresh-local-enrollment-required\n",
                )
                .map_err(|_| ())?;
                authority.terminal = Some((now, if revoked { 77 } else { 78 }));
            }
            if authority.flag.load(Ordering::SeqCst) == 1 && authority.handle.is_some() {
                authority.handle.take();
                authority.verifier.cancel();
                authority
                    .audit
                    .append(Event::AuthorizationExpired)
                    .map_err(|_| ())?;
            }
        }
        if let Some((start, code)) = authority.terminal {
            if now.saturating_sub(start) >= Duration::from_millis(600) {
                return Ok(code);
            }
        }
        let mut lost = false;
        if let Some(p) = peer.as_mut() {
            if now.saturating_sub(last_message) >= Duration::from_secs(3) {
                lost = true;
            }
            match p.poll(now) {
                Ok(Some(raw)) => {
                    let parsed = wire::decode_request(&raw);
                    if let Ok(Request {
                        sequence, command, ..
                    }) = parsed
                    {
                        if last_sequence.checked_add(1) != Some(sequence) {
                            lost = true;
                        } else {
                            last_sequence = sequence;
                            last_message = now;
                            let result = authority.command(command)?;
                            p.send(
                                &serde_json::to_vec(&Response {
                                    v: 1,
                                    sequence,
                                    result,
                                })
                                .map_err(|_| ())?,
                                now,
                            )
                            .map_err(|_| ())?;
                        }
                    } else {
                        lost = true;
                    }
                }
                Ok(None) => (),
                Err(_) => lost = true,
            }
        }
        if lost {
            if authority.handle.is_some() && authority.flag.load(Ordering::SeqCst) == 0 {
                authority
                    .audit
                    .append(Event::WorkerFailed)
                    .map_err(|_| ())?;
            }
            authority.end_connection();
            authority.worker_identity = None;
            peer.take();
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let cred = linux::peer_credentials(&stream).map_err(|_| ())?;
                if peer.is_none()
                    && cred.uid == worker_profile.uid()
                    && cred.gid == worker_profile.gid()
                    && cred.pid == expected_worker(native).unwrap_or(0)
                {
                    authority.worker_identity =
                        Some(grant_file::process_identity(cred.pid, cred.uid).map_err(|_| ())?);
                    peer = Some(FramedPeer::new(stream).map_err(|_| ())?);
                    last_sequence = 0;
                    last_message = now;
                    authority.flag.store(0, Ordering::SeqCst);
                    authority.operations.store(0, Ordering::SeqCst);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(_) => return Err(()),
        }
        #[cfg(feature = "ui-status-lab")]
        if let Some(ui) = ui_server.as_mut() {
            use absor_agent_security::status_wire::BrokerState;
            let status = if authority.terminal.is_some() {
                BrokerState::Revoked
            } else if authority.agent.check_authorization().is_err() {
                BrokerState::ValidationRequired
            } else if authority.handle.is_some() && authority.flag.load(Ordering::SeqCst) == 0 {
                BrokerState::Active
            } else {
                BrokerState::Idle
            };
            ui.poll(BootClock.now().map_err(|_| ())?, status)
                .map_err(|_| ())?;
        }
        authority.publish_grant(BootClock.now().map_err(|_| ())?)?;
        thread::sleep(Duration::from_millis(20));
    }
}
