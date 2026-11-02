//! Almacén Windows del broker: DPAPI del usuario SYSTEM y archivos con DACL cerrada.
//! No instala servicios, no crea identidades y nunca repara un contador ilegible.
use crate::secrets::SecretBundle;
use absor_agent_auth::{AttemptState, AttemptStore, AuthError};
use std::{
    ffi::c_void,
    fs::{self, File},
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::io::{AsRawHandle, FromRawHandle},
    path::{Component, Path, PathBuf, Prefix},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, Cryptography::*, *},
    Storage::FileSystem::*,
    System::Threading::*,
};

const MAX_PLAIN: usize = 8192;
const MAX_SEALED: usize = 16384;
const FILE_SDDL: &str = "O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)";
const DIR_SDDL: &str = "O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
const PENDING: &str = "pending.dpapi";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    Identity,
    Metadata,
    Io,
    Crypto,
    Schema,
    Incomplete,
    Revoked,
}
type Result<T> = std::result::Result<T, VaultError>;

struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}
struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        // Evita eliminar esta limpieza al optimizar; no cubre copias de bibliotecas externas.
        for byte in &mut self.0 {
            unsafe { std::ptr::write_volatile(byte, 0) };
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}
fn wide(path: &Path) -> Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut s: Vec<_> = path.as_os_str().encode_wide().collect();
    if s.contains(&0) || s.len() > 240 {
        return Err(VaultError::Metadata);
    }
    s.push(0);
    Ok(s)
}
fn sid(kind: WELL_KNOWN_SID_TYPE) -> Result<Vec<u64>> {
    let mut data = vec![0_u64; 16];
    let mut len = (data.len() * 8) as u32;
    if unsafe { CreateWellKnownSid(kind, null_mut(), data.as_mut_ptr().cast(), &mut len) } == 0 {
        return Err(VaultError::Identity);
    }
    Ok(data)
}
pub fn require_system() -> Result<()> {
    let mut raw = 0;
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
        return Err(VaultError::Identity);
    }
    // El handle del token no es un archivo; cierre explícito también ante error.
    let result = (|| {
        let mut data = [0_u64; 128];
        let mut len = 0;
        if unsafe { GetTokenInformation(raw, TokenUser, data.as_mut_ptr().cast(), 1024, &mut len) }
            == 0
        {
            return Err(VaultError::Identity);
        }
        let user = unsafe { &*data.as_ptr().cast::<TOKEN_USER>() };
        let sy = sid(WinLocalSystemSid)?;
        if unsafe { EqualSid(user.User.Sid, sy.as_ptr() as *mut c_void) } == 0 {
            return Err(VaultError::Identity);
        }
        // Un hilo con impersonación no puede usar el perfil DPAPI de otro usuario.
        let mut thread_token = 0;
        if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut thread_token) } != 0 {
            unsafe { CloseHandle(thread_token) };
            return Err(VaultError::Identity);
        }
        if unsafe { GetLastError() } != ERROR_NO_TOKEN {
            return Err(VaultError::Identity);
        }
        Ok(())
    })();
    unsafe { CloseHandle(raw) };
    result
}

