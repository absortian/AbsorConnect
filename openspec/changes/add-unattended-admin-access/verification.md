# Verificación de acceso desatendido

## Estado al 23/10/2026

Aplicación del cambio autorizada e iniciada. **7/57 tareas completas (2.1–2.6 y 11.7).** El backend del agente está implementado, desplegado y verificado en producción. Hay avances
parciales en 1.1–1.6 y 11.6; no existe todavía un agente operativo ni se ha publicado
una release de acceso desatendido. El despliegue aditivo del backend está documentado
abajo; no instala ni activa agentes en equipos existentes.

Se han implementado herramientas de diagnóstico reproducibles en
`prototypes/remote-desktop/unattended-check/`, separadas de la app instalada. No
instalan un servicio de host remoto. El paquete Mac instala únicamente el
LaunchAgent de diagnóstico descrito abajo. Los inventarios/capturas no cambian
UAC/TCC/LightDM; el preparador UAC de la VM se aplicó tras autorización expresa,
con consulta por defecto y cambios/reinicio mediante opciones explícitas.

## Resultados observados

| Prueba | Resultado | Lo que no demuestra |
|---|---|---|
| Inventario Mac | macOS 27.0.1, arm64, FileVault activado; identidad Apple Development local disponible | Identidad Developer ID, distribución ni permisos del agente |
| Compilación nativa Mac | Swift 6.4; compilación para macOS 13+ y firma ad-hoc verificadas | Ejecución en macOS 13 o arquitecturas diferentes |
| Permisos del prototipo Mac (primera ejecución) | Grabación de pantalla: no; Accesibilidad: no; proceso en sesión de consola iniciada | Captura/entrada, operación launchd, bloqueo ni `loginwindow` |
| Captura nativa Mac ejecutada desde terminal | ScreenCaptureKit recibió 10 fotogramas completos en dos segundos, una pantalla; no se guardó ni transmitió imagen | Permiso propio del helper bajo launchd; entrada, bloqueo ni `loginwindow` |
| Mismo binario Mac bajo launchd, dominio `gui/UID` | Trabajo temporal ejecutado: `screenPermission: false`, `missing_screen_permission`, salida 2; se retiró el trabajo y se comprobó su ausencia | Falta autorizar el helper por sí mismo; no certifica ni descarta la arquitectura de un daemon |
| launchd tras autorización explícita del propietario en Ajustes | Captura correcta: 12 fotogramas con permiso de pantalla; después 11 fotogramas con pantalla y Accesibilidad activas. Trabajo temporal retirado al terminar | No se ha inyectado entrada ni probado un daemon, bloqueo, cierre de sesión o `loginwindow` |
| launchd durante bloqueo coordinado del Mac | Tras bloquear desde la interfaz con autorización expresa, el mismo helper recibió 11 fotogramas completos; el propietario confirmó después el desbloqueo | No se inspeccionaron píxeles ni se obtuvo un indicador independiente del bloqueo: no certifica contenido visible de la pantalla bloqueada, entrada ni `loginwindow` |
| Paquete de diagnóstico `LoginWindow` | Instalado tras autorización expresa del propietario; recibo 0.1.0, firma y hash del binario correctos, archivos root/wheel y directorio de informes 0700; sin scripts, red, entrada ni KeepAlive | La instalación no acredita disponibilidad gráfica ni captura |
| Cierre de sesión real del Mac | Cierre confirmado en la interfaz tras autorización expresa; el propietario volvió a iniciar sesión y facilitó el JSON administrativo: UID 0, `loginComplete: false`, ambos permisos activos, `capture_error`, dominio CoreGraphics, código 1003 | Captura fallida; sin fase de error, duración ni atributo de acceso gráfico de la sesión. No demuestra entrada ni imposibilidad de toda arquitectura de acceso previo al login |
| Segunda captura Mac en `LoginWindow`, diagnóstico 0.2.0 | Informe administrativo facilitado por el propietario: once fotogramas completos en el primer intento, 2390 ms, UID 0, `loginComplete: false`, `onConsole: true`, acceso gráfico y ambos permisos activos, una pantalla | Sin inspección del contenido de los fotogramas, entrada ni transición continua. Los campos `preLoginTested` y `readyForUnattended` siguen en falso; la tarea 1.3 no está completa |
| Bundle instalado bajo launchd del usuario | Once fotogramas completos, permisos de pantalla/Accesibilidad activos, mismo hash firmado que el prototipo inicial; trabajo temporal retirado | No prueba permisos de root/`LoginWindow`, actualización entre versiones ni entrada |
| Inventario Mint | Mint 22.3 x86_64, Cinnamon/X11, LightDM activo, usuario ordinario | Disponibilidad después de reiniciar |
| Conexión X11 de Mint | XOpenDisplay correcto con autorización del propio usuario; extensión XTEST disponible | Inyección de entrada, captura, polkit ni acceso al greeter |
| Inventario Windows | Windows 11 Pro ARM64, build 26300, .NET 4.0.30319.42000; agente de invitado UTM operativo; inventario desde SYSTEM en sesión 0; protección BitLocker Off | No certifica Windows x64, entrada, arranque ni captura de UAC |
| Política UAC de la VM | Tras autorización expresa se activó EnableLUA y se reinició normalmente. Inventario posterior: UAC y escritorio seguro activos; antes EnableLUA=0, PromptOnSecureDesktop=1, ConsentPromptBehaviorAdmin=5 | No demuestra por sí solo captura/entrada ni solicitud de credenciales administrativas |
| VM Windows | Windows 11 Pro instalado con licencia aceptada expresamente; usuario creado por el propietario y escritorio observado tras las actualizaciones iniciales | Estado final de todas las actualizaciones y pruebas administrativas pendientes |
| Trabajador Win32 en consola | Dos capturas correctas desde trabajador separado creado con token SYSTEM en sesión 2: 6 y 7 fotogramas GDI a 320 × 180; todos no uniformes, escritorio `Default` | Sin servicio SCM, entrada, DXGI, UAC, bloqueo ni inicio de sesión. No se guardan imágenes; no certifica su contenido exacto |
| Captura Windows tras reinicio con UAC | Nueve fotogramas no uniformes en `Default`, sesión 1; el sistema informaba usuario interactivo presente | No se certifica arranque sin usuario ni inicio de sesión: Windows ya había entrado en una sesión |
| Captura durante solicitud UAC del propio diagnóstico | Siete fotogramas no uniformes en escritorio `Winlogon`, trabajador SYSTEM separado del solicitante de usuario filtrado | El primer solicitante venció a los 45 s y se retiró. No se inspeccionaron píxeles ni se certifica la imagen exacta del diálogo, entrada Win32 o UAC con credenciales |
| Cancelación de otra solicitud UAC | Escape enviado por UTM; solicitante terminó con código 1223 y volvió el escritorio. En esta repetición el capturador se ejecutó después de cancelar y reportó `Default`, por lo que no se cuenta como otra captura UAC | No prueba que el futuro agente aplique entrada; el control fue el de UTM |
| Entrada Win32 sobre UAC en la VM | Dos ejecuciones de la revisión final: trabajador SYSTEM creado directamente en `winsta0\winlogon`, nueve fotogramas no uniformes, dos eventos Escape insertados por `SendInput`, solicitante propio terminó con 1223 y vuelta observada a `Default`; ningún proceso del diagnóstico quedó activo | Solo Escape y UAC de consentimiento del propio diagnóstico: faltan ratón, credenciales administrativas, bloqueo/login, SCM, DXGI y clientes remotos; no completa 1.2 |
| Captura X11 en Mint | Diez imágenes XGetImage de una región central 128 × 72; las diez no uniformes, usuario ordinario y sesión Cinnamon activa | No prueba pantalla completa, entrada, polkit, bloqueo ni greeter |
| Criptografía C++ con BoringSSL de WebRTC | 3 vectores compartidos correctos, incluidos PBKDF2 de 600 000 iteraciones y HMAC; 5 casos negativos rechazados por vector | Interoperabilidad del transporte, persistencia del bloqueo ni autenticación de un agente final |
| Inicialización libwebrtc | Factoría creada/destruida; conexión/canal de datos y oferta local con huella SHA-256 generados correctamente | No se aplicó la descripción ni se estableció DTLS; faltan otro cliente, vídeo/entrada y TURN |
| Canal nativo C++ ↔ Electron real | Última ejecución correcta: DTLS conectado, prueba válida aceptada, prueba incorrecta y huella cambiada rechazadas; un solo `hello` por conexión. Electron 39.8.5/Chromium 142.0.7444.265, candidatos host/host | No prueba captura real, entrada, TURN, Flutter, credenciales del agente ni revocación; captura y entrada desactivadas en los tres casos |
| Vídeo artificial nativo ↔ Electron | VP8 a 320 × 180: cuatro fotogramas generados tras autenticar, dos decodificados y color rojo verificado. Antes de autenticar no se decodificó vídeo; los casos de prueba errónea y huella alterada generaron/recibieron cero fotogramas | No usa la pantalla del host, no aplica entrada ni prueba TURN/Flutter; no completa 1.5 |

