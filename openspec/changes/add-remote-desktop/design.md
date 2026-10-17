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
  - `user_id` (FK, `ON DELETE CASCADE`) y `key_hash`, el SHA-256 de la clave del equipo;
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
- **Clave del equipo:** al registrarse por primera vez, la app genera 32 bytes aleatorios. Los guarda en `device.json` junto al identificador (cifrados con `safeStorage` cuando existe) y el servicio solo guarda su SHA-256.
  - Las operaciones del PC (`PUT` y `DELETE` del equipo, consultar solicitudes y responder) exigen además la cabecera `X-Device-Key`. Si no coincide, el servicio responde 403 `device_key_invalid`: no es un 401, porque la app trata cualquier 401 como sesión caducada.
  - **Por qué no basta con la sesión:** otra sesión de la misma cuenta (por ejemplo, un móvil con la cuenta robada) podría registrarse como ese PC y responder a un controlador. El controlador le enviaría la prueba de la contraseña (D6), y esa prueba se puede atacar sin conexión probando contraseñas débiles. Con la clave, hacerse pasar por el PC exige robarla de su disco.
  - Al cerrar sesión e iniciarla otra vez con la misma cuenta, el PC conserva su identificador y su clave. Con otra cuenta, el identificador ya está cogido (`device_taken`) y la app genera unos nuevos.
- **Leer el estado de una solicitud** solo se acepta con la sesión que la creó (`controller_session_id`).

### D5. Contrato de la API
Errores con el formato habitual `{"error": {"code", "details"}}`.

| Método y ruta | Uso | Respuesta | Errores |
|---|---|---|---|
| `GET /api/devices` | Lista de la cuenta | `{devices: [{id, name, platform, appVersion, online, lastSeenAt, remote: {state, features}}]}` (`online` = contacto en los últimos 30 s) | — |
| `PUT /api/devices/{id}` | Alta o actualización del propio equipo (con `X-Device-Key`) | El equipo | `device_taken` 409, `device_key_invalid` 403, `device_invalid` 400 (con el campo) |
| `DELETE /api/devices/{id}` | Retirarlo (cerrar sesión, otra cuenta), con `X-Device-Key` | 204 | `device_not_found` 404, `device_key_invalid` 403 |
| `GET /api/devices/{id}/remote-requests` | Consulta del PC (señal de vida), con `X-Device-Key` | `{requests: [{id, controllerName, offer, createdAt}]}` (sin responder y sin caducar) | `device_not_found` 404, `device_key_invalid` 403, `too_many_requests` 429 |
| `POST /api/devices/{id}/remote-requests` | El controlador pide sesión con su oferta | 201 `{id, expiresAt}` | `device_not_found` 404, `device_offline` 409, `remote_disabled` 409, `remote_request_invalid` 400, `too_many_requests` 429 |
| `PUT /api/remote-requests/{id}/answer` | El PC responde `{answer}` o `{rejected: {reason, retryAfter?}}`, con `X-Device-Key` | 204 | `remote_request_not_found` 404, `remote_request_expired` 410, `remote_request_answered` 409, `remote_request_invalid` 400, `device_key_invalid` 403 |
| `GET /api/remote-requests/{id}` | El controlador espera la respuesta | `{status: pending\|answered\|rejected, answer?, rejection?}` | `remote_request_not_found` 404, `remote_request_expired` 410 |
| `GET /api/remote/ice-servers` | Servidores ICE | `{iceServers: [...], ttl}` | — |

- **Motivos de rechazo** que pone el PC: `wrong_password`, `locked`, `busy`, `missing_permissions`, `remote_disabled`, `declined`, `unsupported`. `wrong_password` llega por el canal de datos (D6). `locked` llega en la respuesta de la API, con `retryAfter`, cuando el PC ya estaba bloqueado (como pide D3). Por el canal de datos solo llega si se bloquea con una conexión ya abierta. El resto va en la respuesta de la API.
- **Límites** (`rate_limiter.yaml`, pool `app.rate_limiter_cache`):
  - `remote_request_user`: 20 por minuto;
  - `device_poll`: ventana de 1 s por equipo.
- **Caducidad:** las solicitudes caducadas se borran en cada alta y en cada consulta del PC. Como su identificador es un UUIDv7, que lleva la hora de creación, una consulta tardía recibe `remote_request_expired` aunque la fila ya no exista.
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
- **Cortafuegos de Windows:** la primera vez que la app abre WebRTC, Windows pregunta si la deja usar las redes públicas y privadas (prototipo 1.1). Si nadie responde o se cancela, las conexiones que inicia la app siguen funcionando (directas por STUN o por relé), pero se bloquean las entrantes de la red local. Para que el aviso no aparezca en un PC sin nadie delante, la app abre una conexión WebRTC local al **activar** el control remoto, cuando hay alguien en Ajustes, y explica qué responder. El instalador NSIS es por usuario y sin elevar, así que no puede añadir la regla.
- **Confirmación local:** una ventana propia (`confirmLocally()` en `hostNotice.ts`), siempre encima, con "Permitir", "Rechazar" y la cuenta atrás. A los 30 s se rechaza con `declined`.
  - Los botones responden cambiando el título de la página, así que no hace falta preload.
  - En macOS lleva `acceptFirstMouse`, para que el primer clic pulse el botón aunque la app no esté activa.
  - Antes era `dialog.showMessageBox` con `signal`, pero en macOS, sin ventana padre, ese diálogo es síncrono y no atiende `signal`. Bloqueaba el proceso principal (la consulta a la API y la negociación) y no se rechazaba nunca: lo destapó `lan-check` con el Mac como PC.
- **Mantener despierto:** `powerSaveBlocker.start('prevent-app-suspension')` mientras el control remoto está activado y la opción también.
  - **Windows:** `SetThreadExecutionState(ES_SYSTEM_REQUIRED)`.
  - **macOS:** aserción `PreventUserIdleSystemSleep`.
  - **Linux:** inhibición de logind o del salvapantallas, según el escritorio.
  - La pantalla sí puede apagarse: la entrada remota la despierta.

- **Hecho (tarea 4.8, bloque A: señalización y control de la sesión, en el proceso principal):**
  - **Piezas:**
    - `deviceApi.ts`: las cinco operaciones del equipo, con `X-Device-Key`. `apiRequest` admite ahora cabeceras propias.
    - `hostPolicy.ts`: reglas puras. El estado publicado da prioridad a `unsupported` sobre `disabled`, para que el controlador vea por qué. También dice qué se rechaza antes de abrir conexión (desactivado, sin permisos, bloqueado con `retryAfter`, ocupado) y cuándo se consulta: activado y en un sistema posible, también sin permisos, para que el controlador vea el motivo y no "sin conexión".
    - `hostAuth.ts`: `hello` y la verificación en el proceso principal (K no sale de él), con un solo intento por conexión.
    - `hostService.ts`: el bucle.
  - **Huella DTLS:** la del valor de la primera línea `a=fingerprint:` de cada descripción, sin espacios (`sdpFingerprint` en `src/shared/remote/auth.ts`). El controlador y la app móvil deben sacarla igual.
  - **Bucle:**
    - registra al arrancar, cada 5 min y cuando cambia lo que se publica (estado, nombre o funciones), y consulta cada 3 s;
    - sin red reintenta a los 3, 6, 12… s (máximo 60 s);
    - ante un `429` espera el `retryAfter`, y ante `remote_unavailable` (503), 5 min;
    - con `device_taken` o `device_key_invalid` genera una identidad nueva, y con `device_not_found` se vuelve a registrar.
  - **Sesiones:**
    - con una solicitud abriéndose o en curso, las demás reciben `busy`;
    - una conexión que no llega a autenticarse no cuenta como sesión: no notifica ni queda en el registro;
    - al empezar y al terminar hay notificación, entrada en el registro (con la duración) y estado en la bandeja;
    - desactivar, cambiar la contraseña, "Desconectar" o parar el servicio cortan la sesión;
    - si la solicitud caduca antes de responder, se cierra la conexión creada.
  - **Verificado:**
    - 25 tests unitarios;
    - `hostService.dev.test.ts` contra el backend de desarrollo real (4/4): el equipo aparece en línea con sus funciones, la solicitud recibe la respuesta, la segunda recibe `busy` (con `busy` publicado), sin permisos se rechaza con ese motivo, y desactivar corta la sesión y el servicio responde `remote_disabled`. Se salta sin `ABSOR_DEV_API`.
