//! Renovación asíncrona respecto al actor del broker, con una sola consulta en vuelo.
#![forbid(unsafe_code)]
pub mod enrollment;
pub mod http;
pub mod signaling;
use absor_agent_core::clock::Clock;
use absor_agent_core::{AuthorizationGate, Denied, Session, SessionHandle, ValidationTicket};
use http::{ApiError, Authorization, HeartbeatSource, PendingRequest, POLL_INTERVAL};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::time::Duration;

pub struct Progress {
    pub next_wake: Duration,
    pub requests: Vec<PendingRequest>,
    pub validation: Option<Result<(), ApiError>>,
}

pub struct RenewingAgent<C: Clock + Clone, S: Session> {
    clock: C,
    gate: AuthorizationGate<C, S>,
    commands: SyncSender<()>,
    responses: Receiver<Result<Authorization, ApiError>>,
    pending: Option<ValidationTicket>,
    next_request: Duration,
    terminal_error: Option<ApiError>,
}

impl<C: Clock + Clone, S: Session> RenewingAgent<C, S> {
    pub fn new(clock: C, mut source: impl HeartbeatSource) -> Self {
        let (commands, command_rx) = mpsc::sync_channel(1);
        let (response_tx, responses) = mpsc::sync_channel(1);
        // No crear otro hilo si DNS se demora: el actor sigue caducando su permiso.
        std::thread::spawn(move || {
            while command_rx.recv().is_ok() {
                let value = source.heartbeat();
                if response_tx.send(value).is_err() {
                    break;
                }
            }
        });
        Self {
            gate: AuthorizationGate::new(clock.clone()),
            clock,
            commands,
            responses,
            pending: None,
            next_request: Duration::ZERO,
            terminal_error: None,
        }
    }

    /// Llamar puntualmente aun sin tráfico de entrada/vídeo, en el actor del broker.
    pub fn tick(&mut self) -> Result<Progress, Denied> {
        let mut wait = self.gate.poll()?;
        let now = self.clock.now().map_err(|_| {
            self.gate.stop();
            Denied::ClockFault
        })?;
        let mut progress = Progress {
            next_wake: wait,
            requests: vec![],
            validation: None,
        };
        match self.responses.try_recv() {
            Ok(result) => {
                let ticket = self.pending.take().ok_or(Denied::StaleResponse)?;
                match result {
                    Ok(value) => {
                        match self.gate.accept_validation(&ticket, value.valid_for) {
                            Ok(()) => {
                                progress.requests = value.requests;
                                progress.validation = Some(Ok(()));
                            }
                            Err(Denied::InvalidResponse) => {
                                progress.validation = Some(Err(ApiError::InvalidResponse));
                            }
                            Err(error) => return Err(error),
                        }
                        self.next_request = now.saturating_add(POLL_INTERVAL);
                    }
                    Err(ApiError::Revoked) => {
                        self.terminal_error = Some(ApiError::Revoked);
                        self.gate.revoke();
                        return Err(Denied::Stopped);
                    }
                    Err(error) => {
                        self.gate.validation_failed(&ticket)?;
                        let delay = if let ApiError::RateLimited(delay) = error {
                            delay.max(POLL_INTERVAL)
                        } else {
                            POLL_INTERVAL
                        };
                        self.next_request = now.saturating_add(delay);
                        progress.validation = Some(Err(error));
                    }
                }
            }
            Err(TryRecvError::Disconnected) => {
                self.gate.stop();
                return Err(Denied::Stopped);
            }
            Err(TryRecvError::Empty) => (),
        }
        if self.pending.is_none() && now >= self.next_request {
            let ticket = self.gate.begin_validation()?;
            if self.commands.try_send(()).is_err() {
                self.gate.stop();
                return Err(Denied::Stopped);
            }
            self.pending = Some(ticket);
        }
        wait = wait.min(self.gate.poll()?);
        if self.pending.is_none() {
            wait = wait.min(self.next_request.saturating_sub(now));
        }
        progress.next_wake = wait;
        Ok(progress)
    }

    pub fn terminal_error(&self) -> Option<ApiError> {
        self.terminal_error
    }

    pub fn check_authorization(&mut self) -> Result<(), Denied> {
        self.gate.check_authorization()
    }

    // No sustituye la autenticación v1 del trabajador; frontera confiable del broker.
    pub fn attach_authenticated(&mut self, session: S) -> Result<SessionHandle, Denied> {
        self.gate.attach_authenticated(session)
    }
    pub fn with_session<R>(
        &mut self,
        handle: &SessionHandle,
        operation: impl FnOnce(&mut S) -> R,
    ) -> Result<R, Denied> {
        self.gate.with_session(handle, operation)
    }
    pub fn disconnect(&mut self, handle: &SessionHandle) -> Result<(), Denied> {
        self.gate.disconnect(handle)
    }
    pub fn stop(&mut self) {
        self.gate.stop();
    }
}
