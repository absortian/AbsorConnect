//! Opciones y contador importados explícitamente; nunca concede funciones no implementadas.
use absor_agent_auth::AttemptState;
use serde::{Deserialize, Serialize};
#[derive(Debug, PartialEq, Eq)]
pub struct MigrationError;
fn uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Features {
    pub clipboard: bool,
    pub files: bool,
    pub audio: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub device_name: String,
    pub features: Features,
    pub confirm_local: bool,
    pub prevent_sleep: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lockout {
    failures: Vec<u64>,
    locked_until: Option<u64>,
    observed_at: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationImport {
    schema: u8,
    pub transaction_id: String,
    pub device_id: String,
    pub enabled: bool,
    pub options: Options,
    lockout: Lockout,
}
impl MigrationImport {
    pub fn attempts(&self) -> Result<AttemptState, MigrationError> {
        if self.schema != 1
            || !uuid(&self.transaction_id)
            || !uuid(&self.device_id)
            || self.options.device_name.trim().is_empty()
            || self.options.device_name.len() > 400
            || self.options.device_name.chars().count() > 100
            || self.options.device_name.chars().any(|c| c.is_control())
            || self.lockout.observed_at > 9_007_199_254_740_991
        {
            return Err(MigrationError);
        }
        AttemptState::migrated(
            self.lockout.failures.clone(),
            self.lockout.locked_until,
            self.lockout.observed_at,
        )
        .map_err(|_| MigrationError)
    }
    /// El trabajador de ventana propia aún no aplica audio/archivos/confirmación/suspensión.
    pub fn fixture_policy_supported(&self) -> bool {
        !self.options.features.clipboard
            && !self.options.features.files
            && !self.options.features.audio
            && !self.options.confirm_local
            && !self.options.prevent_sleep
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> serde_json::Value {
        serde_json::json!({"schema":1,"transactionId":"12345678-1234-4abc-8def-123456789abc","deviceId":"22345678-1234-4abc-8def-123456789abc","enabled":true,"options":{"deviceName":"Equipo ficticio","features":{"clipboard":false,"files":false,"audio":false},"confirmLocal":false,"preventSleep":false},"lockout":{"failures":[1,2,3,4,100000],"lockedUntil":1000000,"observedAt":950000}})
    }
    #[test]
    fn validates_and_preserves_active_lock_without_granting_extra_features() {
        let input: MigrationImport = serde_json::from_value(value()).unwrap();
        let state = serde_json::to_value(input.attempts().unwrap()).unwrap();
        assert_eq!(state["locked_until"], 1000000);
        assert_eq!(state["failures"].as_array().unwrap().len(), 5);
        assert!(input.fixture_policy_supported());
        let mut extra = value();
        extra["options"]["features"]["files"] = serde_json::json!(true);
        let input: MigrationImport = serde_json::from_value(extra).unwrap();
        assert!(input.attempts().is_ok());
        assert!(!input.fixture_policy_supported());
    }
    #[test]
    fn invalid_identity_counter_and_unknown_fields_do_not_reset_import() {
        for (key, v) in [
            ("schema", serde_json::json!(2)),
            ("deviceId", serde_json::json!("invalid")),
            ("transactionId", serde_json::json!("invalid")),
        ] {
            let mut raw = value();
            raw[key] = v;
            assert!(serde_json::from_value::<MigrationImport>(raw)
                .unwrap()
                .attempts()
                .is_err());
        }
        let mut raw = value();
        raw["lockout"]["failures"] = serde_json::json!([99999999]);
        assert!(serde_json::from_value::<MigrationImport>(raw)
            .unwrap()
            .attempts()
            .is_err());
        let mut raw = value();
        raw["options"]["path"] = serde_json::json!("/tmp");
        assert!(serde_json::from_value::<MigrationImport>(raw).is_err());
    }
}
