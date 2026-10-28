//! Secretos y protocolo local; sin ejecución administrativa recibida de la red.
#![deny(unsafe_code)]
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
pub mod fd;
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
pub mod linux;
pub mod secrets;
pub mod wire;

#[cfg(all(target_os = "linux", feature = "protected-ipc-lab"))]
pub mod authority_client;
#[cfg(all(target_os = "linux", feature = "protected-ipc-lab"))]
pub mod client;

#[cfg(all(target_os = "linux", feature = "protected-ipc-lab"))]
pub mod profile;

#[cfg(all(target_os = "linux", feature = "input-lease-lab"))]
#[allow(unsafe_code)]
pub mod uinput;
