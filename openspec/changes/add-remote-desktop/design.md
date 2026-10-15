# Design

## Context

Ver proposal.md (Why). Estado actual que condiciona el diseño:

- **App de escritorio:** una sola ventana; al cerrarla la app termina (salvo en macOS). No hay bandeja, ni arranque con el sistema, ni bloqueo de instancia única. Todo acceso a red y a disco pasa por IPC al proceso principal, y el token de la cuenta nunca llega al renderer (`src/main/cloud/`).
- **Backend:** Symfony en FrankenPHP, 3 réplicas detrás de Cloudflare → HAProxy → NodePort, con 4 workers por pod (12 en total). Sin SSE ni WebSockets (`kube/AGENTS.md`). Los límites de intentos viven en Postgres para ser comunes a las réplicas. Las fechas se guardan en UTC y se pasan desde PHP.
- **Móvil:** Flutter con estado en `ChangeNotifier`, sin paquetes nativos propios. iOS se instala sin firmar (SideStore/AltStore), así que nada que necesite capabilities de pago.
- **macOS** se firma ad-hoc: los permisos de privacidad (TCC) se asocian a la firma, que cambia en cada versión.

## Goals / Non-Goals

**Goals:**
- Ningún componente de servidor nuevo salvo el relé TURN: la negociación va por la API actual.
- Que el contenido de las sesiones (imagen, sonido, entrada, portapapeles, ficheros) y la contraseña del PC no pasen nunca por el servicio.
- Que el PC controlado no envíe nada ni acepte entrada antes de verificar la contraseña.
- Un único protocolo para el controlador de escritorio y el móvil.
- Ninguna dependencia que obligue a compilar código nativo al instalar o en CI.

**Non-Goals:**
- Un servicio del sistema con privilegios (inicio de sesión, UAC, pantalla de bloqueo).
- Ajuste fino de códecs (H.265/AV1, varias calidades simultáneas): se usa lo que negocie WebRTC.

## Decisions

### D1. Arquitectura
```
 Controlador (ventana de visor / app móvil)          PC controlado (app en segundo plano)
 ┌─────────────────────────────┐                    ┌──────────────────────────────────┐
 │ RTCPeerConnection (renderer)│◀═ WebRTC (DTLS) ══▶│ RTCPeerConnection (ventana oculta)│
 │  vídeo/audio ← · canales →  │   directo o TURN   │  captura + canales de datos       │
 └──────────────┬──────────────┘                    └───────────────┬──────────────────┘
                │ IPC (token en main)                                │ IPC: entrada, portapapeles, ficheros
        ┌───────▼────────┐        HTTPS (polling)          ┌────────▼────────┐  koffi
        │ proceso main   │──────▶  API /api/devices  ◀─────│ proceso main    │──────▶ SendInput / CGEvent / XTest
        └────────────────┘         /api/remote-*           └─────────────────┘
```
- El PC controlado mantiene una **ventana oculta** con su propio renderer (`host.html`) que hace la captura y el WebRTC. El proceso principal hace la señalización, decide los rechazos tempranos e inyecta la entrada.
- El controlador de escritorio abre una **ventana de visor** por sesión (`viewer.html`). Las llamadas a la API las hace el proceso principal por IPC, para que el token no llegue al renderer.
- **Alternativas descartadas:**
  - WebRTC en el proceso principal con `wrtc`/`node-webrtc`: sin mantenimiento y con compilación nativa.
  - Captura en la ventana principal: se puede cerrar, y mezclaría la interfaz con la sesión.

### D2. Transporte: WebRTC
WebRTC aporta, ya incluidos en Chromium y en `flutter_webrtc`:
- códecs con aceleración por hardware;
- control de congestión;
- atravesar NAT con ICE/STUN/TURN;
- cifrado de extremo a extremo (DTLS-SRTP para los medios y DTLS para los canales de datos). El TURN reenvía paquetes que no puede descifrar.

