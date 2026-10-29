# Tasks

Implementación y despliegue autorizados por el propietario el 22/10/2026 y continuación solicitada el 23/10/2026. Aplicación iniciada: las tareas 1.1–1.6, 11.6 y la verificación automatizada tienen avances parciales documentados en `verification.md`; no se marcan completas hasta cumplir todos sus criterios. Las pruebas de viabilidad son condiciones para continuar, no una certificación ya obtenida. Si obligan a cambiar arquitectura o alcance, se revisan estos artefactos antes de seguir.

El 25/10/2026 el propietario acordó continuar las partes comunes y la integración
en VM antes del piloto físico. Las tareas 3.1/3.2/3.4 incorporan un núcleo de
autorización parcial en `agent/`; no se marcan completas sin trabajadores,
autenticador, API y watchdog integrados. Se mantienen los criterios físicos y
la revisión de macOS antes de su agente final. El cliente de consulta y el
coordinador de renovación ya tienen verificación con API local y proceso hijo;
siguen pendientes API completa, autenticador, trabajador P2P y watchdog del
servicio. La tarea 3.4 no se cierra solo con el proceso de prueba; su aceptación posterior
añade el gate/API/DTLS y trabajador nativo conectados, con la evidencia del 26/10.

Avance cerrado: **29/57 tareas (51 %)**. Es proporción de tareas aceptadas, no
porcentaje del tiempo restante. La tarea 3.2 se acepta como protocolo común:
vectores compartidos, HMAC/huellas aplicadas, intentos durables/reinicio, sesión
única y denegación de captura/entrada antes de autenticar, con integración IPC
Linux en VM. No acepta los almacenes/IPC ni trabajadores finales de Windows y
Mac, la migración de Electron o los contextos generales: conservan sus tareas
4.4/5.3/7.2/6.2 y el piloto físico pendientes. La aceptación posterior se detalla
en `protected-native-results.json` y `verification.md`.

El enlace de laboratorio inicial verificó Rust + autorización API + autenticación
DTLS/HMAC + vídeo artificial con Electron y corte del transporte. No cerró
3.1/3.2/3.4: faltan almacenes/IPC protegidos, señalización completa, trabajador de
captura/entrada, supervisor de servicio/IPC protegido y matriz del resto de
plataformas. El supervisor independiente optativo de laboratorio añade corte
por bloqueo/caída en ambos sentidos, sin cerrar estas tareas ni certificar
liberación de entrada del SO tras una caída.

El 26/10/2026 la señalización del laboratorio pasa por la API real (oferta,
ICE, respuesta y rechazo ocupado), sin archivos SDP. El trabajador X11 inicial
captura una ventana propia e inyecta un clic/tecla en la VM con gate/verificador
y corte por API; también rechaza el salvapantallas activo sin captura/entrada.
La variante posterior `native-fixture` une el trabajador a VP8/WebRTC Linux
y a una unidad transitoria systemd de usuario. Se verifican seis casos con
captura/entrada, autenticación rechazada, revocación/caducidad y bloqueo de la
VM, además de recuperación/parada/cgroup con procesos artificiales.
La tarea 3.4 se acepta por sus criterios de núcleo común: reloj/red simulados,
corte P2P real ≤30 s y denegación sin validación nueva. No acepta servicios
finales ni la matriz completa: 3.1/3.2/3.5/6.1/6.2 siguen parciales por IPC,
almacenes, contexto/entrada generales y arranque en LightDM pendientes.
Solo se cierra 3.4; las pruebas parciales restantes no aumentan el porcentaje.

La siguiente integración del 26/10 añade el broker persistente y una unidad del
sistema en la VM: dos trabajadores artificiales sucesivos con el mismo broker,
caída del supervisor con limpieza del cgroup, corte por bloqueo del broker,
recuperación, parada explícita, arranque idle en LightDM y arranque en frío.
Los intentos y la revocación sobreviven al reinicio. Se repiten seis casos P2P
nativos bajo ese servicio y se verifica su registro de eventos acotado.
Se acepta **3.6**: enum sin texto libre, 64 registros/16 KiB, secuencia persistente,
rotación/reapertura/denegaciones, eventos reales de inicio/fin/rechazo/fallo/
caducidad/revocación y extracción documentada sin secretos. No cierra 3.1/3.2/
3.5/6.1/6.2/6.4: K pública y HTTP local de laboratorio, identidad aún compartida
con el escritorio, contextos protegidos/captura general y paquete final pendientes.
El reinicio en caliente de QEMU/HVF se detuvo en UEFI; solo se acepta el arranque
en frío. La revisión Mac y el piloto físico permanecen pendientes.

