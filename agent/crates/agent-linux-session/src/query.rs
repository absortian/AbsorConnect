//! Consultas de solo lectura a logind con binarios del SO y argumentos cerrados.
use crate::{active_session, Fault, Snapshot, LIMIT};
use std::{
    fs,
    io::Read,
    os::unix::fs::MetadataExt,
    path::Path,
    process::{Command, Stdio},
};

pub struct LogindSource {
    _private: (),
}
impl LogindSource {
    pub fn new() -> Result<Self, Fault> {
        for path in ["/", "/usr", "/usr/bin"] {
            let m = fs::symlink_metadata(path).map_err(|_| Fault::Query)?;
            if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
                return Err(Fault::Query);
            }
        }
        for path in ["/usr/bin/timeout", "/usr/bin/loginctl"] {
            let path = Path::new(path);
            let m = fs::symlink_metadata(path).map_err(|_| Fault::Query)?;
            if !m.is_file() || m.uid() != 0 || m.mode() & 0o022 != 0 || m.mode() & 0o111 == 0 {
                return Err(Fault::Query);
            }
        }
        Ok(Self { _private: () })
    }
    fn query(args: &[&str]) -> Result<Vec<u8>, Fault> {
        let mut child = Command::new("/usr/bin/timeout")
            .args(["--kill-after=0.2s", "2s", "/usr/bin/loginctl", "--no-pager"])
            .args(args)
            .env_clear()
            .env("LC_ALL", "C")
            .env("SYSTEMD_COLORS", "0")
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| Fault::Query)?;
        let mut output = Vec::new();
        let read = child
            .stdout
            .take()
            .ok_or(Fault::Query)?
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut output);
        if read.is_err() || output.len() > LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Fault::Query);
        }
        if !child.wait().map_err(|_| Fault::Query)?.success() {
            return Err(Fault::Query);
        }
        Ok(output)
    }
}
impl crate::monitor::Source for LogindSource {
    fn read(&mut self) -> Result<Snapshot, Fault> {
        let active = active_session(&Self::query(&[
            "show-seat",
            "seat0",
            "-p",
            "ActiveSession",
        ])?)?;
        let raw = Self::query(&[
            "show-session",
            active.as_str(),
            "-p",
            "Id",
            "-p",
            "User",
            "-p",
            "Leader",
            "-p",
            "Display",
            "-p",
            "Seat",
            "-p",
            "Type",
            "-p",
            "Class",
            "-p",
            "State",
            "-p",
            "Remote",
            "-p",
            "LockedHint",
        ])?;
        let snapshot = Snapshot::from_properties(&active, &raw)?;
        // Una transición entre las dos lecturas no puede seleccionar el usuario anterior.
        let after = active_session(&Self::query(&[
            "show-seat",
            "seat0",
            "-p",
            "ActiveSession",
        ])?)?;
        if after != active {
            return Err(Fault::NoSession);
        }
        Ok(snapshot)
    }
}