También se ha verificado que el prototipo Mac emite JSON válido, rechaza argumentos
desconocidos con código 64 y rechaza `--capture` sin permiso con código 2 sin iniciar
captura. La sintaxis de Bash, el plist y la sintaxis Python se han comprobado; el
script Python además se ejecutó correctamente en el Mint real. La validación
estricta de OpenSpec pasa. El 22/10 no se ejecutaron pruebas de la app porque su
código no se había modificado. El 23/10 se verificaron además las suites existentes:

- `npm run typecheck`: correcto.
- `ABSOR_DEV_API=http://127.0.0.1:8020 npm test`: 159 pruebas correctas en 25 archivos,
  incluida la integración real de HostService con el backend de desarrollo.
- PHPUnit sobre la base de pruebas preparada: 133 pruebas, 735 aserciones,
  PHP 8.5.12; imagen de desarrollo reconstruida con `--pull`.
- `flutter analyze`: sin incidencias.
- `flutter test` con `mobile/tool/test_env.sh`: 45 pruebas correctas. La primera
  ejecución detectó una expectativa anterior fija a Linux en `remote_api_test.dart`;
  se corrigió para usar `Platform.operatingSystem` y se repitieron test y análisis.

Estas suites comprueban el producto existente y la corrección del test; no
acreditan funciones del agente que todavía no existen ni completan por sí solas
las tareas de aceptación final.

Se corrigió el contexto factual de `openspec/config.yaml`: producto/repositorio,
conexiones en la cuenta, SFTP/SSH/control remoto existentes, separación de procesos,
pruebas automatizadas y firma ad-hoc. La tarea 11.6 sigue pendiente: esa corrección
no sustituye la documentación operativa ni las pruebas de viaje del agente final.

La preparación `prototypes/remote-desktop/webrtc-check/` fija la revisión candidata
de libwebrtc `5d27ce25e244b90d09de3429dd3e702fd70f400b` y depot_tools
`b1c2e86792a7f2b6576c181b7327ddd53b1a42a8`. Descarga/sincronización y hooks
oficiales completados en un laboratorio externo. Compilación y ejecución de tres
diagnósticos C++ correctas, con comprobación de dependencias de cabeceras (`gn check`).
Después se compiló y ejecutó un cuarto diagnóstico con un canal de datos real
frente a Electron. El controlador importa el cálculo de prueba y extracción de
huellas del código compartido de la app y usa únicamente un vector público de
pruebas, con nonce nuevo. Cada ejecución usa un perfil privado nuevo, sin cuenta,
backend, captura ni entrada. Los tres casos descritos pasan; no se ha validado
todavía la interoperabilidad audiovisual ni móvil.
El BoringSSL descargado coincide con la revisión indicada por `DEPS`.

