//! Supervisor de selección. No tiene red IP, captura, entrada, secretos ni RPC administrativos.
use crate::{
    monitor::Monitor,
    query::LogindSource,
    status::{is_boot_id, SeatState, Status},
    Fault,
};
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_security::linux::{uid, HostLock};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        linux::net::SocketAddrExt,
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
            net::{SocketAddr, UnixDatagram},
        },
    },
    path::Path,
    thread,
    time::Duration,
};
const DIRECTORY: &str = "/run/absorconnect-sessiond";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceError {
    Configuration,
    Temporary,
}
fn millis(value: Duration) -> Result<u64, ServiceError> {
    u64::try_from(value.as_millis()).map_err(|_| ServiceError::Configuration)
}
fn notify(bytes: &[u8]) -> Result<(), ServiceError> {
    let raw = std::env::var_os("NOTIFY_SOCKET").ok_or(ServiceError::Configuration)?;
    let bytes_address = raw.as_bytes();
    let address = if bytes_address.first() == Some(&b'@') {
        SocketAddr::from_abstract_name(&bytes_address[1..])
    } else {
        SocketAddr::from_pathname(Path::new(&raw))
    }
    .map_err(|_| ServiceError::Configuration)?;
    let socket = UnixDatagram::unbound().map_err(|_| ServiceError::Temporary)?;
    socket
        .set_write_timeout(Some(Duration::from_millis(50)))
        .map_err(|_| ServiceError::Temporary)?;
    socket
        .send_to_addr(bytes, &address)
        .map_err(|_| ServiceError::Temporary)?;
    Ok(())
}
fn publish(bytes: &[u8]) -> Result<(), ServiceError> {
    if bytes.len() > 1024 {
        return Err(ServiceError::Configuration);
    }
    let temporary = Path::new(DIRECTORY).join("status.next");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o444)
        .open(&temporary)
        .map_err(|_| ServiceError::Configuration)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.set_permissions(fs::Permissions::from_mode(0o444))?;
        file.sync_all()?;
        fs::rename(&temporary, Path::new(DIRECTORY).join("status.json"))?;
        File::open(DIRECTORY)?.sync_all()
    })()
    .map_err(|_: std::io::Error| ServiceError::Configuration);
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
pub fn run() -> Result<(), ServiceError> {
    if uid() != 0 || std::env::args_os().len() != 1 {
        return Err(ServiceError::Configuration);
    }
    for path in ["/run", DIRECTORY] {
        let m = fs::symlink_metadata(path).map_err(|_| ServiceError::Configuration)?;
        if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
            return Err(ServiceError::Configuration);
        }
    }
    let _lock = HostLock::acquire(Path::new(DIRECTORY)).map_err(|_| ServiceError::Configuration)?;
    // Un temporal propio de un proceso muerto no debe impedir la recuperación de la unidad.
    let temporary = Path::new(DIRECTORY).join("status.next");
    if let Ok(m) = fs::symlink_metadata(&temporary) {
        if !m.is_file() || m.uid() != 0 || m.nlink() != 1 || m.mode() & 0o222 != 0 {
            return Err(ServiceError::Configuration);
        }
        fs::remove_file(&temporary).map_err(|_| ServiceError::Configuration)?;
    }
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map_err(|_| ServiceError::Configuration)?;
    let boot = boot.trim();
    if !is_boot_id(boot) {
        return Err(ServiceError::Configuration);
    }
    let mut random = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut random))
        .map_err(|_| ServiceError::Configuration)?;
    let mut instance = String::with_capacity(32);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in random {
        instance.push(HEX[(byte >> 4) as usize] as char);
        instance.push(HEX[(byte & 15) as usize] as char);
    }
    let clock = BootClock;
    let mut monitor = Monitor::new(
        clock,
        LogindSource::new().map_err(|_| ServiceError::Configuration)?,
    )
    .map_err(|_| ServiceError::Temporary)?;
    let mut sequence = 0u64;
    let mut last_publish = None;
    let mut last_sample = None;
    let mut last_state = None;
    let mut last_watchdog = clock.now().map_err(|_| ServiceError::Configuration)?;
    notify(b"READY=1\nSTATUS=Supervisor de asiento; captura y entrada no habilitadas")?;
    loop {
        let selected = monitor
            .tick()
            .map_err(|fault| {
                if matches!(fault, Fault::Clock) {
                    ServiceError::Configuration
                } else {
                    ServiceError::Temporary
                }
            })?
            .cloned();
        let now = clock.now().map_err(|_| ServiceError::Configuration)?;
        let sample = monitor.sample_started_at();
        let state = SeatState::of(selected.as_ref());
        if sample != last_sample
            || Some(state) != last_state
            || last_publish.map_or(true, |last| {
                now.saturating_sub(last) >= Duration::from_millis(500)
            })
        {
            sequence = sequence.checked_add(1).ok_or(ServiceError::Configuration)?;
            let status = Status {
                instance: &instance,
                boot_id: boot,
                publication: sequence,
                pid: std::process::id(),
                published_millis: millis(now)?,
                sample_started_millis: sample.map(millis).transpose()?,
                state,
            };
            publish(&status.encode().map_err(|_| ServiceError::Configuration)?)?;
            last_sample = sample;
            last_state = Some(state);
            last_publish = Some(now);
        }
        if now.saturating_sub(last_watchdog) >= Duration::from_millis(500) {
            notify(b"WATCHDOG=1")?;
            last_watchdog = now;
        }
        thread::sleep(Duration::from_millis(50));
    }
}
