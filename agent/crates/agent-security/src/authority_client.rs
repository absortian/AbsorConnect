//! Sonda optativa: solicita un fd al listener root tras autorización. No lee cookies en JSON.
use crate::{
    fd,
    linux::{self, IpcError},
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    os::unix::{
        fs::{FileTypeExt, MetadataExt},
        net::UnixStream,
    },
    path::Path,
    time::Duration,
};
const DIRECTORY: &str = "/run/absorconnect-seat-authority-lab";
pub fn request() -> Result<File, IpcError> {
    for path in ["/run", DIRECTORY] {
        let m = fs::symlink_metadata(path).map_err(|_| IpcError::Identity)?;
        if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
            return Err(IpcError::Identity);
        }
    }
    let path = Path::new(DIRECTORY).join("authority.sock");
    let m = fs::symlink_metadata(&path).map_err(|_| IpcError::Identity)?;
    if !m.file_type().is_socket()
        || m.uid() != 0
        || m.gid() != linux::gid()
        || m.mode() & 0o7777 != 0o660
    {
        return Err(IpcError::Identity);
    }
    let mut stream = UnixStream::connect(path).map_err(|_| IpcError::Io)?;
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| IpcError::Io)?;
    stream
        .set_write_timeout(Some(Duration::from_millis(50)))
        .map_err(|_| IpcError::Io)?;
    let identity = linux::peer_credentials(&stream)?;
    if identity.uid != 0 || identity.pid != 1 {
        return Err(IpcError::Identity);
    }
    stream.write_all(b"G").map_err(|_| IpcError::Io)?;
    let mut file = fd::receive(&stream)?;
    let m = file.metadata().map_err(|_| IpcError::Identity)?;
    if m.uid() != 0 || m.len() != 24 || m.mode() & 0o7777 != 0o400 {
        return Err(IpcError::Identity);
    }
    // Todos los sellos. Los bits ABI son fijos de Linux; la lectura queda en fd::seals.
    if fd::seals(&file)? & 15 != 15 {
        return Err(IpcError::Identity);
    }
    let mut header = [0u8; 8];
    file.read_exact(&mut header)
        .map_err(|_| IpcError::Protocol)?;
    if &header[..4] != b"AXA1"
        || u32::from_be_bytes(header[4..].try_into().map_err(|_| IpcError::Protocol)?) > 255
    {
        return Err(IpcError::Protocol);
    }
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(|_| IpcError::Io)?;
    Ok(file)
}
