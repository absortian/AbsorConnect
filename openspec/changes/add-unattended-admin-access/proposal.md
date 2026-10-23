# Proposal

## Why

AbsorConnect permite controlar la sesión de un usuario, pero deja de servir para administrar sus equipos durante un viaje cuando aparece UAC, se cierra la sesión del sistema o se reinicia el ordenador. Necesitamos acceso desatendido y de administrador a los propios Windows, Mac y Linux Mint, manteniendo la autenticación y el aislamiento entre cuentas actuales.

## What Changes

- Añadir un modo opcional «Acceso desatendido», instalado y autorizado inicialmente en cada equipo, con un agente que arranca con el sistema y funciona sin la interfaz Electron abierta.
- Windows: controlar aplicaciones elevadas y el escritorio seguro de UAC, bloquear/desbloquear, acceder al inicio de sesión y volver a conectar después de reiniciar. La instalación requiere autorización de administrador; cada elevación conserva los mecanismos de Windows.
- macOS: controlar los diálogos de administración permitidos, mantener el servicio fuera de la sesión del usuario y resolver bloqueo, `loginwindow` y reconexión después de reiniciar. Su viabilidad se verificará en hardware real antes de anunciar soporte; un LaunchDaemon por sí solo no demuestra acceso a esas pantallas.
- Mint: soportar inicialmente Cinnamon/X11 con LightDM, la configuración comprobada en el equipo del propietario; controlar los diálogos de polkit y las transiciones entre escritorio, bloqueo y pantalla de entrada.
- Mantener cuenta de AbsorConnect + contraseña del equipo para conectar. Introducir una credencial revocable, limitada al agente de ese equipo, que no permita leer conexiones S3/SSH ni administrar la cuenta.
- Mostrar capacidades verificadas por equipo, controles de administración en escritorio y móvil, y un diagnóstico de preparación para viajes. Durante pantallas de credenciales se suspenden portapapeles, ficheros y sonido.
- Conservar el modo actual de sesión de usuario y el protocolo v1 para clientes existentes. Las funciones nuevas se negocian; un cambio incompatible exige una versión nueva implementada también en Flutter.
- **Cambio de comportamiento optativo:** con el servicio activado, «Salir de la app» deja el equipo accesible; una acción distinta permite detener el acceso remoto. Cerrar la cuenta de AbsorConnect sigue cortando y revocando el acceso. Cerrar la sesión del sistema operativo conserva el servicio.

## Capabilities

### New Capabilities

- `unattended-access`: instalación, operación antes del inicio de sesión, administración del sistema, separación de privilegios, protección de credenciales locales y preparación del equipo para acceso desatendido.

### Modified Capabilities

- `remote-access-host`: activación, plataformas, aviso local, funciones durante pantallas protegidas y vínculo de la configuración con la cuenta.
- `background-mode`: diferencia entre cerrar la interfaz y detener el servicio, con un único propietario de las sesiones remotas.
- `remote-signaling`: credenciales de agente limitadas al equipo, revocación y publicación de capacidades verificadas.
- `remote-desktop-viewer`: estado del host, acciones administrativas y reconexión explícita después de un reinicio.
- `mobile-app`: las mismas acciones y estados administrativos desde Android e iOS.
- `app-updates`: actualización coordinada y reversible de app/agente sin ampliar permisos ni cortar sesiones automáticamente.

## Impact

- Escritorio: `src/main/remote/`, `src/main/background.ts`, actualización, IPC/preload, tipos compartidos, visor, Ajustes y locales `es`/`en`.
- Nuevos componentes nativos de servicio, transporte WebRTC y captura/entrada por plataforma, instaladores, CI y pruebas con artefactos empaquetados. Se propone un núcleo Rust y adaptadores del sistema; la elección final del transporte nativo queda condicionada a las pruebas de interoperabilidad del diseño.
- Backend Symfony: autenticación del agente separada del token de cuenta, alta/revocación, capacidades y migraciones aditivas. Continúa el despliegue por Jenkins/Kubernetes y el relé TURN existente.
- Flutter: señalización, capacidades, comandos y pruebas del protocolo en Android/iOS; los móviles siguen siendo controladores.
- Se necesita identificar las versiones/arquitecturas reales de Windows y Mac y resolver distribución e identidad de firma para el agente. Son puntos de revisión y condiciones de publicación, no capacidades ya demostradas.

### Usuarios existentes

El servicio no se instala ni se activa al actualizar. Se conservan conexiones, credenciales S3/SSH, identidad de app, repositorio de releases y modo de usuario. El alta opcional migrará identidad y configuración remota de forma transaccional, sin copiar el token de cuenta al servicio ni dejar dos hosts activos. La firma ad-hoc actual de Mac no garantiza permisos persistentes entre versiones ni actualización automática: no se prometerá continuidad hasta probar su estrategia de distribución.

### Fuera de alcance

- BIOS/UEFI, recuperación, reinstalación del sistema, encendido desde apagado y Wake-on-LAN; escritorios virtuales para equipos sin salida gráfica.
- Un desbloqueador propio de discos antes del arranque (BitLocker con PIN, FileVault, LUKS). Documentar las opciones oficiales aplicables, incluida la de Apple silicon/macOS 26+, sin presentarlas como conectividad proporcionada por AbsorConnect.
- Cambiar UAC, SIP/TCC, polkit, cifrado o políticas de autenticación para facilitar el control; inicio de sesión automático o almacenamiento de contraseñas del sistema.
- Host Wayland, otros gestores de entrada Linux, sesiones simultáneas de varios usuarios, acceso a equipos ajenos a la cuenta y una consola remota arbitraria ejecutada como root/SYSTEM.
- Implementar, instalar servicios, cambiar la infraestructura o publicar versiones durante esta propuesta. Primero se revisan estos artefactos con el propietario.
