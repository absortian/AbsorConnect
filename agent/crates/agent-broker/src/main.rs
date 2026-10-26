//! Servicio optativo de laboratorio. Nunca se ejecuta como root ni acepta RPC.
#![forbid(unsafe_code)]
#[cfg(target_os = "linux")]
mod linux;
fn main() {
    #[cfg(target_os = "linux")]
    let code = linux::run().unwrap_or_else(|_| {
        eprintln!(
            "broker_lab_failed_stage={}",
            linux::STAGE.load(std::sync::atomic::Ordering::Relaxed)
        );
        78
    });
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    std::process::exit(code);
}
