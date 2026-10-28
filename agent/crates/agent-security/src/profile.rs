//! Identidad local fijada por el instalador root. El mensaje IPC no elige UID/GID.
use crate::linux::IpcError;
use serde::Deserialize;
use std::{
    fs::{self, File},
    io::Read,
    os::unix::fs::MetadataExt,
};
const DIRECTORY: &str = "/opt/absorconnect-secure-lab";
const PATH: &str = "/opt/absorconnect-secure-lab/worker-profile.json";
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerProfile {
    v: u8,
    uid: u32,
    gid: u32,
}
impl WorkerProfile {
    pub fn parse(raw: &[u8]) -> Result<Self, IpcError> {
        if raw.is_empty() || raw.len() > 256 {
            return Err(IpcError::Identity);
        }
        let value: Self = serde_json::from_slice(raw).map_err(|_| IpcError::Identity)?;
        if value.v != 1 || value.uid == 0 || value.gid == 0 {
            return Err(IpcError::Identity);
        }
        Ok(value)
    }
    pub fn uid(self) -> u32 {
        self.uid
    }
    pub fn gid(self) -> u32 {
        self.gid
    }
    pub fn load() -> Result<Self, IpcError> {
        // Ausencia conserva exclusivamente el laboratorio anterior. No crea perfiles.
        let m = match fs::symlink_metadata(PATH) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    v: 1,
                    uid: 1000,
                    gid: 1000,
                })
            }
            Err(_) => return Err(IpcError::Identity),
        };
        for path in ["/opt", DIRECTORY] {
            let d = fs::symlink_metadata(path).map_err(|_| IpcError::Identity)?;
            if !d.is_dir() || d.uid() != 0 || d.mode() & 0o022 != 0 {
                return Err(IpcError::Identity);
            }
        }
        if !m.is_file()
            || m.uid() != 0
            || m.gid() != 0
            || m.nlink() != 1
            || m.mode() & 0o7777 != 0o444
            || m.len() > 256
        {
            return Err(IpcError::Identity);
        }
        let file = File::open(PATH).map_err(|_| IpcError::Identity)?;
        let opened = file.metadata().map_err(|_| IpcError::Identity)?;
        if opened.ino() != m.ino() || opened.dev() != m.dev() {
            return Err(IpcError::Identity);
        }
        let mut bytes = Vec::new();
        file.take(257)
            .read_to_end(&mut bytes)
            .map_err(|_| IpcError::Identity)?;
        Self::parse(&bytes)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_numeric_profile() {
        let p = WorkerProfile::parse(br#"{"v":1,"uid":998,"gid":997}"#).unwrap();
        assert_eq!((p.uid(), p.gid()), (998, 997));
    }
    #[test]
    fn root_zero_or_unknown_version_never_falls_back() {
        for raw in [
            br#"{"v":1,"uid":0,"gid":997}"#.as_slice(),
            br#"{"v":1,"uid":998,"gid":0}"#,
            br#"{"v":2,"uid":998,"gid":997}"#,
        ] {
            assert!(WorkerProfile::parse(raw).is_err());
        }
    }
    #[test]
    fn duplicate_unknown_missing_or_oversize_fails() {
        for raw in [
            br#"{"v":1,"uid":998,"uid":1000,"gid":997}"#.as_slice(),
            br#"{"v":1,"uid":998,"gid":997,"path":"/tmp"}"#,
            br#"{"v":1,"uid":998}"#,
            b"",
            &[b'x'; 257],
        ] {
            assert!(WorkerProfile::parse(raw).is_err());
        }
    }
    #[test]
    fn strings_bool_negative_and_overflow_fail() {
        for uid in ["\"998\"", "true", "-1", "4294967296", "1.5"] {
            let raw = format!("{{\"v\":1,\"uid\":{uid},\"gid\":997}}");
            assert!(WorkerProfile::parse(raw.as_bytes()).is_err());
        }
    }
}
