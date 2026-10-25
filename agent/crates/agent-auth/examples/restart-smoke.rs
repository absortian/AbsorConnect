//! Diario efímero de laboratorio entre procesos reales. No es el almacén del servicio.
use absor_agent_auth::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

// Clave pública fija de prueba. Nunca leer contraseñas, K o datos de la app.
const KEY: [u8; 32] = [0x31; 32];
struct WallClock;
impl AttemptClock for WallClock {
    fn unix_millis(&self) -> Result<u64, AuthError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|v| u64::try_from(v.as_millis()).ok())
            .ok_or(AuthError::Clock)
    }
}
struct LabStore(PathBuf);
impl AttemptStore for LabStore {
    fn load(&mut self) -> Result<AttemptState, AuthError> {
        let mut raw = vec![];
        File::open(self.0.join("attempts.json"))
            .map_err(|_| AuthError::Storage)?
            .take(4097)
            .read_to_end(&mut raw)
            .map_err(|_| AuthError::Storage)?;
        if raw.len() > 4096 {
            return Err(AuthError::Storage);
        }
        serde_json::from_slice(&raw).map_err(|_| AuthError::Storage)
    }
    fn commit(&mut self, state: &AttemptState) -> Result<(), AuthError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let temp = self.0.join("attempts.new");
        let mut file = options.open(&temp).map_err(|_| AuthError::Storage)?;
        file.write_all(&serde_json::to_vec(state).map_err(|_| AuthError::Storage)?)
            .map_err(|_| AuthError::Storage)?;
        file.sync_all().map_err(|_| AuthError::Storage)?;
        drop(file);
        fs::rename(temp, self.0.join("attempts.json")).map_err(|_| AuthError::Storage)?;
        #[cfg(unix)]
        {
            File::open(&self.0)
                .and_then(|v| v.sync_all())
                .map_err(|_| AuthError::Storage)?;
        }
        Ok(())
    }
}
fn binding() -> DtlsBinding {
    DtlsBinding::new(
        format!("sha-256 {}", ["AB"; 32].join(":")),
        format!("sha-256 {}", ["CD"; 32].join(":")),
    )
    .unwrap()
}
fn child(path: &Path, action: &str) {
    let mut verifier = Verifier::new(
        &KEY,
        &STANDARD.encode([0x17; 16]),
        ITERATIONS,
        LabStore(path.into()),
        WallClock,
    )
    .unwrap();
    match action {
        "failure" => {
            verifier.begin(binding(), "Laboratorio".into()).unwrap();
            assert!(matches!(
                verifier.authenticate(b"{}"),
                Err(AuthError::WrongPassword)
            ));
        }
        "locked" => {
            assert!(matches!(
                verifier.begin(binding(), "Laboratorio".into()),
                Err(AuthError::Locked {
                    retry_after: 1..=900
                })
            ));
        }
        "success" => {
            let hello = verifier.begin(binding(), "Laboratorio".into()).unwrap();
            let context = format!(
                "absor-remote-auth-v1\n{}\n{}\n{}",
                hello.nonce,
                binding().offer(),
                binding().answer()
            );
            let tag = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, &KEY), context.as_bytes());
            let proof = serde_json::to_vec(
                &serde_json::json!({"v":1,"type":"auth","proof":STANDARD.encode(tag)}),
            )
            .unwrap();
            verifier.authenticate(&proof).unwrap().into_binding();
        }
        _ => panic!("acción de laboratorio desconocida"),
    }
}
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 4 && args[1] == "--child" {
        child(Path::new(&args[2]), &args[3]);
        return;
    }
    assert_eq!(args.len(), 1);
    let mut bytes = [0; 16];
    SystemRandom::new().fill(&mut bytes).unwrap();
    let name = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let path = std::env::temp_dir().join(format!("absor-auth-lab-{name}"));
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&path).unwrap();
    let scratch = Scratch(path);
    let mut store = LabStore(scratch.0.clone());
    store.commit(&AttemptState::provisioned()).unwrap();
    let run = |action: &str| {
        let output = Command::new(&args[0])
            .arg("--child")
            .arg(&scratch.0)
            .arg(action)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "falló el subproceso de laboratorio"
        );
        assert!(output.stdout.is_empty());
    };
    for _ in 0..5 {
        run("failure");
    }
    run("locked");
    // Solo el laboratorio provisiona un segundo caso independiente.
    store.commit(&AttemptState::provisioned()).unwrap();
    for _ in 0..4 {
        run("failure");
    }
    run("success");
    for _ in 0..4 {
        run("failure");
    }
    run("success");
    drop(scratch);
    println!("{{\"separateProcesses\":16,\"lockSurvivesRestart\":true,\"successClearsFailures\":true,\"realDtlsTested\":false,\"osStoreCertified\":false,\"productionTested\":false}}");
}
