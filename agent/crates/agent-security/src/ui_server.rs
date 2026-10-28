//! Lector de estado independiente del par del trabajador; no modifica su sesión.
use crate::{
    linux::{self, FramedPeer, IpcError},
    status_wire::{BrokerState, Owner, PublicStatus, Query, MAX_STATUS_FRAME},
    ui_profile::UiProfile,
};
use std::{os::unix::net::UnixListener, time::Duration};
const CLIENT_TIME: Duration = Duration::from_millis(250);
struct Pending {
    peer: FramedPeer,
    deadline: Duration,
    replied: bool,
}
pub struct StatusServer {
    listener: UnixListener,
    profile: UiProfile,
    device: String,
    instance: String,
    boot_id: String,
    previous: Duration,
    pending: Option<Pending>,
}
impl StatusServer {
    pub fn new(
        listener: UnixListener,
        profile: UiProfile,
        device: String,
        instance: String,
        boot_id: String,
    ) -> Result<Self, IpcError> {
        if profile.broker_uid != linux::uid() {
            return Err(IpcError::Identity);
        }
        profile.validate_socket()?;
        Ok(Self {
            listener,
            profile,
            device,
            instance,
            boot_id,
            previous: Duration::ZERO,
            pending: None,
        })
    }
    pub fn poll(&mut self, now: Duration, state: BrokerState) -> Result<(), IpcError> {
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
                    Ok(Some(raw)) if !p.replied => {
                        if let Ok(query) = Query::decode(&raw) {
                            let value = PublicStatus {
                                v: 1,
                                nonce: query.nonce,
                                owner: Owner::Agent,
                                device_id: self.device.clone(),
                                agent_version: "0.1.0+secure-lab".into(),
                                instance: self.instance.clone(),
                                boot_id: self.boot_id.clone(),
                                pid: std::process::id(),
                                published_at_boottime_millis: u64::try_from(now.as_millis())
                                    .map_err(|_| IpcError::Protocol)?,
                                state,
                                ready_for_unattended: false,
                            };
                            match value
                                .encode()
                                .map_err(|_| IpcError::Protocol)
                                .and_then(|raw| p.peer.send(&raw, now))
                            {
                                Ok(()) => p.replied = true,
                                Err(_) => drop_client = true,
                            }
                        } else {
                            drop_client = true;
                        }
                    }
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
                // Leer no autoriza autenticar, cambiar configuración ni cortar al trabajador.
                let peer = linux::peer_credentials(&stream);
                if self.pending.is_none()
                    && peer.is_ok_and(|p| {
                        p.uid == self.profile.owner_uid && p.gid == self.profile.owner_gid
                    })
                {
                    self.pending = Some(Pending {
                        peer: FramedPeer::bounded(stream, MAX_STATUS_FRAME, CLIENT_TIME)?,
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
