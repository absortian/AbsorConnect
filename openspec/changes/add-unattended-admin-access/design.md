# Design

## Context

Motivación y alcance: [proposal.md](proposal.md). Este documento describe una arquitectura propuesta para revisar; no acredita todavía soporte funcional.

Evidencia inspeccionada el 22/10/2026:

- `src/main/remote/hostSession.ts` captura con una ventana oculta Electron y `desktopCapturer`; `input/windows.ts` usa `SendInput`, sujeto a UIPI; `input/macos.ts` usa CoreGraphics y Accesibilidad; `input/x11.ts` usa XTest.
- `hostRuntime.ts`, `deviceApi.ts`, `DeviceIdentity` y los controladores Symfony requieren actualmente un token de cuenta además de `X-Device-Key`. Ese token y K están cifrados mediante `safeStorage` en el perfil del usuario. No son credenciales apropiadas para copiar a un servicio.
- `background.ts` configura inicio al iniciar sesión, no al arrancar el sistema. `HostService` es una clase del proceso principal; no es un servicio instalado del sistema operativo.
- Los controladores Flutter y Electron comparten protocolo v1, autenticación con PBKDF2/HMAC y huellas DTLS, `auth-vectors.json` y canales de entrada/ficheros. Hay pruebas Vitest y Flutter pese a que el contexto histórico de `openspec/config.yaml` dice que no.
- Comprobación SSH de solo lectura: el Linux del propietario es Mint 22.3, Cinnamon 6.6.9, sesión X11 y LightDM; SSH arranca con el sistema. Es una referencia de aceptación privada, no una dirección que deba incrustarse en la app o CI.
- `electron-builder.yml` distribuye Mac arm64/x64 con firma ad-hoc, sin notarización. No se presume identidad estable de permisos tras actualizar. Las versiones y arquitecturas objetivo de Mac/Windows deben inventariarse antes de las pruebas; no se habilitará soporte por coincidencia genérica de SO.

Las specs vigentes excluyen UAC, aplicaciones elevadas y pantallas de entrada; también establecen que salir de la app termina el host. Los deltas cambian esas reglas solo al activar voluntariamente el servicio.

## Goals / Non-Goals

**Goals:** separar la interfaz del ciclo de vida del host, mantener un solo equipo y una sola sesión, preservar el protocolo existente y acotar la autoridad del servicio privilegiado. El criterio funcional es conectar al equipo bloqueado, administrar, cerrar sesión del sistema, entrar, reiniciar y volver a conectar desde otra red.

**Non-Goals:** no convertir Electron en root/SYSTEM, no exponer un intérprete privilegiado y no tratar el arranque previo al sistema operativo como una pantalla capturable. El resto de exclusiones está en la propuesta.

## Decisions

### D1. Agente nativo con privilegios separados

Proponer un nuevo árbol `agent/`: supervisor/broker mínimo en Rust y trabajador de conexión/captura separado. El broker solo administra el ciclo de vida, crea trabajadores para la sesión y escritorio autorizados y ejecuta comandos enumerados. El trabajador termina DTLS y verifica el desafío de contraseña; el broker concede captura/entrada únicamente tras esa autenticación. No existe RPC de shell, ruta arbitraria de ejecutable, escritura arbitraria de archivos o carga de DLL indicada por el controlador.

| Plataforma | Supervisor y captura/entrada propuestos |
|---|---|
| Windows | Servicio SCM en contexto adecuado, sin interfaz en sesión 0; trabajadores limitados a la sesión interactiva y escritorio actual. Adaptador Win32 con captura nativa y `SendInput`; el trabajador del escritorio seguro necesita el contexto autorizado por Windows. Probar DXGI y recuperación de cambio de escritorio. No ejecutar toda la app como administrador. |
| macOS | Daemon supervisado por launchd y trabajador/adaptador nativo por contexto permitido, con puente Swift/Objective-C para las APIs de macOS. Probar captura/entrada autorizadas en sesión, bloqueo y `loginwindow`; registrar helpers con los mecanismos compatibles con la versión del sistema. Un daemon no elimina TCC ni garantiza captura de `loginwindow`. |
| Mint | Unidad systemd y trabajadores por sesión/asiento X11, con acceso acotado a las credenciales Xauthority de LightDM y del usuario; detectar cambios de sesión mediante logind. Captura X11 y entrada XTest; transferencias y portapapeles con identidad del usuario. Nunca `xhost +` ni Electron como root. |

