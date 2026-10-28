//! Identidades de la consulta de estado; perfil público escrito solo por root.
use crate::linux::IpcError;
use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};
pub const PATH: &str = "/opt/absorconnect-secure-lab/ui-profile.json";
pub const SOCKET: &str = "/run/absorconnect-ui-lab/status.sock";
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiProfile {
    v: u8,
    pub broker_uid: u32,
    pub owner_uid: u32,
    pub owner_gid: u32,
}
impl UiProfile {
    pub fn parse(raw: &[u8]) -> Result<Self, IpcError> {
        if raw.is_empty() || raw.len() > 256 {
            return Err(IpcError::Identity);
        }
        let p: Self = serde_json::from_slice(raw).map_err(|_| IpcError::Identity)?;
        if p.v != 1
            || p.broker_uid == 0
            || p.owner_uid == 0
            || p.owner_gid == 0
            || p.broker_uid == p.owner_uid
        {
            return Err(IpcError::Identity);
        }
        Ok(p)
    }
    pub fn load_optional() -> Result<Option<Self>, IpcError> {
        let m = match fs::symlink_metadata(PATH) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(IpcError::Identity),
        };
        for p in ["/opt", "/opt/absorconnect-secure-lab"] {
            let m = fs::symlink_metadata(p).map_err(|_| IpcError::Identity)?;
            if !m.is_dir() || m.is_symlink() || m.uid() != 0 || m.mode() & 0o022 != 0 {
                return Err(IpcError::Identity);
            }
        }
        if !m.is_file()
            || m.uid() != 0
            || m.gid() != 0
            || m.mode() & 0o7777 != 0o444
            || m.nlink() != 1
            || m.len() > 256
        {
            return Err(IpcError::Identity);
        }
        let f = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(PATH)
            .map_err(|_| IpcError::Io)?;
        let opened = f.metadata().map_err(|_| IpcError::Io)?;
        if opened.ino() != m.ino() || opened.dev() != m.dev() {
            return Err(IpcError::Identity);
        }
        let mut raw = Vec::new();
        f.take(257)
            .read_to_end(&mut raw)
            .map_err(|_| IpcError::Io)?;
        Self::parse(&raw).map(Some)
    }
    pub fn validate_socket(self) -> Result<(), IpcError> {
        use std::os::unix::fs::FileTypeExt;
        let parent = Path::new(SOCKET).parent().ok_or(IpcError::Identity)?;
        let d = fs::symlink_metadata(parent).map_err(|_| IpcError::Identity)?;
        if !d.is_dir() || d.is_symlink() || d.uid() != 0 || d.mode() & 0o022 != 0 {
            return Err(IpcError::Identity);
        }
        let m = fs::symlink_metadata(SOCKET).map_err(|_| IpcError::Identity)?;
        if !m.file_type().is_socket()
            || m.uid() != self.broker_uid
            || m.gid() != self.owner_gid
            || m.mode() & 0o7777 != 0o660
        {
            return Err(IpcError::Identity);
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinct_non_root_roles_only() {
        assert!(
            UiProfile::parse(br#"{"v":1,"brokerUid":997,"ownerUid":1000,"ownerGid":1000}"#).is_ok()
        );
        for raw in [
            br#"{"v":1,"brokerUid":1000,"ownerUid":1000,"ownerGid":1000}"#.as_slice(),
            br#"{"v":1,"brokerUid":0,"ownerUid":1000,"ownerGid":1000}"#,
            br#"{"v":1,"brokerUid":997,"ownerUid":0,"ownerGid":1000}"#,
            br#"{"v":1,"brokerUid":997,"ownerUid":1000,"ownerGid":0}"#,
            br#"{"v":2,"brokerUid":997,"ownerUid":1000,"ownerGid":1000}"#,
        ] {
            assert!(UiProfile::parse(raw).is_err());
        }
    }
    #[test]
    fn metadata_is_not_a_path_or_secret_transport() {
        for raw in [
            br#"{"v":1,"brokerUid":997,"ownerUid":1000,"ownerGid":1000,"path":"/tmp"}"#.as_slice(),
            br#"{"v":1,"brokerUid":997,"ownerUid":1000,"ownerUid":1001,"ownerGid":1000}"#,
            br#"{"v":1,"brokerUid":"997","ownerUid":1000,"ownerGid":1000}"#,
            &[b'x'; 257],
        ] {
            assert!(UiProfile::parse(raw).is_err());
        }
    }
}
