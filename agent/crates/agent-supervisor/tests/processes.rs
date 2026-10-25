#![cfg(feature = "synthetic-lab")]
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
struct Scratch(PathBuf);
static NEXT: AtomicU64 = AtomicU64::new(1);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn run(fault: Option<u8>) -> (i32, String, Duration) {
    let candidate = std::env::temp_dir().join(format!(
        "absor-supervisor-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&candidate).unwrap();
    // Solo limpiar después de adquirir este directorio en exclusiva.
    let scratch = Scratch(candidate);
    let worker = scratch.0.join(format!(
        "rust_video_channel_check{}",
        std::env::consts::EXE_SUFFIX
    ));
    fs::copy(env!("CARGO_BIN_EXE_absor-lab-worker-fixture"), &worker).unwrap();
    let config = scratch.0.join("config.json");
    fs::write(&config, if fault.is_none() { "normal" } else { "fault" }).unwrap();
    let report = scratch.0.join("events.jsonl");
    let mut child = Command::new(env!("CARGO_BIN_EXE_absor-lab-supervisor"))
        .args([
            &report,
            &worker,
            &scratch.0.join("offer.sdp"),
            &scratch.0.join("answer.sdp"),
            &config,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let (ready, first) = std::sync::mpsc::sync_channel(1);
    // Drenaje separado: una espera no puede ocultar un pipe de salida lleno.
    let drained = thread::spawn(move || {
        let mut first = String::new();
        output.read_line(&mut first).unwrap();
        let _ = ready.send(first);
        let mut rest = String::new();
        output.read_to_string(&mut rest).unwrap();
        rest
    });
    assert_eq!(
        first.recv_timeout(Duration::from_secs(5)).unwrap(),
        "fixture-alive\n"
    );
    let started = Instant::now();
    if let Some(fault) = fault {
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(&[fault, b'\n'])
            .unwrap();
    }
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if started.elapsed() > Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("supervisor no terminó");
        }
        thread::sleep(Duration::from_millis(10));
    };
    // El descriptor heredado solo alcanza EOF cuando también termina el trabajador.
    while !drained.is_finished() {
        assert!(
            started.elapsed() < Duration::from_secs(8),
            "trabajador huérfano"
        );
        thread::sleep(Duration::from_millis(10));
    }
    drained.join().unwrap();
    (
        status.code().unwrap(),
        fs::read_to_string(&report).unwrap(),
        started.elapsed(),
    )
}
#[test]
fn normal_exit_is_reaped_without_restart() {
    let (code, report, _) = run(None);
    assert_eq!(code, 0);
    assert!(report.contains("\"workerCode\":0"));
    assert_eq!(report.matches("spawned").count(), 1);
}
#[test]
fn blocked_actor_is_killed_by_an_independent_process() {
    let (code, report, elapsed) = run(Some(b'S'));
    assert_eq!(code, 70);
    assert!(report.contains("Timeout"));
    assert!(report.contains("\"workerReaped\":true"));
    assert!(elapsed < Duration::from_millis(3500));
}
#[test]
fn crashed_worker_is_reaped_without_restarting_transport() {
    let (code, report, elapsed) = run(Some(b'K'));
    assert_ne!(code, 0);
    assert_eq!(report.matches("spawned").count(), 1);
    assert!(elapsed < Duration::from_secs(3));
}
#[test]
fn blocked_supervisor_causes_worker_self_termination() {
    let (code, report, _) = run(Some(b'B'));
    assert_eq!(code, 70);
    assert!(report.contains("\"workerCode\":72"));
}
#[test]
fn dead_supervisor_does_not_leave_a_worker_alive() {
    let (code, _, elapsed) = run(Some(b'X'));
    assert_eq!(code, 73);
    assert!(elapsed < Duration::from_secs(3));
}
#[test]
fn invalid_command_fails_closed() {
    let (code, _, elapsed) = run(Some(b'?'));
    assert_eq!(code, 71);
    assert!(elapsed < Duration::from_secs(3));
}
