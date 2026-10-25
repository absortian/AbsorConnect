//! Lanzador sin privilegios, solo para el extremo de vídeo artificial compilado.
#![deny(unsafe_code)]
use absor_agent_core::clock::{BootClock, Clock};
use absor_agent_supervisor::{
    pipe::{read_events, Event},
    PeerWatch, Pulse, HEARTBEAT_INTERVAL, POLL_INTERVAL,
};
use serde_json::json;
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn record(file: &mut File, value: serde_json::Value) -> Result<(), ()> {
    writeln!(file, "{value}")
        .and_then(|_| file.sync_all())
        .map_err(|_| ())
}
fn run() -> Result<i32, ()> {
    let args: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if !(args.len() == 5 || args.len() == 6)
        || args.iter().any(|v| !v.is_absolute())
        || args[1].file_name().and_then(|v| v.to_str())
            != Some(format!("rust_video_channel_check{}", std::env::consts::EXE_SUFFIX).as_str())
        || args[0].parent() != args[2].parent()
        || args[0].parent() != args[3].parent()
        || args[0].parent() != args.last().and_then(|v| v.parent())
    {
        return Err(());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut report = options.open(&args[0]).map_err(|_| ())?;
    let mut child = Owned(
        Command::new(&args[1])
            .args(&args[2..])
            .env("ABSOR_SYNTHETIC_SUPERVISED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::inherit())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| ())?,
    );
    record(
        &mut report,
        json!({"event":"spawned", "workerPid":child.0.id(), "supervisorPid":std::process::id(), "syntheticOnly":true}),
    )?;
    let mut pipe = child.0.stdin.take().ok_or(())?;
    let events = read_events(child.0.stderr.take().ok_or(())?, true);
    let (commands, incoming) = mpsc::sync_channel(1);
    // Solo cuatro fallos enumerados desde el lanzador local. Nunca shell/RPC de red.
    thread::spawn(move || {
        for byte in std::io::BufReader::new(std::io::stdin()).bytes() {
            let Ok(byte) = byte else {
                break;
            };
            if byte == b'\n' {
                continue;
            }
            if commands.try_send(byte).is_err() {
                return;
            }
        }
    });
    let mut watch = PeerWatch::new(BootClock, Duration::from_secs(5)).map_err(|_| ())?;
    let mut sequence = 0_u64;
    let mut next = Duration::ZERO;
    let mut fault_started = None;
    loop {
        if let Some(status) = child.0.try_wait().map_err(|_| ())? {
            record(
                &mut report,
                json!({"event":"exited", "workerCode":status.code()}),
            )?;
            return Ok(status.code().unwrap_or(70));
        }
        match incoming.try_recv() {
            Ok(command) => {
                fault_started = Some(BootClock.now().map_err(|_| ())?);
                record(
                    &mut report,
                    json!({"event":"fault", "command":char::from(command).to_string()}),
                )?;
                match command {
                    b'S' => pipe.write_all(b"S\n").map_err(|_| ())?,
                    b'K' => {
                        child.0.kill().map_err(|_| ())?;
                    }
                    b'B' => thread::sleep(Duration::from_secs(5)),
                    b'X' => std::process::exit(73),
                    _ => return Err(()),
                }
            }
            Err(mpsc::TryRecvError::Disconnected) => return Err(()),
            Err(mpsc::TryRecvError::Empty) => (),
        }
        let result = (|| {
            loop {
                match events.try_recv() {
                    Ok(Ok(Event::Pulse(pulse))) => watch.receive(pulse)?,
                    Ok(_) => return Err(absor_agent_supervisor::Fault::Protocol),
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        return Err(absor_agent_supervisor::Fault::Closed)
                    }
                }
            }
            watch.poll()
        })();
        if let Err(fault) = result {
            child.0.kill().map_err(|_| ())?;
            let status = child.0.wait().map_err(|_| ())?;
            record(
                &mut report,
                json!({"event":"cut", "reason":format!("{fault:?}"), "workerCode":status.code(), "workerReaped":true,
                    "workerPipeClosedAfterFaultMilliseconds": fault_started.and_then(|start| events.closed_at().and_then(|end| end.checked_sub(start))).map(|v| v.as_millis())}),
            )?;
            return Ok(70);
        }
        let now = BootClock.now().map_err(|_| ())?;
        if now >= next {
            sequence = sequence.checked_add(1).ok_or(())?;
            pipe.write_all(
                Pulse::new(sequence, now)
                    .map_err(|_| ())?
                    .encode()
                    .as_bytes(),
            )
            .map_err(|_| ())?;
            next = now.checked_add(HEARTBEAT_INTERVAL).ok_or(())?;
        }
        thread::sleep(POLL_INTERVAL);
    }
}
fn main() {
    std::process::exit(run().unwrap_or(71));
}
