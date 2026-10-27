//! Única frontera unsafe: buffers C válidos del adaptador compilado de laboratorio.
//! Los identificadores no son direcciones ni se aceptan desde WebRTC/IPC.
use super::dispatch::Bridge;
use absor_agent_supervisor::synthetic as supervision;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

static NEXT: AtomicU64 = AtomicU64::new(1);
static INSTANCES: OnceLock<Mutex<HashMap<u64, Bridge>>> = OnceLock::new();
fn instances() -> &'static Mutex<HashMap<u64, Bridge>> {
    INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// # Safety
/// ptr apunta a len bytes inicializados y legibles durante la llamada; ningún
/// otro hilo los modifica. El tamaño se comprueba antes de construir la vista.
unsafe fn input(ptr: *const u8, len: usize, max: usize) -> Option<Vec<u8>> {
    if ptr.is_null() || len == 0 || len > max {
        return None;
    }
    // SAFETY: contrato C documentado; copia propia antes de escribir salida.
    Some(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
}

/// # Safety
/// config debe satisfacer el contrato de input. Nunca pasar credenciales por argv.
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_create(config: *const u8, len: usize) -> u64 {
    supervision::start();
    std::panic::catch_unwind(|| {
        // SAFETY: precondición del llamador, límite interno de 4096 bytes.
        let Some(raw) = (unsafe { input(config, len, 4096) }) else {
            return 0;
        };
        let Ok(mut instances) = instances().lock() else {
            return 0;
        };
        if instances.len() >= 8 {
            return 0;
        }
        let Ok(bridge) = Bridge::new(&raw) else {
            return 0;
        };
        // La exclusión del registro serializa carga/incremento, compatible con Rust 1.75.
        let id = NEXT.load(Ordering::Relaxed);
        let Some(next) = id.checked_add(1) else {
            return 0;
        };
        NEXT.store(next, Ordering::Relaxed);
        instances.insert(id, bridge);
        id
    })
    .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn absor_bridge_poll(id: u64) -> i32 {
    supervision::before_poll();
    let result = std::panic::catch_unwind(|| {
        let Ok(mut instances) = instances().lock() else {
            return -3;
        };
        instances.get_mut(&id).map_or(-3, Bridge::poll)
    })
    .unwrap_or(-3);
    supervision::pulse(result);
    result
}

/// # Safety
/// out es exclusivo y válido por cap bytes; no se conserva tras la llamada.
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_offer(id: u64, out: *mut u8, cap: usize) -> i32 {
    if out.is_null() || cap != 262_144 {
        return -3;
    }
    let Ok(mut instances) = instances().lock() else {
        return -3;
    };
    let Some(bridge) = instances.get_mut(&id) else {
        return -3;
    };
    match bridge.offer() {
        Ok(Some(bytes)) if bytes.len() <= cap => {
            // SAFETY: salida exclusiva del llamador, longitud comprobada.
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
            }
            bytes.len() as i32
        }
        Ok(None) => 0,
        _ => -3,
    }
}

/// # Safety
/// answer es legible por len bytes durante la llamada; copia propia acotada.
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_answer(id: u64, answer: *const u8, len: usize) -> i32 {
    // SAFETY: contrato C, límite de SDP de 64 KiB antes de construir la vista.
    let Some(bytes) = (unsafe { input(answer, len, 65_536) }) else {
        return -3;
    };
    let Ok(answer) = String::from_utf8(bytes) else {
        return -3;
    };
    let Ok(mut instances) = instances().lock() else {
        return -3;
    };
    let Some(bridge) = instances.get_mut(&id) else {
        return -3;
    };
    if bridge.answer(answer).is_ok() {
        1
    } else {
        -3
    }
}

/// # Safety
/// offer/answer son buffers legibles y out tiene cap bytes escribibles exclusivos.
/// No retener punteros ni reutilizar el identificador para otra PeerConnection.
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_hello(
    id: u64,
    offer: *const u8,
    offer_len: usize,
    answer: *const u8,
    answer_len: usize,
    out: *mut u8,
    cap: usize,
) -> i32 {
    std::panic::catch_unwind(|| {
        if out.is_null() || !(1024..=4096).contains(&cap) {
            return -3;
        }
        // SAFETY: contrato del llamador, copias independientes acotadas.
        let (Some(offer), Some(answer)) = (unsafe { input(offer, offer_len, 104) }, unsafe {
            input(answer, answer_len, 104)
        }) else {
            return -3;
        };
        let (Ok(offer), Ok(answer)) = (String::from_utf8(offer), String::from_utf8(answer)) else {
            return -3;
        };
        let Ok(mut instances) = instances().lock() else {
            return -3;
        };
        let Some(bridge) = instances.get_mut(&id) else {
            return -3;
        };
        let bytes = match bridge.hello(offer, answer) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => return 0,
            Err(_) => return -3,
        };
        if bytes.len() > cap {
            return -3;
        }
        // SAFETY: salida exclusiva válida por cap; bytes es asignación distinta.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
        bytes.len() as i32
    })
    .unwrap_or(-3)
}

