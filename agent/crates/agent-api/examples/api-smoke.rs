//! Prueba local de API y corte de un hijo propio; no es un servicio ni un host.
use absor_agent_api::http::{AgentApi, Credential};
use absor_agent_api::RenewingAgent;
use absor_agent_core::clock::BootClock;
use absor_agent_core::{CloseReason, Denied, Session};
use std::cell::{Cell, RefCell};
use std::io::{Read, Write};
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
            .expect("terminar hijo propio");
        self.closed.set(Some(reason));
    }
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--worker") {
        std::thread::sleep(Duration::from_secs(90));
        return;
    }
    assert_eq!(
        args.len(),
        3,
        "se necesita origen loopback y caso de prueba"
    );
    assert!(matches!(args[2].as_str(), "revocation" | "network-cut"));
    // La credencial exclusiva de laboratorio entra solo por stdin, nunca por argv/env.
    let mut input = Vec::new();
    std::io::stdin().take(128).read_to_end(&mut input).unwrap();
    let value =
        String::from_utf8(input).unwrap_or_else(|_| panic!("entrada de credencial inválida"));
    let token = Credential::new(value.trim().to_owned()).expect("credencial de agente válida");
    let api = AgentApi::local_lab(&args[1], token).expect("origen local de laboratorio válido");
    let mut agent = RenewingAgent::new(BootClock, api);
    let closed = Rc::new(Cell::new(None));
    let mut child: Option<Rc<RefCell<Child>>> = None;
    let mut handle = None;
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        match agent.tick() {
            Ok(progress) => {
                if matches!(progress.validation, Some(Ok(()))) && child.is_none() {
                    let process = Rc::new(RefCell::new(
                        Command::new(&args[0])
                            .arg("--worker")
                            .stdin(Stdio::null())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .spawn()
                            .unwrap(),
                    ));
                    // Solo simula la frontera v1; este hijo no tiene captura ni entrada.
                    handle = Some(
                        agent
                            .attach_authenticated(Worker {
                                child: process.clone(),
                                closed: closed.clone(),
                            })
                            .ok()
                            .unwrap(),
                    );
                    child = Some(process);
                    println!("{{\"phase\":\"worker_started\",\"workerPid\":{},\"realAuthenticationTested\":false}}",child.as_ref().unwrap().borrow().id());
                    std::io::stdout().flush().unwrap();
                }
                if closed.get().is_some() {
                    break;
                }
                std::thread::sleep(progress.next_wake);
            }
            Err(Denied::Stopped)
                if args[2] == "revocation" && closed.get() == Some(CloseReason::Revoked) =>
            {
                break
            }
            Err(_) => panic!("fallo de la prueba de renovación"),
        }
        if Instant::now() >= deadline {
            agent.stop();
            panic!("la prueba no terminó a tiempo");
        }
    }
    let reason = if args[2] == "revocation" {
        CloseReason::Revoked
    } else {
        CloseReason::AuthorizationExpired
    };
    assert_eq!(closed.get(), Some(reason));
    assert!(agent
        .with_session(handle.as_ref().unwrap(), |_| panic!(
            "operación tras cortar"
        ))
        .is_err());
    let child = child.expect("se creó el hijo propio");
    assert!(!child.borrow_mut().wait().unwrap().success());
    println!("{{\"phase\":\"complete\",\"ownWorkerTerminated\":true,\"operationAfterCutDenied\":true,\"realAuthenticationTested\":false,\"captureTested\":false,\"inputTested\":false}}");
}
