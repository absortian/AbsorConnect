fn main() {
    #[cfg(target_os = "linux")]
    let code = absor_agent_linux_session::authority_service::run().map_or(78, |_| 0);
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    std::process::exit(code);
}
