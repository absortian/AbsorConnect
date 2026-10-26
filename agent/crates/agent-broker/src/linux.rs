use absor_agent_api::{
    http::{AgentApi, Credential},
    RenewingAgent,
};
use absor_agent_broker::{
    audit::{AuditLog, Event},
    Admission,
};
use absor_agent_core::{
    clock::{BootClock, Clock},
    CloseReason, Denied, Session,
};
use absor_agent_supervisor::Pulse;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::linux::net::SocketAddrExt,
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
        net::{SocketAddr, UnixDatagram},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

pub static STAGE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
fn stage(n: u8) {
    STAGE.store(n, std::sync::atomic::Ordering::Relaxed);
}
const BASE: &str = "/opt/absorconnect-broker-lab";
const STATE: &str = "/var/lib/absorconnect-broker-lab";
const RUNTIME: &str = "/run/absorconnect-broker-lab";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    origin: String,
    credential: String,
}
struct Idle;
impl Session for Idle {
    fn close(&mut self, _: CloseReason) {}
}
struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Archivos locales privados o instalados por root; nunca rutas del controlador.
fn checked(path: &Path, owner: u32, directory: bool, private: bool) -> Result<(), ()> {
    let m = fs::symlink_metadata(path).map_err(|_| ())?;
    if m.uid() != owner
        || m.file_type().is_symlink()
        || m.is_dir() != directory
        || (!directory && !m.is_file())
        || m.mode() & if private { 0o077 } else { 0o022 } != 0
    {
        return Err(());
    }
    Ok(())
}
fn read(path: &Path, limit: u64) -> Result<Vec<u8>, ()> {
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
fn create(path: &Path, bytes: &[u8]) -> Result<(), ()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| ())?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|_| ())
}
fn replace(path: &Path, value: &Value) -> Result<(), ()> {
    let next = path.with_extension("next");
    create(&next, &serde_json::to_vec(value).map_err(|_| ())?)?;
    fs::rename(next, path).map_err(|_| ())?;
    File::open(path.parent().ok_or(())?)
        .and_then(|f| f.sync_all())
        .map_err(|_| ())
}
fn notify(message: &[u8]) -> Result<(), ()> {
    let raw = std::env::var_os("NOTIFY_SOCKET").ok_or(())?;
    use std::os::unix::ffi::OsStrExt;
    let bytes = raw.as_bytes();
    let address = if bytes.first() == Some(&b'@') {
        SocketAddr::from_abstract_name(&bytes[1..])
    } else {
        SocketAddr::from_pathname(Path::new(&raw))
    }
    .map_err(|_| ())?;
    UnixDatagram::unbound()
        .and_then(|s| s.send_to_addr(message, &address))
        .map_err(|_| ())?;
    Ok(())
}
fn terminal() -> Result<(), ()> {
    create(
        &Path::new(STATE).join("terminal"),
        b"fresh-enrollment-required\n",
    )
}
fn execute(config: &Configuration, request: String, serial: u64) -> Result<Value, ()> {
    let directory = Path::new(RUNTIME).join(format!("session-{serial}"));
    fs::create_dir(&directory).map_err(|_| ())?;
    let result = (|| {
        let config_path = directory.join("agent-config.json");
        create(&config_path, &serde_json::to_vec(&json!({"origin": config.origin, "credential": config.credential,
            "stateDirectory":format!("{STATE}/rust-agent-state"), "apiSignaling":true, "nativeFixture":true,
            "requestId":request})).map_err(|_| ())?)?;
        let output = directory.join("transport-result.json");
        let stdout = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&output)
            .map_err(|_| ())?;
        let stderr = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join("transport-stderr.txt"))
            .map_err(|_| ())?;
        let mut child = Owned(
            Command::new(format!("{BASE}/absor_connect_probe/absor-lab-supervisor"))
                .args([
                    directory.join("supervisor-events.jsonl"),
                    PathBuf::from(format!(
                        "{BASE}/out/AbsorLinuxProbe/rust_video_channel_check"
                    )),
                    directory.join("unused-offer.sdp"),
                    directory.join("unused-answer.sdp"),
                    config_path,
                ])
                .env("ABSOR_LAB_BROKER_WATCH", "1")
                .stdin(Stdio::piped())
                .stdout(stdout)
                .stderr(stderr)
                .spawn()
                .map_err(|_| ())?,
        );
        let mut pipe = child.0.stdin.take().ok_or(())?;
        let start = BootClock.now().map_err(|_| ())?;
        let mut previous = start;
        let mut next = start;
        let mut sequence = 0_u64;
        loop {
            if let Some(status) = child.0.try_wait().map_err(|_| ())? {
                if !status.success() {
                    return Ok(json!({"workerFailed":true,"exitCode":status.code()}));
                }
                let result: Value =
                    serde_json::from_slice(&read(&output, 16384)?).map_err(|_| ())?;
                if !result.is_object() {
                    return Err(());
                }
                return Ok(result);
            }
            let now = BootClock.now().map_err(|_| ())?;
            if now < previous || now.saturating_sub(start) >= Duration::from_secs(65) {
                return Err(());
            }
            previous = now;
            if now >= next {
                sequence = sequence.checked_add(1).ok_or(())?;
                pipe.write_all(
                    Pulse::new(sequence, now)
                        .map_err(|_| ())?
                        .encode()
                        .as_bytes(),
                )
                .map_err(|_| ())?;
                notify(b"WATCHDOG=1")?;
                next = now.checked_add(Duration::from_millis(100)).ok_or(())?;
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    // La configuración por sesión desaparece también al terminar con error.
    fs::remove_dir_all(directory).map_err(|_| ())?;
    result
}
pub fn run() -> Result<i32, ()> {
    stage(1);
    if std::env::args_os().len() != 1 {
        return Err(());
    }
    // Identidad única del laboratorio. No instalar este ejecutable en otros hosts.
    let uid = fs::metadata("/proc/self").map_err(|_| ())?.uid();
    if uid != 1000 {
        return Err(());
    }
    for directory in [
        "/opt",
        BASE,
        &format!("{BASE}/out"),
        &format!("{BASE}/out/AbsorLinuxProbe"),
        &format!("{BASE}/absor_connect_probe"),
    ] {
        checked(Path::new(directory), 0, true, false)?;
    }
    stage(2);
    for binary in [
        format!("{BASE}/out/AbsorLinuxProbe/rust_video_channel_check"),
        format!("{BASE}/absor_connect_probe/absor-lab-supervisor"),
        format!("{BASE}/absor_connect_probe/libabsor_agent_webrtc_lab.so"),
    ] {
        checked(Path::new(&binary), 0, false, false)?;
    }
    checked(Path::new(STATE), uid, true, true)?;
    checked(Path::new(RUNTIME), uid, true, true)?;
    if Path::new(STATE).join("terminal").symlink_metadata().is_ok() {
        return Ok(77);
    }
    stage(3);
    let credentials = PathBuf::from(std::env::var_os("CREDENTIALS_DIRECTORY").ok_or(())?);
    if credentials != Path::new("/run/credentials/absorconnect-broker-lab.service") {
        return Err(());
    }
    let credential = credentials.join("agent.json");
    // systemd 255 entrega root:root 0440 con ACL para el UID del servicio
    // en un montaje de solo lectura; no es un fichero 0600 del usuario.
    let meta = fs::symlink_metadata(&credential).map_err(|_| ())?;
    if !meta.is_file()
        || meta.is_symlink()
        || meta.uid() != 0
        || meta.gid() != 0
        || meta.mode() & 0o7777 != 0o440
    {
        return Err(());
    }
    let config: Configuration =
        serde_json::from_slice(&read(&credential, 4096)?).map_err(|_| ())?;
    let api = AgentApi::local_lab(
        &config.origin,
        Credential::new(config.credential.clone()).map_err(|_| ())?,
    )
    .map_err(|_| ())?;
    stage(4);
    let state = Path::new(STATE).join("rust-agent-state");
    if !state.exists() {
        fs::create_dir(&state).map_err(|_| ())?;
        create(&state.join("absor-webrtc-lab"), b"synthetic-only")?;
        create(
            &state.join("attempts.json"),
            br#"{"schema":1,"failures":[],"locked_until":null,"last_seen":0}"#,
        )?;
    }
    checked(&state, uid, true, true)?;
    let mut audit = AuditLog::open(&Path::new(STATE).join("audit.json")).map_err(|_| ())?;
    audit.append(Event::BrokerStarted).map_err(|_| ())?;
    let mut agent: RenewingAgent<_, Idle> = RenewingAgent::new(BootClock, api);
    let mut admission = Admission::default();
    let mut completed = 0_u64;
    stage(5);
    notify(b"READY=1\nSTATUS=Laboratorio listo; sin autorizacion de captura")?;
    replace(
        &Path::new(RUNTIME).join("status.json"),
        &json!({"schema":1,"completedSessions":completed,"fixtureOnly":true,"readyForUnattended":false}),
    )?;
    stage(6);
    loop {
        notify(b"WATCHDOG=1")?;
        let progress = match agent.tick() {
            Ok(p) => p,
            Err(error) => {
                admission.stop();
                audit
                    .append(if error == Denied::Stopped {
                        Event::AuthorizationDenied
                    } else {
                        Event::BrokerFailed
                    })
                    .map_err(|_| ())?;
                terminal()?;
                return Ok(77);
            }
        };
        if progress.validation == Some(Ok(())) && agent.check_authorization().is_ok() {
            let ids: Vec<_> = progress.requests.into_iter().map(|v| v.id).collect();
            if let Some(request) = admission.select(&ids) {
                // Durante execute no hay consultas del broker. El trabajador obtiene
                // autorización API NUEVA y verifica DTLS/v1 antes de abrir X11.
                let serial = completed.checked_add(1).ok_or(())?;
                stage(7);
                audit.append(Event::WorkerStarted).map_err(|_| ())?;
                let result = match execute(&config, request, serial) {
                    Ok(value) => value,
                    Err(()) => {
                        let _ = audit.append(Event::BrokerFailed);
                        return Err(());
                    }
                };
                let event = if result.get("workerFailed").and_then(Value::as_bool) == Some(true) {
                    Event::WorkerFailed
                } else if result.get("apiCutCode").and_then(Value::as_i64) == Some(-1) {
                    Event::AuthorizationExpired
                } else if result.get("apiCutCode").and_then(Value::as_i64) == Some(-2) {
                    Event::AuthorizationRevoked
                } else if result
                    .get("apiCutCode")
                    .and_then(Value::as_i64)
                    .is_some_and(|v| v < 0)
                {
                    Event::WorkerFailed
                } else if result.get("authenticated").and_then(Value::as_bool) != Some(true) {
                    Event::WorkerDenied
                } else {
                    Event::WorkerEnded
                };
                audit.append(event).map_err(|_| ())?;
                replace(
                    &Path::new(STATE).join("last-session.json"),
                    &json!({"serial":serial,"result":result}),
                )?;
                completed = serial;
                admission.finished();
                stage(6);
                replace(
                    &Path::new(RUNTIME).join("status.json"),
                    &json!({"schema":1,"completedSessions":completed,"fixtureOnly":true,"readyForUnattended":false}),
                )?;

                if result.get("workerFailed").and_then(Value::as_bool) == Some(true) {
                    // No admitir otro trabajador si murió el supervisor: systemd
                    // limpia TODOS los descendientes del cgroup antes de reiniciar.
                    return Ok(75);
                }
                if result.get("apiCutCode").and_then(Value::as_i64) == Some(-2) {
                    terminal()?;
                    return Ok(77);
                }
            }
        }
        thread::sleep(
            progress
                .next_wake
                .max(Duration::from_millis(20))
                .min(Duration::from_millis(100)),
        );
    }
}
