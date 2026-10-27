//! Selección cerrada del laboratorio: configuración IPC sin credenciales.
pub(crate) enum Bridge {
    Legacy(super::bridge::Bridge),
    #[cfg(all(
        feature = "protected-ipc-fixture",
        target_os = "linux",
        target_pointer_width = "64"
    ))]
    Protected(super::protected::Bridge),
}
impl Bridge {
    pub(crate) fn new(raw: &[u8]) -> Result<Self, ()> {
        #[cfg(all(
            feature = "protected-ipc-fixture",
            target_os = "linux",
            target_pointer_width = "64"
        ))]
        if serde_json::from_slice::<serde_json::Value>(raw)
            .ok()
            .and_then(|v| v.get("protectedIpc").and_then(|v| v.as_bool()))
            == Some(true)
        {
            return super::protected::Bridge::new(raw).map(Self::Protected);
        }
        super::bridge::Bridge::new(raw).map(Self::Legacy)
    }

    pub(crate) fn poll(&mut self) -> i32 {
        match self {
            Self::Legacy(b) => b.poll(),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.poll(),
        }
    }

    pub(crate) fn offer(&mut self) -> Result<Option<Vec<u8>>, ()> {
        match self {
            Self::Legacy(b) => b.offer(),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.offer(),
        }
    }

    pub(crate) fn answer(&mut self, value: String) -> Result<(), ()> {
        match self {
            Self::Legacy(b) => b.answer(value),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.answer(value),
        }
    }

    pub(crate) fn hello(&mut self, offer: String, answer: String) -> Result<Option<Vec<u8>>, ()> {
        match self {
            Self::Legacy(b) => b.hello(offer, answer),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.hello(offer, answer),
        }
    }

    pub(crate) fn control(&mut self, raw: &[u8]) -> Result<Vec<u8>, ()> {
        match self {
            Self::Legacy(_) => {
                let _ = raw;
                Ok(b"[]".to_vec())
            }
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.control(raw),
        }
    }
    pub(crate) fn authenticate(&mut self, raw: &[u8]) -> i32 {
        match self {
            Self::Legacy(b) => b.authenticate(raw),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.authenticate(raw),
        }
    }
    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_frame(&mut self) -> Result<Option<Vec<u8>>, ()> {
        match self {
            Self::Legacy(b) => b.native_frame(),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.native_frame(),
        }
    }
    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_input(&mut self, raw: &[u8]) -> Result<(), ()> {
        match self {
            Self::Legacy(b) => b.native_input(raw),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.native_input(raw),
        }
    }
    #[cfg(feature = "native-fixture")]
    pub(crate) fn native_status(&self) -> Vec<u8> {
        match self {
            Self::Legacy(b) => b.native_status(),
            #[cfg(all(
                feature = "protected-ipc-fixture",
                target_os = "linux",
                target_pointer_width = "64"
            ))]
            Self::Protected(b) => b.native_status(),
        }
    }
}