La alternativa «abrir Electron como administrador» mejora solo algunas ventanas Windows y no resuelve arranque, sesión 0, cierre de sesión ni permisos macOS. Un servidor RDP/VNC independiente obligaría a cambiar autenticación, transporte y posiblemente escritorio físico; se descarta como sustitución silenciosa. Si el prototipo macOS requiere integrar un servicio nativo de Apple en lugar del trabajador propuesto, volver a revisión de diseño antes de construir esa integración.

### D2. Mantener WebRTC y una única autoridad del host

Trabajador nativo con un adaptador C++ sobre libwebrtc, versión fijada y dependencias/licencias documentadas. Conservar negociación ICE, relé TURN y vectores v1. La primera prueba debe demostrar oferta/respuesta, vídeo, canales y prueba DTLS/HMAC contra Electron y Flutter empaquetados; un ejecutable que solo captura imagen no satisface esta condición. Si no es viable, detener la fase común y revisar la elección, sin sustituirlo por un transporte propio.

- **Windows:** codecs y captura deben funcionar al cambiar a UAC y volver, recreando la captura cuando cambia el escritorio.
- **macOS:** probar el trabajador en las identidades y sesiones de launchd reales; no depender de Chromium oculto para `loginwindow`.
- **Mint:** volver a resolver display/Xauthority al cambiar LightDM ↔ Cinnamon, sin reutilizar credenciales del usuario saliente.

Un alta exitosa transfiere la propiedad de la identidad estable del equipo al agente. Un bloqueo local y el estado de propietario en la API evitan que el `HostService` anterior compita con él. Mientras esté dado de alta, el backend rechaza mutaciones del host por el flujo legado para ese identificador; los controladores antiguos pueden seguir conectándose en modo compatible. La baja devuelve explícitamente el control al modo de usuario, nunca por una caída temporal del agente.

### D3. Credencial de agente y autorización renovable

Contrato aditivo propuesto:

| Operación | Autorización y alcance |
|---|---|
| `POST /api/devices/{id}/agent-enrollments` | Token de cuenta + clave del propio equipo; crea autorización de un solo uso y 5 minutos, vinculada a la sesión origen. |
| `POST /api/host-agent/enroll` | Canje atómico del alta; emite una credencial opaca distinta de `acs_…`. |
| `PUT /api/host-agent/device` | Credencial de agente; actualiza solo su estado/capacidades, no la propiedad. |
| `GET /api/host-agent/remote-requests` | Credencial de agente; heartbeat y solicitudes del propio equipo; respuesta con vigencia de autorización. |
| `PUT /api/host-agent/remote-requests/{id}/answer` | Credencial de agente; valida que la solicitud corresponde a su equipo. |
| `GET /api/host-agent/ice-servers` | Credencial de agente; misma cuota TURN de la cuenta. |
| `DELETE /api/devices/{id}/agent` | Token de cuenta propietaria o credencial del propio agente; revocación idempotente. |

Autenticador independiente, denegado por defecto fuera de esas rutas; no convertir el agente en `ROLE_USER` con acceso general. Persistir hashes, vínculo a usuario/equipo/sesión origen, fechas y revocación. Reutilizar límites globales por equipo/cuenta, el interruptor `REMOTE_ENABLED` y la limpieza de solicitudes. Migraciones aditivas; no cambiar `CONNECTIONS_KEY` ni tocar secretos de conexiones.

El agente consulta cada 3 segundos y cada respuesta válida mantiene una autorización local de hasta 30 segundos con reloj monotónico. Sin renovación no hay nuevas conexiones y termina cualquier sesión activa al vencer. Cierre, caducidad o invalidación de la sesión de cuenta origen revoca el alta; el uso del agente no debe resucitar ni renovar una sesión origen ya inválida. La caducidad propia del agente se desliza con uso válido hasta 90 días de inactividad. Registrar el vínculo permite incorporar la revocación a logout, cambio/restablecimiento de contraseña y borrado de cuenta, incluidas sesiones remotas ya abiertas.

Esta política se aplica igual en Windows, macOS y Mint: un corte de la API superior a 30 segundos corta incluso una conexión P2P que aún tiene red. Es un coste explícito de la revocación acotada, a revisar con el propietario. No se guarda contenido remoto ni credenciales de sistema en la API.

