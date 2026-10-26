use super::signaling::ApiSignaling;
use absor_agent_api::{
    http::{AgentApi, Credential},
    RenewingAgent,
};
use absor_agent_auth::{
    AttemptClock, AttemptState, AttemptStore, AuthError, DtlsBinding, Verifier,
};
use absor_agent_core::{clock::BootClock, CloseReason, Denied, Session, SessionHandle};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

// Datos públicos del vector compartido. Este diagnóstico no acepta K del propietario.
const KEY: &str = "T/Ffxp4GTajIgqtVcHNXZtYMdnBBQF0IbEnYU8WgO70=";
const SALT: &str = "c2FsdC1maWpvLTE2LWJ5dA==";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    origin: String,
    credential: String,
    #[serde(rename = "stateDirectory")]
    state_directory: PathBuf,
    #[serde(default, rename = "apiSignaling")]
    api_signaling: bool,
    #[serde(default, rename = "nativeFixture")]
    native_fixture: bool,
}
struct WallClock;
impl AttemptClock for WallClock {
    fn unix_millis(&self) -> Result<u64, AuthError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|v| u64::try_from(v.as_millis()).ok())
            .ok_or(AuthError::Clock)
    }
}

// Solo un directorio privado marcado por el lanzador. No es un almacén certificado del SO.
struct LabStore(PathBuf);
impl LabStore {
    fn open(path: PathBuf) -> Result<Self, ()> {
        if !path.is_absolute()
            || path.file_name().and_then(|v| v.to_str()) != Some("rust-agent-state")
        {
            return Err(());
        }
        let meta = fs::symlink_metadata(&path).map_err(|_| ())?;
        if !meta.is_dir() || meta.is_symlink() {
            return Err(());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o077 != 0 {
                return Err(());
            }
        }
        if fs::read(path.join("absor-webrtc-lab")).map_err(|_| ())? != b"synthetic-only" {
            return Err(());
        }
        Ok(Self(path))
    }
}
impl AttemptStore for LabStore {
    fn load(&mut self) -> Result<AttemptState, AuthError> {
        let path = self.0.join("attempts.json");
        let meta = fs::symlink_metadata(&path).map_err(|_| AuthError::Storage)?;
        if !meta.is_file() || meta.is_symlink() || meta.len() > 4096 {
            return Err(AuthError::Storage);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o077 != 0 {
                return Err(AuthError::Storage);
            }
        }
        let mut bytes = vec![];
        File::open(path)
            .map_err(|_| AuthError::Storage)?
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| AuthError::Storage)?;
        if bytes.len() > 4096 {
            return Err(AuthError::Storage);
        }
        serde_json::from_slice(&bytes).map_err(|_| AuthError::Storage)
    }
    fn commit(&mut self, state: &AttemptState) -> Result<(), AuthError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let temp = self.0.join("attempts.next");
        let mut file = options.open(&temp).map_err(|_| AuthError::Storage)?;
        file.write_all(&serde_json::to_vec(state).map_err(|_| AuthError::Storage)?)
            .map_err(|_| AuthError::Storage)?;
        file.sync_all().map_err(|_| AuthError::Storage)?;
        drop(file);
        fs::rename(temp, self.0.join("attempts.json")).map_err(|_| AuthError::Storage)?;
        #[cfg(unix)]
        {
            File::open(&self.0)
                .and_then(|v| v.sync_all())
                .map_err(|_| AuthError::Storage)?;
        }
        Ok(())
    }
}