fn descriptor(directory: bool) -> Result<Local> {
    let s: Vec<_> = if directory { DIR_SDDL } else { FILE_SDDL }
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut raw = null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(s.as_ptr(), 1, &mut raw, null_mut())
    } == 0
    {
        return Err(VaultError::Metadata);
    }
    Ok(Local(raw))
}
fn open_file(path: &Path, access: u32, share: u32, creation: u32, dir: bool) -> Result<File> {
    let sd = descriptor(dir)?;
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: 0,
    };
    let raw = unsafe {
        CreateFileW(
            wide(path)?.as_ptr(),
            access,
            share,
            &sa,
            creation,
            FILE_FLAG_OPEN_REPARSE_POINT | if dir { FILE_FLAG_BACKUP_SEMANTICS } else { 0 },
            0,
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(VaultError::Io);
    }
    Ok(unsafe { File::from_raw_handle(raw as *mut c_void) })
}
fn metadata(file: &File, directory: bool, limit: usize) -> Result<()> {
    let h = file.as_raw_handle() as HANDLE;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
    if unsafe { GetFileType(h) } != FILE_TYPE_DISK
        || unsafe { GetFileInformationByHandle(h, &mut info) } == 0
        || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        || (!directory
            && (info.nNumberOfLinks != 1
                || info.nFileSizeHigh != 0
                || info.nFileSizeLow as usize > limit))
    {
        return Err(VaultError::Metadata);
    }
    Ok(())
}
fn protected(file: &File, directory: bool, limit: usize) -> Result<()> {
    metadata(file, directory, limit)?;
    let mut owner = null_mut();
    let mut acl = null_mut();
    let mut raw = null_mut();
    if unsafe {
        GetSecurityInfo(
            file.as_raw_handle() as HANDLE,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut acl,
            null_mut(),
            &mut raw,
        )
    } != 0
    {
        return Err(VaultError::Metadata);
    }
    let sd = Local(raw);
    let mut control = 0;
    let mut revision = 0;
    let sy = sid(WinLocalSystemSid)?;
    let ba = sid(WinBuiltinAdministratorsSid)?;
    if owner.is_null()
        || unsafe { EqualSid(owner, sy.as_ptr() as *mut c_void) } == 0
        || acl.is_null()
        || unsafe { GetSecurityDescriptorControl(sd.0, &mut control, &mut revision) } == 0
        || control & SE_DACL_PROTECTED == 0
        || unsafe { (*acl).AceCount } != 2
    {
        return Err(VaultError::Metadata);
    }
    let mut seen = 0_u8;
    for i in 0..2 {
        let mut p = null_mut();
        if unsafe { GetAce(acl, i, &mut p) } == 0 || p.is_null() {
            return Err(VaultError::Metadata);
        }
        let ace = unsafe { &*p.cast::<ACCESS_ALLOWED_ACE>() };
        let flags = if directory {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            0
        };
        if ace.Header.AceType != 0
            || usize::from(ace.Header.AceSize) < size_of::<ACCESS_ALLOWED_ACE>()
            || ace.Header.AceFlags != flags as u8
            || ace.Mask != FILE_ALL_ACCESS
        {
            return Err(VaultError::Metadata);
        }
        let s = std::ptr::addr_of!(ace.SidStart) as *mut c_void;
        let bit = if unsafe { EqualSid(s, sy.as_ptr() as *mut c_void) } != 0 {
            1
        } else if unsafe { EqualSid(s, ba.as_ptr() as *mut c_void) } != 0 {
            2
        } else {
            return Err(VaultError::Metadata);
        };
        if seen & bit != 0 {
            return Err(VaultError::Metadata);
        }
        seen |= bit;
    }
    Ok(())
}

/// Mantiene cada directorio abierto sin compartir DELETE, también los ancestros.
fn pin(path: &Path) -> Result<Vec<File>> {
    let mut chain = PathBuf::new();
    let mut handles = Vec::new();
    for (i, c) in path.components().enumerate() {
        match c {
            Component::Prefix(p) if i == 0 && matches!(p.kind(), Prefix::Disk(_)) => {
                chain.push(p.as_os_str());
                continue;
            }
            Component::RootDir if i == 1 => chain.push(c.as_os_str()),
            Component::Normal(name) if i > 1 => {
                let text = name.to_str().ok_or(VaultError::Metadata)?;
                if text.is_empty()
                    || !text
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                {
                    return Err(VaultError::Metadata);
                }
                chain.push(name);
            }
            _ => return Err(VaultError::Metadata),
        }
        let h = open_file(
            &chain,
            FILE_READ_ATTRIBUTES | READ_CONTROL,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            OPEN_EXISTING,
            true,
        )?;
        metadata(&h, true, 0)?;
        handles.push(h);
    }
    let root = handles.last().ok_or(VaultError::Metadata)?;
    protected(root, true, 0)?;
    Ok(handles)
}
fn absent(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(_) => Err(VaultError::Io),
        Ok(_) => Ok(false),
    }
}
fn crypt(raw: &[u8], entropy: &[u8], encrypt: bool) -> Result<Secret> {
    require_system()?;
    if raw.is_empty() || raw.len() > if encrypt { MAX_PLAIN } else { MAX_SEALED } {
        return Err(VaultError::Crypto);
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: raw.len() as u32,
        pbData: raw.as_ptr() as *mut u8,
    };
    let extra = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { zeroed() };
    // Sin LOCAL_MACHINE: el perfil es SYSTEM. UI_FORBIDDEN evita avisos antes de login.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                null(),
                &extra,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                null_mut(),
                &extra,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(VaultError::Crypto);
    }
    let _allocation = Local(output.pbData.cast());
    if output.pbData.is_null() || output.cbData == 0 || output.cbData as usize > MAX_SEALED {
        return Err(VaultError::Crypto);
    }
    let data = unsafe { std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize) };
    let result = Secret(data.to_vec());
    for byte in data {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    Ok(result)
}