Implementación parcial de D3: `agent-api` usa un único carril HTTP aislado del
actor de autorización, con una consulta y respuesta acotadas. Se eligió ureq
2.12.1 (TLS sin características por omisión), serde/serde_json y url fijados
para conservar Rust 1.75 sin añadir un runtime asíncrono; reqwest/Tokio y un
proceso externo libcurl se descartaron por coste de integración o gestión de
credenciales entre procesos. Cargo.lock fija también las transitivas compatibles.
No cambia aún la elección candidata de libwebrtc.

El origen HTTPS pertenece a configuración protegida. No se siguen
redirecciones ni proxies de entorno; se mantienen verificación TLS y raíces
de rustls. Respuesta limitada a 8 MiB + 64 KiB, esquemas cerrados y solicitudes
acotadas. La fecha del servidor no extiende el plazo monotónico. 401/403 corta e
inhabilita; 429 respeta la espera y los demás fallos no renuevan. DNS puede
superar el timeout de la biblioteca; solo queda ese hilo pendiente mientras el
actor caduca/corta. La recuperación del proceso bloqueado exige el supervisor
que sigue pendiente. No marcarlo como disponibilidad o revocación P2P finales.

El ejemplo optativo `lab-http` usa únicamente loopback literal y credenciales
efímeras por stdin para probar el contrato real local, sin cambiar la API de
producción ni las cuentas existentes. No habilitar esa característica en los
paquetes del servicio. El ejemplo aún simula la frontera de autenticación y
su hijo carece de captura/entrada. Sus pruebas no certifican plataformas.

El cliente incluye ahora otro carril para ICE, respuesta SDP y rechazo ocupado,
con un trabajo/respuesta en vuelo. Sus respuestas no renuevan autorización;
TLS, origen protegido, límites y ausencia de redirecciones se mantienen. El ID
de la oferta seleccionada no sale de Rust hacia el adaptador. La oferta se
consume una vez y el reto se emite tras confirmar su respuesta por API. El TTL
ICE se cuenta desde el inicio del trabajo. La señalización de laboratorio
ya no necesita archivos SDP; queda pendiente el bucle de servicio/estado del
host y la integración de sus trabajadores del SO.

El ensayo `agent-x11-lab` desarrolla una base nativa de captura/entrada dentro
de un proceso exclusivo de VM, con hilo Xlib y cola de capacidad uno. Solo usa
una ventana propia pública, un clic y tecla fija; no selecciona otro XID ni
acepta texto/comandos arbitrarios. Exige prueba v1, permiso API y contexto X11
propio desbloqueado. Un error es terminal y parar marca un flag sin bloquear
al actor. El driver comprueba caducidad real de API y arranque rechazado con
Cinnamon activo. No es todavía el trabajador P2P Linux separado de D1 ni un
servicio systemd; faltan integración del flujo y entrada sostenida/liberación
por otro proceso tras caída. No cambia la revisión pendiente del agente Mac.

### D4. Secretos, IPC y traspaso transaccional

El diagnóstico `agent-webrtc-lab` enlaza verificador, renovación y trabajador
C++ con una ABI C optativa ausente en el build por omisión. Solo HTTP loopback,
credenciales efímeras y K pública del vector; nunca debe instalarse como servicio.
Un registro acotado de identificadores no reutilizados sustituye punteros de
instancia en la ABI. `unsafe` se limita a buffers válidos del llamador C++
compilado; no es una interfaz apta para IPC o entrada directa de red.

El target Mac usa dylib y compilador Rust del checkout fijado de WebRTC, para
no mezclar bibliotecas estándar estáticas. Autoriza la API antes de crear la
PeerConnection y consume el resultado v1 antes de añadir vídeo artificial;
el adaptador cierra fuente/canal/transporte al caducar o revocarse. Consulta
cada 50 ms. La variante supervisada añade vigilancia independiente en dos
procesos sin privilegios, con pulsos de vida de dos segundos y corte sin
destructores C++ al perder al supervisor. Solo su actor de autorización
completa los pulsos del trabajador; el lector de pipes no los sustituye.
No implementa todavía supervisor de servicio, IPC autenticado ni liberación
de entrada del SO tras morir el proceso. Su prueba no certifica el
servicio, captura/entrada ni la matriz de plataformas de D1/D2.

Implementación parcial de autenticación: `agent-auth` es un componente Rust
reutilizable por el trabajador confiable; su enlace al adaptador C++/DTLS es
todavía de laboratorio y no cambia las fronteras de D1. Usa ring/HMAC-SHA256 y base64 ya fijados
en el grafo de TLS, comprueba vectores v1 y acepta K aprovisionada con parámetros
actuales. El resultado no serializable se consume para esa conexión. Un estado
de autenticación recibido por IPC sin verificar no concede captura/entrada.

