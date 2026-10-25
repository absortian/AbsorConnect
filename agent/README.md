# Núcleo del agente desatendido

Implementación inicial de las tareas 3.1, 3.2 y 3.4 de
`add-unattended-admin-access`. Es una biblioteca Rust, **no un servicio instalable
ni un host remoto**. No abre puertos, no lee cuentas, no captura pantallas ni
envía entrada. El modo publicado de Electron continúa sin cambios.

## Qué está implementado

`absor-agent-core` mantiene la autorización temporal del broker y posee como
máximo una sesión de trabajador. Arranca sin permiso; una respuesta validada
del backend concede como mucho 30 segundos **desde el comienzo de la petición**,
descontando el viaje de red. La respuesta no puede reutilizarse, pertenecer a
otra instancia ni superar a una consulta más reciente. Un fallo de red no
renueva el permiso anterior. Una respuesta tardía no resucita la sesión cerrada.

Antes y después de cada operación se comprueba la autorización. `poll()` debe
ejecutarse también sin tráfico y devuelve una espera máxima de 100 ms, acortada
al plazo restante. Al vencer, el núcleo llama al cierre del trabajador y no
admite nuevas operaciones/sesiones hasta una validación nueva. Revocar o parar
inhabilita la instancia; una respuesta pendiente no la reactiva. Un fallo o
retroceso del reloj también cierra e inhabilita. Destruir el núcleo cierra la
sesión propia. Las referencias a consultas y sesiones son internas, sin
serialización ni autoridad de acceso al SO.

El reloj cuenta la suspensión, sin depender del calendario:

- Linux **de 64 bits**: `clock_gettime(CLOCK_BOOTTIME)`, con validación del resultado.
- macOS: `mach_continuous_time` y conversión comprobada con `mach_timebase_info`.
- Windows 10+: `QueryInterruptTimePrecise`, con unidades de 100 ns.

FFI está limitada a `clock.rs`; el resto del núcleo prohíbe `unsafe`. El crate
`agent-core` no tiene dependencias de terceros. Rust mínimo 1.75; lockfile versionado y compilación
offline. El CI usa toolchain fijo 1.85.0 en Linux, Mac y Windows. No confundir
compilar el reloj con certificar suspensión/reanudación real de cada equipo.

## Fronteras que faltan por conectar

`accept_validation` solo puede llamarse desde el cliente confiable de API tras
validar TLS, equipo, estado y contrato; **no desde WebRTC, el renderer o IPC
sin autenticar**. El núcleo no implementa HTTP ni considera confiable un JSON por analizarlo.
La respuesta de la API está descrita en [`backend/AGENT_API.md`](../backend/AGENT_API.md).

`attach_authenticated` exige que el trabajador haya verificado previamente la
prueba v1/DTLS/HMAC. Esta biblioteca **no implementa ese autenticador**. Tampoco
guarda intentos o credenciales: la persistencia protegida y su bloqueo tras
reinicio siguen pendientes. Crear una instancia nueva no es un mecanismo para
eludir revocación: el servicio deberá validar el alta/configuración y la API.

El actor del broker debe consumir `poll()` puntualmente, no bloquear en las
operaciones y garantizar que `Session::close` libera entrada y termina captura
y transporte, sin bloquear. Su watchdog y los mecanismos de muerte del padre
deben cortar el trabajador incluso si el broker falla o queda suspendido. Una
biblioteca llamada solo al recibir entrada no corta por sí sola un vídeo P2P
inactivo. Faltan esos adaptadores, WebRTC, IPC autenticado, contextos protegidos,
instaladores y controladores finales. No se ha marcado completa la tarea 3.4.

## Desarrollo y comprobaciones

Desde la raíz del repositorio:

```bash
cargo fetch --manifest-path agent/Cargo.toml --locked
cargo fmt --manifest-path agent/Cargo.toml --all --check
cargo clippy --manifest-path agent/Cargo.toml --offline --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path agent/Cargo.toml --offline --locked
cargo run --manifest-path agent/Cargo.toml --offline --locked --example lease-smoke
cargo build --manifest-path agent/Cargo.toml --offline --locked --release
```

El ejemplo crea exclusivamente un hijo propio sin red, pantalla o entrada y
comprueba que la caducidad lo termina y rechaza una operación posterior. Usa
una autorización local de prueba y simula la frontera del autenticador; no
demuestra una conexión remota autenticada. Solo imprime indicadores. El hijo
tiene además un límite propio de diez segundos. No instala servicios.

El CI repite las pruebas y el ejemplo en los tres SO. El árbol `agent/` y sus
artefactos se excluyen de `app.asar`. La distribución real de binarios del agente
se añadirá explícitamente cuando sus componentes estén verificados.

