use absor_agent_core::clock::{Clock, ClockError};
use absor_agent_supervisor::{Fault, PeerWatch, Pulse, PEER_TIMEOUT};
use std::{cell::Cell, rc::Rc, time::Duration};
#[derive(Clone)]
struct Fake(Rc<Cell<Option<Duration>>>);
impl Clock for Fake {
    fn now(&self) -> Result<Duration, ClockError> {
        self.0.get().ok_or(ClockError)
    }
}
fn setup() -> (Fake, PeerWatch<Fake>) {
    let clock = Fake(Rc::new(Cell::new(Some(Duration::from_secs(10)))));
    let watch = PeerWatch::new(clock.clone(), PEER_TIMEOUT).unwrap();
    (clock, watch)
}
fn pulse(sequence: u64, millis: u64) -> Pulse {
    Pulse::new(sequence, Duration::from_millis(millis)).unwrap()
}
#[test]
fn exact_deadline_is_terminal_even_after_a_fresh_pulse() {
    let (clock, mut watch) = setup();
    watch.receive(pulse(1, 10_000)).unwrap();
    clock.0.set(Some(Duration::from_millis(11_999)));
    watch.poll().unwrap();
    clock.0.set(Some(Duration::from_millis(12_000)));
    assert_eq!(watch.poll(), Err(Fault::Timeout));
    assert_eq!(watch.receive(pulse(2, 12_000)), Err(Fault::Timeout));
}
#[test]
fn queued_pulses_use_sender_time_and_never_extend_from_receipt() {
    let (clock, mut watch) = setup();
    clock.0.set(Some(Duration::from_millis(11_900)));
    watch.receive(pulse(1, 10_000)).unwrap();
    clock.0.set(Some(Duration::from_millis(12_000)));
    assert_eq!(watch.poll(), Err(Fault::Timeout));
}
#[test]
fn replay_skipped_sequence_future_time_and_backwards_sender_time_stop() {
    for invalid in [
        pulse(1, 10_000),
        pulse(3, 10_000),
        pulse(2, 10_001),
        pulse(2, 9_999),
    ] {
        let (_, mut watch) = setup();
        watch.receive(pulse(1, 10_000)).unwrap();
        assert_eq!(watch.receive(invalid), Err(Fault::Protocol));
        assert_eq!(watch.poll(), Err(Fault::Protocol));
    }
}
#[test]
fn suspend_clock_error_and_backwards_clock_fail_closed() {
    for now in [
        None,
        Some(Duration::from_secs(9)),
        Some(Duration::from_secs(50)),
    ] {
        let (clock, mut watch) = setup();
        clock.0.set(now);
        assert!(watch.poll().is_err());
        clock.0.set(Some(Duration::from_secs(10)));
        assert!(watch.poll().is_err());
    }
}
#[test]
fn progressing_peer_and_eof() {
    let (clock, mut watch) = setup();
    for sequence in 1..100 {
        let millis = 10_000 + sequence * 100;
        clock.0.set(Some(Duration::from_millis(millis)));
        watch.receive(pulse(sequence, millis)).unwrap();
    }
    watch.close();
    assert_eq!(watch.poll(), Err(Fault::Closed));
}
#[test]
fn strict_bounded_wire_protocol() {
    assert_eq!(
        Pulse::parse(pulse(1, 10_000).encode().as_bytes())
            .unwrap()
            .encode(),
        pulse(1, 10_000).encode()
    );
    for invalid in [
        "ABSOR_LAB_PULSE_V1 0 0\n",
        "ABSOR_LAB_PULSE_V1 +1 1\n",
        "ABSOR_LAB_PULSE_V1 01 1\n",
        "ABSOR_LAB_PULSE_V1 1 1\r\n",
        "ABSOR_LAB_PULSE_V1 1 1",
        "ABSOR_LAB_PULSE_V1 1 1 2\n",
    ] {
        assert!(Pulse::parse(invalid.as_bytes()).is_err());
    }
    assert!(Pulse::parse(&[b'0'; 81]).is_err());
}

#[test]
fn full_pipe_queue_is_terminal_but_eof_is_still_observed() {
    use absor_agent_supervisor::pipe::read_events;
    use std::{io::Cursor, thread, time::Instant};
    let payload = pulse(1, 10_000).encode().repeat(100);
    let events = read_events(Cursor::new(payload.into_bytes()), false);
    let started = Instant::now();
    while events.closed_at().is_none() {
        assert!(started.elapsed() < Duration::from_secs(3));
        thread::sleep(Duration::from_millis(5));
    }
    assert!(matches!(events.try_recv(), Ok(Err(Fault::Protocol))));
    assert!(matches!(events.try_recv(), Ok(Err(Fault::Protocol))));
}

#[test]
fn truncated_or_oversized_pipe_never_becomes_a_valid_pulse() {
    use absor_agent_supervisor::pipe::read_events;
    use std::{io::Cursor, sync::mpsc::TryRecvError, thread, time::Instant};
    for bytes in [
        b"ABSOR_LAB_PULSE_V1 1 1".to_vec(),
        [b"ABSOR_LAB_PULSE_V1 ".as_slice(), &vec![b'1'; 4096], b"\n"].concat(),
    ] {
        let events = read_events(Cursor::new(bytes), false);
        let started = Instant::now();
        loop {
            match events.try_recv() {
                Ok(Err(Fault::Protocol)) | Err(TryRecvError::Disconnected) => break,
                Err(TryRecvError::Empty) => (),
                _ => panic!("se aceptó un pulso inválido"),
            }
            assert!(started.elapsed() < Duration::from_secs(3));
            thread::sleep(Duration::from_millis(5));
        }
    }
}
