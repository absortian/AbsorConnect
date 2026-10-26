//! Admisión acotada: un trabajador, sin reintentar la misma solicitud pendiente.
#![forbid(unsafe_code)]
pub mod audit;
use std::collections::HashSet;

#[derive(Default)]
pub struct Admission {
    seen: HashSet<String>,
    active: bool,
    stopped: bool,
}
impl Admission {
    /// Solo se llama con una respuesta NUEVA validada por la API, nunca caché/IPC.
    pub fn select(&mut self, pending: &[String]) -> Option<String> {
        if self.stopped || self.active || pending.len() > 64 {
            return None;
        }
        self.seen.retain(|id| pending.contains(id));
        let selected = pending.iter().find(|id| !self.seen.contains(*id))?.clone();
        self.seen.insert(selected.clone());
        self.active = true;
        Some(selected)
    }
    pub fn finished(&mut self) {
        self.active = false;
    }
    pub fn stop(&mut self) {
        self.stopped = true;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sequential_sessions_require_new_requests_and_no_overlap() {
        let mut a = Admission::default();
        let first = vec!["a".into()];
        assert_eq!(a.select(&first), Some("a".into()));
        assert_eq!(a.select(&["b".into()]), None);
        a.finished();
        assert_eq!(a.select(&first), None);
        assert_eq!(a.select(&["b".into()]), Some("b".into()));
        a.finished();
        a.stop();
        assert_eq!(a.select(&["c".into()]), None);
    }
    #[test]
    fn oversized_response_cannot_grow_state_or_start_worker() {
        let mut a = Admission::default();
        assert_eq!(a.select(&vec!["a".into(); 65]), None);
        assert_eq!(a.select(&["b".into()]), Some("b".into()));
    }
}
