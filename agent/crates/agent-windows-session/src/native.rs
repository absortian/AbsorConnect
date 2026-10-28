//! Laboratorio SCM sin red, captura ni entrada. Solo metadatos enumerados.
mod child;
mod ipc;
mod service;
mod win;
pub use service::{monitor_run, service_run, worker_run};
pub use win::WinError;
