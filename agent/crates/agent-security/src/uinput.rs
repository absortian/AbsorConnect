//! Dispositivo propio de entrada fija, optativo de laboratorio y sin descriptor exportable.
//! La autorización y el plazo pertenecen al guardián local que posee este recurso.
use std::{
    ffi::{c_char, c_int, c_uint, c_void},
    fs::{self, File, OpenOptions},
    os::{
        fd::AsRawFd,
        unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt},
    },
    path::Path,
    ptr,
    sync::atomic::{AtomicBool, Ordering},
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputError {
    Identity,
    Library,
    Device,
    Closed,
}
#[derive(Clone, Copy)]
pub enum FixedInput {
    KeyA,
    LeftButton,
}
static OWNED: AtomicBool = AtomicBool::new(false);
struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        OWNED.store(false, Ordering::Release);
    }
}
struct Library(*mut c_void);
impl Library {
    fn open() -> Result<Self, InputError> {
        #[cfg(target_arch = "aarch64")]
        let path = "/usr/lib/aarch64-linux-gnu/libevdev.so.2";
        #[cfg(target_arch = "x86_64")]
        let path = "/usr/lib/x86_64-linux-gnu/libevdev.so.2";
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        return Err(InputError::Library);
        #[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
        {
            let canonical = fs::canonicalize(path).map_err(|_| InputError::Library)?;
            for entry in canonical.ancestors() {
                let m = fs::symlink_metadata(entry).map_err(|_| InputError::Library)?;
                if m.uid() != 0 || m.mode() & 0o022 != 0 {
                    return Err(InputError::Library);
                }
            }
            if !canonical.is_file() {
                return Err(InputError::Library);
            }
            let name = std::ffi::CString::new(canonical.as_os_str().as_encoded_bytes())
                .map_err(|_| InputError::Library)?;
            // SAFETY: ruta fija resuelta en árbol root no escribible por otros; NUL válido.
            let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
            if handle.is_null() {
                Err(InputError::Library)
            } else {
                Ok(Self(handle))
            }
        }
    }
    fn symbol(&self, name: &[u8]) -> Result<*mut c_void, InputError> {
        // SAFETY: símbolo constante terminado en NUL, dentro de una biblioteca viva.
        let value = unsafe { libc::dlsym(self.0, name.as_ptr().cast()) };
        if value.is_null() {
            Err(InputError::Library)
        } else {
            Ok(value)
        }
    }
}
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            libc::dlclose(self.0);
        }
    }
}
macro_rules! functions {
    ($($field:ident:$symbol:literal:$kind:ty),* $(,)?)=>{
        struct Functions { $($field:$kind,)* _library:Library }
        impl Functions {
            fn load() -> Result<Self,InputError> {
                let library=Library::open()?;
                // SAFETY: firmas de la ABI pública libevdev 1.x, símbolos fijos y biblioteca viva.
                Ok(Self { $($field:unsafe {std::mem::transmute::<*mut c_void,$kind>(library.symbol(concat!($symbol,"\0").as_bytes())?)},)* _library:library })
            }
        }
    }
}
functions! {
    new:"libevdev_new":unsafe extern "C" fn()->*mut c_void,
    free:"libevdev_free":unsafe extern "C" fn(*mut c_void),
    name:"libevdev_set_name":unsafe extern "C" fn(*mut c_void,*const c_char),
    event_type:"libevdev_enable_event_type":unsafe extern "C" fn(*mut c_void,c_uint)->c_int,
    event_code:"libevdev_enable_event_code":unsafe extern "C" fn(*mut c_void,c_uint,c_uint,*const c_void)->c_int,
    create:"libevdev_uinput_create_from_device":unsafe extern "C" fn(*const c_void,c_int,*mut *mut c_void)->c_int,
    destroy:"libevdev_uinput_destroy":unsafe extern "C" fn(*mut c_void),
    write:"libevdev_uinput_write_event":unsafe extern "C" fn(*const c_void,c_uint,c_uint,c_int)->c_int,
}
fn require_lab() -> Result<(), InputError> {
    let marker = Path::new("/run/absorconnect-owned-vm-lab");
    let m = fs::symlink_metadata(marker).map_err(|_| InputError::Identity)?;
    // SAFETY: consultas escalares al proceso actual, sin punteros ni cambios de privilegio.
    if unsafe { libc::geteuid() } != 0
        || unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) } != 1
        || !m.is_file()
        || m.uid() != 0
        || m.nlink() != 1
        || m.mode() & 0o7777 != 0o444
        || fs::read(marker).map_err(|_| InputError::Identity)?
            != b"absorconnect-native-window-fixture-v1\n"
    {
        return Err(InputError::Identity);
    }
    let status = fs::read_to_string("/proc/self/status").map_err(|_| InputError::Identity)?;
    for key in ["CapEff:", "CapBnd:"] {
        let value = status
            .lines()
            .find_map(|line| line.strip_prefix(key))
            .ok_or(InputError::Identity)?;
        if u64::from_str_radix(value.trim(), 16).map_err(|_| InputError::Identity)? != 0 {
            return Err(InputError::Identity);
        }
    }
    Ok(())
}
pub struct Device {
    api: Functions,
    descriptor: Option<File>,
    description: *mut c_void,
    virtual_device: *mut c_void,
    _slot: Slot,
}
impl Device {
    pub fn new_fixed_lab() -> Result<Self, InputError> {
        require_lab()?;
        if OWNED
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(InputError::Device);
        }
        let slot = Slot;
        let api = Functions::load()?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_CLOEXEC | libc::O_NONBLOCK | libc::O_NOFOLLOW)
            .open("/dev/uinput")
            .map_err(|_| InputError::Device)?;
        let m = file.metadata().map_err(|_| InputError::Device)?;
        if !m.file_type().is_char_device()
            || m.uid() != 0
            || m.mode() & 0o022 != 0
            || m.rdev() != libc::makedev(10, 223)
        {
            return Err(InputError::Device);
        }
        let mut value = Self {
            api,
            descriptor: Some(file),
            description: ptr::null_mut(),
            virtual_device: ptr::null_mut(),
            _slot: slot,
        };
        // SAFETY: todos los objetos son propios, punteros aún vivos y códigos constantes.
        unsafe {
            value.description = (value.api.new)();
            if value.description.is_null() {
                return Err(InputError::Device);
            }
            (value.api.name)(value.description, b"AbsorConnectLabLease\0".as_ptr().cast());
            for kind in [1, 2] {
                if (value.api.event_type)(value.description, kind) != 0 {
                    return Err(InputError::Device);
                }
            }
            // Capacidades mínimas para clasificar el dispositivo; solo se emiten A e izquierdo.
            for code in [28, 30, 42, 44, 57, 272] {
                if (value.api.event_code)(value.description, 1, code, ptr::null()) != 0 {
                    return Err(InputError::Device);
                }
            }
            for code in [0, 1] {
                if (value.api.event_code)(value.description, 2, code, ptr::null()) != 0 {
                    return Err(InputError::Device);
                }
            }
            if (value.api.create)(
                value.description,
                value
                    .descriptor
                    .as_ref()
                    .ok_or(InputError::Device)?
                    .as_raw_fd(),
                &mut value.virtual_device,
            ) != 0
                || value.virtual_device.is_null()
            {
                return Err(InputError::Device);
            }
        }
        Ok(value)
    }
    pub fn apply(&mut self, event: FixedInput, down: bool) -> Result<(), InputError> {
        if self.virtual_device.is_null() || self.descriptor.is_none() {
            return Err(InputError::Closed);
        }
        let code = match event {
            FixedInput::KeyA => 30,
            FixedInput::LeftButton => 272,
        };
        // SAFETY: descriptor/objeto propios vivos, eventos cerrados y SYN_REPORT constante.
        let ok = unsafe {
            (self.api.write)(self.virtual_device, 1, code, i32::from(down)) == 0
                && (self.api.write)(self.virtual_device, 0, 0, 0) == 0
        };
        if ok {
            Ok(())
        } else {
            self.close();
            Err(InputError::Device)
        }
    }
    pub fn close(&mut self) {
        if !self.virtual_device.is_null() {
            // SAFETY: objeto propio único; se invalida inmediatamente para impedir doble destrucción.
            unsafe {
                (self.api.destroy)(self.virtual_device);
            }
            self.virtual_device = ptr::null_mut();
        }
        self.descriptor.take();
    }
}
impl Drop for Device {
    fn drop(&mut self) {
        self.close();
        if !self.description.is_null() {
            // SAFETY: descripción propia, posterior a la destrucción de su dispositivo virtual.
            unsafe {
                (self.api.free)(self.description);
            }
            self.description = ptr::null_mut();
        }
    }
}
