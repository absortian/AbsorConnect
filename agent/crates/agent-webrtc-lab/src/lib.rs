//! Enlace de laboratorio con libwebrtc: nunca instalar como servicio.
#![deny(unsafe_code)]

#[cfg(feature = "lab-http")]
mod bridge;
#[cfg(feature = "lab-http")]
#[allow(unsafe_code)]
mod ffi;
