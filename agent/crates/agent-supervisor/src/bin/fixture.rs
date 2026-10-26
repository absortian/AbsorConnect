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
    synthetic::start();
    let started = Instant::now();
    let mode = std::env::args_os()
        .last()
        .and_then(|v| std::fs::read_to_string(v).ok())
        .unwrap_or_default();
    loop {
        synthetic::before_poll();
        synthetic::pulse(1);
        println!("fixture-alive");
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
