//! Diagnóstico de metadatos; no captura, entrada, credenciales ni instalación.
#[cfg(target_os = "linux")]
fn main() {
    use absor_agent_core::clock::BootClock;
    use absor_agent_linux_session::{
        monitor::{Monitor, FRESH_FOR},
        query::LogindSource,
        SessionKind,
    };
    let result = (|| {
        let mut monitor = Monitor::new(BootClock, LogindSource::new()?)?;
        let end = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < end {
            if let Some(snapshot) = monitor.tick()? {
                println!("{{\"schema\":1,\"localSeatVerified\":true,\"x11\":true,\"greeter\":{},\"userSession\":{},\"active\":{},\"logindLockedHint\":{},\"freshnessMilliseconds\":{},\"captureTested\":false,\"inputTested\":false,\"readyForUnattended\":false}}",snapshot.kind()==SessionKind::Greeter,snapshot.kind()==SessionKind::User,snapshot.state()==absor_agent_linux_session::SessionState::Active,snapshot.locked_hint(),FRESH_FOR.as_millis());
                return Ok::<(), absor_agent_linux_session::Fault>(());
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        Err(absor_agent_linux_session::Fault::Query)
    })();
    if result.is_err() {
        eprintln!("seat_inventory_unavailable");
        std::process::exit(78);
    }
}
#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("seat_inventory_linux_only");
    std::process::exit(78);
}
