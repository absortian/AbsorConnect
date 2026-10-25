fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // Solo esta dylib: resolver junto al ejecutable de diagnóstico.
        println!(
            "cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/libabsor_agent_webrtc_lab.dylib"
        );
    }
}
