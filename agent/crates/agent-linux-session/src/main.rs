#![forbid(unsafe_code)]
fn main() {
    #[cfg(target_os = "linux")]
    let code = match absor_agent_linux_session::service::run() {
        Ok(()) => 0,
        Err(absor_agent_linux_session::service::ServiceError::Configuration) => 78,
        Err(absor_agent_linux_session::service::ServiceError::Temporary) => 75,
    };
    #[cfg(not(target_os = "linux"))]
    let code = 78;
    if code != 0 {
        eprintln!("session_supervisor_unavailable");
    }
    std::process::exit(code);
}