- **Hecho (tarea 4.8, bloque B: la conexión).**
  - **Piezas:**
    - `src/renderer/host.html` y `host/main.ts`, con su preload `src/preload/host.ts`, que solo expone los canales de la sesión y va con `sandbox`. Son entradas propias en `electron.vite.config.ts`.
    - `hostSession.ts`: la ventana, el IPC (solo atiende a ventanas `host`), la captura y la entrada.
    - `hostNotice.ts`: el aviso, la confirmación y las notificaciones.
    - `hostRuntime.ts`: monta el servicio con las piezas reales. `index.ts` lo arranca al iniciar y lo para al salir.
    - Los mensajes del canal `control` y el puente con la ventana están en `src/shared/remote/protocol.ts` y `hostBridge.ts`.
  - **Orden de una sesión:**
    1. El renderer responde a la oferta con los transceptores en `sendonly` y sin pista, y espera los candidatos.
    2. Al abrirse `control` envía `hello`, y `auth` va al proceso principal.
    3. Si sale bien (y se acepta en el PC, si se pide), captura con `getDisplayMedia` y pone las pistas con `replaceTrack`.
    4. Envía `features` y `displays`.
    5. `select-display` vuelve a capturar la pantalla nueva.
    6. Antes de autenticar, la entrada se descarta en el renderer y otra vez en el proceso principal.
  - **Captura:**
    - va en su propia partición (`remote-host`), con un `setDisplayMediaRequestHandler` que no da nada a una ventana que no esté autenticada;
    - en Electron 39 se deniega con `callback(null)`: `callback({})` lanza un error si se pidió vídeo;
    - la sesión se reconoce por el marco principal de su ventana (`processId` y `routingId`), porque `webContents.fromFrame` no la encontraba.
  - **X11 sin monitores RandR** (Xvnc, xrdp, y el Linux de pruebas, que tenía una pantalla virtual): `desktopCapturer.getSources` devuelve la lista vacía, pero el escritorio completo (`screen:-1:0`) sí se captura, y Electron ve entonces una sola pantalla que lo cubre todo. Se usa como último recurso. Con `thumbnailSize` de 0×0 tampoco hay fuentes.
  - **Límites de tiempo:** la respuesta en 15 s, la autenticación en 60 s y el inicio de la captura en 15 s; si no, se corta (en macOS sin permiso, `getDisplayMedia` se queda esperando).
  - **Aviso:** ventana sin marco, siempre encima (`screen-saver`), sin foco y con `setContentProtection`, con el título "Absor Connect — aviso". "Desconectar" cierra la ventana, y eso corta la sesión. No necesita preload.
  - **Cortafuegos de Windows:** `primeFirewall()` abre y cierra una conexión WebRTC local en una ventana `host` (modo `loopback`). Ajustes la llama al activar el control remoto (6.2).
  - **Corregido en la app:** con la app arrancada oculta y sin "Mantener abierta en segundo plano", cerrar la ventana `host` al terminar una sesión disparaba `window-all-closed` y cerraba la app. Ahora solo la termina cerrar la ventana principal.
  - **Verificado** con `prototypes/remote-desktop/controller-check` en un Linux X11, contra el backend de desarrollo. La app de verdad (`out/`) hace de PC controlado, arrancada con `--hidden` y su propia carpeta de datos. Pasa 12/12:
    - aparece en línea y disponible;
    - con una contraseña incorrecta llega `wrong_password` sin ninguna imagen, y el PC cierra;
    - con la correcta llega la imagen (3840×2160 a 11–17 fps con la pantalla casi quieta), además de `features` y `displays`;
    - el canal `pointer` lleva el ratón exactamente al centro pedido;
    - el aviso aparece y el PC se publica como `busy`, y otra solicitud recibe "ocupado";
    - un clic en "Desconectar" (con la propia entrada remota) corta la sesión con `bye:local`, y el PC vuelve a estar disponible;
    - la confirmación local sin respuesta da `declined` a los 33 s, sin imagen;
    - tras 5 fallos se rechaza con `locked` y 896 s restantes, aunque la contraseña sea correcta.
  - **Falta:**
    - el sonido en Linux (fuente virtual con `pactl`, D8), el portapapeles y los ficheros (tarea 6.3);
    - los ajustes y la llamada a `primeFirewall` (6.2);
    - en Windows y macOS: el sonido `loopback`, `setContentProtection`, el aviso del cortafuegos y la captura sin permiso en macOS;
    - la prueba con dos equipos y el visor (6.5).

### D8. Captura de pantalla y sonido por sistema
- **Windows:**
  - Pantalla con `desktopCapturer` (WGC/DXGI) y sonido con `audio: 'loopback'` en `setDisplayMediaRequestHandler`.
  - No se captura el escritorio seguro: bloqueo, UAC, Ctrl+Alt+Supr.
- **macOS:**
  - Pantalla con ScreenCaptureKit, que necesita el permiso de Grabación de pantalla (`systemPreferences.getMediaAccessStatus('screen')`). macOS 15 pide reconfirmarlo cada mes.
  - Sonido con `audio: 'loopback'`. Electron 39 usa la API CoreAudio Tap, disponible desde macOS 14.2, que exige `NSAudioCaptureUsageDescription` en el `Info.plist` (`extendInfo` de `electron-builder.yml`). Sin esa clave el audio llega en silencio y sin error. En versiones anteriores de macOS no hay sonido. Comprobado en macOS 27 (prototipo 1.2).
  - Sin el permiso de grabación, `getDisplayMedia()` no falla: se queda esperando. La app comprueba el permiso antes de capturar, y pone un tiempo máximo a la captura, para poder rechazar la sesión con `missing_permissions` en lugar de dejarla colgada.
- **Linux X11:**
  - Pantalla con `desktopCapturer` (X11).
  - Sonido: **`audio: 'loopback'` no sirve en Linux**. Crea la pista "System audio", pero llega vacía (nivel 0 en origen; prototipo 1.2). Chromium tampoco lista los monitores de PulseAudio/PipeWire en `enumerateDevices()`.
  - Lo que sí funciona: al empezar una sesión con sonido, el proceso principal crea una fuente virtual que reenvía el monitor de la salida por defecto (`pactl load-module module-remap-source master=<salida por defecto>.monitor source_name=absor_connect_audio source_properties=device.description="Absor Connect"`). El renderer `host` la abre con `getUserMedia({audio: {deviceId}})`, sin cancelación de eco, supresión de ruido ni control de ganancia. La fuente se quita al terminar la sesión, y también al arrancar si quedó alguna de una sesión anterior.
  - Si la salida por defecto cambia durante la sesión (por ejemplo, al conectar unos auriculares), la fuente se vuelve a crear.
  - Sin `pactl` (paquete `pulseaudio-utils`) o sin servidor compatible con PulseAudio, el sonido no está disponible.
  - **Implementación (`linuxAudio.ts`, tarea 4.8):**
    - La ventana `host` pide la fuente con `audioSource()` al capturar, y solo se crea con la sesión autenticada y el sonido permitido.
    - La salida por defecto se mira cada 3 s. Si cambia, la fuente se vuelve a crear, y la ventana reabre la pista y la cambia con `replaceTrack`.
    - Las operaciones con `pactl` van en serie, con `LC_ALL=C`; si no existe `get-default-sink`, la salida por defecto se lee de `pactl info`.
    - **Comillas:** la descripción va como `source_properties='device.description="Absor Connect"'`. Sin las comillas simples, el servidor la corta en el espacio ("Absor").
    - **Sin gestores de permisos en la partición `remote-host`:** `getDisplayMedia` también consulta el permiso `media` (con vídeo), y filtrarlo rompe la captura ("Permission denied"). Con el permiso por defecto, `enumerateDevices()` ya da las etiquetas sin abrir antes el micrófono.
    - **Volumen del monitor:** la fuente reenvía el monitor de la salida con el volumen del propio monitor. En el Linux de pruebas estaba al 8 % (−66 dB, puesto por algo anterior a la app), y el sonido llegaba en silencio aunque todo funcionara. Con el monitor al 100 % llega con el nivel del origen. La app no lo cambia (es un ajuste del usuario); ver Risks.
  - **Verificado:** 5 tests de `linuxAudio`, y `lan-check` en un solo Linux: 32/33. El PC pita a 0,15 y en el visor llega con pico 0,152; el botón silencia, y la fuente existe durante la sesión y desaparece al terminar.
  - **Verificado entre dos equipos** (el Mac controlando el Linux, `lan-test.sh … controlador`): el pitido del Linux llega al Mac con pico 0,152, el botón silencia, y la fuente desaparece al terminar.
- **Linux Wayland:** no se admite como PC controlado. Se detecta con `XDG_SESSION_TYPE=wayland` o `WAYLAND_DISPLAY`: manda `XDG_SESSION_TYPE`, que pone logind, y `WAYLAND_DISPLAY` solo cuenta si falta. La captura pasa por el portal, que pide aceptar cada vez, y XTest no actúa sobre las apps de Wayland.
- **Estado del equipo** (`src/main/remote/support.ts` y `platformSupport.ts`, tarea 4.7): `available`, `missing_permissions` (con los permisos que faltan) o `unsupported` (Wayland). Los estados `disabled` y `busy` los pone `hostService`.
  - **macOS:** `getMediaAccessStatus('screen')` e `isTrustedAccessibilityClient(false)`.
  - **Botones de Ajustes:** cada uno pide primero el permiso, que es lo que añade la app a la lista del panel (macOS muestra su aviso la primera vez), y después abre el panel con `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` o `Privacy_Accessibility`.
  - **`SupportMonitor`:** avisa con una notificación una vez por cada permiso que se pierde. No repite el aviso mientras siga faltando, y vuelve a avisar si se recupera y se pierde otra vez. Ajustes lo consulta en modo silencioso.
  - **Cuándo se consulta:** lo hace `hostService` (tarea 4.8) al registrar el equipo y con cada solicitud de sesión, y un cambio de estado vuelve a registrar el equipo.
  - **Verificado** con `input-check --mode=support` (tarea 4.7):
    - **Linux X11:** `available` con la sesión real, y `unsupported` (`wayland`) lanzado con el entorno de una sesión Wayland.
    - **macOS 27.0.1, lanzado desde Terminal:** con los dos permisos sale `available`, y sin Grabación de pantalla, `missing_permissions` con `screen`. Los dos casos coinciden con Ajustes del Sistema. Los dos botones abren su panel en macOS 27 (las URL `com.apple.preference.security` siguen valiendo) y la notificación llega.

