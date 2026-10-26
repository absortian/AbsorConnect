//! Diagnóstico acotado con eventos enumerados. Ninguna API acepta texto libre,
//! IDs de usuario, SDP, credenciales, contraseñas o datos de entrada.
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_RECORDS: usize = 64;
const MAX_BYTES: u64 = 16_384;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    BrokerStarted,
    WorkerStarted,
    WorkerEnded,
    WorkerDenied,
    WorkerFailed,
    AuthorizationDenied,
    AuthorizationExpired,
    AuthorizationRevoked,
    BrokerFailed,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    sequence: u64,
    event: Event,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    schema: u8,
    records: VecDeque<Record>,
}
#[derive(Debug, PartialEq, Eq)]
pub struct AuditError;

pub struct AuditLog {
    path: PathBuf,
    journal: Journal,
    failed: bool,
}
impl AuditLog {
    /// El instalador crea el padre privado; nunca usar una ruta llegada por RPC.
    pub fn open(path: &Path) -> Result<Self, AuditError> {
        let parent = path.parent().ok_or(AuditError)?;
        let meta = fs::symlink_metadata(parent).map_err(|_| AuditError)?;
        if !path.is_absolute() || !meta.is_dir() || meta.is_symlink() {
            return Err(AuditError);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if meta.permissions().mode() & 0o077 != 0 {
                return Err(AuditError);
            }
        }
        let journal = match fs::symlink_metadata(path) {
            Ok(meta) => {
                if !meta.is_file() || meta.is_symlink() || meta.len() > MAX_BYTES {
                    return Err(AuditError);
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if meta.permissions().mode() & 0o077 != 0 {
                        return Err(AuditError);
                    }
                }
                let mut bytes = Vec::new();
                File::open(path)
                    .map_err(|_| AuditError)?
                    .take(MAX_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| AuditError)?;
                if bytes.len() as u64 > MAX_BYTES {
                    return Err(AuditError);
                }
                let value: Journal = serde_json::from_slice(&bytes).map_err(|_| AuditError)?;
                if value.schema != 1 || value.records.len() > MAX_RECORDS {
                    return Err(AuditError);
                }
                let mut previous = None;
                for record in &value.records {
                    if record.sequence == 0
                        || previous.is_some_and(|n: u64| n.checked_add(1) != Some(record.sequence))
                    {
                        return Err(AuditError);
                    }
                    previous = Some(record.sequence);
                }
                value
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Journal {
                schema: 1,
                records: VecDeque::new(),
            },
            Err(_) => return Err(AuditError),
        };
        Ok(Self {
            path: path.to_owned(),
            journal,
            failed: false,
        })
    }
    pub fn append(&mut self, event: Event) -> Result<(), AuditError> {
        if self.failed {
            return Err(AuditError);
        }
        self.failed = true;
        let sequence = self
            .journal
            .records
            .back()
            .map_or(Some(1), |v| v.sequence.checked_add(1))
            .ok_or(AuditError)?;
        let mut records: VecDeque<_> = self
            .journal
            .records
            .iter()
            .map(|r| Record {
                sequence: r.sequence,
                event: r.event,
            })
            .collect();
        if records.len() == MAX_RECORDS {
            records.pop_front();
        }
        records.push_back(Record { sequence, event });
        let candidate = Journal { schema: 1, records };
        let bytes = serde_json::to_vec(&candidate).map_err(|_| AuditError)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(AuditError);
        }
        let next = self.path.with_extension("next");
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&next).map_err(|_| AuditError)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| AuditError)?;
        drop(file);
        fs::rename(&next, &self.path).map_err(|_| AuditError)?;
        #[cfg(unix)]
        {
            File::open(self.path.parent().ok_or(AuditError)?)
                .and_then(|f| f.sync_all())
                .map_err(|_| AuditError)?;
        }
        self.journal = candidate;
        self.failed = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "absor-audit-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            }
            Self(path)
        }
        fn path(&self) -> PathBuf {
            self.0.join("audit.json")
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn bounded_events_survive_reopening_without_free_text() {
        let scratch = Scratch::new();
        let mut log = AuditLog::open(&scratch.path()).unwrap();
        for _ in 0..70 {
            log.append(Event::WorkerStarted).unwrap();
        }
        drop(log);
        let mut log = AuditLog::open(&scratch.path()).unwrap();
        for event in [
            Event::WorkerEnded,
            Event::WorkerDenied,
            Event::AuthorizationExpired,
            Event::AuthorizationRevoked,
            Event::WorkerFailed,
        ] {
            log.append(event).unwrap();
        }
        let raw = fs::read(scratch.path()).unwrap();
        let value: Journal = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value.records.len(), 64);
        assert_eq!(value.records.front().unwrap().sequence, 12);
        assert_eq!(value.records.back().unwrap().sequence, 75);
        assert_eq!(value.records.back().unwrap().event, Event::WorkerFailed);
        assert!((raw.len() as u64) < MAX_BYTES);
    }
    #[test]
    fn corrupt_schema_extra_text_gaps_and_oversize_are_rejected() {
        let scratch = Scratch::new();
        for raw in [br#"{"schema":2,"records":[]}"#.as_slice(),br#"{"schema":1,"records":[{"sequence":1,"event":"password"}]}"#,br#"{"schema":1,"records":[{"sequence":1,"event":"worker_started","text":"secret"}]}"#,br#"{"schema":1,"records":[{"sequence":1,"event":"worker_started"},{"sequence":3,"event":"worker_ended"}]}"#] {
            fs::write(scratch.path(),raw).unwrap();
            #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(scratch.path(),fs::Permissions::from_mode(0o600)).unwrap(); }
            assert!(AuditLog::open(&scratch.path()).is_err());
        }
        fs::write(scratch.path(), vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(AuditLog::open(&scratch.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_and_nonprivate_parent_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let scratch = Scratch::new();
        let target = scratch.0.join("target");
        fs::write(&target, b"untouched").unwrap();
        symlink(&target, scratch.path()).unwrap();
        assert!(AuditLog::open(&scratch.path()).is_err());
        assert_eq!(fs::read(target).unwrap(), b"untouched");
        fs::remove_file(scratch.path()).unwrap();
        fs::set_permissions(&scratch.0, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(AuditLog::open(&scratch.path()).is_err());
    }
    #[test]
    fn stale_transaction_is_not_overwritten() {
        let scratch = Scratch::new();
        let mut log = AuditLog::open(&scratch.path()).unwrap();
        log.append(Event::BrokerStarted).unwrap();
        let previous = fs::read(scratch.path()).unwrap();
        fs::write(
            scratch.path().with_extension("next"),
            b"interrupted transaction",
        )
        .unwrap();
        assert_eq!(log.append(Event::BrokerFailed), Err(AuditError));
        assert_eq!(fs::read(scratch.path()).unwrap(), previous);
        fs::remove_file(scratch.path().with_extension("next")).unwrap();
        assert_eq!(log.append(Event::WorkerEnded), Err(AuditError));
    }
}
