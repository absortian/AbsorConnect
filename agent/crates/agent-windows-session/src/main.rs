//! Ejecutable optativo de laboratorio Windows. Sin captura/entrada.
fn main() {
    #[cfg(windows)]
    if absor_agent_windows_session::native::service_run().is_ok() {
        return;
    }
    std::process::exit(78);
}
