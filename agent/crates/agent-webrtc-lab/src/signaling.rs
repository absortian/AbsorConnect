//! Estado de una sola solicitud/API, sin rutas, IDs o credenciales del renderer.
use absor_agent_api::{
    http::{ApiError, PendingRequest},
    signaling::{Answer, Command, IceConfiguration, Reply, RequestId, SignalingLane},
};
use absor_agent_core::clock::{BootClock, Clock};
use std::{collections::VecDeque, time::Duration};

pub(crate) struct ApiSignaling {
    lane: SignalingLane,
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
    pub(crate) fn new(lane: SignalingLane, requested: Option<String>) -> Self {
        Self {
            lane,
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
    pub(crate) fn poll(
        &mut self,
        requests: Vec<PendingRequest>,
        authorized: bool,
    ) -> Result<(), ApiError> {
        if let Some(reply) = self.lane.poll()? {
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
                            Ok(()) | Err(ApiError::RequestGone | ApiError::AlreadyAnswered) => (),
                            Err(error) => return Err(error),
                        }
                    } else {
                        return Err(ApiError::InvalidResponse);
                    }
                }
            }
        }
        if !authorized {
            return Ok(());
        }
        for request in requests {
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
    pub(crate) fn offer(&mut self) -> Result<Option<Vec<u8>>, ApiError> {
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
    pub(crate) fn answer(&mut self, value: String) -> Result<(), ApiError> {
        if !self.taken || self.answer.is_some() || self.answering || self.answered {
            return Err(ApiError::InvalidRequest);
        }
        self.answer = Some(Answer::new(value)?);
        Ok(())
    }
    pub(crate) fn ready_for_auth(&self) -> bool {
        self.answered
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use absor_agent_api::signaling::SignalingSource;
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
