//! Hijo artificial de las pruebas de procesos; jamás captura ni envía entrada.
#![deny(unsafe_code)]
use absor_agent_supervisor::synthetic;
use std::{
    thread,
    time::{Duration, Instant},
};
// Solo el descriptor heredado de este ejecutable artificial, sin datos externos.
#[allow(unsafe_code)]
mod teardown {
    #[cfg(unix)]
    pub fn stdin_eof() {
        use std::os::fd::AsRawFd;
        extern "C" {
            fn close(fd: i32) -> i32;
        }
        // SAFETY: descriptor propio; este modo no inicia un lector ni vuelve a usarlo.
        unsafe {
            close(std::io::stdin().as_raw_fd());
        }
    }
    #[cfg(windows)]
    pub fn stdin_eof() {
        use std::os::windows::io::AsRawHandle;
        #[link(name = "kernel32")]
        extern "system" {
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        // SAFETY: handle propio del fixture, sin lector iniciado en este modo.
        unsafe {
            CloseHandle(std::io::stdin().as_raw_handle());
        }
    }
    #[cfg(unix)]
    pub fn stderr_eof() {
        use std::os::fd::AsRawFd;
        extern "C" {
            fn close(fd: i32) -> i32;
        }
        // SAFETY: descriptor propio; el fixture no vuelve a escribir tras cerrarlo.
        unsafe {
            close(std::io::stderr().as_raw_fd());
        }
    }
    #[cfg(windows)]
    pub fn stderr_eof() {
        use std::os::windows::io::AsRawHandle;
        #[link(name = "kernel32")]
        extern "system" {
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        // SAFETY: handle de stderr propio, heredado del supervisor. No se reutiliza.
        unsafe {
            CloseHandle(std::io::stderr().as_raw_handle());
        }
    }
}
fn main() {
    let started = Instant::now();
    let config = std::env::args_os().last().map(std::path::PathBuf::from);
    let mode = std::env::args_os()
        .last()
        .and_then(|v| std::fs::read_to_string(v).ok())
        .unwrap_or_default();
    if ["normal-write-eof", "fault-write-eof"].contains(&mode.as_str()) {
        use absor_agent_core::clock::{BootClock, Clock};
        use absor_agent_supervisor::Pulse;
        use std::io::{BufRead, Write};
        // El primer pulso confirma que el supervisor ya vigila al hijo.
        println!("fixture-alive");
        std::io::stderr()
            .write_all(
                Pulse::new(1, BootClock.now().unwrap())
                    .unwrap()
                    .encode()
                    .as_bytes(),
            )
            .unwrap();
        let mut line = String::new();
        {
            let mut reader = std::io::BufReader::new(std::io::stdin());
            reader.read_line(&mut line).unwrap();
        }
        Pulse::parse(line.as_bytes()).unwrap();
        let close_started = Instant::now();
        let mut sequence = 2;
        while close_started.elapsed() < Duration::from_millis(300) {
            std::io::stderr()
                .write_all(
                    Pulse::new(sequence, BootClock.now().unwrap())
                        .unwrap()
                        .encode()
                        .as_bytes(),
                )
                .unwrap();
            println!("fixture-alive");
            sequence += 1;
            thread::sleep(Duration::from_millis(50));
        }
        teardown::stdin_eof();
        thread::sleep(if mode == "normal-write-eof" {
            Duration::from_millis(180)
        } else {
            Duration::from_secs(5)
        });
        return;
    }
    synthetic::start();
    let broker_fixture = mode.starts_with('{')
        && std::env::var_os("ABSOR_LAB_BROKER_WATCH").as_deref() == Some(std::ffi::OsStr::new("1"));
    loop {
        synthetic::before_poll();
        synthetic::pulse(1);
        if broker_fixture {
            if config
                .as_ref()
                .and_then(|v| v.parent())
                .is_some_and(|v| v.join("finish-artificial-session").is_file())
            {
                println!(
                    "{}",
                    serde_json::json!({"authenticated":false,"apiCutCode":0,"fixtureOnly":true})
                );
                return;
            }
        } else {
            println!("fixture-alive");
        }
        if ["normal-eof", "fault-eof"].contains(&mode.as_str())
            && started.elapsed() > Duration::from_millis(300)
        {
            teardown::stderr_eof();
            thread::sleep(if mode == "normal-eof" {
                Duration::from_millis(80)
            } else {
                Duration::from_secs(5)
            });
            return;
        }
        if mode == "normal" && started.elapsed() > Duration::from_millis(300) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}