El contrato del registro de intentos reserva durablemente un fallo antes de
verificar y lo borra solo tras éxito y escritura confirmada. Una caída puede
consumir un intento. La carga ausente/corrupta, la escritura fallida o la hora
local retrocedida deniegan acceso; no se reinicia el contador por defecto.
El ejemplo entre procesos solo usa un diario efímero de laboratorio. Quedan
almacenes protegidos y exclusión por host de cada SO, migración transaccional,
autenticación del IPC y conexión con el trabajador real antes de cerrar 3.2.

El alta, ejecutada con autorización inicial del sistema, entrega al almacén protegido identidad del host, credencial limitada, K y parámetros de contraseña, opciones y bloqueo vigente. No entrega el token de cuenta, conexiones S3/SSH ni contraseñas del sistema. La interfaz solo recibe estado y resultados; el trabajador recibe únicamente los secretos que necesita.

| Plataforma | Protección e IPC |
|---|---|
| Windows | Directorio y claves con ACL exclusivas del servicio/administradores; cifrado del sistema bajo la identidad del servicio. Named pipes con DACL, autenticación del proceso/usuario llamante y protocolo acotado. DPAPI de máquina sin ACL no basta. |
| macOS | Almacén del sistema con acceso restringido a la identidad autorizada del helper; XPC con validación del par y de su identidad de código. Verificar acceso tras arranque sin aviso interactivo. La firma ad-hoc actual no se acepta como prueba de identidad estable entre versiones. |
| Mint | Clave local del servicio y configuración cifrada bajo directorio root no accesible a otros usuarios; socket Unix con permisos y validación de credenciales del par. No usar como dependencia un keyring de usuario todavía bloqueado. |

Autenticar al par no basta para dar autoridad administrativa: distinguir consulta de estado, corte local de sesión y operaciones de configuración. Alta, cambio de propietario, reactivación y sustitución de binarios requieren autorización administrativa local y el vínculo de cuenta pertinente. Un renderer comprometido no debe obtener ejecución arbitraria del broker.

Secuencia: preparar almacén → canjear alta → comprobar salud y nueva identidad → transferir propietario en la API y parar host legado → confirmar configuración local. Si falla, revocar el alta y volver al modo previo. No borrar el original hasta verificar el traspaso; no copiar secretos a logs o archivos temporales en claro. Cambiar contraseña actualiza K en el agente y corta sesiones; iniciar otra cuenta limpia el vínculo anterior antes de activar nada.

### D5. Escritorios, credenciales y comandos

Estados comunes: `user_desktop`, `locked`, `login`, `secure_prompt`, `transition`, `unavailable`. El host verifica el contexto en origen, libera entrada pendiente y suspende audio, ficheros y portapapeles antes de pasar a una pantalla protegida. Cambiar de usuario o reiniciar exige otra conexión autenticada con nonce y huellas nuevos. Un cambio UAC del mismo usuario no reutiliza teclas pendientes ni pierde la autenticación de la sesión.

En Windows se añade una operación de atención segura por mecanismo admitido por el sistema, no un atajo de `SendInput`. En macOS se usan solo diálogos compatibles y autorizados; ni root ni el control remoto garantizan interacción con todas las protecciones del sistema. En Mint se controla polkit y LightDM en el escritorio físico; no se crea una sesión RDP distinta. Los cambios de escritorio requieren pruebas de coordenadas, monitores y escalado.

Comandos enumerados: bloquear, cerrar sesión del sistema, reiniciar, atención segura. Solo se admiten después de autenticar y si el host los anuncia; tienen id de petición, resultado y deduplicación para impedir dos reinicios por reintentos. Reiniciar usa el mecanismo normal del sistema, sin forzar cierre de aplicaciones. Un comando rechazado no deja el visor esperando un reinicio ficticio.

La contraseña del sistema se escribe directamente en su interfaz por el canal cifrado; el agente no la interpreta ni registra. No se capturan trazas de teclas ni pantallas de credenciales en evidencias de pruebas. Los archivos siguen limitados a la identidad del usuario conectado, incluso cuando el capturador tiene más privilegios.

### D6. Compatibilidad y experiencia del controlador