## Cliente de API y renovación

`absor-agent-api` añade el cliente de consulta de solicitudes y el coordinador
`RenewingAgent`. El HTTP ocurre en un único hilo con una consulta pendiente y
canales acotados. El actor llama `tick()` puntualmente incluso sin tráfico de
sesión; no queda bloqueado por lectura HTTP o DNS. No se crean hilos sustitutos
si el actual se demora. DNS depende del sistema y puede exceder el timeout del
cliente: el permiso caduca igualmente; falta el supervisor que recupere un
proceso de red irrecuperable. Cerrar/parar impide procesar respuestas nuevas.

Producción exige un origen HTTPS de configuración protegida, sin credenciales,
ruta, consulta o fragmento. El cliente solo consulta
`/api/host-agent/remote-requests` con una credencial `acg_` válida en memoria.
No implementa login, alta, cambios de cuenta, respuestas SDP ni ICE todavía.
Rechaza redirecciones, proxies de entorno, cookies y compresión. Conserva
verificación TLS/raíces de rustls, límites de conexión (2 s), petición (4 s) y
cuerpo (8 MiB + 64 KiB), y esquemas cerrados: duración 1–30 s, campos tipados,
sin duplicados, hasta 64 solicitudes y ofertas de hasta 64 KiB. La fecha UTC
es solo metadato; la vigencia se mide siempre con el reloj local del núcleo.
La validación final de SDP, identidad DTLS y HMAC pertenece al autenticador.

401/403 cierra e inhabilita la instancia. 429 respeta Retry-After numérico
(hasta un día; omisión tres segundos), sin renovar autorización. Errores de
red, 5xx, formato, TLS o respuesta tardía conservan únicamente el plazo válido
anterior; al vencer se corta el trabajador. Una validación posterior requiere
una sesión autenticada nueva, sin reutilizar la que ya se cerró. Los tipos con
credenciales, nombres y SDP no se imprimen en diagnósticos.

Dependencias directas fijadas en `Cargo.toml`/`Cargo.lock`: ureq 2.12.1 con TLS
y sin características por omisión, serde 1.0.229, serde_json 1.0.154 y url 2.5.8.
Se eligió HTTP síncrono aislado para mantener Rust 1.75 sin añadir un runtime
asíncrono. Alternativas: reqwest/Tokio añade ejecución asíncrona innecesaria a
este único carril; libcurl por proceso introduce una herramienta externa y
gestión de credenciales entre procesos. Las transitivas quedan fijadas por
lockfile compatible con 1.75; CI descarga primero y verifica después offline.
La revisión de avisos/licencias del paquete final sigue pendiente.

### Ensayo con backend real de desarrollo

```bash
cargo build --manifest-path agent/Cargo.toml --locked -p absor-agent-api --example api-smoke --features lab-http
python3 -B prototypes/backend-agent-check/native-renewal.py
```

`lab-http` es una característica **exclusiva del laboratorio**, desactivada por
omisión y nunca habilitada en el paquete del servicio. Añade una construcción
explícita que acepta solo HTTP en la IP literal `127.0.0.1` con puerto, sin
credenciales, ruta, consulta ni fragmento; `AgentApi::new` sigue exigiendo HTTPS
incluso al compilarla. Permite la API local y su proxy de fallos, sin apagarla.

El lanzador solo usa `127.0.0.1:8020`, crea dos cuentas/dispositivos temporales,
canjea sus altas y entrega la credencial al binario por stdin, nunca argv/env.
Prueba revocación y corte de red con procesos hijos propios y retira las cuentas
en `finally`. No imprime datos de cuenta, tokens ni SDP. El ejemplo simula la
frontera de autenticación v1, sin captura/entrada/transporte P2P: comprueba la
integración API → reloj/permiso → cierre de un proceso, no un host remoto final.

## Orden de aceptación acordado

El 25/10/2026 el propietario pidió dejar las máquinas físicas para el final.
Continuar primero núcleo común, integración y pruebas de fallo en laboratorios
virtuales. El piloto físico de Windows/Mac/Mint, permisos, monitores, red
exterior y controladores móviles sigue siendo obligatorio antes de publicar
esas capacidades. La revisión pendiente de viabilidad/distribución Mac se
mantiene antes de su agente final; esta biblioteca no cambia TCC ni requiere
autorizaciones nuevas del Mac anfitrión.

Referencias:
[reloj Linux](https://man7.org/linux/man-pages/man3/clock_gettime.3.html),
[reloj continuo de Apple](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time),
[reloj Windows](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryinterrupttimeprecise).
El SDK de Apple confirma además que `mach_continuous_time` avanza durante el sueño.
