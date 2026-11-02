//! Sonda optativa con operaciones cerradas sobre el almacén de una VM propia.
#[cfg(windows)]
fn run() -> Result<(), absor_agent_security::windows_vault::VaultError> {
    use absor_agent_auth::{AttemptClock, AttemptState, AttemptStore, AuthError, DtlsBinding};
    use absor_agent_security::windows_vault::{
        create_directory, require_system, VaultError, WindowsVault,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ring::rand::{SecureRandom, SystemRandom};
    use std::path::Path;

    require_system()?;
    let root = Path::new(r"C:\ProgramData\AbsorConnectVaultLab");
    // El instalador de VM verifica QEMU y protege raíz/binario/marcador antes de ejecutar.
    if std::env::current_exe().map_err(|_| VaultError::Metadata)?
        != root.join("absor-win-vault-check-lab.exe")
        || std::fs::read(root.join("lab-owner.txt")).map_err(|_| VaultError::Metadata)?
            != b"ABSOR_CONNECT_OWN_WINDOWS_VM_VAULT_V1\n"
    {
        return Err(VaultError::Identity);
    }
    let args: Vec<_> = std::env::args().skip(1).collect();
    let command = match args.as_slice() {
        [value] => value.as_str(),
        _ => return Err(VaultError::Schema),
    };
    let host = "11111111-2222-4333-8444-555555555555";
    let target = root.join("store");
    struct Clock(u64);
    impl AttemptClock for Clock {
        fn unix_millis(&self) -> Result<u64, AuthError> {
            Ok(self.0)
        }
    }
    let binding = || {
        DtlsBinding::new(
            format!("sha-256 {}", ["AA"; 32].join(":")),
            format!("sha-256 {}", ["BB"; 32].join(":")),
        )
        .map_err(|_| VaultError::Schema)
    };
    let mut facts = serde_json::Map::new();
    match command {
        "provision" | "provision-four" => {
            create_directory(root, "store")?;
            let mut key = [0; 32];
            let mut salt = [0; 16];
            let rng = SystemRandom::new();
            rng.fill(&mut key).map_err(|_| VaultError::Crypto)?;
            rng.fill(&mut salt).map_err(|_| VaultError::Crypto)?;
            let payload = serde_json::to_vec(&serde_json::json!({
                "schema":1,"hostId":host,"origin":"https://example.invalid",
                "credential":format!("acg_{}", "a".repeat(43)),
                "key":STANDARD.encode(key),"salt":STANDARD.encode(salt),"iterations":600000
            }))
            .map_err(|_| VaultError::Schema)?;
            let state = if command == "provision-four" {
                AttemptState::migrated(vec![1000, 2000, 3000, 4000], None, 4000)
            } else {
                AttemptState::migrated(vec![1000, 2000, 3000, 4000, 5000], Some(905000), 6000)
            }
            .map_err(|_| VaultError::Schema)?;
            let mut vault = WindowsVault::provision(&target, host, &payload, &state)?;
            let expected = serde_json::to_value(&state).map_err(|_| VaultError::Schema)?;
            let actual = serde_json::to_value(vault.load().map_err(|_| VaultError::Io)?)
                .map_err(|_| VaultError::Schema)?;
            facts.insert("statePreserved".into(), (actual == expected).into());
            facts.insert(
                "sameHost".into(),
                (vault.bundle()?.host_id() == host).into(),
            );
            facts.insert(
                "secondWriterDenied".into(),
                WindowsVault::open(&target, host).is_err().into(),
            );
        }
        "read" | "commit" | "revoke" => {
            let mut vault = WindowsVault::open(&target, host)?;
            let state = vault.load().map_err(|_| VaultError::Io)?;
            let value = serde_json::to_value(&state).map_err(|_| VaultError::Schema)?;
            if value["failures"].as_array().map(Vec::len) != Some(5)
                || value["locked_until"] != 905000
            {
                return Err(VaultError::Schema);
            }
            if command == "commit" {
                vault.commit(&state).map_err(|_| VaultError::Io)?;
            }
            if command == "revoke" {
                vault.revoke()?;
                vault.revoke()?;
            }
            facts.insert("statePreserved".into(), true.into());
            let bundle = vault.bundle();
            let expected = if command == "revoke" {
                matches!(bundle, Err(VaultError::Revoked))
            } else {
                bundle.map(|b| b.host_id() == host).unwrap_or(false)
            };
            facts.insert("sameHostOrRevoked".into(), expected.into());
        }
        "wrong-host" => {
            facts.insert(
                "wrongHostDenied".into(),
                WindowsVault::open(&target, "99999999-2222-4333-8444-555555555555")
                    .is_err()
                    .into(),
            );
        }
        "check-lock" | "fail-once" => {
            let vault = WindowsVault::open(&target, host)?;
            let bundle = vault.bundle()?;
            let (_, mut verifier) = bundle
                .into_authority(
                    vault,
                    Clock(if command == "fail-once" { 5000 } else { 6000 }),
                )
                .map_err(|_| VaultError::Schema)?;
            if command == "fail-once" {
                verifier
                    .begin(binding()?, "Vault lab".into())
                    .map_err(|_| VaultError::Schema)?;
                if !matches!(verifier.authenticate(b"{}"), Err(AuthError::WrongPassword)) {
                    return Err(VaultError::Schema);
                }
            }
            if !matches!(
                verifier.begin(binding()?, "Vault lab".into()),
                Err(AuthError::Locked { .. })
            ) {
                return Err(VaultError::Schema);
            }
            facts.insert("nativeVerifierLocked".into(), true.into());
        }
        "expect-denied" => {
            let error = WindowsVault::open(&target, host)
                .err()
                .ok_or(VaultError::Schema)?;
            println!(
                "{}",
                serde_json::json!({"schema":1,"ok":true,"denied":true,"reason":format!("{error:?}"),"readyForUnattended":false})
            );
            return Ok(());
        }
        _ => return Err(VaultError::Schema),
    }
    if facts.values().any(|v| v != &serde_json::Value::Bool(true)) {
        return Err(VaultError::Schema);
    }
    println!(
        "{}",
        serde_json::json!({"schema":1,"ok":true,"facts":facts,"readyForUnattended":false})
    );
    Ok(())
}
fn main() {
    #[cfg(windows)]
    match run() {
        Ok(()) => return,
        Err(error) => eprintln!("vault_lab_{error:?}"),
    }
    std::process::exit(78);
}
