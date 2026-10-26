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
- Windows 10+: `QueryInterruptTimePrecise`, con unidades de 100 ns y la import library
  `Mincore.lib` del SDK ([contrato de Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryinterrupttimeprecise)).

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

## Verificador nativo v1

`absor-agent-auth` verifica el mismo HMAC-SHA256 que Electron/Flutter, mediante
ring 0.17.14, ya presente en el lockfile por TLS. Añade base64 0.22.1 como
dependencia directa, sin cambiar las versiones transitivas. No implementa
criptografía propia. Los tres vectores compartidos comprueban también PBKDF2;
la derivación solo se ejecuta en la prueba. Durante una conexión se recibe K
del alta/almacén protegido, nunca una contraseña. El alta futura debe conservar
la normalización NFC de la app. Solo admite parámetros actuales: salt de 16
bytes y 600 000 iteraciones; rechaza configuraciones distintas.

Cada desafío usa 32 bytes aleatorios del sistema y admite una sola prueba,
incluido un mensaje malformado. `hello` conserva exactamente los seis campos
v1. La prueba es JSON de hasta 512 bytes con versión/tipo/campos cerrados,
sin duplicados y HMAC de 32 bytes en base64 canónico. El HMAC incluye nonce,
huella de oferta y huella de respuesta como texto exacto; no normalizar las
huellas después de aplicarlas. Se admiten huellas SHA-256 bien formadas.

`DtlsBinding` debe proceder de las descripciones realmente aplicadas por el
trabajador que termina DTLS; no basta analizar una oferta de señalización.
`VerifiedConnection` no es clonable ni serializable y se consume al activar
esa misma conexión. No autoriza otra PeerConnection ni sustituye permisos del
backend, consentimiento local o verificación del IPC. La biblioteca tiene un enlace de laboratorio descrito en el apartado siguiente:
faltan el adaptador del servicio, la frontera real entre procesos y su prueba
con captura y entrada. No cambiar de ubicación los secretos
ni aceptar un booleano de autenticación procedente de un proceso ajeno.

Un único `Verifier`/actor administra todos los intentos del host. `AttemptStore`
exige carga y reemplazo atómico/durable en el almacén protegido del servicio;
no existe un adaptador por omisión. Estado ausente, corrupto o incoherente
falla: nunca reiniciar contadores por un error. Se reserva un fallo antes del
HMAC y se borra solo tras una prueba correcta y una segunda escritura correcta.
Así una caída durante la prueba puede consumir un intento, pero no regalarlo.
Cinco fallos en quince minutos bloquean quince minutos. El estado conserva un
suelo de hora local: si el reloj retrocede, se detiene el verificador; no se
usa ese reloj para la autorización de API, que conserva `BootClock`. El reloj
UTC y la exclusión mutua del almacén son responsabilidades confiables del SO.
No se garantiza borrado criptográfico de K de la memoria del proceso.

```bash
cargo run --manifest-path agent/Cargo.toml --offline --locked --example restart-smoke
```

El ejemplo usa K pública fija y un diario temporal propio, ejecuta dieciséis
procesos separados y comprueba que el bloqueo sobrevive y que un acceso correcto
borra fallos. Retira su directorio al terminar. No lee datos de la app, no crea
cuentas/servicios, no captura ni envía entrada. La implementación de archivo es
solo de laboratorio: no certifica ACL, cifrado, concurrencia ni recuperación del
almacén de producción por plataforma. Su éxito no cierra la tarea 3.2.

## Enlace de laboratorio con libwebrtc y API

`absor-agent-webrtc-lab` enlaza los tres componentes anteriores con el trabajador
C++ existente de vídeo artificial. **No es el servicio**, no acepta K del
propietario y no debe incluirse en sus instaladores. Usa exclusivamente K y
salt públicos del vector compartido. La ABI C está ausente por omisión; exige
`lab-http` y solo acepta la API HTTP loopback con credencial de agente efímera.