### D9. Protocolo de los canales de datos (v1)
| Canal | Modo | Contenido |
|---|---|---|
| `control` | fiable y ordenado, JSON | `hello`, `auth`, `auth-result`, `displays`, `select-display`, `features`, `clipboard` (en trozos), `bye` |
| `input` | fiable y ordenado, JSON | `key {code, down}`, `button {button, down}`, `wheel {dx, dy, mode}`, `text {text}`, `release-all`, y `move {x, y}` con la posición de cada clic y la de reposo |
| `pointer` | sin orden, `maxRetransmits: 0` | `move {x, y}` normalizados (0–1) sobre la pantalla elegida; solo importa el último. La posición de cada clic, y la última cuando el ratón lleva 120 ms quieto, van además por `input` (fiable y en orden con los botones), porque por `pointer` un paquete perdido dejaba el cursor en otro sitio y el clic podía caer donde no era |
| `file` | fiable y ordenado, JSON y binario | Los mensajes de ficheros y carpetas (`file-*`, `fs-list`, `fs-entries`) y los trozos de hasta 64 KB con 4 bytes delante (el id de la transferencia), con control de presión (`bufferedAmountLowThreshold` 1 MB). Todo por el mismo canal, para que `file-end` no adelante a los últimos trozos |

- **Robustez:** los mensajes llevan `v`, y los tipos desconocidos se ignoran.
- **Entrada** (`src/shared/remote/input.ts`): `{v: 1, type, …}`, con `button` como el número de `MouseEvent.button` (0 izquierdo, 1 central, 2 derecho, 3 atrás, 4 adelante) y `mode` como `WheelEvent.deltaMode`. El PC vuelve a validar cada mensaje en el proceso principal con `parseInputEvent()`, porque el renderer `host` no es de fiar.
- **Antes de autenticar** el PC solo procesa `auth` y descarta lo demás.
- **Teclas pegadas:** al cerrarse la sesión o el canal, el PC suelta todas las teclas y botones pulsados. El visor envía `release-all` al perder el foco.
- **Pantallas:** `displays` lleva `[{id, name, bounds, scaleFactor, primary}]`.
- **Portapapeles** (`clipboardSync.ts`, en el PC y en el visor):
  - Se mira cada segundo con una huella barata (el texto con su SHA-256; de una imagen, una muestra del mapa de bits), y una imagen solo se codifica en PNG cuando cambia.
  - Lo que ya estaba copiado al empezar no se envía, y lo que llega del otro equipo no se reenvía.
  - Texto de hasta 1 MB e imagen PNG de hasta 10 MB, en trozos de 60 000 caracteres (`clipboard {id, kind, index, count, data}`): un mensaje de WebRTC no puede pasar de 256 KB.
  - En pausa no se envía ni se recibe nada.
- **Ficheros** (protocolo en `src/shared/remote/transfer.ts`; los ids los elige siempre el controlador):
  - **Envío al PC:** `file-offer {id, name, size}` → `file-accept` o `file-reject {reason}` → trozos → `file-end {sha256}` → `file-done {name}` o `file-error {reason}`.
    - El PC escribe un `.part` en `Descargas/Absor Connect`, comprueba tamaño y SHA-256, y lo lleva a un nombre libre sin sobrescribir nunca: "informe (1).pdf". Usa un enlace duro, que falla si el nombre existe; donde no se puede, comprueba y renombra.
    - Los nombres se limpian para cualquier sistema: sin carpetas, caracteres prohibidos ni nombres reservados de Windows.
  - **Descarga:** `fs-list {id, path}` → `fs-entries` con carpetas primero y orden natural (en Windows, también "Este equipo" con las unidades), y `file-request {id, path}` → `file-start {name, size}` → trozos → `file-end {sha256}`. El visor guarda por el proceso principal (diálogo de guardar), que comprueba el resumen.
  - **Los dos sentidos** admiten `file-cancel`, que borra el `.part`. Al perder la conexión, lo que estaba en marcha falla (no se reanuda).
  - **SHA-256 por partes** (`sha256.ts`): el visor resume lo que envía mientras lo lee, sin cargarlo en memoria (WebCrypto solo resume bloques enteros).
  - **El PC lo vuelve a comprobar todo** en el proceso principal: sesión autenticada y función permitida en Ajustes. La ventana `host` descarta lo que llega antes de autenticar.

### D10. Inyección de entrada con `koffi`
`koffi` es una FFI con binarios N-API precompilados (Windows, macOS y Linux; x64 y arm64). Funciona en Electron sin recompilar y `npm ci` no compila nada (prototipo 1.3).
- **Binarios por plataforma:** desde la versión 3 van en paquetes opcionales `@koromix/koffi-<so>-<arch>`, y npm solo instala el del sistema donde corre. El job de macOS de `release.yml` (runner arm64) empaqueta también x64, así que debe instalar `@koromix/koffi-darwin-x64` (sin guardarlo) antes de empaquetar.
- **Empaquetado:** `asarUnpack` de `**/node_modules/koffi/**` y `**/node_modules/@koromix/**`.

Las teclas viajan como `KeyboardEvent.code`, es decir, por posición física. Una tabla compartida (`src/shared/remote/keymap.ts`) las traduce al código de cada sistema, con datos de `dom_code_data.inc` de Chromium (licencia BSD, con su atribución). Así manda la distribución del PC controlado, como en Chrome Remote Desktop.

- **Windows (`user32.dll`):**
  - `SendInput`. Ratón con `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`, normalizado a 0–65535 sobre el escritorio virtual (`GetSystemMetrics`).
  - La coordenada absoluta se redondea hacia arriba (`ceil(píxel × 65536 / ancho)`): Windows la vuelve a convertir con `floor`, y con `/ (ancho − 1)` el clic caía un píxel antes.
  - Teclas con `KEYEVENTF_SCANCODE` (y `EXTENDEDKEY` donde toca). Pausa va por su tecla virtual (`VK_PAUSE`), porque su scancode 0x45 es el de Bloq Num. Texto con `KEYEVENTF_UNICODE` por unidad UTF-16.
  - SendInput no repite las teclas pulsadas: la repetición la manda el controlador. Si varias repeticiones llegan a la vez, Windows las junta en un solo `WM_KEYDOWN` y sale una sola letra.
  - Límite: UIPI impide actuar sobre ventanas elevadas.
- **macOS (CoreGraphics):**
  - `CGEventCreateMouseEvent` (con `kCGMouseEventClickState` para el doble clic, que hay que contar: 500 ms y 4 puntos), `CGEventCreateKeyboardEvent` con códigos `kVK_*`, `CGEventKeyboardSetUnicodeString` para el texto (trozos de 20 unidades UTF-16) y `CGEventCreateScrollWheelEvent` (variádica, que koffi admite).
  - Con un botón pulsado, el movimiento va como evento de arrastre (`kCGEventLeftMouseDragged`…): si no, las apps no ven el arrastre.
  - Cada evento lleva las marcas de los modificadores pulsados (`CGEventSetFlags`): los eventos inyectados no las heredan, y sin ellas Cmd+C llegaría como una "c".
  - Todo con `CGEventPost(kCGHIDEventTap)`, en puntos globales (los mismos que los DIP de Electron).
  - Requiere el permiso de Accesibilidad (`systemPreferences.isTrustedAccessibilityClient(false)`).
- **Linux X11 (`libXtst`, `libX11`):**
  - `XTestFakeMotionEvent`, `XTestFakeButtonEvent` (1–3, atrás y adelante 8–9, y rueda 4–7) y `XTestFakeKeyEvent` con el código evdev + 8. Un keycode fuera de `XDisplayKeycodes` se descarta, porque un error de X con el gestor por defecto de Xlib termina el proceso.
  - X repite las teclas pulsadas con XTest: mientras están pulsadas se les quita la repetición (`XChangeKeyboardControl`), y la manda el controlador, como en Chrome Remote Desktop. Así un retraso de la red al soltar no escribe cientos de letras.
  - **Texto:** cada carácter se escribe con un keycode libre reasignado a su keysym (Latin-1 con su valor y el resto `0x01000000 + cp`) en los dos niveles, como hace xdotool. Se hace también con los caracteres que ya están en el mapa, para no depender del grupo activo (p. ej. "us,es"), de Bloq Mayús ni de un Mayús pulsado. Detalles (`scratchKeys.ts` y `x11.ts`):
    - Se reasignan de una vez los keycodes de todo el texto que cabe (hasta 10) y se esperan 50 ms antes de pulsar. Chromium pide el mapa nuevo de forma asíncrona, y sin la espera perdía el primer carácter.
    - Un keycode no pasa a otro carácter hasta 300 ms después de usarlo, y los caracteres repetidos reutilizan el suyo.
    - 5 ms entre caracteres: con IBus, las pulsaciones seguidas se desordenan (medido: el "€" de "¿Año 2026? €" se adelantaba en 5 de 8 intentos sin pausa y en ninguno con 1 ms).
    - Los keycodes vuelven a NoSymbol tras 2 s sin escribir y al terminar la sesión.
  - Las coordenadas van en píxeles físicos: `bounds × scaleFactor`, la misma escala para todas las pantallas en X11.
  - `screen.getCursorScreenPoint()` devuelve una posición antigua cuando el puntero lo mueve otro proceso. Para leer la posición real se usa `XQueryPointer` (prototipo 1.3).
