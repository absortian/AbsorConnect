//! Extensión v1 del canal control. No autentica, no concede permisos ni ejecuta shell.
//! El actor debe invocarla dentro del gate de la conexión autenticada.
#![deny(unsafe_code)]
use absor_agent_core::{CloseReason, Session};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CONTROL_LIMIT: usize = 2048;
pub const OPERATION_LIMIT: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Lock,
    Logout,
    Restart,
    SecureAttention,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Context {
    UserDesktop,
    Locked,
    Login,
    SecurePrompt,
    Transition,
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotSupported,
    NotAllowed,
    Busy,
    Cancelled,
    SystemError,
    SessionExpired,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Capabilities {
    pub administration: bool,
    pub login: bool,
    pub secure_attention: bool,
    pub restart: bool,
}
impl Capabilities {
    pub const NONE: Self = Self {
        administration: false,
        login: false,
        secure_attention: false,
        restart: false,
    };
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ControllerMessage {
    #[serde(rename = "agent-control-enable")]
    Enable { v: u8, extension: u8 },
    #[serde(rename = "host-operation")]
    Operation {
        v: u8,
        extension: u8,
        id: String,
        action: Action,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    Malformed,
    InvalidConfiguration,
    Closed,
    SequenceExhausted,
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            14 => b == b'4',
            19 => matches!(b, b'8' | b'9' | b'a' | b'b'),
            _ => b.is_ascii_digit() || matches!(b, b'a'..=b'f'),
        })
}
pub fn parse_controller(raw: &[u8]) -> Result<ControllerMessage, ProtocolError> {
    if raw.is_empty() || raw.len() > CONTROL_LIMIT {
        return Err(ProtocolError::Malformed);
    }
    let message: ControllerMessage =
        serde_json::from_slice(raw).map_err(|_| ProtocolError::Malformed)?;
    let valid = match &message {
        ControllerMessage::Enable { v, extension } => *v == 1 && *extension == 1,
        ControllerMessage::Operation {
            v, extension, id, ..
        } => *v == 1 && *extension == 1 && valid_id(id),
    };
    if !valid {
        return Err(ProtocolError::Malformed);
    }
    Ok(message)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type")]
pub enum HostMessage {
    #[serde(rename = "agent-capabilities", rename_all = "camelCase")]
    Capabilities {
        v: u8,
        extension: u8,
        agent_version: String,
        capabilities: Capabilities,
        actions: Vec<Action>,
    },
    #[serde(rename = "agent-context", rename_all = "camelCase")]
    Context {
        v: u8,
        extension: u8,
        sequence: u32,
        state: Context,
        image_available: bool,
    },
    #[serde(rename = "host-operation-result")]
    Result {
        v: u8,
        extension: u8,
        id: String,
        action: Action,
        status: Status,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<ErrorCode>,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Accepted,
    Rejected,
    Failed,
}

/// Adaptador confiable del SO. Operación breve, enumerada y sin argumentos de red.
/// Antes de devolver Accepted debe haber recibido aceptación del mecanismo del SO.
pub trait Executor {
    fn execute(&mut self, action: Action, context: Context) -> Result<(), ErrorCode>;
    fn close(&mut self, reason: CloseReason);
}

/// Instancia por PeerConnection. No copiarla, restaurarla al reconectar ni compartir su caché.
pub struct ControlSession<E: Executor> {
    executor: E,
    version: String,
    capabilities: Capabilities,
    actions: Vec<Action>,
    context: Context,
    image_available: bool,
    sequence: u32,
    negotiated: bool,
    closed: bool,
    // No desalojar IDs antiguos: un reintento nunca vuelve a ejecutar una orden.
    results: HashMap<String, (Action, HostMessage)>,
}
impl<E: Executor> ControlSession<E> {
    pub fn new(
        executor: E,
        version: String,
        capabilities: Capabilities,
        actions: Vec<Action>,
    ) -> Result<Self, ProtocolError> {
        if version.is_empty()
            || version.len() > 32
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-'))
            || actions.len() > 4
            || actions
                .iter()
                .enumerate()
                .any(|(i, a)| actions[..i].contains(a))
            || (actions.contains(&Action::Restart) && !capabilities.restart)
            || (actions.contains(&Action::SecureAttention) && !capabilities.secure_attention)
        {
            return Err(ProtocolError::InvalidConfiguration);
        }
        Ok(Self {
            executor,
            version,
            capabilities,
            actions,
            context: Context::Unavailable,
            image_available: false,
            sequence: 1,
            negotiated: false,
            closed: false,
            results: HashMap::new(),
        })
    }
    fn result(id: String, action: Action, status: Status, code: Option<ErrorCode>) -> HostMessage {
        HostMessage::Result {
            v: 1,
            extension: 1,
            id,
            action,
            status,
            code,
        }
    }
    fn context_message(&self) -> HostMessage {
        HostMessage::Context {
            v: 1,
            extension: 1,
            sequence: self.sequence,
            state: self.context,
            image_available: self.image_available,
        }
    }
    /// Publicar solamente el estado observado localmente, nunca uno recibido del controlador.
    pub fn set_context(
        &mut self,
        context: Context,
        image_available: bool,
    ) -> Result<Vec<HostMessage>, ProtocolError> {
        if self.closed {
            return Err(ProtocolError::Closed);
        }
        if image_available && matches!(context, Context::Transition | Context::Unavailable) {
            return Err(ProtocolError::InvalidConfiguration);
        }
        if self.context == context && self.image_available == image_available {
            return Ok(vec![]);
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .filter(|n| *n <= i32::MAX as u32)
            .ok_or(ProtocolError::SequenceExhausted)?;
        self.context = context;
        self.image_available = image_available;
        Ok(if self.negotiated {
            vec![self.context_message()]
        } else {
            vec![]
        })
    }
    pub fn receive(&mut self, raw: &[u8]) -> Result<Vec<HostMessage>, ProtocolError> {
        if self.closed {
            return Err(ProtocolError::Closed);
        }
        match parse_controller(raw)? {
            ControllerMessage::Enable { .. } => {
                if self.negotiated {
                    return Ok(vec![]);
                }
                self.negotiated = true;
                Ok(vec![
                    HostMessage::Capabilities {
                        v: 1,
                        extension: 1,
                        agent_version: self.version.clone(),
                        capabilities: self.capabilities,
                        actions: self.actions.clone(),
                    },
                    self.context_message(),
                ])
            }
            ControllerMessage::Operation { id, action, .. } => {
                // Sin negociación no se confirma nada, ni siquiera un rechazo de esta extensión.
                if !self.negotiated {
                    return Ok(vec![]);
                }
                if let Some((original, response)) = self.results.get(&id) {
                    return Ok(vec![if *original == action {
                        response.clone()
                    } else {
                        Self::result(id, action, Status::Rejected, Some(ErrorCode::NotAllowed))
                    }]);
                }
                if self.results.len() >= OPERATION_LIMIT {
                    return Ok(vec![Self::result(
                        id,
                        action,
                        Status::Rejected,
                        Some(ErrorCode::Busy),
                    )]);
                }
                let response = if !self.actions.contains(&action) {
                    Self::result(
                        id.clone(),
                        action,
                        Status::Rejected,
                        Some(ErrorCode::NotSupported),
                    )
                } else if matches!(self.context, Context::Transition | Context::Unavailable) {
                    Self::result(
                        id.clone(),
                        action,
                        Status::Rejected,
                        Some(ErrorCode::NotAllowed),
                    )
                } else {
                    // Reservar ANTES de entrar en el adaptador. Si el proceso cae no se reintenta
                    // en una conexión nueva: exige otra orden explícita y autenticación nueva.
                    self.results.insert(
                        id.clone(),
                        (
                            action,
                            Self::result(
                                id.clone(),
                                action,
                                Status::Rejected,
                                Some(ErrorCode::Busy),
                            ),
                        ),
                    );
                    match self.executor.execute(action, self.context) {
                        Ok(()) => Self::result(id.clone(), action, Status::Accepted, None),
                        Err(code) => Self::result(id.clone(), action, Status::Failed, Some(code)),
                    }
                };
                self.results.insert(id, (action, response.clone()));
                Ok(vec![response])
            }
        }
    }
}
impl<E: Executor> Session for ControlSession<E> {
    fn close(&mut self, reason: CloseReason) {
        if !self.closed {
            self.closed = true;
            self.negotiated = false;
            self.results.clear();
            self.executor.close(reason);
        }
    }
}
impl<E: Executor> Drop for ControlSession<E> {
    fn drop(&mut self) {
        self.close(CloseReason::Shutdown);
    }
}

/// El trabajador de laboratorio no anuncia acciones del SO. No puede reiniciar el PC.
pub struct NoOperations;
impl Executor for NoOperations {
    fn execute(&mut self, _: Action, _: Context) -> Result<(), ErrorCode> {
        Err(ErrorCode::NotSupported)
    }
    fn close(&mut self, _: CloseReason) {}
}