La integración del 27/10 añade un laboratorio independiente de credenciales e
IPC: alta `ace_` canjeada por el instalador nativo, K aleatoria del host y token
`acg_` cifrados con AES-256-GCM, cuenta de servicio distinta del escritorio,
LoadCredential y socket activado por systemd con SO_PEERCRED/PID de unidad.
Se comprueban compensación de alta fallida, denegaciones locales, repetición,
estado ausente/corrupto/manipulado, bloqueo persistente y revocación terminal.
La sonda solo incrementa un contador, con huellas fijas de diagnóstico; aún no
está unida al trabajador DTLS/captura/entrada. No cierra 3.2/6.4/7.2, ni cambia
el 10/57 aceptado. Véanse `protected-ipc-results.json`, `verification.md` y
`agent/linux-secure-lab/README.md`. Se mantiene el piloto físico para el final.

La siguiente integración del 27/10 une esos componentes con huellas aplicadas
reales de libwebrtc, claves únicas, captura/entrada de ventana propia y watchdogs
IPC/systemd. Prueba dos conexiones sucesivas con el mismo broker y nonce nuevo,
rechazo de credenciales/huellas, cierre por API, contexto bloqueado y fallo de
procesos. Junto a vectores/repetición/bloqueo persistente y denegaciones IPC,
se acepta **3.2 para el núcleo común**. El 19% no anuncia acceso completo a tres
SO; el resto de agentes, instalación, migración y piloto sigue pendiente.

El siguiente bloque del 27/10 acepta **3.3, 7.5, 10.1 y 11.6**. Añade protocolo
Rust negociado y caché acotada sin desalojos; ocho pruebas comunes, incluidos
revocación/plazo y dos reinicios con un solo efecto artificial, más diez casos
WebRTC de ventana propia. El host de VM declara cero acciones y las rechaza:
no certifica reinicios administrativos del SO. El móvil reconoce agentes y su
baja contra la API real conservando los demás equipos/conexiones. La guía de
viajes, el contexto de OpenSpec y los diagnósticos distinguen lo declarado de lo
certificado. Evidencia: `negotiated-control-results.json` y `verification.md`.
La preparación visual y la revocación de Equipos son avances parciales de 9.2/9.4;
salud/reconexión por equipo y contexto protegido completo siguen pendientes.
El objetivo solicitado de 50 % **todavía no se ha alcanzado**; no se modifica el
denominador ni se cierran tareas de sistemas/paquetes/piloto por estas pruebas.

El bloque posterior del 27/10 acepta **1.5**: adaptador C++/libwebrtc fijado,
vectores compartidos y 54 casos de ventana propia Linux en nueve combinaciones
Electron/Android/iOS × directo/TURN UDP/TLS. El directo Android usa NAT UDP
loopback explícito entre las VM, sin acreditar traversal automático en redes
reales. La autenticación rechazada produce cero captura/entrada. Se verifica
reconexión con broker persistente/nonce nuevo y retirada de servicios/secretos.
La matriz y sus límites están en `native-mobile-input-results.json`. No acepta
contextos protegidos, servicios finales, firma Mac ni piloto físico. El avance
pasa a **16/57 (28 %)** y continúa por debajo del 50 % solicitado.

El bloque del 28/10 acepta **9.4** para el controlador de escritorio: negociación
postautenticación, contexto/secuencia, ocultación de imagen anterior, retirada
de capacidades y cancelación de funciones/esperas sensibles; integra la baja
exacta verificada en los bloques anteriores. Se prueba con el visor de producción
y WebRTC local artificial, más carreras de buffer/guardar/carpeta y pruebas de
propiedad/baja. No acepta el aislamiento de captura/entrada del host (3.5),
transiciones físicas ni Flutter (10.2). Tras un cambio, contenido sensible exige
reconectar por la ausencia de etiquetas de contexto en v1. Evidencia:
`viewer-context-results.json`. El avance pasa a **17/57 (30 %)**; el 50 % sigue pendiente.

