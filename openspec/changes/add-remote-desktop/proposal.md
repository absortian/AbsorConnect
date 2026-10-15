# Proposal

## Why

Absor Connect ya reúne en una cuenta las conexiones a servidores (S3, SFTP, SSH), pero no permite llegar a los propios ordenadores de esa cuenta. Para ver y manejar el PC de casa desde la oficina o desde el móvil hoy hace falta otra herramienta (AnyDesk, TeamViewer, Chrome Remote Desktop). La cuenta y la app instalada en cada equipo ya existen, así que podemos ofrecer control remoto propio: cada PC decide si se deja controlar y con qué contraseña.

## What Changes

- **La app puede quedarse abierta en segundo plano:** icono en la bandeja del sistema (barra de menús en macOS), cerrar la ventana no cierra la app si así se configura, opción de abrirse al iniciar sesión en el sistema y una sola instancia en marcha.
- **Control remoto de este PC (equipo controlado):** nueva sección de Ajustes donde cada PC:
  - activa o desactiva el control remoto y elige el nombre con el que aparece;
  - define su contraseña de acceso, que se guarda solo en ese PC y nunca se envía al servicio;
  - decide si permite portapapeles, ficheros y sonido, y si pide confirmación local antes de cada conexión;
  - puede evitar que el sistema se suspenda mientras el control remoto está activado;
  - ve los permisos que faltan (macOS) o por qué su sistema no se puede controlar (Linux con Wayland), y un registro de las últimas sesiones e intentos fallidos.
  Durante una sesión el PC muestra quién lo controla y permite cortarla. Varios intentos fallidos seguidos bloquean el acceso durante un tiempo.
- **Controlar otro PC desde el escritorio:** sección "Equipos" con los PCs de la cuenta (en línea o no, con el control remoto activado o no). Al conectar se pide la contraseña del PC y se abre una ventana con su pantalla, con teclado y ratón, elección de pantalla si tiene varias, portapapeles compartido (texto e imágenes), envío y descarga de ficheros, sonido del PC remoto, pantalla completa con captura de atajos del sistema y menú de combinaciones especiales, ajuste o tamaño real, e indicador de calidad y de si la conexión es directa o por relé.
- **Controlar otro PC desde el móvil (Android e iOS):** la misma lista de equipos y la misma conexión, con gestos táctiles (modo ratón y modo táctil), teclado del teléfono y barra de teclas especiales, cambio de pantalla, portapapeles de texto, sonido y envío y descarga de ficheros.
- **Conexión directa y cifrada entre equipos:** la imagen, el sonido, la entrada y los ficheros van de PC a PC con WebRTC (cifrado de extremo a extremo con DTLS/SRTP). Si la red no permite la conexión directa (CGNAT, redes de empresa), el tráfico pasa por un servidor TURN propio sin que este pueda descifrarlo.
- **Backend:** registro de los equipos de cada cuenta con su estado, intercambio de la negociación de cada sesión mediante la API existente (sin WebSockets) y credenciales temporales para el TURN.
- **Infraestructura:** un servidor TURN (coturn) con IP pública y el nombre `turn.absor.top`.

## Fuera de alcance

- Controlar un teléfono: los móviles solo controlan.
- Acceso de personas de otras cuentas, por ID o con invitaciones: solo se controlan los PCs de la propia cuenta.
- Lo que una app de usuario no puede tocar: pantalla de inicio de sesión o de bloqueo de Windows y macOS, avisos de UAC, Ctrl+Alt+Supr real y ventanas de programas elevados en Windows. Requeriría un servicio del sistema.
- Linux con Wayland como equipo controlado (sí como controlador): el sistema exige que alguien acepte cada captura y no permite inyectar entrada de forma general.
- Eliminar el aviso mensual de macOS 15 para reconfirmar la grabación de pantalla.
- Recordar en el controlador la contraseña de los PCs remotos.
- Varias personas controlando el mismo PC a la vez, chat, grabación de sesiones, pantalla negra o bloqueo de la entrada local, encendido remoto (Wake-on-LAN).

## Impacto en usuarios existentes

- **Comportamiento por defecto:** ninguno. El control remoto viene desactivado y la ventana se sigue cerrando como hasta ahora. Solo al activar el control remoto se propone mantener la app en segundo plano y abrirla al iniciar sesión.
- **Datos y credenciales:** las conexiones y la sesión no cambian. Se añaden en cada equipo un identificador de equipo y la configuración del control remoto (con la contraseña derivada, nunca en claro). En el servicio, solo tablas nuevas.
- **Auto-update:** el mismo canal. Como la app puede pasar días abierta, buscará actualizaciones también en segundo plano y las instalará al salir. En macOS, con la firma ad-hoc, los permisos de Grabación de pantalla y Accesibilidad probablemente haya que volver a concederlos tras cada actualización. La app lo detecta y lo indica.
- **Móvil:** la app crece por la librería de WebRTC. La sesión y las conexiones no cambian.

## Capabilities

### New Capabilities
- `background-mode`: la app de escritorio en segundo plano (bandeja, cerrar sin salir, abrir al iniciar sesión, una sola instancia).
- `remote-access-host`: dejar que este PC se controle: activación, contraseña local, autenticación y bloqueo, opciones por función, aviso y corte de la sesión, permisos y plataformas soportadas, y registro de sesiones.
- `remote-desktop-viewer`: controlar desde el escritorio un PC de la cuenta: lista de equipos, conexión, imagen, teclado, ratón, pantallas, portapapeles, ficheros, sonido y estado de la conexión.
- `remote-signaling`: lo que aporta el servicio: equipos de la cuenta y su estado, negociación de las sesiones, credenciales del relé TURN y límites de uso.

### Modified Capabilities
- `mobile-app`: nuevo requisito de control remoto de los PCs de la cuenta desde el móvil.
- `app-updates`: búsqueda de actualizaciones en segundo plano e instalación al salir cuando la app pasa mucho tiempo abierta.
- `app-session`: cerrar la sesión o perderla también corta las sesiones de control remoto y deja el PC sin control remoto hasta volver a entrar.

## Impact

- **App de escritorio:** `src/main` (bandeja y ciclo de vida, servicio de equipo controlado, inyección de entrada nativa por SO, almacenamiento de la contraseña), `src/preload`, `src/renderer` (Ajustes, sección Equipos, ventana del visor y ventana oculta del equipo controlado como nuevas entradas de Vite), locales `es`/`en`, `electron.vite.config.ts` y `electron-builder.yml` (`NSAudioCaptureUsageDescription` en macOS).
- **Dependencia nativa nueva:** `koffi` (FFI con binarios precompilados) para llamar a `SendInput`, `CGEvent*` y XTest sin compilar módulos.
- **Backend:** entidades y migración de equipos y solicitudes de sesión, controladores nuevos bajo `/api/devices`, `/api/remote-requests` y `/api/remote/ice-servers`, límites en `rate_limiter.yaml` y variables `TURN_SECRET` y `TURN_URLS` en el Secret `absorconnect-env`.
- **Móvil:** `mobile/` con `flutter_webrtc`, pantallas de equipos y visor, y textos ARB. Se revisa el `Info.plist` contra la fuente de AltStore.
- **Infraestructura (fuera de este repo):** coturn en un host con IP pública (por ejemplo `head0`), registro DNS `turn.absor.top` sin el proxy de Cloudflare, puertos UDP/TCP 3478, TLS 5349 con el certificado `*.absor.top` y un rango UDP de relé.
- **Carga del servicio:** cada PC con el control remoto activado consulta la API cada pocos segundos.
