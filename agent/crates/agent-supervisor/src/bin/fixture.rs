//! Hijo artificial de las pruebas de procesos; jamás captura ni envía entrada.
#![deny(unsafe_code)]
use absor_agent_supervisor::synthetic;
use std::{
    thread,
    time::{Duration, Instant},
};
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
        if mode == "normal" && started.elapsed() > Duration::from_millis(300) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}