## 1. Viabilidad y configuraciones objetivo

- [ ] 1.1 Registrar versiones, arquitecturas, cifrado de arranque y opciones de conectividad de los Windows/Mac del propietario y confirmar Mint Cinnamon/X11/LightDM; verificar un inventario privado sin secretos y una matriz pública de configuraciones objetivo sin IPs personales.
- [ ] 1.2 Probar un trabajador Win32 autorizado en sesión interactiva: captura, entrada, aplicación elevada, UAC con credenciales, bloqueo e inicio de sesión; entregar resultados reproducibles y binario de prueba identificado, sin cambiar UAC.
- [ ] 1.3 Probar en Mac un helper empaquetado con launchd y permisos autorizados: escritorio, diálogo de administración, bloqueo, cierre de sesión y `loginwindow`; entregar resultados por versión/arquitectura. Si falla entrada/captura, volver a revisión antes de desarrollar su agente final.
- [ ] 1.4 Probar en Mint los cambios LightDM ↔ Cinnamon y bloqueo/polkit con Xauthority limitado; verificar que un fallo del prototipo no impide el inicio de sesión y documentar cómo restaurar la configuración.
- [x] 1.5 Construir una prueba nativa libwebrtc con adaptador C++ que pase `auth-vectors.json` y conecte con Electron, Android e iOS por red directa y solo TURN; verificar vídeo, entrada y rechazo de autenticación antes de adoptar la dependencia.
- [ ] 1.6 Documentar versiones fijadas, licencias, coste de compilación y vía de firma/distribución del helper Mac; verificar una instalación y una actualización consecutivas con conservación de permisos o intervención correctamente indicada, y resolver con el propietario las decisiones de distribución antes del piloto.

## 2. Backend: identidad y permisos del agente

- [x] 2.1 Añadir alta de un solo uso, credencial hasheada, propietario del host y vínculo a sesión origen con migraciones aditivas; verificar con PHPUnit alta válida, expiración a los 5 minutos y dos canjes concurrentes de los que solo uno tiene éxito.
- [x] 2.2 Implementar las rutas y autenticador limitado de D3; verificar que el agente solo consulta/responde su equipo y recibe denegación en conexiones, cuenta, otros equipos y operaciones de controlador.
- [x] 2.3 Incorporar revocación por propietario, logout, cambio/restablecimiento de contraseña, caducidad de sesión origen y borrado de cuenta; verificar cada evento con pruebas de credencial invalidada y sin posibilidad de renovar el alta revocada.
- [x] 2.4 Añadir capacidades opcionales y autorización de 30 segundos al heartbeat; verificar contratos de clientes anteriores, fechas, límites compartidos por cuenta/equipo y efecto de `REMOTE_ENABLED=0`.
- [x] 2.5 Impedir mutaciones del host por el flujo legado tras transferirlo al agente y devolver la propiedad al darlo de baja; verificar carreras app/agente sin duplicación ni interrupción de otros equipos de la cuenta.
- [x] 2.6 Documentar en el README/backend el contrato del agente y sus códigos de error; verificar ejemplos de acceso permitido/denegado contra el backend de desarrollo, sin tokens reales en documentación.

## 3. Agente común y protocolo

- [ ] 3.1 Crear `agent/` con broker Rust, trabajador y adaptador libwebrtc fijados; verificar compilación de los componentes separados en los sistemas objetivo y documentar sus comandos de desarrollo.
- [x] 3.2 Implementar el desafío compatible v1, PBKDF2/HMAC/huellas DTLS, persistencia de intentos y una sesión por equipo; verificar vectores compartidos, prueba repetida, fallo de contraseña, bloqueo después de reiniciar y cero captura/entrada antes de autenticar.
- [x] 3.3 Implementar las extensiones negociadas de capacidades/contexto/operación/resultado y deduplicación; verificar mensajes malformados, límites de tamaño, comando no anunciado y dos entregas del mismo reinicio con una sola ejecución.
- [x] 3.4 Añadir renovación de autorización y reloj monotónico; verificar con reloj/red simulados que una sesión P2P termina ≤30 segundos tras perder validación, sin aceptar otra sesión hasta recuperar autorización.
- [ ] 3.5 Implementar transición de contexto, liberación de entrada y descarte de portapapeles/transferencias/audio; verificar que el siguiente usuario no recibe contenido del anterior ni imagen presentada como actual durante una transición.
- [x] 3.6 Añadir registro local acotado y diagnóstico sin contraseñas ni teclas; verificar eventos de inicio/fin/revocación/fallo y documentar cómo extraer un informe sin secretos.

