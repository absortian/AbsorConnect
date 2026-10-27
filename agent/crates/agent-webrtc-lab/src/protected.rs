//! Trabajador de una PeerConnection: la autoridad y K permanecen en otro UID.
use super::native::{NativeState, Phase};
use absor_agent_control::{Capabilities, Context, ControlSession, HostMessage, NoOperations};
use absor_agent_core::{CloseReason, Session};
use absor_agent_security::client::WorkerClient;
use absor_agent_x11_lab::{FixtureWorker, Operation, Reply};
use serde::Deserialize;
use std::sync::atomic::Ordering;
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Configuration {
    protected_ipc: bool,
    api_signaling: bool,
    native_fixture: bool,
}
pub(crate) struct Bridge {
    client: WorkerClient,
    worker: Option<FixtureWorker>,
    native: NativeState,
    control: ControlSession<NoOperations>,
    context_updates: Vec<HostMessage>,
    announced: bool,
}
impl Bridge {
    pub(crate) fn new(raw: &[u8]) -> Result<Self, ()> {
        let c: Configuration = serde_json::from_slice(raw).map_err(|_| ())?;
        if !c.protected_ipc || !c.api_signaling || !c.native_fixture {
            return Err(());
        }
        Ok(Self {
            client: WorkerClient::connect().map_err(|_| ())?,
            worker: None,
            native: NativeState::default(),
            control: ControlSession::new(
                NoOperations,
                "0.1.0+fixture".into(),
                Capabilities::NONE,
                vec![],
            )
            .map_err(|_| ())?,
            context_updates: vec![],
            announced: false,
        })
    }
    fn stop(&mut self) {
        self.client.fail();
        self.control.close(CloseReason::Stopped);
        self.context_updates.clear();
        if let Some(w) = self.worker.as_mut() {
            w.close(CloseReason::Stopped);
        }
    }
    pub(crate) fn poll(&mut self) -> i32 {
        let state = self.client.poll().unwrap_or(-3);
        if state < 0 {
            self.control.close(CloseReason::Stopped);
            self.context_updates.clear();
            if let Some(w) = self.worker.as_mut() {
                w.close(CloseReason::Stopped);
            }
        }
        state
    }
    pub(crate) fn offer(&mut self) -> Result<Option<Vec<u8>>, ()> {
        self.client.offer().map_err(|_| ())
    }
    pub(crate) fn answer(&mut self, value: String) -> Result<(), ()> {
        self.client.answer(value).map_err(|_| ())
    }
    pub(crate) fn hello(&mut self, offer: String, answer: String) -> Result<Option<Vec<u8>>, ()> {
        self.client.hello(offer, answer).map_err(|_| ())
    }
    pub(crate) fn authenticate(&mut self, raw: &[u8]) -> i32 {
        if self.worker.is_some() {
            self.stop();
            return -3;
        }
        match self.client.authenticate(raw) {
            Ok(Some(permit)) => {
                let mut worker = FixtureWorker::authenticated_ipc(permit);
                self.native.closed = Some(worker.closed_observer());
                if worker.start().is_err() {
                    self.stop();
                    return -3;
                }
                self.worker = Some(worker);
                1
            }
            Ok(None) => 0,
            Err(_) => {
                self.stop();
                -3
            }
        }
    }
    pub(crate) fn native_frame(&mut self) -> Result<Option<Vec<u8>>, ()> {
        if self.client.check_lease().unwrap_or(-3) != 2 {
            return Err(());
        }
        let result = (|| {
            let worker = self.worker.as_mut().ok_or(())?;
            let mut frame = None;
            if let Some(reply) = worker.poll().map_err(|code| {
                self.native.error = Some(code);
            })? {
                match (&self.native.phase, reply) {
                    (Phase::Boot, Reply::Ready) => (),
                    (Phase::Capture, Reply::Frame(value))
                        if value.width == 320
                            && value.height == 180
                            && value.rgb.len() == 172_800 =>
                    {
                        let updates = self
                            .control
                            .set_context(Context::UserDesktop, true)
                            .map_err(|_| ())?;
                        if !updates.is_empty() {
                            self.context_updates = updates;
                        }
                        frame = Some(value.rgb);
                    }
                    (Phase::Pulse, Reply::Input(counts)) => self.native.counts = Some(counts),
                    _ => return Err(()),
                }
                self.native.phase = Phase::Idle;
            }
            if self.native.phase == Phase::Idle {
                let operation = if self.native.input_queued {
                    self.native.input_queued = false;
                    self.native.phase = Phase::Pulse;
                    Operation::Pulse
                } else {
                    self.native.phase = Phase::Capture;
                    Operation::Capture
                };
                worker.submit(operation).map_err(|_| ())?;
            }
            // Volver a validar antes de devolver píxeles al transporte.
            if self.client.check_lease().map_err(|_| ())? != 2 {
                return Err(());
            }
            Ok(frame)
        })();
        if result.is_err() {
            self.stop();
        }
        result
    }
    pub(crate) fn native_input(&mut self, raw: &[u8]) -> Result<(), ()> {
        if self.client.check_lease().unwrap_or(-3) != 2 || self.native.phase == Phase::Boot {
            return Err(());
        }
        let next = super::native::next_step(self.native.input_step, raw)?;
        self.native.input_step = next;
        if next == 4 {
            self.native.input_queued = true;
        }
        Ok(())
    }
    // Comprobar el plazo real en ambos lados. Ningún mensaje renueva autorización.
    pub(crate) fn control(&mut self, raw: &[u8]) -> Result<Vec<u8>, ()> {
        if self.client.check_lease().unwrap_or(-3) != 2 {
            return Err(());
        }
        if !self.announced {
            if !raw.is_empty() {
                return Ok(b"[]".to_vec());
            }
            self.announced = true;
            return serde_json::to_vec(&serde_json::json!([{"v":1,"type":"features",
                "clipboard":false,"files":false,"audio":false,"unattendedControl":true}]))
            .map_err(|_| ());
        }
        let mut messages = if raw.is_empty() {
            vec![]
        } else {
            self.control.receive(raw).map_err(|_| ())?
        };
        messages.append(&mut self.context_updates);
        if self.client.check_lease().unwrap_or(-3) != 2 {
            self.stop();
            return Err(());
        }
        serde_json::to_vec(&messages).map_err(|_| ())
    }
    pub(crate) fn native_status(&self) -> Vec<u8> {
        let (opens, captures, inputs) = absor_agent_x11_lab::native_attempts();
        let counts = self.native.counts.as_ref();
        serde_json::to_vec(&serde_json::json!({"opens":opens,"captures":captures,"inputs":inputs,
            "closed":self.native.closed.as_ref().is_some_and(|v|v.load(Ordering::Acquire)),"errorCode":self.native.error,
            "mouseDown":counts.map_or(0,|v|v.mouse_down),"mouseUp":counts.map_or(0,|v|v.mouse_up),
            "keyDown":counts.map_or(0,|v|v.key_down),"keyUp":counts.map_or(0,|v|v.key_up),"protectedIpc":true,"hostSecretsInWorker":false})).unwrap_or_default()
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.client.disconnect();
        self.stop();
    }
}
