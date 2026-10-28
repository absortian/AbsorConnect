//! Ensayo sin red: un evento fijo en la ventana propia, solo tras concesión HMAC/API local.
//! No es un receptor de entrada de WebRTC ni un servicio distribuible.
use crate::{
    authority_service::{expected_pid, root_directory, root_file, Profile},
    grant::{Grant, GrantError, ValidatedGrant},
    grant_file,
    input_lease::{FixedEvent, InputLease},
    monitor::Monitor,
    query::LogindSource,
    SessionKind, SessionState, Snapshot,
};
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_security::{linux, uinput::Device};
use serde::Deserialize;
use std::{
    fs,
    os::unix::fs::MetadataExt,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
pub static STAGE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
const OWN: &str = "/opt/absorconnect-input-release-lab";
#[derive(Deserialize, Clone, Copy)]
enum Mode {
    #[serde(rename = "lease-normal-key")]
    NormalKey,
    #[serde(rename = "lease-normal-button")]
    NormalButton,
    #[serde(rename = "lease-hold-key")]
    HoldKey,
    #[serde(rename = "lease-hold-button")]
    HoldButton,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Target {
    mode: Mode,
    window: u64,
    parent_pid: u32,
    parent_net_namespace: String,
}
fn focus() -> Result<(), GrantError> {
    root_file(&format!("{OWN}/probe.py"), 0o555, 32768)?;
    let result = Command::new("/usr/bin/timeout")
        .args([
            "--signal=KILL",
            "0.2s",
            "/usr/bin/python3",
            "-B",
            "-I",
            "/opt/absorconnect-input-release-lab/probe.py",
            "check-focus",
        ])
        .env_clear()
        .env("LC_ALL", "C")
        .env("HOME", "/nonexistent")
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| GrantError)?;
    if result.success() {
        Ok(())
    } else {
        Err(GrantError)
    }
}
fn validate(profile: &Profile, seat: &Snapshot, boot: &str) -> Result<ValidatedGrant, GrantError> {
    let broker = grant_file::process_identity(expected_pid(true)?, profile.broker_uid)?;
    let worker = grant_file::process_identity(expected_pid(false)?, profile.worker_uid)?;
    let raw = grant_file::read(profile.broker_gid)?;
    let now = u64::try_from(BootClock.now().map_err(|_| GrantError)?.as_millis())
        .map_err(|_| GrantError)?;
    Grant::validate(&raw, now, boot, broker, worker, seat)
}
struct Deadline {
    limit: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
}
impl Deadline {
    fn new(limit: u64) -> Self {
        let value = Self {
            limit: Arc::new(AtomicU64::new(limit)),
            stop: Arc::new(AtomicBool::new(false)),
        };
        let limit = value.limit.clone();
        let stop = value.stop.clone();
        // Independiente del actor, llamadas Xlib y consultas de unidades. Al morir,
        // el kernel retira el dispositivo incluso si no se ejecutan destructores.
        thread::spawn(move || {
            let mut previous = Duration::ZERO;
            while !stop.load(Ordering::Acquire) {
                let now = match BootClock.now() {
                    Ok(v) if v >= previous => v,
                    _ => std::process::exit(78),
                };
                previous = now;
                let Ok(millis) = u64::try_from(now.as_millis()) else {
                    std::process::exit(78)
                };
                if millis >= limit.load(Ordering::Acquire) {
                    std::process::exit(78);
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        value
    }
}
impl Drop for Deadline {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}
pub fn run() -> Result<(), GrantError> {
    if linux::uid() != 0 || std::env::args_os().len() != 1 {
        return Err(GrantError);
    }
    STAGE.store(1, Ordering::Relaxed);
    linux::disable_dumping().map_err(|_| GrantError)?;
    for path in ["/opt", OWN, "/opt/absorconnect-seat-authority-lab"] {
        root_directory(path)?;
    }
    if root_file("/run/absorconnect-owned-vm-input-release-probe", 0o400, 128)?
        != b"absorconnect-owned-input-release-v1\n"
    {
        return Err(GrantError);
    }
    STAGE.store(2, Ordering::Relaxed);
    let target: Target =
        serde_json::from_slice(&root_file(&format!("{OWN}/window.json"), 0o400, 512)?)
            .map_err(|_| GrantError)?;
    if target.window <= 1
        || target.parent_pid <= 1
        || !target.parent_net_namespace.starts_with("net:[")
        || !target.parent_net_namespace.ends_with(']')
    {
        return Err(GrantError);
    }
    let parent = fs::metadata(format!("/proc/{}", target.parent_pid)).map_err(|_| GrantError)?;
    if parent.uid() != 0 {
        return Err(GrantError);
    }
    STAGE.store(3, Ordering::Relaxed);
    let profile: Profile = serde_json::from_slice(&root_file(
        "/opt/absorconnect-seat-authority-lab/profile.json",
        0o444,
        256,
    )?)
    .map_err(|_| GrantError)?;
    if profile.broker_uid == 0
        || profile.worker_uid == 0
        || profile.broker_uid == profile.worker_uid
        || profile.broker_gid == 0
        || profile.worker_gid == 0
        || profile.broker_gid == profile.worker_gid
    {
        return Err(GrantError);
    }
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(|_| GrantError)?;
    let boot = boot.trim();
    if !crate::status::is_boot_id(boot) {
        return Err(GrantError);
    }
    STAGE.store(4, Ordering::Relaxed);
    let mut monitor = Monitor::new(BootClock, LogindSource::new().map_err(|_| GrantError)?)
        .map_err(|_| GrantError)?;
    let started = BootClock.now().map_err(|_| GrantError)?;
    let seat = loop {
        if let Some(value) = monitor.tick().map_err(|_| GrantError)? {
            break value.clone();
        }
        if BootClock
            .now()
            .map_err(|_| GrantError)?
            .checked_sub(started)
            .ok_or(GrantError)?
            > Duration::from_secs(3)
        {
            return Err(GrantError);
        }
        thread::sleep(Duration::from_millis(10));
    };
    // Solo la ventana creada por el observador de esta VM, nunca un escritorio de credenciales.
    if seat.kind() != SessionKind::User
        || seat.state() != SessionState::Active
        || seat.locked_hint()
        || seat.display_number() != 0
    {
        return Err(GrantError);
    }
    STAGE.store(5, Ordering::Relaxed);
    let first = validate(&profile, &seat, boot)?;
    focus()?;
    let grant = validate(&profile, &seat, boot)?;
    if !first.same_authorization(&grant) {
        return Err(GrantError);
    }
    let deadline = Deadline::new(grant.deadline_millis());
    STAGE.store(6, Ordering::Relaxed);
    let device = Device::new_fixed_lab().map_err(|_| GrantError)?;
    let mut lease = InputLease::start(BootClock, grant, device).map_err(|_| GrantError)?;
    linux::notify(b"READY=1\nSTATUS=Entrada fija de laboratorio; sin red")
        .map_err(|_| GrantError)?;
    let event = match target.mode {
        Mode::NormalKey | Mode::HoldKey => FixedEvent::KeyA { down: true },
        Mode::NormalButton | Mode::HoldButton => FixedEvent::LeftButton { down: true },
    };
    // El observador espera que Xorg adopte el dispositivo, sin enviar entrada aún.
    STAGE.store(7, Ordering::Relaxed);
    let adopted = BootClock.now().map_err(|_| GrantError)?;
    loop {
        let marker = format!("{OWN}/device-adopted");
        if let Ok(value) = root_file(&marker, 0o400, 128) {
            if value != b"owned-uinput-adopted-v1\n" {
                return Err(GrantError);
            }
            break;
        }
        refresh(&profile, &seat, boot, &mut monitor, &mut lease, &deadline)?;
        if BootClock
            .now()
            .map_err(|_| GrantError)?
            .checked_sub(adopted)
            .ok_or(GrantError)?
            > Duration::from_secs(3)
        {
            return Err(GrantError);
        }
        thread::sleep(Duration::from_millis(20));
    }
    focus()?;
    refresh(&profile, &seat, boot, &mut monitor, &mut lease, &deadline)?;
    STAGE.store(8, Ordering::Relaxed);
    lease.apply(1, event, None).map_err(|_| GrantError)?;
    STAGE.store(9, Ordering::Relaxed);
    let pressed = BootClock.now().map_err(|_| GrantError)?;
    loop {
        refresh(&profile, &seat, boot, &mut monitor, &mut lease, &deadline)?;
        let elapsed = BootClock
            .now()
            .map_err(|_| GrantError)?
            .checked_sub(pressed)
            .ok_or(GrantError)?;
        if elapsed >= Duration::from_secs(12)
            || (matches!(target.mode, Mode::NormalKey | Mode::NormalButton)
                && elapsed >= Duration::from_millis(250))
        {
            break;
        }
        focus()?;
        thread::sleep(Duration::from_millis(20));
    }
    lease.close();
    drop(deadline);
    Ok(())
}
fn refresh(
    profile: &Profile,
    seat: &Snapshot,
    boot: &str,
    monitor: &mut Monitor<BootClock>,
    lease: &mut InputLease<BootClock, Device>,
    deadline: &Deadline,
) -> Result<(), GrantError> {
    if monitor.tick().map_err(|_| GrantError)? != Some(seat) {
        lease.close();
        return Err(GrantError);
    }
    if let Ok(grant) = validate(profile, seat, boot) {
        let limit = grant.deadline_millis();
        lease.observe(Some(grant)).map_err(|_| GrantError)?;
        deadline.limit.store(limit, Ordering::Release);
    } else {
        lease.observe(None).map_err(|_| GrantError)?;
    }
    linux::notify(b"WATCHDOG=1").map_err(|_| GrantError)
}
