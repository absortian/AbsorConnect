use super::{
    child::Child,
    ipc::{pause, Channel},
    win::*,
};
use crate::{
    wire::{Body, Desktop, Message},
    Lifecycle, SessionId,
};
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_supervisor::{PeerWatch, HEARTBEAT_INTERVAL};
use serde::Serialize;
use std::{
    ffi::c_void,
    ptr::{null, null_mut},
    sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::*,
    Security::*,
    System::{RemoteDesktop::*, Services::*, StationsAndDesktops::*, Threading::*},
};
static STOP: AtomicBool = AtomicBool::new(false);
static EPOCH: AtomicU64 = AtomicU64::new(0);
static INJECT: AtomicU32 = AtomicU32::new(0);
static STATUS: AtomicIsize = AtomicIsize::new(0);
fn publish(state: u32, code: u32) -> Result<()> {
    let value = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SESSIONCHANGE
        } else {
            0
        },
        dwWin32ExitCode: if code == 0 {
            0
        } else {
            ERROR_SERVICE_SPECIFIC_ERROR
        },
        dwServiceSpecificExitCode: code,
        dwCheckPoint: if state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING {
            1
        } else {
            0
        },
        dwWaitHint: if state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING {
            5000
        } else {
            0
        },
    };
    ensure(
        unsafe { SetServiceStatus(STATUS.load(Ordering::SeqCst), &value) } != 0,
        110,
    )
}
unsafe extern "system" fn handler(
    control: u32,
    _event: u32,
    _data: *mut c_void,
    _context: *mut c_void,
) -> u32 {
    match control {
        SERVICE_CONTROL_STOP => {
            STOP.store(true, Ordering::SeqCst);
            let _ = publish(SERVICE_STOP_PENDING, 0);
            0
        }
        SERVICE_CONTROL_SESSIONCHANGE => {
            if EPOCH
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_add(1))
                .is_err()
            {
                STOP.store(true, Ordering::SeqCst);
            }
            0
        }
        SERVICE_CONTROL_INTERROGATE => 0,
        // Inyección cerrada de fallos, disponible solo con el ACL administrativo de SCM.
        128..=130 => {
            INJECT.store(control, Ordering::SeqCst);
            0
        }
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}
pub fn service_run() -> Result<()> {
    current_system()?;
    // Registrar primero con SCM permite clasificar una configuración dañada
    // como STOPPED/78, sin confundirla con la caída inesperada de un servicio.
    ensure(
        std::env::current_exe().map_err(|_| error(28))? == file("absor-win-sessiond-lab.exe"),
        29,
    )?;
    ensure(std::env::args_os().count() == 1, 111)?;
    let mut name = wide(SERVICE);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: name.as_mut_ptr(),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW {
            lpServiceName: null_mut(),
            lpServiceProc: None,
        },
    ];
    ensure(
        unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } != 0,
        112,
    )
}
unsafe extern "system" fn service_main(argc: u32, argv: *mut *mut u16) {
    let h = unsafe { RegisterServiceCtrlHandlerExW(wide(SERVICE).as_ptr(), Some(handler), null()) };
    if h == 0 {
        return;
    }
    STATUS.store(h, Ordering::SeqCst);
    let setup = (|| -> Result<bool> {
        publish(SERVICE_START_PENDING, 0)?;
        validate_install("absor-win-sessiond-lab.exe")?;
        ensure(session(unsafe { GetCurrentProcessId() })? == 0, 113)?;
        ensure(argc == 1 || argc == 2, 114)?;
        if argc == 2 {
            ensure(!argv.is_null(), 115)?;
            let ptr = unsafe { *argv.add(1) };
            ensure(!ptr.is_null(), 116)?;
            let mut value = Vec::new();
            for i in 0..8 {
                let c = unsafe { *ptr.add(i) };
                if c == 0 {
                    break;
                }
                value.push(c);
            }
            ensure(value == "resume".encode_utf16().collect::<Vec<_>>(), 117)?;
            resume()?;
        }
        if disabled()? {
            return Ok(false);
        }
        enable_privileges()?;
        Ok(true)
    })();
    match setup {
        Ok(false) => {
            let _ = publish(SERVICE_STOPPED, 0);
        }
        Err(e) => {
            let _ = report(
                "failure.json",
                &Failure {
                    schema: 1,
                    stage: e.0,
                    os_code: e.1,
                },
            );
            let _ = publish(SERVICE_STOPPED, 78);
        }
        Ok(true) => {
            match run_actor() {
                Ok(()) => {
                    let _ = publish(SERVICE_STOPPED, 0);
                }
                Err(e) => {
                    let _ = report(
                        "failure.json",
                        &Failure {
                            schema: 1,
                            stage: e.0,
                            os_code: e.1,
                        },
                    );
                    // El SO cierra los Jobs aun si el actor no puede completar su limpieza.
                    // No se declara STOPPED: SCM aplicará su política finita de recuperación.
                    std::process::exit(70);
                }
            }
        }
    }
}
#[derive(Serialize)]
struct Failure {
    schema: u32,
    stage: u32,
    os_code: u32,
}
#[derive(Serialize)]
struct Snapshot {
    schema: u32,
    process: u32,
    console: Option<u32>,
    epoch: u64,
    generation: u64,
    worker: Option<u32>,
    worker_session: Option<u32>,
    worker_starts: u64,
    monitor: u32,
    desktop: Desktop,
    stopped: bool,
    ready_for_unattended: bool,
    capture_tested: bool,
    input_tested: bool,
}
fn now() -> Result<Duration> {
    BootClock.now().map_err(|_| WinError(118, 0))
}
fn run_actor() -> Result<()> {
    let mut lifecycle = Lifecycle::new(BootClock).map_err(|_| WinError(119, 0))?;
    // SCM solo garantiza el PID en RUNNING; el monitor lo verifica al conectarse.
    // La disponibilidad sigue falsa hasta completar la matriz del host final.
    publish(SERVICE_RUNNING, 0)?;
    let mut monitor = Child::spawn(None)?;
    let mut worker: Option<Child> = None;
    let mut snapshot = Snapshot {
        schema: 1,
        process: unsafe { GetCurrentProcessId() },
        console: None,
        epoch: 0,
        generation: 0,
        worker: None,
        worker_session: None,
        worker_starts: 0,
        monitor: monitor.pid,
        desktop: Desktop::Unavailable,
        stopped: false,
        ready_for_unattended: false,
        capture_tested: false,
        input_tested: false,
    };
    let mut next_pulse = Duration::ZERO;
    let mut next_report = Duration::ZERO;
    loop {
        if STOP.load(Ordering::SeqCst) {
            // Se persiste antes de tocar el Job o el par; un reinicio por SCM no lo borra.
            mark_stopped()?;
            lifecycle.stop();
            if let Some(child) = worker.as_mut() {
                let _ = child.send(Body::Shutdown {});
            }
            worker.take();
            let _ = monitor.send(Body::Shutdown {});
            snapshot.worker = None;
            snapshot.worker_session = None;
            snapshot.stopped = true;
            snapshot.desktop = Desktop::Unavailable;
            report("status.json", &snapshot)?;
            return Ok(());
        }
        let fault = INJECT.swap(0, Ordering::SeqCst);
        match fault {
            128 => {
                if let Some(child) = worker.as_mut() {
                    child.send(Body::Hang {})?;
                }
            }
            129 => monitor.send(Body::Hang {})?,
            130 => loop {
                pause();
            },
            _ => {}
        }
        if let Some(value) = monitor.poll()? {
            ensure(matches!(value.body, Body::Pulse {}), 120)?;
        }
        if let Some(child) = worker.as_mut() {
            match child.poll() {
                Ok(Some(value)) => match value.body {
                    Body::Status { session, desktop } if session == child.seat => {
                        snapshot.desktop = desktop;
                    }
                    _ => {
                        worker.take();
                    }
                },
                Ok(None) => {}
                Err(_) => {
                    worker.take();
                    snapshot.desktop = Desktop::Unavailable;
                }
            }
        }
        let epoch = EPOCH.load(Ordering::SeqCst);
        let console = SessionId::from_console(unsafe { WTSGetActiveConsoleSessionId() });
        let plan = lifecycle
            .advance(
                console,
                epoch,
                worker.as_ref().is_some_and(|c| alive(c.process.0)),
            )
            .map_err(|_| WinError(121, 0))?;
        if plan.stop_worker {
            worker.take();
            snapshot.desktop = Desktop::Unavailable;
        }
        if let Some(assignment) = plan.start {
            let spawned = Child::spawn(Some(assignment));
            // Una notificación durante CreateProcess invalida el hijo antes de publicarlo.
            let valid = EPOCH.load(Ordering::SeqCst) == epoch
                && unsafe { WTSGetActiveConsoleSessionId() } == assignment.session().value()
                && !STOP.load(Ordering::SeqCst);
            match spawned {
                Ok(child) if valid => {
                    snapshot.generation = assignment.generation();
                    snapshot.worker_starts = snapshot
                        .worker_starts
                        .checked_add(1)
                        .ok_or(WinError(122, 0))?;
                    worker = Some(child);
                    lifecycle
                        .started(assignment, true)
                        .map_err(|_| WinError(123, 0))?;
                }
                value => {
                    drop(value);
                    lifecycle
                        .started(assignment, false)
                        .map_err(|_| WinError(124, 0))?;
                }
            }
        }
        snapshot.console = console.map(SessionId::value);
        snapshot.epoch = epoch;
        snapshot.worker = worker.as_ref().map(|c| c.pid);
        snapshot.worker_session = worker.as_ref().map(|c| c.seat);
        let time = now()?;
        if time >= next_pulse {
            monitor.send(Body::Pulse {})?;
            if let Some(child) = worker.as_mut() {
                if child.send(Body::Pulse {}).is_err() {
                    worker.take();
                }
            }
            next_pulse = time
                .checked_add(HEARTBEAT_INTERVAL)
                .ok_or(WinError(125, 0))?;
        }
        if time >= next_report {
            report("status.json", &snapshot)?;
            next_report = time
                .checked_add(Duration::from_millis(500))
                .ok_or(WinError(126, 0))?;
        }
        pause();
    }
}
fn enable_privileges() -> Result<()> {
    let t = token(
        unsafe { GetCurrentProcess() },
        TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
    )?;
    for name in [
        "SeTcbPrivilege",
        "SeAssignPrimaryTokenPrivilege",
        "SeIncreaseQuotaPrivilege",
    ] {
        let mut luid = LUID {
            LowPart: 0,
            HighPart: 0,
        };
        ensure(
            unsafe { LookupPrivilegeValueW(null(), wide(name).as_ptr(), &mut luid) } != 0,
            127,
        )?;
        let privileges = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        unsafe {
            SetLastError(0);
        }
        ensure(
            unsafe { AdjustTokenPrivileges(t.0, 0, &privileges, 0, null_mut(), null_mut()) } != 0
                && unsafe { GetLastError() } == 0,
            128,
        )?;
    }
    Ok(())
}
fn args(worker: bool) -> Result<(String, u32, u32)> {
    let values: Vec<String> = std::env::args().skip(1).collect();
    ensure(
        values.len() == 6
            && values[0] == "--pipe"
            && values[2] == "--parent"
            && values[4] == "--session",
        129,
    )?;
    let pid = values[3].parse::<u32>().map_err(|_| WinError(130, 0))?;
    let seat = values[5].parse::<u32>().map_err(|_| WinError(131, 0))?;
    ensure(
        pid != 0
            && if worker {
                SessionId::from_console(seat).is_some()
            } else {
                seat == 0
            },
        132,
    )?;
    ensure(session(unsafe { GetCurrentProcessId() })? == seat, 133)?;
    Ok((values[1].clone(), pid, seat))
}
fn desktop() -> Desktop {
    let h = unsafe { OpenInputDesktop(0, 0, DESKTOP_READOBJECTS) };
    if h == 0 {
        return Desktop::Unavailable;
    }
    let mut data = [0_u16; 32];
    let mut n = 0;
    let rc = unsafe {
        GetUserObjectInformationW(
            h,
            UOI_NAME,
            data.as_mut_ptr().cast(),
            (data.len() * 2) as u32,
            &mut n,
        )
    };
    unsafe {
        CloseDesktop(h);
    }
    if rc == 0 || n < 2 || n as usize > data.len() * 2 {
        return Desktop::Unavailable;
    }
    let name = String::from_utf16_lossy(&data[..n as usize / 2 - 1]);
    if name.eq_ignore_ascii_case("default") {
        Desktop::Default
    } else if name.eq_ignore_ascii_case("winlogon") {
        Desktop::Winlogon
    } else {
        Desktop::Unavailable
    }
}
pub fn worker_run() -> Result<()> {
    let value = run_peer(true);
    if let Err(e) = &value {
        let _ = report(
            "worker-failure.json",
            &Failure {
                schema: 1,
                stage: e.0,
                os_code: e.1,
            },
        );
    }
    value
}
pub fn monitor_run() -> Result<()> {
    run_peer(false)
}
fn run_peer(worker: bool) -> Result<()> {
    validate_install(if worker {
        "absor-win-session-worker-lab.exe"
    } else {
        "absor-win-session-monitor-lab.exe"
    })?;
    let (name, parent, seat) = args(worker)?;
    let process = peer_parent(parent, !worker)?;
    let mut channel = Channel::client(&name, parent)?;
    // El trabajador arranca sin privilegios habilitados y su Job impide hijos.
    // Sigue siendo SYSTEM: este perfil no aísla un transporte de red definitivo.
    if worker {
        drop_privileges()?;
    }
    let mut watch =
        PeerWatch::new(BootClock, Duration::from_secs(5)).map_err(|_| WinError(134, 0))?;
    let mut sequence = 0_u64;
    let mut next = Duration::ZERO;
    loop {
        let outcome = (|| -> Result<bool> {
            ensure(alive(process.0), 135)?;
            if worker {
                ensure(unsafe { WTSGetActiveConsoleSessionId() } == seat, 136)?;
            }
            watch.poll().map_err(|_| WinError(137, 0))?;
            if let Some(value) = channel.receive()? {
                watch
                    .receive(value.pulse().map_err(|_| WinError(138, 0))?)
                    .map_err(|_| WinError(139, 0))?;
                match value.body {
                    Body::Shutdown {} => return Ok(true),
                    Body::Hang {} => loop {
                        pause();
                    },
                    Body::Pulse {} => {}
                    _ => return Err(WinError(140, 0)),
                }
            }
            let time = now()?;
            if time >= next {
                sequence = sequence.checked_add(1).ok_or(WinError(141, 0))?;
                let body = if worker {
                    Body::Status {
                        session: seat,
                        desktop: desktop(),
                    }
                } else {
                    Body::Pulse {}
                };
                channel.send(&Message::new(sequence, time, body).map_err(|_| WinError(142, 0))?)?;
                next = time
                    .checked_add(HEARTBEAT_INTERVAL)
                    .ok_or(WinError(143, 0))?;
            }
            Ok(false)
        })();
        match outcome {
            Ok(true) => return Ok(()),
            Ok(false) => pause(),
            Err(e) => {
                if !worker && alive(process.0) {
                    // Si STOP llegó a SCM con el actor congelado, conserva la desactivación.
                    // STOP_PENDING no garantiza dwProcessId. El handle del padre
                    // ya quedó fijado contra SCM cuando estaba en RUNNING.
                    if scm_state().is_ok_and(|s| s.dwCurrentState == SERVICE_STOP_PENDING) {
                        let _ = mark_stopped();
                    }
                    let _ = report(
                        "monitor-failure.json",
                        &Failure {
                            schema: 1,
                            stage: e.0,
                            os_code: e.1,
                        },
                    );
                    terminate(process.0);
                }
                return Err(e);
            }
        }
    }
}
