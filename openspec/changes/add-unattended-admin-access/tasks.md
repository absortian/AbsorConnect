# Tasks

Implementación y despliegue autorizados por el propietario el 22/10/2026 y continuación solicitada el 23/10/2026. Aplicación iniciada: las tareas 1.1–1.6, 11.6 y la verificación automatizada tienen avances parciales documentados en `verification.md`; no se marcan completas hasta cumplir todos sus criterios. Las pruebas de viabilidad son condiciones para continuar, no una certificación ya obtenida. Si obligan a cambiar arquitectura o alcance, se revisan estos artefactos antes de seguir.

## 1. Viabilidad y configuraciones objetivo

- [ ] 1.1 Registrar versiones, arquitecturas, cifrado de arranque y opciones de conectividad de los Windows/Mac del propietario y confirmar Mint Cinnamon/X11/LightDM; verificar un inventario privado sin secretos y una matriz pública de configuraciones objetivo sin IPs personales.
- [ ] 1.2 Probar un trabajador Win32 autorizado en sesión interactiva: captura, entrada, aplicación elevada, UAC con credenciales, bloqueo e inicio de sesión; entregar resultados reproducibles y binario de prueba identificado, sin cambiar UAC.
- [ ] 1.3 Probar en Mac un helper empaquetado con launchd y permisos autorizados: escritorio, diálogo de administración, bloqueo, cierre de sesión y `loginwindow`; entregar resultados por versión/arquitectura. Si falla entrada/captura, volver a revisión antes de desarrollar su agente final.
- [ ] 1.4 Probar en Mint los cambios LightDM ↔ Cinnamon y bloqueo/polkit con Xauthority limitado; verificar que un fallo del prototipo no impide el inicio de sesión y documentar cómo restaurar la configuración.
- [ ] 1.5 Construir una prueba nativa libwebrtc con adaptador C++ que pase `auth-vectors.json` y conecte con Electron, Android e iOS por red directa y solo TURN; verificar vídeo, entrada y rechazo de autenticación antes de adoptar la dependencia.
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
- [ ] 3.2 Implementar el desafío compatible v1, PBKDF2/HMAC/huellas DTLS, persistencia de intentos y una sesión por equipo; verificar vectores compartidos, prueba repetida, fallo de contraseña, bloqueo después de reiniciar y cero captura/entrada antes de autenticar.
- [ ] 3.3 Implementar las extensiones negociadas de capacidades/contexto/operación/resultado y deduplicación; verificar mensajes malformados, límites de tamaño, comando no anunciado y dos entregas del mismo reinicio con una sola ejecución.
- [ ] 3.4 Añadir renovación de autorización y reloj monotónico; verificar con reloj/red simulados que una sesión P2P termina ≤30 segundos tras perder validación, sin aceptar otra sesión hasta recuperar autorización.
- [ ] 3.5 Implementar transición de contexto, liberación de entrada y descarte de portapapeles/transferencias/audio; verificar que el siguiente usuario no recibe contenido del anterior ni imagen presentada como actual durante una transición.
- [ ] 3.6 Añadir registro local acotado y diagnóstico sin contraseñas ni teclas; verificar eventos de inicio/fin/revocación/fallo y documentar cómo extraer un informe sin secretos.

## 4. Agente Windows

- [ ] 4.1 Implementar el servicio SCM, recuperación y creación de trabajadores en sesión/escritorio autorizados; verificar arranque sin inicio de sesión, caída del trabajador y parada explícita que no se reactiva sola.
- [ ] 4.2 Integrar captura e inyección en escritorio normal/seguro y recuperación de DXGI; verificar con paquete real el paso a UAC y vuelta, varios monitores/escalados y cierre/entrada de usuario sin teclas retenidas.
- [ ] 4.3 Implementar atención segura, bloqueo, cierre de sesión y reinicio mediante operaciones enumeradas; verificar éxito/rechazo, cancelación de UAC y rechazo de una orden arbitraria.
- [ ] 4.4 Proteger almacén y named pipes con identidades/ACL adecuadas; verificar desde un usuario local sin privilegios que no puede extraer credenciales, sustituir ejecutables ni ejecutar RPC administrativos. Documentar instalación, permisos y recuperación de Windows.

## 5. Agente macOS

- [ ] 5.1 Implementar supervisor launchd y adaptador Swift/Objective-C conforme al prototipo validado; verificar reinicio, cierre de sesión y disponibilidad sin Electron con el mismo paquete/identidad de distribución.
- [ ] 5.2 Integrar captura/entrada y cambios entre escritorio, autorización, bloqueo e inicio de sesión; verificar esas transiciones en hardware real, sin modificar TCC/SIP ni afirmar soporte de versiones no probadas.
- [ ] 5.3 Implementar almacén del helper y autenticación XPC; verificar acceso antes de iniciar sesión sin avisos de llavero, denegación a procesos ajenos y comportamiento comprensible al perder un permiso.
- [ ] 5.4 Implementar las acciones administrativas admitidas y restauración del aviso local; verificar reinicio, entrada posterior y actualización de permisos. Documentar la matriz certificada y límites de FileVault/red prearranque sin dar por disponible el relé en esa etapa.

## 6. Agente Mint

