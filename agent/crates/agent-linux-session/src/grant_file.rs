//! Archivo efímero creado por root y escribible solo por el grupo del broker.
//! Sin alta local de este laboratorio no se crea ni activa nada.
use crate::grant::{Grant, GrantError, WorkerIdentity};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::MetadataExt,
    path::Path,
};
pub const DIRECTORY: &str = "/run/absorconnect-seat-authority-lab";
pub const PATH: &str = "/run/absorconnect-seat-authority-lab/grant.json";
pub fn process_identity(pid: u32, uid: u32) -> Result<WorkerIdentity, GrantError> {
    if pid <= 1 || uid == 0 {
        return Err(GrantError);
    }
    let root = format!("/proc/{pid}");
    let status = fs::read_to_string(format!("{root}/status")).map_err(|_| GrantError)?;
    let values: Vec<_> = status
        .lines()
        .find_map(|l| l.strip_prefix("Uid:"))
        .ok_or(GrantError)?
        .split_whitespace()
        .map(|v| v.parse::<u32>())
        .collect::<Result<_, _>>()
        .map_err(|_| GrantError)?;
    if values != [uid; 4] {
        return Err(GrantError);
    }
    let stat = fs::read_to_string(format!("{root}/stat")).map_err(|_| GrantError)?;
    if stat.len() > 4096 {
        return Err(GrantError);
    }
    let tail = stat.rsplit_once(')').ok_or(GrantError)?.1;
    let start_ticks = tail
        .split_whitespace()
        .nth(19)
        .ok_or(GrantError)?
        .parse()
        .map_err(|_| GrantError)?;
    if start_ticks == 0 {
        return Err(GrantError);
    }
    Ok(WorkerIdentity {
        pid,
        uid,
        start_ticks,
    })
}
fn directory() -> Result<(), GrantError> {
    for path in ["/run", DIRECTORY] {
        let m = fs::symlink_metadata(path).map_err(|_| GrantError)?;
        if !m.is_dir() || m.uid() != 0 || m.mode() & 0o022 != 0 {
            return Err(GrantError);
        }
    }
    Ok(())
}
fn check(file: &File, group: u32) -> Result<(), GrantError> {
    let m = file.metadata().map_err(|_| GrantError)?;
    if !m.is_file()
        || m.uid() != 0
        || m.gid() != group
        || group == 0
        || m.nlink() != 1
        || m.mode() & 0o7777 != 0o660
        || m.len() > 1024
    {
        return Err(GrantError);
    }
    Ok(())
}
pub struct Publisher {
    file: File,
}
impl Publisher {
    pub fn open_if_provisioned(group: u32) -> Result<Option<Self>, GrantError> {
        match fs::symlink_metadata(DIRECTORY) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(GrantError),
            Ok(_) => (),
        }
        directory()?;
        if fs::symlink_metadata(PATH)
            .map_err(|_| GrantError)?
            .is_symlink()
        {
            return Err(GrantError);
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(PATH)
            .map_err(|_| GrantError)?;
        check(&file, group)?;
        let mut value = Self { file };
        value.clear()?;
        Ok(Some(value))
    }
    pub fn publish(&mut self, grant: &Grant) -> Result<(), GrantError> {
        let bytes = grant.encode()?;
        self.replace(&bytes)
    }
    pub fn clear(&mut self) -> Result<(), GrantError> {
        self.replace(b"")
    }
    fn replace(&mut self, bytes: &[u8]) -> Result<(), GrantError> {
        self.file
            .seek(SeekFrom::Start(0))
            .and_then(|_| self.file.set_len(0))
            .and_then(|_| self.file.write_all(bytes))
            .and_then(|_| self.file.sync_data())
            .map_err(|_| GrantError)
    }
}
impl Drop for Publisher {
    fn drop(&mut self) {
        let _ = self.clear();
    }
}
pub fn read(group: u32) -> Result<Vec<u8>, GrantError> {
    directory()?;
    if fs::symlink_metadata(Path::new(PATH))
        .map_err(|_| GrantError)?
        .is_symlink()
    {
        return Err(GrantError);
    }
    let file = File::open(PATH).map_err(|_| GrantError)?;
    check(&file, group)?;
    let mut bytes = Vec::new();
    file.take(1025)
        .read_to_end(&mut bytes)
        .map_err(|_| GrantError)?;
    if bytes.len() > 1024 {
        return Err(GrantError);
    }
    Ok(bytes)
}
