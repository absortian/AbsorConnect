//! Concesión local corta del broker. Nunca acepta una selección aportada por el controlador.
use crate::{
    status::{is_boot_id, is_instance},
    Snapshot,
};
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};
const MAX_AGE: u64 = 400;
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkerIdentity {
    pub pid: u32,
    pub uid: u32,
    pub start_ticks: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Grant {
    v: u8,
    instance: String,
    boot_id: String,
    issued_millis: u64,
    expires_millis: u64,
    broker: WorkerIdentity,
    worker: WorkerIdentity,
    seat_digest: String,
}
/// Evidencia local tras validar plazo, núcleo y asiento. No se deserializa por IPC.
pub struct ValidatedGrant(Grant);
impl ValidatedGrant {
    pub fn deadline_millis(&self) -> u64 {
        self.0.expires_millis
    }
    pub fn issued_millis(&self) -> u64 {
        self.0.issued_millis
    }
    pub fn same_authorization(&self, other: &Self) -> bool {
        self.0.instance == other.0.instance
            && self.0.boot_id == other.0.boot_id
            && self.0.broker == other.0.broker
            && self.0.worker == other.0.worker
            && self.0.seat_digest == other.0.seat_digest
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GrantError;
fn seat_digest(seat: &Snapshot) -> String {
    // Campos cerrados/canónicos con separadores; no hay texto libre o credenciales.
    let value = format!(
        "{}\n{}\n{}\n{}\n{:?}\n{:?}\n{}",
        seat.id().as_str(),
        seat.uid(),
        seat.leader(),
        seat.display_number(),
        seat.kind(),
        seat.state(),
        seat.locked_hint()
    );
    let value = digest(&SHA256, value.as_bytes());
    let mut encoded = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for b in value.as_ref() {
        encoded.push(HEX[(b >> 4) as usize] as char);
        encoded.push(HEX[(b & 15) as usize] as char);
    }
    encoded
}
impl Grant {
    pub fn issue(
        instance: &str,
        boot_id: &str,
        now: u64,
        api_deadline: u64,
        broker: WorkerIdentity,
        worker: WorkerIdentity,
        seat: &Snapshot,
    ) -> Result<Self, GrantError> {
        if !is_instance(instance)
            || !is_boot_id(boot_id)
            || broker.pid <= 1
            || broker.uid == 0
            || broker.start_ticks == 0
            || broker.pid == worker.pid
            || broker.uid == worker.uid
            || worker.pid <= 1
            || worker.uid == 0
            || worker.start_ticks == 0
            || api_deadline <= now
            || api_deadline - now > 30_000
        {
            return Err(GrantError);
        }
        Ok(Self {
            v: 1,
            instance: instance.into(),
            boot_id: boot_id.into(),
            issued_millis: now,
            expires_millis: api_deadline.min(now.checked_add(MAX_AGE).ok_or(GrantError)?),
            broker,
            worker,
            seat_digest: seat_digest(seat),
        })
    }
    pub fn encode(&self) -> Result<Vec<u8>, GrantError> {
        serde_json::to_vec(self).map_err(|_| GrantError)
    }
    pub fn validate(
        raw: &[u8],
        now: u64,
        boot_id: &str,
        broker: WorkerIdentity,
        worker: WorkerIdentity,
        seat: &Snapshot,
    ) -> Result<ValidatedGrant, GrantError> {
        if raw.is_empty() || raw.len() > 1024 {
            return Err(GrantError);
        }
        let value: Self = serde_json::from_slice(raw).map_err(|_| GrantError)?;
        if value.v != 1
            || !is_instance(&value.instance)
            || !is_boot_id(&value.boot_id)
            || value.boot_id != boot_id
            || value.broker != broker
            || value.worker != worker
            || broker.uid == 0
            || broker.pid <= 1
            || broker.start_ticks == 0
            || broker.uid == worker.uid
            || broker.pid == worker.pid
            || worker.uid == 0
            || worker.pid <= 1
            || worker.start_ticks == 0
            || value.issued_millis > now
            || value.expires_millis <= now
            || value.expires_millis <= value.issued_millis
            || value.expires_millis - value.issued_millis > MAX_AGE
            || value.seat_digest != seat_digest(seat)
        {
            return Err(GrantError);
        }
        Ok(ValidatedGrant(value))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const BOOT: &str = "01234567-89ab-cdef-0123-456789abcdef";
    const INSTANCE: &str = "0123456789abcdef0123456789abcdef";
    fn broker() -> WorkerIdentity {
        WorkerIdentity {
            pid: 12,
            uid: 2000,
            start_ticks: 88,
        }
    }
    fn worker() -> WorkerIdentity {
        WorkerIdentity {
            pid: 22,
            uid: 1000,
            start_ticks: 99,
        }
    }
    fn raw() -> Vec<u8> {
        Grant::issue(
            INSTANCE,
            BOOT,
            100,
            1000,
            broker(),
            worker(),
            &crate::tests::snapshot(),
        )
        .unwrap()
        .encode()
        .unwrap()
    }
    #[test]
    fn fresh_exact_subject_only() {
        let s = crate::tests::snapshot();
        assert!(Grant::validate(&raw(), 100, BOOT, broker(), worker(), &s).is_ok());
        assert!(Grant::validate(&raw(), 499, BOOT, broker(), worker(), &s).is_ok());
        for now in [0, 99, 500, u64::MAX] {
            assert!(Grant::validate(&raw(), now, BOOT, broker(), worker(), &s).is_err());
        }
    }
    #[test]
    fn pid_reuse_uid_and_boot_cannot_inherit_authority() {
        let s = crate::tests::snapshot();
        for w in [
            WorkerIdentity {
                pid: 23,
                ..worker()
            },
            WorkerIdentity {
                uid: 1001,
                ..worker()
            },
            WorkerIdentity {
                start_ticks: 100,
                ..worker()
            },
        ] {
            assert!(Grant::validate(&raw(), 100, BOOT, broker(), w, &s).is_err());
        }
        assert!(Grant::validate(
            &raw(),
            100,
            "11234567-89ab-cdef-0123-456789abcdef",
            broker(),
            worker(),
            &s
        )
        .is_err());
    }
    #[test]
    fn broker_replacement_or_same_identity_is_rejected() {
        let s = crate::tests::snapshot();
        for next in [
            WorkerIdentity {
                pid: 13,
                ..broker()
            },
            WorkerIdentity {
                uid: 2001,
                ..broker()
            },
            WorkerIdentity {
                start_ticks: 89,
                ..broker()
            },
        ] {
            assert!(Grant::validate(&raw(), 100, BOOT, next, worker(), &s).is_err());
        }
        assert!(Grant::issue(INSTANCE, BOOT, 100, 1000, worker(), worker(), &s).is_err());
    }
    #[test]
    fn changed_local_session_invalidates_grant() {
        let s = Snapshot::from_properties(
            &crate::SessionId::parse("c1").unwrap(),
            crate::tests::VALID
                .replace("User=1000", "User=1001")
                .as_bytes(),
        )
        .unwrap();
        assert!(Grant::validate(&raw(), 100, BOOT, broker(), worker(), &s).is_err());
    }
    #[test]
    fn api_expiry_shortens_and_never_extends_grant() {
        let s = crate::tests::snapshot();
        let r = Grant::issue(INSTANCE, BOOT, 100, 101, broker(), worker(), &s)
            .unwrap()
            .encode()
            .unwrap();
        assert!(Grant::validate(&r, 100, BOOT, broker(), worker(), &s).is_ok());
        assert!(Grant::validate(&r, 101, BOOT, broker(), worker(), &s).is_err());
        for end in [0, 100, 30101, u64::MAX] {
            assert!(Grant::issue(INSTANCE, BOOT, 100, end, broker(), worker(), &s).is_err());
        }
    }
    #[test]
    fn closed_schema_duplicate_and_oversize_fail() {
        let s = crate::tests::snapshot();
        let r = String::from_utf8(raw()).unwrap();
        for r in [
            r.replace("\"v\":1", "\"v\":1,\"v\":1"),
            r.replace("\"v\":1", "\"v\":1,\"path\":\"/tmp\""),
            r.replace("\"v\":1", "\"v\":2"),
            "x".repeat(1025),
            String::new(),
        ] {
            assert!(Grant::validate(r.as_bytes(), 100, BOOT, broker(), worker(), &s).is_err());
        }
    }
    #[test]
    fn impossible_subject_or_expiry_is_rejected() {
        let s = crate::tests::snapshot();
        for w in [
            WorkerIdentity { pid: 1, ..worker() },
            WorkerIdentity { uid: 0, ..worker() },
            WorkerIdentity {
                start_ticks: 0,
                ..worker()
            },
        ] {
            assert!(Grant::issue(INSTANCE, BOOT, 100, 1000, broker(), w, &s).is_err());
        }
        let mut v: serde_json::Value = serde_json::from_slice(&raw()).unwrap();
        v["expiresMillis"] = 501.into();
        assert!(Grant::validate(
            &serde_json::to_vec(&v).unwrap(),
            100,
            BOOT,
            broker(),
            worker(),
            &s
        )
        .is_err());
    }
}
