//! Cliente sin privilegios y sin rutas/órdenes recibidas de Electron.
use crate::{
    linux::{self, FramedPeer, IpcError},
    status_wire::{PublicStatus, Query, MAX_STATUS_FRAME},
    ui_profile::{UiProfile, SOCKET},
};
use absor_agent_core::clock::{BootClock, Clock};
use std::{fs::File, io::Read, path::Path, time::Duration};
fn now() -> Result<Duration, IpcError> {
    BootClock.now().map_err(|_| IpcError::Timeout)
}
fn millis(at: Duration) -> Result<u64, IpcError> {
    u64::try_from(at.as_millis()).map_err(|_| IpcError::Timeout)
}
pub fn query() -> Result<PublicStatus, IpcError> {
    let profile = UiProfile::load_optional()?.ok_or(IpcError::Identity)?;
    if linux::uid() != profile.owner_uid || linux::gid() != profile.owner_gid {
        return Err(IpcError::Identity);
    }
    profile.validate_socket()?;
    let nonce = fresh_nonce()?;
    let request = Query::new(nonce.clone()).map_err(|_| IpcError::Protocol)?;
    let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map_err(|_| IpcError::Identity)?;
    let boot = boot.trim();
    let start = now()?;
    let stream = linux::connect_nonblocking(Path::new(SOCKET))?;
    let credentials = linux::peer_credentials(&stream)?;
    if credentials.uid != 0 || credentials.pid != 1 {
        return Err(IpcError::Identity);
    }
    let mut peer = FramedPeer::bounded(stream, MAX_STATUS_FRAME, Duration::from_millis(250))?;
    peer.send(&request.encode().map_err(|_| IpcError::Protocol)?, start)?;
    loop {
        let time = now()?;
        if time < start || time - start >= Duration::from_millis(1500) {
            return Err(IpcError::Timeout);
        }
        if let Some(raw) = peer.poll(time)? {
            let value = PublicStatus::decode(&raw).map_err(|_| IpcError::Protocol)?;
            value
                .verify(&nonce, boot, millis(start)?, millis(now()?)?)
                .map_err(|_| IpcError::Protocol)?;
            return Ok(value);
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

pub(crate) fn fresh_nonce() -> Result<String, IpcError> {
    let mut bytes = [0_u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|_| IpcError::Io)?;
    let nonce: String = bytes
        .iter()
        .flat_map(|b| {
            let d = b"0123456789abcdef";
            [
                char::from(d[(b >> 4) as usize]),
                char::from(d[(b & 15) as usize]),
            ]
        })
        .collect();
    Ok(nonce)
}