- **Conversión común** (`src/main/remote/input/`): `(x, y)` normalizados × el rectángulo nativo de la pantalla elegida (`nativeDisplayRect`), recortado al último píxel de esa pantalla. En Windows el rectángulo físico lo da `screen.dipToScreenRect`, también con escalas distintas por monitor, y en macOS son los `bounds` en puntos.
- **Rueda:** los deltas de `WheelEvent` se pasan a píxeles (un clic de rueda son 100 px, o 3 líneas) y se acumulan hasta completar la unidad de cada sistema: clics de rueda en X11, 1/120 de clic en Windows y píxeles en macOS.
- **Teclas pegadas:** `InputController` lleva la cuenta de las teclas y botones pulsados, aplica los eventos en fila (el texto puede esperar en X11) y lo suelta todo con `release-all` o al terminar la sesión.
- **Alternativas:**
  - `nut.js`: escribe el texto según la distribución local y es una dependencia grande.
  - `robotjs`: sin mantenimiento y con compilación nativa.
  - Binarios auxiliares por SO: más piezas que firmar y empaquetar.
- **Verificado (tarea 4.6)** con `prototypes/remote-desktop/input-check` (14 comprobaciones; ver su README):
  - **Linux X11 (Cinnamon, una pantalla 4K al 100 %, distribuciones us(intl) y es, IBus):** 14/14.
    - Clics en las esquinas del área de trabajo y en el centro con menos de 0,5 DIP de error. Son las del área de trabajo porque el panel de Cinnamon sigue encima de una ventana a pantalla completa.
    - `Semicolon` da ";" con us(intl): la tecla va por posición. La Ñ se comprueba en Windows, porque Cinnamon vuelve a la distribución de la ventana activa y la prueba no puede cambiarla.
    - "¿Año 2026? €", Mayús, salto de línea, sin repetición del sistema con la tecla mantenida, repetición del controlador, `release-all`, Ctrl+A y Ctrl+C, doble clic, botones derecho, central, atrás y adelante, arrastre, y rueda vertical y horizontal.
  - **Windows 11 (VM, teclado es-ES):** 14/14 al 100 % (1280×800) y al 150 % (854×534 DIP, menos de 0,7 DIP de error), con "ñ" y "¿Año 2026? €" exactos.
  - **macOS 27.0.1 (MacBook Pro con Apple Silicon, Retina al 200 %, Español - ISO):** 14/14 con `test-mac.sh`, lanzado desde Terminal con el permiso de Accesibilidad.
    - Clics con menos de 0,9 DIP de error, y "ñ" y "¿Año 2026? €" exactos.
    - Cmd+A y Cmd+C funcionan (las marcas de los modificadores), y también el doble clic (`kCGMouseEventClickState`) y el arrastre (eventos de arrastre).
    - Con el desplazamiento natural activado, la rueda inyectada no se invierte: un `dy` positivo baja, igual que con él desactivado.
  - **Queda para la matriz de la 9.3:** un PC con dos monitores de escalas distintas. La VM, este Linux y el Mac tienen una sola pantalla; la escala de cada monitor sale de `dipToScreenRect` (Windows) o de `bounds` (macOS), y X11 tiene una sola escala.
  - **Node 26:** el postinstall de Electron 39 no deja el binario (extract-zip 2.0.1 se corta tras la primera carpeta y sale con código 0). `test-mac.sh` lo instala por su cuenta; afecta igual a `npm ci` del repo con Node 26, así que el desarrollo sigue en Node 22.

### D11. Ventana del visor (escritorio)
- **Apertura:** nueva entrada `viewer.html` en `electron.vite.config.ts` (varias entradas de renderer). El proceso principal la abre con el `deviceId`.
- **Seguridad de la ventana:** `contextIsolation`, `sandbox` y preload con solo los canales `remote-*`. La negociación pasa por IPC al proceso principal, que comprueba que quien llama es una ventana de visor.
- **Páginas y preloads (tareas 5.1 y 6.1):**
  - Tres entradas en `electron.vite.config.ts` (`index`, `host` y `viewer`), cada una con su página y su preload.
  - Los tipos de los puentes de `host` y del visor van en `host.d.ts` y `viewer.d.ts`, junto a `index.d.ts`, en lugar de dentro de él: cada página solo ve el suyo.
  - **Verificado** con `prototypes/remote-desktop/dev-check` (10/10) en Linux X11: la app en modo desarrollo (`electron-vite dev`, lo que lanza `npm run dev`) hace de PC, y la compilada de controlador.
    - `npm run build` deja las tres páginas y los tres preloads.
    - En desarrollo, la ventana principal, el visor y la ventana `host` de una sesión de verdad salen del servidor de Vite.
    - Cada ventana tiene solo su puente: la principal, `window.api`; el visor, `absorViewer` (12 funciones); la ventana `host`, `absorHost` (24). El visor y la ventana `host` no tienen `require` ni `process`.
- **Atajos y teclado:**
  - Las ventanas de visor quedan fuera de `optimizer.watchWindowShortcuts`, para que Ctrl+R o F12 lleguen al PC remoto.
  - En pantalla completa se usa `navigator.keyboard.lock()`. En Windows y Linux captura Alt+Tab y la tecla Windows; en macOS, Cmd+Tab no se puede capturar y se ofrece en el menú de combinaciones.
- **Ratón:** coordenadas del elemento → normalizadas, descontando las bandas del ajuste. Sin bloqueo del puntero (modo absoluto).
- **Estado:** `getStats()` da el par de candidatos activo (`relay` frente a `host`/`srflx`), el `roundTripTime` y `framesPerSecond`.
- **Ficheros y portapapeles** (`transfers.ts` y `filesUi.ts`, tareas 6.3 y 6.5):
  - en la barra: "Portapapeles: activo / en pausa", "Enviar ficheros" y "Descargar del equipo", solo si el PC lo permite;
  - los ficheros se envían soltándolos sobre la ventana o con el botón, en cola, y se leen con `File.stream()`;
  - "Descargar del equipo" abre un explorador de las carpetas del PC, con la ruta editable y "Carpeta superior";
  - una lista de transferencias muestra el progreso, permite cancelar y enseña el resultado ("En el PC como «…»", o "Mostrar" en la carpeta) o el motivo del fallo.
- **Relé en el estado:** a través de un relé, Chromium puede elegir un candidato `prflx` aprendido por el TURN. Por eso también cuenta como relé un candidato local con `relayProtocol`; si no, el visor decía "Directa".
- **Para las pruebas:** `ABSOR_CONNECT_FORCE_RELAY=1` obliga a ir solo por relé (`iceTransportPolicy: 'relay'`), y `ABSOR_CONNECT_SAVE_DIR` guarda las descargas sin diálogo.

