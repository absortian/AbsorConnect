//! Estado público de diagnóstico. No contiene autoridad de captura ni identidad del usuario.
use crate::{SessionKind, SessionState, Snapshot};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeatState {
    UserSession,
    Greeter,
    Transition,
    Unavailable,
}
impl SeatState {
    pub fn of(snapshot: Option<&Snapshot>) -> Self {
        match snapshot {
            Some(s) if s.state() != SessionState::Active => Self::Transition,
            Some(s) if s.kind() == SessionKind::Greeter => Self::Greeter,
            Some(_) => Self::UserSession,
            None => Self::Unavailable,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::UserSession => "user_session",
            Self::Greeter => "greeter",
            Self::Transition => "transition",
            Self::Unavailable => "unavailable",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusError {
    Format,
    Clock,
}
pub struct Status<'a> {
    pub instance: &'a str,
    pub boot_id: &'a str,
    pub publication: u64,
    pub pid: u32,
    pub published_millis: u64,
    pub sample_started_millis: Option<u64>,
    pub state: SeatState,
}
impl Status<'_> {
    pub fn encode(&self) -> Result<Vec<u8>, StatusError> {
        if self.publication == 0
            || self.pid == 0
            || !is_instance(self.instance)
            || !is_boot_id(self.boot_id)
        {
            return Err(StatusError::Format);
        }
        if self
            .sample_started_millis
            .is_some_and(|v| v > self.published_millis)
        {
            return Err(StatusError::Clock);
        }
        // Literales/enums y números validados; no interpolar nombres, rutas o texto del SO.
        let started = self
            .sample_started_millis
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".into());
        Ok(format!("{{\"v\":1,\"instance\":\"{}\",\"bootId\":\"{}\",\"publicationSequence\":{},\"pid\":{},\"publishedAtBoottimeMillis\":{},\"sampleStartedBoottimeMillis\":{},\"state\":\"{}\",\"captureAvailable\":false,\"inputAvailable\":false,\"readyForUnattended\":false}}\n",self.instance,self.boot_id,self.publication,self.pid,self.published_millis,started,self.state.name()).into_bytes())
    }
}
pub fn is_instance(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
pub fn is_boot_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, v)| {
            if [8, 13, 18, 23].contains(&i) {
                v == b'-'
            } else {
                v.is_ascii_digit() || (b'a'..=b'f').contains(&v)
            }
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn status() -> Status<'static> {
        Status {
            instance: "0123456789abcdef0123456789abcdef",
            boot_id: "01234567-89ab-cdef-0123-456789abcdef",
            publication: 1,
            pid: 10,
            published_millis: 20,
            sample_started_millis: Some(19),
            state: SeatState::UserSession,
        }
    }
    #[test]
    fn never_announces_remote_readiness_or_serializes_identity() {
        let raw = String::from_utf8(status().encode().unwrap()).unwrap();
        for field in [
            "\"captureAvailable\":false",
            "\"inputAvailable\":false",
            "\"readyForUnattended\":false",
        ] {
            assert!(raw.contains(field));
        }
        for field in [
            "User", "Leader", "Display", "salt", "token", "key", "password", "path",
        ] {
            assert!(!raw.contains(field));
        }
    }
    #[test]
    fn user_metadata_does_not_imply_unlocked_desktop() {
        assert_eq!(
            SeatState::of(Some(&crate::tests::snapshot())),
            SeatState::UserSession
        );
        assert_eq!(SeatState::of(None), SeatState::Unavailable);
    }
    #[test]
    fn rejects_arbitrary_text_and_counter_zero() {
        for value in [
            "",
            "0123456789abcdef0123456789abcde\"f",
            "../0123456789abcdef0123456789abcd",
        ] {
            let mut s = status();
            s.instance = value;
            assert_eq!(s.encode(), Err(StatusError::Format));
        }
        let mut s = status();
        s.publication = 0;
        assert_eq!(s.encode(), Err(StatusError::Format));
        let mut s = status();
        s.boot_id = "untrusted";
        assert_eq!(s.encode(), Err(StatusError::Format));
    }
    #[test]
    fn timestamp_cannot_come_from_the_future() {
        let mut s = status();
        s.sample_started_millis = Some(21);
        assert_eq!(s.encode(), Err(StatusError::Clock));
    }
}
