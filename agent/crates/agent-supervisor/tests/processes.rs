#![cfg(feature = "synthetic-lab")]
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_supervisor::Pulse;
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
    run_case(fault, if fault.is_none() { "normal" } else { "fault" })
}
fn run_case(fault: Option<u8>, mode: &str) -> (i32, String, Duration) {
    run_controlled(fault, mode, None)
}
fn run_controlled(fault: Option<u8>, mode: &str, broker: Option<&str>) -> (i32, String, Duration) {
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
    fs::write(&config, mode).unwrap();
    let report = scratch.0.join("events.jsonl");
    let mut command = Command::new(env!("CARGO_BIN_EXE_absor-lab-supervisor"));
    if broker.is_some() {
        command.env("ABSOR_LAB_BROKER_WATCH", "1");
    }
    let mut child = command
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
    let mut sequence = 0_u64;
    let mut next_pulse = Duration::ZERO;
    let status = loop {
        if (broker == Some("pulses") || broker == Some("replay") && sequence < 2)
            && started.elapsed() >= next_pulse
        {
            let n = if broker == Some("replay") {
                1
            } else {
                sequence + 1
            };
            let line = Pulse::new(n, BootClock.now().unwrap()).unwrap().encode();
            let _ = child.stdin.as_mut().unwrap().write_all(line.as_bytes());
            sequence += 1;
            next_pulse = started.elapsed() + Duration::from_millis(100);
        }
        if broker == Some("partial") && sequence == 0 {
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(b"ABSOR_LAB_PULSE_V1 ")
                .unwrap();
            sequence += 1;
        }
        if broker == Some("eof") {
            child.stdin.take();
        }
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
fn pipe_eof_before_normal_process_exit_is_not_a_crash() {
    let (code, report, elapsed) = run_case(None, "normal-eof");
    assert_eq!(code, 0);
    // El SO puede publicar la salida antes de que vuelva a ejecutarse el actor.
    // Ambas ordenaciones deben conservar el código real, sin cortar ni reiniciar.
    assert!(report.contains("\"workerCode\":0"));
    assert!(!report.contains("\"event\":\"cut\""));
    assert!(elapsed < Duration::from_secs(2));
}
#[test]
fn closing_the_pipe_cannot_keep_a_worker_alive() {
    let (code, report, elapsed) = run_case(None, "fault-eof");
    assert_eq!(code, 70);
    assert!(report.contains("\"workerReaped\":true"));
    assert!(report.contains("Closed"));
    assert!(elapsed < Duration::from_secs(2));
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

#[test]
fn broker_pulses_allow_normal_exit() {
    let (code, report, _) = run_controlled(None, "normal", Some("pulses"));
    assert_eq!(code, 0);
    assert!(report.contains("\"workerCode\":0"));
}
#[test]
fn broker_stall_and_partial_line_do_not_keep_worker_alive() {
    for mode in ["silent", "partial"] {
        let (code, _, elapsed) = run_controlled(None, "fault", Some(mode));
        assert_eq!(code, 71);
        assert!(elapsed < Duration::from_millis(3500));
    }
}
#[test]
fn broker_replay_and_eof_cut_worker() {
    for mode in ["replay", "eof"] {
        let (code, _, elapsed) = run_controlled(None, "fault", Some(mode));
        assert_eq!(code, 71);
        assert!(elapsed < Duration::from_secs(3));
    }
}

#[test]
fn stdin_close_before_normal_exit_is_reaped_without_restart() {
    let (code, report, elapsed) = run_case(None, "normal-write-eof");
    assert_eq!(code, 0, "{report}");
    assert!(report.contains("\"workerCode\":0"), "{report}");
    assert!(!report.contains("\"event\":\"cut\""), "{report}");
    assert_eq!(report.matches("spawned").count(), 1);
    assert!(elapsed < Duration::from_secs(2));
}
#[test]
fn closing_stdin_without_exiting_is_cut_within_existing_grace() {
    let (code, report, elapsed) = run_case(None, "fault-write-eof");
    assert_eq!(code, 70, "{report}");
    assert!(report.contains("\"workerReaped\":true"), "{report}");
    assert!(
        report.contains("\"writeClosedBeforeExit\":true"),
        "{report}"
    );
    assert!(elapsed < Duration::from_secs(2));
}
