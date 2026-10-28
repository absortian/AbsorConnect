//! Selección de asiento local. Los metadatos no autorizan captura, entrada o administración.
//! Solo acepta propiedades de logind obtenidas por el lector local, nunca de la red o renderer.
#![forbid(unsafe_code)]

#[cfg(all(target_os = "linux", feature = "authority-lab"))]
pub mod authority_service;
pub mod binding;
pub mod grant;
#[cfg(target_os = "linux")]
pub mod grant_file;
pub mod monitor;
#[cfg(target_os = "linux")]
pub mod query;
#[cfg(target_os = "linux")]
pub mod service;
pub mod status;
pub mod xauthority;

use std::collections::BTreeMap;

const LIMIT: usize = 4096;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    Properties,
    Unsupported,
    NoSession,
    Query,
    Clock,
    Stalled,
    Closed,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionId(String);
impl SessionId {
    pub fn parse(raw: &str) -> Result<Self, Fault> {
        if raw.is_empty() || raw.len() > 32 || !raw.bytes().all(|v| v.is_ascii_alphanumeric()) {
            return Err(Fault::Properties);
        }
        Ok(Self(raw.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    User,
    Greeter,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Active,
    Online,
    Closing,
}
#[derive(Clone, PartialEq, Eq)]
pub struct Snapshot {
    id: SessionId,
    uid: u32,
    leader: u32,
    display: u8,
    kind: SessionKind,
    state: SessionState,
    locked_hint: bool,
}
impl std::fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Snapshot")
            .field("kind", &self.kind)
            .field("state", &self.state)
            .field("locked_hint", &self.locked_hint)
            .finish_non_exhaustive()
    }
}
impl Snapshot {
    pub fn from_properties(active: &SessionId, raw: &[u8]) -> Result<Self, Fault> {
        let p = properties(
            raw,
            &[
                "Id",
                "User",
                "Leader",
                "Display",
                "Seat",
                "Type",
                "Class",
                "State",
                "Remote",
                "LockedHint",
            ],
        )?;
        let id = SessionId::parse(p["Id"])?;
        if &id != active {
            return Err(Fault::NoSession);
        }
        if p["Seat"] != "seat0" || p["Type"] != "x11" || p["Remote"] != "no" {
            return Err(Fault::Unsupported);
        }
        let uid = number(p["User"])?;
        let leader = number(p["Leader"])?;
        if uid == 0 || leader == 0 {
            return Err(Fault::Unsupported);
        }
        let display = p["Display"].strip_prefix(':').ok_or(Fault::Properties)?;
        let display = u8::try_from(number(display)?).map_err(|_| Fault::Properties)?;
        let kind = match p["Class"] {
            "user" => SessionKind::User,
            "greeter" => SessionKind::Greeter,
            _ => return Err(Fault::Unsupported),
        };
        let state = match p["State"] {
            "active" => SessionState::Active,
            "online" => SessionState::Online,
            "closing" => SessionState::Closing,
            _ => return Err(Fault::Properties),
        };
        let locked_hint = match p["LockedHint"] {
            "yes" => true,
            "no" => false,
            _ => return Err(Fault::Properties),
        };
        Ok(Self {
            id,
            uid,
            leader,
            display,
            kind,
            state,
            locked_hint,
        })
    }
    pub fn id(&self) -> &SessionId {
        &self.id
    }
    pub fn uid(&self) -> u32 {
        self.uid
    }
    pub fn leader(&self) -> u32 {
        self.leader
    }
    pub fn display_number(&self) -> u8 {
        self.display
    }
    pub fn kind(&self) -> SessionKind {
        self.kind
    }
    pub fn state(&self) -> SessionState {
        self.state
    }
    pub fn locked_hint(&self) -> bool {
        self.locked_hint
    }
    /// Cinnamon no siempre publica LockedHint. Sin evidencia local adicional no declara escritorio.
    pub fn context(&self, cinnamon_active: Option<bool>, expected_greeter_uid: u32) -> Context {
        if self.state != SessionState::Active {
            return Context::Transition;
        }
        match self.kind {
            SessionKind::Greeter
                if self.uid == expected_greeter_uid && expected_greeter_uid != 0 =>
            {
                Context::Login
            }
            SessionKind::Greeter => Context::Unavailable,
            SessionKind::User if self.locked_hint || cinnamon_active == Some(true) => {
                Context::Locked
            }
            SessionKind::User if cinnamon_active == Some(false) => Context::UserDesktop,
            SessionKind::User => Context::Unavailable,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Context {
    UserDesktop,
    Locked,
    Login,
    Transition,
    Unavailable,
}

pub fn active_session(raw: &[u8]) -> Result<SessionId, Fault> {
    let p = properties(raw, &["ActiveSession"])?;
    if p["ActiveSession"].is_empty() {
        return Err(Fault::NoSession);
    }
    SessionId::parse(p["ActiveSession"])
}
fn number(raw: &str) -> Result<u32, Fault> {
    if raw.is_empty()
        || raw.len() > 10
        || !raw.bytes().all(|v| v.is_ascii_digit())
        || (raw.len() > 1 && raw.starts_with('0'))
    {
        return Err(Fault::Properties);
    }
    raw.parse().map_err(|_| Fault::Properties)
}
fn properties<'a>(raw: &'a [u8], keys: &[&str]) -> Result<BTreeMap<&'a str, &'a str>, Fault> {
    if raw.is_empty() || raw.len() > LIMIT || raw.iter().any(|v| !matches!(v, b'\n' | b' '..=b'~'))
    {
        return Err(Fault::Properties);
    }
    let raw = std::str::from_utf8(raw).map_err(|_| Fault::Properties)?;
    let mut values = BTreeMap::new();
    for line in raw.lines() {
        let (key, value) = line.split_once('=').ok_or(Fault::Properties)?;
        if !keys.contains(&key) || values.insert(key, value).is_some() {
            return Err(Fault::Properties);
        }
    }
    if values.len() != keys.len() {
        return Err(Fault::Properties);
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) const VALID: &str="Id=c1\nUser=1000\nLeader=1234\nDisplay=:0\nSeat=seat0\nType=x11\nClass=user\nState=active\nRemote=no\nLockedHint=no\n";
    pub(crate) fn snapshot() -> Snapshot {
        Snapshot::from_properties(&SessionId::parse("c1").unwrap(), VALID.as_bytes()).unwrap()
    }
    #[test]
    fn strict_local_seat() {
        let active = active_session(b"ActiveSession=c1\n").unwrap();
        let s = Snapshot::from_properties(&active, VALID.as_bytes()).unwrap();
        assert_eq!(s.uid(), 1000);
        assert_eq!(s.display_number(), 0);
        assert_eq!(s.context(Some(false), 110), Context::UserDesktop);
        assert_eq!(s.context(None, 110), Context::Unavailable);
        assert_eq!(s.context(Some(true), 110), Context::Locked);
    }
    #[test]
    fn duplicates_missing_unknown_binary_and_oversize_fail() {
        for raw in [
            VALID.replace("Leader=1234\n", ""),
            format!("{VALID}User=1000\n"),
            format!("{VALID}Name=untrusted\n"),
            VALID.replace("Id=c1", "Id=c1\0"),
            "x".repeat(4097),
        ] {
            assert!(
                Snapshot::from_properties(&SessionId::parse("c1").unwrap(), raw.as_bytes())
                    .is_err()
            );
        }
    }
    #[test]
    fn never_select_wayland_remote_seat_or_root() {
        for raw in [
            VALID.replace("Type=x11", "Type=wayland"),
            VALID.replace("Remote=no", "Remote=yes"),
            VALID.replace("seat0", "seat1"),
            VALID.replace("User=1000", "User=0"),
            VALID.replace("Class=user", "Class=manager"),
        ] {
            assert_eq!(
                Snapshot::from_properties(&SessionId::parse("c1").unwrap(), raw.as_bytes()),
                Err(Fault::Unsupported)
            );
        }
    }
    #[test]
    fn rejects_noncanonical_ids_displays_and_numbers() {
        for id in ["", "../c1", "c1;id", "c1\n", "c1/2", "-c1"] {
            assert!(SessionId::parse(id).is_err());
        }
        for (before, after) in [
            ("Display=:0", "Display=host:0"),
            ("Display=:0", "Display=:00"),
            ("Display=:0", "Display=:256"),
            ("User=1000", "User=01000"),
            ("Leader=1234", "Leader=0"),
            ("User=1000", "User=4294967296"),
        ] {
            assert!(Snapshot::from_properties(
                &SessionId::parse("c1").unwrap(),
                VALID.replace(before, after).as_bytes()
            )
            .is_err());
        }
    }
    #[test]
    fn session_changes_and_inactive_state_do_not_select_desktop() {
        assert_eq!(
            Snapshot::from_properties(&SessionId::parse("c2").unwrap(), VALID.as_bytes()),
            Err(Fault::NoSession)
        );
        let s = Snapshot::from_properties(
            &SessionId::parse("c1").unwrap(),
            VALID.replace("State=active", "State=closing").as_bytes(),
        )
        .unwrap();
        assert_eq!(s.context(Some(false), 110), Context::Transition);
    }
    #[test]
    fn greeter_identity_must_match_local_configuration() {
        let raw = VALID
            .replace("Class=user", "Class=greeter")
            .replace("User=1000", "User=110");
        let s =
            Snapshot::from_properties(&SessionId::parse("c1").unwrap(), raw.as_bytes()).unwrap();
        assert_eq!(s.context(None, 110), Context::Login);
        assert_eq!(s.context(None, 111), Context::Unavailable);
    }
    #[test]
    fn misleading_logind_hint_still_requires_cinnamon() {
        assert_eq!(snapshot().context(Some(true), 110), Context::Locked);
        let s = Snapshot::from_properties(
            &SessionId::parse("c1").unwrap(),
            VALID.replace("LockedHint=no", "LockedHint=yes").as_bytes(),
        )
        .unwrap();
        assert_eq!(s.context(Some(false), 110), Context::Locked);
    }
    #[test]
    fn empty_seat_is_not_a_default_session() {
        assert_eq!(active_session(b"ActiveSession=\n"), Err(Fault::NoSession));
    }
}