## 4. Agente Windows

- [x] 4.1 Implementar el servicio SCM, recuperación y creación de trabajadores en sesión/escritorio autorizados; verificar arranque sin inicio de sesión, caída del trabajador y parada explícita que no se reactiva sola.
- [ ] 4.2 Integrar captura e inyección en escritorio normal/seguro y recuperación de DXGI; verificar con paquete real el paso a UAC y vuelta, varios monitores/escalados y cierre/entrada de usuario sin teclas retenidas.
- [ ] 4.3 Implementar atención segura, bloqueo, cierre de sesión y reinicio mediante operaciones enumeradas; verificar éxito/rechazo, cancelación de UAC y rechazo de una orden arbitraria.
- [ ] 4.4 Proteger almacén y named pipes con identidades/ACL adecuadas; verificar desde un usuario local sin privilegios que no puede extraer credenciales, sustituir ejecutables ni ejecutar RPC administrativos. Documentar instalación, permisos y recuperación de Windows.

## 5. Agente macOS

- [ ] 5.1 Implementar supervisor launchd y adaptador Swift/Objective-C conforme al prototipo validado; verificar reinicio, cierre de sesión y disponibilidad sin Electron con el mismo paquete/identidad de distribución.
- [ ] 5.2 Integrar captura/entrada y cambios entre escritorio, autorización, bloqueo e inicio de sesión; verificar esas transiciones en hardware real, sin modificar TCC/SIP ni afirmar soporte de versiones no probadas.
- [ ] 5.3 Implementar almacén del helper y autenticación XPC; verificar acceso antes de iniciar sesión sin avisos de llavero, denegación a procesos ajenos y comportamiento comprensible al perder un permiso.
- [ ] 5.4 Implementar las acciones administrativas admitidas y restauración del aviso local; verificar reinicio, entrada posterior y actualización de permisos. Documentar la matriz certificada y límites de FileVault/red prearranque sin dar por disponible el relé en esa etapa.

## 6. Agente Mint

- [x] 6.1 Implementar unidad systemd, recuperación y selección de asiento/sesión X11 con logind; verificar arranque hasta LightDM y reinicio del proceso sin sesión de usuario ni Electron.
- [ ] 6.2 Integrar acceso acotado a Xauthority, captura/entrada y transición LightDM/Cinnamon; verificar bloqueo, entrada/salida, cambio de usuario y rechazo de Wayland sin habilitar acceso X global.
- [ ] 6.3 Implementar acciones administrativas y acceso a archivos con identidad del usuario; verificar polkit, reinicio y que Descargas/archivos de root no se ofrecen en el greeter ni en una sesión ordinaria.
- [x] 6.4 Proteger socket, secretos y configuración del servicio; verificar denegaciones a usuarios locales ajenos, desinstalación y recuperación de LightDM. Documentar los archivos propios creados y su retirada reversible.

## 7. Main: integración Electron y traspaso

- [x] 7.1 Añadir cliente del agente y estado de propiedad al runtime remoto; verificar en Vitest que abrir/cerrar/reiniciar Electron no duplica equipos ni interrumpe una sesión del agente.
- [x] 7.2 Implementar alta y migración transaccional de identidad, K, opciones y bloqueo con recuperación; verificar fallos en cada fase, preservación de identidad/contraseña y que el token de cuenta nunca llega al servicio.
- [x] 7.3 Integrar cambio de contraseña, logout, cuenta distinta, revocación local y desinstalación; verificar corte inmediato local, alta nueva obligatoria y conservación de conexiones S3/SSH.
- [x] 7.4 Adaptar bandeja y actualizador para separar salir de la interfaz de detener el host; verificar modo legado sin cambios y modo desatendido con estado real, parada explícita y actualizaciones pospuestas durante sesiones.
- [x] 7.5 Documentar en `AGENTS.md` la propiedad del host y el protocolo local; verificar que los comandos de diagnóstico descritos funcionan en desarrollo y no imprimen secretos.

## 8. Preload y tipos compartidos

