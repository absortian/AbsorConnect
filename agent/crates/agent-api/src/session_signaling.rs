//! Estado de una sola solicitud/API, sin rutas, IDs o credenciales del renderer.
use crate::{
    http::{ApiError, PendingRequest},
    signaling::{Answer, Command, IceConfiguration, Reply, RequestId, SignalingLane},
};
use absor_agent_core::clock::{BootClock, Clock};
use std::{collections::VecDeque, time::Duration};

pub struct ApiSignaling {
    lane: SignalingLane,
    discard_reply: bool,
    requested: Option<String>,
    selected: Option<PendingRequest>,
    ice: Option<IceConfiguration>,
    ice_started: Option<Duration>,
    ice_deadline: Option<Duration>,
    taken: bool,
    answer: Option<Answer>,
    answered: bool,
    answering: bool,
    busy: VecDeque<String>,
    busy_inflight: Option<String>,
}
impl ApiSignaling {
    pub fn new(lane: SignalingLane, requested: Option<String>) -> Self {
        Self {
            lane,
            discard_reply: false,
            requested,
            selected: None,
            ice: None,
            ice_started: None,
            ice_deadline: None,
            taken: false,
            answer: None,
            answered: false,
            answering: false,
            busy: VecDeque::new(),
            busy_inflight: None,
        }
    }
    /// Conserva un solo carril/hilo. Descarta la respuesta en vuelo de la conexión
    /// anterior y rechaza su solicitud pendiente antes de seleccionar otra.
    pub fn reset(&mut self) {
        self.discard_reply = !self.lane.idle();
        if let Some(id) = self.busy_inflight.take() {
            if !self.busy.contains(&id) && self.busy.len() < 64 {
                self.busy.push_back(id);
            }
        }
        if let Some(selected) = self.selected.take() {
            if !self.answered && !self.busy.contains(&selected.id) && self.busy.len() < 64 {
                self.busy.push_back(selected.id);
            }
        }
        self.ice = None;
        self.ice_started = None;
        self.ice_deadline = None;
        self.taken = false;
        self.answer = None;
        self.answered = false;
        self.answering = false;
    }
    pub fn poll(
        &mut self,
        requests: Vec<PendingRequest>,
        authorized: bool,
    ) -> Result<(), ApiError> {
        if let Some(reply) = self.lane.poll()? {
            if self.discard_reply {
                self.discard_reply = false;
            } else {
                match reply {
                    Reply::Ice(result) => {
                        let ice = result?;
                        self.ice_deadline = Some(
                            self.ice_started
                                .ok_or(ApiError::InvalidResponse)?
                                .checked_add(Duration::from_secs(ice.ttl))
                                .ok_or(ApiError::InvalidResponse)?,
                        );
                        self.ice = Some(ice);
                    }
                    Reply::Completed(result) => {
                        if self.answering {
                            result?;
                            self.answering = false;
                            self.answered = true;
                        } else if self.busy_inflight.take().is_some() {
                            match result {
                                Ok(()) | Err(ApiError::RequestGone | ApiError::AlreadyAnswered) => {
                                }
                                Err(error) => return Err(error),
                            }
                        } else {
                            return Err(ApiError::InvalidResponse);
                        }
                    }
                }
            }
        }
        if !authorized {
            return Ok(());
        }
        for request in requests {
            if self.busy.contains(&request.id) || self.busy_inflight.as_ref() == Some(&request.id) {
                continue;
            }
            if self.selected.is_none()
                && self.requested.as_ref().map_or(true, |id| id == &request.id)
            {
                self.selected = Some(request);
            } else if self.selected.as_ref().is_some_and(|v| v.id == request.id)
                || self.busy.contains(&request.id)
                || self.busy_inflight.as_ref() == Some(&request.id)
            {
                continue;
            } else if self.busy.len() < 64 {
                self.busy.push_back(request.id);
            } else {
                return Err(ApiError::InvalidResponse);
            }
        }
        if self.lane.idle() {
            if self.ice_started.is_none() {
                self.ice_started = Some(BootClock.now().map_err(|_| ApiError::Unavailable)?);
                self.lane.submit(Command::Ice)?;
            } else if let Some(answer) = self.answer.take() {
                let id = RequestId::new(
                    self.selected
                        .as_ref()
                        .ok_or(ApiError::InvalidRequest)?
                        .id
                        .clone(),
                )?;
                self.lane.submit(Command::Answer(id, answer))?;
                self.answering = true;
            } else if let Some(id) = self.busy.pop_front() {
                self.lane
                    .submit(Command::Busy(RequestId::new(id.clone())?))?;
                self.busy_inflight = Some(id);
            }
        }
        Ok(())
    }
    pub fn offer(&mut self) -> Result<Option<Vec<u8>>, ApiError> {
        if self.taken {
            return Err(ApiError::InvalidRequest);
        }
        let (Some(selected), Some(ice), Some(deadline)) =
            (&self.selected, &self.ice, self.ice_deadline)
        else {
            return Ok(None);
        };
        if BootClock.now().map_err(|_| ApiError::Unavailable)? >= deadline {
            return Err(ApiError::InvalidResponse);
        }
        let bytes = serde_json::to_vec(
            &serde_json::json!({"offer":selected.offer,"iceServers":ice.ice_servers}),
        )
        .map_err(|_| ApiError::InvalidResponse)?;
        if bytes.len() > 262_144 {
            return Err(ApiError::InvalidResponse);
        }
        self.taken = true;
        Ok(Some(bytes))
    }
    pub fn answer(&mut self, value: String) -> Result<(), ApiError> {
        if !self.taken || self.answer.is_some() || self.answering || self.answered {
            return Err(ApiError::InvalidRequest);
        }
        self.answer = Some(Answer::new(value)?);
        Ok(())
    }
    pub fn ready_for_auth(&self) -> bool {
        self.answered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signaling::SignalingSource;
    use std::{
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
        thread,
        time::Instant,
    };
    struct Source(Arc<AtomicU64>);
    impl SignalingSource for Source {
        fn execute(&mut self, command: Command) -> Reply {
            match command {
                Command::Ice => Reply::Ice(Ok(IceConfiguration {
                    ice_servers: vec![],
                    ttl: 30,
                })),
                Command::Busy(_) => {
                    self.0.fetch_add(1, Ordering::SeqCst);
                    Reply::Completed(Ok(()))
                }
                Command::Answer(_, _) => {
                    self.0.fetch_add(10, Ordering::SeqCst);
                    Reply::Completed(Ok(()))
                }
            }
        }
    }
    fn request(number: u8) -> PendingRequest {
        PendingRequest {
            id: format!("00000000-0000-4000-8000-{number:012}"),
            controller_name: "Lab".into(),
            offer: format!("offer-{number}"),
            created_at: "2026-10-26T00:00:00Z".into(),
        }
    }
    #[test]
    fn offer_is_consumed_once_and_answer_confirmation_precedes_authentication() {
        let calls = Arc::new(AtomicU64::new(0));
        let mut state = ApiSignaling::new(SignalingLane::new(Source(calls.clone())), None);
        state.poll(vec![request(1), request(2)], true).unwrap();
        assert!(state.answer("early".into()).is_err());
        let deadline = Instant::now() + Duration::from_secs(2);
        let offer = loop {
            state.poll(vec![], true).unwrap();
            if let Some(offer) = state.offer().unwrap() {
                break offer;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        };
        assert!(String::from_utf8(offer).unwrap().contains("offer-1"));
        assert!(state.offer().is_err());
        assert!(!state.ready_for_auth());
        state.answer("v=0\r\n".into()).unwrap();
        assert!(state.answer("duplicate".into()).is_err());
        while !state.ready_for_auth() {
            state.poll(vec![], true).unwrap();
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 11);
    }
    #[test]
    fn pinned_request_never_selects_another_offer() {
        let calls = Arc::new(AtomicU64::new(0));
        let mut state = ApiSignaling::new(SignalingLane::new(Source(calls)), Some(request(2).id));
        state.poll(vec![request(1)], true).unwrap();
        assert!(state.selected.is_none());
        state.poll(vec![request(1), request(2)], true).unwrap();
        assert_eq!(state.selected.as_ref().unwrap().offer, "offer-2");
    }
}

#[cfg(test)]
mod reset_tests {
    use super::*;
    use crate::signaling::SignalingSource;
    use std::{sync::mpsc, thread, time::Instant};
    struct Source {
        started: mpsc::Sender<()>,
        resume: Option<mpsc::Receiver<()>>,
    }
    impl SignalingSource for Source {
        fn execute(&mut self, command: Command) -> Reply {
            match command {
                Command::Ice => {
                    if let Some(rx) = self.resume.take() {
                        self.started.send(()).unwrap();
                        rx.recv_timeout(Duration::from_secs(2)).unwrap();
                    }
                    Reply::Ice(Ok(IceConfiguration {
                        ice_servers: vec![],
                        ttl: 30,
                    }))
                }
                _ => Reply::Completed(Ok(())),
            }
        }
    }
    fn pending(n: u8) -> PendingRequest {
        PendingRequest {
            id: format!("00000000-0000-4000-8000-{n:012}"),
            controller_name: "Lab".into(),
            offer: format!("offer-{n}"),
            created_at: "2026-10-27T00:00:00Z".into(),
        }
    }
    #[test]
    fn old_inflight_ice_and_old_pending_request_cannot_authorize_next_connection() {
        let (started, seen) = mpsc::channel();
        let (resume, rx) = mpsc::channel();
        let mut s = ApiSignaling::new(
            SignalingLane::new(Source {
                started,
                resume: Some(rx),
            }),
            None,
        );
        s.poll(vec![pending(1)], true).unwrap();
        seen.recv_timeout(Duration::from_secs(1)).unwrap();
        s.reset();
        s.poll(vec![pending(1), pending(2)], true).unwrap();
        assert_eq!(s.selected.as_ref().unwrap().id, pending(2).id);
        assert!(s.offer().unwrap().is_none());
        assert!(!s.ready_for_auth());
        resume.send(()).unwrap();
        let end = Instant::now() + Duration::from_secs(2);
        loop {
            s.poll(vec![], true).unwrap();
            if let Some(bytes) = s.offer().unwrap() {
                assert!(String::from_utf8(bytes).unwrap().contains("offer-2"));
                break;
            }
            assert!(Instant::now() < end);
            thread::sleep(Duration::from_millis(1));
        }
        s.answer("v=0\r\n".into()).unwrap();
        while !s.ready_for_auth() {
            s.poll(vec![], true).unwrap();
            assert!(Instant::now() < end);
            thread::sleep(Duration::from_millis(1));
        }
        s.reset();
        assert!(!s.ready_for_auth());
        assert!(s.answer("late".into()).is_err());
    }
}