struct Active {
    flag: Arc<AtomicU8>,
    #[cfg(all(
        feature = "native-fixture",
        target_os = "linux",
        target_pointer_width = "64"
    ))]
    native: Option<absor_agent_x11_lab::FixtureWorker>,
}
impl Session for Active {
    fn close(&mut self, reason: CloseReason) {
        #[cfg(all(
            feature = "native-fixture",
            target_os = "linux",
            target_pointer_width = "64"
        ))]
        if let Some(worker) = self.native.as_mut() {
            worker.close(reason);
        }
        self.flag.store(
            if reason == CloseReason::AuthorizationExpired {
                2
            } else if reason == CloseReason::Revoked {
                3
            } else {
                4
            },
            Ordering::SeqCst,
        );
    }
}
pub(crate) struct Bridge {
    renewal: RenewingAgent<BootClock, Active>,
    verifier: Verifier<LabStore, WallClock>,
    active: Arc<AtomicU8>,
    handle: Option<SessionHandle>,
    had_authorization: bool,
    signaling: Option<ApiSignaling>,
    #[cfg(all(
        feature = "native-fixture",
        target_os = "linux",
        target_pointer_width = "64"
    ))]
    native_fixture: bool,
    #[cfg(all(
        feature = "native-fixture",
        target_os = "linux",
        target_pointer_width = "64"
    ))]
    native: super::native::NativeState,
}
impl Bridge {
    pub(crate) fn new(raw: &[u8]) -> Result<Self, ()> {
        let config: Configuration = serde_json::from_slice(raw).map_err(|_| ())?;
        if config.native_fixture
            && (!cfg!(all(
                feature = "native-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            )) || !config.api_signaling)
        {
            return Err(());
        }
        let store = LabStore::open(config.state_directory)?;
        let key: [u8; 32] = STANDARD
            .decode(KEY)
            .map_err(|_| ())?
            .try_into()
            .map_err(|_| ())?;
        let verifier = Verifier::new(&key, SALT, 600_000, store, WallClock).map_err(|_| ())?;
        let api = AgentApi::local_lab(
            &config.origin,
            Credential::new(config.credential).map_err(|_| ())?,
        )
        .map_err(|_| ())?;
        let signaling = config
            .api_signaling
            .then(|| ApiSignaling::new(api.signaling()));
        Ok(Self {
            renewal: RenewingAgent::new(BootClock, api),
            verifier,
            active: Arc::new(AtomicU8::new(0)),
            handle: None,
            had_authorization: false,
            signaling,
            #[cfg(all(
                feature = "native-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            native_fixture: config.native_fixture,
            #[cfg(all(
                feature = "native-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            native: super::native::NativeState::default(),
        })
    }
    // 0 esperando primera API, 1 autorizado sin autenticar, 2 sesión activa;
    // -1 caducada, -2 revocada, -3 detenida/error. Un corte nunca se reactiva.
    pub(crate) fn poll(&mut self) -> i32 {
        match self.active.load(Ordering::SeqCst) {
            2 => return -1,
            3 => return -2,
            4 => return -3,
            _ => (),
        }
        let progress = match self.renewal.tick() {
            Ok(value) => value,
            Err(_) => {
                self.verifier.stop();
                return if self.active.load(Ordering::SeqCst) == 3 {
                    -2
                } else {
                    -3
                };
            }
        };
        if let Some(signaling) = self.signaling.as_mut() {
            let authorized = self.renewal.check_authorization().is_ok();
            if let Err(error) = signaling.poll(progress.requests, authorized) {
                self.verifier.stop();
                self.renewal.stop();
                let revoked = error == absor_agent_api::http::ApiError::Revoked;
                self.active
                    .store(if revoked { 3 } else { 4 }, Ordering::SeqCst);
                return if revoked { -2 } else { -3 };
            }
        }
        // tick puede caducar la sesión y aceptar una respuesta tardía en la misma
        // llamada. Una concesión nueva nunca rehabilita ese transporte ya cerrado.
        match self.active.load(Ordering::SeqCst) {
            2 => return -1,
            3 => return -2,
            4 => return -3,
            _ => (),
        }
        match self.renewal.check_authorization() {
            Ok(()) => {
                self.had_authorization = true;
                if let Some(handle) = self.handle.as_ref() {
                    if self.renewal.with_session(handle, |_| ()).is_err() {
                        return -3;
                    }
                    2
                } else {
                    1
                }
            }
            Err(Denied::NoAuthorization) if !self.had_authorization => 0,
            Err(Denied::NoAuthorization) => {
                self.verifier.stop();
                self.active.store(2, Ordering::SeqCst);
                -1
            }
            Err(_) => {
                self.verifier.stop();
                -3
            }
        }
    }
    pub(crate) fn hello(&mut self, offer: String, answer: String) -> Result<Option<Vec<u8>>, ()> {
        if self.poll() != 1 {
            return Err(());
        }
        if self.signaling.as_ref().is_some_and(|s| !s.ready_for_auth()) {
            return Ok(None);
        }
        let binding = DtlsBinding::new(offer, answer).map_err(|_| ())?;
        let hello = self
            .verifier
            .begin(binding, "Host Rust/WebRTC de laboratorio".into())
            .map_err(|_| ())?;
        serde_json::to_vec(&hello).map(Some).map_err(|_| ())
    }
    pub(crate) fn offer(&mut self) -> Result<Option<Vec<u8>>, ()> {
        if self.poll() != 1 {
            return Ok(None);
        }
        self.signaling.as_mut().ok_or(())?.offer().map_err(|_| ())
    }
    pub(crate) fn answer(&mut self, answer: String) -> Result<(), ()> {
        if self.poll() != 1 {
            return Err(());
        }
        self.signaling
            .as_mut()
            .ok_or(())?
            .answer(answer)
            .map_err(|_| ())
    }
    pub(crate) fn authenticate(&mut self, raw: &[u8]) -> i32 {
        if self.poll() != 1 {
            return -3;
        }
        let verified = match self.verifier.authenticate(raw) {
            Ok(value) => value,
            Err(AuthError::WrongPassword) => return 0,
            Err(_) => {
                self.renewal.stop();
                return -3;
            }
        };
        // Un Bridge pertenece a una sola PeerConnection en el llamador C++.
        #[cfg(all(
            feature = "native-fixture",
            target_os = "linux",
            target_pointer_width = "64"
        ))]
        let native = if self.native_fixture {
            let worker = absor_agent_x11_lab::FixtureWorker::authenticated(verified);
            self.native.closed = Some(worker.closed_observer());
            Some(worker)
        } else {
            let _binding = verified.into_binding();
            None
        };
        #[cfg(not(all(
            feature = "native-fixture",
            target_os = "linux",
            target_pointer_width = "64"
        )))]
        let _binding = verified.into_binding();
        match self.renewal.attach_authenticated(Active {
            flag: self.active.clone(),
            #[cfg(all(
                feature = "native-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            native,
        }) {
            Ok(handle) => {
                self.handle = Some(handle);
                self.active.store(1, Ordering::SeqCst);
                if self.poll() == 2 {
                    #[cfg(all(
                        feature = "native-fixture",
                        target_os = "linux",
                        target_pointer_width = "64"
                    ))]
                    if self.native_fixture {
                        let started = self
                            .renewal
                            .with_session(self.handle.as_ref().unwrap(), |session| {
                                session.native.as_mut().ok_or(())?.start().map_err(|_| ())
                            });
                        if !matches!(started, Ok(Ok(()))) {
                            self.renewal.stop();
                            self.verifier.stop();
                            self.active.store(4, Ordering::SeqCst);
                            return -3;
                        }
                    }
                    1
                } else {
                    -3
                }
            }
            Err(_) => -3,
        }
    }

    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_frame(&mut self) -> Result<Option<Vec<u8>>, ()> {
        if self.poll() != 2 {
            return Err(());
        }
        #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
        {
            use super::native::Phase;
            use absor_agent_x11_lab::{Operation, Reply};
            if !self.native_fixture {
                return Err(());
            }
            let handle = self.handle.as_ref().ok_or(())?;
            let state = &mut self.native;
            let result = self.renewal.with_session(handle, |session| {
                let worker = session.native.as_mut().ok_or(())?;
                let mut frame = None;
                if let Some(reply) = worker.poll().map_err(|code| {
                    state.error = Some(code);
                })? {
                    match (&state.phase, reply) {
                        (Phase::Boot, Reply::Ready) => (),
                        (Phase::Capture, Reply::Frame(value))
                            if value.width == 320
                                && value.height == 180
                                && value.rgb.len() == 172_800 =>
                        {
                            frame = Some(value.rgb);
                        }
                        (Phase::Pulse, Reply::Input(counts)) => state.counts = Some(counts),
                        _ => return Err(()),
                    }
                    state.phase = Phase::Idle;
                }
                if state.phase == Phase::Idle {
                    let operation = if state.input_queued {
                        state.input_queued = false;
                        state.phase = Phase::Pulse;
                        Operation::Pulse
                    } else {
                        state.phase = Phase::Capture;
                        Operation::Capture
                    };
                    worker.submit(operation).map_err(|_| ())?;
                }
                Ok(frame)
            });
            if let Ok(Ok(frame)) = result {
                return Ok(frame);
            }
            self.verifier.stop();
            self.renewal.stop();
            self.active.store(4, Ordering::SeqCst);
        }
        Err(())
    }

    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_input(&mut self, raw: &[u8]) -> Result<(), ()> {
        if self.poll() != 2 {
            return Err(());
        }
        #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
        {
            if !self.native_fixture || self.native.phase == super::native::Phase::Boot {
                return Err(());
            }
            let next = super::native::next_step(self.native.input_step, raw)?;
            let handle = self.handle.as_ref().ok_or(())?;
            self.renewal.with_session(handle, |_| ()).map_err(|_| ())?;
            self.native.input_step = next;
            if next == 4 {
                self.native.input_queued = true;
            }
            Ok(())
        }
        #[cfg(not(all(target_os = "linux", target_pointer_width = "64")))]
        let _ = raw;
        #[cfg(not(all(target_os = "linux", target_pointer_width = "64")))]
        Err(())
    }

    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_status(&self) -> Vec<u8> {
        #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
        {
            let (opens, captures, inputs) = absor_agent_x11_lab::native_attempts();
            let counts = self.native.counts.as_ref();
            serde_json::to_vec(&serde_json::json!({
                "opens":opens,"captures":captures,"inputs":inputs,
                "closed":self.native.closed.as_ref().is_some_and(|v| v.load(Ordering::Acquire)),
                "errorCode":self.native.error,
                "mouseDown":counts.map_or(0, |v| v.mouse_down),
                "mouseUp":counts.map_or(0, |v| v.mouse_up),
                "keyDown":counts.map_or(0, |v| v.key_down),
                "keyUp":counts.map_or(0, |v| v.key_up)
            }))
            .unwrap_or_default()
        }
        #[cfg(not(all(target_os = "linux", target_pointer_width = "64")))]
        b"{}".to_vec()
    }
}
