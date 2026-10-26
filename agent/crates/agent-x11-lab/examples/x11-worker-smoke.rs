//! API real y ventana X11 propia; huellas/K públicas de laboratorio, sin P2P.
#[cfg(all(target_os = "linux", target_pointer_width = "64"))]
fn run() -> Result<serde_json::Value, &'static str> {
    use absor_agent_api::{
        http::{AgentApi, Credential},
        RenewingAgent,
    };
    use absor_agent_auth::{
        AttemptClock, AttemptState, AttemptStore, AuthError, DtlsBinding, Verifier,
    };
    use absor_agent_core::{clock::BootClock, SessionHandle};
    use absor_agent_x11_lab::{native_attempts, FixtureWorker, Operation, Reply};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        io::Read,
        sync::atomic::Ordering,
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    struct Memory(AttemptState);
    impl AttemptStore for Memory {
        fn load(&mut self) -> Result<AttemptState, AuthError> {
            Ok(self.0.clone())
        }
        fn commit(&mut self, s: &AttemptState) -> Result<(), AuthError> {
            self.0 = s.clone();
            Ok(())
        }
    }
    struct Wall;
    impl AttemptClock for Wall {
        fn unix_millis(&self) -> Result<u64, AuthError> {
            Ok(SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| AuthError::Clock)?
                .as_millis() as u64)
        }
    }
    let mut input = vec![];
    std::io::stdin()
        .take(4097)
        .read_to_end(&mut input)
        .map_err(|_| "config_read")?;
    if input.len() > 4096 {
        return Err("config_oversized");
    }
    let config: serde_json::Value = serde_json::from_slice(&input).map_err(|_| "config_invalid")?;
    let api = AgentApi::local_lab(
        config["origin"].as_str().ok_or("origin_missing")?,
        Credential::new(
            config["credential"]
                .as_str()
                .ok_or("credential_missing")?
                .into(),
        )
        .map_err(|_| "credential_invalid")?,
    )
    .map_err(|_| "origin_invalid")?;
    let mut agent = RenewingAgent::<BootClock, FixtureWorker>::new(BootClock, api);
    let deadline = Instant::now() + Duration::from_secs(8);
    while agent.check_authorization().is_err() {
        agent.tick().map_err(|_| "authorization_failed")?;
        if Instant::now() > deadline {
            return Err("api_timeout");
        }
        thread::sleep(Duration::from_millis(10));
    }
    let key: [u8; 32] = STANDARD
        .decode("T/Ffxp4GTajIgqtVcHNXZtYMdnBBQF0IbEnYU8WgO70=")
        .map_err(|_| "public_key")?
        .try_into()
        .map_err(|_| "public_key_size")?;
    let mut verifier = Verifier::new(
        &key,
        "c2FsdC1maWpvLTE2LWJ5dA==",
        600000,
        Memory(AttemptState::provisioned()),
        Wall,
    )
    .map_err(|_| "verifier")?;
    let offer = format!("sha-256 {}", ["AA"; 32].join(":"));
    let answer = format!("sha-256 {}", ["BB"; 32].join(":"));
    verifier
        .begin(
            DtlsBinding::new(offer.clone(), answer.clone()).map_err(|_| "binding")?,
            "VM propia".into(),
        )
        .map_err(|_| "challenge")?;
    if !matches!(
        verifier.authenticate(
            br#"{"v":1,"type":"auth","proof":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}"#
        ),
        Err(AuthError::WrongPassword)
    ) {
        return Err("wrong_proof_not_denied");
    }
    if native_attempts() != (0, 0, 0) {
        return Err("native_operation_before_auth");
    }
    let hello = verifier
        .begin(
            DtlsBinding::new(offer.clone(), answer.clone()).map_err(|_| "binding")?,
            "VM propia".into(),
        )
        .map_err(|_| "challenge")?;
    let signed = ring::hmac::sign(
        &ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &key),
        format!("absor-remote-auth-v1\n{}\n{offer}\n{answer}", hello.nonce).as_bytes(),
    );
    let proof = serde_json::json!({"v":1,"type":"auth","proof":STANDARD.encode(signed.as_ref())})
        .to_string();
    let verified = verifier
        .authenticate(proof.as_bytes())
        .map_err(|_| "valid_proof_denied")?;
    let worker = FixtureWorker::authenticated(verified);
    let closed = worker.closed_observer();
    let handle = agent
        .attach_authenticated(worker)
        .map_err(|_| "attach_denied")?;
    fn next(
        agent: &mut RenewingAgent<BootClock, FixtureWorker>,
        handle: &SessionHandle,
    ) -> Result<Reply, &'static str> {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            agent.tick().map_err(|_| "actor_failed")?;
            if let Some(reply) = agent
                .with_session(handle, |w| w.poll())
                .map_err(|_| "lease_denied")??
            {
                return Ok(reply);
            }
            if Instant::now() > deadline {
                return Err("worker_timeout");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    if config["expectLocked"].as_bool() == Some(true) {
        let denied = matches!(
            next(&mut agent, &handle),
            Err("unlocked_cinnamon_required" | "own_unlocked_session_required")
        );
        let (_, captures, inputs) = native_attempts();
        if !denied || captures != 0 || inputs != 0 {
            return Err("locked_context_was_not_denied");
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while !closed.load(Ordering::Acquire) {
            if Instant::now() > deadline {
                return Err("locked_worker_not_closed");
            }
            thread::sleep(Duration::from_millis(10));
        }
        return Ok(
            serde_json::json!({"status":"locked_context_denied","nativeCaptureAttempts":0,"nativeInputAttempts":0,"workerClosed":true,"readyForUnattended":false}),
        );
    }
    if !matches!(next(&mut agent, &handle)?, Reply::Ready) {
        return Err("worker_not_ready");
    }
    agent
        .with_session(&handle, |w| w.submit(Operation::Capture))
        .map_err(|_| "lease_denied")??;
    let red = match next(&mut agent, &handle)? {
        Reply::Frame(frame) => frame,
        _ => return Err("frame_missing"),
    };
    if red.width != 320
        || red.height != 180
        || red
            .rgb
            .chunks_exact(3)
            .filter(|p| p[0] > 200 && p[1] < 20 && p[2] < 20)
            .count()
            < 57000
    {
        return Err("red_capture_invalid");
    }
    agent
        .with_session(&handle, |w| w.submit(Operation::Pulse))
        .map_err(|_| "lease_denied")??;
    let counts = match next(&mut agent, &handle)? {
        Reply::Input(counts) => counts,
        _ => return Err("input_missing"),
    };
    agent
        .with_session(&handle, |w| w.submit(Operation::Capture))
        .map_err(|_| "lease_denied")??;
    let green = match next(&mut agent, &handle)? {
        Reply::Frame(frame) => frame,
        _ => return Err("frame_missing"),
    };
    if green
        .rgb
        .chunks_exact(3)
        .filter(|p| p[0] < 20 && p[1] > 200 && p[2] < 20)
        .count()
        < 57000
    {
        return Err("green_capture_invalid");
    }
    println!("READY_TO_CUT_NATIVE_WORKER_API");
    let started = Instant::now();
    while agent.check_authorization().is_ok() {
        agent.tick().map_err(|_| "actor_failed")?;
        if started.elapsed() > Duration::from_secs(31) {
            return Err("lease_survived_api_cut");
        }
        thread::sleep(Duration::from_millis(10));
    }
    let elapsed = started.elapsed().as_millis();
    if elapsed > 30000 {
        return Err("api_cut_too_late");
    }
    if agent
        .with_session(&handle, |w| w.submit(Operation::Capture))
        .is_ok()
    {
        return Err("capture_after_expiry");
    }
    if agent
        .with_session(&handle, |w| w.submit(Operation::Pulse))
        .is_ok()
    {
        return Err("input_after_expiry");
    }
    let cleanup = Instant::now();
    while !closed.load(Ordering::Acquire) {
        if cleanup.elapsed() > Duration::from_secs(2) {
            return Err("worker_did_not_close");
        }
        thread::sleep(Duration::from_millis(10));
    }
    let attempts = native_attempts();
    thread::sleep(Duration::from_millis(100));
    if native_attempts() != attempts {
        return Err("native_operations_after_cut");
    }
    Ok(
        serde_json::json!({"status":"native_worker_ok","platform":"linux","fixtureOnly":true,"p2pTested":false,"wrongProofRejected":true,"nativeAttemptsBeforeAuthentication":0,"redFrameCaptured":true,"greenFrameCaptured":true,"mouseDown":counts.mouse_down,"mouseUp":counts.mouse_up,"keyDown":counts.key_down,"keyUp":counts.key_up,"apiCutMilliseconds":elapsed,"captureAndInputRejectedAfterCut":true,"workerClosed":true,"readyForUnattended":false}),
    )
}
fn main() {
    #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
    match run() {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
    #[cfg(not(all(target_os = "linux", target_pointer_width = "64")))]
    {
        eprintln!("linux_vm_required");
        std::process::exit(64);
    }
}
