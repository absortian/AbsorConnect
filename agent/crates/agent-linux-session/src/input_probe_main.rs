//! Solo laboratorio de VM con ventana y concesión propias.
fn main() {
    #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
    if absor_agent_linux_session::input_probe::run().is_ok() {
        println!("{{\"inputLeaseProbeCompleted\":true,\"readyForUnattended\":false}}");
        return;
    }
    #[cfg(all(target_os = "linux", target_pointer_width = "64"))]
    eprintln!(
        "input_lease_probe_failed_stage={}",
        absor_agent_linux_session::input_probe::STAGE.load(std::sync::atomic::Ordering::Relaxed)
    );
    std::process::exit(78);
}