Toolchain observado: Clang 24.0.0git fijado por las dependencias oficiales, Xcode
27.1/SDK 27.0 y Mac arm64. La primera compilación de las dos pruebas iniciales
registró 350 441 ms en `.ninja_log` (2473 pasos; dos trabajos). Tras añadir la prueba
de oferta, la compilación incremental y los tres diagnósticos pasan. Espacio
observado redondeado: 12 GiB para checkout/build y 711 MiB para depot_tools; no son
el tamaño del futuro instalador ni una medida de compilación de todos los codecs.

| Binario probado | SHA-256 |
|---|---|
| `auth_check` | `3e0e9c28c88cd908422f895246278dc0a251269bd84d8d1336d6654c911ae087` |
| `factory_check` | `beb9102920e378a0862ea7a4d94baf462b16853c0b30101f0afacded92bbb3e9` |
| `offer_check` | `6d70a0defb2f3bde64df2dcd27d380ea3013c6ad1986d115718ee0bac1def6d2` |
| `channel_check` (última compilación y prueba) | `baf38c1f5cbb661876a6798a470ea9912c2d9d410e65f6a9e24e79a387ed37d6` |
| `video_channel_check` | `ce38e58e74e8ff66abbe76d6414905747f0063df996b20439453e5b54e0f6dec` |

Los fuentes externos, binarios y `webrtc-probe-results.json` permanecen en
`/Users/absor/Documents/DEV/AbsorConnectLab`, conforme a la preferencia del
propietario. La compilación y los tres diagnósticos básicos se repitieron con éxito
después del traslado. El último informe del canal real es
`interop-lyUFAw/interop-results.json`, repetido con éxito después de añadir el
ejecutable de vídeo. El informe del patrón VP8 es
`interop-vKeDw9/interop-results.json`. Chromium registra un aborto SCTP por `Close called` al cerrar deliberadamente
cada conexión; los resultados de autenticación y salida 0 se verifican aparte.

El diagnóstico Windows de la segunda ejecución tiene fuente SHA-256
`abde5a5c94524f74d6cbb9870b07af58585e3cb66be4b5176fc44927a33c127f`
y binario SHA-256 `bfff2a4cdd51160879442c88d9f3c67fcde858cc96cb0a165001d05f14cffcec`.
Está en una carpeta nueva de ProgramData con propietario SYSTEM y DACL protegida
SYSTEM/Administradores; no se ha instalado ni dado de alta ningún servicio.
Los informes privados son `windows-inventory-20261023.json`,
`windows-capture-20261023-b.json` y `mint-capture-20261023.json` en el laboratorio.

La versión posterior del diagnóstico añade únicamente la solicitud UAC del propio
binario mediante un proceso de usuario filtrado; no hay un destino de ejecución
arbitrario. La última fuente tiene SHA-256
`9f5de22db4bbc2d921819b861b2831ced25801c3674c7bfe37c2983172d6f2f6`
y el binario de esa compilación
`c472b7c9b08a12efcc9772b5287be918cd03d91025f06d5852eb6bd44861b3e9`.
La captura `Winlogon` se hizo con la revisión anterior de espera de 45 s:
fuente `6951e0f46fe41b2261dfe99fc0588260c2e5da85653a37253ef5214275e3bab6`,
binario `008eaba14b7f6e572d4fda33dc5d4bc3e6b5cba900e71b9c7467ff92af991988`.
Los informes `windows-capture-20261023-{c,e,f,g}.json` y
`windows-uac-cancel-20261023.json` conservan los resultados, sin píxeles ni credenciales.
Se comprobó que no quedaban procesos del diagnóstico después de cancelar.

El siguiente ensayo añadió entrada Win32 local optativa mediante
`run-probe.ps1 -TestUacInput`, con guardas SYSTEM/sesión interactiva/QEMU y política
UAC esperada. La primera variante creaba el proceso en `Default` y cambiaba el
escritorio de su hilo: capturaba `Winlogon`, pero `SendInput` insertó cero eventos;
otra ejecución instrumentada confirmó error 5, estructura INPUT de 40 bytes y
proceso de 64 bits. No se atribuye ese error a una causa de integridad concreta.
Se retiraron sus solicitantes propios y se comprobó ausencia de procesos del
diagnóstico; UAC y escritorio seguro continuaban activos.

Crear un trabajador SYSTEM nuevo directamente en `winsta0\winlogon` permitió una
primera cancelación nativa. Una repetición no encontró aún ventana en primer plano
y el siguiente caso rechazó actuar mientras el escritorio seguía en transición.
Se añadió espera acotada para la ventana de consentimiento y para observar la
recuperación de `Default`, sin cambiar políticas, UIAccess, ACL de escritorios ni
usar teclas del control de UTM. La comprobación visual posterior de UTM mostró el
escritorio normal; no se utilizó su teclado para conseguir el resultado positivo.

Con la revisión final se hicieron dos ensayos nuevos, carpetas privadas `-m` y
`-n`, ambos correctos: nueve fotogramas no uniformes en `Default`, otros nueve en
`Winlogon`, `consent.exe` comprobado en primer plano, dos eventos Escape,
solicitante filtrado propio con código 1223 y regreso a `Default`. Cada captura
contó durante dos segundos; no persistió píxeles. Fuente SHA-256
`bd60334536b82c73ae6a9a3bceada3ce6d11958436a20762de66203449670617`;
binarios `30520c7a5e8879ca4733779d30d0e32bc647229bc347f855a5f9887eb97f5a68`
y `0294a1e231b6622e63e012b68fda89014b09abf7a129fa98155216da4210cb40`.
Sus compilaciones producen hashes distintos; no se afirma compilación binaria
reproducible. Se verificó rechazo de argumento desconocido (64) y de ambos modos
de entrada desde sesión 0 (3, `interactive_system_context_required`), sin procesos
remanentes. Los informes locales `windows-uac-native-{input,result}-{m,n}-20261023.log`
conservan los resultados y las variantes fallidas permanecen documentadas aparte.
No se instaló SCM ni se modificó UAC; la tarea 1.2 sigue incompleta.

