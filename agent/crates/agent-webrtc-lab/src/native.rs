//! Subconjunto fijo del canal input v1, exclusivo de la ventana de laboratorio.
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum FixedInput {
    Button { button: u8, down: bool },
    Key { code: String, down: bool },
}
pub(super) fn next_step(step: u8, raw: &[u8]) -> Result<u8, ()> {
    if raw.is_empty() || raw.len() > 128 {
        return Err(());
    }
    let value: FixedInput = serde_json::from_slice(raw).map_err(|_| ())?;
    let valid = match value {
        FixedInput::Button { button: 0, down } => step < 2 && down == (step == 0),
        FixedInput::Key { code, down } => {
            (2..4).contains(&step) && code == "KeyA" && down == (step == 2)
        }
        _ => false,
    };
    if valid {
        Ok(step + 1)
    } else {
        Err(())
    }
}

#[cfg(all(target_os = "linux", target_pointer_width = "64"))]
#[derive(Default)]
pub(super) struct NativeState {
    pub phase: Phase,
    pub input_step: u8,
    pub input_queued: bool,
    pub counts: Option<absor_agent_x11_lab::InputCounts>,
    pub closed: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    pub error: Option<&'static str>,
}
#[cfg(all(target_os = "linux", target_pointer_width = "64"))]
#[derive(Default, PartialEq)]
pub(super) enum Phase {
    #[default]
    Boot,
    Idle,
    Capture,
    Pulse,
}

#[cfg(test)]
mod tests {
    use super::next_step;
    #[test]
    fn fixed_v1_sequence_rejects_reordering_duplicates_and_other_input() {
        let events = [
            br#"{"type":"button","button":0,"down":true}"#.as_slice(),
            br#"{"type":"button","button":0,"down":false}"#,
            br#"{"type":"key","code":"KeyA","down":true}"#,
            br#"{"type":"key","code":"KeyA","down":false}"#,
        ];
        for (step, event) in events.iter().enumerate() {
            assert_eq!(next_step(step as u8, event), Ok(step as u8 + 1));
            assert!(next_step(step as u8 + 1, event).is_err());
        }
        for raw in [
            br#"{"type":"key","code":"KeyB","down":true}"#.as_slice(),
            br#"{"type":"text","text":"no"}"#,
            br#"{"type":"button","button":0,"down":true,"extra":1}"#,
            br#"{"type":"button","button":0,"button":1,"down":true}"#,
            br#"{"type":"button","button":0,"down":1}"#,
        ] {
            assert!(next_step(0, raw).is_err());
        }
        assert!(next_step(0, &[b'x'; 129]).is_err());
        assert!(next_step(4, events[0]).is_err());
    }
}