- [x] 8.1 Exponer únicamente estado, alta/baja autorizadas y resultados por canales IPC tipados; verificar remitentes, validación de parámetros, permisos y ausencia de token/K/credencial del agente en los renderers.
- [x] 8.2 Añadir tipos y analizadores de capacidades, contextos y acciones negociadas en `src/shared/remote/`; verificar rechazo de versiones/mensajes inválidos y pruebas de compatibilidad con v1. Documentar campos y límites nuevos junto al protocolo.

## 9. Renderer y visor

- [x] 9.1 Añadir Ajustes de acceso desatendido con instalación, elección explícita sobre confirmación local, permisos y estado del agente; verificar recorridos de instalación cancelada, servicio averiado y configuración «requiere intervención».
- [x] 9.2 Incorporar estado de preparación para viajes, capacidades certificadas y aviso sobre salir de la app; verificar que un equipo sin pruebas no aparece como preparado y que el modo de usuario conserva sus límites.
- [x] 9.3 Añadir acciones administrativas con confirmación, resultados y espera de reinicio; verificar host anterior sin comandos, rechazo/cancelación, autenticación nueva, vencimiento/cancelación de espera y que no se generan solicitudes mientras está fuera de línea.
- [x] 9.4 Añadir contexto protegido y revocación desde Equipos; verificar cancelación de funciones sensibles, fotograma desactualizado identificado y revocación del equipo correcto. Añadir textos `es.json`/`en.json` y documentar el uso del visor con capturas de datos de prueba.

## 10. Flutter: controlador móvil

- [x] 10.1 Extender API/modelos/analizadores de control para capacidades y revocación; verificar `remote_api_test.dart`, `remote_protocol_test.dart` y vectores de autenticación con host legado y nativo.
- [ ] 10.2 Añadir controles administrativos, resultados, contexto protegido y entrada de credenciales; verificar desde Android e iOS UAC, diálogo Mac y LightDM sin portapapeles/ficheros/audio en pantallas protegidas.
- [x] 10.3 Añadir espera tras reinicio y autenticación nueva manteniendo el límite de segundo plano; verificar vuelta a los 10 segundos, cierre después de 30 segundos y espera/cancelación de 5 minutos en primer plano. Documentar los flujos en `mobile/README.md` con textos en ambos idiomas.

## 11. Empaquetado, CI y documentación operativa

- [ ] 11.1 Producir instalador Windows por máquina con servicio opcional y conservar NSIS fijado; verificar instalación/cancelación/sustitución/desinstalación y ACL de archivos desde un usuario ordinario.
- [ ] 11.2 Producir el paquete/helper Mac según la identidad acordada; verificar instalación y actualización en las arquitecturas certificadas, permisos persistentes o intervención indicada y ausencia de promesas de auto-update no demostradas.
- [ ] 11.3 Producir `.deb` del agente en Linux con unidad e integración LightDM reversibles; verificar instalación, actualización y desinstalación en Mint sin alterar archivos ajenos ni ejecutar una AppImage como root.
- [ ] 11.4 Incorporar manifiestos firmados y actualización transaccional compatible de app/agente; verificar paquete manipulado, enlaces/rutas maliciosos, fallo de salud, rollback y credencial revocada que no revive tras restaurar binarios.
- [ ] 11.5 Ampliar CI para binarios nativos y excluir fuentes/herramientas `agent/` de `app.asar`, empaquetando solo los componentes necesarios; verificar contenido de los paquetes, dependencias/licencias y los builds existentes de escritorio/móvil.
- [x] 11.6 Actualizar README, instrucciones de viaje, límites por sistema y contexto factual de OpenSpec; verificar que distinguen sesión del sistema/cuenta/interfaz, versiones certificadas, desbloqueo previo al arranque y recuperación por acceso alternativo.
- [x] 11.7 Preparar el despliegue aditivo y rollback del backend por Jenkins; verificar antes/después `/api/health`, clientes anteriores y migraciones, conservando los Dockerfiles PHP y `--pull` exigidos. No activar agentes existentes por el despliegue.

## 12. Verificación integrada y piloto

