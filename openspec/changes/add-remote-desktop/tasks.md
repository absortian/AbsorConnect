# Tasks

## 1. Prototipos de los puntos de riesgo

- [x] 1.1 Prototipo de captura en una ventana oculta (`backgroundThrottling: false`) con la ventana principal cerrada, enviada por WebRTC local a otra ventana (D7). Verificar en Windows, macOS y Linux X11: unos 30 fps estables durante 5 minutos.
- [x] 1.2 Sonido del sistema con `audio: 'loopback'` en Windows, macOS 14.2+ (con `NSAudioCaptureUsageDescription`) y Linux con PulseAudio y con PipeWire, y la fuente "Monitor of …" como alternativa en Linux (D8). Verificar: resultado por sistema anotado en design.md (D8).
- [x] 1.3 Añadir `koffi` y probar un movimiento de ratón desde un paquete real de cada tipo (NSIS, DMG, AppImage y deb), con `asarUnpack` (D10). Verificar: el ratón se mueve en los cuatro y `npm ci` no compila nada.
- [x] 1.4 Medir PBKDF2-HMAC-SHA256 con 600 000 iteraciones en WebCrypto y en Node en Windows, macOS y Linux (D6). Verificar: tiempos anotados en design.md. La medida en móviles se hace en la 7.2, con el código en Dart.

## 2. Backend (`backend/`)

- [x] 2.1 Entidades `Device` y `RemoteRequest`, repositorios y migración (D4). Verificar: la migración aplica en limpio, `doctrine:schema:validate` pasa y la migración no toca `cache_items`.
- [x] 2.2 `GET`, `PUT` y `DELETE` de `/api/devices` con estado en línea (30 s), clave del equipo (`X-Device-Key`), `device_taken` y borrado de equipos sin contacto en 90 días (D4, D5). Verificar con tests de API: alta, actualización, identificador de otra cuenta, otra sesión de la misma cuenta con y sin la clave, y en línea o sin conexión con la hora controlada.
- [x] 2.3 Solicitudes de sesión: alta con comprobación del estado del equipo, consulta del PC como señal de vida, respuesta o rechazo, consulta del controlador (solo su sesión), caducidad a 60 s con limpieza y límites `remote_request_user` y `device_poll` (D5). Verificar con tests de API los escenarios de "Negociación de las sesiones", "Aislamiento entre cuentas" y "Límites de uso".
- [x] 2.4 `GET /api/remote/ice-servers` con credenciales temporales de coturn (24 h) a partir de `TURN_SECRET`, `TURN_URLS` y `STUN_URLS`, y solo STUN sin TURN configurado (D13). Verificar con un test unitario contra un vector calculado a mano y un test de API sin TURN.
- [x] 2.5 Interruptor `REMOTE_ENABLED` (503 `remote_unavailable`) y borrado de equipos y solicitudes al borrar la cuenta. Verificar con tests de API.
- [x] 2.6 Documentar los endpoints en la sección API del README, las variables nuevas en `kube/AGENTS.md` y sus valores de desarrollo en `backend/.env`. Verificar: `docker compose exec php php bin/phpunit` en verde.

## 3. Relé TURN (infraestructura, fuera de este repo)

- [ ] 3.1 Elegir el host con IP pública y desplegar coturn con la configuración de D13: secreto, TLS en 5349 con `*.absor.top`, rango de relé, `denied-peer-ip` y cuotas. Verificar con `turnutils_uclient`: las credenciales de la API funcionan, las caducadas fallan y un relé hacia 10.x o 192.168.x se rechaza.
- [ ] 3.2 Registro DNS `turn.absor.top` sin proxy de Cloudflare, puertos abiertos en el cortafuegos y variables en el Secret `absorconnect-env`, con reinicio de los pods. Verificar: `GET /api/remote/ice-servers` en producción devuelve el TURN, y una conexión de prueba con `iceTransportPolicy: 'relay'` conecta.

## 4. Proceso principal (`src/main`)