La revisión 1 concreta de esta extensión está en
[`src/shared/remote/agentProtocol.md`](../../../src/shared/remote/agentProtocol.md):
negociación mutua posterior a autenticación, sobre `v:1`/`extension:1`, límite de
2048 bytes y esquemas cerrados. Los analizadores TypeScript/Dart están preparados;
su integración con ejecución, deduplicación y visor sigue pendiente.

Ampliar de forma opcional la respuesta de equipo con modo, versión de agente y capacidades. Anunciar extensiones del canal de control sin alterar mensajes v1 existentes: capacidades/contexto/operación/resultado con validación estricta y tamaño acotado, enviados solo cuando se negocian. Un mensaje desconocido no autoriza funciones. Si se necesita alterar autenticación o semántica existente, definir v2 y compatibilidad explícita en Rust, TypeScript y Dart antes de activarlo.

Electron y Flutter muestran capacidades reales, confirmación de cierre/reinicio y espera en primer plano de hasta 5 minutos con consulta moderada de estado; solo crean una nueva solicitud cuando el equipo vuelve en línea y disponible. Siempre exigen prueba nueva tras reinicio. El móvil conserva el límite actual de 30 segundos al pasar a segundo plano.

En Windows, Mac y Mint la interfaz mantiene su funcionamiento actual sin servicio. Las diferencias administrativas viven en el host remoto, no en los permisos del dispositivo controlador. El diagnóstico distingue instalación correcta de capacidad efectivamente certificada. Si «Pedir confirmación en este PC» está activo, se explica su incompatibilidad práctica con dejarlo solo y el propietario elige; nunca se desactiva sin su decisión.

### D7. Instalación, firma y actualizaciones

| Plataforma | Distribución propuesta |
|---|---|
| Windows | Instalador de componente por máquina con elevación inicial, servicio y ejecutables en rutas no escribibles por usuario. Conservar NSIS fijado del proyecto. No convertir automáticamente una instalación por usuario en servicio. |
| macOS | Paquete/helper con identidad estable, autorizaciones y proceso de distribución demostrado en las versiones objetivo. La vía de firma/distribución debe resolverse antes del piloto: no asumir cuenta Apple Developer disponible ni auto-update de Mac con firma ad-hoc. |
| Mint | Paquete `.deb` para el agente, unidad systemd y configuración de integración LightDM propia y reversible; no sobrescribir su configuración global. AppImage permanece como interfaz, no como servicio ejecutado desde una ruta del usuario. |

Todos los paquetes incluyen un manifiesto de versiones y compatibilidad protegido por firma de publicación; la clave de firma no se entrega al cliente. El actualizador privilegiado solo verifica e instala componentes autorizados, usa archivos no escribibles por usuarios ordinarios, evita enlaces/rutas externas y conserva la versión anterior hasta pasar salud. No instalar durante una sesión; posponer o pedir corte explícito. Rollback conserva formato legible por la versión anterior y nunca reinstala una credencial revocada. Una nueva autorización de permisos requiere intervención explicada.

## Risks / Trade-offs

- **Acceso Mac a bloqueo/entrada sin sesión no demostrado** → condición de viabilidad temprana en hardware y paquete reales. Si falla, detener esa parte y revisar la propuesta; no declarar completo el alcance de los tres SO reduciéndolo a escritorio abierto.
- **Dependencias nativas/WebRTC y cadena de compilación nuevas** → fijar versiones, revisar licencias, reproducir builds en CI, comprobar tamaño/rendimiento e interoperabilidad antes de desarrollar la interfaz final.
- **Privilegios persistentes** → broker mínimo, autenticación local, rutas protegidas, comandos enumerados, análisis de paquetes y pruebas negativas desde un usuario sin privilegios.
- **Permisos macOS perdidos tras actualizar** → certificar instalación y actualización consecutivas con identidad de distribución real. Documentar cuando una autorización necesita intervención presencial.
- **Pérdida de API durante una conexión válida** → caducidad de 30 segundos; revisión expresa del compromiso de disponibilidad antes de implementar.
- **Equipo sin pantalla activa o suspendido** → no prometer disponibilidad; probar el uso con monitor apagado y registrar si el hardware conserva una salida capturable. Pantallas virtuales y despertar desde apagado no forman parte del cambio.
- **Cambio de servidor X o hook de LightDM fallido** → integración reversible y tolerante al fallo; nunca impedir iniciar sesión por un fallo del agente.
- **Configuración histórica de OpenSpec desfasada** → actualizar su contexto factual como tarea de implementación/documentación; en esta propuesta solo se crean artefactos del cambio.

