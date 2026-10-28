//! Transporte de un descriptor local. No autentica al par ni autoriza entregar un secreto.
//! El llamador valida SO_PEERCRED/unidad y el permiso antes de usarlo; nunca se expone por red.
use crate::linux::IpcError;
use std::{
    fs::File,
    io::{Seek, SeekFrom, Write},
    mem,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{fs::PermissionsExt, net::UnixStream},
    },
    ptr,
};
const MARKER: u8 = b'A';
const MAX_RIGHTS: usize = 4;

pub fn sealed_file(bytes: &[u8]) -> Result<File, IpcError> {
    if bytes.is_empty() || bytes.len() > 256 {
        return Err(IpcError::Protocol);
    }
    // SAFETY: nombre estático terminado en NUL; el descriptor se toma una sola vez.
    let fd = unsafe {
        libc::memfd_create(
            b"absorconnect-local-authority\0".as_ptr().cast(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        )
    };
    if fd < 0 {
        return Err(IpcError::Io);
    }
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let mut file = File::from(owned);
    file.write_all(bytes).map_err(|_| IpcError::Io)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o400))
        .map_err(|_| IpcError::Io)?;
    let flags = libc::F_SEAL_WRITE | libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL;
    // SAFETY: fd propio vivo; fcntl recibe solo la máscara de sellos, sin punteros.
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, flags) } != 0 {
        return Err(IpcError::Io);
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| IpcError::Io)?;
    Ok(file)
}
pub fn seals(file: &File) -> Result<i32, IpcError> {
    // SAFETY: consulta escalar a un descriptor vivo prestado.
    let value = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GET_SEALS) };
    if value < 0 {
        Err(IpcError::Protocol)
    } else {
        Ok(value)
    }
}
pub fn send(socket: &UnixStream, file: &File) -> Result<(), IpcError> {
    send_rights(socket, &[file.as_raw_fd()], MARKER)
}
fn send_rights(socket: &UnixStream, files: &[i32], marker: u8) -> Result<(), IpcError> {
    if files.is_empty() || files.len() > MAX_RIGHTS + 2 {
        return Err(IpcError::Protocol);
    }
    let bytes = mem::size_of_val(files);
    // SAFETY: longitud pequeña y acotada; la ABI calcula el espacio de control alineado.
    let space = unsafe { libc::CMSG_SPACE(bytes as u32) } as usize;
    let mut control = vec![0usize; space.div_ceil(mem::size_of::<usize>())];
    let mut data = [marker];
    let mut io = libc::iovec {
        iov_base: data.as_mut_ptr().cast(),
        iov_len: 1,
    };
    // SAFETY: msghdr es una estructura C de punteros/enteros; sus salidas empiezan en cero.
    let mut message: libc::msghdr = unsafe { mem::zeroed() };
    message.msg_iov = &mut io;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = space;
    // SAFETY: buffers propios alineados y de espacio CMSG_SPACE; copias dentro de sus límites.
    unsafe {
        let header = libc::CMSG_FIRSTHDR(&message);
        if header.is_null() {
            return Err(IpcError::Protocol);
        }
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(bytes as u32) as usize;
        ptr::copy_nonoverlapping(files.as_ptr().cast::<u8>(), libc::CMSG_DATA(header), bytes);
        let result = libc::sendmsg(socket.as_raw_fd(), &message, libc::MSG_NOSIGNAL);
        if result == 1 {
            Ok(())
        } else if result < 0 {
            Err(io_error())
        } else {
            Err(IpcError::Closed)
        }
    }
}
pub fn receive(socket: &UnixStream) -> Result<File, IpcError> {
    // Reservar varios para poder cerrar todos los recibidos al rechazar multiplicidad/truncamiento.
    let space = unsafe { libc::CMSG_SPACE((MAX_RIGHTS * mem::size_of::<i32>()) as u32) } as usize;
    let mut control = vec![0usize; space.div_ceil(mem::size_of::<usize>())];
    let mut data = [0u8; 1];
    let mut io = libc::iovec {
        iov_base: data.as_mut_ptr().cast(),
        iov_len: 1,
    };
    let mut message: libc::msghdr = unsafe { mem::zeroed() };
    message.msg_iov = &mut io;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = space;
    // SAFETY: buffers vivos propios y alineados. CLOEXEC se aplica atómicamente al recibir.
    let size = unsafe { libc::recvmsg(socket.as_raw_fd(), &mut message, libc::MSG_CMSG_CLOEXEC) };
    if size < 0 {
        return Err(io_error());
    }
    if size == 0 {
        return Err(IpcError::Closed);
    }
    let mut received = Vec::<OwnedFd>::new();
    let mut unsupported = false;
    // SAFETY: el kernel ha rellenado cmsghdr; se comprueban límites antes de leer cada carga.
    unsafe {
        let mut header = libc::CMSG_FIRSTHDR(&message);
        while !header.is_null() {
            let offset = (header as usize)
                .checked_sub(message.msg_control as usize)
                .ok_or(IpcError::Protocol)?;
            let length = (*header).cmsg_len as usize;
            let empty = libc::CMSG_LEN(0) as usize;
            if length < empty
                || offset.checked_add(length).ok_or(IpcError::Protocol)? > message.msg_controllen
            {
                return Err(IpcError::Protocol);
            }
            if (*header).cmsg_level == libc::SOL_SOCKET && (*header).cmsg_type == libc::SCM_RIGHTS {
                let payload = length - empty;
                if payload % mem::size_of::<i32>() != 0 {
                    return Err(IpcError::Protocol);
                }
                for index in 0..payload / mem::size_of::<i32>() {
                    let fd = ptr::read_unaligned(
                        libc::CMSG_DATA(header)
                            .add(index * mem::size_of::<i32>())
                            .cast::<i32>(),
                    );
                    if fd < 0 {
                        return Err(IpcError::Protocol);
                    }
                    // Cada entero de SCM_RIGHTS es un descriptor nuevo de este proceso.
                    received.push(OwnedFd::from_raw_fd(fd));
                }
            } else {
                unsupported = true;
            }
            header = libc::CMSG_NXTHDR(&message, header);
        }
    }
    if unsupported
        || message.msg_flags & (libc::MSG_CTRUNC | libc::MSG_TRUNC) != 0
        || data[0] != MARKER
        || received.len() != 1
    {
        return Err(IpcError::Protocol);
    }
    Ok(File::from(received.pop().ok_or(IpcError::Protocol)?))
}
fn io_error() -> IpcError {
    match std::io::Error::last_os_error().kind() {
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => IpcError::Timeout,
        _ => IpcError::Io,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Read,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::Duration,
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        dir: PathBuf,
        file: File,
    }
    impl Fixture {
        fn new() -> Self {
            use std::os::unix::fs::DirBuilderExt;
            let dir = std::env::temp_dir().join(format!(
                "absor-fd-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(dir.join("source"))
                .unwrap();
            Self { dir, file }
        }
        fn references(&self) -> usize {
            std::fs::read_dir("/proc/self/fd")
                .unwrap()
                .flatten()
                .filter(|item| {
                    std::fs::read_link(item.path()).ok() == Some(self.dir.join("source"))
                })
                .count()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_file(self.dir.join("source")).unwrap();
            std::fs::remove_dir(&self.dir).unwrap();
        }
    }
    #[test]
    fn descriptor_received_with_cloexec_and_same_contents() {
        let (a, b) = UnixStream::pair().unwrap();
        let mut file = sealed_file(b"public fixture").unwrap();
        send(&a, &file).unwrap();
        let mut got = receive(&b).unwrap();
        let mut data = Vec::new();
        got.read_to_end(&mut data).unwrap();
        assert_eq!(data, b"public fixture");
        assert_ne!(
            unsafe { libc::fcntl(got.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC,
            0
        );
        assert!(file.write_all(b"x").is_err());
        assert!(file.set_len(0).is_err());
    }
    #[test]
    fn wrong_marker_closes_received_descriptor() {
        let (a, b) = UnixStream::pair().unwrap();
        let fixture = Fixture::new();
        send_rights(&a, &[fixture.file.as_raw_fd()], b'X').unwrap();
        assert!(matches!(receive(&b), Err(IpcError::Protocol)));
        assert_eq!(fixture.references(), 1);
    }
    #[test]
    fn multiple_descriptors_are_closed_on_rejection() {
        for count in [2, MAX_RIGHTS, MAX_RIGHTS + 2] {
            let (a, b) = UnixStream::pair().unwrap();
            let fixture = Fixture::new();
            send_rights(&a, &vec![fixture.file.as_raw_fd(); count], MARKER).unwrap();
            assert!(matches!(receive(&b), Err(IpcError::Protocol)));
            assert_eq!(fixture.references(), 1);
        }
    }
    #[test]
    fn plain_data_without_descriptor_never_becomes_authority() {
        let (mut a, b) = UnixStream::pair().unwrap();
        a.write_all(&[MARKER]).unwrap();
        assert!(matches!(receive(&b), Err(IpcError::Protocol)));
    }
    #[test]
    fn missing_data_times_out_and_eof_is_not_a_descriptor() {
        let (a, b) = UnixStream::pair().unwrap();
        b.set_read_timeout(Some(Duration::from_millis(10))).unwrap();
        assert!(matches!(receive(&b), Err(IpcError::Timeout)));
        drop(a);
        assert!(matches!(receive(&b), Err(IpcError::Closed)));
    }
    #[test]
    fn empty_oversize_and_additional_seal_mutations_fail() {
        assert!(sealed_file(&[]).is_err());
        assert!(sealed_file(&[0; 257]).is_err());
        let file = sealed_file(b"test").unwrap();
        assert_ne!(seals(&file).unwrap() & libc::F_SEAL_WRITE, 0);
        assert_eq!(
            unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, 0) },
            -1
        );
    }
}
