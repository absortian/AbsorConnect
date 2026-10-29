//! Instalador de laboratorio: stdin protegido → clave root + configuración cifrada.
#![forbid(unsafe_code)]
#[cfg(target_os = "linux")]
fn run() -> Result<(), ()> {
    use absor_agent_api::{
        enrollment::{EnrollmentClient, EnrollmentGrant},
        http::{AgentApi, Credential},
    };
    use absor_agent_security::{
        linux::{private_create, private_directory, uid},
        secrets::{seal, SecretBundle, WrappingKey},
    };
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct EnrollmentInput {
        origin: String,
        enrollment_token: String,
        key: String,
        salt: String,
        iterations: u32,
        #[serde(default)]
        migration: Option<absor_agent_security::migration::MigrationImport>,
    }
    use std::{
        fs::{self, File},
        io::Read,
        os::unix::fs::MetadataExt,
        path::Path,
    };
    let args: Vec<_> = std::env::args().skip(1).collect();
    let migration_mode = args == ["--migration-prepare"];
    if uid() != 0 || (!args.is_empty() && !migration_mode) {
        return Err(());
    }
    let parent = Path::new("/etc");
    let meta = fs::symlink_metadata(parent).map_err(|_| ())?;
    if !meta.is_dir() || meta.uid() != 0 || meta.mode() & 0o022 != 0 {
        return Err(());
    }
    let destination = parent.join("absorconnect-secure-lab");
    if destination.symlink_metadata().is_ok() {
        return Err(());
    }
    let mut raw = Vec::new();
    std::io::stdin()
        .take(4097)
        .read_to_end(&mut raw)
        .map_err(|_| ())?;
    if raw.len() > 4096 {
        return Err(());
    }
    let input: EnrollmentInput = serde_json::from_slice(&raw).map_err(|_| ())?;
    if input.migration.is_some() != migration_mode {
        return Err(());
    }
    if migration_mode {
        let marker = Path::new("/run/absorconnect-owned-vm-lab");
        let m = fs::symlink_metadata(marker).map_err(|_| ())?;
        if !m.is_file()
            || m.uid() != 0
            || m.gid() != 0
            || m.nlink() != 1
            || m.mode() & 0o7777 != 0o444
            || fs::read(marker).map_err(|_| ())? != b"absorconnect-native-window-fixture-v1\n"
        {
            return Err(());
        }
    }
    let attempts = input
        .migration
        .as_ref()
        .map(|m| m.attempts())
        .transpose()
        .map_err(|_| ())?;
    let grant = EnrollmentGrant::new(input.enrollment_token).map_err(|_| ())?;
    // Validar K/salt antes de consumir un permiso de alta.
    let mut plain = serde_json::json!({"schema":1,"hostId":"00000000-0000-4000-8000-000000000001",
        "origin":input.origin,"credential":format!("acg_{}","a".repeat(43)),
        "key":input.key,"salt":input.salt,"iterations":input.iterations});
    if let Some(migration) = input.migration.as_ref() {
        plain["hostId"] = serde_json::json!(migration.device_id);
        plain["migration"] = serde_json::to_value(migration).map_err(|_| ())?;
    }
    SecretBundle::parse(&serde_json::to_vec(&plain).map_err(|_| ())?).map_err(|_| ())?;
    let client = EnrollmentClient::local_lab(&input.origin).map_err(|_| ())?;
    let wrapping = WrappingKey::generate().map_err(|_| ())?;
    let staging = parent.join(".absorconnect-secure-lab-provision");
    private_directory(&staging).map_err(|_| ())?;
    let response = match input.migration.as_ref() {
        Some(migration) => {
            client.enroll_transaction_once(grant, &migration.device_id, &migration.transaction_id)
        }
        None => client.enroll_once(grant),
    };
    let enrolled = match response {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::remove_dir(&staging);
            return Err(());
        }
    };
    let id = enrolled.device_id;
    let credential = enrolled.credential.into_provisioning_secret();
    plain["hostId"] = serde_json::json!(id);
    plain["credential"] = serde_json::json!(credential);
    let result = (|| {
        let blob = seal(&serde_json::to_vec(&plain).map_err(|_| ())?, &wrapping).map_err(|_| ())?;
        private_create(&staging.join("wrapping.key"), wrapping.provisioning_bytes())
            .map_err(|_| ())?;
        private_create(&staging.join("host.sealed.json"), &blob).map_err(|_| ())?;
        if let Some(state) = attempts.as_ref() {
            private_create(
                &staging.join("imported-attempts.json"),
                &serde_json::to_vec(state).map_err(|_| ())?,
            )
            .map_err(|_| ())?;
        }
        private_create(
            &staging.join("owned-installation"),
            b"absorconnect-encrypted-host-lab-v1\n",
        )
        .map_err(|_| ())?;
        File::open(&staging)
            .and_then(|f| f.sync_all())
            .map_err(|_| ())?;
        fs::rename(&staging, &destination).map_err(|_| ())?;
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| ())?;
        Ok(())
    })();
    if result.is_err() {
        if let Ok(token) = Credential::new(credential) {
            if let Ok(mut api) = AgentApi::local_lab(&input.origin, token) {
                let _ = api.retire_enrolled_host(&id);
            }
        }
        if staging.exists() {
            let _ = fs::remove_dir_all(staging);
        }
        // Si falló sync del padre después de rename, retirar también nuestro destino.
        if destination.join("owned-installation").exists() {
            let _ = fs::remove_dir_all(destination);
        }
    }
    result
}
fn main() {
    #[cfg(target_os = "linux")]
    let code = if run().is_ok() {
        println!("{{\"sealed\":true,\"plaintextBundleWritten\":false}}");
        0
    } else {
        eprintln!("secret_provision_failed");
        78
    };
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    std::process::exit(code);
}