- [x] 4.1 Instancia única, bandeja con menú y estado, "Mantener abierta en segundo plano" y "Abrir al iniciar sesión" en cada sistema, con arranque oculto `--hidden` (D14). Verificar a mano en Windows, macOS y Linux los escenarios de `background-mode`, incluido Linux sin bandeja.
- [x] 4.2 Actualizaciones en segundo plano: búsqueda cada 6 h, notificación y entrada en la bandeja, sin `quitAndInstall` durante una sesión remota (D15). Verificar con `dev-app-update.yml` apuntando a una versión mayor los dos escenarios de `app-updates`.
- [x] 4.3 Añadir Vitest (`npm test`) para los módulos puros, y el almacén `remote-access.json` y `device.json`: identificador y clave del equipo, contraseña derivada con `K` cifrada, fallos y bloqueo persistentes, registro de 50 eventos y vínculo con la cuenta (D6, D14). Verificar con tests: la contraseña no aparece en el fichero, 5 fallos bloquean 15 min aunque se recargue el almacén, y otra cuenta lo borra.
- [x] 4.4 Prueba de autenticación compartida (`src/shared/remote/auth.ts`) con vectores en `src/shared/remote/auth-vectors.json` (D6). Verificar con tests: los vectores pasan, y cambiar una huella o el nonce cambia la prueba.
- [x] 4.5 Tabla `code` → scancode, `kVK` y evdev (`src/shared/remote/keymap.ts`) a partir de `dom_code_data.inc` de Chromium, con su atribución (D10). Verificar con tests: letras, `Semicolon` (la Ñ en español), flechas extendidas, teclado numérico y modificadores en los tres sistemas.
- [x] 4.6 Inyección con koffi en `src/main/remote/input/` para Windows, macOS y X11: ratón absoluto, botones, doble clic, rueda, teclas físicas, texto Unicode, soltar todo y conversión de coordenadas por pantalla y escala (D10). Verificar a mano en cada sistema con un script de prueba: clic en las esquinas de cada monitor (uno al 150 %), "ñ", "¿Año 2026? €" y Ctrl+C.
- [x] 4.7 Detección de los permisos de Grabación de pantalla y Accesibilidad en macOS (con apertura de sus paneles) y de Wayland en Linux, con estado `missing_permissions` o `unsupported` y notificación al perder permisos (D8). Verificar: un Mac sin permisos queda en `missing_permissions` y una sesión Wayland en `unsupported`.
- [x] 4.8 `hostService` (D7):
  - registro del equipo y consulta cada 3 s;
  - rechazos tempranos y ventana oculta `host`, con un tiempo máximo para empezar la captura (en macOS, sin permiso, se queda esperando; D8);
  - `setDisplayMediaRequestHandler` con elección de pantalla y audio (`loopback` en Windows y macOS; en Linux, fuente virtual temporal con `pactl`, D8);
  - en Windows, conexión WebRTC local al activar el control remoto para que el aviso del cortafuegos salga con alguien delante (D7);
  - aviso siempre encima con `setContentProtection` y notificaciones;
  - confirmación local con `AbortSignal`;
  - `powerSaveBlocker`;
  - corte al desactivar o al cambiar la contraseña.

  Verificar con dos equipos los escenarios de `remote-access-host` de activación, una sesión a la vez, aviso y corte, confirmación local y mantener despierto.
- [x] 4.9 IPC del controlador: canales `remote-*` (equipos, servidores ICE, crear y consultar solicitudes) que solo aceptan llamadas de ventanas de visor, y apertura del visor fuera de `watchWindowShortcuts` (D11). Verificar en desarrollo, registrando los mensajes IPC, que el token no llega a ningún renderer.
- [x] 4.10 Al cerrar la sesión de la cuenta o perderla: cortar las sesiones remotas (en los dos papeles), hacer `DELETE` del equipo y parar el servicio, con notificación si ocurre en segundo plano. Verificar los dos escenarios nuevos de `app-session`.

## 5. Preload (`src/preload`)

- [x] 5.1 Tres preloads con sus tipos en `index.d.ts`:
  - **ventana principal:** segundo plano, control remoto, registro, equipos y abrir el visor;
  - **ventana `host`:** entrada, portapapeles, ficheros y eventos de sesión;
  - **visor:** negociación y guardar ficheros.

  Verificar: `npm run typecheck`, y que `host` y el visor solo exponen sus propios canales.

## 6. Renderer (`src/renderer`)

- [x] 6.1 Varias entradas en `electron.vite.config.ts` (`index`, `host` y `viewer`). Verificar: `npm run build` genera las tres y `npm run dev` las sirve.
- [x] 6.2 Ajustes, con textos `es` y `en`:
  - sección "Segundo plano";
  - sección "Control remoto de este PC": activar, nombre, contraseña, funciones, confirmación local, mantener despierto, permisos por sistema, limitaciones explicadas y registro.

  Verificar a mano los escenarios de Ajustes de `remote-access-host` y `background-mode`.
- [x] 6.3 Renderer `host` (D9):
  - WebRTC del PC controlado con el protocolo v1, autenticando antes de todo;
  - pantallas y entrada hacia el IPC;
  - portapapeles con hash;
  - ficheros a `Descargas/Absor Connect` con `.part`, nombres libres y SHA-256;
  - explorador de carpetas para las descargas;
  - sonido.

  Verificar con tests del protocolo (se descarta lo recibido antes de autenticar, nombres libres, integridad) y a mano con el visor.
