//! FFI limitada a credenciales del kernel, dumpability y fd de systemd.
use crate::wire::MAX_FRAME;
use absor_agent_auth::{AttemptState, AttemptStore, AuthError};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    time::Duration,
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcError {
    Closed,
    Protocol,
    Timeout,
    Identity,
    Io,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Credentials {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
}
pub fn uid() -> u32 {
    unsafe { libc::geteuid() }
}
pub fn gid() -> u32 {
    unsafe { libc::getegid() }
}
pub fn disable_dumping() -> Result<(), IpcError> {
    // SAFETY: prctl con argumentos enteros, sin memoria apuntada.
    if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
        return Err(IpcError::Identity);
    }
    Ok(())
}
pub fn peer_credentials(socket: &UnixStream) -> Result<Credentials, IpcError> {
    let mut value = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: fd vivo y buffers propios del tamaño de la ABI del sistema.
    if unsafe {
        libc::getsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut value as *mut libc::ucred).cast(),
            &mut size,
        )
    } != 0
        || size as usize != std::mem::size_of::<libc::ucred>()
        || value.pid <= 0
    {
        return Err(IpcError::Identity);
    }
    Ok(Credentials {
        pid: value.pid as u32,
        uid: value.uid,
        gid: value.gid,
    })
}
/// Conexión local de estado: un backlog lleno falla enseguida, nunca bloquea.
pub fn connect_nonblocking(path: &Path) -> Result<UnixStream, IpcError> {
    use std::os::{fd::OwnedFd, unix::ffi::OsStrExt};
    let name = path.as_os_str().as_bytes();
    // SAFETY: sockaddr_un solo contiene enteros y bytes; cero es representable.
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    if !path.is_absolute()
        || name.is_empty()
        || name.len() >= address.sun_path.len()
        || name.contains(&0)
    {
        return Err(IpcError::Identity);
    }
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (slot, byte) in address.sun_path.iter_mut().zip(name) {
        *slot = *byte as libc::c_char;
    }
    // SAFETY: socket sin punteros; NONBLOCK/CLOEXEC se aplican antes de connect.
    let fd = unsafe {
        libc::socket(
            libc::AF_UNIX,
            libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        return Err(IpcError::Io);
    }
    // SAFETY: fd nuevo, propio y tomado exactamente una vez para todo camino de error.
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    // SAFETY: sockaddr_un inicializado, con ruta terminada en cero y tamaño ABI exacto.
    if unsafe {
        libc::connect(
            fd,
            (&address as *const libc::sockaddr_un).cast(),
            std::mem::size_of_val(&address) as libc::socklen_t,
        )
    } != 0
    {
        return Err(match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::EAGAIN | libc::EINPROGRESS) => IpcError::Timeout,
            _ => IpcError::Io,
        });
    }
    Ok(UnixStream::from(owned))
}
pub fn activation_listener(expected: &Path) -> Result<UnixListener, IpcError> {
    activation_listeners(&[expected])?
        .pop()
        .ok_or(IpcError::Identity)
}
/// Roles cerrados de socket: toma cada fd una sola vez y ordena por dirección verificada.
pub fn activation_listeners(expected: &[&Path]) -> Result<Vec<UnixListener>, IpcError> {
    if !(1..=2).contains(&expected.len())
        || std::env::var("LISTEN_PID")
            .ok()
            .and_then(|v| v.parse::<u32>().ok())
            != Some(std::process::id())
        || std::env::var("LISTEN_FDS").ok().as_deref() != Some(expected.len().to_string().as_str())
    {
        return Err(IpcError::Identity);
    }
    let mut ordered: Vec<Option<UnixListener>> = expected.iter().map(|_| None).collect();
    for index in 0..expected.len() {
        let fd = 3 + index as i32;
        let mut accepting: libc::c_int = 0;
        let mut size = std::mem::size_of_val(&accepting) as libc::socklen_t;
        // SAFETY: fd entregado por systemd; salida entera exclusiva y con su tamaño ABI.
        if unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_ACCEPTCONN,
                (&mut accepting as *mut libc::c_int).cast(),
                &mut size,
            )
        } != 0
            || accepting != 1
            || size as usize != std::mem::size_of_val(&accepting)
        {
            return Err(IpcError::Identity);
        }
        // SAFETY: cada descriptor de activación se toma exactamente una vez.
        let listener = unsafe { UnixListener::from_raw_fd(fd) };
        let address = listener.local_addr().map_err(|_| IpcError::Io)?;
        let slot = expected
            .iter()
            .position(|p| Some(*p) == address.as_pathname())
            .ok_or(IpcError::Identity)?;
        if ordered[slot].is_some() {
            return Err(IpcError::Identity);
        }
        // SAFETY: solo modifica las banderas del descriptor propio.
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(IpcError::Io);
        }
        listener.set_nonblocking(true).map_err(|_| IpcError::Io)?;
        ordered[slot] = Some(listener);
    }
    ordered
        .into_iter()
        .map(|v| v.ok_or(IpcError::Identity))
        .collect()
}