En la pista de vídeo se usa `contentHint = 'detail'` y `degradationPreference = 'maintain-resolution'`: con poco ancho de banda baja la fluidez antes que la nitidez del texto.

**Alternativas:**
- Reenviar la imagen por el servidor (WebSocket): todo el ancho de banda pasaría por nuestro servicio, y seguiría haciendo falta un códec.
- VNC o RDP: hacen falta servidores nativos por SO, y no atraviesan NAT.

### D3. Negociación por la API con consultas periódicas e ICE no incremental
- **Ofertas y respuestas completas (*vanilla ICE*):** cada lado espera a reunir sus candidatos, como mucho 4 s, y envía una descripción completa. Así la negociación son dos mensajes: oferta y respuesta.
- **Controlador:**
  1. Pide los servidores ICE.
  2. Crea la oferta con transceptores `recvonly` de vídeo y audio y los canales de datos (D9).
  3. La publica con `POST /api/devices/{id}/remote-requests`.
  4. Consulta `GET /api/remote-requests/{id}` cada 1 s durante 60 s como máximo.
- **PC controlado:**
  1. Con el control remoto activado y la sesión iniciada, consulta `GET /api/devices/{id}/remote-requests` cada 3 s. Esa consulta le sirve también de señal de vida.
  2. Si debe rechazar (desactivado, bloqueado, ocupado, faltan permisos), responde con el motivo sin crear la conexión.
  3. Si no, crea la conexión con los transceptores en `sendonly` **sin pista** y publica la respuesta con `PUT /api/remote-requests/{id}/answer`.
  4. Tras autenticar (D6) pone las pistas con `replaceTrack`, sin renegociar.
- **Recuperación:**
  - Un corte breve en la misma red lo recupera ICE solo.
  - Si la conexión pasa a `failed`, o sigue en `disconnected` más de 5 s, el controlador repite la negociación completa con la misma clave derivada (D6), sin volver a pedir la contraseña. Lo intenta durante 30 s.
- **Latencia esperada:** como mucho 3 s de consulta, unos 2 s de candidatos y 1 s de consulta del controlador, por debajo de los 10 s de la spec.
- **Alternativas:**
  - Servicio WebSocket propio (Node): otro componente que desplegar y escalar, y otra ruta en HAProxy y Cloudflare.
  - Mercure de FrankenPHP: con 3 réplicas hace falta un hub compartido (la versión HA es de pago).
  - Long polling: ocuparía los 12 workers de FrankenPHP.
  - Si el número de PCs crece hasta que las consultas pesen, se pasa a un servicio WebSocket sin cambiar el protocolo entre equipos.

### D4. Modelo de datos del backend
- **`device`**:
  - `id` (UUID generado por la app y guardado en `userData/device.json`);
  - `user_id` (FK, `ON DELETE CASCADE`) y `session_id` (FK a `user_session`, `ON DELETE SET NULL`), la sesión que lo registró;
  - `name`, `platform` (`windows|macos|linux`), `app_version`;
  - `remote_state` (`disabled|available|missing_permissions|unsupported|busy`) y `features` (JSON `{clipboard, files, audio}`);
  - `last_seen_at`, `created_at`.
- **`remote_request`**:
  - `id` (UUID), `user_id`, `device_id` (FK `CASCADE`) y `controller_session_id`;
  - `controller_name`, `offer` y `answer` (texto, como mucho 64 KB cada uno);
  - `rejection` (código) y `retry_after`;
  - `created_at`, `expires_at` (+60 s), con índice `(device_id, expires_at)`.
- **Limpieza sin worker:**
  - Las solicitudes caducadas se borran en cada alta y en cada consulta del PC.
  - Los equipos sin contacto en 90 días se borran al registrar un equipo.