Cada instancia pertenece a una PeerConnection. El trabajador aplica sus
descripciones, termina DTLS y entrega sus huellas al verificador Rust. Exige
autorización de API antes de crear la conexión, comprueba HMAC/registro y solo
entonces añade la pista artificial. Tick y consulta del handle activo mantienen
la caducidad; una respuesta tardía no rehabilita una sesión ya cerrada. Al cortar,
el adaptador detiene la fuente y cierra canal y PeerConnection. El bucle consulta
cada 50 ms; falta un supervisor/watchdog independiente si el hilo se bloquea.
Esta prueba no certifica el comportamiento temporal del servicio final.

Los identificadores de ABI son números no reutilizados, no punteros. El registro
acotado y serializado rechaza identificadores ajenos/cerrados. `unsafe` se limita
a copiar buffers C de tamaño acotado y escribir la respuesta; el llamador
compilado debe proporcionar memoria válida. Esta ABI interna no es un protocolo
de IPC autenticado y nunca debe exponerse directamente a red o renderers.

```bash
# Mac: usa el checkout/compilador fijado del laboratorio de WebRTC.
python3 prototypes/remote-desktop/webrtc-check/build.py /ruta/laboratorio --rust-bridge
python3 prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node
```

El enlace nativo se ha preparado y probado en Mac ARM. Compila una dylib con el
Rust del checkout de WebRTC y la resuelve por rpath privado del diagnóstico,
separada de su runtime Rust interno. Los otros diagnósticos conservan su build
sin Cargo por omisión. El crate y la ABI se verifican aparte con Rust estable
en CI de tres SO; eso no compila ni certifica libwebrtc en Windows/Linux.

El lanzador aislado usa la imagen PHP de desarrollo y una BD propia efímera en
el Postgres local. Publica la API solo en un puerto loopback libre, mantiene los
límites configurados y retira sus cuentas, contenedor, BD y archivo de entorno.
No resetea los límites ni datos de la API de desarrollo. Sus caches van a tmpfs;
los logs privados quedan en el laboratorio. Se prueban vídeo válido, HMAC/huella
erróneos, revocación y corte de API, más rechazo previo a crear PeerConnection.

El visor aislado recibe solo dos recursos públicos por un protocolo propio,
con CSP, sandbox y contexto separado. Se bloquean peticiones file/http/https y
se comprueba que no puede leer un archivo marcador ni la ruta de credenciales.
El token de cuenta no se entrega al trabajador y la credencial del agente no
se entrega al renderer. La señalización sigue pasando por archivos privados de
prueba: faltan señalización completa, almacén protegido por SO, captura/entrada
reales, supervisor de servicio e instaladores. Esta variante aún no prueba TURN ni Flutter.

## Supervisor independiente (laboratorio)

`absor-agent-supervisor` aporta `PeerWatch`: pulsos numerados y fechados con
`BootClock`, plazo de vida de dos segundos, estado terminal y rechazo de
repeticiones, saltos, fechas futuras/retrasadas y retroceso/error del reloj.
La fecha del emisor limita el plazo; recibir datos acumulados en un pipe no
renueva desde la hora de recepción. Cola de ocho mensajes y líneas acotadas;
un lector atascado no detiene el temporizador de vigilancia.

La feature optativa `synthetic-lab` compila `absor-lab-supervisor` y un hijo de
prueba. El lanzador solo ejecuta el extremo artificial de nombre fijado,
mediante `Command` sin shell, con pipes heredados y como el mismo usuario.
No instalarlo ni exponer sus argumentos o comandos a un cliente remoto. No
implementa identidad/ACL de IPC ni aislamiento de privilegios de producción.

El actor de autorización del trabajador emite vida **después** de completar
su consulta local de estado. Si se bloquea, el proceso supervisor termina y
recoge ese hijo propio. El supervisor también emite vida: si se bloquea o
muere, un hilo independiente del trabajador lo termina sin destructores C++
ni `atexit` (`_exit`/`TerminateProcess` sobre sí mismo). La terminación forzada
corta todos los hilos de vídeo y sockets; liberar teclas/botones físicos al
morir un trabajador queda pendiente del adaptador del SO. No se reinicia ni
se rehabilita una PeerConnection anterior después de ningún fallo.