- [ ] 12.1 Ejecutar `npm run typecheck`, `npm test` y ESLint sobre los archivos TypeScript tocados, sin errores nuevos; registrar comandos/resultados y separar deuda previa de fallos introducidos.
- [ ] 12.2 Ejecutar `docker compose exec php php bin/phpunit`, con base de pruebas preparada, y las pruebas nativas (`cargo test` y las del adaptador); verificar permisos, revocación, concurrencia y protección de secretos con resultados reproducibles.
- [ ] 12.3 Ejecutar `flutter analyze` y `flutter test` desde `mobile/` con el entorno de `mobile/tool/test_env.sh`; verificar builds instalables Android/iOS y conexión a cada plataforma del host.
- [ ] 12.4 Con el propietario, ejecutar el piloto Windows/Mac/Mint desde una red exterior: interfaz cerrada, bloqueo, administración, cierre/entrada, cambio de usuario, reinicio y vuelta ≤120 segundos tras sistema/red disponibles; registrar resultados por host/controlador y transporte directo/TURN sin capturar credenciales.
- [ ] 12.5 Comprobar revocación local/remota y sin API ≤30 segundos, caída del agente y recuperación, actualización fallida/rollback y cliente anterior; entregar un informe por configuración con los límites detectados y verificar que la interfaz no anuncia capacidades fallidas.
- [ ] 12.6 Ejecutar `openspec validate add-unattended-admin-access --strict` y revisar cada escenario con su evidencia; verificar que no se da por completo el alcance de tres plataformas ni se publica acceso completo con pruebas pendientes.

## Workflow follow-up

- El propietario autorizó iniciar `/opsx:apply` e implementar/desplegar el 22/10/2026; mantener los criterios de verificación y coordinar las pruebas que bloqueen, cierren sesión o reinicien sus equipos.
- Tras implementar y verificar, revisar el resultado y la publicación por los canales existentes. Archivar con `/opsx:archive` solo cuando se haya satisfecho el alcance acordado.


El 28/10 se añadió el visor Flutter completo con contexto y descarte de funciones
sensibles, doce casos reales de vídeo/entrada en AVD/iPad y directo/UDP/TLS,
y 178 pruebas Flutter. Evidencia en `mobile-context-results.json`. Es avance
parcial de 10.2; las acciones administrativas y pantallas protegidas siguen
pendientes. Se mantiene **17/57 (30 %)**, sin adelantar la certificación del host.


El 28/10 se acepta 9.3 con `viewer-actions-results.json`: operaciones y resultados
correlacionados, confirmación invalidable, espera cancelable acotada, nueva prueba
y cero ofertas fuera de línea en el visor real con host simulado/WebRTC. Esto
acepta el controlador; no las operaciones del SO de 4.3/5.4/6.3 ni el piloto.
Avance **18/57 (32 %)**; continúa por debajo del 50 % solicitado.


El bloque móvil del 28/10 acepta **10.3**: acciones confirmadas y resultados,
espera cancelable de cinco minutos sin ofertas, contraseña nueva tras reinicio
y cierre al superar treinta segundos de segundo plano con reloj continuo.
Se verifican 201 pruebas Flutter con API/SSH/S3 aislados, doce casos de la app real
Android/iPad en directo/TURN UDP/TLS y diez regresiones nativas de Electron/IPC.
En Android/TLS se reproduce además una recuperación automática con el mismo
broker, una segunda solicitud autenticada y un desafío nuevo. Todas las rutas
usan la misma app y artefactos nativos; servicios/secretos/cuentas temporales se
retiran. Evidencia: `mobile-actions-results.json`. La administración del SO no se
simula como certificación: el host de VM conserva NoOperations y captura solo su
ventana. **10.2 sigue parcial**, sin matriz UAC/Mac/LightDM ni piloto físico.
El avance aceptado pasa a **19/57 (33 %)**; el objetivo de 50 % sigue pendiente.


El bloque Linux del 28/10 acepta **6.1**: unidad systemd de selección sin red IP
ni capacidades, consulta logind acotada y asíncrona, parada explícita, watchdog,
recuperación y arranque en frío en LightDM. El broker protegido usa ese mismo
lector y fija la sesión al comenzar HMAC; cambios o caducidad invalidan conexión
y desafío. Se verifican 11 casos de la unidad, 17 de credenciales/IPC con cambios
reales de sesión, 10 regresiones WebRTC de ventana propia y builds/pruebas CI
en Linux/Mac/Windows. Evidencia: `linux-session-service-results.json`.
Se acepta el componente de selección y su integración en el broker, sin cerrar
6.2/6.4: el trabajador general y la entrega de autoridad posterior a HMAC siguen
pendientes. La sonda independiente de memfd/SCM_RIGHTS conserva esos límites en
`linux-authority-fd-results.json`. Avance **20/57 (35 %)**; sigue pendiente el 50 %.


