//! ABI Xlib de Linux de 64 bits; solo biblioteca fijada y ventana propia.
//! No usa xhost, no copia Xauthority y no acepta un XID o ruta de DLL externos.
use std::{
    ffi::{c_char, c_int, c_uint, c_ulong, c_void},
    fs,
    os::unix::fs::MetadataExt,
    path::PathBuf,
    process::Command,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
type Display = *mut c_void;
type Window = c_ulong;
fn query(program: &str, args: &[&str]) -> Result<String, &'static str> {
    let result = Command::new("/usr/bin/timeout")
        .args(["2s", program])
        .args(args)
        .output()
        .map_err(|_| "session_query_failed")?;
    if !result.status.success() || result.stdout.len() > 4096 {
        return Err("session_query_failed");
    }
    String::from_utf8(result.stdout)
        .map(|v| v.trim().to_owned())
        .map_err(|_| "session_query_failed")
}
fn context() -> Result<String, &'static str> {
    let id = query(
        "/usr/bin/loginctl",
        &["show-seat", "seat0", "-p", "ActiveSession", "--value"],
    )?;
    if id.is_empty() || id.len() > 32 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("own_session_required");
    }
    let raw = query(
        "/usr/bin/loginctl",
        &[
            "show-session",
            &id,
            "-p",
            "User",
            "-p",
            "Type",
            "-p",
            "Class",
            "-p",
            "State",
            "-p",
            "Display",
            "-p",
            "LockedHint",
        ],
    )?;
    let properties: std::collections::HashMap<_, _> = raw
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect();
    let uid = unsafe { geteuid() };
    let expected = uid.to_string();
    for (key, value) in [
        ("User", expected.as_str()),
        ("Type", "x11"),
        ("Class", "user"),
        ("State", "active"),
        ("Display", ":0"),
        ("LockedHint", "no"),
    ] {
        if properties.get(key) != Some(&value) {
            return Err("own_unlocked_session_required");
        }
    }
    let bus = format!("unix:path=/run/user/{uid}/bus");
    if query(
        "/usr/bin/gdbus",
        &[
            "call",
            "--address",
            &bus,
            "--dest",
            "org.cinnamon.ScreenSaver",
            "--object-path",
            "/org/cinnamon/ScreenSaver",
            "--method",
            "org.cinnamon.ScreenSaver.GetActive",
        ],
    )? != "(false,)"
    {
        return Err("unlocked_cinnamon_required");
    }
    Ok(id)
}
// XWindowAttributes de Xlib LP64; los campos se conservan en el orden del SDK.
#[repr(C)]
struct Attributes {
    x: c_int,
    y: c_int,
    width: c_int,
    height: c_int,
    border_width: c_int,
    depth: c_int,
    visual: *mut c_void,
    root: Window,
    class: c_int,
    bit_gravity: c_int,
    win_gravity: c_int,
    backing_store: c_int,
    backing_planes: c_ulong,
    backing_pixel: c_ulong,
    save_under: c_int,
    colormap: c_ulong,
    map_installed: c_int,
    map_state: c_int,
    all_event_masks: i64,
    your_event_mask: i64,
    do_not_propagate_mask: i64,
    override_redirect: c_int,
    screen: *mut c_void,
}
#[repr(C)]
struct SetAttributes {
    background_pixmap: c_ulong,
    background_pixel: c_ulong,
    border_pixmap: c_ulong,
    border_pixel: c_ulong,
    bit_gravity: c_int,
    win_gravity: c_int,
    backing_store: c_int,
    backing_planes: c_ulong,
    backing_pixel: c_ulong,
    save_under: c_int,
    event_mask: i64,
    do_not_propagate_mask: i64,
    override_redirect: c_int,
    colormap: c_ulong,
    cursor: c_ulong,
}
static INITIALIZED: OnceLock<bool> = OnceLock::new();
static IN_USE: AtomicBool = AtomicBool::new(false);
struct Slot;
impl Slot {
    fn acquire() -> Result<Self, &'static str> {
        IN_USE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "one_native_surface_per_process")
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        IN_USE.store(false, Ordering::Release);
    }
}
#[link(name = "dl")]
extern "C" {
    fn dlopen(name: *const c_char, flags: c_int) -> *mut c_void;
    fn dlsym(lib: *mut c_void, name: *const c_char) -> *mut c_void;
    fn dlclose(lib: *mut c_void) -> c_int;
    fn geteuid() -> c_uint;
}
struct Library(*mut c_void);
impl Library {
    fn open(name: &[u8]) -> Result<Self, &'static str> {
        // SAFETY: rutas constantes del SO. RTLD_NODELETE conserva callbacks TLS de
        // Xlib hasta terminar el proceso; solo se cargan estas dos bibliotecas.
        let handle = unsafe { dlopen(name.as_ptr().cast(), 2 | 0x1000) };
        if handle.is_null() {
            Err("x11_library_unavailable")
        } else {
            Ok(Self(handle))
        }
    }
    fn symbol(&self, name: &[u8]) -> Result<*mut c_void, &'static str> {
        // SAFETY: biblioteca viva y símbolo constante terminado en NUL.
        let result = unsafe { dlsym(self.0, name.as_ptr().cast()) };
        if result.is_null() {
            Err("x11_symbol_unavailable")
        } else {
            Ok(result)
        }
    }
}
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            dlclose(self.0);
        }
    }
}
macro_rules! functions {
    ($($field:ident:$symbol:literal:$kind:ty),* $(,)?)=>{
        struct Functions {$($field:$kind,)* _library:Library}
        impl Functions {fn load(library:Library)->Result<Self,&'static str>{
            Ok(Self{$($field:unsafe{std::mem::transmute::<*mut c_void,$kind>(library.symbol(concat!($symbol,"\0").as_bytes())?)},)*_library:library})
        }}
    }
}
functions! {
    open:"XOpenDisplay":unsafe extern "C" fn(*const c_char)->Display,
    close:"XCloseDisplay":unsafe extern "C" fn(Display)->c_int,
    screen:"XDefaultScreen":unsafe extern "C" fn(Display)->c_int,
    depth:"XDefaultDepth":unsafe extern "C" fn(Display,c_int)->c_int,
    root:"XRootWindow":unsafe extern "C" fn(Display,c_int)->Window,
    create:"XCreateSimpleWindow":unsafe extern "C" fn(Display,Window,c_int,c_int,c_uint,c_uint,c_uint,c_ulong,c_ulong)->Window,
    destroy:"XDestroyWindow":unsafe extern "C" fn(Display,Window)->c_int,
    select:"XSelectInput":unsafe extern "C" fn(Display,Window,i64)->c_int,
    map:"XMapWindow":unsafe extern "C" fn(Display,Window)->c_int,
    sync:"XSync":unsafe extern "C" fn(Display,c_int)->c_int,
    focus:"XSetInputFocus":unsafe extern "C" fn(Display,Window,c_int,c_ulong)->c_int,
    get_focus:"XGetInputFocus":unsafe extern "C" fn(Display,*mut Window,*mut c_int)->c_int,
    keymap:"XQueryKeymap":unsafe extern "C" fn(Display,*mut c_char)->c_int,
    pointer:"XQueryPointer":unsafe extern "C" fn(Display,Window,*mut Window,*mut Window,*mut c_int,*mut c_int,*mut c_int,*mut c_int,*mut c_uint)->c_int,
    keysym:"XKeysymToKeycode":unsafe extern "C" fn(Display,c_ulong)->u8,
    get_image:"XGetImage":unsafe extern "C" fn(Display,Window,c_int,c_int,c_uint,c_uint,c_ulong,c_int)->*mut c_void,
    pixel:"XGetPixel":unsafe extern "C" fn(*mut c_void,c_int,c_int)->c_ulong,
    free_image:"XDestroyImage":unsafe extern "C" fn(*mut c_void)->c_int,
    pending:"XPending":unsafe extern "C" fn(Display)->c_int,
    next:"XNextEvent":unsafe extern "C" fn(Display,*mut i64)->c_int,
    gc:"XDefaultGC":unsafe extern "C" fn(Display,c_int)->*mut c_void,
    foreground:"XSetForeground":unsafe extern "C" fn(Display,*mut c_void,c_ulong)->c_int,
    fill:"XFillRectangle":unsafe extern "C" fn(Display,Window,*mut c_void,c_int,c_int,c_uint,c_uint)->c_int,
    translate:"XTranslateCoordinates":unsafe extern "C" fn(Display,Window,Window,c_int,c_int,*mut c_int,*mut c_int,*mut Window)->c_int,
    attributes:"XGetWindowAttributes":unsafe extern "C" fn(Display,Window,*mut Attributes)->c_int,
    change:"XChangeWindowAttributes":unsafe extern "C" fn(Display,Window,c_ulong,*mut SetAttributes)->c_int,
    init:"XInitThreads":unsafe extern "C" fn()->c_int,
    raise:"XRaiseWindow":unsafe extern "C" fn(Display,Window)->c_int,
}
type FakeKey = unsafe extern "C" fn(Display, c_uint, c_int, c_ulong) -> c_int;
type FakeMove = unsafe extern "C" fn(Display, c_int, c_int, c_int, c_ulong) -> c_int;
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}
#[derive(Default)]
pub struct InputCounts {
    pub mouse_down: u32,
    pub mouse_up: u32,
    pub key_down: u32,
    pub key_up: u32,
}
pub(crate) struct Surface {
    x: Functions,
    _xtst: Library,
    display: Display,
    window: Window,
    root: Window,
    screen: c_int,
    key: u8,
    button: FakeKey,
    key_event: FakeKey,
    motion: FakeMove,
    held_key: bool,
    held_button: bool,
    original_pointer: Option<(i32, i32)>,
    _slot: Slot,
    session: String,
}
impl Surface {
    pub(crate) fn open(alive: &AtomicBool) -> Result<Self, &'static str> {
        // Un solo hilo/cliente Xlib en este ejecutable; no compartir esta capa
        // con GTK/Electron ni permitir dos instancias nativas simultáneas.
        let slot = Slot::acquire()?;
        let session = context()?;
        if !alive.load(Ordering::Acquire) {
            return Err("worker_stopped");
        }
        let marker = PathBuf::from("/run/absorconnect-owned-vm-lab");
        let meta = fs::symlink_metadata(&marker).map_err(|_| "owned_vm_marker_required")?;
        // SAFETY: geteuid no recibe punteros ni cambia la identidad.
        let uid = unsafe { geteuid() };
        if uid == 0
            || !meta.is_file()
            || meta.uid() != 0
            || meta.mode() & 0o022 != 0
            || fs::read(&marker).map_err(|_| "marker_read_failed")?
                != b"absorconnect-native-window-fixture-v1\n"
        {
            return Err("owned_vm_marker_required");
        }
        if std::env::var("DISPLAY").ok().as_deref() != Some(":0") {
            return Err("local_display_required");
        }
        let authority =
            PathBuf::from(std::env::var_os("XAUTHORITY").ok_or("private_authority_required")?);
        let meta = fs::symlink_metadata(authority).map_err(|_| "private_authority_required")?;
        if !meta.is_file() || meta.uid() != uid || meta.mode() & 0o077 != 0 {
            return Err("private_authority_required");
        }
        #[cfg(target_arch = "aarch64")]
        let (xname, tname) = (
            b"/lib/aarch64-linux-gnu/libX11.so.6\0".as_slice(),
            b"/lib/aarch64-linux-gnu/libXtst.so.6\0".as_slice(),
        );
        #[cfg(not(target_arch = "aarch64"))]
        let (xname, tname) = (
            b"/lib/x86_64-linux-gnu/libX11.so.6\0".as_slice(),
            b"/lib/x86_64-linux-gnu/libXtst.so.6\0".as_slice(),
        );
        let x = Functions::load(Library::open(xname)?)?;
        if !*INITIALIZED.get_or_init(|| unsafe { (x.init)() != 0 }) {
            return Err("x11_threads_unavailable");
        }
        let xtst = Library::open(tname)?;
        // SAFETY: firmas ABI XTest documentadas; solo símbolos fijados del SO.
        let button = unsafe {
            std::mem::transmute::<*mut c_void, FakeKey>(xtst.symbol(b"XTestFakeButtonEvent\0")?)
        };
        let key_event = unsafe {
            std::mem::transmute::<*mut c_void, FakeKey>(xtst.symbol(b"XTestFakeKeyEvent\0")?)
        };
        let motion = unsafe {
            std::mem::transmute::<*mut c_void, FakeMove>(xtst.symbol(b"XTestFakeMotionEvent\0")?)
        };
        // SAFETY: nombre local constante; conexión utilizada solo por este hilo.
        let display = unsafe { (x.open)(b":0\0".as_ptr().cast()) };
        if display.is_null() {
            return Err("x11_connection_failed");
        }
        let mut surface = Self {
            x,
            _xtst: xtst,
            display,
            window: 0,
            root: 0,
            screen: 0,
            key: 0,
            button,
            key_event,
            motion,
            held_key: false,
            held_button: false,
            original_pointer: None,
            _slot: slot,
            session,
        };
        // SAFETY: display válido, todos los recursos pertenecen a esta instancia.
        unsafe {
            surface.screen = (surface.x.screen)(display);
            if (surface.x.depth)(display, surface.screen) != 24 {
                return Err("truecolor24_required");
            }
            surface.root = (surface.x.root)(display, surface.screen);
            surface.key = (surface.x.keysym)(display, 0x61);
            if surface.key == 0 {
                return Err("fixed_key_unavailable");
            }
            surface.window =
                (surface.x.create)(display, surface.root, 40, 40, 320, 180, 0, 0, 0xff0000);
            if surface.window == 0 {
                return Err("fixture_window_failed");
            }
            (surface.x.select)(
                display,
                surface.window,
                (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 15),
            );
            // Ventana de ensayo propia sin decoraciones/agarres del gestor.
            // No se cambia ningún ajuste del escritorio ni otra ventana.
            let mut attributes: SetAttributes = std::mem::zeroed();
            attributes.override_redirect = 1;
            (surface.x.change)(display, surface.window, 1 << 9, &mut attributes);
            (surface.x.map)(display, surface.window);
            (surface.x.raise)(display, surface.window);
            (surface.x.sync)(display, 0);
        }
        // MapWindow puede quedar en la cola del gestor de ventanas después de
        // XSync. IsViewable comprueba también que todos los padres están mapeados.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            // SAFETY: estructura C solo con escalares/punteros, salida exclusiva.
            let mut attributes: Attributes = unsafe { std::mem::zeroed() };
            if unsafe { (surface.x.attributes)(display, surface.window, &mut attributes) } == 0 {
                return Err("own_window_unavailable");
            }
            if attributes.map_state == 2 {
                break;
            }
            if Instant::now() >= deadline {
                return Err("own_window_not_viewable");
            }
            thread::sleep(Duration::from_millis(10));
        }
        unsafe {
            (surface.x.focus)(display, surface.window, 2, 0);
            (surface.x.sync)(display, 0);
        }
        thread::sleep(Duration::from_millis(100));
        surface.paint(0xff0000);
        Ok(surface)
    }
    fn paint(&mut self, color: c_ulong) {
        unsafe {
            let gc = (self.x.gc)(self.display, self.screen);
            (self.x.foreground)(self.display, gc, color);
            (self.x.fill)(self.display, self.window, gc, 0, 0, 320, 180);
            (self.x.sync)(self.display, 0);
        }
    }
    pub(crate) fn capture(&mut self, alive: &AtomicBool) -> Result<Frame, &'static str> {
        if context()? != self.session {
            return Err("session_changed");
        }
        if !alive.load(Ordering::Acquire) {
            return Err("worker_stopped");
        }
        // SAFETY: región acotada de nuestra ventana; no se captura el root window.
        let image = unsafe {
            (self.x.get_image)(self.display, self.window, 0, 0, 320, 180, c_ulong::MAX, 2)
        };
        if image.is_null() {
            return Err("capture_failed");
        }
        let mut rgb = Vec::with_capacity(320 * 180 * 3);
        for y in 0..180 {
            for x in 0..320 {
                let pixel = unsafe { (self.x.pixel)(image, x, y) };
                rgb.extend_from_slice(&[(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8]);
            }
        }
        unsafe {
            (self.x.free_image)(image);
        }
        Ok(Frame {
            width: 320,
            height: 180,
            rgb,
        })
    }
    pub(crate) fn pulse(&mut self, alive: &AtomicBool) -> Result<InputCounts, &'static str> {
        if context()? != self.session {
            return Err("session_changed");
        }
        if !alive.load(Ordering::Acquire) {
            return Err("worker_stopped");
        }
        let mut counts = InputCounts::default();
        let mut event_types = Vec::new();
        // SAFETY: salidas inicializadas con tamaños de Xlib de Linux de 64 bits.
        unsafe {
            let mut focus = 0;
            let mut revert = 0;
            (self.x.get_focus)(self.display, &mut focus, &mut revert);
            let mut keys = [0_u8; 32];
            (self.x.keymap)(self.display, keys.as_mut_ptr().cast());
            let (mut root, mut child, mut x, mut y, mut rx, mut ry, mut mask) =
                (0, 0, 0, 0, 0, 0, 0);
            if (self.x.pointer)(
                self.display,
                self.root,
                &mut root,
                &mut child,
                &mut x,
                &mut y,
                &mut rx,
                &mut ry,
                &mut mask,
            ) == 0
                || focus != self.window
                || keys.iter().any(|v| *v != 0)
                || mask & 0x1ffd != 0
            {
                return Err("own_focus_and_free_input_required");
            }
            let (mut tx, mut ty, mut sub) = (0, 0, 0);
            if (self.x.translate)(
                self.display,
                self.window,
                self.root,
                160,
                90,
                &mut tx,
                &mut ty,
                &mut sub,
            ) == 0
            {
                return Err("own_coordinates_failed");
            }
            self.original_pointer = Some((x, y));
            (self.motion)(self.display, self.screen, tx, ty, 0);
            (self.x.sync)(self.display, 0);
            thread::sleep(Duration::from_millis(40));
            let (mut observed_x, mut observed_y) = (0, 0);
            if (self.x.pointer)(
                self.display,
                self.root,
                &mut root,
                &mut child,
                &mut observed_x,
                &mut observed_y,
                &mut rx,
                &mut ry,
                &mut mask,
            ) == 0
                || (observed_x, observed_y) != (tx, ty)
                || child != self.window
            {
                return Err("own_pointer_target_required");
            }
            if (self.button)(self.display, 1, 1, 0) == 0 {
                return Err("button_failed");
            }
            self.held_button = true;
            (self.x.sync)(self.display, 0);
            thread::sleep(Duration::from_millis(20));
            if (self.button)(self.display, 1, 0, 0) == 0 {
                return Err("button_release_failed");
            }
            self.held_button = false;
            (self.x.sync)(self.display, 0);
            thread::sleep(Duration::from_millis(60));
            (self.x.get_focus)(self.display, &mut focus, &mut revert);
            if focus != self.window {
                return Err("focus_changed_during_pulse");
            }
            if !alive.load(Ordering::Acquire) {
                return Err("worker_stopped");
            }
            if (self.key_event)(self.display, self.key.into(), 1, 0) == 0 {
                return Err("key_failed");
            }
            self.held_key = true;
            (self.x.sync)(self.display, 0);
            thread::sleep(Duration::from_millis(20));
            if (self.key_event)(self.display, self.key.into(), 0, 0) == 0 {
                return Err("key_release_failed");
            }
            self.held_key = false;
            (self.x.sync)(self.display, 0);
            let deadline = Instant::now() + Duration::from_millis(400);
            while Instant::now() < deadline {
                while (self.x.pending)(self.display) > 0 {
                    let mut event = [0_i64; 24];
                    (self.x.next)(self.display, event.as_mut_ptr());
                    if event_types.len() < 32 {
                        event_types.push(event[0] as i32);
                    }
                    // Solo tipo de evento, nunca texto/valores de una contraseña.
                    match event[0] as i32 {
                        2 => counts.key_down += 1,
                        3 => counts.key_up += 1,
                        4 => counts.mouse_down += 1,
                        5 => counts.mouse_up += 1,
                        _ => (),
                    }
                }
                if counts.key_up > 0 && counts.mouse_up > 0 {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            (self.motion)(self.display, self.screen, x, y, 0);
            (self.x.sync)(self.display, 0);
            self.original_pointer = None;
        }
        if (
            counts.mouse_down,
            counts.mouse_up,
            counts.key_down,
            counts.key_up,
        ) != (1, 1, 1, 1)
        {
            eprintln!(
                "native_input_counts mouse_down={} mouse_up={} key_down={} key_up={}",
                counts.mouse_down, counts.mouse_up, counts.key_down, counts.key_up
            );
            eprintln!("native_input_event_types={event_types:?}");
            return Err("own_input_not_observed");
        }
        self.paint(0x00ff00);
        Ok(counts)
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            if self.held_key {
                (self.key_event)(self.display, self.key.into(), 0, 0);
            }
            if self.held_button {
                (self.button)(self.display, 1, 0, 0);
            }
            if let Some((x, y)) = self.original_pointer {
                (self.motion)(self.display, self.screen, x, y, 0);
            }
            if self.window != 0 {
                (self.x.destroy)(self.display, self.window);
            }
            if !self.display.is_null() {
                (self.x.close)(self.display);
                self.display = ptr::null_mut();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Slot;
    #[test]
    fn a_second_native_surface_is_denied_until_the_first_releases_ownership() {
        let first = Slot::acquire().unwrap();
        assert!(Slot::acquire().is_err());
        drop(first);
        let _next = Slot::acquire().unwrap();
    }
}
