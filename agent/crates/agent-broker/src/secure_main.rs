//! Broker de credenciales/IPC en VM; no expone captura o administración.
#![forbid(unsafe_code)]
#[cfg(target_os = "linux")]
mod secure_linux;
fn main() {
    #[cfg(target_os = "linux")]
    let code = secure_linux::run().unwrap_or_else(|_| {
        eprintln!("secure_broker_lab_failed");
        78
    });
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    std::process::exit(code);
}
