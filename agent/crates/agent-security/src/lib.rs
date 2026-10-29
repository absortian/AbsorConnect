//! Secretos y protocolo local; sin ejecución administrativa recibida de la red.
#![deny(unsafe_code)]
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
pub mod fd;
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
pub mod linux;
pub mod migration;
pub mod secrets;
pub mod status_wire;
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

#[cfg(all(target_os = "linux", feature = "ui-status-lab"))]
pub mod ui_profile;

#[cfg(all(target_os = "linux", feature = "ui-status-lab"))]
pub mod ui_client;
#[cfg(all(target_os = "linux", feature = "ui-status-lab"))]
pub mod ui_server;

#[cfg(all(target_os = "linux", feature = "ui-control-lab"))]
pub mod control_client;
#[cfg(all(target_os = "linux", feature = "ui-control-lab"))]
pub mod control_server;
pub mod control_wire;
