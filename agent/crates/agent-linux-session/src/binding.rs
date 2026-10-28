//! Fija el asiento al iniciar el desafío. Un cambio exige una prueba nueva.
//! No convierte los metadatos en permiso: API/HMAC/DTLS siguen siendo obligatorios.
use crate::{SessionKind, SessionState, Snapshot};
#[derive(Default)]
pub struct SeatBinding {
    current: Option<Snapshot>,
    pinned: Option<Snapshot>,
}
impl SeatBinding {
    /// Devuelve true si una conexión o desafío perdió su asiento original.
    pub fn update(&mut self, snapshot: Option<Snapshot>) -> bool {
        let lost = self
            .pinned
            .as_ref()
            .is_some_and(|p| snapshot.as_ref() != Some(p));
        if lost {
            self.pinned = None;
        }
        self.current = snapshot;
        lost
    }
    /// El laboratorio de ventana propia solo admite escritorio de usuario X11.
    /// LockedHint=no no demuestra desbloqueo; el trabajador comprueba Cinnamon.
    pub fn eligible(&self) -> bool {
        self.current.as_ref().is_some_and(|s| {
            s.kind() == SessionKind::User && s.state() == SessionState::Active && !s.locked_hint()
        })
    }
    pub fn pin(&mut self) -> bool {
        if !self.eligible() || self.pinned.is_some() {
            return false;
        }
        self.pinned = self.current.clone();
        true
    }
    pub fn is_pinned(&self) -> bool {
        self.pinned.is_some() && self.pinned == self.current && self.eligible()
    }
    pub fn pinned_snapshot(&self) -> Option<&Snapshot> {
        self.is_pinned().then_some(self.pinned.as_ref()).flatten()
    }
    pub fn clear(&mut self) {
        self.pinned = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        tests::{snapshot, VALID},
        SessionId,
    };
    fn changed(before: &str, after: &str) -> Snapshot {
        Snapshot::from_properties(
            &SessionId::parse("c1").unwrap(),
            VALID.replace(before, after).as_bytes(),
        )
        .unwrap()
    }
    #[test]
    fn metadata_alone_never_pins_an_authentication() {
        let mut binding = SeatBinding::default();
        assert!(!binding.pin());
        assert!(!binding.update(Some(snapshot())));
        assert!(binding.eligible());
        assert!(!binding.is_pinned());
        assert!(binding.pin());
        assert!(!binding.pin());
        assert!(!binding.update(Some(snapshot())));
        assert!(binding.is_pinned());
    }
    #[test]
    fn loss_or_change_invalidates_even_an_unfinished_challenge() {
        for next in [
            None,
            Some(changed("Leader=1234", "Leader=1235")),
            Some(changed("User=1000", "User=1001")),
            Some(changed("Display=:0", "Display=:1")),
            Some(changed("LockedHint=no", "LockedHint=yes")),
            Some(changed("Class=user", "Class=greeter")),
            Some(changed("State=active", "State=closing")),
        ] {
            let mut binding = SeatBinding::default();
            binding.update(Some(snapshot()));
            assert!(binding.pin());
            assert!(binding.update(next));
            assert!(!binding.is_pinned());
            binding.update(Some(snapshot()));
            assert!(!binding.is_pinned());
            assert!(binding.pin());
        }
    }
    #[test]
    fn new_logind_session_cannot_reuse_the_old_proof() {
        let mut binding = SeatBinding::default();
        binding.update(Some(snapshot()));
        assert!(binding.pin());
        let next = Snapshot::from_properties(
            &SessionId::parse("c2").unwrap(),
            VALID.replace("Id=c1", "Id=c2").as_bytes(),
        )
        .unwrap();
        assert!(binding.update(Some(next)));
        assert!(!binding.is_pinned());
    }
    #[test]
    fn greeter_locked_and_closing_are_not_fixture_targets() {
        for next in [
            changed("Class=user", "Class=greeter"),
            changed("LockedHint=no", "LockedHint=yes"),
            changed("State=active", "State=closing"),
        ] {
            let mut binding = SeatBinding::default();
            binding.update(Some(next));
            assert!(!binding.eligible());
            assert!(!binding.pin());
        }
    }
    #[test]
    fn disconnect_requires_an_explicit_new_pin() {
        let mut binding = SeatBinding::default();
        binding.update(Some(snapshot()));
        assert!(binding.pin());
        binding.clear();
        assert!(!binding.is_pinned());
        assert!(binding.pin());
    }
}
