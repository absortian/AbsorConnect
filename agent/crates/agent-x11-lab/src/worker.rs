use super::x11::{Frame, InputCounts, Surface};
use absor_agent_auth::VerifiedConnection;
use absor_agent_core::{CloseReason, Session};
use std::sync::atomic::AtomicU64;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Arc,
    },
    thread,
    time::Duration,
};
static OPENS: AtomicU64 = AtomicU64::new(0);
static CAPTURES: AtomicU64 = AtomicU64::new(0);
static INPUTS: AtomicU64 = AtomicU64::new(0);
pub fn native_attempts() -> (u64, u64, u64) {
    (
        OPENS.load(Ordering::SeqCst),
        CAPTURES.load(Ordering::SeqCst),
        INPUTS.load(Ordering::SeqCst),
    )
}
pub enum Operation {
    Capture,
    Pulse,
}
pub enum Reply {
    Ready,
    Frame(Frame),
    Input(InputCounts),
}
pub struct FixtureWorker {
    alive: Arc<AtomicBool>,
    closed: Arc<AtomicBool>,
    commands: SyncSender<Operation>,
    replies: Receiver<Result<Reply, &'static str>>,
    pending: bool,
}
impl FixtureWorker {
    /// El verificador entrega la prueba consumible. La vinculación DTLS de este
    /// ensayo es un vector público, no una certificación del trabajador P2P Linux.
    pub fn authenticated(verified: VerifiedConnection) -> Self {
        let _binding = verified.into_binding();
        let alive = Arc::new(AtomicBool::new(true));
        let closed = Arc::new(AtomicBool::new(false));
        let flag = alive.clone();
        let ended = closed.clone();
        let (commands, input) = mpsc::sync_channel(1);
        let (output, replies) = mpsc::sync_channel(1);
        thread::spawn(move || {
            // También marca cierre si falla la inicialización, sin exponer el SO al actor.
            struct End(Arc<AtomicBool>);
            impl Drop for End {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::Release);
                }
            }
            let _end = End(ended);
            OPENS.fetch_add(1, Ordering::SeqCst);
            let mut surface = match Surface::open(&flag) {
                Ok(v) => v,
                Err(e) => {
                    let _ = output.try_send(Err(e));
                    return;
                }
            };
            if output.try_send(Ok(Reply::Ready)).is_err() {
                return;
            }
            while flag.load(Ordering::Acquire) {
                let command = match input.recv_timeout(Duration::from_millis(20)) {
                    Ok(v) => v,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => break,
                };
                if !flag.load(Ordering::Acquire) {
                    break;
                }
                let reply = match command {
                    Operation::Capture => {
                        CAPTURES.fetch_add(1, Ordering::SeqCst);
                        surface.capture(&flag).map(Reply::Frame)
                    }
                    Operation::Pulse => {
                        INPUTS.fetch_add(1, Ordering::SeqCst);
                        surface.pulse(&flag).map(Reply::Input)
                    }
                };
                if !flag.load(Ordering::Acquire) {
                    break;
                }
                if output.try_send(reply).is_err() {
                    break;
                }
            }
        });
        Self {
            alive,
            closed,
            commands,
            replies,
            pending: true,
        }
    }
    pub fn submit(&mut self, operation: Operation) -> Result<(), &'static str> {
        if !self.alive.load(Ordering::Acquire) || self.pending {
            return Err("worker_unavailable");
        }
        self.commands
            .try_send(operation)
            .map_err(|_| "worker_unavailable")?;
        self.pending = true;
        Ok(())
    }
    pub fn poll(&mut self) -> Result<Option<Reply>, &'static str> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("worker_stopped");
        }
        match self.replies.try_recv() {
            Ok(value) if self.pending => {
                self.pending = false;
                match value {
                    Ok(reply) => Ok(Some(reply)),
                    Err(error) => {
                        self.alive.store(false, Ordering::Release);
                        Err(error)
                    }
                }
            }
            Ok(_) => {
                self.alive.store(false, Ordering::Release);
                Err("unexpected_worker_response")
            }
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => {
                self.alive.store(false, Ordering::Release);
                Err("worker_closed")
            }
        }
    }
    pub fn closed_observer(&self) -> Arc<AtomicBool> {
        self.closed.clone()
    }
}
impl Session for FixtureWorker {
    fn close(&mut self, _: CloseReason) {
        self.alive.store(false, Ordering::Release);
    }
}
impl Drop for FixtureWorker {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_native_context_error_is_terminal_and_cannot_resume_input() {
        let (commands, _input) = mpsc::sync_channel(1);
        let (output, replies) = mpsc::sync_channel(1);
        let mut worker = FixtureWorker {
            alive: Arc::new(AtomicBool::new(true)),
            closed: Arc::new(AtomicBool::new(false)),
            commands,
            replies,
            pending: true,
        };
        output.send(Err("session_changed")).unwrap();
        assert!(matches!(worker.poll(), Err("session_changed")));
        assert!(worker.submit(Operation::Pulse).is_err());
        assert!(worker.poll().is_err());
    }
}
