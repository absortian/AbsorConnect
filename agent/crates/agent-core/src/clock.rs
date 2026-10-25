//! Relojes que cuentan también el tiempo suspendido; nunca hora de calendario.
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClockError;

/// Solo implementaciones del broker: la muestra no procede del controlador.
pub trait Clock {
    fn now(&self) -> Result<Duration, ClockError>;
}

#[derive(Clone, Copy, Default)]
pub struct BootClock;

impl Clock for BootClock {
    fn now(&self) -> Result<Duration, ClockError> {
        native::now()
    }
}

#[cfg(all(target_os = "linux", target_pointer_width = "64"))]
#[allow(unsafe_code)]
mod native {
    use super::*;
    use std::os::raw::{c_int, c_long};
    #[repr(C)]
    struct Timespec {
        seconds: c_long,
        nanoseconds: c_long,
    }
    extern "C" {
        fn clock_gettime(id: c_int, time: *mut Timespec) -> c_int;
    }
    pub fn now() -> Result<Duration, ClockError> {
        let mut time = Timespec {
            seconds: 0,
            nanoseconds: 0,
        };
        // SAFETY: ABI Linux de 64 bits; salida inicializada, válida y exclusiva.
        let status = unsafe { clock_gettime(7, &mut time) }; // CLOCK_BOOTTIME
        if status != 0 || time.seconds < 0 || !(0..1_000_000_000).contains(&time.nanoseconds) {
            return Err(ClockError);
        }
        Ok(Duration::new(time.seconds as u64, time.nanoseconds as u32))
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod native {
    use super::*;
    #[repr(C)]
    struct Timebase {
        numerator: u32,
        denominator: u32,
    }
    extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }
    pub fn now() -> Result<Duration, ClockError> {
        let mut base = Timebase {
            numerator: 0,
            denominator: 0,
        };
        // SAFETY: salida con ABI mach_timebase_info_data_t, inicializada y exclusiva.
        if unsafe { mach_timebase_info(&mut base) } != 0
            || base.denominator == 0
            || base.numerator == 0
        {
            return Err(ClockError);
        }
        // SAFETY: mach_continuous_time no recibe punteros ni modifica memoria del llamador.
        let ticks = unsafe { mach_continuous_time() };
        let ns = u128::from(ticks) * u128::from(base.numerator) / u128::from(base.denominator);
        let seconds = u64::try_from(ns / 1_000_000_000).map_err(|_| ClockError)?;
        Ok(Duration::new(seconds, (ns % 1_000_000_000) as u32))
    }
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod native {
    use super::*;
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryInterruptTimePrecise(time: *mut u64);
    }
    pub fn now() -> Result<Duration, ClockError> {
        let mut units = 0_u64;
        // SAFETY: salida ULONGLONG inicializada, válida y exclusiva.
        unsafe { QueryInterruptTimePrecise(&mut units) };
        Ok(Duration::new(
            units / 10_000_000,
            ((units % 10_000_000) * 100) as u32,
        ))
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    all(target_os = "linux", target_pointer_width = "64")
)))]
mod native {
    use super::*;
    pub fn now() -> Result<Duration, ClockError> {
        Err(ClockError)
    }
}
