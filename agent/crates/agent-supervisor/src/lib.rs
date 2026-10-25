//! Vigilancia de progreso entre procesos locales del mismo arranque del SO.
//! Un pulso prueba vida, nunca identidad, contraseña o autorización de captura.
#![deny(unsafe_code)]

use absor_agent_core::clock::Clock;
use std::time::Duration;

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_millis(100);
pub const PEER_TIMEOUT: Duration = Duration::from_secs(2);
pub const POLL_INTERVAL: Duration = Duration::from_millis(20);
pub const PREFIX: &str = "ABSOR_LAB_PULSE_V1 ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    Clock,
    Timeout,
    Protocol,
    Closed,
}

#[derive(Debug, Clone, Copy)]
pub struct Pulse {
    sequence: u64,
    timestamp: Duration,
}
impl Pulse {
    pub fn new(sequence: u64, timestamp: Duration) -> Result<Self, Fault> {
        if sequence == 0 || timestamp.as_nanos() > u128::from(u64::MAX) {
            return Err(Fault::Protocol);
        }
        Ok(Self {
            sequence,
            timestamp,
        })
    }
    pub fn encode(&self) -> String {
        format!("{PREFIX}{} {}\n", self.sequence, self.timestamp.as_nanos())
    }
    pub fn parse(line: &[u8]) -> Result<Self, Fault> {
        if line.len() > 80 || !line.ends_with(b"\n") {
            return Err(Fault::Protocol);
        }
        let text = std::str::from_utf8(line).map_err(|_| Fault::Protocol)?;
        let parts: Vec<_> = text
            .strip_prefix(PREFIX)
            .and_then(|v| v.strip_suffix('\n'))
            .ok_or(Fault::Protocol)?
            .split(' ')
            .collect();
        if parts.len() != 2 {
            return Err(Fault::Protocol);
        }
        let number = |value: &str| -> Result<u64, Fault> {
            let n = value.parse::<u64>().map_err(|_| Fault::Protocol)?;
            if n.to_string() != value {
                return Err(Fault::Protocol);
            }
            Ok(n)
        };
        Self::new(number(parts[0])?, Duration::from_nanos(number(parts[1])?))
    }
}

/// Estado terminal: ni pulsos tardíos, repetidos o almacenados rehabilitan al par.
pub struct PeerWatch<C: Clock> {
    clock: C,
    last_now: Duration,
    deadline: Duration,
    sequence: u64,
    peer_time: Duration,
    failed: Option<Fault>,
}
impl<C: Clock> PeerWatch<C> {
    pub fn new(clock: C, startup: Duration) -> Result<Self, Fault> {
        if startup.is_zero() || startup > Duration::from_secs(5) {
            return Err(Fault::Protocol);
        }
        let now = clock.now().map_err(|_| Fault::Clock)?;
        let deadline = now.checked_add(startup).ok_or(Fault::Clock)?;
        Ok(Self {
            clock,
            last_now: now,
            deadline,
            sequence: 0,
            peer_time: Duration::ZERO,
            failed: None,
        })
    }
    fn fail<T>(&mut self, error: Fault) -> Result<T, Fault> {
        self.failed = Some(error);
        Err(error)
    }
    pub fn poll(&mut self) -> Result<(), Fault> {
        if let Some(error) = self.failed {
            return Err(error);
        }
        let now = match self.clock.now() {
            Ok(now) if now >= self.last_now => now,
            _ => return self.fail(Fault::Clock),
        };
        self.last_now = now;
        if now >= self.deadline {
            return self.fail(Fault::Timeout);
        }
        Ok(())
    }
    pub fn receive(&mut self, pulse: Pulse) -> Result<(), Fault> {
        self.poll()?;
        if self.sequence.checked_add(1) != Some(pulse.sequence)
            || pulse.timestamp < self.peer_time
            || pulse.timestamp > self.last_now
        {
            return self.fail(Fault::Protocol);
        }
        let Some(deadline) = pulse.timestamp.checked_add(PEER_TIMEOUT) else {
            return self.fail(Fault::Clock);
        };
        if self.last_now >= deadline {
            return self.fail(Fault::Timeout);
        }
        self.deadline = deadline;
        self.sequence = pulse.sequence;
        self.peer_time = pulse.timestamp;
        Ok(())
    }
    pub fn close(&mut self) {
        self.failed = Some(Fault::Closed);
    }
}

pub mod pipe;
#[cfg(feature = "synthetic-lab")]
pub mod synthetic;
#[cfg(feature = "synthetic-lab")]
#[allow(unsafe_code)]
mod terminate;