/// # Safety
/// proof satisface el contrato de input; datos de hasta 512 bytes, sin retenerlos.
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_auth(id: u64, proof: *const u8, len: usize) -> i32 {
    std::panic::catch_unwind(|| {
        // SAFETY: contrato del llamador; la prueba se copia antes de consultar estado.
        let Some(raw) = (unsafe { input(proof, len, 512) }) else {
            return -3;
        };
        let Ok(mut instances) = instances().lock() else {
            return -3;
        };
        instances.get_mut(&id).map_or(-3, |v| v.authenticate(&raw))
    })
    .unwrap_or(-3)
}

#[no_mangle]
pub extern "C" fn absor_bridge_close(id: u64) {
    let _ = std::panic::catch_unwind(|| {
        if let Ok(mut instances) = instances().lock() {
            instances.remove(&id);
        }
    });
}

/// # Safety
/// out es un buffer exclusivo de EXACTAMENTE 172800 bytes, sin retener punteros.
#[cfg(feature = "native-fixture")]
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_native_frame(id: u64, out: *mut u8, cap: usize) -> i32 {
    if out.is_null() || cap != 172_800 {
        return -3;
    }
    let Ok(mut instances) = instances().lock() else {
        return -3;
    };
    let Some(bridge) = instances.get_mut(&id) else {
        return -3;
    };
    match bridge.native_frame() {
        Ok(Some(bytes)) if bytes.len() == cap => {
            // SAFETY: salida exclusiva; frame de tamaño fijo y asignación distinta.
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, cap);
            }
            cap as i32
        }
        Ok(None) => 0,
        _ => -3,
    }
}

/// # Safety
/// ptr es legible por len bytes durante la llamada, sin modificación concurrente.
#[cfg(feature = "native-fixture")]
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_native_input(id: u64, ptr: *const u8, len: usize) -> i32 {
    // SAFETY: contrato C, copia acotada a 128 bytes antes de parsear.
    let Some(raw) = (unsafe { input(ptr, len, 128) }) else {
        return -3;
    };
    let Ok(mut instances) = instances().lock() else {
        return -3;
    };
    let Some(bridge) = instances.get_mut(&id) else {
        return -3;
    };
    if bridge.native_input(&raw).is_ok() {
        1
    } else {
        -3
    }
}