- **Hecho (tareas 4.9, 6.4 y la base de la 6.5).**
  - **Proceso principal (`controllerRuntime.ts`):**
    - la ventana principal tiene `remote-devices`, que lista los equipos y marca el propio con `ownDeviceId`, y `remote-open-viewer`, que abre una ventana por PC (si ya está abierta, la enfoca);
    - las ventanas de visor tienen `remote-viewer:*`: `init`, ICE, crear la solicitud y consultarla, con los errores convertidos en códigos;
    - esos canales solo atienden a las ventanas de visor registradas, y el token no sale del proceso principal;
    - las ventanas de visor quedan fuera de `watchWindowShortcuts`: se comprueba en el siguiente ciclo, porque `browser-window-created` llega antes de registrarlas.
  - **Visor (`src/renderer/viewer/`, sin React, con sus textos `es`/`en`):**
    - pide la contraseña y explica cada fallo con su mensaje;
    - imagen ajustada o a tamaño real con desplazamiento, y pantalla completa con `keyboard.lock()`;
    - ratón, rueda y teclado por `code`, con las posiciones normalizadas descontando las bandas y un movimiento por fotograma como mucho;
    - `release-all` al perder el foco y menú de combinaciones;
    - selector de pantallas, silencio del sonido y estado (directa o relé, latencia y fps con `getStats`);
    - reconexión con K durante 30 s cuando la conexión falla o sigue desconectada 5 s. Mientras dura, se muestra "Reconectando".
  - **Equipos (`DevicesPanel`):** un panel como el de Ajustes, con cada PC, su sistema y su estado. Se actualiza cada 5 s mientras está abierto, marca el propio PC y solo deja conectar a los disponibles.
  - **Cambios en el PC controlado** para que la reconexión funcione:
    - la ventana `host` termina la sesión tras 5 s desconectada, y no 30, porque si no la nueva negociación recibía "ocupado";
    - si el renderer de la sesión muere (`render-process-gone`) o deja de dar su latido cada 2 s durante 10 s, se cierra la sesión. Tras un `Page.crash`, Chromium tardó más de un minuto en dar el renderer por perdido, y mientras tanto el PC seguía "ocupado".
  - **Verificado** con `prototypes/remote-desktop/viewer-check`: dos instancias de la app en un Linux X11 (A oculta como PC, B como controlador, manejada por DevTools como una persona) y el backend de desarrollo. Pasa 12/12:
    - Equipos muestra A disponible y B como "este equipo";
    - el token no aparece en ninguna respuesta a la ventana principal ni al visor, y el visor no tiene `window.api`;
    - el título es el nombre del PC;
    - una contraseña incorrecta da su mensaje;
    - con la correcta, la sesión se abre en 1,5 s con 3840×2160 y "Directa · 1 ms · 30 fps", y sin selector con una sola pantalla;
    - el ratón llega exacto al 10 % / 10 %;
    - tras un `Page.crash` del renderer de A, el PC vuelve a estar disponible a los 9 s y el visor reconecta solo a los 17 s, sin pedir la contraseña;
    - Desconectar cierra la ventana y deja el PC disponible.
  - **Corregido con `lan-check`:** cuando el PC cambiaba la contraseña, el visor conservaba K y "Reconectar" fallaba con "Contraseña incorrecta.", que además cuenta para el bloqueo. Ahora un `bye` con `password_changed` borra K y el visor pide la contraseña nueva.
  - **Prueba entre dos equipos (`prototypes/remote-desktop/lan-check`):** un equipo hace de PC (`pc.ts`) y el otro de controlador (`controller.ts`), y el controlador comprueba lo que pasa en el PC con una sonda HTTP del propio PC. Cubre los escenarios de la 4.8 (una sesión a la vez, aviso y corte, confirmación local, mantener despierto) y de la 6.5 (ratón, teclado, rueda, pantallas, pantalla completa, sonido, corte de red de 10 s). En macOS, `lan-test.sh` hace las dos fases seguidas.
    - **Ensayo en un solo Linux X11** (los dos papeles en el mismo equipo, como `viewer-check`): 29/32. Las tres sin probar son las esperadas: el sonido de un PC Linux (aún sin `pactl`), el corte de la red (solo desde el Mac) y pulsar "Permitir" (no hay nadie delante).
    - **Comprobado:** la bandeja dice "Controlado ahora desde …", el segundo controlador recibe `busy`, y el ratón cae exacto al 10 % y al 90 %. El clic, el texto por posición física, Mayúsculas, Retroceso y la rueda llegan a la ventana de prueba. Pantalla completa funciona. "Evitar que el PC se suspenda" añade su inhibidor al gestor de sesión y lo quita. "Desconectar" en el aviso, desactivar y cambiar la contraseña cortan la sesión con su mensaje. Sin respuesta, la confirmación local rechaza a los 33 s. El registro anota las sesiones y el intento fallido.
    - **Mac controlando el Linux** (macOS 27.0.1 arm64 → Linux Mint X11 a 3840×2160, por la Wi-Fi de casa, `lan-test.sh` fase 2): 28/30, y las dos sin probar son el sonido de un PC Linux y pulsar "Permitir".
      - Conecta en 2,4 s con la imagen a 3840×2160, "Directa · 7 ms · 30 fps" en reposo y unos 19 fps mientras se escribe.
      - **Corte real de la Wi-Fi del Mac durante 10 s:** a los 11 s el visor muestra "Reconectando…", y a los 22 s la sesión vuelve sola, sin pedir la contraseña ("Directa · 5 ms · 22 fps").
      - Todo lo del ensayo se repite igual entre los dos equipos: aviso y bandeja con "Controlador macOS de prueba", `busy`, ratón exacto, clic, teclado, rueda, pantalla completa, inhibidor de suspensión, los tres cortes desde el PC, rechazo por falta de respuesta a los 34 s y registro.
      - Con la distribución de teclado del Linux, la tecla a la derecha de la L da ";". El texto llega por posición física, como debe.
    - **Linux controlando el Mac** (`lan-test.sh … pc`; Mac 1512×982 a 2×, por Wi-Fi): 26/32.
      - **Permiso:** Terminal tenía el permiso de Grabación de pantalla caducado. En Ajustes aparecía activado, pero `getMediaAccessStatus('screen')` daba `denied` incluso en el proceso de la prueba. Se arregló con `tccutil reset ScreenCapture com.apple.Terminal` y concediéndolo otra vez, y ahora la prueba lo pide a macOS y espera.
      - **Bien:**
        - conecta en 6,4 s, con 3024×1964 y "Directa · 7 ms";
        - con la pantalla quieta, ScreenCaptureKit solo manda 1 fps, y unos 7 fps mientras se escribe;
        - aviso, `busy`, el ratón al 90 %, clic, "hola ñ 2026A" con la distribución española, rueda, pantalla completa;
        - el sonido llega y se silencia;
        - los tres cortes desde el PC y el registro.
      - **Fallos de la app, corregidos:**
        - **La confirmación local bloqueaba la app en macOS** (ver D7). El PC se quedaba sin conexión ("La red no permite conectar…" a los 48 s, y luego "El PC no está conectado").
        - **El movimiento al 10 % no llegó:** el cursor siguió donde estaba, por un único `move` por el canal sin reenvío, en Wi-Fi. Ahora la posición de reposo y la de cada clic van también por `input` (D9).
      - **Fallos de la prueba, corregidos:** el bloqueo de suspensión de macOS es una aserción `NoIdleSleepAssertion`, que la prueba no buscaba. Leer el menú de la barra de menús con `osascript` falló sin dejar ver el error; ahora se guarda.
      - **Ensayo en un solo Linux con las correcciones: 30/32** (las dos sin probar, las de siempre). La pregunta sale en el PC sin bloquear nada, se rechaza sola a los 33 s, y «Permitir», pulsado por DevTools, conecta.
      - **Repetido en el Mac con las correcciones: 30/32.**
        - el ratón al 10 % llega exacto (150,97 frente a 151,98);
        - la pregunta sale sin bloquear la app, se rechaza sola a los 33 s, y al pulsar «Permitir» (una persona, en el Mac) conecta;
        - "Evitar que el PC se suspenda" añade su `NoIdleSleepAssertion` y la quita. Chromium tiene otra propia, "WebRTC has active PeerConnections", mientras hay conexión;
        - conecta en 2,4 s.
        - **Sin probar:** el corte de la red (solo se hace con el Mac de controlador, y ya pasó en la fase 2) y el menú de la barra de menús. Ahí `osascript` se quedó colgado hasta el límite de 20 s con la app sin empaquetar ("Electron"). El estado "Controlado ahora desde…" sí se vio a mano en la barra de menús.
    - **Mac controlando el Linux, con el sonido de Linux ya hecho: 31/33.**
      - el pitido del Linux llega (pico 0,152);
      - el corte de Wi-Fi se recupera solo a los 19 s;
      - «Permitir», pulsado por DevTools en el Linux, conecta;
      - todo lo demás, igual que antes.
      - **Sin probar:** la bandeja. El Linux se había quedado sin sesión de escritorio: al reiniciar Cinnamon desde el modo de emergencia, arrancó sin ver ningún monitor (`primaryMonitor is undefined`, con la pantalla en reposo) y se cerró.
      - **Fallo de la prueba, no de la app:** salir de la pantalla completa en el Mac. La pantalla completa de macOS es la nativa, en su propio Escritorio. Si la prueba la abre sin que la app esté activa, macOS no completa la salida, y `exitFullscreen()` no termina (en la primera ejecución sí salió). Una persona siempre la usa con la app delante. La prueba ahora activa la app con `osascript` antes (como Cmd+Tab); falta verlo en la próxima ejecución desde el Mac.
    - **Las dos direcciones entre equipos distintos están probadas.** Con el sonido de Linux (D8), la 4.8 queda completa. De la 6.5 faltan portapapeles, ficheros y relé. Windows no ha entrado en `lan-check`.
  - **Ficheros, portapapeles, relé y el resto de escenarios del visor (`lan-check`, tareas 6.3 y 6.5)**, entre el Mac y el Linux en los dos sentidos:
    - **Ficheros:**
      - dos ficheros con el botón llegan íntegros a `Descargas/Absor Connect`;
      - el mismo fichero soltado sobre la ventana (por DevTools, `Input.dispatchDragEvent`) se guarda como "… (1).bin" sin tocar el primero;
      - cancelar un envío de 400 MB a medias no deja nada en el PC;
      - la descarga desde el explorador llega íntegra.
    - **Portapapeles:** texto en los dos sentidos ("ñ€", "¿ñ?") e imagen de 64×48. En pausa, una imagen copiada en un lado no cambia el otro, en ninguno de los dos sentidos.
    - **Relé:** con un coturn local y el controlador obligado a usar el relé, la sesión entre el Linux y el Mac va "Por relé · 4 ms" (candidato local `relay`, remoto el host del Mac), y los ficheros y el portapapeles también pasan.
    - **Dos PCs a la vez:** con el Mac abierto, el Linux abre otra sesión con su propio PC. Lo escrito en la primera ventana solo llega al Mac, y cerrar la segunda no corta la primera.
    - **Más del visor:** tamaño real a 1:1 con desplazamiento; "Win / Cmd" del menú de combinaciones llega al PC; con Ctrl pulsado, al perder el foco el PC lo suelta; y tras 5 contraseñas incorrectas, el sexto intento dice "Demasiados intentos fallidos. El PC no acepta conexiones durante 15 min.".
    - **Ensayo en un solo Linux:** 40/43; las tres sin probar necesitan dos equipos o un escritorio con bandeja.
  - **Falta (resto de la 6.5):**
    - el selector con varias pantallas: el Linux tiene ahora todas las salidas de vídeo desconectadas, y el Mac solo su pantalla. Se intentó simular con dos monitores RandR virtuales (`xrandr --setmonitor … none`), pero no sirve: `desktopCapturer` da una fuente por monitor (sin `display_id`), mientras que `screen.getAllDisplays()`, que es lo que usa el selector, sigue viendo una sola pantalla. Xephyr ignora esos monitores. Hace falta un equipo con dos monitores de verdad;
  - **Salir de la pantalla completa en macOS, a mano** (`lan-check/fullscreen-mac.sh`, 4/4 en macOS 27.0.1, controlando el Linux):
    - se sale con el botón verde de la ventana, con el botón de la barra del visor y con Esc;
    - las tres veces el visor vuelve a 1280×800, enfocado y con imagen (siguen llegando fotogramas), y la persona confirma que vuelve a su Escritorio. Comentario: "Todo perfecto".
  - **Alt+Tab en pantalla completa y controlador en Wayland** (`fullscreen-check`, 11/11 en un solo Linux). El PC va en Xephyr `:77`, para que lo que inyecta no vuelva al visor.
    - **Alt+Tab y la tecla Windows**, con metacity como gestor de ventanas (la shell de Cinnamon estaba caída) y las teclas pulsadas de verdad con XTest:
      - con la ventana normal, del visor solo sale `AltLeft↓` y `release-all`: Tab se lo queda el gestor;
      - en pantalla completa salen `AltLeft↓ Tab↓ Tab↑ AltLeft↑` y `MetaLeft↓ MetaLeft↑`, y el visor sigue en pantalla completa y enfocado;
      - al salir de la pantalla completa, Alt+Tab vuelve a ser del gestor.
    - **Controlador en Wayland** (`muffin --wayland --nested`, `--ozone-platform=wayland`):
      - llega la imagen ("Directa · 0 ms · 30 fps");
      - el ratón al 25 % de la imagen cae en (800, 298) del PC, frente a (800, 300) esperado;
      - las teclas van por posición (`KeyA`);
      - la pantalla completa entra y sale.