- **Las operaciones del PC** (consultar solicitudes, responder, `PUT` y `DELETE` del equipo) solo se aceptan con el token de la sesión que lo registró. Un `PUT` con otra sesión de la misma cuenta lo vuelve a vincular, porque es lo que pasa al iniciar sesión de nuevo. **Leer el estado de una solicitud** solo se acepta con la sesión que la creó.

### D5. Contrato de la API
Errores con el formato habitual `{"error": {"code", "details"}}`.

| Método y ruta | Uso | Respuesta | Errores |
|---|---|---|---|
| `GET /api/devices` | Lista de la cuenta | `{devices: [{id, name, platform, appVersion, online, lastSeenAt, remote: {state, features}}]}` (`online` = contacto en los últimos 30 s) | — |
| `PUT /api/devices/{id}` | Alta o actualización del propio equipo | El equipo | `device_taken` 409, `validation_failed` 422 |
| `DELETE /api/devices/{id}` | Retirarlo (cerrar sesión, otra cuenta) | 204 | `device_not_found` 404 |
| `GET /api/devices/{id}/remote-requests` | Consulta del PC (señal de vida) | `{requests: [{id, controllerName, offer, createdAt}]}` (sin responder y sin caducar) | `device_not_found` 404, `too_many_requests` 429 |
| `POST /api/devices/{id}/remote-requests` | El controlador pide sesión con su oferta | 201 `{id, expiresAt}` | `device_not_found` 404, `device_offline` 409, `remote_disabled` 409, `too_many_requests` 429 |
| `PUT /api/remote-requests/{id}/answer` | El PC responde `{answer}` o `{rejected: {reason, retryAfter?}}` | 204 | `remote_request_not_found` 404, `remote_request_expired` 410 |
| `GET /api/remote-requests/{id}` | El controlador espera la respuesta | `{status: pending\|answered\|rejected, answer?, rejection?}` | `remote_request_not_found` 404, `remote_request_expired` 410 |
| `GET /api/remote/ice-servers` | Servidores ICE | `{iceServers: [...], ttl}` | — |

- **Motivos de rechazo** que pone el PC: `wrong_password`, `locked`, `busy`, `missing_permissions`, `remote_disabled`, `declined`, `unsupported`. `wrong_password` y `locked` llegan por el canal de datos (D6); el resto, en la respuesta de la API.
- **Límites** (`rate_limiter.yaml`, pool `app.rate_limiter_cache`):
  - `remote_request_user`: 20 por minuto;
  - `device_poll`: ventana de 1 s por equipo.
- **Interruptor general:** con `REMOTE_ENABLED=0`, todos estos endpoints responden 503 `remote_unavailable`, y la app muestra que el control remoto no está disponible.

### D6. Contraseña del PC y autenticación por desafío
- **Al definirla**, el PC guarda `salt` (16 B), `iterations` (600 000) y `K = PBKDF2-HMAC-SHA256(contraseña, salt, iterations, 32 B)`.
  - `K` se cifra con `safeStorage` cuando existe, igual que el token de sesión.
  - Todo va en `userData/remote-access.json` con permisos 0600. Ver D14.
- **Al abrir el canal `control`:**
  1. El PC envía `hello {v: 1, salt, iterations, nonce (32 B), hostName}`.
  2. El controlador calcula `K` y `proof = HMAC-SHA256(K, "absor-remote-auth-v1" ‖ nonce ‖ fpOferta ‖ fpRespuesta)`. Los `fp` son las huellas DTLS (`a=fingerprint`) de la oferta y de la respuesta, tal como las ve cada lado en sus descripciones local y remota.
  3. El PC compara con `timingSafeEqual`.
- **Por qué así:**
  - La contraseña no viaja nunca, ni siquiera cifrada.
  - Incluir las huellas ata la prueba a esta conexión DTLS: si el servicio de señalización (u otro intermediario) cambiara las huellas para interponerse, cada lado vería huellas distintas y la prueba no coincidiría.
  - PBKDF2 está en WebCrypto (renderer), en Node y en Dart (`cryptography`). scrypt y argon2 no están en WebCrypto.