```bash
cargo test --manifest-path agent/Cargo.toml --locked --all-features
# Compila supervisor y dylib con el mismo Rust fijado del checkout:
python3 prototypes/remote-desktop/webrtc-check/build.py /ruta/laboratorio --rust-bridge
# Cinco casos originales + bloqueo/caída de trabajador y supervisor:
python3 prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node
```

El runner verifica hashes de extremo, dylib y supervisor. Los cuatro fallos
solo pueden provocarse contra procesos propios del laboratorio, por comandos
enumerados de su lanzador local. En una muerte abrupta UDP, que el host haya
terminado no implica que el controlador reciba inmediatamente un cierre DTLS:
se comprueban por separado terminación/EOF y ausencia de nuevos fotogramas.

## Señalización por API y trabajador X11 inicial

`agent-api/signaling` añade un carril HTTP separado para ICE, respuesta SDP y
rechazo `busy`. Un solo trabajo/respuesta en vuelo; no bloquea al actor ni crea
hilos nuevos al repetir una petición pendiente. Reutiliza TLS verificado,
sin redirecciones, proxy del entorno o token de cuenta. Los UUID y SDP están
validados antes de construir rutas; ICE limita cuerpos, servidores, URLs,
credenciales y TTL. Una operación de señalización nunca renueva el lease.

En `agent-webrtc-lab`, `apiSignaling` consume una oferta validada por la API,
retiene su ID dentro de Rust y publica una sola respuesta para esa solicitud.
El trabajador usa las descripciones realmente aplicadas para HMAC/DTLS. Espera
la confirmación de la respuesta antes de emitir el reto; ofertas duplicadas,
respuesta repetida o una solicitud resuelta/caducada no conceden otra sesión.
Las solicitudes adicionales se rechazan como ocupadas mediante la misma API.
La variante anterior por archivos sigue disponible para regresiones; el
lanzador aislado selecciona la variante API y exige cero archivos SDP.

`agent-x11-lab` es un trabajador inicial Linux de 64 bits, optativo y acotado
a una ventana propia de la VM. Recibe un resultado consumible del verificador
v1 y trabaja por una cola de capacidad uno, separada del actor de autorización.
La ventana es de 320×180, RGB/TrueColor24, sin decoraciones del gestor; captura
XGetImage y comprueba eventos XTest de un clic izquierdo y la tecla fija A.
Comprueba sesión/asiento/usuario X11 y Cinnamon desbloqueado, identidad de la
sesión, foco propio, destino del puntero y entrada libre. No lee texto de eventos.
Restaura el puntero y libera los pulsos enviados; un error del trabajador es
terminal. `Session::close` solo marca parada, sin bloquear al actor con Xlib.

No acepta ventanas, comandos de shell, archivos o teclas arbitrarios. Exige un
marcador root creado temporalmente por el lanzador de la VM propia, una cuenta
sin privilegios y su Xauthority privada. Solo carga dos bibliotecas fijadas
del SO por ruta absoluta, conservadas durante el proceso por sus callbacks
TLS. Nunca se ejecuta al compilar o al pasar `cargo test`. La descripción del
ensayo, sus límites y comandos están en `crates/agent-x11-lab/README.md`.

La prueba opcional de la VM usa el backend real por un túnel SSH loopback,
credencial efímera por stdin y los mismos gate/verificador del agente. No
guarda ni transmite los píxeles; valida rojo → entrada → verde y corte de
API. Las huellas de esa prueba nativa son públicas de laboratorio, por lo
que no acredita el recorrido P2P Linux. Ese recorrido continúa usando vídeo
artificial en Mac/Electron. No hay servicio final, IPC protegido, almacenes
del SO, captura de escritorio general ni soporte de administración anunciado.

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
