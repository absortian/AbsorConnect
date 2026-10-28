use super::win::*;
use crate::wire::{Message, MAX_MESSAGE};
use std::{
    mem::zeroed,
    ptr::{null, null_mut},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{Pipes::*, Threading::*, IO::*},
};
#[link(name = "bcrypt")]
extern "system" {
    fn BCryptGenRandom(algorithm: isize, buffer: *mut u8, count: u32, flags: u32) -> i32;
}
struct Operation {
    ov: Box<OVERLAPPED>,
    _event: Handle,
}
impl Operation {
    fn new() -> Result<Self> {
        let event = Handle::new(unsafe { CreateEventW(null(), 1, 0, null()) }, 60)?;
        let mut ov: Box<OVERLAPPED> = Box::new(unsafe { zeroed() });
        ov.hEvent = event.0;
        Ok(Self { ov, _event: event })
    }
    fn result(&mut self, h: HANDLE, wait: bool) -> Result<Option<u32>> {
        let mut n = 0;
        if unsafe { GetOverlappedResult(h, &*self.ov, &mut n, i32::from(wait)) } != 0 {
            Ok(Some(n))
        } else if !wait && unsafe { GetLastError() } == ERROR_IO_INCOMPLETE {
            Ok(None)
        } else {
            Err(error(61))
        }
    }
    fn cancel(&mut self, h: HANDLE) {
        unsafe {
            CancelIoEx(h, &*self.ov);
            let mut n = 0;
            GetOverlappedResult(h, &*self.ov, &mut n, 1);
        }
    }
}
struct Read {
    op: Operation,
    bytes: Box<[u8; MAX_MESSAGE]>,
}
pub struct Channel {
    handle: Handle,
    read: Option<Read>,
}
impl Channel {
    pub fn name(parent: u32) -> Result<String> {
        let mut bytes = [0_u8; 16];
        ensure(
            unsafe { BCryptGenRandom(0, bytes.as_mut_ptr(), 16, 2) } >= 0,
            62,
        )?;
        Ok(format!(
            r"\\.\pipe\AbsorConnectSessionLab-{parent}-{}",
            bytes
                .iter()
                .flat_map(|v| {
                    let digits = b"0123456789abcdef";
                    [
                        char::from(digits[(v >> 4) as usize]),
                        char::from(digits[(v & 15) as usize]),
                    ]
                })
                .collect::<String>()
        ))
    }
    pub fn server(name: &str) -> Result<Self> {
        let mut sd = null_mut();
        ensure(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide("D:P(A;;GA;;;SY)(A;;GA;;;BA)").as_ptr(),
                    1,
                    &mut sd,
                    null_mut(),
                )
            } != 0,
            63,
        )?;
        let _sd = Local(sd);
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd,
            bInheritHandle: 0,
        };
        let handle = Handle::new(
            unsafe {
                CreateNamedPipeW(
                    wide(name).as_ptr(),
                    PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                    PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_REJECT_REMOTE_CLIENTS,
                    1,
                    4096,
                    4096,
                    0,
                    &sa,
                )
            },
            64,
        )?;
        Ok(Self { handle, read: None })
    }
    pub fn accept(&mut self, pid: u32, expected_session: u32, process: HANDLE) -> Result<()> {
        let mut op = Operation::new()?;
        let rc = unsafe { ConnectNamedPipe(self.handle.0, &mut *op.ov) };
        if rc == 0 {
            match unsafe { GetLastError() } {
                ERROR_PIPE_CONNECTED => {}
                ERROR_IO_PENDING => {
                    if unsafe { WaitForSingleObject(op.ov.hEvent, 1500) } != WAIT_OBJECT_0 {
                        op.cancel(self.handle.0);
                        return Err(WinError(65, 0));
                    }
                    op.result(self.handle.0, true)?;
                }
                _ => return Err(error(66)),
            }
        }
        let mut actual = 0;
        let mut seat = 0;
        ensure(
            unsafe { GetNamedPipeClientProcessId(self.handle.0, &mut actual) } != 0
                && actual == pid,
            67,
        )?;
        ensure(
            unsafe { GetNamedPipeClientSessionId(self.handle.0, &mut seat) } != 0
                && seat == expected_session
                && alive(process),
            68,
        )?;
        is_system(process)?;
        Ok(())
    }
    pub fn client(name: &str, parent: u32) -> Result<Self> {
        let prefix = format!(r"\\.\pipe\AbsorConnectSessionLab-{parent}-");
        let nonce = name.strip_prefix(&prefix).ok_or(WinError(69, 0))?;
        ensure(
            nonce.len() == 32 && nonce.bytes().all(|v| v.is_ascii_hexdigit()),
            70,
        )?;
        let handle = Handle::new(
            unsafe {
                CreateFileW(
                    wide(name).as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED,
                    0,
                )
            },
            71,
        )?;
        let mut actual = 0;
        ensure(
            unsafe { GetNamedPipeServerProcessId(handle.0, &mut actual) } != 0 && actual == parent,
            72,
        )?;
        let mode = PIPE_READMODE_MESSAGE;
        ensure(
            unsafe { SetNamedPipeHandleState(handle.0, &mode, null(), null()) } != 0,
            73,
        )?;
        Ok(Self { handle, read: None })
    }
    pub fn send(&mut self, message: &Message) -> Result<()> {
        let bytes = message.encode().map_err(|_| WinError(74, 0))?;
        let mut op = Operation::new()?;
        let mut written = 0;
        let rc = unsafe {
            WriteFile(
                self.handle.0,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                &mut *op.ov,
            )
        };
        if rc == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
            return Err(error(75));
        }
        if unsafe { WaitForSingleObject(op.ov.hEvent, 100) } != WAIT_OBJECT_0 {
            op.cancel(self.handle.0);
            return Err(WinError(76, 0));
        }
        let n = op.result(self.handle.0, true)?.ok_or(WinError(77, 0))?;
        ensure(n as usize == bytes.len(), 78)
    }
    pub fn receive(&mut self) -> Result<Option<Message>> {
        if self.read.is_none() {
            let mut read = Read {
                op: Operation::new()?,
                bytes: Box::new([0; MAX_MESSAGE]),
            };
            let mut n = 0;
            let rc = unsafe {
                ReadFile(
                    self.handle.0,
                    read.bytes.as_mut_ptr(),
                    MAX_MESSAGE as u32,
                    &mut n,
                    &mut *read.op.ov,
                )
            };
            if rc == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
                return Err(error(79));
            }
            self.read = Some(read);
        }
        let read = self.read.as_mut().ok_or(WinError(80, 0))?;
        match read.op.result(self.handle.0, false)? {
            None => Ok(None),
            Some(n) => {
                let read = self.read.take().ok_or(WinError(81, 0))?;
                ensure(n > 0 && n as usize <= MAX_MESSAGE, 82)?;
                Message::decode(&read.bytes[..n as usize])
                    .map(Some)
                    .map_err(|_| WinError(83, 0))
            }
        }
    }
}
impl Drop for Channel {
    fn drop(&mut self) {
        if let Some(mut read) = self.read.take() {
            read.op.cancel(self.handle.0);
        }
    }
}
pub fn pause() {
    std::thread::sleep(Duration::from_millis(20));
}