- **Fallos y bloqueo:**
  - Los fallos se guardan con su fecha en el mismo fichero, para que reiniciar la app no reinicie el contador.
  - Con 5 fallos en 15 min, `lockedUntil = ahora + 15 min`.
  - Al bloquearse, el PC muestra una notificación local.
- **En el controlador**, `K` (nunca la contraseña) se queda en memoria mientras dure la ventana de sesión, para reconectar (D3).
- **Al cambiar la contraseña** se cortan las sesiones activas.

### D7. Proceso del PC controlado (escritorio)
- **`src/main/remote/hostService.ts`:**
  - registra el equipo al arrancar, al cambiar los ajustes y cada 5 min;
  - hace la consulta cada 3 s;
  - decide los rechazos tempranos;
  - crea la ventana oculta `host` cuando hay una solicitud y la destruye al terminar la sesión.
- **Ventana `host`:** `show: false`, `backgroundThrottling: false` (sin esto Chromium ralentiza los temporizadores de las ventanas ocultas), `contextIsolation: true`, `sandbox: true` y un preload mínimo.
- **Captura:** el renderer llama a `getDisplayMedia()`. El proceso principal responde con `session.setDisplayMediaRequestHandler`, que elige la fuente de `desktopCapturer.getSources({types: ['screen']})` cuyo `display_id` coincide con la pantalla pedida y añade el audio (D8). Para cambiar de pantalla se captura la nueva y se hace `replaceTrack`.
- **Aviso durante la sesión:** ventana pequeña sin marco, siempre encima, centrada arriba en la pantalla principal, con el nombre del controlador y "Desconectar". El icono de la bandeja cambia de estado y hay notificaciones al empezar y al terminar.
  - **Windows:** `setContentProtection(true)` la excluye de la captura (Windows 10 2004+), así que el controlador no la ve tapando la pantalla.
  - **macOS:** `setContentProtection(true)` (`sharingType = none`); puede que ScreenCaptureKit no la respete. Se acepta que el controlador la vea.
  - **Linux X11:** no se puede excluir de la captura; el controlador también la ve.
- **Confirmación local:** `dialog.showMessageBox` con `signal` (`AbortSignal.timeout(30 000)`); al vencer el tiempo se rechaza con `declined`.
- **Mantener despierto:** `powerSaveBlocker.start('prevent-app-suspension')` mientras el control remoto está activado y la opción también.
  - **Windows:** `SetThreadExecutionState(ES_SYSTEM_REQUIRED)`.
  - **macOS:** aserción `PreventUserIdleSystemSleep`.
  - **Linux:** inhibición de logind o del salvapantallas, según el escritorio.
  - La pantalla sí puede apagarse: la entrada remota la despierta.

### D8. Captura de pantalla y sonido por sistema
- **Windows:**
  - Pantalla con `desktopCapturer` (WGC/DXGI) y sonido con `audio: 'loopback'` en `setDisplayMediaRequestHandler`.
  - No se captura el escritorio seguro: bloqueo, UAC, Ctrl+Alt+Supr.
- **macOS:**
  - Pantalla con ScreenCaptureKit, que necesita el permiso de Grabación de pantalla (`systemPreferences.getMediaAccessStatus('screen')`). macOS 15 pide reconfirmarlo cada mes.
  - Sonido con `audio: 'loopback'`. Electron 39 usa la API CoreAudio Tap, disponible desde macOS 14.2, que exige `NSAudioCaptureUsageDescription` en el `Info.plist` (`extendInfo` de `electron-builder.yml`). Sin esa clave el audio llega en silencio y sin error. En versiones anteriores de macOS no hay sonido.
- **Linux X11:**
  - Pantalla con `desktopCapturer` (X11).
  - Sonido: primero `audio: 'loopback'`. Si Electron no lo admite, el renderer usa como micrófono la fuente "Monitor of …" que PulseAudio/PipeWire-Pulse expone en `enumerateDevices()`. Si no existe, el sonido no está disponible.
