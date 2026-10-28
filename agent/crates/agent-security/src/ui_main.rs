//! Únicamente consulta de estado local; no acepta shell, rutas, K o tokens.
fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::args().skip(1).collect::<Vec<_>>() != ["status", "--json"] {
            std::process::exit(78);
        }
        if let Ok(value) = absor_agent_security::ui_client::query() {
            if let Ok(bytes) = value.encode() {
                use std::io::Write;
                if std::io::stdout().write_all(&bytes).is_ok() {
                    return;
                }
            }
        }
    }
    std::process::exit(78);
}
