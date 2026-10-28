//! Proveedor optativo solo para VM propia. Sin IP, shell o rutas elegidas por un solicitante.
use crate::{
    grant::{Grant, GrantError},
    grant_file,
    monitor::Monitor,
    query::LogindSource,
    xauthority,
};
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_security::{fd, linux};
use serde::Deserialize;
use std::{
    fs::{self, File},
    io::Read,
    os::unix::{
        fs::{FileTypeExt, MetadataExt},
        net::UnixStream,
    },
    path::Path,
    process::Command,
    thread,
    time::Duration,
};
const OPT: &str = "/opt/absorconnect-seat-authority-lab";
const SOCKET: &str = "/run/absorconnect-seat-authority-lab/authority.sock";
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Profile {
    broker_uid: u32,
    broker_gid: u32,
    worker_uid: u32,
    worker_gid: u32,
}
fn root_directory(path: &str) -> Result<(), GrantError> {
    let m = fs::symlink_metadata(path).map_err(|_| GrantError)?;
    if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
        return Err(GrantError);
    }
    Ok(())
}
fn root_file(path: &str, mode: u32, limit: u64) -> Result<Vec<u8>, GrantError> {
    let m = fs::symlink_metadata(path).map_err(|_| GrantError)?;
    if !m.is_file()
        || m.uid() != 0
        || m.nlink() != 1
        || m.mode() & 0o7777 != mode
        || m.len() > limit
    {
        return Err(GrantError);
    }
    let file = File::open(path).map_err(|_| GrantError)?;
    let opened = file.metadata().map_err(|_| GrantError)?;
    if m.ino() != opened.ino() || m.dev() != opened.dev() {
        return Err(GrantError);
    }
    let mut value = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut value)
        .map_err(|_| GrantError)?;
    if value.len() as u64 > limit {
        return Err(GrantError);
    }
    Ok(value)
}
fn expected_pid(broker: bool) -> Result<u32, GrantError> {
    let name = if broker {
        "absorconnect-secure-lab.service"
    } else {
        "absorconnect-ipc-worker-lab.service"
    };
    let unit = format!("/etc/systemd/system/{name}");
    root_file(&unit, 0o644, 8192)?;
    let result = Command::new("/usr/bin/timeout")
        .args([
            "--kill-after=0.1s",
            "1s",
            "/usr/bin/systemctl",
            "show",
            name,
            "-p",
            "MainPID",
            "--value",
        ])
        .env_clear()
        .env("LC_ALL", "C")
        .current_dir("/")
        .output()
        .map_err(|_| GrantError)?;
    if !result.status.success() || result.stdout.len() > 32 {
        return Err(GrantError);
    }
    let pid = std::str::from_utf8(&result.stdout)
        .map_err(|_| GrantError)?
        .trim()
        .parse::<u32>()
        .map_err(|_| GrantError)?;
    if pid <= 1 {
        return Err(GrantError);
    }
    Ok(pid)
}
fn deliver(
    stream: &mut UnixStream,
    profile: &Profile,
    monitor: &mut Monitor<BootClock>,
    boot_id: &str,
) -> Result<(), GrantError> {
    let credentials = linux::peer_credentials(stream).map_err(|_| GrantError)?;
    if credentials.uid != profile.worker_uid
        || credentials.gid != profile.worker_gid
        || credentials.pid != expected_pid(false)?
    {
        return Err(GrantError);
    }
    stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|_| GrantError)?;
    stream
        .set_write_timeout(Some(Duration::from_millis(50)))
        .map_err(|_| GrantError)?;
    let mut request = [0; 2];
    if stream.read(&mut request).map_err(|_| GrantError)? != 1 || request[0] != b'G' {
        return Err(GrantError);
    }
    let selected = monitor
        .tick()
        .map_err(|_| GrantError)?
        .cloned()
        .ok_or(GrantError)?;
    let worker = grant_file::process_identity(credentials.pid, credentials.uid)?;
    let broker = grant_file::process_identity(expected_pid(true)?, profile.broker_uid)?;
    let raw = grant_file::read(profile.broker_gid)?;
    let now = u64::try_from(BootClock.now().map_err(|_| GrantError)?.as_millis())
        .map_err(|_| GrantError)?;
    Grant::validate(&raw, now, boot_id, broker, worker, &selected)?;
    for dir in ["/run/lightdm", "/run/lightdm/root"] {
        root_directory(dir)?;
    }
    // Ruta cerrada de LightDM; el display procede del lector local, nunca del mensaje.
    let mut raw = root_file(
        &format!("/run/lightdm/root/:{}", selected.display_number()),
        0o600,
        65536,
    )?;
    let mut secret = xauthority::cookie(&raw, selected.display_number())?;
    raw.fill(0);
    let mut payload = [0u8; 24];
    payload[..4].copy_from_slice(b"AXA1");
    payload[4..8].copy_from_slice(&u32::from(selected.display_number()).to_be_bytes());
    payload[8..].copy_from_slice(&secret);
    secret.fill(0);
    let authority = fd::sealed_file(&payload).map_err(|_| GrantError)?;
    payload.fill(0);
    // Volver a comprobar el proceso, asiento y concesión justo antes de entregar el fd.
    if monitor.tick().map_err(|_| GrantError)? != Some(&selected)
        || grant_file::process_identity(credentials.pid, credentials.uid)? != worker
    {
        return Err(GrantError);
    }
    let now = u64::try_from(BootClock.now().map_err(|_| GrantError)?.as_millis())
        .map_err(|_| GrantError)?;
    Grant::validate(
        &grant_file::read(profile.broker_gid)?,
        now,
        boot_id,
        grant_file::process_identity(expected_pid(true)?, profile.broker_uid)?,
        worker,
        &selected,
    )?;
    fd::send(stream, &authority).map_err(|_| GrantError)
}
pub fn run() -> Result<(), GrantError> {
    if linux::uid() != 0 || std::env::args_os().len() != 1 {
        return Err(GrantError);
    }
    linux::disable_dumping().map_err(|_| GrantError)?;
    for path in ["/opt", OPT, "/run", grant_file::DIRECTORY] {
        root_directory(path)?;
    }
    if root_file("/run/absorconnect-owned-vm-lab", 0o444, 128)?
        != b"absorconnect-native-window-fixture-v1\n"
    {
        return Err(GrantError);
    }
    let profile: Profile =
        serde_json::from_slice(&root_file(&format!("{OPT}/profile.json"), 0o444, 256)?)
            .map_err(|_| GrantError)?;
    if profile.broker_gid == profile.worker_gid
        || profile.broker_gid == 0
        || profile.worker_gid == 0
        || profile.broker_uid == 0
        || profile.worker_uid == 0
        || profile.broker_uid == profile.worker_uid
    {
        return Err(GrantError);
    }
    let m = fs::symlink_metadata(SOCKET).map_err(|_| GrantError)?;
    if !m.file_type().is_socket()
        || m.uid() != 0
        || m.gid() != profile.worker_gid
        || m.mode() & 0o7777 != 0o660
    {
        return Err(GrantError);
    }
    let listener = linux::activation_listener(Path::new(SOCKET)).map_err(|_| GrantError)?;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(|_| GrantError)?;
    let boot = boot.trim();
    if !crate::status::is_boot_id(boot) {
        return Err(GrantError);
    }
    let mut monitor = Monitor::new(BootClock, LogindSource::new().map_err(|_| GrantError)?)
        .map_err(|_| GrantError)?;
    linux::notify(b"READY=1\nSTATUS=Autoridad X11 optativa de laboratorio")
        .map_err(|_| GrantError)?;
    let mut watchdog = BootClock.now().map_err(|_| GrantError)?;
    loop {
        monitor.tick().map_err(|_| GrantError)?;
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = deliver(&mut stream, &profile, &mut monitor, boot);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(_) => return Err(GrantError),
        }
        let now = BootClock.now().map_err(|_| GrantError)?;
        if now < watchdog {
            return Err(GrantError);
        }
        if now - watchdog >= Duration::from_millis(200) {
            linux::notify(b"WATCHDOG=1").map_err(|_| GrantError)?;
            watchdog = now;
        }
        thread::sleep(Duration::from_millis(10));
    }
}
