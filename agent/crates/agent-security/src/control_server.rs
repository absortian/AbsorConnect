//! No comparte ni el par ni el protocolo de lectura D10.
use crate::{
    control_wire::{StopReply, StopRequest, MAX_CONTROL_FRAME},
    linux::{self, FramedPeer, IpcError},
    ui_profile::UiProfile,
};
use std::{os::unix::net::UnixListener, time::Duration};
const CLIENT_TIME: Duration = Duration::from_millis(250);
struct Pending {
    peer: FramedPeer,
    deadline: Duration,
    replied: bool,
}
pub struct ControlServer {
    listener: UnixListener,
    profile: UiProfile,
    device: String,
    previous: Duration,
    pending: Option<Pending>,
}
impl ControlServer {
    pub fn new(
        listener: UnixListener,
        profile: UiProfile,
        device: String,
    ) -> Result<Self, IpcError> {
        if profile.broker_uid != linux::uid() {
            return Err(IpcError::Identity);
        }
        profile.validate_control_socket()?;
        Ok(Self {
            listener,
            profile,
            device,
            previous: Duration::ZERO,
            pending: None,
        })
    }
    /// El callback corta y persiste; una respuesta solo se crea después de su éxito.
    pub fn poll(
        &mut self,
        now: Duration,
        mut stop: impl FnMut() -> Result<(), IpcError>,
    ) -> Result<(), IpcError> {
        if now < self.previous {
            return Err(IpcError::Timeout);
        }
        self.previous = now;
        let mut drop_client = false;
        if let Some(p) = self.pending.as_mut() {
            if now >= p.deadline {
                drop_client = true;
            } else {
                match p.peer.poll(now) {
                    Ok(Some(raw)) if !p.replied => match StopRequest::decode(&raw) {
                        Ok(query) if query.device_id == self.device => {
                            stop()?;
                            let raw = StopReply::stopped(query)
                                .encode()
                                .map_err(|_| IpcError::Protocol)?;
                            match p.peer.send(&raw, now) {
                                Ok(()) => p.replied = true,
                                Err(_) => drop_client = true,
                            }
                        }
                        _ => drop_client = true,
                    },
                    Ok(Some(_)) | Err(_) => drop_client = true,
                    Ok(None) if p.replied && !p.peer.output_pending() => drop_client = true,
                    Ok(None) => {}
                }
            }
        }
        if drop_client {
            self.pending.take();
        }
        match self.listener.accept() {
            Ok((stream, _)) => {
                if self.pending.is_none()
                    && linux::peer_credentials(&stream).is_ok_and(|p| {
                        p.uid == self.profile.owner_uid && p.gid == self.profile.owner_gid
                    })
                {
                    self.pending = Some(Pending {
                        peer: FramedPeer::bounded(stream, MAX_CONTROL_FRAME, CLIENT_TIME)?,
                        deadline: now.checked_add(CLIENT_TIME).ok_or(IpcError::Timeout)?,
                        replied: false,
                    });
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err(IpcError::Io),
        }
        Ok(())
    }
}
