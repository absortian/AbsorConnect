//! Ensayo local: solo crea y termina un hijo propio sin captura, entrada o red.
use absor_agent_core::clock::BootClock;
use absor_agent_core::{AuthorizationGate, CloseReason, Denied, Session};
use std::cell::{Cell, RefCell};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::time::{Duration, Instant};

struct Worker {
    child: Rc<RefCell<Child>>,
    closed: Rc<Cell<Option<CloseReason>>>,
}
impl Session for Worker {
    fn close(&mut self, reason: CloseReason) {
        self.child
            .borrow_mut()
            .kill()
            .expect("terminar solo el hijo propio");
        self.closed.set(Some(reason));
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--worker") {
        std::thread::sleep(Duration::from_secs(10));
        return;
    }
    assert_eq!(std::env::args().count(), 1);
    let child = Rc::new(RefCell::new(
        Command::new(std::env::current_exe().unwrap())
            .arg("--worker")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("crear hijo de laboratorio"),
    ));
    let closed = Rc::new(Cell::new(None));
    let mut gate = AuthorizationGate::new(BootClock);
    let ticket = gate.begin_validation().unwrap();
    gate.accept_validation(&ticket, Duration::from_millis(200))
        .unwrap();
    // Simula exclusivamente el límite de confianza del autenticador aún pendiente.
    let handle = gate
        .attach_authenticated(Worker {
            child: child.clone(),
            closed: closed.clone(),
        })
        .ok()
        .unwrap();
    let started = Instant::now();
    while closed.get().is_none() {
        std::thread::sleep(gate.poll().unwrap());
        if started.elapsed() > Duration::from_secs(2) {
            panic!("el watchdog no cortó");
        }
    }
    assert_eq!(closed.get(), Some(CloseReason::AuthorizationExpired));
    assert_eq!(
        gate.with_session(&handle, |_| panic!("operación tras caducar")),
        Err(Denied::NoAuthorization)
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(status) = child.borrow_mut().try_wait().unwrap() {
            assert!(!status.success());
            break;
        }
        assert!(Instant::now() < deadline, "el hijo no terminó");
        std::thread::sleep(Duration::from_millis(10));
    }
    println!("{{\"schema\":1,\"ownWorkerTerminatedOnExpiry\":true,\"operationAfterExpiryDenied\":true,\"realAuthenticationTested\":false,\"captureTested\":false,\"inputTested\":false}}");
}
