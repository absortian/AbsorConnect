use super::{ipc::Channel, win::*};
use crate::{
    wire::{Body, Message},
    Assignment,
};
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_supervisor::PeerWatch;
use std::{
    mem::{size_of, zeroed},
    ptr::null,
    time::Duration,
};
use windows_sys::Win32::{
    Security::*,
    System::{JobObjects::*, Threading::*},
};
pub struct Child {
    pub process: Handle,
    pub pid: u32,
    pub channel: Channel,
    _job: Handle,
    pub watch: PeerWatch<BootClock>,
    sequence: u64,
    pub seat: u32,
}
impl Child {
    pub fn spawn(worker: Option<Assignment>) -> Result<Self> {
        let seat = worker.map_or(0, |a| a.session().value());
        let binary = if worker.is_some() {
            "absor-win-session-worker-lab.exe"
        } else {
            "absor-win-session-monitor-lab.exe"
        };
        let path = file(binary);
        protected(&path, false)?;
        let parent = unsafe { GetCurrentProcessId() };
        let name = Channel::name(parent)?;
        let channel = Channel::server(&name)?;
        let args = format!(
            "\"{}\" --pipe {name} --parent {parent} --session {seat}",
            path.display()
        );
        let mut args = wide(&args);
        let t = token(
            unsafe { GetCurrentProcess() },
            TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_SESSIONID,
        )?;
        let mut primary = 0;
        ensure(
            unsafe {
                DuplicateTokenEx(
                    t.0,
                    TOKEN_ALL_ACCESS,
                    null(),
                    SecurityImpersonation,
                    TokenPrimary,
                    &mut primary,
                )
            } != 0,
            90,
        )?;
        let primary = Handle::new(primary, 91)?;
        ensure(
            unsafe {
                SetTokenInformation(
                    primary.0,
                    TokenSessionId,
                    (&seat as *const u32).cast(),
                    size_of::<u32>() as u32,
                )
            } != 0,
            92,
        )?;
        let job = Handle::new(unsafe { CreateJobObjectW(null(), null()) }, 93)?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
        ensure(
            unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            } != 0,
            94,
        )?;
        let mut info: STARTUPINFOW = unsafe { zeroed() };
        info.cb = size_of::<STARTUPINFOW>() as u32;
        let mut desktop = wide(if worker.is_some() {
            r"winsta0\default"
        } else {
            ""
        });
        if worker.is_some() {
            info.lpDesktop = desktop.as_mut_ptr();
        }
        let mut pi: PROCESS_INFORMATION = unsafe { zeroed() };
        let env: Vec<u16> = "SystemRoot=C:\\Windows\0WINDIR=C:\\Windows\0\0"
            .encode_utf16()
            .collect();
        ensure(
            unsafe {
                CreateProcessAsUserW(
                    primary.0,
                    wide(path.to_str().ok_or(WinError(95, 0))?).as_ptr(),
                    args.as_mut_ptr(),
                    null(),
                    null(),
                    0,
                    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                    env.as_ptr().cast(),
                    wide(ROOT).as_ptr(),
                    &info,
                    &mut pi,
                )
            } != 0,
            96,
        )?;
        let process = Handle::new(pi.hProcess, 97)?;
        let thread = Handle::new(pi.hThread, 98)?;
        // El hijo no se ejecuta antes de entrar en el Job; ningún handle se hereda.
        if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
            terminate(process.0);
            return Err(error(99));
        }
        let mut value = Self {
            process,
            pid: pi.dwProcessId,
            channel,
            _job: job,
            watch: PeerWatch::new(BootClock, Duration::from_secs(5))
                .map_err(|_| WinError(100, 0))?,
            sequence: 0,
            seat,
        };
        if worker.is_some() {
            ensure(
                unsafe {
                    windows_sys::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId()
                } == seat,
                101,
            )?;
        }
        ensure(unsafe { ResumeThread(thread.0) } != u32::MAX, 102)?;
        value.channel.accept(value.pid, seat, value.process.0)?;
        Ok(value)
    }
    pub fn send(&mut self, body: Body) -> Result<()> {
        self.sequence = self.sequence.checked_add(1).ok_or(WinError(103, 0))?;
        self.channel.send(
            &Message::new(
                self.sequence,
                BootClock.now().map_err(|_| WinError(104, 0))?,
                body,
            )
            .map_err(|_| WinError(105, 0))?,
        )
    }
    pub fn poll(&mut self) -> Result<Option<Message>> {
        ensure(alive(self.process.0), 106)?;
        self.watch.poll().map_err(|_| WinError(107, 0))?;
        let value = self.channel.receive()?;
        if let Some(value) = &value {
            self.watch
                .receive(value.pulse().map_err(|_| WinError(108, 0))?)
                .map_err(|_| WinError(109, 0))?;
        }
        Ok(value)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        terminate(self.process.0);
    }
}