## Migration Plan

**Orden actualizado con el propietario el 25/10/2026:** avanzar el núcleo común
y su integración en las VM administrables antes de pedir más repeticiones
físicas. La aceptación física se concentra al final, sin eliminar criterios ni
anunciar capacidades por haber pasado en VM. La revisión Mac sigue siendo
condición para su agente final. El núcleo inicial `agent/` aplica vigencia desde
el comienzo de petición, referencias por instancia y relojes que cuentan
suspensión; todavía requiere conectar API, autenticador v1, trabajadores y
watchdog real. No adopta libwebrtc ni modifica permisos por sí mismo.

1. **Revisión conjunta:** aceptar objetivos, exclusiones y comportamiento al salir/revocar. Inventariar versiones/arquitecturas de Mac y Windows y confirmar cómo se distribuirá el helper de Mac antes de implementar allí. El inventario afina las configuraciones certificadas, no habilita plataformas sin pruebas.
2. **Pruebas de viabilidad por plataforma:** UAC/entrada en Windows, autorización/bloqueo/`loginwindow` en Mac y LightDM/Cinnamon en Mint, más WebRTC/vectores v1 en Electron y Flutter. Cada prueba registra el resultado y el artefacto probado. Cualquier fallo arquitectónico vuelve a revisión; no se sustituye por un TODO de publicación.
3. **Backend aditivo:** migraciones y rutas nuevas primero, pruebas y despliegue por Jenkins conservando la versión de PHP y `--pull` exigidos. Los clientes anteriores siguen operativos. No dar de alta agentes reales todavía.
4. **Agente y controladores de prueba:** comprobar seguridad, traspaso, revocación y rollback con backend de desarrollo. Publicar solo artefactos de prueba identificados, sin activar instalaciones existentes.
5. **Piloto del propietario:** instalar voluntariamente en un Windows, un Mac y el Mint comprobado, con acceso alternativo disponible. Desde otra red y escritorio/móvil, ejecutar la matriz de aceptación; reinicios y cambios de sistema se coordinan con el propietario.
6. **Publicación:** anunciar únicamente configuraciones verificadas y sus límites. No declarar terminada esta propuesta hasta validar las tres plataformas acordadas; si se desea una entrega parcial, revisar explícitamente su alcance.
7. **Rollback:** revocar altas, detener/desinstalar el componente nuevo y restaurar el modo de usuario; conservar conexiones. Revertir binarios mediante el actualizador verificado. Las migraciones aditivas pueden permanecer; antes de restaurar un backend que no valida agentes, terminar/revocar agentes activos para no depender solo de su desconexión por plazo.

### Matriz mínima de aceptación

Para cada host: app cerrada, bloqueo, pantalla de entrada, administración real, cancelación de autorización, cierre/entrada de usuario, cambio de usuario, reinicio y caída del proceso; red directa y solo TURN; controlador de escritorio y Android/iOS; rechazo de contraseña, revocación en línea/sin API y cliente anterior. Objetivos de recuperación: host disponible ≤120 segundos tras sistema/red listos; revocación ≤30 segundos; espera del controlador ≤5 minutos. No tomar esos números como medidas ya obtenidas.

Condiciones específicas: UAC con credenciales y atención segura en Windows; permisos, diálogos y actualización de helper en Mac; polkit, greeter y renovación de Xauthority en Mint. Registrar incompatibilidades de versiones/hardware antes de anunciar «preparado para viajes».

### Fuentes técnicas consultadas

- [Microsoft: SendInput y UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
- [Microsoft: separación de servicios y sesión interactiva](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services).
- [Microsoft: DuplicateOutput y acceso al escritorio seguro](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput).
- [Apple: SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice) y [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit). Documentan helpers/captura; no demuestran por sí solos captura de `loginwindow` por esta arquitectura.
- [Apple: desbloquear FileVault por SSH en configuraciones compatibles](https://support.apple.com/es-es/guide/security/sec8447f5049/web). Requiere conectividad independiente disponible antes del agente; no implica que el TURN de AbsorConnect alcance el equipo en prearranque.
- [systemd.service](https://www.freedesktop.org/software/systemd/man/systemd.service.html) y [configuración LightDM](https://wiki.freedesktop.org/www/Software/LightDM/CommonConfiguration/).