- **Linux Wayland:** no se admite como PC controlado. Se detecta con `XDG_SESSION_TYPE=wayland` o `WAYLAND_DISPLAY`. La captura pasa por el portal, que pide aceptar cada vez, y XTest no actúa sobre las apps de Wayland.

### D9. Protocolo de los canales de datos (v1)
| Canal | Modo | Contenido |
|---|---|---|
| `control` | fiable y ordenado, JSON | `hello`, `auth`, `auth-result`, `displays`, `select-display`, `features`, `clipboard`, metadatos de ficheros, `fs-list`, `bye` |
| `input` | fiable y ordenado, JSON | `key {code, down}`, `button {button, down}`, `wheel {dx, dy, mode}`, `text {text}`, `release-all` |
| `pointer` | sin orden, `maxRetransmits: 0` | `move {x, y}` normalizados (0–1) sobre la pantalla elegida; solo importa el último |
| `file` | fiable y ordenado, binario | Trozos de 64 KB con control de presión (`bufferedAmountLowThreshold` 1 MB) |

- **Robustez:** los mensajes llevan `v`, y los tipos desconocidos se ignoran.
- **Antes de autenticar** el PC solo procesa `auth` y descarta lo demás.
- **Teclas pegadas:** al cerrarse la sesión o el canal, el PC suelta todas las teclas y botones pulsados. El visor envía `release-all` al perder el foco.
- **Pantallas:** `displays` lleva `[{id, name, bounds, scaleFactor, primary}]`.
- **Portapapeles:** el PC lo consulta cada 1 s durante la sesión (Electron no avisa de los cambios), con un hash para no reenviar lo que acaba de recibir. Texto de hasta 1 MB e imagen PNG de hasta 10 MB.
- **Ficheros:**
  - Envío: `file-offer {id, name, size}` → aceptación o rechazo → trozos → `file-end {sha256}`. El PC escribe un `.part` y lo renombra a un nombre libre en `Descargas/Absor Connect`.
  - Descarga: `fs-list {path}` y `file-request {path}`, con las mismas comprobaciones de integridad.
  - Las dos direcciones admiten `file-cancel`.

### D10. Inyección de entrada con `koffi`
`koffi` es una FFI con binarios N-API precompilados (Windows, macOS y Linux; x64 y arm64). Funciona en Electron sin recompilar. Sus `.node` se desempaquetan del asar (`asarUnpack`).

Las teclas viajan como `KeyboardEvent.code`, es decir, por posición física. Una tabla compartida (`src/shared/remote/keymap.ts`) las traduce al código de cada sistema, con datos de `dom_code_data.inc` de Chromium (licencia BSD, con su atribución). Así manda la distribución del PC controlado, como en Chrome Remote Desktop.

- **Windows (`user32.dll`):**
  - `SendInput`. Ratón con `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`, normalizado a 0–65535 sobre el escritorio virtual (`GetSystemMetrics`).
  - Teclas con `KEYEVENTF_SCANCODE` (y `EXTENDEDKEY` donde toca). Texto con `KEYEVENTF_UNICODE` por unidad UTF-16.
  - Límite: UIPI impide actuar sobre ventanas elevadas.
- **macOS (CoreGraphics):**
  - `CGEventCreateMouseEvent` (con `kCGMouseEventClickState` para el doble clic), `CGEventCreateKeyboardEvent` con códigos `kVK_*`, `CGEventKeyboardSetUnicodeString` para el texto y `CGEventCreateScrollWheelEvent` (variádica, que koffi admite).
  - Todo con `CGEventPost(kCGHIDEventTap)`, en puntos globales (los mismos que los DIP de Electron).
  - Requiere el permiso de Accesibilidad (`systemPreferences.isTrustedAccessibilityClient(false)`).