- [x] 6.4 Sección "Equipos" en la ventana principal: estado de cada PC, actualización automática y diálogo de contraseña. Verificar los escenarios de "Equipos de la cuenta".
- [ ] 6.5 Visor (D11):
  - errores por código;
  - imagen ajustada, a tamaño real y a pantalla completa;
  - ratón y teclado con `keyboard.lock()`, `release-all` y menú de combinaciones;
  - selector de pantallas y portapapeles con pausa;
  - envío (arrastrando y con botón) y descarga de ficheros, con progreso y cancelación;
  - sonido con silencio;
  - estado (directa o relé, latencia y fps) y reconexión con `K` durante 30 s.

  Verificar entre dos PCs los escenarios de `remote-desktop-viewer`, incluidos forzar el relé y cortar la red 10 s.

## 7. App móvil (`mobile/`)

- [ ] 7.1 Dependencias `flutter_webrtc` y `cryptography`, permisos de Android e iOS que hagan falta (D12) y fuente de AltStore con los mismos `UsageDescription` que el `Info.plist`. Verificar: `flutter build apk` y la IPA compilan, y la fuente coincide con el `Info.plist`.
- [ ] 7.2 Cliente de la API de equipos y solicitudes, autenticación y protocolo v1 en Dart. Verificar con `flutter test`, usando los vectores de `src/shared/remote/auth-vectors.json`, y con pruebas de integración contra el backend de desarrollo. Medir PBKDF2 con 600 000 iteraciones en un Android modesto y en un iPhone, y fijar el número de iteraciones (cierra esa Open Question de design.md).
- [ ] 7.3 Pantalla "Equipos" y visor móvil:
  - imagen y rotación;
  - modos ratón y táctil, gestos, teclado y barra de teclas;
  - pantallas, botón para enviar el portapapeles, sonido y ficheros;
  - segundo plano durante 30 s.

  Verificar en el emulador de Android contra un PC real los escenarios nuevos de `mobile-app`, con capturas.
- [ ] 7.4 Textos ARB `es` y `en`, y en `mobile/README.md` cómo probar el control remoto con el emulador. Verificar: `flutter analyze` limpio.

## 8. Empaquetado, CI y documentación

- [ ] 8.1 `electron-builder.yml`: `asarUnpack` de koffi y `@koromix`, `NSAudioCaptureUsageDescription`, iconos de la bandeja (incluida la imagen *template* de macOS) y dependencias de Linux (`libxtst6`, y `pulseaudio-utils` como recomendada) si faltan. En `release.yml`, instalar `@koromix/koffi-darwin-x64` en el job de macOS antes de empaquetar (D10). Verificar: los paquetes de CI se instalan y el control remoto funciona en cada sistema desde el paquete, no desde `npm run dev`.
- [ ] 8.2 Documentación:
  - README: la función, sus limitaciones por sistema y los permisos de macOS (Accesibilidad se llama "Control de dispositivos y acceso a datos" desde macOS 27);
  - `AGENTS.md`: decisiones que conviene no romper (token fuera del renderer, nada antes de autenticar, protocolo v1 compartido con el móvil, `backgroundThrottling`);
  - web (`backend/public/index.html`): la función nueva.

  Verificar: los enlaces funcionan y la web se ve bien en el navegador.

## 9. Verificación final

- [ ] 9.1 `npm run typecheck` limpio, `npm test` en verde y `npx eslint` sobre los ficheros tocados sin errores nuevos (la deuda previa no cambia).
- [ ] 9.2 `docker compose exec php php bin/phpunit` y `(cd mobile && flutter analyze && flutter test)` en verde.
- [ ] 9.3 Matriz manual con paquetes reales: controlador en Windows, macOS, Linux, Android e iPhone frente a PC controlado en Windows, macOS y Linux X11. Incluir al menos una sesión por relé, un PC controlado con dos monitores de escalas distintas (clics en las esquinas de cada uno; la 4.6 se verificó con una sola pantalla) y, en Windows, la pista del cortafuegos en Ajustes y su aviso al activar el control remoto (6.2), y revisar el disco y la base de datos según "Contraseña local del PC". Verificar: tabla de resultados en el PR.

## Workflow follow-up

- **Propietario:** probar el control remoto desde un iPhone real con SideStore o AltStore Classic.
- Publicar la release conjunta de escritorio y móvil.
- Archivar el change tras verificarlo.