- [ ] 6.1 Implementar unidad systemd, recuperación y selección de asiento/sesión X11 con logind; verificar arranque hasta LightDM y reinicio del proceso sin sesión de usuario ni Electron.
- [ ] 6.2 Integrar acceso acotado a Xauthority, captura/entrada y transición LightDM/Cinnamon; verificar bloqueo, entrada/salida, cambio de usuario y rechazo de Wayland sin habilitar acceso X global.
- [ ] 6.3 Implementar acciones administrativas y acceso a archivos con identidad del usuario; verificar polkit, reinicio y que Descargas/archivos de root no se ofrecen en el greeter ni en una sesión ordinaria.
- [ ] 6.4 Proteger socket, secretos y configuración del servicio; verificar denegaciones a usuarios locales ajenos, desinstalación y recuperación de LightDM. Documentar los archivos propios creados y su retirada reversible.

## 7. Main: integración Electron y traspaso

- [ ] 7.1 Añadir cliente del agente y estado de propiedad al runtime remoto; verificar en Vitest que abrir/cerrar/reiniciar Electron no duplica equipos ni interrumpe una sesión del agente.
- [ ] 7.2 Implementar alta y migración transaccional de identidad, K, opciones y bloqueo con recuperación; verificar fallos en cada fase, preservación de identidad/contraseña y que el token de cuenta nunca llega al servicio.
- [ ] 7.3 Integrar cambio de contraseña, logout, cuenta distinta, revocación local y desinstalación; verificar corte inmediato local, alta nueva obligatoria y conservación de conexiones S3/SSH.
- [ ] 7.4 Adaptar bandeja y actualizador para separar salir de la interfaz de detener el host; verificar modo legado sin cambios y modo desatendido con estado real, parada explícita y actualizaciones pospuestas durante sesiones.
- [ ] 7.5 Documentar en `AGENTS.md` la propiedad del host y el protocolo local; verificar que los comandos de diagnóstico descritos funcionan en desarrollo y no imprimen secretos.

## 8. Preload y tipos compartidos

- [ ] 8.1 Exponer únicamente estado, alta/baja autorizadas y resultados por canales IPC tipados; verificar remitentes, validación de parámetros, permisos y ausencia de token/K/credencial del agente en los renderers.
- [ ] 8.2 Añadir tipos y analizadores de capacidades, contextos y acciones negociadas en `src/shared/remote/`; verificar rechazo de versiones/mensajes inválidos y pruebas de compatibilidad con v1. Documentar campos y límites nuevos junto al protocolo.

## 9. Renderer y visor

- [ ] 9.1 Añadir Ajustes de acceso desatendido con instalación, elección explícita sobre confirmación local, permisos y estado del agente; verificar recorridos de instalación cancelada, servicio averiado y configuración «requiere intervención».
- [ ] 9.2 Incorporar estado de preparación para viajes, capacidades certificadas y aviso sobre salir de la app; verificar que un equipo sin pruebas no aparece como preparado y que el modo de usuario conserva sus límites.
- [ ] 9.3 Añadir acciones administrativas con confirmación, resultados y espera de reinicio; verificar host anterior sin comandos, rechazo/cancelación, autenticación nueva, vencimiento/cancelación de espera y que no se generan solicitudes mientras está fuera de línea.
- [ ] 9.4 Añadir contexto protegido y revocación desde Equipos; verificar cancelación de funciones sensibles, fotograma desactualizado identificado y revocación del equipo correcto. Añadir textos `es.json`/`en.json` y documentar el uso del visor con capturas de datos de prueba.

## 10. Flutter: controlador móvil

- [ ] 10.1 Extender API/modelos/analizadores de control para capacidades y revocación; verificar `remote_api_test.dart`, `remote_protocol_test.dart` y vectores de autenticación con host legado y nativo.
- [ ] 10.2 Añadir controles administrativos, resultados, contexto protegido y entrada de credenciales; verificar desde Android e iOS UAC, diálogo Mac y LightDM sin portapapeles/ficheros/audio en pantallas protegidas.
- [ ] 10.3 Añadir espera tras reinicio y autenticación nueva manteniendo el límite de segundo plano; verificar vuelta a los 10 segundos, cierre después de 30 segundos y espera/cancelación de 5 minutos en primer plano. Documentar los flujos en `mobile/README.md` con textos en ambos idiomas.

## 11. Empaquetado, CI y documentación operativa

- [ ] 11.1 Producir instalador Windows por máquina con servicio opcional y conservar NSIS fijado; verificar instalación/cancelación/sustitución/desinstalación y ACL de archivos desde un usuario ordinario.
- [ ] 11.2 Producir el paquete/helper Mac según la identidad acordada; verificar instalación y actualización en las arquitecturas certificadas, permisos persistentes o intervención indicada y ausencia de promesas de auto-update no demostradas.
- [ ] 11.3 Producir `.deb` del agente en Linux con unidad e integración LightDM reversibles; verificar instalación, actualización y desinstalación en Mint sin alterar archivos ajenos ni ejecutar una AppImage como root.
- [ ] 11.4 Incorporar manifiestos firmados y actualización transaccional compatible de app/agente; verificar paquete manipulado, enlaces/rutas maliciosos, fallo de salud, rollback y credencial revocada que no revive tras restaurar binarios.
- [ ] 11.5 Ampliar CI para binarios nativos y excluir fuentes/herramientas `agent/` de `app.asar`, empaquetando solo los componentes necesarios; verificar contenido de los paquetes, dependencias/licencias y los builds existentes de escritorio/móvil.
- [ ] 11.6 Actualizar README, instrucciones de viaje, límites por sistema y contexto factual de OpenSpec; verificar que distinguen sesión del sistema/cuenta/interfaz, versiones certificadas, desbloqueo previo al arranque y recuperación por acceso alternativo.
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