- **Linux X11 (`libXtst`, `libX11`):**
  - `XTestFakeMotionEvent`, `XTestFakeButtonEvent` (1–3 y rueda 4–7) y `XTestFakeKeyEvent` con el código evdev + 8.
  - El texto se escribe buscando el keysym (Unicode `0x01000000 + cp`). Si no está en el mapa, se reasigna temporalmente un keycode libre con `XChangeKeyboardMapping`, como hace xdotool.
  - Las coordenadas van en píxeles físicos: los DIP de Electron por `scaleFactor`.
- **Conversión común:** `(x, y)` normalizados × `bounds` de la pantalla elegida → coordenadas del sistema, con la conversión de escala de cada SO.
- **Alternativas:**
  - `nut.js`: escribe el texto según la distribución local y es una dependencia grande.
  - `robotjs`: sin mantenimiento y con compilación nativa.
  - Binarios auxiliares por SO: más piezas que firmar y empaquetar.

### D11. Ventana del visor (escritorio)
- **Apertura:** nueva entrada `viewer.html` en `electron.vite.config.ts` (varias entradas de renderer). El proceso principal la abre con el `deviceId`.
- **Seguridad de la ventana:** `contextIsolation`, `sandbox` y preload con solo los canales `remote-*`. La negociación pasa por IPC al proceso principal, que comprueba que quien llama es una ventana de visor.
- **Atajos y teclado:**
  - Las ventanas de visor quedan fuera de `optimizer.watchWindowShortcuts`, para que Ctrl+R o F12 lleguen al PC remoto.
  - En pantalla completa se usa `navigator.keyboard.lock()`. En Windows y Linux captura Alt+Tab y la tecla Windows; en macOS, Cmd+Tab no se puede capturar y se ofrece en el menú de combinaciones.
- **Ratón:** coordenadas del elemento → normalizadas, descontando las bandas del ajuste. Sin bloqueo del puntero (modo absoluto).
- **Estado:** `getStats()` da el par de candidatos activo (`relay` frente a `host`/`srflx`), el `roundTripTime` y `framesPerSecond`.
- **Ficheros:** las transferencias tienen su propia lista en la ventana. Los ficheros soltados se leen en el renderer con `File` y `stream()`.

### D12. App móvil
- **WebRTC:** `flutter_webrtc` (`RTCPeerConnection`, `RTCVideoView`, canales de datos). Mismo protocolo (D9).
- **PBKDF2:** paquete `cryptography`, en un isolate. Las iteraciones vienen en `hello`, así que se pueden ajustar sin cambiar el protocolo.
- **Gestos:**
  - Modo ratón (trackpad): un dedo mueve el puntero, toque es clic, dos dedos son clic derecho y desplazamiento, y tocar y arrastrar arrastra.
  - Modo táctil: el toque hace clic donde se toca.
  - Pellizco para el zoom local.
- **Teclado:** un `TextField` oculto envía `text`, y borrar o Intro van como `key`. Barra de teclas con modificadores de un toque, como la terminal.
- **Portapapeles:**
  - Del PC al móvil: se aplica al llegar (`Clipboard.setData`).
  - Del móvil al PC: botón "Enviar portapapeles". Leerlo solo avisa al usuario: diálogo de pegar en iOS 16+ y aviso en Android 12+.
- **Ficheros:** `file_picker` para enviar. Para descargar, explorador del PC → fichero temporal → hoja de compartir (`share_plus`).
- **Segundo plano:** al pasar a `paused` arranca un temporizador de 30 s que cierra la sesión. Si se vuelve antes y la conexión cayó (iOS suspende la app), se reconecta con `K` en memoria.
- **Permisos:**
  - Comprobar si `flutter_webrtc` exige `NSMicrophoneUsageDescription` o `NSCameraUsageDescription` en iOS aunque solo reciba. Si se añaden, la fuente de AltStore debe declararlas igual (`AGENTS.md`).
  - En Android, `MODIFY_AUDIO_SETTINGS` para reproducir el audio.

