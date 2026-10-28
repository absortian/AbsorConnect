//! Parada acotada del equipo exacto; sin credenciales de cuenta ni comandos del SO.
use crate::{
    control_wire::{StopReply, StopRequest, MAX_CONTROL_FRAME},
    linux::{self, FramedPeer, IpcError},
    ui_profile::{UiProfile, CONTROL_SOCKET},
};
use absor_agent_core::clock::{BootClock, Clock};
use std::{path::Path, time::Duration};
pub fn stop(device: String) -> Result<StopReply, IpcError> {
    let profile = UiProfile::load_control_optional()?.ok_or(IpcError::Identity)?;
    if linux::uid() != profile.owner_uid || linux::gid() != profile.owner_gid {
        return Err(IpcError::Identity);
    }
    profile.validate_control_socket()?;
    let nonce = crate::ui_client::fresh_nonce()?;
    let request =
        StopRequest::new(nonce.clone(), device.clone()).map_err(|_| IpcError::Protocol)?;
    let start = BootClock.now().map_err(|_| IpcError::Timeout)?;
    let stream = linux::connect_nonblocking(Path::new(CONTROL_SOCKET))?;
    let credentials = linux::peer_credentials(&stream)?;
    if credentials.uid != 0 || credentials.pid != 1 {
        return Err(IpcError::Identity);
    }
    let mut peer = FramedPeer::bounded(stream, MAX_CONTROL_FRAME, Duration::from_millis(250))?;
    peer.send(&request.encode().map_err(|_| IpcError::Protocol)?, start)?;
    loop {
        let now = BootClock.now().map_err(|_| IpcError::Timeout)?;
        if now < start || now - start >= Duration::from_millis(1500) {
            return Err(IpcError::Timeout);
        }
        if let Some(raw) = peer.poll(now)? {
            let value = StopReply::decode(&raw).map_err(|_| IpcError::Protocol)?;
            value
                .verify(&nonce, &device)
                .map_err(|_| IpcError::Protocol)?;
            return Ok(value);
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