pub struct FramedPeer {
    stream: UnixStream,
    read: Vec<u8>,
    expected: Option<usize>,
    started: Option<Duration>,
    output: Option<(Vec<u8>, usize, Duration)>,
    previous: Duration,
    failed: bool,
    frame_limit: usize,
    io_timeout: Duration,
}
impl FramedPeer {
    pub fn new(stream: UnixStream) -> Result<Self, IpcError> {
        Self::bounded(stream, MAX_FRAME, Duration::from_secs(2))
    }
    pub fn bounded(
        stream: UnixStream,
        frame_limit: usize,
        io_timeout: Duration,
    ) -> Result<Self, IpcError> {
        if frame_limit == 0
            || frame_limit > MAX_FRAME
            || io_timeout.is_zero()
            || io_timeout > Duration::from_secs(2)
        {
            return Err(IpcError::Protocol);
        }
        stream.set_nonblocking(true).map_err(|_| IpcError::Io)?;
        Ok(Self {
            stream,
            read: Vec::new(),
            expected: None,
            started: None,
            output: None,
            previous: Duration::ZERO,
            failed: false,
            frame_limit,
            io_timeout,
        })
    }
    pub fn output_pending(&self) -> bool {
        self.output.is_some()
    }
    pub fn credentials(&self) -> Result<Credentials, IpcError> {
        peer_credentials(&self.stream)
    }
    pub fn send(&mut self, raw: &[u8], now: Duration) -> Result<(), IpcError> {
        if self.failed || self.output.is_some() || raw.is_empty() || raw.len() > self.frame_limit {
            self.failed = true;
            return Err(IpcError::Protocol);
        }
        let mut frame = (raw.len() as u32).to_be_bytes().to_vec();
        frame.extend_from_slice(raw);
        self.output = Some((frame, 0, now));
        Ok(())
    }
    pub fn poll(&mut self, now: Duration) -> Result<Option<Vec<u8>>, IpcError> {
        if self.failed {
            return Err(IpcError::Closed);
        }
        let result = self.progress(now);
        if result.is_err() {
            self.failed = true;
            let _ = self.stream.shutdown(std::net::Shutdown::Both);
        }
        result
    }
    fn progress(&mut self, now: Duration) -> Result<Option<Vec<u8>>, IpcError> {
        if now < self.previous {
            return Err(IpcError::Timeout);
        }
        self.previous = now;
        if let Some((bytes, offset, start)) = self.output.as_mut() {
            if now.saturating_sub(*start) >= self.io_timeout {
                return Err(IpcError::Timeout);
            }
            match self.stream.write(&bytes[*offset..]) {
                Ok(0) => return Err(IpcError::Closed),
                Ok(n) => *offset += n,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
                Err(_) => return Err(IpcError::Io),
            }
            if *offset == bytes.len() {
                self.output = None;
            } else {
                return Ok(None);
            }
        }
        if self
            .started
            .is_some_and(|start| now.saturating_sub(start) >= self.io_timeout)
        {
            return Err(IpcError::Timeout);
        }
        for _ in 0..9 {
            let mut bytes = [0; 16_384];
            let limit = (self.frame_limit + 4).min(bytes.len());
            match self.stream.read(&mut bytes[..limit]) {
                Ok(0) => return Err(IpcError::Closed),
                Ok(n) => {
                    self.started.get_or_insert(now);
                    self.read.extend_from_slice(&bytes[..n]);
                    if self.read.len() > self.frame_limit + 4 {
                        return Err(IpcError::Protocol);
                    }
                    if self.expected.is_none() && self.read.len() >= 4 {
                        let size = u32::from_be_bytes(
                            self.read[..4].try_into().map_err(|_| IpcError::Protocol)?,
                        ) as usize;
                        if size == 0 || size > self.frame_limit {
                            return Err(IpcError::Protocol);
                        }
                        self.expected = Some(size + 4);
                    }
                    if let Some(size) = self.expected {
                        if self.read.len() > size {
                            return Err(IpcError::Protocol);
                        }
                        if self.read.len() == size {
                            let frame = self.read.split_off(4);
                            self.read.clear();
                            self.expected = None;
                            self.started = None;
                            return Ok(Some(frame));
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
                Err(_) => return Err(IpcError::Io),
            }
        }
        Ok(None)
    }
}
impl Drop for FramedPeer {
    fn drop(&mut self) {
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}

fn protected_file(path: &Path, owner: u32, limit: u64) -> Result<File, AuthError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| AuthError::Storage)?;
    let m = file.metadata().map_err(|_| AuthError::Storage)?;
    if !m.is_file()
        || m.uid() != owner
        || m.mode() & 0o077 != 0
        || m.nlink() != 1
        || m.len() > limit
    {
        return Err(AuthError::Storage);
    }
    Ok(file)
}
pub struct ProtectedAttemptStore {
    path: PathBuf,
    owner: u32,
}
impl ProtectedAttemptStore {
    pub fn open(directory: &Path) -> Result<Self, AuthError> {
        let m = fs::symlink_metadata(directory).map_err(|_| AuthError::Storage)?;
        if !directory.is_absolute()
            || !m.is_dir()
            || m.is_symlink()
            || m.uid() != uid()
            || m.mode() & 0o077 != 0
        {
            return Err(AuthError::Storage);
        }
        let value = Self {
            path: directory.join("attempts.json"),
            owner: uid(),
        };
        protected_file(&value.path, value.owner, 4096)?;
        Ok(value)
    }
}
impl AttemptStore for ProtectedAttemptStore {
    fn load(&mut self) -> Result<AttemptState, AuthError> {
        let mut bytes = Vec::new();
        protected_file(&self.path, self.owner, 4096)?
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| AuthError::Storage)?;
        if bytes.len() > 4096 {
            return Err(AuthError::Storage);
        }
        serde_json::from_slice(&bytes).map_err(|_| AuthError::Storage)
    }
    fn commit(&mut self, state: &AttemptState) -> Result<(), AuthError> {
        let next = self.path.with_extension("next");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&next)
            .map_err(|_| AuthError::Storage)?;
        file.write_all(&serde_json::to_vec(state).map_err(|_| AuthError::Storage)?)
            .and_then(|_| file.sync_all())
            .map_err(|_| AuthError::Storage)?;
        drop(file);
        fs::rename(next, &self.path).map_err(|_| AuthError::Storage)?;
        File::open(self.path.parent().ok_or(AuthError::Storage)?)
            .and_then(|f| f.sync_all())
            .map_err(|_| AuthError::Storage)
    }
}
pub fn private_create(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}
pub fn private_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}
/// Mantener vivo el servicio solo desde su actor, nunca desde el lector de IPC.
pub fn notify(message: &[u8]) -> Result<(), IpcError> {
    use std::os::{
        linux::net::SocketAddrExt,
        unix::{
            ffi::OsStrExt,
            net::{SocketAddr, UnixDatagram},
        },
    };
    let raw = std::env::var_os("NOTIFY_SOCKET").ok_or(IpcError::Identity)?;
    let bytes = raw.as_bytes();
    let address = if bytes.first() == Some(&b'@') {
        SocketAddr::from_abstract_name(&bytes[1..])
    } else {
        SocketAddr::from_pathname(Path::new(&raw))
    }
    .map_err(|_| IpcError::Io)?;
    UnixDatagram::unbound()
        .and_then(|s| s.send_to_addr(message, &address))
        .map_err(|_| IpcError::Io)?;
    Ok(())
}
pub struct HostLock(File);
impl HostLock {
    pub fn acquire(directory: &Path) -> Result<Self, IpcError> {
        let path = directory.join("broker.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| IpcError::Io)?;
        let m = file.metadata().map_err(|_| IpcError::Io)?;
        if !m.is_file() || m.uid() != uid() || m.mode() & 0o077 != 0 || m.nlink() != 1 {
            return Err(IpcError::Identity);
        }
        // SAFETY: flock opera sobre el descriptor propio; cierre libera la exclusión.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(IpcError::Identity);
        }
        Ok(Self(file))
    }
    pub fn is_held(&self) -> bool {
        self.0.metadata().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_role_cannot_use_the_worker_frame_budget_or_timeout() {
        let (a, mut b) = UnixStream::pair().unwrap();
        let mut p = FramedPeer::bounded(a, 512, Duration::from_millis(250)).unwrap();
        b.write_all(&513_u32.to_be_bytes()).unwrap();
        assert_eq!(p.poll(Duration::ZERO).unwrap_err(), IpcError::Protocol);
        let (a, mut b) = UnixStream::pair().unwrap();
        let mut p = FramedPeer::bounded(a, 512, Duration::from_millis(250)).unwrap();
        b.write_all(&[0, 0]).unwrap();
        assert!(p.poll(Duration::ZERO).unwrap().is_none());
        assert_eq!(
            p.poll(Duration::from_millis(250)).unwrap_err(),
            IpcError::Timeout
        );
        assert_eq!(
            p.poll(Duration::from_millis(251)).unwrap_err(),
            IpcError::Closed
        );
        let (a, _b) = UnixStream::pair().unwrap();
        let mut p = FramedPeer::bounded(a, 512, Duration::from_millis(250)).unwrap();
        assert_eq!(
            p.send(&[b'x'; 513], Duration::ZERO),
            Err(IpcError::Protocol)
        );
    }
    #[test]
    fn kernel_credentials_are_not_fields_supplied_by_client() {
        let (a, _b) = UnixStream::pair().unwrap();
        let c = peer_credentials(&a).unwrap();
        assert_eq!(c.uid, uid());
        assert_eq!(c.pid, std::process::id());
    }
    #[test]
    fn framing_partial_timeout_oversize_and_closed_are_terminal() {
        let (a, mut b) = UnixStream::pair().unwrap();
        let mut p = FramedPeer::new(a).unwrap();
        b.write_all(&[0, 0]).unwrap();
        assert!(p.poll(Duration::ZERO).unwrap().is_none());
        assert_eq!(
            p.poll(Duration::from_secs(2)).unwrap_err(),
            IpcError::Timeout
        );
        assert_eq!(
            p.poll(Duration::from_secs(3)).unwrap_err(),
            IpcError::Closed
        );
        let (a, mut b) = UnixStream::pair().unwrap();
        let mut p = FramedPeer::new(a).unwrap();
        b.write_all(&((MAX_FRAME + 1) as u32).to_be_bytes())
            .unwrap();
        assert_eq!(p.poll(Duration::ZERO).unwrap_err(), IpcError::Protocol);
    }
    #[test]
    fn frames_roundtrip_without_pipelining_or_unbounded_queues() {
        let (a, b) = UnixStream::pair().unwrap();
        let mut a = FramedPeer::new(a).unwrap();
        let mut b = FramedPeer::new(b).unwrap();
        a.send(b"abc", Duration::ZERO).unwrap();
        a.poll(Duration::ZERO).unwrap();
        assert_eq!(b.poll(Duration::ZERO).unwrap().unwrap(), b"abc");
        b.send(b"def", Duration::ZERO).unwrap();
        assert_eq!(b.send(b"ghi", Duration::ZERO), Err(IpcError::Protocol));
    }
    #[test]
    fn protected_attempts_missing_corrupt_and_symlink_never_reset() {
        use std::os::unix::fs::symlink;
        let path =
            std::env::temp_dir().join(format!("absor-protected-store-{}", std::process::id()));
        private_directory(&path).unwrap();
        assert!(ProtectedAttemptStore::open(&path).is_err());
        private_create(
            &path.join("attempts.json"),
            &serde_json::to_vec(&AttemptState::provisioned()).unwrap(),
        )
        .unwrap();
        let mut store = ProtectedAttemptStore::open(&path).unwrap();
        store.commit(&AttemptState::provisioned()).unwrap();
        assert!(store.load().is_ok());
        private_create(&path.join("attempts.next"), b"interrupted").unwrap();
        assert_eq!(
            store.commit(&AttemptState::provisioned()),
            Err(AuthError::Storage)
        );
        fs::write(path.join("attempts.json"), b"corrupt").unwrap();
        assert!(store.load().is_err());
        fs::remove_file(path.join("attempts.json")).unwrap();
        assert!(store.load().is_err());
        let target = path.join("outside");
        private_create(&target, b"untouched").unwrap();
        symlink(&target, path.join("attempts.json")).unwrap();
        assert!(ProtectedAttemptStore::open(&path).is_err());
        assert_eq!(fs::read(target).unwrap(), b"untouched");
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn host_lock_excludes_a_second_verifier_and_releases_on_close() {
        let path = std::env::temp_dir().join(format!("absor-host-lock-{}", std::process::id()));
        private_directory(&path).unwrap();
        let first = HostLock::acquire(&path).unwrap();
        assert!(first.is_held());
        assert!(HostLock::acquire(&path).is_err());
        drop(first);
        let next = HostLock::acquire(&path).unwrap();
        assert!(next.is_held());
        drop(next);
        fs::remove_dir_all(path).unwrap();
    }
}