### D13. Relé TURN
- **Despliegue:** coturn en un host con IP pública, por ejemplo `head0` junto a HAProxy, en Docker con `network_mode: host`.
- **Credenciales:** `use-auth-secret` con `static-auth-secret = TURN_SECRET`, `realm = absor.top`.
- **Puertos:** 3478 UDP/TCP, TLS en 5349 con el certificado comodín `*.absor.top`, y relé en un rango UDP corto (por ejemplo 49160–49200).
- **Protección contra abusos:**
  - `no-multicast-peers`;
  - `denied-peer-ip` para 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 y las redes del cluster, para que el relé no sirva para entrar en la red interna;
  - cuotas `user-quota` y `total-quota`, y `max-bps` por sesión.
- **DNS:** `turn.absor.top` sin el proxy de Cloudflare, que no reenvía TURN.
- **Credenciales temporales:** `username = "<caducidad unix>:<userId>"` y `credential = base64(HMAC-SHA1(TURN_SECRET, username))`, la API REST estándar de coturn, con 24 h de validez.
- **STUN:** el propio coturn, más `stun.cloudflare.com:3478` de respaldo.
- **Configuración:** `TURN_URLS` y `STUN_URLS` en el Secret `absorconnect-env`.
- **Dónde vive:** la configuración del relé está fuera de este repo (infraestructura). `kube/AGENTS.md` documenta las variables y dónde se despliega.

### D14. Modo en segundo plano (escritorio)
- **Bandeja:** `Tray` con menú: abrir, estado del control remoto, buscar actualizaciones y salir.
  - **Windows:** área de notificación, icono `.ico`/PNG de 16 y 32 px.
  - **macOS:** barra de menús con una imagen *template* monocroma. Con la ventana oculta se esconde también el icono del Dock (`app.dock.hide()`) y vuelve a aparecer al abrirla.
  - **Linux:** StatusNotifierItem/AppIndicator. En GNOME sin la extensión no se ve; abrir la app desde el menú muestra la ventana (instancia única).
- **Cerrar sin salir:** con "Mantener abierta en segundo plano", el evento `close` de la ventana se cancela y se oculta. `before-quit` marca la salida real. `window-all-closed` no termina la app en ese modo.
- **Abrir al iniciar sesión:**
  - **Windows y macOS:** `app.setLoginItemSettings({openAtLogin, args: ['--hidden']})`. En macOS 13+ va por SMAppService, y se detecta el arranque oculto por el argumento o por `wasOpenedAtLogin`.
  - **Linux:** fichero `~/.config/autostart/absor-connect.desktop` con `Exec=<ruta> --hidden`. La ruta es `process.env.APPIMAGE` en AppImage (electron-updater la reemplaza en el sitio) o `process.execPath` en `.deb`, `.rpm` y `tar.gz`.
- **Instancia única:** `app.requestSingleInstanceLock()`; `second-instance` muestra la ventana.
- **Ajustes locales:** `keepInBackground` y `openAtLogin` van en `settings.json`, junto al tema y el idioma.
- **Fichero `userData/remote-access.json`:** `accountEmail`, `deviceName`, `enabled`, `password` (`salt`, `iterations`, `K` cifrada), `features`, `confirmLocal`, `preventSleep`, `failures`, `lockedUntil` y `log` (50 eventos).
- **Cuenta:** al iniciar sesión, si `accountEmail` no coincide con la cuenta, se borran la contraseña y el registro y se desactiva el control remoto (spec "Control remoto ligado a la cuenta"). Al cerrar sesión se hace `DELETE` del equipo y se para el servicio, pero se conserva la configuración local.

