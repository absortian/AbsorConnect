//! Enlace de laboratorio con libwebrtc: no distribuir como servicio final.
#![deny(unsafe_code)]

#[cfg(feature = "lab-http")]
mod bridge;
#[cfg(feature = "lab-http")]
#[allow(unsafe_code)]
mod ffi;
#[cfg(all(
    feature = "native-fixture",
    any(test, all(target_os = "linux", target_pointer_width = "64"))
))]
mod native;
#[cfg(feature = "lab-http")]
mod signaling;
