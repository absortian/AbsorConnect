//! Adaptador del dispositivo fijo; el descriptor permanece dentro del guardián.
use crate::input_lease::{FixedEvent, InputFault, OwnedInput};
use absor_agent_security::uinput::{Device, FixedInput};
impl OwnedInput for Device {
    fn apply(&mut self, event: FixedEvent) -> Result<(), InputFault> {
        let (event, down) = match event {
            FixedEvent::KeyA { down } => (FixedInput::KeyA, down),
            FixedEvent::LeftButton { down } => (FixedInput::LeftButton, down),
        };
        Device::apply(self, event, down).map_err(|_| InputFault::Device)
    }
    fn close(&mut self) {
        Device::close(self);
    }
}