La herramienta de espera UTM usa los protocolos oficiales de su revisión
`1c5e2150696cf86dc6e451212a8ad4555b2b63b2` y corrige localmente la lectura de
`exited` documentada en [UTM #7932](https://github.com/utmapp/UTM/issues/7932).
La ejecución real de PowerShell y el inventario se comprobaron con salida JSON;
no se deduce éxito del código 0 prematuro de `utmctl exec`.

El paquete preparado es `mac-loginwindow-probe-d/AbsorLoginWindowProbe.pkg`, SHA-256
`3fa4d84a85d577cd552a8b30220906206c2e710fd7dbf10edbb6c2294221a6e2`.
`pkgbuild` terminó con código 0 y cuatro avisos `write: Permission denied`, cuya
causa no se ha establecido. Se expandió el paquete y se verificaron la firma del
bundle, igualdad SHA-256 de sus cuatro archivos con el staging, ausencia de
scripts/enlaces y propietarios/permisos del BOM. Esto verifica el contenido del
artefacto; por sí sola no acreditaba una instalación correcta. No se han retirado
atributos de seguridad para silenciar los avisos.

El 23/10/2026 se instaló ese paquete autorizado, con recibo de las 07:42:30 UTC.
Se verificaron sus rutas, propietario root/wheel, plist y firma estricta. El
binario instalado coincide con SHA-256
`7b8127716fc13b6dd2ebe26e16676c2fa1f462ba9f34e4ee2b20ec1c6bb0bf95`.
La ejecución posterior en launchd `gui/501` capturó once fotogramas con ambos
permisos activos; informe privado `mac-installed-gui-20261023-a/report.json`.
La instalación está comprobada y el primer informe fuera de la sesión dio error.
Los informes `LoginWindow` requieren lectura administrativa por su
directorio privado; no se ha cambiado su protección para leerlos.

Tras el cierre de sesión autorizado, el propietario pegó la salida de la lectura
administrativa del informe. No se ha leído directamente el archivo root ni se
conoce su hora exacta de ejecución. El JSON de esquema 1 indica
`screenPermission: true`, `accessibilityPermission: true`, `processUid: 0`,
`loginComplete: false`, `onConsole: false`, `captureRequested: true`,
`captureTested: false`, `status: capture_error`,
`errorDomain: CoreGraphicsErrorDomain` y `errorCode: 1003`. El SDK local de
CoreGraphics asigna 1003 a `kCGErrorInvalidContext`, no a una denegación de TCC.
`onConsole: false` no basta para clasificar toda la sesión: esa primera versión
no consultaba `SessionGetInfo` ni identificaba qué llamada había fallado.

Se preparó la revisión diagnóstica 0.2.0: añade fase del
error, consulta de acceso gráfico de la sesión de seguridad y de pantallas, y
hasta tres enumeraciones ante `invalidContext` exclusivamente en
`SCShareableContent`, con esperas de 3 y 5 segundos. Conserva los resultados de
todos los intentos; no repite denegaciones ni cambia sesión, TCC o SIP. Es una
prueba para distinguir un fallo durante la transición de un contexto persistente
sin acceso gráfico, no una solución validada. Los informes nuevos llevan sufijo
`-v2` para conservar el resultado original. La tarea 1.3 permanece incompleta.
Si persiste el fallo en un contexto estabilizado, debe revisarse el diseño Mac
antes de integrar el agente; no se sustituye por un transporte VNC/RDP.

La revisión 0.2.0 compiló y pasó firma estricta y argumentos inválidos (salida 64).
Desde el proceso de terminal, ambos modos de captura recibieron once fotogramas
en un único intento, con acceso gráfico y una pantalla disponibles; Accesibilidad
figuraba desactivada. Bajo el trabajo temporal `gui/501`, el mismo binario informó
ambos permisos desactivados y rechazó capturar con `missing_screen_permission`.
Se retiró ese trabajo. Esto confirma que cambiar la firma ad-hoc exige comprobar
otra vez los permisos del helper; la captura desde terminal no los acredita bajo
launchd. No se ha probado aún la rama de reintentos en `LoginWindow`.

Paquete 0.2.0 preparado en el laboratorio:
`mac-loginwindow-probe-v2-20261023/AbsorLoginWindowProbe.pkg`, SHA-256
`ecac7c4adefdc7641fc6a6a196ceda5474ce90737195f42b9920e7869640730d`;
binario SHA-256
`4431ca1f3fbebd111ba6ee8a3599f8f6f76629334a77b1eedb59db995c2a92a2`.
`pkgbuild` volvió a emitir cuatro avisos `write: Permission denied` con salida 0;
se expandió y verificó el contenido completo, igualdad con staging, firma, ausencia
de scripts/enlaces y permisos root sin escritura de grupo/otros.

Tras autorización expresa para actualizar, volver a conceder ambos permisos y
repetir el cierre de sesión, el instalador informó instalación completada.
Se verificaron recibo 0.2.0, hash y firma del bundle instalado, plist limitado a
`LoginWindow` con el modo nuevo y rutas de informes `-v2`. La primera ejecución
del bundle instalado bajo `gui/501` rechazó la captura por falta de permiso;
su trabajo se retiró. Ajustes conservaba una entrada del prototipo anterior
activada, lo que no acredita permiso para la firma nueva. Actualización de
permisos realizada después de que el propietario completara la autenticación.
Añadir el bundle sin retirar la entrada antigua no actualizó el permiso efectivo:
el segundo diagnóstico seguía denegado. Por la interfaz de Ajustes se retiró y
añadió solo la entrada del prototipo instalado, primero para pantalla y luego
para Accesibilidad. Tras renovar pantalla se capturaron once fotogramas; después
de renovar ambos permisos, otro trabajo temporal recibió once fotogramas con
`screenPermission: true`, `accessibilityPermission: true`, acceso gráfico y una
pantalla disponibles. No se guardaron píxeles ni se aplicó entrada. Los trabajos
temporales se retiraron; informes privados `mac-installed-v2-gui-20261023-{a,b,c,d}`.
La segunda prueba real en `LoginWindow` se ejecutó tras el cierre autorizado;
el propietario regresó a su sesión y facilitó la salida de los informes `-v2`.
El JSON de esquema 2 informa once fotogramas completos, una pantalla, primer
intento y 2390 ms. El proceso tenía UID 0, `loginComplete: false`, `onConsole: true`,
`hasGraphicAccess: true`, `isRootSecuritySession: false` y ambos permisos activos.
No hay error de captura. La condición de sesión de seguridad raíz es distinta
del UID: el trabajador root tenía acceso a una sesión gráfica.

El resultado acredita recepción de buffers completos antes de completar el
inicio de sesión en esta configuración. No se examinaron sus píxeles; no prueba
el contenido exacto de la pantalla, teclado/ratón, avisos administrativos ni
continuidad entre sesiones. `preLoginTested: false`, `inputTested: false` y
`readyForUnattended: false` son indicadores conservadores del prototipo, no un
error que invalide los once buffers ni una certificación pendiente que deba
forzarse a verdadero. No hizo falta ningún reintento: no se atribuye el éxito al
retardo añadido y sigue sin aislarse la causa del error 1003 de la primera prueba.
Metadatos privados en `mac-diagnostic-v2-install-20261023.json`; transcripción
facilitada por el propietario en `mac-loginwindow-v2-owner-provided-20261023.json`.
La VM se comprobó apagada antes del cierre. La tarea 1.3 permanece incompleta.

Para la siguiente parte de 1.3 se preparó el diagnóstico Mac 0.3.0. Su modo explícito
`--capture-pointer-loginwindow` exige root antes de completar el login, captura
correcta, sesión gráfica de consola, Accesibilidad y permiso de publicar eventos;
rechaza actuar si encuentra un botón del ratón pulsado. Mueve el puntero ocho
unidades Quartz, comprueba su posición y la restaura, sin clics, teclas, red ni
píxeles guardados. El resultado se limita a movimiento del puntero; no demuestra
teclado, contraseña ni aviso de administración.

Compilación y firma estricta correctas. `--probe` devuelve esquema 3 sin entrada;
el modo de puntero desde la sesión ordinaria rechaza el contexto con salida 4,
sin captura ni entrada; argumentos desconocidos salen con 64. La rama de entrada
real sigue pendiente. Paquete preparado:
`mac-loginwindow-probe-v3-20261023/AbsorLoginWindowProbe.pkg`, SHA-256
`067c345e0bc6438e74e1267da883b7455b383182fa275fc3e42c6cdd1b94a0a6`;
binario SHA-256
`feb76e52d1b994e8c99b4a0c76ad2a5240f9e956d8a3250cfc0f48943c9e6e47`.
Se verificó el paquete expandido completo y su firma pese a los cuatro avisos
`write: Permission denied` de pkgbuild, que terminó con 0. Usa informes `-v3`,
conservando los resultados anteriores. La actualización, sus permisos y el nuevo
cierre de sesión se coordinaron con el propietario, que autorizó expresamente
instalar, renovar permisos y probar el movimiento/restauración del puntero tras
cerrar sesión. La instalación terminó después de que completara la autenticación
local: se verificaron recibo 0.3.0, hash, firma estricta, modo de ejecución y rutas
de informes `-v3`. Antes de renovar permisos, el trabajo temporal `gui/501` rechazó
capturar con ambos permisos en falso; fue retirado. Tras autenticación del
propietario se retiraron las entradas antiguas y se añadió por la interfaz el
bundle instalado 0.3.0 para pantalla y Accesibilidad. El trabajo temporal posterior
`gui/501` recibió once fotogramas en 2183 ms con ambos permisos activos; no pidió
ni aplicó entrada. Se retiró el trabajo. Se confirmó el cierre de sesión autorizado
con la VM apagada y el plist verificado. Tras volver a iniciar sesión, el
propietario ejecutó la lectura administrativa de los dos informes `-v3` y pegó
una salida vacía, sin errores de `cat`. No hay JSON que permita certificar captura
o movimiento: todavía no se conocen los tamaños y fechas de esos archivos ni si
el proceso no arrancó, terminó o quedó interrumpido antes de emitir el resultado.
No se observaron procesos activos del helper ni informes de caída accesibles al
usuario ordinario. La consulta del registro unificado, incluidos info/debug,
no proporcionó un resultado de ejecución en `LoginWindow`; los avisos sobre el
label ausente en `gui/501` no acreditan qué ocurrió en el contexto de login.
El ensayo es inconcluso y no se repite todavía el cierre de sesión. Los once
buffers de 0.2.0 siguen siendo evidencia de esa versión; no prueban entrada en
0.3.0. Metadatos privados en `mac-diagnostic-v3-install-20261023.json`.

Para preparar la siguiente prueba se intentó guardar la suspensión de la VM.
UTM la rechazó porque la GPU habilitada no admite instantáneas; aunque su CLI
devolvió 0, el estado real era `paused`. Se reanudó y se solicitó apagado normal
con `--request`; se comprobó finalmente `stopped`. No quedó una suspensión
guardada. Después se confirmó el cierre de sesión del Mac con autorización del
propietario; el control del ordenador dejó de responder al confirmarlo. El regreso
del propietario y el informe facilitado permiten continuar la investigación.

No se han exportado claves de firma, contraseñas, tokens ni cookies Xauthority. No
se han guardado ni transmitido imágenes de pantalla desde los prototipos.

## Reproducción

```bash
bash prototypes/remote-desktop/unattended-check/mac/build.sh /tmp/absor-probe-nueva
/tmp/absor-probe-nueva/AbsorUnattendedProbe.app/Contents/MacOS/AbsorUnattendedProbe --probe
bash -n prototypes/remote-desktop/unattended-check/mac/build.sh
plutil -lint prototypes/remote-desktop/unattended-check/mac/Info.plist
```

En Mint, como usuario de la sesión gráfica:

```bash
python3 prototypes/remote-desktop/unattended-check/linux-probe.py --display :0 --authority "$HOME/.Xauthority"
```

La comprobación realizada envió el script por la entrada estándar de SSH y no
instaló ficheros en Mint. La dirección y los datos del equipo no se incrustan en
las herramientas. Los diagnósticos siempre informan `readyForUnattended: false`:
el inventario no certifica la funcionalidad.

## Dependencias para continuar

- Windows de pruebas: el propietario propuso usar una VM en este Mac. Se ha
  instalado UTM 5.0.8 desde Homebrew y creado «AbsorConnect Windows 11 ARM Lab» con
  8 GiB, 4 CPU y disco virtual solicitado de 80 GiB, usando la ISO oficial de
  Microsoft en español. La ISO descargada coincide con el SHA-256 publicado:
  `dbf606ceb4ce1390f9f21ad1d96331848bc6b701cbab0012785881a1a1c0ec63`.
  Solo se comparte `share/` en lectura; el portapapeles compartido está desactivado.
  Inventario del invitado y capturas GDI comprobados. Pruebas de UAC/entrada aún
  pendientes; una prueba en ARM no certificará Windows x64. La VM tenía UAC
  inicialmente desactivado: con autorización del propietario se aplicó el
  procedimiento de activación y reinicio normal, y se volvió a comprobar UAC
  activo. La vuelta a un usuario interactivo no certifica acceso previo al login.
  La ISO y el laboratorio quedan fuera del repositorio, en
  `~/Documents/VMs/AbsorConnectLab/`; no se incluye ninguna credencial del host en
  el directorio de intercambio. El propietario confirmó expresamente aceptar la
  licencia de Windows para esta VM y se aceptó en el instalador. No se ha
  introducido ninguna clave de producto. El propietario creó las credenciales
  directamente en el invitado; el agente no las conoce ni las ha registrado.
- Conceder inicialmente pantalla y Accesibilidad al prototipo/helper Mac con la identidad que
  se pruebe; la captura desde terminal no acredita esos permisos bajo launchd.
  Inicialmente Terminal tenía grabación autorizada y el helper no figuraba en la
  lista. El propietario confirmó expresamente ambos permisos y completó Touch ID;
  se añadió el helper por la interfaz de Ajustes. La ejecución posterior bajo
  launchd confirmó `screenPermission: true` y `accessibilityPermission: true`.
  No se intentan heredar, modificar por base de datos ni evadir permisos de
  la app instalada. Después se podrá probar entrada, autorización, bloqueo
  y `loginwindow` en contextos coordinados con el propietario.
- El usuario SSH de Mint no dispone de sudo general sin contraseña. La integración
  LightDM/systemd requiere instalación administrativa autorizada cuando el
  prototipo esté listo; las comprobaciones actuales no la han intentado.
- Aún pendientes: vídeo y TURN con libwebrtc, compatibilidad Flutter, prueba
  nueva prueba instrumentada de `LoginWindow`, prueba de entrada/captura privilegiada, estrategia de distribución Mac,
  backend limitado, interfaz, pruebas de red exterior y todos los demás criterios.

El despliegue permanece pendiente de la funcionalidad y verificaciones definidas
en `design.md`. No se marca como fallo arquitectónico la ausencia de un permiso
todavía no concedido, ni se reduce el alcance a una plataforma.


## Continuación automática sin intervenir en el Mac (23/10/2026)

El propietario pidió continuar automáticamente con todo lo ajeno al Mac mientras
está fuera de casa. No se actualizó el diagnóstico Mac ni se renovaron permisos,
bloqueó o cerró su sesión. Confirmó que ambos archivos v3 tienen cero bytes,
modificados el 23/10 a las 16:49:09 según su terminal, y que la búsqueda administrativa
de informes de caída no devolvió coincidencias. Sigue siendo inconcluso: no se
atribuye a una caída ni se certifica entrada.

### Backend terminado en desarrollo: tareas 2.1–2.6

- Migración aditiva `Version20261023163229`: `agent_enrollment` y `host_agent`,
  con hashes SHA-256, origen de sesión y un único propietario por equipo.
  `doctrine:schema:validate` y `lint:container` correctos; no cambia `cache_items`
  ni las claves de cifrado, Dockerfiles PHP o `--pull` de Jenkins.
- Alta `ace_…` de cinco minutos y canje atómico por credencial distinta `acg_…`.
  Firewall/principal propios sin `ROLE_USER`; solo opera el equipo vinculado.
- Revocación por propietario/agente, logout de origen, cambio y reset de contraseña,
  caducidad de origen o de agente y borrado de cuenta. El uso del agente no renueva
  la sesión de cuenta. Una sesión ajena no vinculada puede cerrarse sin revocarlo.
- Traspaso serializado con operaciones del host legado; el antiguo host recibe
  409 hasta la baja. La baja deja el equipo desactivado para un registro nuevo.
  Se conservan equipos y solicitudes de otros hosts de la cuenta.
- Heartbeat con autorización de 30 segundos y capacidades opcionales; cuotas de
  consulta y TURN compartidas y `REMOTE_ENABLED=0` probado. Esto verifica la API,
  **no acredita todavía el corte de un trabajador real a los 30 segundos**.
- PHPUnit: **157 tests, 1024 aserciones** (24 tests nuevos del agente). Vitest:
  **159 tests, 25 archivos**, con integración real contra la API local. Typecheck
  correcto. Informe privado `backend-agent-phpunit-20261023.log` y
  `backend-agent-vitest-20261023.log` en el laboratorio de desarrollo.
- `prototypes/backend-agent-check/run.py`: cinco ensayos HTTP paralelos reales:
  tres canjes dobles (un 201 y un 400 cada vez), canje frente a actualización
  del host legado y canje frente a logout de origen. Un solo propietario y
  ninguna credencial superviviente al logout. Cuenta temporal retirada.
  Informe privado `backend-agent-concurrency-20261023.json`.
- Contrato y ejemplos ejecutables permitidos/denegados en `backend/AGENT_API.md`
  y `prototypes/backend-agent-check/`. No contienen credenciales reales.

### Windows: captura posterior al cierre de sesión

`SessionProbe.cs`, compilado dentro de una carpeta con propietario SYSTEM y escritura
solo para SYSTEM/Administradores, limita la operación a QEMU y SYSTEM en sesión 0.
Consulta el usuario mediante WTS sin imprimir su nombre y solicita el cierre de
la sesión de consola con `WTSLogoffSession`; no introduce credenciales ni aplica
entrada. Argumento desconocido rechazado con 64. Fuente SHA-256
`9ec8f789b58b0b2d7c1dcbda6d0a1ecf23f9e9b5554ca55de17d53e6947bcc3a`, binario
`ad4f54a3b9c32484d94b325a0a7562486de90581d2d5db67b7100977f74fe872`.

La primera captura tras arrancar encontró un usuario ya conectado y nueve
fotogramas de `Default`; se conserva como escritorio ordinario. Después del cierre
WTS de la sesión 1, WTS y CIM informaron ausencia de usuario interactivo. El mismo
capturador previamente identificado por SHA-256
`0294a1e231b6622e63e012b68fda89014b09abf7a129fa98155216da4210cb40`
creó su trabajador en la nueva sesión de consola 2 y recibió **nueve fotogramas no
uniformes en `Winlogon`**, sin guardar ni transmitir píxeles. UAC sigue activo,
ningún proceso de prueba restante. Informes privados
`windows-session-build-b-20261023.log`, `windows-prelogin-capture-a-20261023.log`
y `windows-prelogin-capture-b-20261023.log`.

Esto acredita captura tras logout en esa VM ARM64, no entrada en campos de login,
credenciales, atención segura, servicio SCM, DXGI, monitores múltiples ni recuperación
real de una sesión WebRTC. La tarea 1.2 sigue abierta.

### Mint: captura y entrada limitada de usuario

El diagnóstico X11 esquema 2 añade `--pointer`: exige sesión activa, X11,
desbloqueada, del propio UID y el display de logind; no actúa con un botón del
ratón pulsado. Con XTest mueve ocho píxeles, observa el resultado y restaura la
posición, sin clics ni teclas ni coordenadas en el informe.

En Mint 22.3/Cinnamon/X11, como UID 1000, recibió **10 muestras no uniformes** de
la región central y observó tanto movimiento como restauración. Informe privado
`mint-pointer-capture-20261023.json`. Sigue sin acceso administrativo no interactivo:
`sudo -n true` requiere contraseña. No se cerró o bloqueó la sesión ni se cambiaron
LightDM, polkit, Xauthority, sudo o el control de acceso X. No certifica el greeter
ni permite marcar 1.4 completa.


### libwebrtc: matriz directa, TURN UDP y TURN TLS

Se amplió el laboratorio, sin integrar todavía la dependencia en un agente final.
Revisión WebRTC fijada y vectores iguales a los anteriores. Binarios finales:

- `channel_check`: SHA-256 `a32b17ba799d29dc476c73d4909d0143c8e058c4f676657131294c829c3448f7`.
- `video_channel_check`: SHA-256 `f016a99680d201a5b13298b6efdb38cefc705fe5b49c70e2f7525c7fe61e9fbe`.

Con Electron 39.8.5/Chromium 142 pasaron **nueve conexiones**: contraseña correcta,
prueba incorrecta y huella alterada, en cada uno de estos recorridos:

| Recorrido | Candidatos seleccionados del controlador/host | Resultado |
|---|---|---|
| Directo | host/host | DTLS y desafío; patrón VP8 decodificado solo con autenticación válida |
| TURN UDP por nombre DNS | relay/srflx; relayProtocol udp | Mismos tres casos correctos; controlador obligado a relé |
| TURN TLS por nombre DNS | relay/srflx; relayProtocol tls | Mismos tres casos correctos; controlador obligado a relé |

Los casos negativos generaron/decodificaron cero fotogramas; el positivo verificó
al menos dos y el patrón rojo 320 × 180. Informes privados
`webrtc-matrix-final-20261023.json`, `webrtc-direct-final-20261023.log`,
`webrtc-turn-dns-final-20261023.log` y `webrtc-turn-tls-final-20261023.log`.
Se rechazaron también cuatro casos de argumentos/configuración inválidos;
no se creó SDP de respuesta en el caso nativo inválido.

Se conservaron los fallos previos: espera a completar ICE agotada pese a haber
candidatos y ensayo relay/relay rechazado con 403 CreatePermission. En este último,
ambos peers usan la IP pública del propio relé, que está en su política de denegación.
No se debilitó esa política ni se certificó relay/relay. La corrección del laboratorio
acepta candidatos utilizables y valida el par real después. TURN desde el controlador
ya pasaba por diseño en la prueba existente `relay-check`; no se sustituye por una
conexión directa. Se usaron credenciales temporales y se retiraron sus archivos al
terminar; no se cambiaron secretos o configuración de producción.

El generador oficial de licencias, con el argumento GN del target reducido,
identificó 25 grupos incluyendo WebRTC, rechazando desconocidos y omitiendo solo
la dependencia de compilación que el propio generador clasifica así. Generó
136185 bytes de avisos, SHA-256
`8a3f66a2bd0b0e0c3d230f7146fa9f4d5e4d46dfd634ae83f8358f88d261d8a0`;
informe privado `webrtc-notices-20261023/report.json`. Falta la revisión de
redistribución del paquete final, más captura real, entrada y Android/iOS.
Las tareas 1.5 y 1.6 continúan abiertas.

La migración del backend se revirtió y reaplicó únicamente en la base de pruebas,
con esquema válido después y las 24 pruebas del agente de nuevo correctas.
No se probó rollback destructivo en producción.


La revisión final añadió límite compartido de **30 canjes públicos por minuto e
IP**, con `Retry-After`. PHPUnit final: **158 tests, 1057 aserciones**, incluidas
25 pruebas del agente. Los cinco ensayos de concurrencia volvieron a pasar.
`flutter analyze` y las **45 pruebas Flutter** también pasaron con el entorno de
integración local. Informes privados `backend-agent-phpunit-final-20261023.log`,
`backend-agent-concurrency-final-20261023.json`, `flutter-analyze-final-20261023.log`
y `flutter-test-final-20261023.log`.


### Caso doble relé aislado y compilación móvil en CI

Un coturn local 4.18.0, publicado exclusivamente en loopback, permitió probar
ambos extremos con política `relay` sin cambiar el servicio de producción.
Imagen del fixture: SHA-256
`bbefd3e1fdfdc0d58770fe01b581fd8b00d9f3a5580d00acb77cf719a6bc78e3`.
Tras verificar que el contenedor estaba ejecutándose y respondía a STUN, los
casos correcto/prueba incorrecta/huella alterada seleccionaron **relay/relay** y
pasaron. Solo el positivo generó/decodificó el patrón artificial; los negativos
se mantuvieron en cero. Contenedor y credenciales temporales retirados.
Informe privado `webrtc-relay-both-isolated-b-20261023.log`, resultado
`interop-Sy1diI/interop-results.json`. Un primer fixture no respondió; se conserva
su fallo y no se contabiliza como éxito. El paso en el fixture aislado no acredita
que la política de producción admita ese recorrido.

La PR #13 pasó el workflow Mobile, ejecución **39992477943**:
Android correcto (6 min 11 s, APK con firma verificada) e iOS correcto
(3 min 13 s, IPA sin firma, conforme al método de distribución existente).
Se generaron los artefactos `mobile-android` y `mobile-ios`. Esto acredita
compilación del cliente actual, no interoperabilidad Flutter con el host nativo,
instalación en el teléfono ni control administrativo. Los cambios locales del
propietario en los archivos iOS se conservaron fuera de los commits.


## Backend aditivo desplegado en producción: tarea 11.7

- [PR #13](https://github.com/absortian/AbsorConnect/pull/13) fusionada en el commit
  `f79b5838503484bc5e885fd36602b63e690a231a`, después de pasar los checks Android/iOS.
- Jenkins **Deploy AbsorConnect #11**, resultado `SUCCESS`, construyó ese mismo
  commit con `docker build --pull`, ejecutó el Job de migraciones antes del rollout
  y completó la renovación del Deployment. No se publicó un tag/release de la app.
- Migración real: `Version20261023163229`, una migración y once consultas SQL,
  29.5 ms según el Job; las tablas son aditivas. Informe privado
  `backend-agent-production-migrations-20261023.log`.
- Tres réplicas listas con imagen
  `absortian/absortian@sha256:39b4341cc9361ed08c361bee0710acee2cb917e85af6867a73bc6e206fcadbc6`.
  En cada una: PHP **8.5.12**, `session.upload_progress.enabled=0` y el hash del
  registro del agente idéntico al código local. Informe privado
  `backend-agent-production-replicas-20261023.json`.
- `/api/health` correcto antes y después. **30 comprobaciones HTTPS reales** con
  una cuenta temporal nueva: flujo legado completo de oferta/consulta/respuesta,
  alta y canje únicos, denegación de cuenta al agente, traspaso, capacidades falsas
  por defecto, señalización del agente, ICE, revocación/baja idempotente,
  recuperación del propietario legado y revocación por logout de origen.
  Todas devolvieron el estado esperado, incluidos los rechazos 400/401/409.
- La cuenta temporal se eliminó. Consulta administrativa posterior: **cero
  agentes y cero altas pendientes**. El despliegue no convirtió ninguna instalación
  existente en host desatendido. Informe privado
  `backend-agent-production-smoke-20261023.json` y
  `backend-agent-production-empty-agents-20261023.log`.

Rollback preparado con el digest anterior:
`absortian/absortian@sha256:bc00adb360e85cdc0f0e74fafae2633359b818ad72e6af0cc610b727940c076d`.
Tras asegurar que no queden agentes activos, se puede restaurar esa imagen del
Deployment y esperar su rollout; las tablas aditivas permanecen. No se ejecutó
rollback en producción porque las comprobaciones pasaron. La reversión y
reaplicación de migración se probaron únicamente en la base de tests. Plan y log
privados `backend-agent-deployment-plan-20261023.json` y
`backend-agent-jenkins-11-20261023.log`.

### Trabajo que sigue pendiente

La API desplegada no es un agente nativo ni habilita administración por sí sola.
Las puertas de viabilidad siguen abiertas: credenciales/entrada de login/SAS y
configuraciones reales de Windows; LightDM/polkit y acceso administrativo limitado
en Mint; entrada y distribución del helper Mac; interoperabilidad Flutter con el
adaptador nativo. El propietario dejó el trabajo del Mac para su vuelta. No se
adoptó una vía para eludir sudo, TCC, credenciales o la política TURN de producción.

Hasta resolver esas pruebas, no se certifican los agentes Windows/Mac/Mint ni se
publica una app de acceso completo. Quedan su implementación e integración,
instaladores, revocación real a 30 segundos y el piloto exterior. La propuesta sigue
activa y no se archiva como terminada. La VM quedó apagada mediante cierre normal;
no se modificó la sesión del Mac. Las evidencias privadas permanecen en el
laboratorio de desarrollo para continuar sin repetir pruebas ya demostradas.