### D12. App móvil
- **WebRTC:** `flutter_webrtc` (`RTCPeerConnection`, `RTCVideoView`, canales de datos). Mismo protocolo (D9).
- **PBKDF2:** paquete `cryptography`, en un isolate. Las iteraciones vienen en `hello`, así que se pueden ajustar sin cambiar el protocolo. En el escritorio, 600 000 iteraciones tardan unos 58 ms tanto en WebCrypto como en Node (prototipo 1.4, Ryzen con Linux); falta medir los móviles.
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
- **En desarrollo:** el servicio `turn` de `compose.override.yaml` (perfil `turn`, apagado por defecto) arranca coturn 4.6.3 con la IP de la red local en `TURN_RELAY_IP`. `TURN_URLS` y `TURN_SECRET` van en `backend/.env.local`, que no está en git; tras cambiarlos hay que reiniciar `php`, porque el worker de FrankenPHP no relee el entorno. Así se probó el relé entre dos equipos (6.5).

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
- **Salir de la cuenta (tarea 4.10):**
  - **Los tres casos pasan por el mismo sitio:** cerrar sesión, la sesión caducada o revocada (un 401) y la cuenta borrada. `account.ts` avisa con `setAccountExitHandler` antes de olvidar el token. `index.ts` cierra los visores (`closeAllViewers`; cada uno se despide del PC al cerrarse) y llama a `signOutRemoteHost`.
  - **`HostService.suspend()`:**
    - corta la sesión en curso con `signed_out`, y el visor dice "El PC ha cerrado la sesión de la cuenta.";
    - espera a la vuelta que esté en marcha y cierra la conexión que se haya abierto en ella;
    - deja de registrarse y de consultar hasta `resume()`, que se llama al iniciar sesión.
  - **Dar de baja el equipo al cerrar sesión:** el `DELETE` usa el token que había y va antes de revocarlo. Las dos cosas siguen en segundo plano, sin hacer esperar a la interfaz. Esperar a la vuelta en marcha evita que una vuelta atrasada vuelva a registrar el equipo.
  - **Sesión caducada:** ya no hay token válido para el `DELETE`, así que el PC deja de estar en línea a los 30 s sin consultas. Si la ventana principal está cerrada u oculta y el control remoto estaba activado, sale la notificación "La sesión de la cuenta ha caducado…", que abre la ventana.
  - **Cuenta borrada:** el servicio ya borró sus equipos (tarea 2.5).
  - **Tests:** dos unitarios de `suspend()`/`resume()` y uno contra el backend de desarrollo: tras el `DELETE`, ninguna vuelta vuelve a registrar el equipo, y `resume()` lo vuelve a publicar.
  - **Verificado** con `prototypes/remote-desktop/exit-check`, fases 1 a 3: dos instancias de la app en un Linux X11 con el backend de desarrollo, manejadas por DevTools. Se usó un escritorio mínimo (`desktop-stub.py`) porque la shell de Cinnamon estaba caída y no había ni bandeja ni servicio de notificaciones.
    - **A cierra sesión en Ajustes mientras B lo controla:**
      - el visor de B dice que el PC ha cerrado la sesión de la cuenta;
      - A vuelve a la pantalla de acceso, sin la ventana de la sesión, y su bandeja pasa de "Controlado ahora desde…" a "Control remoto: desactivado";
      - A desaparece de la cuenta y 8 s después sigue sin aparecer;
      - al volver a entrar en A, vuelve a estar disponible.
    - **B cierra sesión con el visor abierto:** el visor se cierra, y A vuelve a estar disponible en la cuenta y en su bandeja.
    - **Se revoca el token de A** con A en la bandeja, sin ventana, y B conectado:
      - el visor de B dice que el PC ha cerrado la sesión de la cuenta;
      - A muestra la notificación;
      - en la cuenta, A pasa a "sin conexión" a los pocos segundos;
      - la app sigue en marcha, con "Control remoto: desactivado".
    - El código no depende del sistema: no se ha repetido en Windows ni en macOS, y entra en la matriz de la 9.3.
- **Verificado (tareas 4.1 y 4.2):**
  - **Linux X11 (Cinnamon):** la ventana aparece, el icono de la bandeja se registra en el `StatusNotifierWatcher` (y desaparece al salir), cerrar la ventana con "Mantener abierta en segundo plano" la oculta sin terminar la app, la segunda instancia reabre la ventana, y el `.desktop` de autostart se escribe (con `--hidden`) y se borra según el ajuste. El arranque `--hidden` no abre ventana.
  - **Windows 11:** la ventana aparece, cerrar-a-bandeja la oculta y deja los procesos vivos, y la segunda instancia reabre la misma instancia (mismo PID), con la interfaz en el idioma guardado.
  - **Linux sin bandeja:** en un servidor X anidado (Xephyr) con un bus de sesión sin `StatusNotifierWatcher`, la app arranca oculta sin fallar, y abrirla otra vez muestra la ventana de la primera instancia: la segunda termina con 0 y no queda un segundo proceso.
  - **macOS, corregido antes de probarlo:** el icono del Dock no seguía a la ventana. El arranque oculto no lo escondía, y `showMainWindow()` no lo recuperaba al reabrir una ventana cerrada a la bandeja, porque `ready-to-show` no se repite. Ahora se esconde al arrancar oculta (`hideDockForHiddenStart()`) y vuelve al mostrar la ventana.
  - **macOS 13 y posteriores:** `args: ['--hidden']` del elemento de inicio solo se usa en Windows, así que el arranque oculto depende de `wasOpenedAtLogin`. Comprobado con `test-mac.sh background-login` después de cerrar y abrir sesión en macOS 27.0.1: la app arranca sola sin argumentos, y `wasOpenedAtLogin` la deja oculta (sin ventana ni Dock, con el icono de la barra de menús). No hace falta un LaunchAgent. Desactivar la opción la quita de Ítems de inicio.
  - **macOS 27.0.1 con la app empaquetada (`test-mac.sh background`): 10/10.**
    - Arranca con ventana, icono en el Dock e icono en la barra de menús. El menú tiene abrir, estado ("Control remoto: desactivado") y salir.
    - Cerrar la ventana la oculta: sigue el mismo proceso, sin Dock y con el icono de la barra de menús. "Abrir Absor Connect" la muestra y recupera el Dock. Abrir la app otra vez reutiliza la misma instancia (mismo PID). "Salir" la termina.
    - `--hidden` arranca sin ventana ni Dock, con el icono de la barra de menús.
    - "Abrir al iniciar sesión" añade la app a Ítems de inicio (`SMAppService`, con firma ad-hoc).
    - **4.2:** con versión 0.0.1, a los 11 s encuentra la 0.3.3 de GitHub, la barra de menús ofrece "Descargar la versión 0.3.3" y llega la notificación.
    - En macOS, electron-builder solo escribe `app-update.yml` si se genera un `dmg` o un `zip`, por eso la prueba empaqueta un `zip`. Las releases generan los dos.
  - **Windows 11, con el código de hoy y el mismo paquete de prueba:** AbsorCheck 0.0.1, empaquetado desde Linux (`win-unpacked`, con `app-update.yml`).
    - **Cómo se manejó:** desde la pantalla de la VM (noVNC). Se lanzaba con tareas programadas `/it` en la sesión gráfica y se capturaba con un script de PowerShell lanzado por un `.vbs` oculto, para no quitar el foco al menú.
    - **Menú de la bandeja:** "Abrir Absor Connect", "Control remoto: desactivado" (atenuado), "Descargar la versión 0.3.3" y "Salir". En Windows el actualizador también encuentra la versión nueva.
    - **Ventana y procesos:**
      - cerrar la ventana la oculta (desaparece también de la barra de tareas) y deja el mismo proceso;
      - "Abrir Absor Connect" la vuelve a mostrar;
      - abrir la app otra vez muestra la ventana sin un segundo proceso;
      - "Salir" termina todos los procesos.
    - **Abrir al iniciar sesión:** escribe en `HKCU\…\Run` el valor `com.absor.fileexplorer` (el AppUserModelId que fija la app) con `"…\AbsorConnect.exe" --hidden`. Tras reiniciar, con inicio de sesión automático, la app arranca a los 10 s con `--hidden`, sin ventana ni botón en la barra de tareas y con el icono en la bandeja. Desactivar la opción borra el valor.
    - **Sin probar en Windows:** la notificación de versión nueva. Windows solo la muestra a apps con un acceso en el menú Inicio con su AppUserModelId (lo crea el instalador NSIS), y el instalador no se puede generar desde Linux sin Wine. En macOS sí se ha visto.
  - **Pendiente:** los escenarios que necesitan una sesión remota (tarea 4.8):
    - el estado "controlado desde…" en la bandeja: **visto en los tres sistemas**.
      - Linux: con `lan-check`, leído por D-Bus.
      - Mac: a mano, en la barra de menús durante una sesión de `lan-check`.
      - Windows 11, en la máquina virtual con el paquete `win-unpacked` hecho desde Linux:
        - El PC se preparó con `lan-check/prepare-pc.ts` y la sesión se abrió desde el Linux con `lan-check/hold-session.ts`.
        - El texto del icono, leído con UI Automation, es «Absor Connect — Controlado ahora desde Controlador Linux de prueba». En la captura, el menú dice «Controlado ahora desde Controlador Linux de prueba».
        - Windows 11 esconde los iconos nuevos en el desbordamiento: para la prueba se promovió con `HKCU\Control Panel\NotifyIconSettings\…\IsPromoted`.
        - El aviso de la sesión no sale en la captura (`setContentProtection`), como se buscaba.
        - Al no activar el control remoto desde Ajustes, el aviso del cortafuegos salió con la primera sesión (D7). La sesión funcionó igual ("Directa · 1 ms").
    - que la app no se reinicie para actualizar durante una sesión: visto en Linux con `exit-check` (tarea 4.2, D15).
  - **Nota:** `settings.json` con BOM (p. ej. escrito por PowerShell `Set-Content -Encoding utf8`) hace que `JSON.parse` falle y se usen los valores por defecto; es seguro (los defaults desactivan el segundo plano), pero conviene recordarlo.
