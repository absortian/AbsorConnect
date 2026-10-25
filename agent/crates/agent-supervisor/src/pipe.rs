//! Lector acotado: el hilo de vigilancia nunca espera una línea incompleta.
use super::{Fault, Pulse, PREFIX};
use absor_agent_core::clock::{BootClock, Clock};
use std::io::{self, BufReader, Read, Write};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc::{self, Receiver, TryRecvError},
    Arc,
};
use std::thread;
use std::time::Duration;

pub enum Event {
    Pulse(Pulse),
    Stall,
}
pub struct Events {
    receiver: Receiver<Result<Event, Fault>>,
    ended: Arc<AtomicU64>,
    overflowed: Arc<AtomicBool>,
}
impl Events {
    pub fn try_recv(&self) -> Result<Result<Event, Fault>, TryRecvError> {
        if self.overflowed.load(Ordering::Acquire) {
            return Ok(Err(Fault::Protocol));
        }
        self.receiver.try_recv()
    }
    /// Observación del cierre del pipe, independiente del actor supervisado.
    pub fn closed_at(&self) -> Option<Duration> {
        match self.ended.load(Ordering::Acquire) {
            0 => None,
            n => Some(Duration::from_nanos(n)),
        }
    }
}

/// Pipes heredados de un hijo propio, no sockets abiertos ni entrada de WebRTC.
/// En el lado hijo se admite S solo en el ejecutable artificial supervisado.
pub fn read_events(input: impl Read + Send + 'static, stderr: bool) -> Events {
    let (tx, rx) = mpsc::sync_channel(8);
    let ended = Arc::new(AtomicU64::new(0));
    let observed = ended.clone();
    let overflowed = Arc::new(AtomicBool::new(false));
    let overflow = overflowed.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(input);
        let mut line = Vec::with_capacity(1024);
        let mut oversized = false;
        let mut byte = [0_u8];
        while reader.read_exact(&mut byte).is_ok() {
            if line.len() < 1024 {
                line.push(byte[0]);
            } else {
                oversized = true;
            }
            if byte[0] != b'\n' {
                continue;
            }
            let event = if line.starts_with(PREFIX.as_bytes()) || !stderr {
                if !stderr && line == b"S\n" {
                    Ok(Event::Stall)
                } else if oversized {
                    Err(Fault::Protocol)
                } else {
                    Pulse::parse(&line).map(Event::Pulse)
                }
            } else {
                // Nunca acumular salida arbitraria del trabajador en memoria.
                let _ = io::stderr().write_all(&line);
                line.clear();
                oversized = false;
                continue;
            };
            match tx.try_send(event) {
                Ok(()) => (),
                Err(mpsc::TrySendError::Disconnected(_)) => return,
                // Estado terminal, pero seguir drenando para observar EOF real.
                // No cerrar el pipe y confundir EPIPE con la muerte del par.
                Err(mpsc::TrySendError::Full(_)) => {
                    overflow.store(true, Ordering::Release);
                }
            }
            line.clear();
            oversized = false;
        }
        // EOF, línea parcial o error: cortar incluso si aún queda lease de API.
        if let Ok(now) = BootClock.now() {
            if let Ok(ns) = u64::try_from(now.as_nanos()) {
                observed.store(ns, Ordering::Release);
            }
        }
    });
    Events {
        receiver: rx,
        ended,
        overflowed,
    }
}
