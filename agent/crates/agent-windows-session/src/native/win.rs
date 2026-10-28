use std::{
    ffi::c_void,
    fs,
    io::Write,
    mem::{size_of, zeroed},
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{RemoteDesktop::ProcessIdToSessionId, Services::*, Threading::*},
};
pub const SERVICE: &str = "AbsorConnectSessionLab";
pub const ROOT: &str = r"C:\ProgramData\AbsorConnectSessionLab";
pub const MARKER: &[u8] = b"ABSOR_CONNECT_OWN_WINDOWS_VM_LAB_V1\n";
#[derive(Debug)]
pub struct WinError(pub u32, pub u32);
pub type Result<T> = std::result::Result<T, WinError>;
pub fn error(stage: u32) -> WinError {
    WinError(stage, unsafe { GetLastError() })
}
pub fn ensure(ok: bool, stage: u32) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(error(stage))
    }
}
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
pub fn file(name: &str) -> PathBuf {
    Path::new(ROOT).join(name)
}
pub struct Handle(pub HANDLE);
impl Handle {
    pub fn new(h: HANDLE, stage: u32) -> Result<Self> {
        ensure(h != 0 && h != INVALID_HANDLE_VALUE, stage)?;
        Ok(Self(h))
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
pub struct Local(pub *mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
pub fn system_sid() -> Result<Vec<u64>> {
    sid(WinLocalSystemSid)
}
fn sid(kind: WELL_KNOWN_SID_TYPE) -> Result<Vec<u64>> {
    let mut v = vec![0_u64; 16];
    let mut n = (v.len() * 8) as u32;
    ensure(
        unsafe { CreateWellKnownSid(kind, null_mut(), v.as_mut_ptr().cast(), &mut n) } != 0,
        10,
    )?;
    Ok(v)
}
pub fn token(process: HANDLE, rights: u32) -> Result<Handle> {
    let mut h = 0;
    ensure(
        unsafe { OpenProcessToken(process, rights, &mut h) } != 0,
        11,
    )?;
    Handle::new(h, 12)
}
pub fn is_system(process: HANDLE) -> Result<()> {
    let t = token(process, TOKEN_QUERY)?;
    let mut data = [0_u64; 128];
    let mut n = 0;
    ensure(
        unsafe {
            GetTokenInformation(
                t.0,
                TokenUser,
                data.as_mut_ptr().cast(),
                (data.len() * 8) as u32,
                &mut n,
            )
        } != 0,
        13,
    )?;
    let user = unsafe { &*data.as_ptr().cast::<TOKEN_USER>() };
    let system = system_sid()?;
    ensure(
        unsafe { EqualSid(user.User.Sid, system.as_ptr() as *mut c_void) } != 0,
        14,
    )
}
pub fn current_system() -> Result<()> {
    is_system(unsafe { GetCurrentProcess() })
}
pub fn session(pid: u32) -> Result<u32> {
    let mut s = 0;
    ensure(unsafe { ProcessIdToSessionId(pid, &mut s) } != 0, 15)?;
    Ok(s)
}
pub fn process(pid: u32, rights: u32) -> Result<Handle> {
    Handle::new(unsafe { OpenProcess(rights, 0, pid) }, 16)
}
pub fn alive(h: HANDLE) -> bool {
    unsafe { WaitForSingleObject(h, 0) == WAIT_TIMEOUT }
}
pub fn terminate(h: HANDLE) {
    unsafe {
        TerminateProcess(h, 70);
        WaitForSingleObject(h, 1000);
    }
}
/// DACL cerrada y dueño SYSTEM. Solo SYSTEM/Administradores pueden tener ACE.
/// No acepta enlaces ni una DACL vacía/nula que dé acceso a otros usuarios.
pub fn protected(path: &Path, directory: bool) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(|_| error(17))?;
    ensure(
        m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
            && m.is_dir() == directory
            && (directory || m.is_file()),
        18,
    )?;
    let name = wide(path.to_str().ok_or(WinError(19, 0))?);
    let mut owner = null_mut();
    let mut acl = null_mut();
    let mut sd = null_mut();
    let rc = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut acl,
            null_mut(),
            &mut sd,
        )
    };
    ensure(rc == 0, 20)?;
    let _sd = Local(sd);
    let sy = system_sid()?;
    let ba = sid(WinBuiltinAdministratorsSid)?;
    ensure(
        !owner.is_null()
            && unsafe { EqualSid(owner, sy.as_ptr() as *mut c_void) } != 0
            && !acl.is_null(),
        21,
    )?;
    let count = unsafe { (*acl).AceCount };
    ensure((1..=4).contains(&count), 22)?;
    for i in 0..u32::from(count) {
        let mut p = null_mut();
        ensure(unsafe { GetAce(acl, i, &mut p) } != 0 && !p.is_null(), 23)?;
        let a = unsafe { &*p.cast::<ACCESS_ALLOWED_ACE>() };
        // ACCESS_ALLOWED_ACE_TYPE = 0 en el SDK; se rechazan objetos/denegaciones.
        ensure(
            a.Header.AceType == 0
                && usize::from(a.Header.AceSize) >= size_of::<ACCESS_ALLOWED_ACE>(),
            24,
        )?;
        let s = std::ptr::addr_of!(a.SidStart) as *mut c_void;
        ensure(
            unsafe {
                EqualSid(s, sy.as_ptr() as *mut c_void) != 0
                    || EqualSid(s, ba.as_ptr() as *mut c_void) != 0
            },
            25,
        )?;
    }
    Ok(())
}
pub fn validate_install(binary: &str) -> Result<()> {
    current_system()?;
    protected(Path::new(ROOT), true)?;
    protected(&file("lab-owner.txt"), false)?;
    ensure(
        fs::read(file("lab-owner.txt")).map_err(|_| error(26))? == MARKER,
        27,
    )?;
    let expected = file(binary);
    protected(&expected, false)?;
    ensure(
        std::env::current_exe().map_err(|_| error(28))? == expected,
        29,
    )
}
pub fn disabled() -> Result<bool> {
    match fs::symlink_metadata(file("stopped.txt")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(error(30)),
        Ok(_) => {
            protected(&file("stopped.txt"), false)?;
            ensure(
                fs::read(file("stopped.txt")).map_err(|_| error(31))? == b"stopped-v1\n",
                32,
            )?;
            Ok(true)
        }
    }
}
pub fn mark_stopped() -> Result<()> {
    if disabled()? {
        return Ok(());
    }
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .access_mode(GENERIC_WRITE | WRITE_OWNER)
        .open(file("stopped.txt"))
        .map_err(|_| error(33))?;
    own_new_file(&f)?;
    f.write_all(b"stopped-v1\n")
        .and_then(|_| f.sync_all())
        .map_err(|_| error(34))?;
    protected(&file("stopped.txt"), false)
}
pub fn resume() -> Result<()> {
    if disabled()? {
        fs::remove_file(file("stopped.txt")).map_err(|_| error(35))?;
    }
    Ok(())
}
pub fn report(name: &str, value: &impl serde::Serialize) -> Result<()> {
    let path = file(name);
    let temp = file(&format!("{name}.tmp"));
    // Un temporal ajeno/dañado bloquea el informe; nunca se sigue ni se borra a ciegas.
    if temp.exists() {
        protected(&temp, false)?;
        fs::remove_file(&temp).map_err(|_| error(36))?;
    }
    if path.exists() {
        protected(&path, false)?;
    }
    let data = serde_json::to_vec(value).map_err(|_| error(37))?;
    ensure(data.len() <= 2048, 38)?;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .access_mode(GENERIC_WRITE | WRITE_OWNER)
        .open(&temp)
        .map_err(|_| error(39))?;
    own_new_file(&f)?;
    f.write_all(&data)
        .and_then(|_| f.sync_all())
        .map_err(|_| error(40))?;
    drop(f);
    protected(&temp, false)?;
    let a = wide(temp.to_str().ok_or(WinError(41, 0))?);
    let b = wide(path.to_str().ok_or(WinError(42, 0))?);
    ensure(
        unsafe {
            MoveFileExW(
                a.as_ptr(),
                b.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } != 0,
        43,
    )
}
fn own_new_file(file: &fs::File) -> Result<()> {
    // Un token SYSTEM puede tener BA como dueño predeterminado. Se fija SY
    // explícitamente sobre el handle recién creado, antes de publicar datos.
    let sid = system_sid()?;
    ensure(
        unsafe {
            SetSecurityInfo(
                file.as_raw_handle() as HANDLE,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                sid.as_ptr() as *mut c_void,
                null_mut(),
                null(),
                null(),
            )
        } == 0,
        50,
    )
}
pub fn scm_state() -> Result<SERVICE_STATUS_PROCESS> {
    let manager = HandleService(unsafe { OpenSCManagerW(null(), null(), SC_MANAGER_CONNECT) });
    ensure(manager.0 != 0, 44)?;
    let service = HandleService(unsafe {
        OpenServiceW(manager.0, wide(SERVICE).as_ptr(), SERVICE_QUERY_STATUS)
    });
    ensure(service.0 != 0, 45)?;
    let mut value: SERVICE_STATUS_PROCESS = unsafe { zeroed() };
    let mut n = 0;
    ensure(
        unsafe {
            QueryServiceStatusEx(
                service.0,
                SC_STATUS_PROCESS_INFO,
                (&mut value as *mut SERVICE_STATUS_PROCESS).cast(),
                size_of::<SERVICE_STATUS_PROCESS>() as u32,
                &mut n,
            )
        } != 0,
        46,
    )?;
    Ok(value)
}
struct HandleService(SC_HANDLE);
impl Drop for HandleService {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                CloseServiceHandle(self.0);
            }
        }
    }
}
pub fn peer_parent(pid: u32, can_terminate: bool) -> Result<Handle> {
    let scm = scm_state()?;
    ensure(
        scm.dwCurrentState == SERVICE_RUNNING && scm.dwProcessId == pid && pid != 0,
        47,
    )?;
    let p = process(
        pid,
        PROCESS_QUERY_LIMITED_INFORMATION
            | SYNCHRONIZE
            | if can_terminate { PROCESS_TERMINATE } else { 0 },
    )?;
    is_system(p.0)?;
    ensure(session(pid)? == 0, 48)?;
    Ok(p)
}
pub fn drop_privileges() -> Result<()> {
    let t = token(
        unsafe { GetCurrentProcess() },
        TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
    )?;
    ensure(
        unsafe { AdjustTokenPrivileges(t.0, 1, null(), 0, null_mut(), null_mut()) } != 0,
        49,
    )
}