La siguiente integración del 28/10 une HMAC/API con un proveedor root de
Xauthority por descriptor sellado, mediante una concesión de hasta 400 ms ligada
a ambos procesos y al asiento. Pasa 23 comprobaciones y conserva diez regresiones
WebRTC; retira todos sus recursos temporales. La sonda no captura ni envía
entrada y falta el trabajador P2P dedicado: 6.2/6.4 continúan parciales. Evidencia:
`linux-authority-grant-results.json`. Se mantiene **20/57 (35 %)**.


El bloque de identidad dedicada del 28/10 acepta **6.4**, para la protección de
socket/secretos/configuración del servicio Linux ensayado. El perfil root cerrado
separa UID/GID de broker, trabajador y sesión gráfica; las identidades proceden
del núcleo/unidad, no del mensaje. Se verifican 27 casos: credenciales únicas y
cifradas, denegaciones locales y a otro PID del mismo UID, perfil ausente/corrupto/
enlazado/permisivo/con otra identidad sin borrar intentos, retirada de cuenta/
grupo/perfil/drop-ins y recuperación posterior de LightDM. La sonda dedicada
cuenta imágenes 128×72 solo tras HMAC y fd sellado. CI Linux/Mac/Windows y las
23 regresiones IPC y diez P2P del modo anterior pasan. Evidencia:
`linux-dedicated-capture-results.json`. No acepta 6.2, el paquete/migración final,
Windows/Mac o el piloto físico; no anuncia acceso desatendido disponible.
Avance **21/57 (37 %)**; el mínimo de 50 % sigue pendiente.


El siguiente bloque del 28/10 añade concesión por cada HMAC y guardián nativo
Linux de entrada fija con dispositivo propio. Pasan 41 casos de laboratorio,
incluidos diez de liberación y tres de denegación/aislamiento, y siete pruebas
puras de plazo/posesión/secuencia. Se retiran dispositivos, unidades, archivos y
cuentas, con recuperación de LightDM. No une todavía entrada/captura general a
WebRTC ni completa transiciones protegidas: 3.5/6.2 siguen parciales. Evidencia:
`linux-input-lease-results.json`. Se conserva **21/57 (37 %)**; el mínimo de 50 %
continúa pendiente y las pruebas físicas quedan para el final.


El bloque Windows del 28/10 acepta **4.1** para el componente SCM y el trabajador
fijo de metadatos: WTS, Jobs, pipes locales con identidad del kernel, supervisión
independiente y recuperación finita. Pasan 16 casos en la VM ARM64 con binarios
x64 de CI, incluido reinicio sin usuario, caída/bloqueo, parada persistente,
configuración dañada, colisiones y retirada completa con UAC intacto. La sonda
de permisos usa un token restringido del usuario SSH existente; no certifica una
sesión interactiva estándar. CI pasa en los tres sistemas y conserva los límites
sin captura, entrada, API/HMAC o credenciales. Evidencia:
`windows-session-service-results.json`. 1.2/4.2/4.3/4.4 siguen pendientes, al igual
que la revisión Mac y el piloto físico. Avance **22/57 (39 %)**; el mínimo de 50 %
continúa pendiente y se sigue con las partes que pueden verificarse automáticamente.


El siguiente bloque del 28/10 acepta **7.1 y 9.2**. Main consulta un canal local de
estado separado del trabajador, reserva el host antes de registrarlo y conserva
esa reserva ante fallo o pérdida del marcador. Pasan 21 casos IPC y diez WebRTC
con seis ciclos de las clases Main sin privilegios, el mismo broker/equipo y
vídeo continuo. Vitest cubre carreras de arranque/salida, propiedad y remitentes.
No es una prueba del ciclo de una app Electron empaquetada ni del instalador final.
La preparación para viajes diferencia declaraciones y certificación vacía,
propiedad ambigua y límites de salir de la interfaz, con ambos idiomas y las
16 combinaciones de capacidades. CI nativo pasa en Linux/Mac/Windows. Evidencia:
`local-agent-runtime-results.json` y `travel-readiness-results.json`. No acepta
migración/alta/baja local, parada explícita de servicio, actualización transaccional,
servicios finales Windows/Mac ni piloto físico. Avance **24/57 (42 %)**; el objetivo
de 50 % sigue pendiente y se conserva el denominador de 57 tareas.


