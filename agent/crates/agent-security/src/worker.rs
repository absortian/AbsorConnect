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
        AuthorityCapture {},
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
    #[derive(serde::Deserialize, serde::Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CountedCapture {
        capture_tested: bool,
        frames: u32,
        non_uniform_frames: u32,
        dedicated_identity: bool,
        no_capabilities: bool,
        private_network: bool,
        root_files_denied: bool,
        input_tested: bool,
        images_stored: bool,
        ready_for_unattended: bool,
    }
    fn capture_probe(authority: std::fs::File) -> Result<serde_json::Value, ()> {
        for path in ["/opt", "/opt/absorconnect-seat-authority-lab"] {
            let m = fs::symlink_metadata(path).map_err(|_| ())?;
            if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
                return Err(());
            }
        }
        for name in ["capture-worker.py", "linux-probe.py"] {
            let m =
                fs::symlink_metadata(Path::new("/opt/absorconnect-seat-authority-lab").join(name))
                    .map_err(|_| ())?;
            if !m.is_file()
                || m.uid() != 0
                || m.mode() & 0o7777 != 0o555
                || m.len() > 65536
                || m.nlink() != 1
            {
                return Err(());
            }
        }
        let result = std::process::Command::new("/usr/bin/timeout")
            .args([
                "--signal=KILL",
                "2.8s",
                "/usr/bin/python3",
                "-B",
                "-I",
                "/opt/absorconnect-seat-authority-lab/capture-worker.py",
            ])
            .env_clear()
            .env("LC_ALL", "C")
            .env("HOME", "/nonexistent")
            .current_dir("/")
            .stdin(std::process::Stdio::from(authority))
            .output()
            .map_err(|_| ())?;
        if !result.status.success() || result.stdout.len() > 1024 {
            return Err(());
        }
        CountedCapture::validated(&result.stdout)
    }
    impl CountedCapture {
        fn validated(raw: &[u8]) -> Result<serde_json::Value, ()> {
            if raw.is_empty() || raw.len() > 1024 {
                return Err(());
            }
            let value: CountedCapture = serde_json::from_slice(raw).map_err(|_| ())?;
            if !value.capture_tested
                || !(2..=100).contains(&value.frames)
                || value.non_uniform_frames > value.frames
                || !value.dedicated_identity
                || !value.no_capabilities
                || !value.private_network
                || !value.root_files_denied
                || value.input_tested
                || value.images_stored
                || value.ready_for_unattended
            {
                return Err(());
            }
            serde_json::to_value(value).map_err(|_| ())
        }
    }
    fn report(raw: &[u8]) -> Result<(), ()> {
        let next = Path::new(DIRECTORY).join("reply.next");
        linux::private_create(&next, raw).map_err(|_| ())?;
        fs::rename(next, Path::new(DIRECTORY).join("reply.json")).map_err(|_| ())
    }
    pub fn run() -> Result<i32, ()> {
        let profile = absor_agent_security::profile::WorkerProfile::load().map_err(|_| ())?;
        if linux::uid() != profile.uid()
            || linux::gid() != profile.gid()
            || std::env::args_os().len() != 1
        {
            return Err(());
        }
        linux::disable_dumping().map_err(|_| ())?;
        let directory = Path::new(DIRECTORY);
        let m = fs::symlink_metadata(directory).map_err(|_| ())?;
        if m.uid() != profile.uid()
            || m.gid() != profile.gid()
            || !m.is_dir()
            || m.is_symlink()
            || m.mode() & 0o077 != 0
        {
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
            || m.uid() == profile.uid()
            || m.gid() != profile.gid()
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
                    || m.uid() != profile.uid()
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
                Some(Control::AuthorityCapture {}) => {
                    let captured = absor_agent_security::authority_client::request()
                        .ok()
                        .and_then(|fd| capture_probe(fd).ok());
                    sequence = sequence.checked_add(1).ok_or(())?;
                    let raw = serde_json::to_vec(&Request {
                        v: 1,
                        sequence,
                        command: Command::Status {},
                    })
                    .map_err(|_| ())?;
                    let response: Response =
                        serde_json::from_slice(&rpc(&mut peer, &raw)?).map_err(|_| ())?;
                    let valid = response.v == 1
                        && response.sequence == sequence
                        && matches!(
                            response.result,
                            Reply::Status {
                                state: State::Authenticated,
                                ..
                            }
                        );
                    let value = if valid {
                        captured.unwrap_or_else(|| serde_json::json!({"captureTested":false}))
                    } else {
                        serde_json::json!({"captureTested":false})
                    };
                    report(&serde_json::to_vec(&value).map_err(|_| ())?)?;
                    continue;
                }
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
    #[cfg(test)]
    mod capture_tests {
        use super::CountedCapture;
        fn valid() -> serde_json::Value {
            serde_json::json!({"captureTested":true,"frames":10,"nonUniformFrames":8,"dedicatedIdentity":true,"noCapabilities":true,"privateNetwork":true,"rootFilesDenied":true,"inputTested":false,"imagesStored":false,"readyForUnattended":false})
        }
        #[test]
        fn bounded_counts_and_no_free_text() {
            let raw = serde_json::to_vec(&valid()).unwrap();
            assert!(CountedCapture::validated(&raw).is_ok());
            let mut extra = valid();
            extra["path"] = "public fixture".into();
            assert!(CountedCapture::validated(&serde_json::to_vec(&extra).unwrap()).is_err());
            assert!(CountedCapture::validated(&vec![b'x'; 1025]).is_err());
        }
        #[test]
        fn unsupported_flags_cannot_claim_capture() {
            for field in [
                "captureTested",
                "dedicatedIdentity",
                "noCapabilities",
                "privateNetwork",
                "rootFilesDenied",
                "inputTested",
                "imagesStored",
                "readyForUnattended",
            ] {
                let mut value = valid();
                value[field] = (!value[field].as_bool().unwrap()).into();
                assert!(CountedCapture::validated(&serde_json::to_vec(&value).unwrap()).is_err());
            }
        }
        #[test]
        fn impossible_or_nonintegral_frames_fail() {
            for (frames, varied) in [(1, 0), (101, 10), (10, 11)] {
                let mut value = valid();
                value["frames"] = frames.into();
                value["nonUniformFrames"] = varied.into();
                assert!(CountedCapture::validated(&serde_json::to_vec(&value).unwrap()).is_err());
            }
            let mut value = valid();
            value["frames"] = 1.5.into();
            assert!(CountedCapture::validated(&serde_json::to_vec(&value).unwrap()).is_err());
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