### D15. Actualizaciones en segundo plano
- **Búsqueda:** un temporizador de 6 h llama a `checkForUpdates()` y otro aviso al arrancar. Si hay versión nueva, notificación del sistema y entrada en el menú de la bandeja.
- **Instalación:** `autoInstallOnAppQuit` sigue activado. `quitAndInstall()` no se ejecuta mientras haya una sesión remota: el botón explica que se instalará al terminarla.
- **En macOS** no cambia nada respecto a hoy: sin certificado, Squirrel no instala solo y se ofrece la descarga manual.

## Risks / Trade-offs

- **[macOS, firma ad-hoc]** Tras cada actualización macOS puede retirar Grabación de pantalla y Accesibilidad → la app lo detecta al arrancar, marca el equipo como `missing_permissions` y muestra una notificación con el permiso que falta. La solución definitiva es un certificado de Apple Developer (fuera de alcance).
- **[macOS 15]** Pide reconfirmar la grabación de pantalla cada mes, y alguien tiene que aceptarlo delante del Mac → documentado en Ajustes y en la web. No hay forma oficial de evitarlo.
- **[Windows]** Pantalla bloqueada, UAC y ventanas elevadas no se pueden controlar → Ajustes lo explica. Un servicio del sistema queda fuera de alcance.
- **[Linux Wayland]** No se admite como PC controlado → se detecta y se explica, sugiriendo una sesión X11.
- **[Linux, sonido]** No está confirmado que `loopback` funcione en Linux → la tarea de prototipo lo comprueba antes de construir encima, con la fuente "Monitor of …" como alternativa.
- **[Carga de la API]** Cada PC con el control remoto activado hace una consulta cada 3 s (unas 33 por segundo con 100 PCs, por índice) → límites por equipo y consulta mínima. Si crece, servicio WebSocket (D3).
- **[Abuso del TURN]** Un relé abierto sirve para reenviar tráfico ajeno o entrar en redes internas → credenciales temporales firmadas, `denied-peer-ip`, cuotas y límite de ancho de banda.
- **[Coste del relé]** Una sesión por relé puede gastar varios Mbit/s en el host del TURN → `max-bps`, cuotas y vigilancia del tráfico del host.
- **[Fuerza bruta]** Alguien con acceso a la cuenta puede probar contraseñas → bloqueo persistente, registro, notificación local y límite de solicitudes por cuenta.
- **[Ventana oculta]** Chromium ralentiza los renderers ocultos → `backgroundThrottling: false` y prueba de captura con la ventana principal cerrada.
- **[Empaquetado nativo]** `koffi` debe quedar fuera del asar en los tres sistemas → probar los paquetes reales (NSIS, DMG, AppImage, deb) antes de publicar.
- **[Móvil]** 600 000 iteraciones de PBKDF2 en Dart puro pueden tardar varios segundos en un móvil modesto → medirlo. El número viaja en `hello`, así que se puede bajar al definir la contraseña sin tocar el protocolo.
- **[Tamaño de la app móvil]** `flutter_webrtc` añade el binario de libwebrtc (≈ 10–20 MB) → aceptado.

## Migration Plan

1. **Backend:** migración con las tablas `device` y `remote_request`, endpoints y límites, con `REMOTE_ENABLED=1`. No afecta a las apps actuales, que no usan esos endpoints.
2. **Relé:** desplegar coturn, crear el DNS `turn.absor.top` y añadir `TURN_SECRET`, `TURN_URLS` y `STUN_URLS` al Secret (`make-env-secret.sh`), reiniciando los pods. Comprobar con `turnutils_uclient` y con una conexión real por relé.
3. **Apps:** release conjunta de escritorio y móvil (minor nueva). Las versiones anteriores no ven nada nuevo.
4. **Vuelta atrás:** `REMOTE_ENABLED=0` desactiva la función en todas las apps sin publicar una versión. Las tablas pueden quedarse: nada más las usa.

## Open Questions

- Qué host aloja coturn (`head0` u otro con IP pública), el rango final de puertos del relé y las cuotas. No cambia el diseño.
- El número final de iteraciones de PBKDF2, tras medirlo en un Android modesto y en un iPhone (D12).