El bloque del 29/10 acepta **7.4**: bandeja con estado consultado/ambiguo,
salida de interfaz separada de parada y actualización bloqueada antes de resolver
propiedad, durante sesiones y para agentes que aún requieren actualización conjunta.
El canal Linux de parada es distinto de la lectura D10: UID/GID del dueño,
equipo exacto, nonce/plazo y confirmación Main revalidada. El broker corta y
sincroniza el marcador terminal antes de responder. Pasan 25 casos IPC y diez
WebRTC: Main confirma la parada en 178 ms y el visor corta en 406 ms con API sin
respuesta; arrancar el broker no lo reactiva. Se retiran servicios/secretos/cuentas.
Se verifican 374 Vitest, PHPUnit 162/1077 y CI nativo Linux/Mac/Windows.
Evidencia: `local-agent-stop-results.json`. No acepta alta/migración/baja final,
proveedores de control Windows/Mac, actualizador conjunto ni piloto. El modo
legado conserva su salida y el agente no anuncia certificación. Avance **25/57
(44 %)**; el mínimo de 50 % sigue pendiente.


El 29/10 se verifican las bases de 7.2: compensación API por transacción que
preserva autoridades posteriores, once carreras HTTP, journal durable sin secretos
y drenaje del host legado antes de copiar su estado. Pasan 171 PHPUnit/1178,
389 Vitest en Mac, validación de esquema y diez regresiones WebRTC. Windows no
escribe journal hasta contar con adaptador ACL. Evidencia parcial:
`migration-foundation-results.json`. **7.2 sigue sin aceptar** hasta integrar y
verificar importación nativa de K/opciones/bloqueo y recuperación por fase; también
siguen pendientes 7.3/8.1/9.1. Se mantiene **25/57 (44 %)**; el mínimo de 50 % no
se da por alcanzado con estas bases.


El cierre del 29/10 acepta **7.2, 7.3, 8.1 y 9.1** por la integración común de
Main/IPC/UX: coordinador y journal privados, importación real de identidad,
K/opciones/bloqueo en el almacén protegido Linux de VM, recuperación entre dos
procesos Main y compensación exacta antes de volver al legado. Quince escenarios
nativos cubren fallos por fase, bloqueo/reinicio, contraseña antigua/nueva,
cuenta distinta y respuesta de commit perdida durante la salida de cuenta.
La baja de esta transacción retira solo sus unidades/secretos; S3/SSH quedan fuera.

El token de cuenta no llega al servicio ni a renderers. La elección de confirmación
local carece de preselección; Main confirma y vuelve a comprobar frame/cuenta/
destino. React/preload/IPC reales pasan cancelación previa, opciones no soportadas,
preparación/confirmación, baja, avería y recuperación con coordinador ficticio;
el coordinador/servicio se verifican aparte con API/BD y procesos reales en VM.
Pasan diez P2P, seis ciclos Main, 466 Vitest en Linux/Mac (7 omitidas), 421 en
Windows (52 omitidas, incluidos los casos POSIX), PHPUnit 171/1178 y CI nativo
316/278/276 en Linux/Mac/Windows (default + all-features). Los seis registros de
CI y sus anotaciones se revisaron sobre `e5626944ae2b48a166ce31dd90b852e79233a166`.

La aceptación **no habilita ni certifica el proveedor distribuible**, que sigue
indisponible hasta instaladores/ACL/IPC finales. La caja AES de origen del arnés
no acredita DPAPI/Llavero/libsecret; el destino GCM/LoadCredential es real. Siguen
pendientes 4.4/5.3/11.x, entrada/contextos generales, la revisión Mac y el piloto
físico. No se aceptan esas tareas por compilar en CI. Evidencia:
`agent-migration-results.json`. Avance **29/57 (51 %)**: se supera el mínimo
solicitado por tareas aceptadas, sin equivaler al tiempo restante o a producto
listo para viajes. Se conservan los 21 hallazgos npm heredados para su revisión
antes de la release final.