/// Un único actor conserva el lock exclusivo durante toda la vida del verificador.
pub struct WindowsVault {
    root: PathBuf,
    host: String,
    _lock: File,
    directories: Vec<File>,
}
impl WindowsVault {
    fn acquire(root: &Path, host: &str) -> Result<Self> {
        require_system()?;
        if host.len() != 36
            || !host.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                }
            })
        {
            return Err(VaultError::Schema);
        }
        let directories = pin(root)?;
        let lock = open_file(
            &root.join("broker.lock"),
            GENERIC_READ | GENERIC_WRITE,
            0,
            OPEN_ALWAYS,
            false,
        )?;
        protected(&lock, false, 0)?;
        if !absent(&root.join(PENDING))? {
            return Err(VaultError::Incomplete);
        }
        Ok(Self {
            root: root.to_owned(),
            host: host.to_owned(),
            _lock: lock,
            directories,
        })
    }
    /// Alta explícita y exclusiva. Una instalación parcial jamás cuenta como alta nueva.
    pub fn provision(
        root: &Path,
        host: &str,
        bundle: &[u8],
        attempts: &AttemptState,
    ) -> Result<Self> {
        let mut this = Self::acquire(root, host)?;
        let parsed = SecretBundle::parse(bundle).map_err(|_| VaultError::Schema)?;
        if parsed.host_id() != host {
            return Err(VaultError::Schema);
        }
        attempts.validate().map_err(|_| VaultError::Schema)?;
        for name in ["credentials", "attempts", "ready", "revoked"] {
            if !absent(&this.slot(name))? {
                return Err(VaultError::Incomplete);
            }
        }
        this.write("credentials", bundle, false)?;
        let raw = Secret(serde_json::to_vec(attempts).map_err(|_| VaultError::Schema)?);
        this.write("attempts", &raw.0, false)?;
        this.write("ready", b"ready-v1", false)?;
        Ok(this)
    }
    pub fn open(root: &Path, host: &str) -> Result<Self> {
        let this = Self::acquire(root, host)?;
        this.active()?;
        this.bundle()?;
        this.attempts()?;
        Ok(this)
    }
    fn slot(&self, kind: &str) -> PathBuf {
        self.root.join(format!("{kind}.dpapi"))
    }
    fn entropy(&self, kind: &str) -> Vec<u8> {
        format!("absorconnect-agent-windows-vault-v1\n{}\n{kind}", self.host).into_bytes()
    }
    fn check(&self) -> Result<()> {
        require_system()?;
        protected(
            self.directories.last().ok_or(VaultError::Metadata)?,
            true,
            0,
        )?;
        if !absent(&self.root.join(PENDING))? {
            return Err(VaultError::Incomplete);
        }
        Ok(())
    }
    fn read(&self, kind: &str) -> Result<Secret> {
        self.check()?;
        let mut file = open_file(
            &self.slot(kind),
            GENERIC_READ,
            FILE_SHARE_READ,
            OPEN_EXISTING,
            false,
        )?;
        protected(&file, false, MAX_SEALED)?;
        let mut data = Vec::new();
        (&mut file)
            .take((MAX_SEALED + 1) as u64)
            .read_to_end(&mut data)
            .map_err(|_| VaultError::Io)?;
        protected(&file, false, MAX_SEALED)?;
        crypt(&data, &self.entropy(kind), false)
    }
    fn write(&mut self, kind: &str, raw: &[u8], replace: bool) -> Result<()> {
        self.check()?;
        if replace {
            self.read(kind)?;
        } else if !absent(&self.slot(kind))? {
            return Err(VaultError::Incomplete);
        }
        let sealed = crypt(raw, &self.entropy(kind), true)?;
        let pending = self.root.join(PENDING);
        let mut f = open_file(&pending, GENERIC_READ | GENERIC_WRITE, 0, CREATE_NEW, false)?;
        protected(&f, false, MAX_SEALED)?;
        f.write_all(&sealed.0)
            .and_then(|_| f.sync_all())
            .map_err(|_| VaultError::Io)?;
        protected(&f, false, MAX_SEALED)?;
        drop(f);
        // Ante fallo queda pending: no borrar el indicio ni volver al estado anterior.
        let flags = MOVEFILE_WRITE_THROUGH
            | if replace {
                MOVEFILE_REPLACE_EXISTING
            } else {
                0
            };
        if unsafe {
            MoveFileExW(
                wide(&pending)?.as_ptr(),
                wide(&self.slot(kind))?.as_ptr(),
                flags,
            )
        } == 0
        {
            return Err(VaultError::Io);
        }
        Ok(())
    }
    fn active(&self) -> Result<()> {
        if self.read("ready")?.0 != b"ready-v1" {
            return Err(VaultError::Schema);
        }
        if !absent(&self.slot("revoked"))? {
            if self.read("revoked")?.0 != b"revoked-v1" {
                return Err(VaultError::Schema);
            }
            return Err(VaultError::Revoked);
        }
        Ok(())
    }
    pub fn bundle(&self) -> Result<SecretBundle> {
        self.active()?;
        let raw = self.read("credentials")?;
        let bundle = SecretBundle::parse(&raw.0).map_err(|_| VaultError::Schema)?;
        if bundle.host_id() != self.host {
            return Err(VaultError::Schema);
        }
        Ok(bundle)
    }
    fn attempts(&self) -> Result<AttemptState> {
        self.active()?;
        let state: AttemptState =
            serde_json::from_slice(&self.read("attempts")?.0).map_err(|_| VaultError::Schema)?;
        state.validate().map_err(|_| VaultError::Schema)?;
        Ok(state)
    }
    /// Marcador separado: restaurar el contador anterior no retira una revocación.
    pub fn revoke(&mut self) -> Result<()> {
        if !absent(&self.slot("revoked"))? {
            return if self.read("revoked")?.0 == b"revoked-v1" {
                Ok(())
            } else {
                Err(VaultError::Schema)
            };
        }
        self.write("revoked", b"revoked-v1", false)
    }
}
impl AttemptStore for WindowsVault {
    fn load(&mut self) -> std::result::Result<AttemptState, AuthError> {
        self.attempts().map_err(|_| AuthError::Storage)
    }
    fn commit(&mut self, state: &AttemptState) -> std::result::Result<(), AuthError> {
        let save = || -> Result<Secret> {
            self.active()?;
            state.validate().map_err(|_| VaultError::Schema)?;
            Ok(Secret(
                serde_json::to_vec(state).map_err(|_| VaultError::Schema)?,
            ))
        };
        let raw = save().map_err(|_| AuthError::Storage)?;
        self.write("attempts", &raw.0, true)
            .map_err(|_| AuthError::Storage)
    }
}

/// Exclusivamente para el instalador: destino nuevo con SDDL explícita desde su creación.
pub fn create_directory(parent: &Path, name: &str) -> Result<PathBuf> {
    require_system()?;
    let _pins = pin(parent)?;
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(VaultError::Metadata);
    }
    let path = parent.join(name);
    let sd = descriptor(true)?;
    let sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: 0,
    };
    if unsafe { CreateDirectoryW(wide(&path)?.as_ptr(), &sa) } == 0 {
        return Err(VaultError::Io);
    }
    pin(&path)?;
    Ok(path)
}
