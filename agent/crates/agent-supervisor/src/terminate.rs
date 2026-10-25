//! Salida de emergencia sin ejecutar destructores/atexit de bibliotecas C++.
//! Solo termina este proceso; no acepta PID, identificadores o datos remotos.
#[cfg(unix)]
pub(crate) fn now() -> ! {
    extern "C" {
        fn _exit(status: i32) -> !;
    }
    // SAFETY: _exit no recibe punteros; termina exclusivamente este proceso.
    unsafe { _exit(72) }
}
#[cfg(windows)]
pub(crate) fn now() -> ! {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
        fn TerminateProcess(process: *mut std::ffi::c_void, code: u32) -> i32;
    }
    // SAFETY: pseudo-handle de este proceso; nunca se recibe un handle externo.
    unsafe {
        TerminateProcess(GetCurrentProcess(), 72);
    }
    // No continuar si el SO rechazase la terminación.
    std::process::abort()
}
#[cfg(not(any(unix, windows)))]
pub(crate) fn now() -> ! {
    std::process::abort()
}