- **Ajustes (tarea 6.2):** dos secciones nuevas, "Segundo plano" y "Control remoto de este PC" (`RemoteSettings.tsx`).
  - **Proceso principal:** `remoteSettings.ts` atiende `remote-settings:get`, `set-password`, `set-enabled`, `update` y `open-permission`. Antes de cada una ata la configuración a la cuenta con la sesión iniciada. La contraseña solo cruza una vez, al definirla, y el proceso principal deriva K sin guardarla.
  - **Reglas:** activar exige sesión iniciada, contraseña y un sistema compatible. Cambiar la contraseña o desactivar corta la sesión en curso. El resto se publica en la cuenta en la siguiente vuelta de HostService. Al activar se llama a `primeFirewall()` (solo hace algo en Windows).
  - **Interfaz:**
    - Si no hay contraseña, activar abre el formulario para crearla y después activa.
    - Al activar propone también el segundo plano ("Activarlas" / "Ahora no").
    - El nombre se guarda al salir del campo o con Intro.
    - Muestra los permisos de macOS, el aviso de Wayland, la pista del cortafuegos de Windows, lo que no se puede controlar en cada sistema y el registro.
    - Se refresca cada 3 s mientras está abierta.
    - Los botones se llaman "Crear/Cambiar contraseña del PC", para no confundirse con "Cambiar contraseña" de la cuenta.
  - **Corregido al probarlo:** cada lectura de Ajustes reescribía `remote-access.json` (`bindToAccount`), y `writeAtomic` usaba siempre el mismo `.tmp`. Con dos escrituras a la vez, el segundo `rename` fallaba con ENOENT y se perdía el cambio (por ejemplo, quitar los ficheros justo después de renombrar el PC). Ahora `writeAtomic` encola las escrituras de cada fichero en el orden pedido, y `bindToAccount` no escribe si la cuenta no cambia. Además, un refresco que salió antes de un cambio ya no pisa el estado que devuelve el cambio. Hay una prueba unitaria con seis cambios a la vez.
  - **Verificado** con `prototypes/remote-desktop/settings-check`: la app de verdad en Linux X11 con el backend de desarrollo, manejada por DevTools como una persona. Pasa 14/14 en seis ejecuciones seguidas tras la corrección:
    - aparecen las dos secciones, con los límites de Linux y sin los permisos de macOS;
    - sin contraseña el interruptor está apagado, y activarlo pide crearla;
    - rechaza una contraseña de menos de 8 caracteres y dos que no coinciden;
    - al guardarla queda activado y propone el segundo plano;
    - el PC aparece disponible en la cuenta;
    - el nombre nuevo y los ficheros desactivados se publican en la cuenta;
    - "Mantener abierta en segundo plano" se guarda en `settings.json`;
    - cambiar la contraseña funciona y el registro se muestra vacío;
    - desactivar publica `disabled`.
  - **Revisado en capturas:** la sección se ve bien en el tema oscuro, después de poner el botón de la contraseña en una sola línea.
  - **Con sesiones de verdad** (`settings-check/sessions.ts`, 10/10 en Linux X11). El PC tiene su ventana y un controlador se maneja por DevTools:
    - "Abrir al iniciar sesión" escribe el autostart con `--hidden` y desactivarla lo borra. El PC va con otro `HOME`, para no tocar el autostart real.
    - El registro muestra el intento con la contraseña incorrecta ("17/10/2026, 17:41:26 · Contraseña incorrecta desde Controlador de prueba"), el inicio de la sesión y su fin con la duración. Durante la sesión dice "Alguien está controlando este PC ahora.".
    - Desactivar durante la sesión la corta ("El PC ha desactivado el control remoto.") y se publica. Al volver a activarlo, como ya tiene contraseña, queda disponible.
    - Al volver a entrar con la misma cuenta sigue activado, y la misma contraseña vale. Con otra cuenta queda desactivado y sin contraseña, y el PC ya no está en la cuenta anterior.
    - Con `XDG_SESSION_TYPE=wayland`: el aviso de Wayland, que sugiere X11, el interruptor desactivado y el PC como `unsupported` en la cuenta.
  - **Corregido al probarlo:** el registro guardaba los intentos fallidos sin el equipo que los hizo, y el escenario "Consultar intentos fallidos" lo pide. Ahora `HostAuth` recibe el nombre del controlador y `registerFailure()` lo guarda en el intento y en el bloqueo. El texto es "Contraseña incorrecta desde {equipo}".
  - **macOS 27.0.1** (`settings-check/test-mac.sh`, 5/6 en la primera pasada):
    - Ajustes muestra los dos permisos con su estado y los límites de macOS, sin el aviso de Wayland ni la pista de Windows;
    - la cuenta publica el PC como disponible, igual que Ajustes, y la persona delante del Mac confirma que coincide con Ajustes del Sistema;
    - "Abrir Ajustes del Sistema" abre "Grabación de pantalla y del audio del sistema" y, para Accesibilidad, "Control de dispositivos y acceso a datos".
  - **Corregido: el nombre de Accesibilidad en macOS 27.**
    - macOS 27 renombró el permiso de Accesibilidad de Privacidad y seguridad como "Control de dispositivos y acceso a datos" ("Device Control and Data Access"). El enlace `Privacy_Accessibility` abre ese panel.
    - La app seguía llamándolo "Accesibilidad" en Ajustes y en la notificación de permisos perdidos, un nombre que en macOS 27 no se encuentra.
    - Ahora, desde macOS 27, usa el nombre nuevo (`accessibilityRenamed()` en `support.ts`, con test). La prueba exige que el panel que se abre se llame como lo nombra Ajustes.
  - **macOS 27.0.1 con el nombre nuevo: 6/6.** Ajustes muestra "Control de dispositivos y acceso a datos: Concedido", y su botón abre el panel con ese mismo nombre.
  - **Queda para la 9.3:** la pista del cortafuegos de Windows, que solo tiene sentido con el instalador NSIS.

