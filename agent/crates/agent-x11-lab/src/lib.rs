//! Trabajador inicial de captura/entrada: solo ventana propia en la VM X11.
//! No es un adaptador de escritorio ni un servicio, no acepta IDs externos.
#![deny(unsafe_code)]
#[cfg(all(feature = "x11-lab", target_os = "linux", target_pointer_width = "64"))]
mod worker;
#[cfg(all(feature = "x11-lab", target_os = "linux", target_pointer_width = "64"))]
#[allow(unsafe_code)]
mod x11;
#[cfg(all(feature = "x11-lab", target_os = "linux", target_pointer_width = "64"))]
pub use worker::{native_attempts, FixtureWorker, Operation, Reply};
#[cfg(all(feature = "x11-lab", target_os = "linux", target_pointer_width = "64"))]
pub use x11::{Frame, InputCounts};
