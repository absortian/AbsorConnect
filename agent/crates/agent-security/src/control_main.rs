//! Cliente local sin privilegios; única operación de parada terminal.
fn main() {
    #[cfg(target_os = "linux")]
    {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args.len() == 4 && args[0] == "stop" && args[1] == "--device-id" && args[3] == "--json" {
            if let Ok(reply) = absor_agent_security::control_client::stop(args[2].clone()) {
                if let Ok(raw) = reply.encode() {
                    use std::io::Write;
                    if std::io::stdout().write_all(&raw).is_ok() {
                        return;
                    }
                }
            }
        }
    }
    std::process::exit(78);
}