/// # Safety
/// out es exclusivo y válido por EXACTAMENTE 1024 bytes durante la llamada.
#[cfg(feature = "native-fixture")]
#[no_mangle]
pub unsafe extern "C" fn absor_bridge_native_status(id: u64, out: *mut u8, cap: usize) -> i32 {
    if out.is_null() || cap != 1024 {
        return -3;
    }
    let Ok(instances) = instances().lock() else {
        return -3;
    };
    let Some(bridge) = instances.get(&id) else {
        return -3;
    };
    let bytes = bridge.native_status();
    if bytes.is_empty() || bytes.len() > cap {
        return -3;
    }
    // SAFETY: salida exclusiva de tamaño comprobado, asignación distinta.
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
    }
    bytes.len() as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn valid_instance_is_closed_once_and_identifiers_are_never_reused() {
        use absor_agent_auth::AttemptState;
        use std::fs;
        use std::path::PathBuf;
        use std::time::{SystemTime, UNIX_EPOCH};
        struct Scratch(PathBuf);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("absor-bridge-{}-{unique}", std::process::id()));
        fs::create_dir(&path).unwrap();
        let scratch = Scratch(path);
        let state = scratch.0.join("rust-agent-state");
        fs::create_dir(&state).unwrap();
        fs::write(state.join("absor-webrtc-lab"), b"synthetic-only").unwrap();
        fs::write(
            state.join("attempts.json"),
            serde_json::to_vec(&AttemptState::provisioned()).unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&scratch.0, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(
                state.join("attempts.json"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }
        let mut config = serde_json::json!({"origin":"http://127.0.0.1:9", "credential":format!("acg_{}", "a".repeat(43)), "stateDirectory":state});
        let raw = serde_json::to_vec(&config).unwrap();
        config["nativeFixture"] = serde_json::json!(true);
        let native_without_api = serde_json::to_vec(&config).unwrap();
        assert_eq!(
            unsafe { absor_bridge_create(native_without_api.as_ptr(), native_without_api.len()) },
            0
        );
        config.as_object_mut().unwrap().remove("nativeFixture");
        // SAFETY: buffers vivos y válidos de longitud exacta. No se llama poll
        // hasta cerrar, por lo que esta prueba no envía ninguna petición de red.
        let first = unsafe { absor_bridge_create(raw.as_ptr(), raw.len()) };
        assert_ne!(first, 0);
        absor_bridge_close(first);
        absor_bridge_close(first);
        assert_eq!(absor_bridge_poll(first), -3);
        let second = unsafe { absor_bridge_create(raw.as_ptr(), raw.len()) };
        assert!(second > first);
        absor_bridge_close(second);
        config["origin"] = serde_json::json!("https://example.invalid");
        let raw = serde_json::to_vec(&config).unwrap();
        assert_eq!(unsafe { absor_bridge_create(raw.as_ptr(), raw.len()) }, 0);
        fs::write(state.join("attempts.json"), b"{}").unwrap();
        assert_eq!(unsafe { absor_bridge_create(raw.as_ptr(), raw.len()) }, 0);
        assert_eq!(fs::read(state.join("attempts.json")).unwrap(), b"{}");
    }

    #[test]
    fn null_oversize_unknown_and_closed_handles_are_rejected() {
        // SAFETY: punteros nulos se rechazan antes de construir vistas.
        unsafe {
            #[cfg(feature = "native-fixture")]
            {
                assert_eq!(
                    absor_bridge_native_frame(u64::MAX, std::ptr::null_mut(), 172_800),
                    -3
                );
                assert_eq!(
                    absor_bridge_native_frame(u64::MAX, std::ptr::null_mut(), 172_801),
                    -3
                );
                assert_eq!(absor_bridge_native_input(u64::MAX, std::ptr::null(), 1), -3);
                assert_eq!(absor_bridge_native_input(u64::MAX, b"x".as_ptr(), 129), -3);
                assert_eq!(
                    absor_bridge_native_status(u64::MAX, std::ptr::null_mut(), 1024),
                    -3
                );
                let mut rgb = vec![0_u8; 172_800];
                assert_eq!(
                    absor_bridge_native_frame(u64::MAX, rgb.as_mut_ptr(), rgb.len()),
                    -3
                );
                assert!(rgb.iter().all(|v| *v == 0));
            }
            assert_eq!(absor_bridge_create(std::ptr::null(), 1), 0);
            assert_eq!(absor_bridge_create(b"{}".as_ptr(), 4097), 0);
            assert_eq!(absor_bridge_create(b"{}".as_ptr(), 2), 0);
            assert_eq!(absor_bridge_auth(u64::MAX, std::ptr::null(), 1), -3);
            assert_eq!(
                absor_bridge_offer(u64::MAX, std::ptr::null_mut(), 262_144),
                -3
            );
            assert_eq!(absor_bridge_answer(u64::MAX, std::ptr::null(), 1), -3);
            assert_eq!(absor_bridge_answer(u64::MAX, b"x".as_ptr(), 65_537), -3);
            assert_eq!(
                absor_bridge_hello(
                    u64::MAX,
                    std::ptr::null(),
                    1,
                    std::ptr::null(),
                    1,
                    std::ptr::null_mut(),
                    1024
                ),
                -3
            );
        }
        assert_eq!(absor_bridge_poll(u64::MAX), -3);
        absor_bridge_close(u64::MAX);
        absor_bridge_close(u64::MAX);
        assert_eq!(absor_bridge_poll(u64::MAX), -3);
    }
}