### D15. Actualizaciones en segundo plano
- **Búsqueda:** un temporizador de 6 h llama a `checkForUpdates()` y otro aviso al arrancar. Si hay versión nueva, notificación del sistema y entrada en el menú de la bandeja.
- **Instalación:** `autoInstallOnAppQuit` sigue activado. `quitAndInstall()` no se ejecuta mientras haya una sesión remota: el botón explica que se instalará al terminarla.
- **En macOS** no cambia nada respecto a hoy: sin certificado, Squirrel no instala solo y se ofrece la descarga manual.
- **Hecho (tarea 4.2):**
  - Búsqueda al arrancar y cada 6 h (`startBackgroundUpdateChecks`). La notificación sale una vez por versión, y la bandeja ofrece "Descargar la versión X" y, ya descargada, "Instalar la versión X al salir".
  - `quitAndInstall()` no hace nada mientras otro equipo controla este PC. En ese caso Ajustes explica que no se reinicia y que la versión nueva se instalará al salir, o al volver a pulsar cuando termine la sesión. Con la sesión terminada, electron-updater instala y vuelve a abrir la app (`autoRunAppAfterInstall`).
  - **Corregido:** el estado de la actualización se enviaba a `BrowserWindow.getAllWindows()[0]`. Con una sesión remota, esa puede ser la ventana oculta `host`, el aviso o un visor, porque Electron no garantiza el orden.
    - Ahora la ventana principal se guarda al crearla (`registerMainWindow` y `getMainWindow` en `background.ts`). La usan también "Abrir" en la bandeja, las notificaciones y el icono del Dock (`activate`), que con la ventana cerrada podían mostrar la ventana oculta de una sesión.
    - Los diálogos de abrir y guardar, importar y exportar se abren sobre la ventana que los pide (en macOS, pegados a una ventana oculta no se verían).
  - **Cómo se prueba:** en desarrollo, Linux no busca actualizaciones (electron-updater exige un AppImage), así que en vez de `dev-app-update.yml` se usa un paquete de prueba. `exit-check` (fase 4) empaqueta la app como AbsorCheck 0.0.1 en AppImage, con el actualizador apuntando a un servidor local que ofrece como 9.9.9 el mismo AppImage.
  - **Verificado en Linux X11** (fase 4 de `exit-check`, 27/27 con las fases 1 a 3):
    - al arrancar sale la notificación "Hay una versión nueva disponible (9.9.9)" y la bandeja ofrece descargarla;
    - con B controlando el PC, la versión nueva se descarga desde Ajustes, y "Reiniciar y actualizar" no reinicia y lo explica;
    - 6 s después la app sigue en marcha, el AppImage no se ha tocado y al visor le siguen llegando imágenes (de 35 a 213 fotogramas, "Directa · 1 ms · 30 fps");
    - sin sesión, el mismo botón cierra la app, reemplaza el AppImage y la vuelve a abrir.
  - **El primer escenario** se había visto ya en macOS (notificación y bandeja) y en Windows (bandeja); en Windows falta la notificación (D14). **El segundo** no depende del sistema; en macOS, además, Squirrel no puede instalar sin certificado.

## Risks / Trade-offs

- **[macOS, firma ad-hoc]** Tras cada actualización macOS puede retirar Grabación de pantalla y Accesibilidad → la app lo detecta al arrancar, marca el equipo como `missing_permissions` y muestra una notificación con el permiso que falta. La solución definitiva es un certificado de Apple Developer (fuera de alcance).
- **[macOS 15]** Pide reconfirmar la grabación de pantalla cada mes, y alguien tiene que aceptarlo delante del Mac → documentado en Ajustes y en la web. No hay forma oficial de evitarlo.
- **[macOS 27]** Accesibilidad pasa a llamarse "Control de dispositivos y acceso a datos" en Privacidad y seguridad → la app usa el nombre de cada versión (6.2). La documentación (8.2) debe dar los dos.
- **[macOS 27]** El permiso de Grabación de pantalla puede quedar caducado: aparece activado en Ajustes, pero `getMediaAccessStatus('screen')` da `denied`. Pasó con Terminal en las pruebas, y quitarlo y volver a ponerlo no bastó; lo arregló `tccutil reset ScreenCapture <id>`. → Ajustes ya marca el permiso como "falta" cuando pasa. Conviene que la ayuda explique cómo restablecerlo.
- **[Windows]** Pantalla bloqueada, UAC y ventanas elevadas no se pueden controlar → Ajustes lo explica. Un servicio del sistema queda fuera de alcance.
- **[Linux, Cinnamon 6.6.9 / muffin 6.6.3]** En el primer ensayo de `lan-check`, el shell de Cinnamon se cayó (SIGSEGV en `window_may_be_covered_by_above`, al atender una petición de activar una ventana). En ese momento la ventana de prueba, sin marco y siempre encima, tapaba el área de trabajo, y se abría la app del controlador. Linux Mint pasó al modo de emergencia (metacity y mate-panel). La ventana de prueba ya no va siempre encima, y no se ha repetido. `viewer-check`, que también usa el aviso siempre encima de la app, nunca lo provocó. → Vigilarlo en las pruebas con paquetes en Cinnamon (9.3), porque el aviso de la sesión también va siempre encima.
- **[Linux Wayland]** No se admite como PC controlado → se detecta y se explica, sugiriendo una sesión X11.
- **[Linux, sonido]** `loopback` no funciona en Linux (prototipo 1.2) → fuente virtual temporal con `pactl` (D8), que deja visible a otras apps una entrada "Absor Connect" mientras dura la sesión. Sin `pactl`, no hay sonido.
- **[Linux, sonido]** La fuente lleva el volumen del monitor de la salida. Si alguien lo ha bajado (en las pruebas estaba al 8 %), el controlador oye muy poco o nada → explicarlo en la ayuda (Ajustes de sonido > Entrada > "Monitor of …" al 100 %). La app no toca los volúmenes del usuario.
- **[Carga de la API]** Cada PC con el control remoto activado hace una consulta cada 3 s (unas 33 por segundo con 100 PCs, por índice) → límites por equipo y consulta mínima. Si crece, servicio WebSocket (D3).
- **[Abuso del TURN]** Un relé abierto sirve para reenviar tráfico ajeno o entrar en redes internas → credenciales temporales firmadas, `denied-peer-ip`, cuotas y límite de ancho de banda.
- **[Coste del relé]** Una sesión por relé puede gastar varios Mbit/s en el host del TURN → `max-bps`, cuotas y vigilancia del tráfico del host.
- **[Fuerza bruta]** Alguien con acceso a la cuenta puede probar contraseñas → bloqueo persistente, registro, notificación local y límite de solicitudes por cuenta.
- **[Ventana oculta]** Chromium ralentiza los renderers ocultos → `backgroundThrottling: false` y prueba de captura con la ventana principal cerrada.
- **[Empaquetado nativo]** `koffi` debe quedar fuera del asar en los tres sistemas → probar los paquetes reales (NSIS, DMG, AppImage, deb) antes de publicar.
- **[Móvil]** 600 000 iteraciones de PBKDF2 en Dart puro pueden tardar varios segundos en un móvil modesto → medirlo. El número viaja en `hello`, así que se puede bajar al definir la contraseña sin tocar el protocolo.
- **[Tamaño de la app móvil]** `flutter_webrtc` añade el binario de libwebrtc (≈ 10–20 MB) → aceptado.

## Resultados de los prototipos (grupo 1)

Hecho con `prototypes/remote-desktop/` (ver su README). Los móviles se miden en la tarea 7.2.

| Prueba | Linux X11 (Mint, PipeWire, 2 × 4K al 200 %) | Windows | macOS |
|---|---|---|---|
| 1.1 Captura en ventana oculta, sin ventana principal, 5 min | 3840×2160 a 29 fps de media (percentil 5: 27), sin limitación de CPU ni de ancho de banda | VM sin GPU, 1280×800: 28 fps de media (percentil 5: 22) | 3024×1964 a 29 fps de media (percentil 5: 29) en 5 min, sin limitación |
| 1.2 Sonido del sistema | `loopback`: pista vacía. Fuente virtual con `pactl`: llega con el nivel del origen | `loopback` funciona: llega con el nivel del origen. Con sonido, la VM baja a 18 fps por falta de CPU | `loopback` funciona (54 de 54 s con sonido), con el permiso de grabación de pantalla y audio del sistema |
| 1.3 koffi (mover el ratón) | Funciona en desarrollo, AppImage y deb, con `koffi` desempaquetado del asar. `npm ci` sin compilar | Funciona desde el NSIS instalado en silencio (`/S`), ejecutado sin elevar | Funciona desde la app dentro del DMG (CGEvent) con el permiso de Accesibilidad; sin él, `koffi` carga pero el ratón no se mueve |
| 1.4 PBKDF2, 600 000 iteraciones | 58 ms (WebCrypto y Node) | 63 ms (WebCrypto), 80 ms (Node) | 36 ms (WebCrypto), 57 ms (Node) |

Windows se probó en una VM de Windows 11 Enterprise Evaluation (dockur/windows, QEMU/KVM, 4 núcleos y sin GPU), con el instalador NSIS generado dentro de la VM con Node 22, como en CI.

macOS se probó en un Mac con Apple Silicon y macOS 27 (Darwin 27.0), con el DMG generado en el propio Mac y la app abierta desde dentro del DMG montado.
- **Sin permisos:** la captura se queda esperando, sin error y sin imagen, y el ratón no se mueve aunque `koffi` cargue. La app tiene que detectarlo por sí misma (D8 y D10), porque no recibe ningún error.
- **Con permisos:** los permisos concedidos se conservan al volver a montar el mismo DMG, porque la firma ad-hoc es la misma.

## Migration Plan

1. **Backend:** migración con las tablas `device` y `remote_request`, endpoints y límites, con `REMOTE_ENABLED=1`. No afecta a las apps actuales, que no usan esos endpoints.
2. **Relé:** desplegar coturn, crear el DNS `turn.absor.top` y añadir `TURN_SECRET`, `TURN_URLS` y `STUN_URLS` al Secret (`make-env-secret.sh`), reiniciando los pods. Comprobar con `turnutils_uclient` y con una conexión real por relé.
3. **Apps:** release conjunta de escritorio y móvil (minor nueva). Las versiones anteriores no ven nada nuevo.
4. **Vuelta atrás:** `REMOTE_ENABLED=0` desactiva la función en todas las apps sin publicar una versión. Las tablas pueden quedarse: nada más las usa.

## Open Questions

- Qué host aloja coturn (`head0` u otro con IP pública), el rango final de puertos del relé y las cuotas. No cambia el diseño.
- El número final de iteraciones de PBKDF2, tras medirlo en un Android modesto y en un iPhone (D12, tarea 7.2).
