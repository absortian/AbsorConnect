//! Solo vídeo artificial: morir si el supervisor deja de progresar, aunque
//! el actor de libwebrtc esté bloqueado. No concede autorización ni permisos.
use crate::{
    pipe::{read_events, Event},
    PeerWatch, Pulse, PEER_TIMEOUT, POLL_INTERVAL,
};
use absor_agent_core::clock::{BootClock, Clock};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, OnceLock,
    },
    thread,
    time::Duration,
};

static STARTED: OnceLock<bool> = OnceLock::new();
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
static STALL: AtomicBool = AtomicBool::new(false);

pub fn start() {
    STARTED.get_or_init(|| {
        if std::env::var_os("ABSOR_SYNTHETIC_SUPERVISED").as_deref()
            != Some(std::ffi::OsStr::new("1"))
        {
            return false;
        }
        let events = read_events(std::io::stdin(), false);
        thread::spawn(move || {
            let Ok(mut watch) = PeerWatch::new(BootClock, PEER_TIMEOUT) else {
                crate::terminate::now();
            };
            loop {
                loop {
                    match events.try_recv() {
                        Ok(Ok(Event::Pulse(pulse))) => {
                            if watch.receive(pulse).is_err() {
                                crate::terminate::now();
                            }
                        }
                        Ok(Ok(Event::Stall)) => STALL.store(true, Ordering::SeqCst),
                        Ok(Err(_)) | Err(mpsc::TryRecvError::Disconnected) => {
                            crate::terminate::now()
                        }
                        Err(mpsc::TryRecvError::Empty) => break,
                    }
                }
                if watch.poll().is_err() {
                    crate::terminate::now();
                }
                thread::sleep(POLL_INTERVAL);
            }
        });
        true
    });
}
pub fn before_poll() {
    if STALL.swap(false, Ordering::SeqCst) {
        thread::sleep(Duration::from_secs(5));
    }
}
pub fn pulse(status: i32) {
    if STARTED.get() != Some(&true) || status < 0 {
        return;
    }
    // Solo el actor que ha terminado poll renueva su vida; nunca el hilo lector.
    let sequence = SEQUENCE.load(Ordering::Relaxed);
    let Some(next) = sequence.checked_add(1) else {
        crate::terminate::now();
    };
    SEQUENCE.store(next, Ordering::Relaxed);
    let Ok(now) = BootClock.now() else {
        crate::terminate::now();
    };
    let Ok(pulse) = Pulse::new(sequence, now) else {
        crate::terminate::now();
    };
    if std::io::stderr()
        .write_all(pulse.encode().as_bytes())
        .is_err()
    {
        crate::terminate::now();
    }
}
