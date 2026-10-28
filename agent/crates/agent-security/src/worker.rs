//! Trabajador de protocolo de laboratorio: sin K, token, captura o entrada.
#![forbid(unsafe_code)]
#[cfg(target_os = "linux")]
mod implementation {
    use absor_agent_core::clock::{BootClock, Clock};
    use absor_agent_security::{
        linux::{self, FramedPeer},
        wire::{Command, Reply, Request, Response, State},
    };
    use serde::Deserialize;
    use std::{
        fs::{self, File},
        io::Read,
        os::unix::{
            fs::{FileTypeExt, MetadataExt},
            net::UnixStream,
        },
        path::Path,
        thread,
        time::Duration,
    };
    const DIRECTORY: &str = "/run/absorconnect-ipc-worker-lab";
    #[derive(Deserialize)]
    #[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
    enum Control {
        Request { command: Command },
        ReplayPrevious {},
        Exit {},
        AuthorityProbe {},
        AuthorityProbeDelayed {},
    }
    fn rpc(peer: &mut FramedPeer, raw: &[u8]) -> Result<Vec<u8>, ()> {
        let start = BootClock.now().map_err(|_| ())?;
        peer.send(raw, start).map_err(|_| ())?;
        loop {
            let now = BootClock.now().map_err(|_| ())?;
            if now < start || now - start >= Duration::from_secs(2) {
                return Err(());
            }
            if let Some(value) = peer.poll(now).map_err(|_| ())? {
                return Ok(value);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    fn report(raw: &[u8]) -> Result<(), ()> {
        let next = Path::new(DIRECTORY).join("reply.next");
        linux::private_create(&next, raw).map_err(|_| ())?;
        fs::rename(next, Path::new(DIRECTORY).join("reply.json")).map_err(|_| ())
    }
    pub fn run() -> Result<i32, ()> {
        if linux::uid() != 1000 || std::env::args_os().len() != 1 {
            return Err(());
        }
        linux::disable_dumping().map_err(|_| ())?;
        let directory = Path::new(DIRECTORY);
        let m = fs::symlink_metadata(directory).map_err(|_| ())?;
        if m.uid() != 1000 || !m.is_dir() || m.is_symlink() || m.mode() & 0o077 != 0 {
            return Err(());
        }
        let parent = Path::new("/run/absorconnect-secure-lab");
        let m = fs::symlink_metadata(parent).map_err(|_| ())?;
        if m.uid() != 0 || !m.is_dir() || m.is_symlink() || m.mode() & 0o022 != 0 {
            return Err(());
        }
        let socket = parent.join("control.sock");
        let m = fs::symlink_metadata(&socket).map_err(|_| ())?;
        if !m.file_type().is_socket()
            || m.uid() == 0
            || m.uid() == 1000
            || m.gid() != 1000
            || m.mode() & 0o7777 != 0o660
        {
            return Err(());
        }
        let stream = UnixStream::connect(socket).map_err(|_| ())?;
        let cred = linux::peer_credentials(&stream).map_err(|_| ())?;
        if cred.uid != 0 || cred.pid != 1 {
            return Err(());
        }
        let mut peer = FramedPeer::new(stream).map_err(|_| ())?;
        let mut sequence = 0_u64;
        let mut last = Vec::new();
        let mut next = Duration::ZERO;
        loop {
            let command_path = directory.join("command.json");
            let control = if let Ok(m) = fs::symlink_metadata(&command_path) {
                if !m.is_file()
                    || m.is_symlink()
                    || m.uid() != 1000
                    || m.mode() & 0o077 != 0
                    || m.len() > 4096
                {
                    return Err(());
                }
                let mut bytes = Vec::new();
                File::open(&command_path)
                    .map_err(|_| ())?
                    .take(4097)
                    .read_to_end(&mut bytes)
                    .map_err(|_| ())?;
                fs::remove_file(command_path).map_err(|_| ())?;
                Some(serde_json::from_slice::<Control>(&bytes).map_err(|_| ())?)
            } else {
                None
            };
            let explicit = control.is_some();
            let now = BootClock.now().map_err(|_| ())?;
            let delayed_probe = matches!(&control, Some(Control::AuthorityProbeDelayed {}));
            let command = match control {
                Some(Control::Exit { .. }) => return Ok(0),
                Some(Control::AuthorityProbe {}) | Some(Control::AuthorityProbeDelayed {}) => {
                    if delayed_probe {
                        report(br#"{"authorityProbeWaiting":true}"#)?;
                        thread::sleep(Duration::from_millis(650));
                    }
                    let result = absor_agent_security::authority_client::request();
                    let received = result.is_ok();
                    drop(result);
                    report(&serde_json::to_vec(&serde_json::json!({"authorityReceived":received,"cookieBytesReported":false,"captureTested":false,"inputTested":false})).map_err(|_|())?)?;
                    continue;
                }
                Some(Control::ReplayPrevious { .. }) => {
                    if last.is_empty() {
                        return Err(());
                    }
                    let result = rpc(&mut peer, &last);
                    report(
                        &serde_json::to_vec(&serde_json::json!({"replayDenied":result.is_err()}))
                            .map_err(|_| ())?,
                    )?;
                    return Ok(if result.is_err() { 0 } else { 78 });
                }
                Some(Control::Request { command }) => command,
                None if now >= next => Command::Status {},
                None => {
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
            };
            sequence = sequence.checked_add(1).ok_or(())?;
            let request = serde_json::to_vec(&Request {
                v: 1,
                sequence,
                command,
            })
            .map_err(|_| ())?;
            let raw = rpc(&mut peer, &request)?;
            let response: Response = serde_json::from_slice(&raw).map_err(|_| ())?;
            if response.v != 1 || response.sequence != sequence {
                return Err(());
            }
            if explicit {
                report(&raw)?;
            }
            last = request;
            next = BootClock
                .now()
                .map_err(|_| ())?
                .checked_add(Duration::from_millis(100))
                .ok_or(())?;
            if matches!(
                response.result,
                Reply::Status {
                    state: State::Revoked,
                    ..
                } | Reply::Denied {
                    state: State::Revoked,
                    ..
                }
            ) {
                return Ok(77);
            }
        }
    }
}
fn main() {
    #[cfg(target_os = "linux")]
    let code = implementation::run().unwrap_or_else(|_| {
        eprintln!("ipc_worker_lab_failed");
        75
    });
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    std::process::exit(code);
}
