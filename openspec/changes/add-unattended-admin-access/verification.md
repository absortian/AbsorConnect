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
  `backend-agent-production-replicas-jenkins-11-20261023.json`.
- `/api/health` correcto antes y después. **30 comprobaciones HTTPS reales** con
  una cuenta temporal nueva: flujo legado completo de oferta/consulta/respuesta,
  alta y canje únicos, denegación de cuenta al agente, traspaso, capacidades falsas
  por defecto, señalización del agente, ICE, revocación/baja idempotente,
  recuperación del propietario legado y revocación por logout de origen.
  Todas devolvieron el estado esperado, incluidos los rechazos 400/401/409.
- La cuenta temporal se eliminó. Consulta administrativa posterior: **cero
  agentes y cero altas pendientes**. El despliegue no convirtió ninguna instalación
  existente en host desatendido. Informe privado
  `backend-agent-production-smoke-jenkins-11-20261023.json` y
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


La revisión de tipos distinguió un campo ausente de un `null` explícito en las
capacidades: `null` ya no se convierte implícitamente en `false`, sino que recibe
400 `agent_invalid`, igual que enteros o cadenas. PHPUnit con estos cuatro
casos adicionales: **162 tests, 1077 aserciones** (29 pruebas del agente).
La repetición posterior del ensayo HTTP se detuvo en el límite local de cinco
registros por hora (429), antes de crear cuenta; no se cuenta como ensayo pasado
ni se alteró ese límite para saltarlo. Los cinco ensayos anteriores siguen
acreditados por su informe, con el código transaccional sin cambios.


### Corrección final publicada: Jenkins #12

La [PR #14](https://github.com/absortian/AbsorConnect/pull/14), con el rechazo de
capacidades nulas explícitas, se fusionó en
`e5fb2ea08c2dc9d6e48c2a677cc10020c6166ee3`. Jenkins **#12** desplegó exactamente
ese commit, resultado `SUCCESS`, manteniendo `--pull`, PHP 8.5.12 y las migraciones
ya aplicadas, sin una migración adicional. Imagen final:
`absortian/absortian@sha256:86dbc914786ca23a8e81a5d8faf9cc9f621aca5634a3f552e39525b04254f6de`.

Se verificaron de nuevo las tres réplicas, incluidos los hashes de `AgentRegistry`
y `AgentInfo`, y **32 comprobaciones HTTPS correctas**: las 30 anteriores más
rechazo de `capabilities: null` y de una capacidad concreta con valor `null`.
La segunda cuenta temporal fue eliminada; siguen **cero agentes y cero altas
pendientes**, y `/api/health` correcto. Informes privados
`backend-agent-production-replicas-jenkins-12-20261023.json`,
`backend-agent-production-smoke-jenkins-12-20261023.json`,
`backend-agent-production-empty-agents-jenkins-12-20261023.log` y
`backend-agent-jenkins-12-20261023.log`.

El digest del despliegue #11 queda disponible como rollback específico de esta
corrección; el digest anterior a ambos despliegues permanece documentado arriba.
Ninguno se restauró porque la verificación fue correcta. El alcance pendiente y
las puertas de viabilidad no cambian: **7/57 tareas completas**.

## Laboratorio aislado y controlador iOS — 23/10/2026

A petición del propietario se prepara un laboratorio que no necesite cerrar su
sesión principal. UTM creó **AbsorConnect macOS Lab**, Apple Virtualization,
8 GiB, cuatro núcleos, disco nuevo de 80 GiB y ninguna carpeta compartida.
Se descargó desde Apple `UniversalMac_27.0.1_26A434_Restore.ipsw`, se instaló y
arrancó hasta el asistente inicial. El propietario autorizó la licencia, creó la
cuenta y confirmó el escritorio. Tras autorización expresa se activó SSH solo
para el usuario de laboratorio, con acceso total al disco desactivado y sin
abrir puertos del router. La conexión SSH se verificó con la clave del servidor
fijada. Sigue pendiente conceder permisos al diagnóstico y repetir los ensayos
de `loginwindow`; no está certificado como host desatendido. La VM de Windows
se conserva y no se modifica el diagnóstico del Mac físico.

Se preparó el diagnóstico 0.4.0, esquema 4, para investigar el informe vacío de
0.3.0. Añade checkpoints por fase y un temporizador independiente de 30 segundos,
sin ampliar la captura ni la entrada. La autoprueba del temporizador terminó con
código 70 tanto en el Mac de compilación como en la VM; en la VM tardó 1,055 s.
El modo de puntero ejecutado como usuario normal fue rechazado con código 4,
`loginwindow_context_required`, sin captura ni movimiento. El inventario por SSH
emitió un JSON válido, UID 501 y ambos permisos falsos. Su contexto SSH sin acceso
gráfico no es una prueba de viabilidad de la sesión gráfica.

Binario SHA-256 `3a09d938ae421111878986c1d75f0bd0f1f2972a5ea829bc9f199092808146a4`;
paquete SHA-256 `1ef901aa16bada8bcea547ccb3708b5dd845dab0580b5a14f198cc64721c9d00`.
Se verificaron firma estricta, cuatro archivos de payload idénticos al staging,
propiedad root y ausencia de scripts, enlaces o escritura por grupo/otros. El
paquete se instaló en la VM tras autorización expresa; recibo 0.4.0 y hash del
binario instalado coinciden. Se concedieron pantalla y control por la interfaz
del invitado; SSH mantiene su acceso total al disco desactivado. No se modifica
la instalación 0.3.0 del Mac físico. Los informes
privados `mac-v4-vm-{ssh-probe,watchdog,pointer-user-guard}-20261023.*` contienen
solo metadatos. Un timeout deja la finalización sin verificar y puede interrumpir
la restauración del puntero; un bloqueo anterior al punto de entrada Swift podría
seguir dejando archivos vacíos. La instrumentación no identifica por sí sola la
causa de los archivos vacíos anteriores.

El inventario temporal bajo `launchd gui/501` obtuvo acceso gráfico, frente al
contexto SSH sin él, sin solicitar captura. Tras conceder permisos, el bundle
instalado recibió seis fotogramas completos en dos segundos bajo ese mismo
contexto de usuario, con ambos permisos verdaderos, 2856 ms totales. Los dos
trabajos temporales se retiraron y se comprobó que ya no estaban registrados.

Tras cerrar la sesión exclusivamente de la VM, la primera ejecución de 0.4.0
en `LoginWindow` terminó con `diagnostic_timeout`, código previsto 70 y última
fase `pointer.position`. El stderr recorre captura y comprobaciones de sesión
y permisos del puntero, pero no contiene `pointer.post_move`; no se ha verificado
movimiento ni restauración. El informe final no conserva recuento de fotogramas
parciales. Se observó un aviso adicional de acceso directo a pantalla y se
confirmó por la interfaz antes de preparar otra ejecución del mismo binario.
Informe privado `mac-v4-vm-loginwindow-first-20261023.json` y checkpoints `.jsonl`.
Este fallo mantiene abierta 1.3 y la puerta previa al agente Mac final.

Dos repeticiones con el mismo binario reprodujeron `pointer.position`, incluida
una después de confirmar el aviso adicional. En la tercera se obtuvo una muestra
de un segundo del proceso propio mediante `sample`: 91 muestras detenidas dentro
de `CGEventCreateMouseEvent` → `SLEventCreate` → `CGSEventSourceForID` →
`CGSEventSourceShutdown`, esperando un mutex de SkyLight. La instrucción anterior
al retorno muestreado, contrastada con el binario de hash fijado mediante `otool`,
es la llamada pública `CGEventCreateMouseEvent`; la fase agrupa también la lectura
de posición, pero el bloqueo observado ocurre al construir el evento, antes de
publicarlo. No se atribuye aún a una causa definitiva ni al hardware físico.
Muestra privada `mac-v4-vm-pointer-position-sample-20261023.txt`. La primera espera
de muestreo venció antes del cierre de sesión y el segundo intento llegó cuando
el proceso ya había terminado; no son ensayos de entrada adicionales. No quedan
colectores ni procesos del diagnóstico activos.

La revisión 0.5.0 (esquema 5) separó los checkpoints del puntero y conservó la
captura completada en caso de timeout. El cambio de fuente explícita de eventos
a `privateState` no amplió permisos ni entrada. Binario SHA-256
`aed564435c11d7880ef8f427157c9870ad25bdd0e19e719c906cc3b26f2ba2c5`;
paquete `mac-loginwindow-v5-vm-20261023/AbsorLoginWindowProbe.pkg`, SHA-256
`4ee1d0374a2b8dcbf31696802526a6ff2c02817b13e9856c57922f0d80ae47fb`.
Instalación 0.4.0 → 0.5.0 correcta, recibo y hash instalado verificados. La firma
ad-hoc nueva invalidó ambos permisos: apagar/encender los interruptores no bastó;
se retiraron las entradas anteriores y se añadió de nuevo el bundle instalado
en Ajustes. Después, bajo launchd gráfico, ambos permisos verdaderos y seis
fotogramas completos en 2262 ms; trabajo temporal retirado. El watchdog y el
rechazo del modo de puntero en sesión de usuario también pasaron en la VM.

Tras el cierre real de la sesión de la VM, 0.5.0 obtuvo diez fotogramas completos
en 2379 ms con UID 0, `loginComplete: false`, consola y ambos permisos activos.
Terminó sin timeout con `capture_ok_pointer_failed`: la fuente privada no pudo
crearse (`pointer_source_unavailable`). No construyó ni publicó eventos, por lo
que no se verificó entrada ni restauración. Informe privado
`mac-v5-vm-loginwindow-first-20261023.json` y checkpoints `.jsonl`. FileVault de
esta VM está desactivado: el resultado no prueba prearranque cifrado. Se pudo
volver a iniciar sesión y no quedó ningún proceso del diagnóstico activo.

La revisión 0.6.0 (esquema 6) sustituyó la fuente explícita por la fuente
predeterminada `nil`, admitida en el encabezado público `CGEvent.h` del SDK.
Conservó permisos, guards, tap HID y movimiento/restauración de ocho píxeles,
sin clics ni teclas. Binario SHA-256
`c92db9f39b343c521d38405f804fe411eeb54cb786271d08009ab784c5af500e`;
paquete `mac-loginwindow-v6-vm-20261023/AbsorLoginWindowProbe.pkg`, SHA-256
`62f04d03f5d5f1b47665fe62225397bc7981d91ea54f9eb6fc8f106aa84c8347`.
La actualización 0.5.0 → 0.6.0 requirió retirar y añadir de nuevo las dos entradas
en Ajustes; recibo, firma estricta y hash instalado correctos. Bajo launchd del
usuario recibió seis fotogramas en 2260 ms con ambos permisos verdaderos; se
retiró el trabajo temporal. Watchdog y rechazo del modo de puntero en sesión de
usuario pasaron también en la VM.

En el primer `LoginWindow` real con 0.6.0 recibió once fotogramas completos en
2381 ms, UID 0, consola y ambos permisos verdaderos, `loginComplete: false`.
Construyó y publicó los dos eventos sin bloqueo; observó la posición original
tras restaurar, pero **no el desplazamiento solicitado** (`moveObserved: false`,
`restoreObserved: true`, `capture_ok_pointer_failed`). `inputTested: true` solo
indica que se intentó publicar entrada; no demuestra éxito. `keyboardTested`,
`preLoginTested` y `readyForUnattended` siguen en falso. El colector acotado de
pila detectó que el proceso había terminado antes de sus ocho segundos y no
tomó muestra. Informes privados `mac-v6-vm-loginwindow-first-20261023.*`.

Un reinicio completo de la VM, sin interacción de UI durante la ejecución,
repitió el resultado: once fotogramas completos en 2691 ms, permisos conservados,
UID 0 y login incompleto; eventos publicados, desplazamiento no observado y
posición original observada después de restaurar. Informes privados
`mac-v6-vm-loginwindow-reboot-20261023.*`. Esto descarta que el fallo observado
solo aparezca en la transición de cierre de sesión, pero no establece su causa
ni demuestra imposibilidad de otras arquitecturas. Se verificó que el proceso
había terminado y se apartó el plist propio de `/Library/LaunchAgents/` a la
carpeta del laboratorio con sufijo `.disabled-v6`; el bundle, recibo y los
informes privados permanecen. No hay ejecución automática en próximos logouts.
**1.3 sigue abierta y el agente Mac definitivo debe volver a revisión antes de
implementarse**, según la puerta de viabilidad de la propia tarea. Tampoco se
certifica el acceso desatendido completo ni se publica un agente nativo.

En los builds de paquetes 0.5.0 y 0.6.0, `pkgbuild` imprimió avisos
`write: Permission denied`, aunque salió con código 0. Se aisló su origen a
`pkgbuild` mediante una ejecución trazada; `ditto` y ambas verificaciones de
firma por separado no los emitieron. La expansión de cada paquete conservó los
cuatro archivos y sus hashes, propiedad root, modos sin escritura ajena y sin
scripts ni enlaces. La instalación real y la comprobación del binario instalado
pasaron; no se atribuye una causa definitiva a esos avisos.

Se instalaron los runtimes oficiales de Simulator desde Xcode y se creó
**AbsorConnect iPad Lab**, iPad Pro 11 pulgadas M4, iOS 27.0 (24A434), arm64.
El runtime 27.1 instalado solo anuncia compatibilidad con iPhone Duo; no se
forzó una combinación incompatible. La app se compiló desde una copia externa
de `mobile/`, conservando sin cambios los dos archivos iOS editados previamente
por el propietario.

El nuevo ensayo `webrtc-check/mobile-interop-test.dart` usa el WebRTC real del
plugin y la autenticación Dart/CommonCrypto de producción contra
`video_channel_check`, con la misma huella de binario ya registrada. El servidor
local `serve-mobile.py` está acotado a tres casos, a loopback y al binario
artificial; no necesita cuentas ni puede ejecutar órdenes indicadas por HTTP.

**9/9 casos finales correctos**: contraseña válida, prueba incorrecta y huella
alterada, cada una en directo y con el controlador obligado a TURN UDP o TLS.
En directo, `host/host`; por relé, `relay/srflx` con `relayProtocol` correspondiente.
La contraseña válida produjo dos fotogramas decodificados 320×180 y los casos
negativos cero. Ambos extremos concuerdan, sin captura real ni entrada del SO.
Las copias temporales de credenciales TURN se retiraron. Informe privado
`mobile-native-matrix-final-20261023.json`; logs individuales y SDP siguen en el
laboratorio externo. El servidor rechaza cinco peticiones HTTP malformadas antes
de lanzar procesos. Compilación iOS, análisis del nuevo test sin incidencias y
`npm run typecheck` correctos.

No se certifica rendimiento físico iPad/iPhone, Android, entrada nativa ni el
flujo completo de la app mediante estas pruebas. **1.5 y 1.3 siguen abiertas;
el total continúa en 7/57**. Los resultados de una VM Mac tampoco sustituirán la
validación final del equipo físico y de su cifrado de arranque.

### Investigación de tirones anterior a este cambio

El propietario identifica el recorrido **iPad → Windows**, sin recordar si
ambos estaban en la misma red. No hay estadísticas históricas de esa sesión.
Se inspeccionó el host publicado: captura objetivo 30 fps, `contentHint=detail`
y `degradationPreference=maintain-resolution`. Las ventanas mantienen
`backgroundThrottling: false`. No se modificó el comportamiento de la app ni la
configuración de producción a partir de estas hipótesis.

Un arnés privado, separado de los instaladores, midió 16 casos de vídeo artificial
en dos peers Chromium del mismo Mac. No captura la pantalla ni inyecta entrada.
Cada caso usa cinco segundos de calentamiento y doce segundos de medida. El
canal de eco mide ida/vuelta del transporte; no mide la aplicación de entrada en
Windows. Los resultados no equivalen al rendimiento del iPad físico.

| Ensayo | Resultado observado |
|---|---|
| Directo, 720p y 1080p | Aproximadamente 30 fps, sin pérdidas ni congelaciones. |
| Directo, 4K con detalle | 28,8 fps; búfer medio de vídeo 123 ms pese a eco local inferior a 1 ms. |
| Codificador limitado a 1 Mbit/s, 4K con detalle | 11–12 fps con las tres preferencias probadas: mantener resolución, equilibrada y mantener fotogramas. Cambiar solo esa preferencia no bastó. |
| Mismo límite, 1080p con detalle | 30,1 fps. La carga de resolución es una hipótesis que merece adaptación explícita y verificación de legibilidad. |
| TURN UDP real, 720p/1080p/4K | Aproximadamente 30 fps; mediana de eco 95–103 ms. |
| TURN TLS real, primer caso 720p | Media 17,6 fps, intervalos de 9–19 fps antes de recuperar 30; una congelación, 25 paquetes contabilizados como perdidos, búfer medio 224 ms y eco p95 296 ms. |
| TURN TLS, otros tres casos | Aproximadamente 30 fps, con mayor búfer/retardo que en UDP. |

Las medidas por relé comprueban el candidato elegido y su protocolo. La primera
preparación TLS sin STUN no conectó; se conserva como fallo del arnés. Al añadir
el STUN del entorno, el host obtuvo candidato reflejado y se completaron las
medidas con `relay/srflx`, sin cambiar políticas del servidor. Se conserva también
un error inicial de negociación del canal de datos del arnés, corregido antes de
las medidas. No se cuentan como fallos de sesiones de usuarios ni como pruebas
superadas.

Evidencia privada: `performance-20261023/{summary.json,report-*.json}` y fuentes
del arnés. La caída temporal por TLS y la caída bajo presupuesto de codificación
son indicios distintos, no una causa confirmada del incidente del propietario.
Para corregirlo con garantías faltan resolución/códec, ruta/protocolo ICE, pérdida,
retardo del búfer y coste de captura/codificación/decodificación de una sesión
real Windows → iPad. No se aumentaron cuotas ni se publicó una supuesta solución.

## macOS VM: movimiento público del cursor — 23/10/2026

Tarea 1.3, avance parcial. Diagnóstico 0.7.0/esquema 7, mismos permisos, sesión,
guardas y alcance de ocho unidades Quartz que 0.6.0. Sustituye la publicación
del evento por `CGWarpMouseCursorPosition`, API pública documentada por Apple
que mueve el cursor sin generar eventos. No presupone que sea entrada de
aplicación ni interacción con loginwindow. No usa APIs privadas ni modifica TCC.

- Swift/arm64 y firma estricta correctos. Argumento inválido: 64; autoprueba
  independiente del watchdog: 70, `diagnostic_timeout`, esquema 7.
- Paquete: cuatro archivos, hashes idénticos al staging, root, sin scripts ni
  enlaces. Instalación 0.6.0 → 0.7.0 correcta en la VM; recibo y hash comprobados.
- Renovadas las referencias del mismo helper en pantalla y Accesibilidad mediante
  Ajustes de la VM. El wrapper SSH conserva Accesibilidad desactivada.
- Bajo launchd GUI: ambos permisos, seis fotogramas completos en 2491 ms.
- Después de logout: root, `loginComplete:false`, consola, once fotogramas en
  2442 ms, `moveStatus:0`, `restoreStatus:0`, movimiento/restauración observados.
- Después de reiniciar solo la VM, sin interacción en su pantalla durante el
  diagnóstico: once fotogramas en 3235 ms, movimiento/restauración observados.
  Se verificó que el informe fuera posterior a kern.boottime. El stdout de launchd
  había añadido el segundo JSON al primero: se decodificaron ambos y se conservó
  el último, además del original completo y la identificación temporal privados.
- Estado `capture_and_pointer_ok_not_certified`; `keyboardTested`,
  `preLoginTested` y `readyForUnattended` siguen false. Clics, campos de contraseña,
  diálogos administrativos y hardware real continúan sin verificar. No se marca
  completa la tarea 1.3 ni se incorpora todavía el agente final de Mac.
- Plist automático retirado mediante renombrado a `.disabled-v7`; ningún proceso
  del diagnóstico activo y sesión gráfica de test restaurada.

Binario SHA-256 `2c6c40c116d918b4d463f0852c3c29fc740fb30b4d0c5ff35054143636e842a2`.
Paquete SHA-256 `2d2c52f0e834a044162f95570f085898974ecd14e3f008ed3bc682cc64522f6b`.
Informes privados: `mac-v7-vm-loginwindow-{first,reboot}-20261023.json`; el segundo
tiene además `.raw` y `mac-v7-vm-loginwindow-reboot-identification-20261023.json`.
Los cuatro avisos write/Permission denied de pkgbuild reaparecieron con exit 0;
las verificaciones de payload e instalación siguen correctas, sin atribuir causa.

Referencia: [Apple: CGWarpMouseCursorPosition](https://developer.apple.com/documentation/coregraphics/cgwarpmousecursorposition(_:)).

### Android: interoperabilidad con el adaptador nativo

Tarea 1.5, avance parcial del 23/10/2026. Android 16/API 36 arm64, emulador
Google APIs existente, plugin real `flutter_webrtc` y PBKDF2/HMAC de producción.
**9/9 casos**: contraseña correcta, prueba incorrecta y huella alterada, en
directo, TURN UDP y TURN TLS. El positivo recibió al menos dos fotogramas
artificiales de 320×180; los negativos generaron/recibieron cero. El binario
conserva SHA-256 `f016a99680d201a5b13298b6efdb38cefc705fe5b49c70e2f7525c7fe61e9fbe`.

El primer ensayo llegó a autenticar/recibir, pero falló una aserción que exigía
`host/host`: el NAT del emulador seleccionó `prflx/host`. Se corrigió únicamente
el criterio de ruta directa en cliente y servidor de laboratorio: acepta
`host`/`prflx`, nunca `relay` ni valores ausentes, sin servidores ICE. `prflx`
es un candidato peer-reflexive definido por [WebRTC](https://www.w3.org/TR/webrtc/#dom-rtcicecandidatetype).
La repetición final pasó los nueve casos; por TURN seleccionó `relay/srflx` y
el protocolo esperado. No se alteraron cuotas, ACL ni el relé.

Evidencia sin SDP, IPs ni secretos: `android-native-results.json`. Se retiraron
servidores loopback, credenciales temporales y `adb reverse`; se apagó el emulador.
No certifica dispositivo físico, entrada del sistema, captura real integrada ni
la sesión completa de Equipos. La tarea 1.5 sigue abierta.

### Mac: diagnóstico de clic y Escape preparado, pendiente de permisos

Tarea 1.3, preparación parcial. Versión 0.8.0/esquema 8 añade un modo exclusivo
de VirtualMac/LoginWindow/root, que crea una ventana propia y verifica el foco
ante cada pulsación. Solo intenta un clic y Escape sobre esa ventana; no escribe
en la ventana de inicio de sesión ni contiene credenciales o red. Mantiene
captura/puntero previos y temporizador independiente de 30 segundos. Esto no
sustituye las pruebas de teclado sobre las pantallas reales del sistema.

Compilación Swift/arm64, firma estricta, rechazo de argumento inválido (64),
autoprueba del watchdog (70), payload de cuatro archivos sin scripts/enlaces y
actualización 0.7.0 → 0.8.0 correctos en la VM. Hash del binario:
`715318891faa7f319f76fec54355a19259ff8ec90dcc567529dc6c3a9d67bc8b`;
paquete: `5d2839ec02e8d2c5b0a2bc6e6f2c1e7c64beb63177b88409c7ee752ef1c31668`.
El sondeo bajo launchd gráfico devolvió **ambos permisos falsos** tras cambiar
la firma. Se retiró el trabajo temporal y se renombró el plist automático como
`.disabled-v8c`; no quedó proceso del diagnóstico ejecutándose.

En esa preparación, el Mac anfitrión bloqueado impedía manejar la VM y el ensayo
quedó pendiente. El propietario confirmó después su desbloqueo; la continuación
del 24/10/2026 se registra más abajo. La tarea 1.3 continúa abierta y
`readyForUnattended` sigue siendo falso.

### Contrato administrativo compartido: tarea 8.2 completa

Tipos y analizadores sin efectos en `src/shared/remote/agentProtocol.ts` y
`mobile/lib/src/remote/agent_protocol.dart`; contrato exacto en `agentProtocol.md`.
Sobre v1/extensión 1, hasta 2048 bytes, acciones enumeradas, UUID v4, contextos
y resultados cerrados. No acepta parámetros, programas, campos extra, capacidades
contradictorias, versiones desconocidas ni imagen vigente en transición.

24 vectores válidos y 83 inválidos compartidos por ambos lenguajes, más límite,
JSON roto, direcciones cruzadas y compatibilidad: **109 pruebas nuevas por lado**.
El analizador legado sigue ignorando órdenes administrativas; el anuncio opcional
no activa el agente ni negocia o ejecuta órdenes. La autenticación v1 no cambia.
Ejecución, deduplicación, secuencias y renovación siguen pendientes de integración
en 3.3–3.5 y 7–10; no se confunden con esta tarea de contrato.

Verificación local: typecheck y ESLint correctos; Vitest **276 correctas y 5
omitidas preexistentes**; Flutter analyze limpio y **159 pruebas correctas**,
incluidos API/SSH/S3 de desarrollo; PHP 8.5.12, **162 pruebas/1077 aserciones**.
OpenSpec confirma **8/57** tareas completas. No hay agentes nativos de producción
certificados ni activados por estos cambios.

### Mac: corrección del bucle modal y repetición — 24/10/2026

Tras desbloquear el propietario el anfitrión, se renovaron pantalla y
Accesibilidad del bundle instalado exclusivamente en la VM. El wrapper SSH
conservó Accesibilidad desactivada. 0.8.0 recibió seis fotogramas bajo launchd GUI
en 2494 ms. En LoginWindow, tras logout y reinicio, recibió once/diez en
2648/2772 ms; movimiento y restauración del puntero observados, UID 0, consola,
ambos permisos y login incompleto. Ambos ensayos terminaron por watchdog a los
30 segundos, última fase `owned_input.start`.

Una muestra de un segundo del propio proceso, tomada durante el segundo ensayo,
mostró las 91 muestras del hilo principal dentro de `NSApplication.runModal`.
No estaba detenido en la construcción de eventos. La prueba anterior de cola
modal usaba `main()` síncrono y no reproducía el contexto del diagnóstico.
Una reproducción con `main() async`, sin captura ni entrada, devolvió
`timerExecuted:true, queueExecuted:false`: el temporizador modal terminó el
ensayo mientras la operación pendiente de DispatchQueue.main seguía sin ejecutar.
Evidencia privada: `mac-v8-owned-input-sample-20261024.txt` y
`ModalQueueAsyncCheck.swift`/`modal-async-result-20261024.txt`. El trabajo temporal
se retiró. Esto identifica un defecto del arnés, no un fallo acreditado de entrada.

0.9.0/esquema 9 sustituye esas esperas por temporizadores del modo modal nativo,
los invalida al terminar y añade checkpoints internos. Mantiene las mismas
guardas, permisos, ventana y eventos fijos; no amplía entrada ni usa APIs privadas.
Compilación Swift/arm64 y firma estricta correctas; argumento inválido 64,
watchdog independiente 70 y rechazo fuera de VirtualMac 4 antes de captura/entrada.
Payload de cuatro archivos sin scripts/enlaces verificado, actualización
0.8.0 → 0.9.0 instalada y recibo/hash coincidentes. Los cuatro avisos de pkgbuild
reaparecieron con salida 0 y payload correcto; su causa sigue sin identificarse.
Hash binario `269ced62205006be21870a0ff3265e21a8f5b99a37d90377900afe49fbbfbc16`;
paquete `f4f0b1c9640c9d8985cec0a65980217650bb6f3482e6fd7f9cc09cbea35717db`.

La nueva firma requirió retirar y añadir de nuevo el mismo bundle en los dos
paneles de Ajustes de la VM. Preflight gráfico: ambos verdaderos; captura bajo
launchd GUI: seis fotogramas, 2481 ms. Tras logout y arranque limpio: once
fotogramas en 2440/2681 ms, movimiento/restauración observados, UID 0, consola y
login incompleto. En ambos casos el temporizador ejecutó la comprobación y
terminó sin timeout: `owned_window_focus_unavailable`, cero clics y teclas
intentados/observados. La guarda combina inactividad, contexto permitido,
ventana clave, primer responder y proceso en primer plano; el informe no distingue
qué condición falló y no demuestra una limitación general del sistema.

El segundo informe se verificó posterior a kern.boottime y se decodificaron los
dos JSON añadidos por launchd, conservando el último y el original completo.
Resultados públicos sin IPs, credenciales, imágenes ni teclas:
`mac-owned-input-results.json`. Evidencia privada `mac-v9-vm-loginwindow-{logout,reboot}-20261024.*`
y `mac-v9-vm-reboot-identification-20261024.json`. El tiempo informado corresponde
a la fase de captura, no a la duración total del ensayo.

`inputTested:true` procede del ensayo previo del puntero y no certifica clics ni
teclado; `clickTested`, `keyboardTested`, `preLoginTested` y `readyForUnattended`
permanecen falsos. Retirado el plist automático como `.disabled-v9-after-reboot`,
sin proceso activo y con test de nuevo en el escritorio. No se modificaron TCC,
SIP ni permisos/sesión del Mac físico. La tarea 1.3 permanece abierta: antes del
agente Mac final hay que revisar el contexto de foco/entrada y probar diálogos
del sistema e inicio de sesión reales, además de firma y hardware objetivo.

Referencias: [Apple: modos de RunLoop](https://developer.apple.com/documentation/foundation/runloop/mode)
y [comprobación de MainActor](https://developer.apple.com/documentation/swift/mainactor/assumeisolated(_:file:line:)).


### Mac: ventana visible antes del login, foco identificado — 24/10/2026

Tarea 1.3, avance parcial. 0.10.0/esquema 10 corrige la omisión de
`NSWindow.canBecomeVisibleWithoutLogin` y registra cada condición de foco.
Conserva las guardas de entrada y el nivel normal de ventana, sin APIs privadas.
Apple documenta que esa propiedad es necesaria para dibujar antes del login;
no garantiza activación ni entrada en la pantalla del sistema.

Compilación Swift arm64 y firma estricta correctas. Argumento inválido: 64;
watchdog: 70; fuera de VirtualMac: 4 antes de captura/entrada. Payload de cuatro
archivos sin scripts/enlaces y hashes verificado; instalación en VM 0.9.0 →
0.10.0 con recibo/hash correctos. Los cuatro avisos de pkgbuild reaparecieron
con salida 0 y payload verificado; no se atribuye causa definitiva.
Binario `83a649f215c38c00301ff9f97f19febba4e950ffd750cdce6871fd5389b0ee30`;
paquete `76e5e0038c5342c5d9c7452c48314b82c35c2049bd27bc972aeca207d0684e52`.

Renovados los dos permisos del mismo bundle en Ajustes de la VM. Preflight
ambos verdaderos; bajo launchd Aqua, seis fotogramas en 2859 ms. Tras logout y
arranque limpio, once fotogramas en 2452/2711 ms, puntero movido/restaurado,
UID 0, consola y login incompleto. `focusConditions` identifica dos condiciones
falsas: `keyWindow` y `frontmostProcess`. Contexto, inactividad, primer responder
propio y visibilidad antes del login/ventana son verdaderos. Ambos ensayos
cancelaron antes de crear/publicar clics o teclas. No es prueba de imposibilidad
general del sistema; el arnés de ventana propia no acredita todavía esos eventos.

El nuevo arranque se comprobó distinto y el mtime del informe posterior a
kern.boottime; launchd añadió dos objetos JSON y se conservó el último y el raw.
Evidencia pública: `mac-prelogin-window-results.json`; se conserva aparte la
0.9.0 en `mac-owned-input-results.json`. Evidencia privada:
`mac-v10-vm-loginwindow-{logout,reboot}-20261024.*` y
`mac-v10-vm-reboot-identification-20261024.json`.

Retirado el plist como `.disabled-v10-after-reboot`, sin proceso activo y
escritorio de test restaurado. No se cambiaron permisos ni sesión del Mac físico.
`clickTested`, `keyboardTested`, `preLoginTested` y `readyForUnattended` siguen
falsos. No se marca completa 1.3 ni se incorpora el agente Mac final. El progreso
sigue en **8/57**; la publicación estable 0.4.1 no incluye estos diagnósticos.

Referencias: [Apple: agentes antes del login](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CustomLogin.html)
y [NSWindow.canBecomeVisibleWithoutLogin](https://developer.apple.com/documentation/appkit/nswindow/canbecomevisiblewithoutlogin).

### Mint: acceso administrativo gráfico comprobado, transición preparada — 24/10/2026

El propietario ejecutó por SSH el inventario administrativo de una sola ejecución,
introduciendo sudo localmente. UID 0, Cinnamon/X11 activo y desbloqueado, LightDM
activo. El archivo de autorización de Xorg es regular, privado de root y permitió
XOpenDisplay desde root. No hubo captura, entrada, cambios de permisos ni servicio.
Informe sin UID del usuario ni display: `mint-root-inventory-results.json`.
Evidencia privada: `mint-root-inventory-20261024.{log,json}` y el script del mismo
nombre, SHA-256 `2d0059a80b18bddc1df6dfefecf642aaa6155ce2d555de70f34d3cc69f0a5059`.
Esto verifica acceso administrativo al servidor X en el escritorio actual; no
acredita todavía el greeter ni completa 1.4.

Preparado `linux-session-check.py` para observar escritorio → greeter → nueva
sesión del mismo usuario, usando el capturador existente, sin entrada ni servicio.
Resuelve Xauthority de nuevo por fase, exige propiedad/permisos privados de root
y padres sin escritura ajena, y descarta una muestra si cambia logind durante la
captura. Copias en Mint con hashes coincidentes. Validación de sintaxis correcta;
rechazo sin root con salida 4; comprobaciones aisladas de sesión estable,
transición durante captura, entrada inesperada, captura fallida y displays inválidos
correctas. La prueba física coordinada se completó posteriormente; resultado en el apartado siguiente.
Typecheck y 276 tests Vitest correctos, cinco omitidos
previos; validación estricta de OpenSpec correcta. Progreso sin cambios: 8/57.

La herramienta de control del ordenador rechazó acceder a Terminal del Mac
(`com.apple.Terminal`), por lo que los comandos administrativos los ejecuta el
propietario y se recogen sus informes locales; no se habilitó SSH de root ni sudo
sin contraseña como alternativa.

### Windows: consentimiento manual sin resultado recuperado — 24/10/2026

Windows 11 ARM Lab arrancado; inventario confirma UAC y escritorio seguro activos,
volumen sin BitLocker. El mismo CaptureProbe.exe verificado por SHA-256 solicitó
solo `--elevated-self-check`, que comprueba el contexto administrativo y termina.
El propietario notificó la aceptación de dos avisos y se observó de nuevo el
escritorio. El primer lector agotó sus 60 segundos. En el segundo intento se
redirigió la salida a un archivo propio de la VM, pero UTM/QEMU Guest Agent dejó
de responder a las consultas y lecturas posteriores (timeout RPC). No se recuperó
un resultado completo, no se cuenta como elevación correcta ni como entrada remota
verificada. No se modificó UAC ni se instaló servicio. Archivos privados:
`utm-cli-check/{manual-uac-elevation,start-manual-uac-durable,read-manual-uac}-20261024.ps1`.
La recuperación del informe quedó pendiente en este intento; se documenta más
abajo su posterior lectura visual. La ausencia de procesos no quedó verificada.


### Mint: captura durante cierre de sesión y vuelta verificada — 24/10/2026

El propietario ejecutó el diagnóstico preparado, cerró sesión de Cinnamon,
permaneció en LightDM y volvió a iniciar sesión. Las tres fases fueron observadas
por logind y capturadas desde root con Xauthority resuelto de nuevo: diez imágenes
128×72 en cada fase, no uniformes 10/9/4 respectivamente. El muestreo dura dos
segundos por fase; el recorrido completo duró 75424 ms e incluye la intervención
local. No es una medida de reconexión ni rendimiento del transporte remoto.

El resultado `transition_capture_ok_not_certified` exige escritorio de usuario
inicial desbloqueado, greeter X11 activo y nueva sesión del mismo usuario al volver,
con comprobación de contexto antes/después de cada captura. Tras la prueba se
confirmó otra sesión activa y cero procesos del diagnóstico. No se instalaron
servicios ni se modificaron LightDM, Xauthority, xhost, sudoers o permisos del SO.

Informe público sin IPs, usuarios, display, cookies ni contenido de pantalla:
`mint-transition-results.json`. El original y JSON extraído permanecen privados
en `mint-transitions-20261024.{log,json}`. No publicar el log bruto de la terminal,
que incluye el prompt de sudo. Entrada, bloqueo, polkit y funcionamiento remoto
siguen pendientes; `preLoginTested` y `readyForUnattended` permanecen falsos.
La tarea 1.4 es parcial y el total sigue en 8/57.

### Mint: captura durante bloqueo de Cinnamon — 24/10/2026

La primera ejecución de `--capture-lock` agotó cinco minutos sin observar
`LockedHint:yes`, aunque el propietario confirmó que Mint exigió contraseña.
El proceso terminó y el escritorio siguió accesible. Este resultado negativo
queda conservado; no se considera una prueba satisfactoria de bloqueo.

Se añadió el modo explícito `--lock-source cinnamon`, que consulta el método
de solo lectura `org.cinnamon.ScreenSaver.GetActive` como el usuario de la sesión,
sin conservar privilegios root en ese subproceso. La repetición verificó diez
muestras no uniformes en cada fase: salvapantallas inactivo, activo y otra vez
inactivo, con la misma identidad/sesión X11. El propietario confirmó que se
requirió contraseña al desbloquear. El recorrido duró 127720 ms e incluye espera
humana; no mide latencia. Logind mantuvo `LockedHint:no` y así figura en el informe.

`GetActive` no certifica por sí solo un bloqueo seguro. Las imágenes se cuentan
sin conservarlas ni verificar semánticamente su contenido; no hay prueba de
teclado, clics, credenciales, polkit, transporte remoto o servicio final. Se
comprobó cero procesos del diagnóstico y salvapantallas inactivo al terminar.
No cambió configuración, permisos, LightDM ni sudoers. Evidencia pública:
`mint-lock-results.json`; originales privados `mint-{lock,cinnamon-lock}-20261024.{log,json}`.
La tarea 1.4 continúa parcial, `readyForUnattended:false`, total 8/57.

### Windows: recuperación del canal de laboratorio pendiente — 24/10/2026

Servicios de Windows mostró QEMU Guest Agent en ejecución, pero su parada
terminó con error 1053. El reinicio de la VM y una parada solicitada al invitado
seguida de nuevo arranque no recuperaron la lectura: el siguiente lector sigue
fallando con timeout RPC. La VM queda arrancada, sin cambiar UAC ni ampliar acceso.
Esto es un fallo del canal de diagnóstico, no evidencia de éxito o fallo de
elevación del producto. La lectura visual posterior se documenta a continuación.

### Windows: resultado de consentimiento manual recuperado — 24/10/2026

La carpeta parecía vacía en el selector de Bloc de notas porque el filtro era
`Documentos de texto (*.txt)`. Al cambiarlo a `Todos los archivos`, se observó el
informe `manual-consent-20261024-b.json` y se abrió sin ejecutar otro diagnóstico:
`workerExited:true`, `workerExitCode:0`. La salida de errores figura con tamaño
0 KB en el selector. La lectura fue visual mediante CUA, no una recuperación del
archivo bruto por RPC; no se atribuye un hash nuevo al contenido leído.

El ejecutable se había verificado por SHA-256 antes de la prueba. El modo usado
crea un solicitante con token filtrado del usuario de consola y ejecuta únicamente
su propio `--elevated-self-check` mediante `runas`. Ese modo termina con 0 solo
cuando observa pertenencia al contexto de administrador; el código se propaga
al informe. El propietario aceptó manualmente el aviso UAC. Por tanto se verifica
esa elevación acotada, sin cambios de UAC ni instalaciones adicionales.

No prueba aceptación remota, entrada de credenciales, SAS, DXGI ni el servicio
final. El canal RPC sigue sin recuperarse y la ausencia de procesos no está
verificada. Evidencia sin usuario ni sesión personal:
`windows-manual-consent-results.json`. El registro privado identifica el archivo
y su transcripción visual en `windows-manual-consent-visual-20261024.json`.
La tarea 1.2 sigue parcial y `readyForUnattended:false`; total 8/57.

### Windows: informe bruto y canal SSH de laboratorio — seguimiento 25/10/2026

Después de la lectura visual anterior se activó OpenSSH oficial en la VM, con
autorización expresa del propietario, clave exclusiva del Mac, escucha y firewall
limitados al enlace anfitrión/invitado, sin contraseñas ni reenvíos. Se verificaron
administración, SFTP por hash, rechazo sin clave, rechazo de túneles y recuperación
tras reiniciar con la misma huella contrastada en la consola. La VM volvió al
escritorio automáticamente; ese reinicio no demuestra permanencia en el login.
Es un acceso del laboratorio, no el agente gráfico de AbsorConnect; no se afirma
que el RPC de UTM haya quedado reparado.

Por ese canal se recuperó el informe original de consentimiento: 56 bytes,
SHA-256 `cd8890523caad2fc5e7cdd022562479729cfb99b0ed0be33d8c172d8b85ed02b`,
`workerExited:true`, `workerExitCode:0`; stderr tiene cero bytes. El binario
conserva el hash registrado antes de la prueba y se comprobó después la ausencia
de procesos del diagnóstico. No se repitió UAC ni se atribuye esta comprobación
posterior de limpieza al momento de aceptar el aviso. Se actualiza
`windows-manual-consent-results.json` con esa evidencia adicional.

### Windows: recepción nativa en ventana propia — 25/10/2026

`CaptureProbe.cs` añade modos fijos de entrada en una ventana Win32 propia.
El lanzador SYSTEM crea el trabajador con el token filtrado del usuario o con
SYSTEM en la sesión de consola y `Default`. El trabajador comprueba su token,
sesión, escritorio, primer plano, foco, punto de clic y ausencia de entrada
previamente pulsada. Solo entonces mueve el puntero al cliente de su ventana,
envía un clic y un carácter Unicode fijo. No acepta texto, coordenadas ni un
programa de destino de otra parte.

El código cero exige recibir mouse down/up, key down/up y el carácter esperado
en su procedimiento de ventana, y comprobar la restauración del puntero.
La ventana se retira aun si falla el ensayo; una intervención local no debe
provocar una restauración que compita con ella. El informe del lanzador propaga
el código real del trabajador: los indicadores del runner expresan esas
aserciones, no una traza de teclas ni solo el retorno de `SendInput`.

- Compilación en Windows ARM64, runtime `4.0.30319.42000`, fuente fijada por SHA-256.
- Primera ejecución: usuario filtrado y SYSTEM terminan con cero.
- Runner reproducible `run-probe.ps1 -TestOwnedInput`, en otra carpeta nueva:
  captura `Default` con 7 fotogramas no uniformes y vuelve a verificar los dos
  perfiles, incluidos los eventos recibidos y el puntero restaurado. La ejecución
  final comprueba también el destino bajo el puntero inmediatamente antes del clic.
- Caso negativo desde SSH en sesión 0 y sin SYSTEM: rechazo
  `owned_input_token_context_required`, antes de crear ventana o enviar entrada.
- Tareas temporales sin disparador automático retiradas; cero procesos del
  diagnóstico y cero tareas de esa ejecución al terminar. No instala SCM ni
  cambia UAC, autologin o credenciales.

Evidencia pública: `windows-owned-input-results.json`. Informes y lanzadores
privados en el laboratorio, con hashes del binario de cada compilación y del
informe bruto. No se afirma compilación binaria determinista.

El destino de entrada está en el mismo proceso que la inyecta. Esto **no demuestra
control entre procesos o de otra aplicación elevada**, ni escritura de credenciales,
bloqueo/login, SAS, DXGI, códigos físicos, varios monitores/escalados o WebRTC.
El tiempo total incluye compilación y captura y no es una medida de latencia.
La tarea 1.2 sigue parcial: `readyForUnattended:false`, total 8/57.

Verificación de esta iteración: typecheck correcto; Vitest 276 correctos y 5
omitidos; PHPUnit 162 pruebas y 1077 aserciones; OpenSpec estricto correcto.
Vitest se ejecutó con Node nativo de macOS porque el `node_modules` compartido
carece del paquete Rollup ARM64 de Linux requerido por el contenedor.

### Windows: receptor elevado en otro proceso — 25/10/2026

`run-probe.ps1 -TestOwnedInput -TestElevatedInput` compila la fuente identificada
por hash en Windows ARM64 y ejecuta el emisor SYSTEM en la sesión de consola.
Este crea únicamente un receptor fijo del diagnóstico en otro proceso, con el
token vinculado del usuario: ambos validan token completo e integridad alta. El
receptor solo observa entrada, no la inyecta. El runner contrasta PIDs distintos,
PID del receptor coincidente y misma sesión en sus informes originales privados.

Resultado: un mouse down/up, un key down/up y el carácter fijo recibidos; salida
cero y puntero restaurado. La regresión de ventanas propias con usuario filtrado
y SYSTEM vuelve a pasar, y la captura obtiene ocho fotogramas no uniformes.
Las ejecuciones directas de los nuevos modos desde SSH/sesión 0 se rechazan antes
de crear ventana o enviar entrada. Tras retirar la tarea temporal hay cero
procesos y cero tareas del laboratorio. UAC conserva `EnableLUA:1`,
`PromptOnSecureDesktop:1` y `ConsentPromptBehaviorAdmin:5`.

Esto acredita entrada entre procesos en un receptor de prueba elevado, no una
aplicación comercial. SYSTEM ya autorizado crea el receptor sin pedir UAC en
este ensayo; no se atribuye a esta ejecución consentimiento ni credenciales.
La creación de contraseña de laboratorio fue completada por el propietario,
sin recibirla ni registrarla el diagnóstico. Las pruebas de UAC con credenciales,
bloqueo/login, SAS, DXGI y agente/transporte siguen pendientes; tarea 1.2 parcial,
`readyForUnattended:false`, total 8/57. Evidencia saneada con hashes en
`windows-elevated-input-results.json`; los informes originales quedan privados.

Verificación: typecheck correcto, Vitest 276 correctos y 5 omitidos con Node
nativo de macOS, PHPUnit 162 pruebas/1077 aserciones; OpenSpec estricto correcto.

### Windows: UAC con credenciales introducidas por el propietario — 25/10/2026

Se verificó una cuenta de consola estándar habilitada y ajena a Administradores,
creada por el propietario sin recibir sus credenciales. Se ejecutó el binario
identificado en `windows-credential-uac-results.json` y su `--launch-uac-probe`:
solo permite `runas` de su propio `--elevated-self-check`. El aviso de UAC pide
credenciales de administrador; el propietario confirmó introducirlas y aceptar.

El informe bruto recuperado por SFTP tiene `workerExited:true`,
`workerExitCode:0`, launcher cero y stderr vacío. El destino devuelve cero al
verificar pertenencia al contexto de administrador. La captura mientras se ve
el aviso obtiene ocho fotogramas no uniformes en `Winlogon`; después obtiene
nueve en `Default`. No se guardan imágenes ni contraseñas. Se retiraron las
tareas temporales y se comprobaron cero procesos, conservando UAC y su política
para usuarios estándar. Es elevación con credenciales **manuales en la consola
de la VM**, no escritura de contraseñas por AbsorConnect ni por el diagnóstico.

### Windows: captura bloqueada y Escape de recepción inconclusa — 25/10/2026

El nuevo `-TestLockEscape` usa un modo fijo y exclusivo: captura `Winlogon`,
crea un trabajador SYSTEM allí y verifica primer plano de `LogonUI.exe`, sesión
de consola y ausencia de teclas retenidas antes de enviar solo Escape down/up.
La VM se bloqueó por su consola y se mostró el formulario vacío sin introducir
credenciales. El código no envía Enter, texto ni clics en ese formulario.

La captura registra nueve fotogramas no uniformes y SendInput devuelve dos
eventos. Sin embargo, la observación inmediata no muestra efecto verificable.
Se preparó otra vez el formulario y se repitió con el mismo binario, sin recompilar
ni esperar una captura previa: mismo retorno y resultado visual inconcluso.
La comparación con Escape desde la consola tampoco cambió la observación
inmediata. Un fondo visto más tarde no se atribuye al envío, porque puede
intervenir la inactividad. **No se certifica recepción de teclado en login.**
El runner identifica expresamente que hace falta observación, no equipara su
código cero a una prueba completa. Evidencia: `windows-lock-escape-results.json`.

Los tres modos nuevos se rechazan desde SSH en sesión 0, antes de enviar entrada.
La regresión del código compartido pasa las ventanas propias de usuario/SYSTEM y
la cancelación del UAC propio: 1223, dos eventos y ocho fotogramas `Winlogon`.
Se retiraron todas las tareas temporales y se verificó ausencia de procesos.
El propietario desbloqueó la VM y la continuación verificó ocho fotogramas no
uniformes en `Default`, con trabajador terminado a cero y ninguna tarea o proceso
restante. Esa recuperación se añadió a `windows-lock-escape-results.json`;
no cambia el resultado inconcluso de Escape. Tarea 1.2 parcial,
`readyForUnattended:false`, total 8/57.

Comprobaciones de esta iteración: typecheck, Vitest 276 correctos/5 omitidos,
PHPUnit 162 pruebas/1077 aserciones y OpenSpec estricto. No cambia la aplicación
publicada ni se anuncia soporte desatendido de producción.

### Windows: navegación de foco recibida en LogonUI — 25/10/2026

Se añade una prueba fija Tab/Mayús+Tab que observa recepción por UI Automation,
sin atribuirla solo al retorno de SendInput. Primero se validó en una ventana
propia del usuario estándar: control de contraseña vacío y de solo lectura,
botón sin acción y recorrido de ida y vuelta. La interfaz vive en un hilo STA y
el cliente UIA en otro MTA; cero exige todas las aserciones nativas. El usuario
filtrado no puede escribir en la carpeta protegida y el runner deriva el resultado
de ese código, como en las pruebas de ventana propia anteriores.

Después se bloqueó **solo la VM Windows** y se mostró su formulario vacío por
UTM. El runner exclusivo `-TestLogonFocus` verificó nueve fotogramas no uniformes
de `Winlogon` y lanzó el trabajador SYSTEM allí. Antes de cada envío comprueba
QEMU/UAC, sesión activa, escritorio del hilo y de entrada, ejecutable en primer
plano `System32/LogonUI.exe`, foco esperado y ninguna tecla retenida. Tab cambia
de un control Edit con `IsPassword:true` a un botón; Mayús+Tab devuelve el foco
a la identidad original. Se insertaron seis eventos y se observaron las dos
transiciones, sin pulsar Enter ni botones.

UIA solo lee PID, tipo, `IsPassword` e identidad opaca para comparación en
memoria; no consulta nombres, valores ni texto, y no guarda runtime IDs,
contraseñas o imágenes. Los cinco modos nuevos se rechazan desde SSH en sesión
0; el runner rechaza combinar el ensayo de LogonUI con el de ventana propia.
Regresión del mismo código: ventanas propias usuario/SYSTEM correctas, prueba
de foco propia correcta y UAC cancelado con 1223, dos eventos Escape y nueve
fotogramas de `Winlogon`. Compilación con las bibliotecas UIA ya presentes en
.NET; no se instalaron componentes ni se cambiaron políticas.

Evidencia saneada y hashes de binarios e informes brutos en
`windows-logon-focus-results.json`. Tareas temporales retiradas y cero procesos
restantes. Tras el nuevo desbloqueo confirmado por el propietario, el mismo
binario obtuvo nueve fotogramas no uniformes en `Default` y terminó con cero.
Se retiró la tarea temporal: cero procesos y tareas, UAC conserva los valores
1/1/5/3. Se confirma navegación de foco en bloqueo y recuperación de captura; no
autenticación por el diagnóstico, SAS, ratón en LogonUI, DXGI, SCM ni WebRTC.
La tarea 1.2 continúa parcial, `readyForUnattended:false`, total **8/57**.

Verificación del proyecto: typecheck correcto, Vitest 276 correctos/5 omitidos
con Node nativo de macOS, PHPUnit 162 pruebas/1077 aserciones con PHP 8.5.12 y
OpenSpec estricto correcto. Los cambios siguen limitados al laboratorio y sus
evidencias; no se publica una nueva versión de la aplicación.

### Mint: recepción XTest en ventana propia — 25/10/2026

Se implementó `linux-owned-input-check.py --test-own-input` como usuario gráfico
sin privilegios. No necesita instalar paquetes ni modificar Xauthority: usa el
archivo privado del usuario, Cinnamon/X11 activo y las bibliotecas GTK 3/XTest
existentes. Crea únicamente una ventana propia sin campo de texto; cuenta los
eventos nativos recibidos de un clic y una pulsación fija, con sus liberaciones.

Antes de enviar comprueba sesión, salvapantallas inactivo, ninguna tecla o botón
retenido y foco propio. Antes del clic comprueba además posición y jerarquía de
la ventana bajo el puntero. No admite coordenadas, teclas ni destinos externos.
Los pares down/up difieren la cancelación; el ensayo tiene un plazo de veinte
segundos, destruye su ventana y restaura el puntero si no cambió el contexto.

La primera revisión se canceló porque GTK enfoca un hijo InputOnly interno y
su XID no coincidía con el principal. La revisión final verifica la pertenencia
al árbol propio, sin aceptar ventanas ajenas. Dos ejecuciones en Mint x86_64
obtuvieron exactamente un mouse-down/up y un key-down/up, cero eventos
inesperados, puntero restaurado y retorno observado al foco anterior. Ambos
trabajadores terminaron a cero y sin stderr. No se leen ni guardan teclas ajenas,
texto, títulos, coordenadas, cookies ni identificadores de ventanas.

Se verificó rechazo antes de abrir interfaz sin opción explícita, con un destino
arbitrario incluso aportando la opción y como root en el contenedor. Tras la
prueba hay cero trabajadores propios y Cinnamon sigue sin salvapantallas activo.
No se cambiaron servicios, políticas ni permisos del sistema. Evidencias saneadas
y hashes: `mint-owned-input-results.json`; originales privados.

Este emisor y receptor comparten proceso/usuario. **No** se acredita entrada de
root, otro proceso, polkit, bloqueo o LightDM ni transporte remoto. La tarea 1.4
continúa parcial, `readyForUnattended:false`, total **8/57**.

### Mint: autorización manual de polkit y captura — 25/10/2026

`linux-polkit-manual-check.py --request-polkit` fija únicamente
`pkexec --disable-internal-agent /usr/bin/true`, con ejecutables del sistema
pertenecientes a root y sin escritura para otros. Se ejecuta como usuario desde
Terminal de Mint, con los dos diagnósticos auxiliares fijados por SHA-256 en una
carpeta privada nueva. No hay agente de texto, credenciales por stdin ni entrada
sintética sobre el aviso. Cuenta imágenes solo mientras su solicitud sigue
pendiente y publica `CAPTURA_COMPLETADA` antes de que autentique el propietario.
Retira su solicitante si se cancela o vence la espera de dos minutos; no sobrescribe
los informes. Código cero acredita la operación fija; ver el diálogo y usar
contraseña requieren confirmación humana separada.

El propietario confirmó haber autenticado con contraseña en el aviso local.
Los informes recuperados y sus hashes verifican diez muestras no uniformes de
128×72 mientras la solicitud seguía pendiente, `requesterExitCode:0`,
`noOpCompleted:true` y `requesterExited:true`. No quedan procesos pkexec. Los
hashes de las tres fuentes en Mint coinciden con los transferidos. Se reconcilia
este escenario manual en `mint-polkit-manual-results.json`; el campo original
`polkitTested:false` se conserva en el informe bruto. No prueba entrada sintética
sobre polkit ni una comprobación administrativa dentro de código del diagnóstico.

La invocación real usó `-i` minúscula: Python quedó interactivo después de acabar
la solicitud. Se registra esta variante, sin contar aislamiento `-I` ni salida
del proceso Python a cero. Se pidió al propietario salir con Ctrl+D, sin repetir
la autenticación. El propietario confirmó después su salida; se comprobaron cero
intérpretes de la prueba, cero pkexec y Cinnamon sin salvapantallas activo.
No hubo contraseñas por stdin o por el chat.
La tarea 1.4 sigue parcial y `readyForUnattended:false`, total **8/57**.

Puerta del proyecto: typecheck, Vitest 276 correctos/5 omitidos, PHPUnit 162 pruebas
y 1077 aserciones con PHP 8.5.12, OpenSpec estricto y comprobación de diff. Cambios
limitados al laboratorio y evidencias, sin nueva publicación de producción.

### Mint: entrada root hacia receptor de usuario verificada — 25/10/2026

Se prepara `linux-root-input-check.py` para una prueba separada de privilegios:
root abre exclusivamente la autoridad privada de Xorg validada por el auxiliar
de sesión fijado por hash. Crea un receptor GTK como el usuario activo, sin grupos
suplementarios ni entorno heredado del administrador. El código del receptor es
fijo, y el canal es un socketpair anónimo heredado, sin servidor de red ni socket
en el disco. El emisor comprueba UID del proceso creado y PID de su ventana,
foco en su árbol propio, sesión/Cinnamon, posición del puntero y entrada no
retenida antes de un clic y una tecla fija, con liberaciones. El receptor cuenta
eventos nativos; no recibe texto, comandos ni rutas arbitrarias. El plazo del
emisor es treinta segundos; el receptor y el canal se retiran al terminar.

El programa exige fuentes pertenecientes a root y padres sin escritura para
otros; ejecuta exactamente los bytes comprobados del auxiliar, sin pycache.
`linux-root-input-install.sh` verifica hashes, crea un destino nuevo protegido,
copia solo dos fuentes y ejecuta el ensayo mediante sudo. El lanzador debe
ejecutarse como usuario; no instala servicios, cambia polkit ni abre puertos.
El informe se escribe como usuario en su carpeta privada, sin sobrescribirlo.

Sintaxis del padre y receptor comprobadas, Bash válido y argumentos del lanzador
rechazados antes de sudo. En Mint se rechaza el emisor sin root; en el contenedor
se rechazan fuentes en un directorio no protegido. Con fuentes protegidas, la
ausencia de herramientas de sesión produce `FileNotFoundError`, sin abrir X11 ni
enviar entrada. Fuentes y lanzador transferidos con hashes verificados.
El informe de preparación conserva ese estado histórico previo al ensayo.

Después de la ejecución local del propietario se recuperó el informe positivo,
con el hash de fuente esperado: emisor root y receptor GTK de otro proceso/UID,
ventana/PID comprobados, autoridad privada de root, un `mouseDown`, `mouseUp`,
`keyDown` y `keyUp`, cero eventos inesperados. El puntero se restauró, el receptor
terminó y se observó retorno al foco anterior. La limpieza posterior verificó
cero emisores y receptores, Cinnamon sin salvapantallas activo y las dos fuentes
instaladas como root/0600. No se observó el código de salida del lanzador en la
Terminal del propietario; se conserva el informe bruto sin añadirlo.

Evidencia saneada y hashes: `mint-root-input-results.json`; originales privados.
Las fuentes quedan instaladas para auditoría en el directorio de laboratorio;
no se creó servicio. Esto acredita entrada root → ventana propia del usuario,
pero todavía no entrada en LightDM, bloqueo o polkit ni transporte remoto.
La tarea 1.4 sigue parcial y `readyForUnattended:false`, total **8/57**.

### Mint: preparación inicial de cancelación de polkit desde root — 25/10/2026

`linux-polkit-cancel-check.py --test-polkit-cancel` utiliza fuentes root protegidas
con el auxiliar de sesión fijado por hash. Un trabajador Python fijo, ejecutado
como usuario sin grupos adicionales ni entorno heredado, solicita exclusivamente
`pkexec --disable-internal-agent /usr/bin/true`. Se mantiene un padre sin
privilegios para la solicitud, porque pkexec autoriza a su proceso padre.
El supervisor root solo podrá enviar Escape y su liberación, sin texto o clics.

Antes de abrir la solicitud exige Cinnamon/X11 desbloqueado, ningún pkexec
existente y foco inicial ajeno a Cinnamon. Antes de la tecla verifica que sigue
la sesión original, no hay entrada retenida, el trabajador tiene UID de usuario,
solo hay un pkexec hijo de ese trabajador, la solicitud sigue pendiente y el foco
X11 pertenece al PID validado de Cinnamon. El resultado positivo exigirá código
126 del solicitante a través de su trabajador; no cuenta como autorización.
La espera total se limita a treinta segundos y retira el trabajador/solicitante.
No cambia políticas, crea servicios ni lee texto del diálogo o credenciales.

Fuentes transferidas con hashes comprobados. Sintaxis del supervisor y trabajador,
Bash y argumentos del lanzador comprobados; en Mint se rechazó el supervisor
sin root. En contenedor se verificaron denegaciones por directorio no protegido,
hash incorrecto y sesión inexistente; el lanzador rechazó ejecución como root.
Esos casos no enviaron Escape. El ensayo positivo en Mint está **pendiente**;
se solicitó al propietario ejecutar el lanzador desde su Terminal y dejar el
aviso sin tocar. Evidencia: `mint-polkit-cancel-preparation.json`. El foco en
Cinnamon y el código de cancelación correlacionan la solicitud propia; no se
trata de un canal de entrada remoto ni certifica otros avisos concurrentes.
La tarea 1.4 sigue parcial, **8/57**, `readyForUnattended:false`.

Comprobaciones del proyecto tras preparar este ensayo: typecheck correcto,
Vitest 276 correctos/5 omitidos, PHPUnit 162 pruebas/1077 aserciones con PHP
8.5.12, OpenSpec estricto y diff válidos. No se modificó código de la aplicación
ni producción y no se dedujo recepción de entrada de esos controles automáticos.

#### Primera ejecución y revisión de diagnóstico

El propietario observó el cierre automático del aviso, sin tocarlo. Sin embargo,
el informe del intento a registra `held_input_prevents_probe`,
`escapePressSent:false`, `escapeReleaseSent:false` y trabajador terminado.
La solicitud propia se retiró durante la limpieza; el cierre del aviso no se
cuenta como prueba de entrada. Se verificaron cero pkexec/trabajadores propios
y Cinnamon sin salvapantallas activo. La primera revisión no registraba qué
clase de entrada estaba retenida: no se atribuye una causa concreta.

La revisión 2 espera hasta dos segundos antes de la solicitud y cuatro con ella
pendiente, exigiendo dos muestras neutras consecutivas. Mantiene la denegación
si persiste entrada retenida y las demás comprobaciones de foco/sesión/solicitante.
Solo registra cantidades iniciales, máximas y finales de teclas/botones, número
de muestras y fase; nunca códigos, mapas, texto o coordenadas. No fuerza la
liberación de teclas ajenas. Conserva plazo global y limpieza. Usa un directorio
root nuevo y una carpeta de usuario nueva, sin sobrescribir la revisión anterior.

Sintaxis del supervisor/trabajador y Bash, argumentos ajenos, denegación sin root
en Mint y denegaciones de fuentes/hash/sesión/lanzador root en contenedor pasaron
con la nueva fuente. Hashes transferidos comprobados. El intento b está pendiente
de ejecución local; evidencia reconciliada en `mint-polkit-cancel-attempts.json`.
La preparación inicial se conserva como registro histórico. No cambia el estado
de tarea 1.4 ni certifica recepción nativa a partir de este aborto.

#### Segunda ejecución, observación nativa del foco y revisión 3

El intento b volvió a abortar sin Escape: `pending_cinnamon_prompt_focus_required`.
Las dos fases registraron dos muestras neutras, cero teclas y cero botones
retenidos; el propietario confirmó no tocar el aviso. El trabajador terminó y
la limpieza posterior comprobó cero pkexec/trabajadores propios y Cinnamon sin
salvapantallas activo. Este resultado no prueba recepción de entrada y no explica
retroactivamente la clase de entrada retenida del intento a.

Se inspeccionó el código instalado de ModalDialog en Cinnamon: utiliza el modal
del compositor y el foco de actores, por lo que exigir el PID de Cinnamon bajo
XGetInputFocus no identifica necesariamente al receptor. Antes de volver a enviar
entrada se preparó `linux-polkit-focus-check.py`: consulta únicamente PID de
aplicación, roles/estados de diálogos y foco vía AT-SPI como usuario, con límites
de resultados/espera. No llama a texto, valores o acciones accesibles ni genera
entrada. Su lanzador no usa sudo y guarda un informe privado sin sobrescribirlo.

Por SSH la solicitud terminó con 127 antes de observar aviso; no se atribuye una
causa más precisa. Ejecutado desde Terminal de la sesión gráfica, se observó
cero diálogos antes, uno con un único campo de contraseña enfocado mientras el
solicitante seguía pendiente y cero tras retirarlo. El propietario no tocó el
aviso. La retirada produjo código -15: es limpieza, no una cancelación por tecla.
Evidencia: `mint-polkit-focus-results.json`, con originales/hashes privados.

La revisión 3 utiliza esa observación para validar el destino. El auxiliar de
foco se fija por hash y se instala como tercera fuente root/0600. Sus bytes
comprobados se entregan al trabajador de usuario, sin grupos adicionales, como
código fijo; root no se conecta al bus de accesibilidad como administrador.
Un socketpair anónimo heredado solo intercambia fases, metadatos y dos órdenes
fijas (`focus`/`finish`), sin red, archivos de socket ni órdenes arbitrarias.

Se exige ausencia inicial de diálogos de Cinnamon, un diálogo nuevo con un único
campo de contraseña enfocado y una segunda consulta fresca antes de Escape.
Se conservan sesión/UID/PID comprobados, un único pkexec hijo del trabajador,
autoridad Xorg privada, entrada neutra y liberación de Escape. XGetInputFocus
solo registra el retorno observado del foco, no acredita el destino del envío.
El éxito requerirá código nativo 126, solicitante terminado, trabajador a cero
y desaparición del diálogo; no cuenta la retirada durante un aborto.

Supervisor, auxiliar y trabajador completo compilados; sintaxis Bash y argumentos
comprobados. En Mint se rechazó ejecución sin root; en contenedor se rechazaron
padres no protegidos, hashes de sesión/foco alterados, sesión inexistente y
lanzador root. El trabajador real por SSH intercambió fase inicial y error al
terminar la solicitud antes de observarla, sin entrada. Fuentes transferidas con hashes
comprobados a carpeta nueva para el intento c; el ensayo con entrada está
**pendiente**. No se certifica cancelación, credenciales, bloqueo, LightDM o
transporte remoto. La atribución por accesibilidad es del laboratorio, no una
frontera de seguridad del agente final. Tarea 1.4 parcial, **8/57**.

Tras integrar la revisión 3 se repitieron typecheck (correcto), Vitest (276
correctos/5 omitidos) y PHPUnit (162 pruebas/1077 aserciones, PHP 8.5.12).
OpenSpec estricto, JSON/hashes y diff también correctos. Estos controles no
sustituyen el intento c pendiente y no cambian el soporte publicado.

#### Intento c: cancelación nativa de polkit verificada

El propietario ejecutó la revisión 3 y confirmó no tocar el aviso. El informe
recuperado coincide con la fuente fijada por hash: root envió Escape con su
liberación y el solicitante devolvió **126**. El trabajador terminó a cero;
se observaron cero diálogos al inicio, uno con un único campo de contraseña
enfocado en las consultas pendiente/fresca y cero después. Entrada neutra antes
de solicitar y antes de enviar, retorno observado al foco X11 previo y
`requesterExited:true`. No se ejecutó la operación fija ni se autenticó al usuario.

La limpieza independiente comprobó cero pkexec/trabajadores propios, Cinnamon
sin salvapantallas activo y las tres fuentes instaladas root/0600. Se conservan
los originales privados y hashes en `mint-polkit-cancel-attempts.json`; la
preparación de cada revisión mantiene su estado histórico previo al ensayo.
No se repite una autenticación ni se sobrescribe un resultado fallido.

Este escenario acredita recepción nativa de Escape para cancelar la solicitud
propia de polkit desde el emisor root. No prueba escritura de credenciales,
autenticación por entrada sintética, bloqueo/LightDM o transporte WebRTC.
`polkitAuthenticationTested:false`, `readyForUnattended:false`; tarea 1.4 parcial,
**8/57**. Solo cambian laboratorio y evidencias, sin nueva publicación.

### Mint: observación del foco en bloqueo preparada — 25/10/2026

Tras verificar cancelación de polkit se prepara `linux-lock-focus-check.py`,
únicamente como observador de usuario. Usa los auxiliares de contexto/foco
fijados por hash desde una carpeta privada, sin pycache. Solo consulta la sesión
propia X11, GetActive, propietario UID/PID del servicio ScreenSaver y roles/estados
AT-SPI de esa aplicación. No captura imágenes, escucha teclas, lee texto/valores,
envía entrada o llama a Lock/SetActive/SimulateUserActivity. No crea servicios ni
modifica políticas, archivos del sistema o configuración del inicio de sesión.

El inventario inicial real por SSH pasó: sesión propia activa y desbloqueada,
propietario del bus verificado, una aplicación accesible y cero campos de
contraseña mostrados/enfocados. Sintaxis, opción obligatoria, rechazo como root
y hashes de transferencia comprobados. `--inventory-only` no espera transiciones
ni guarda archivos en Mint. Evidencia: `mint-lock-focus-preparation.json`.

Se inició después el observador completo, con archivos exclusivos 0600 y un
plazo de tres minutos, y emitió `waiting_for_owner_lock`. El propietario recibió
la coordinación para bloquear solo Mint, mostrar el campo durante quince segundos
y desbloquearlo localmente. El observador dejará de consultar foco al encontrar
un campo de contraseña enfocado y consultará solo GetActive hasta desbloquear.
La transición y los metadatos en bloqueo siguen **pendientes**. El uso real de
contraseña requiere confirmación humana independiente; GetActive por sí solo no
certifica bloqueo. No prueba entrada nativa en bloqueo/LightDM ni transporte.
La tarea 1.4 sigue parcial, **8/57**, `readyForUnattended:false`.

#### Primera espera sin transición

El observador terminó con `owner_lock_transition_timeout` tras tres minutos,
sin observar GetActive:true ni enviar entrada. Solo registró el contexto inicial
válido y `waiting_for_owner_lock`. Se recuperaron el informe y el registro privado;
se verificaron cero procesos de esa ejecución. Esto no indica una avería de
bloqueo: no hay una transición observada que permita evaluar el foco.
Se avisó de que ya no se debe bloquear para esa ejecución y se pidió confirmar
presencia delante de Mint antes de iniciar otra. Los archivos de una carpeta
nueva están preparados con hashes verificados, sin arrancar otro observador.
Evidencia: `mint-lock-focus-results.json`. Preparación previa conservada como
histórica; tarea 1.4 parcial, **8/57**, sin nueva publicación.

#### Segunda observación: bloqueo y foco verificados

Con el propietario preparado se inició un observador nuevo y se coordinó el
bloqueo/desbloqueo solo de Mint. El informe coincide con la fuente fijada:
`lockedStateObserved:true`, un campo de contraseña mostrado/enfocado en la
aplicación del propietario del bus verificado, `unlockedStateObserved:true` y
cero campos después. El propietario confirmó que volvió al escritorio y que el
desbloqueo pidió contraseña. Tras encontrar ese foco se dejaron de consultar sus
metadatos hasta desbloquear, sin leer contenido ni escuchar teclas.

Los tres eventos registran espera, activación y foco de contraseña observado.
El trabajador terminó y se comprobaron cero procesos propios. Evidencia saneada
y hashes en `mint-lock-focus-results.json`; originales privados. Es observación
de contexto/foco con confirmación humana, no recepción de entrada sintética:
`inputTested:false`, `captureTested:false`, `readyForUnattended:false`. Quedan
entrada en bloqueo y LightDM y la integración del agente. Tarea 1.4 parcial,
**8/57**, sin cambios de producción.

### Mint: navegación nativa en bloqueo preparada — 25/10/2026

`linux-lock-input-check.py --test-locked-navigation` reutiliza las fuentes
protegidas de sesión/foco fijadas por hash y el acceso privado a Xauthority del
servidor Xorg. El supervisor root crea un trabajador de usuario sin grupos
adicionales, conectado solo por socketpair anónimo heredado. El trabajador
consulta exclusivamente metadatos AT-SPI del servicio ScreenSaver cuyo UID/PID
verifica; no usa interfaces de texto, valores o acciones ni escucha teclas.

Se inicia en escritorio desbloqueado y emite `READY_TO_LOCK_MINT` antes de esperar
al propietario. Este bloquea y muestra el campo. El trabajador exige un único
campo de contraseña enfocado y comprueba que dos consultas conservan la misma
identidad de objeto antes de permitir entrada. El supervisor comprueba sesión,
PID del compositor, estado de ScreenSaver, UID del trabajador y entrada neutra.
La sesión se compara sin LockedHint: la señal de Cinnamon, ya comprobada, es la
fuente de bloqueo y se exige antes de cada secuencia.

Solo envía Tab con liberación; el trabajador debe observar otro control enfocado.
Con otra consulta fresca, Mayús+Tab debe devolver el foco al objeto inicial.
Se liberan las teclas propias en finally, con señales bloqueadas durante cada
secuencia. Después solo se consulta GetActive hasta el desbloqueo manual, sin
seguir consultando foco mientras el propietario escribe su contraseña. No llama
a Lock/SetActive, autentica, pulsa botones ni mueve el puntero. Plazo global de
tres minutos; un fallo retira solo su trabajador, sin tocar el servicio de bloqueo.

El lanzador verifica hashes, copia tres fuentes root/0600 a un destino nuevo y
captura un informe privado exclusivo. El temporizador empieza al ejecutarlo el
propietario. Sintaxis del supervisor/trabajador completo y Bash comprobadas;
inventario nativo del trabajador por SSH a cero, sin campos mostrados ni entrada.
Rechazos sin root en Mint, fuentes no protegidas, hashes de sesión/foco alterados,
sesión inexistente, lanzador root y argumentos ajenos verificados, con contadores
de envío a cero. Hashes transferidos comprobados. Evidencia:
`mint-locked-navigation-preparation.json`. El ensayo con entrada está **pendiente**;
no se certifican bloqueo, LightDM o transporte a partir del inventario.
La tarea 1.4 sigue parcial, **8/57**, `readyForUnattended:false`.

#### Ejecución: Tab y Mayús+Tab recibidos en el bloqueo

El propietario ejecutó el lanzador y confirmó que volvió al escritorio tras
introducir la contraseña. El informe identificado por los mismos hashes de
preparación devolvió `locked_tab_navigation_verified_not_certified`: supervisor
root y trabajador sin privilegios, identidad estable del campo, contexto
bloqueado conservado y recepción nativa de ambas secuencias. El foco pasó del
rol AT-SPI 40 al 43 y volvió al **mismo objeto** inicial; no se publican las
referencias de esos objetos. Contadores Tab 2 pulsaciones/2 liberaciones y
Mayús 1/1, con entrada neutra antes y después de la navegación.

El trabajador dejó de consultar el foco antes del desbloqueo, observó la vuelta
a escritorio y terminó con código 0. La comprobación independiente encontró
cero procesos del ensayo, ScreenSaver inactivo y tres fuentes regulares
root/0600. El foco X11 anterior también se observó restaurado, sin forzarlo.
Evidencia y hashes privados reconciliados en
`mint-locked-navigation-results.json`; la preparación anterior se conserva.

Esto acredita navegación sin texto en el bloqueo de esta configuración de
Cinnamon. No prueba contraseñas, autenticación sintética, entrada en LightDM,
cambio de usuario, reinicio ni transporte remoto. `inputTested:true`,
`captureTested:false`, `preLoginTested:false`, `readyForUnattended:false`. La
tarea 1.4 sigue parcial y el progreso permanece en **8/57**. No hay nueva
versión de producción por estos cambios de laboratorio.

### Mint: observador de Slick Greeter preparado — 25/10/2026

La entrada nativa en LightDM sigue pendiente. El nuevo diagnóstico
`linux-greeter-focus-check.py --observe-greeter` es de solo lectura: espera el
paso de la sesión Cinnamon desbloqueada al greeter X11 de lightdm, vuelve a
resolver la autoridad privada del Xorg actual y lee únicamente la propiedad
`AT_SPI_BUS` de la raíz, limitada a 512 bytes y a una dirección Unix local. No
lee entornos de procesos, cookies, títulos ni contenido de pantalla. La lectura
de esa propiedad y el tipo ABI se comprobaron en el escritorio real de Mint
como usuario ordinario; esto no acredita todavía el greeter.

Comprueba un único `/usr/sbin/slick-greeter` con UID de lightdm y crea un
trabajador con ese UID/GID, sin grupos adicionales y sin DISPLAY/XAUTHORITY.
Solo recibe la dirección local de accesibilidad y el PID esperado; selecciona
la aplicación accesible con ese PID y consulta roles/estados acotados. Al
encontrar el campo de contraseña enfocado termina el trabajador y deja de
consultar el foco. El supervisor espera únicamente una nueva sesión del usuario
original y la vuelta a Cinnamon desbloqueado. No cambia servicios ni
configuración, no envía entrada y no autentica. Plazo global de tres minutos.

El lanzador instala dos fuentes root/0600 en un destino nuevo, con hashes
fijados, y guarda un informe privado exclusivo. Exige ejecutarse por SSH desde
el Mac para conservar el diagnóstico al cerrar la sesión gráfica de Mint. La
contraseña de sudo y el posterior inicio de sesión los hace el propietario.

Sintaxis Python del supervisor/trabajador y Bash comprobadas; rechazo sin root
en Mint, argumentos ajenos, lanzador local sin SSH, directorio no protegido,
hash de auxiliar alterado, greeter ausente en contenedor y lanzador root
verificados. Transferencia y hashes comprobados. Evidencia:
`mint-greeter-focus-preparation.json`. La observación de LightDM, incluido el
trabajador como lightdm, sigue **pendiente**. No acredita entrada ni completa
1.4: **8/57**, `readyForUnattended:false`.

Referencias primarias del mecanismo:
[publicación/retirada de AT_SPI_BUS en Slick Greeter](https://github.com/linuxmint/slick-greeter/blob/master/src/slick-greeter.vala)
y [selección de AT_SPI_BUS_ADDRESS en libatspi](https://github.com/GNOME/at-spi2-core/blob/main/atspi/atspi-misc.c).

#### Primera ejecución y revisión 2 del observador de greeter

El propietario ejecutó la primera revisión por SSH, cerró sesión y confirmó
vuelta al escritorio y al prompt del Mac. El diagnóstico detectó la sesión
greeter, pero terminó con `bounded_accessibility_string_required`, antes de
iniciar el trabajador accesible. La comprobación independiente encontró cero
procesos propios y dos fuentes root/0600. El informe no distinguía qué
condición falló; no permite atribuirlo a formato, tamaño o ausencia transitoria.

La revisión 2 distingue átomo existente con propiedad ausente (tipo None,
formato/longitud cero) y reintenta solo esa ausencia dentro del plazo de arranque
ya previsto. Registra únicamente estado, categoría de tipo, formato, cantidad
y bytes restantes, con número de muestras limitado. Conserva STRING, formato
8, máximo 512 bytes y dirección Unix única, sin aceptar propiedades truncadas,
otros tipos, direcciones TCP o listas de direcciones.

En el Mint real se verificaron la propiedad del escritorio y seis casos sobre
una **ventana propia no mapeada**, destruida después: átomo existente sin
propiedad, cadena local válida, tipo incorrecto, propiedad excesiva, dirección
no local y lista de direcciones. No se modificó la propiedad de la raíz ni se
envió entrada. El primer caso reproduce el guard que faltaba, pero no demuestra
que causara la ejecución inicial. Sintaxis Python/Bash, denegación sin root,
lanzador sin SSH/argumentos ajenos y denegaciones de directorio/hash/binario
ausente/lanzador root pasaron con los nuevos hashes; transferencia comprobada.

Se preparó un destino nuevo, sin sobrescribir el ensayo anterior. Evidencia
reconciliada y preparación de revisión 2 en `mint-greeter-focus-attempts.json`.
La repetición del greeter sigue pendiente; `inputTested:false`,
`captureTested:false`, `preLoginTested:false`, `readyForUnattended:false`.
La tarea 1.4 sigue parcial, **8/57**.

#### Segunda ejecución: propiedad de accesibilidad ausente

La revisión 2 detectó la sesión greeter. Las **36 consultas** durante el plazo
de arranque devolvieron estado X11 0, tipo None, formato/cantidad/bytes restantes
cero: `greeter_accessibility_property_absent`. No inició el trabajador
accesible. El propietario volvió al escritorio y al prompt del Mac; la
comprobación independiente encontró cero procesos propios y fuentes root/0600.
El informe privado íntegro se conserva por hash; el artefacto público resume
las muestras idénticas en `mint-greeter-focus-attempts.json`.

Se acredita la ausencia de la propiedad durante ese intervalo, no la ausencia
del bus privado de D-Bus del greeter ni un fallo de captura/entrada X11. No se
aumenta el tiempo a ciegas ni se vuelve a solicitar el mismo ensayo físico. El
propietario pidió priorizar una VM controlable desde el Mac para automatizar
las repeticiones. Se prepara un laboratorio Linux ARM con Cinnamon/LightDM;
la configuración física Mint x86 sigue siendo el objetivo de aceptación y sus
resultados no se sustituyen por los de la VM. Tarea 1.4 parcial, **8/57**.

### Laboratorio Linux ARM automatizado en el Mac — 25/10/2026

Se creó una VM Ubuntu 24.04.5 ARM con Cinnamon 6.0.4/LightDM/Slick Greeter,
QEMU 11.1.2/HVF, dos vCPU, 4 GiB y disco virtual qcow2 de 40 GiB. Imagen
oficial y checksum comprobados; NoCloud terminó sin errores. Clave exclusiva,
SSH en loopback, sockets privados y cuenta generada solo para laboratorio.
La administración y el teclado virtual se controlan desde el Mac, sin pedir
las credenciales personales del propietario.

Pasaron arranque, observación del campo de contraseña como lightdm, inicio de
sesión gráfico por QMP, cierre y nuevo inicio de sesión, apagado limpio, punto
`desktop-ready`, nuevo arranque y restauración de disco/variables UEFI. Un
marcador posterior desapareció tras restaurar y se verificó otro inicio de
sesión. Estos controles de laboratorio no son entrada del agente AbsorConnect.

También se ejecutaron los prototipos existentes: captura de región XGetImage
con diez fotogramas no uniformes y recepción GTK nativa de clic/tecla por XTest
(1/1/1/1, cero inesperados, puntero restaurado). El foco anterior no se observó
restaurado en esa ejecución; no se fuerza ni se declara comprobado. Limpieza
independiente: cero procesos de esos prototipos.

La vía alternativa de D-Bus se comprobó en la VM: dirección seleccionada del
entorno acotado del greeter verificado, consulta como lightdm sin grupos,
propietario PID/UID de `x.dm.SlickGreeter` comprobado, `org.a11y.Bus` ya activo,
sin solicitar activación automática ni guardar direcciones/entornos. El
trabajador accesible original con ese prefijo observó el campo enfocado. No
equivale a pasar el supervisor completo en el Mint físico.

Evidencia y hashes en `linux-arm-virtual-lab-results.json`; operación y límites
en `prototypes/remote-desktop/unattended-check/linux-virtual-lab.md`. Esta VM
reduce las intervenciones durante desarrollo, pero no sustituye la aceptación
de Mint x86 ni los requisitos de Windows/Mac. Tarea 1.4 parcial, **8/57**,
`readyForUnattended:false`. Sin publicación de una versión por el laboratorio.

### Observador LightDM revisión 3: supervisor completo verificado en VM

Se incorporó la vía D-Bus al supervisor: solo si AT_SPI_BUS permanece ausente
tras la espera de arranque original, selecciona DBUS_SESSION_BUS_ADDRESS de un
entorno acotado (64 KiB) del greeter cuyo UID/ejecutable comprueba antes y
después. No conserva el entorno ni la dirección. El trabajador se ejecuta como
lightdm sin grupos adicionales, comprueba el PID/UID propietario del nombre
x.dm.SlickGreeter y exige org.a11y.Bus ya activo. GetAddress usa NO_AUTO_START y
la dirección resultante debe seguir siendo Unix local, única y ≤512 bytes. No
se amplían el plazo global ni los tipos/formatos aceptados de la vía X11.

Con fuentes protegidas root/0600, instalador y hashes verificados, pasó el
supervisor completo en la VM Ubuntu ARM: escritorio inicial → LightDM → campo
de contraseña enfocado → nueva sesión del mismo usuario. Hubo 38 consultas
X11 de propiedad ausente antes de seleccionar la vía de sesión existente. El
trabajador y el supervisor terminaron con código 0, y el foco dejó de consultarse
antes del inicio de sesión. El controlador de laboratorio hizo cierre e inicio
por CLI/QMP con su cuenta exclusiva; el diagnóstico no envió entrada ni leyó
contraseñas.

En otra ejecución automática de la VM, un bus privado temporal con el nombre
x.dm.SlickGreeter perteneciente a otro PID produjo greeter_bus_owner_mismatch y
salida 3 antes de consultar AT-SPI. También se rechazó UID esperado incorrecto.
Ambos casos sin entrada; procesos/socket temporales retirados. Comprobación
independiente posterior: cero procesos del diagnóstico y fuentes root/0600 con
los hashes esperados. Sintaxis del supervisor/trabajador y Bash correctas.

Resultados y hashes privados reconciliados en
`linux-greeter-session-bus-results.json`. La configuración ARM y las versiones
difieren del Mint físico. No acredita entrada del agente en greeter, captura o
transporte remoto y no sustituye la aceptación física. Los dos fallos físicos
anteriores y la preparación se conservan. `inputTested:false`,
`captureTested:false`, `preLoginTested:false`, `readyForUnattended:false`;
tarea 1.4 parcial y **8/57**. Sin nueva publicación por estos diagnósticos.

### Navegación nativa en LightDM y recuperación de fallo, VM Linux

El 25/10/2026 se verificó `linux-greeter-input-check.py` y su instalador de
hashes fijos en la VM Ubuntu 24.04.5 ARM, Cinnamon 6.0.4, LightDM 1.30.0 y
Slick Greeter 2.0.1. El supervisor root abre solo el display autorizado y deja
la observación AT-SPI a un hijo lightdm, sin grupos ni Xauthority. Se validan
PID/UID del nombre del greeter, registro AT-SPI ya existente y propietario,
foco estable y estado de entrada neutral antes de cada secuencia fija.

Pasó escritorio → greeter → Tab → Mayús+Tab → nueva sesión del mismo usuario.
El observador vio roles 40 → 43 → 40 y comprobó por identidad del objeto que
volvió al campo inicial. Los envíos nativos fueron Tab 2/2 y Mayús 1/1. Hijo y
supervisor terminaron con código 0; observación y conexión X11 cerradas antes
de autenticar con el controlador QMP independiente del laboratorio. No se
leyeron nombres, valores ni contenido de campos ni se guardaron imágenes.

El primer intento se rechazó con `initial_unlocked_user_required`, sin teclas;
se conservó su informe y se preparó una nueva sesión y destino de instalación.
En un ensayo posterior se terminó únicamente el hijo lightdm del diagnóstico
antes de la entrada: el supervisor rechazó la prueba (salida 3, EOF del canal
registrado como `JSONDecodeError`), no envió teclas y se pudo entrar normalmente
con el controlador independiente. No se alteró ni señalizó ningún proceso de
LightDM. También pasaron rechazos por identidad incorrecta, falta de root,
fuentes en ruta modificable, hash cambiado, ausencia de SSH, argumentos y
reutilización de informe. Se verificó que el informe anterior no cambió.

Limpieza independiente: cero procesos propios, cero teclas retenidas,
escritorio desbloqueado y tres fuentes root/0600 con hashes exactos. El
prototipo no instala servicios ni modifica LightDM; retirar sus archivos
propios restaura el estado previo, conservando antes la evidencia. La VM
dispone además del punto de restauración ya verificado. Sintaxis Python del
supervisor y trabajador, Bash, hashes, JSON y OpenSpec estricto comprobados.

Evidencia reconciliada en `linux-greeter-navigation-results.json`. El login por
QMP no cuenta como entrada de credenciales del prototipo. Faltan Mint físico,
texto, captura/entrada integrada, cambio de usuario y servicio/transporte
finales. El paso nativo tiene `inputTested:true`, pero `preLoginTested:false`
y `readyForUnattended:false`; tarea 1.4 parcial y **8/57**. Sin nueva release ni
certificación de acceso desatendido completo por este ensayo.


### Núcleo Rust de autorización: implementación anterior al piloto físico

El propietario pidió el 25/10/2026 dejar la aceptación física al final y avanzar
primero las partes comunes en laboratorios. Se creó el workspace `agent/` con
la biblioteca `absor-agent-core`, sin dependencias de terceros. Tiene permiso
inicial vacío, una única sesión, vigencia de hasta 30 segundos desde el inicio
de petición, respuestas de un solo uso y referencias ligadas a cada instancia.
Revocar/parar cierra e inhabilita; el error de red no prolonga el permiso. La
caducidad invalida la sesión anterior incluso si después llega otra validación.

Los relojes nativos cuentan suspensión: CLOCK_BOOTTIME de Linux 64 bits,
mach_continuous_time de Mac y QueryInterruptTimePrecise de Windows. Un error o
retroceso cierra e inhabilita. El reloj se consulta antes/después de operaciones
y mediante poll sin tráfico. La implementación FFI está aislada y no cambia
permisos del sistema ni consulta cuentas.

Pasaron 14 pruebas en Mac ARM (Rust 1.99.1) y VM Ubuntu ARM (Rust 1.75.0): plazo
exacto de 30 segundos, viaje de red descontado, respuesta tardía/repetida/ajena,
renovación, error de red, revocación, parada, exclusión de sesiones, referencias
obsoletas, reloj averiado/retrocedido y suspensión simulada. Pasó también el
ensayo con reloj nativo y proceso hijo real: al caducar lo termina y rechaza
operaciones posteriores. Ese hijo no captura, envía entrada ni usa red, y su
frontera de autenticación es simulada explícitamente.

Formato Rust, Clippy sin advertencias, compilación release y lockfile offline
correctos en ambos sistemas. La descarga inicial del instalador Rust externo
en VM venció sin ejecutarse; se usaron después los paquetes oficiales de Ubuntu,
y se comprobó el mínimo 1.75. CI dedicado añade las mismas puertas con toolchain
1.85.0 fijado en Linux/Mac/Windows. El resultado de cada ejecución se consulta
en la PR; añadir el workflow no equivale a certificarlo ni a probar el hardware.

TypeScript pasó; Vitest: 276 correctas y 5 omitidas. PHPUnit: 162 pruebas,
1077 aserciones, PHP 8.5.12. El build desde el contenedor falló por el binario
opcional Rollup de Linux ausente en los node_modules del host; el mismo build
pasó con Node nativo de Mac, sin modificar dependencias ni el lockfile de npm.

La biblioteca es una primera parte de 3.1/3.2/3.4. Faltan cliente HTTPS validado,
autenticador v1, persistencia de intentos/secretos, trabajadores reales y
watchdog que termine captura/entrada/transporte aun si el broker cae. No se
anuncia el cumplimiento integrado de la revocación de 30 segundos por pasar
pruebas aisladas del núcleo. La revisión de macOS se mantiene para su agente
final. Tareas parciales, **8/57**; ningún alta o servicio nuevo ni release.


El paquete Mac ARM sin publicación también se construyó con electron-builder
26.15.3 y firma ad-hoc. Se inspeccionó su `app.asar`: 9668 entradas, sin `agent/`
ni backend/mobile/prototypes. Evidencia de fuentes, artefactos y comprobaciones
locales en `agent-authorization-core-results.json`; hashes de logs privados
reconciliados. No se instaló este paquete ni se cambió la app del propietario.


### API de renovación integrada con el núcleo y un proceso propio

`agent-api` implementa la consulta autenticada del agente con HTTPS verificado,
sin redirecciones, proxies de entorno, cookies o compresión. El cuerpo y el
contrato JSON están acotados; la credencial de agente tiene formato estricto,
Debug censurado y no se pasan tokens por argv/env. El coordinador separa HTTP
al actor con un solo hilo/consulta/respuesta pendientes y mantiene los ticks de
caducidad durante la red. 401/403 corta e inhabilita; error de red/formato/TLS o
respuesta tardía no extiende permiso; 429 respeta la espera. Las dependencias
se fijaron con su grafo compatible con Rust 1.75; no se añade un runtime async.

Pasaron 24 casos con lab-http (23 sin esa característica) en Mac ARM/Rust 1.99.1
y VM Ubuntu ARM/Rust 1.75.0: contrato, duplicados, límites, credencial distinta
de cuenta, origen, loopback exclusivo de laboratorio, HTTP real local,
redirección con destino trampa no contactado, rechazo de TLS inválido,
consulta bloqueada con caducidad, revocación, Retry-After y respuestas tardías,
más los 14 casos anteriores del núcleo. Formato, Clippy sin advertencias y
release correctos. El ensayo de TLS inválido no certifica todos los posibles
fallos de certificados ni el empaquetado final de raíces.

También se probó con la API real de desarrollo y un proxy de fallo loopback,
sin detenerla: cuentas, dispositivos y altas exclusivos efímeros. Un caso
revoca por la API; el otro corta solo las peticiones de su cliente. En ambos,
el binario Rust terminó su propio hijo, recogió su salida y rechazó operaciones
posteriores. Las cuentas se retiraron. El primer lanzador abortó durante una
consulta de limpieza de procesos bloqueada por el sandbox; no se contó como
éxito. Se eliminaron exclusivamente sus dos cuentas con patrón reservado en
la base local y se movió la retirada por API a un finally independiente del
cierre del proxy. La repetición completa y la final pasaron, con cero cuentas
residuales. No se usa ps para el funcionamiento de la prueba actual.

La medida final fue 3105 ms desde la revocación y 29899 ms desde el corte de
red. El proceso no es un host: se simula la frontera del autenticador v1 y no
tiene captura, entrada o P2P. La API de laboratorio usa HTTP exclusivamente en
loopback por una característica optativa; el constructor normal conserva
HTTPS aunque se compile esa característica. No se hizo un alta en producción.

TypeScript correcto, Vitest 276 correctas/5 omitidas y PHPUnit 162 pruebas/
1077 aserciones en PHP 8.5.12. Evidencia y hashes reconciliados en
`agent-api-renewal-results.json`. El CI descarga primero el lockfile y repite
las puertas offline en las tres plataformas. Faltan alta/almacén real, API
completa de señalización, autenticador, trabajador WebRTC y supervisor/watchdog.
Tarea 3.4 parcial y **8/57**, sin nuevo servicio ni publicación del agente.


### Verificador v1 e intentos entre procesos

`agent-auth` implementa HMAC-SHA256 con ring, nonce aleatorio del sistema,
parámetros actuales de contraseña y una prueba por desafío. Se prueban los tres
vectores compartidos, PBKDF2 de la cadena completa y quince alteraciones de
contexto/clave. El verificador exige huellas SHA-256 bien formadas y prueba
base64 canónica; JSON de versión/tipo/campos cerrados, sin duplicados, acotado
a 512 bytes. Hello conserva los seis campos del protocolo actual. No añade
versiones ni paquetes externos al grafo anterior: ring/base64 ya estaban fijados.

El registro de intentos exige carga válida y reemplazo atómico/durable desde
un propietario exclusivo. Reserva un fallo antes del HMAC y lo borra solo
tras prueba y escritura correctas. Las pruebas cubren repetición, otra conexión,
cinco fallos y borde de quince minutos, reinicio del verificador, escritura que
falla incluso después de guardar, estado corrupto/ausente/incoherente, reloj
retrocedido y parada explícita. Un error nunca concede un resultado autenticado.
La reserva puede consumir un intento si el proceso cae durante la verificación.

Además de los dobles de prueba, restart-smoke usa un diario temporal y dieciséis
procesos reales separados: cinco fallos conservan el bloqueo al arrancar otro
proceso y los accesos correctos limpian los fallos. K y huellas son públicas
fijas de laboratorio. El directorio se retira al terminar; no se leen datos de
la app, crean cuentas/servicios, capturan imágenes o envía entrada. Este archivo
no certifica ACL/cifrado/concurrencia de los almacenes de producción.

Mac ARM con Rust 1.99.1 y VM Ubuntu ARM con Rust 1.75.0 pasaron 34 pruebas por
omisión y 35 con todas las características, once nuevas de autenticación,
formato, Clippy sin advertencias, ejemplo entre procesos y release. TypeScript
correcto, Vitest 276 correctas/5 omitidas y PHPUnit 162 pruebas/1077 aserciones
en PHP 8.5.12. Fuentes, artefactos y logs privados reconciliados por hash en
`agent-v1-auth-results.json`. CI incorpora el ensayo en las tres plataformas y
se dispara también si cambia el fichero de vectores compartidos.

El módulo no está enlazado al adaptador C++/DTLS: el resultado solo es una
frontera interna confiable y no una autorización de IPC. Faltan almacenes por
SO, migración y la prueba integrada que impida captura/entrada antes de
autenticar. No hay servicios instalados, alta en producción ni nueva release.
La tarea 3.2 sigue parcial; **8/57 tareas cerradas (14 %)**. Este porcentaje
cuenta tareas aceptadas, no estima el tiempo que falta. Pruebas físicas al final.

### Rust, API y DTLS/vídeo artificial integrados

`agent-webrtc-lab` enlaza el verificador y el coordinador de renovación con el
trabajador C++ de libwebrtc. Usa K/salt públicos fijos y una ABI optativa ausente
por omisión: solo loopback, credencial efímera y un diario de laboratorio por
PeerConnection. Los identificadores internos no son direcciones; la ABI valida
tamaños y rechaza identificadores ajenos/cerrados. Las pruebas Rust comprueban
nulos, tamaños, carga corrupta, cierre idempotente y no reutilización en el
proceso. `unsafe` se limita a los buffers C válidos del llamador compilado.

El target nuevo se compila en Mac ARM con el Rust del checkout fijado de WebRTC
como dylib, separado de su runtime Rust interno. Comprueba autorización API
antes de crear la PeerConnection y verifica v1 sobre las huellas de sus
descripciones aplicadas, con la comprobación de certificado DTLS de libwebrtc.
Solo después añade la pista artificial. El adaptador consulta cada 50 ms y
cierra fuente/canal/conexión al revocar o caducar. Se comprueba también el handle
activo y el cierre después de tick, evitando reactivar un transporte cerrado
cuando llega otra concesión. No existe aún un watchdog independiente.

La matriz final con Electron 39.8.5/Chromium 142.0.7444.265 pasó cinco casos:
vídeo rojo válido, HMAC erróneo, huella alterada, revocación y corte de API.
Los dos negativos generaron y decodificaron **cero fotogramas**. Los cortes
observados en el controlador fueron **2267 ms** por revocación y **29167 ms**
sin API. Se confirmó cierre del canal y motivo nativo; dos arranques adicionales
con token revocado/API inaccesible terminaron antes de crear PeerConnection.
El recorrido fue directo host/host, con imágenes artificiales, sin captura o
entrada del sistema. No hereda las pruebas TURN/móviles del prototipo anterior.

El visor utiliza un protocolo limitado a dos recursos públicos, CSP, sandbox y
contexto separado. La prueba confirmó rechazo de la ruta de credenciales y de
lectura de un archivo marcador por file://. La credencial de agente no se envía
al renderer; el token de cuenta solo lo usa el lanzador temporal, nunca C++.
No se serializan resultados de autenticación como autorizaciones de IPC.

La API de desarrollo alcanzó su límite normal de registros, así que no se
cambiaron ni resetearon sus contadores. El lanzador final prepara una API en
puerto loopback libre, caches tmpfs y una BD exclusiva en el Postgres local,
con PHP 8.5.12 y los límites originales. Retiró las cinco cuentas, el contenedor,
la BD y el archivo de entorno. Comprobación posterior: cero contenedores
etiquetados del ensayo y cero BD con su prefijo. Las ejecuciones que no pudieron
arrancar Electron dentro del sandbox no se contaron como éxito; la matriz final
se ejecutó en contexto GUI autorizado con perfil propio, sin permisos nuevos.

Mac/Rust 1.99.1 y VM Ubuntu ARM/Rust 1.75 pasaron 34 casos por omisión y 37 con
características completas, formato, Clippy sin advertencias y release en ambos
modos. Se comprobó por símbolos que la ABI está ausente por omisión y presente
en la dylib del ensayo. Los tres casos del diagnóstico anterior también pasaron.
TypeScript correcto; Vitest 276 correctas/5 omitidas; PHPUnit 162 pruebas y
1077 aserciones. Sintaxis de los lanzadores correcta y OpenSpec estricto válido.
Fuentes, artefactos y logs privados reconciliados en
`agent-webrtc-bridge-results.json`. CI amplía las puertas Rust a los tres SO;
no construye libwebrtc en Windows/Linux ni ejecuta allí esta matriz P2P.

Faltan almacenes/IPC protegidos, señalización completa por API, trabajadores
con captura/entrada real, supervisor/watchdog e instaladores. No se ha hecho
alta en producción ni nueva release. 3.1/3.2/3.4 siguen parciales; **8/57 tareas
cerradas (14 %)**. La revisión de firma/arquitectura Mac y la aceptación física
final se mantienen.


El primer CI de esta PR detectó que el reloj Windows se había declarado con
la import library incorrecta. El SDK requiere Mincore.lib para
QueryInterruptTimePrecise, aunque el DLL sea Kernel32. Se corrigió el enlace
sin cambiar la base temporal. También se fija Bash con salida inmediata ante
error en todos los runners: PowerShell había continuado tras fallos de comandos
nativos, así que el éxito global anterior no acreditaba cada puerta de Windows.
La repetición debe confirmar pruebas, ejemplos y ambos builds antes de integrar.


## 26/10/2026 — Vigilancia independiente y fallos integrados

Se añade `agent-supervisor`: control terminal de progreso con reloj del arranque,
pulsos secuenciales fechados y plazo de dos segundos. Una fecha acumulada no
renueva desde su recepción. Protocolo/líneas/cola acotados; repetición, salto,
fecha futura, reloj incoherente, EOF o saturación fallan cerrados. El lector de
pipes no sustituye al actor de autorización para generar pulsos del trabajador.

La feature `synthetic-lab` crea un supervisor sin privilegios y un trabajador
artificial propio. En el recorrido WebRTC, el supervisor posee el proceso C++
y lo termina/recoge si se bloquea su actor. Un hilo separado del trabajador
vigila al supervisor y termina el proceso completo si pierde sus pulsos o su
pipe. La salida de emergencia usa `_exit`/`TerminateProcess` sobre sí mismo;
no depende de destructores C++/`atexit`. El ensayo integrado detectó que la
salida ordinaria no aseguraba la terminación del trabajador dentro del plazo.
También se corrigió la observación de EOF: llenar la cola es un fallo terminal,
pero el lector sigue drenando para medir la salida real del proceso, sin
confundir el cierre del lector con la muerte del trabajador.

La matriz final pasó nueve casos Mac ARM/Electron: los cinco previos más
bloqueo del actor, caída del trabajador, bloqueo del supervisor durante cinco
segundos y caída del supervisor. HMAC/huella erróneos siguieron generando y
recibiendo cero imágenes. Revocación cortó el canal en **2387 ms** y pérdida
de API en **29370 ms**. El actor bloqueado terminó en **1999 ms**; el trabajador
observó al supervisor bloqueado y terminó en **1934 ms** (EOF medido desde otro
hilo, antes de que el actor padre despertara). Las caídas terminaron los pipes
en **57 ms** y **50 ms**, respectivamente. En los cuatro casos dejaron de llegar
fotogramas. Una muerte abrupta sobre UDP no garantiza aviso DTLS inmediato al
controlador: ese estado no se confunde con la terminación del host.

Se verifican hashes del extremo, dylib y supervisor antes de lanzar. No se
reinicia ni reutiliza una PeerConnection anterior. Las peticiones de fallo
son enumeradas y solo alcanzan procesos hijos propios; no se admiten comandos,
PIDs ni ejecutables del renderer. El helper retira el grupo exclusivo del ensayo
si vence su timeout y publica pronto su ruta privada para retirar copias de
credenciales también en errores. Las cinco cuentas, contenedor/BD aislados y
archivo de entorno se retiraron. Comprobación posterior: cero contenedores
etiquetados y cero BD de laboratorio; límites compartidos de desarrollo intactos.

Mac Rust 1.99.1 y VM Linux ARM Rust 1.75 pasaron **42 pruebas por omisión y 51
con todas las features**, formato, Clippy sin advertencias y release en ambos
modos. Incluyen seis pruebas con procesos reales y ocho de reloj/protocolo/pipe.
La variante C++ anterior pasó sus tres casos de vídeo. TypeScript correcto,
Vitest **276/5 omitidas** y PHPUnit **162/1077 aserciones**; sintaxis de los
lanzadores y OpenSpec estricto correctos. Evidencia y hashes en
`agent-supervisor-results.json`; logs con metadatos locales solo en laboratorio.
La matriz CI ejecuta las mismas puertas Rust en los tres sistemas; la prueba
WebRTC continúa limitada a Mac/Electron, sin atribuirla a Windows/Linux.

Esta capa es vigilancia de vida, no autenticación de IPC ni autorización nueva.
No implementa SCM/launchd/systemd, almacenes de credenciales protegidos, entrada
liberada por un proceso separado tras caída, señalización completa o instaladores.
No se instala un servicio ni se publica una release: producción sigue en 0.4.1.
3.1/3.2/3.4 permanecen parciales, **8/57 tareas aceptadas (14 %)**; la revisión de
macOS y las pruebas físicas continúan pendientes y se mantienen al final.


## 26/10/2026 — Señalización API y base de trabajador X11

La variante Rust/libwebrtc intercambia ahora ofertas/respuestas e ICE a través
del backend real de laboratorio. El controlador publica su solicitud desde
main; Rust retiene su ID, consume la oferta una vez y publica su respuesta,
sin confiar en IDs o rutas aportados por el renderer. El reto v1 espera la
confirmación de esa respuesta. Un carril HTTP separado, con un solo trabajo,
evita que la señalización bloquee la renovación. Una respuesta/ICE/204 no
amplía el lease. UUID, SDP, ICE y TTL están acotados; no hay redirecciones,
proxy del entorno, token de cuenta en el trabajador o credencial en el visor.

Pasaron los nueve casos Mac ARM/Electron anteriores usando esa API, con **cero
archivos SDP**. La prueba positiva recibió otra solicitud mientras seguía el
vídeo y la rechazó como `busy`. HMAC/huellas incorrectos generaron y recibieron
cero imágenes. Revocación cortó el canal en **2174 ms**, pérdida de API en
**29285 ms**. El trabajador bloqueado terminó en **2004 ms**; se mantuvieron
las comprobaciones de caída/bloqueo de supervisor y ausencia de nuevos frames.
El lanzador comprobó los hashes de extremo, dylib y supervisor antes de
ejecutarlos. La ABI sigue ausente por omisión; el build optativo
exporta ahora siete funciones, con oferta/respuesta adicionales acotadas.

`agent-x11-lab` añade un trabajador inicial nativo, ejecutado sin privilegios
en la VM Ubuntu ARM/Cinnamon. Tiene un hilo de Xlib y una cola de capacidad uno;
`Session::close` marca parada sin esperar a Xlib, se descarta respuesta tras
parada y un error del trabajador es terminal. Requiere `VerifiedConnection`
consumible, autorización del mismo gate y un marcador root temporal exclusivo
de la VM. Comprueba UID/sesión/asiento/Display X11, estado activo y señal de
Cinnamon desbloqueado antes de abrir y operar; ni `LockedHint` ni el foco X11
sustituyen esa señal. Solo captura su ventana propia 320×180/TrueColor24 y
acepta un pulso de clic izquierdo y tecla fija. Exige foco/destino del puntero
propios y entrada libre, con liberación de pulsos y restauración del puntero.
No lee texto de eventos y no guarda/transmite píxeles por red.

El ensayo real con el backend confirmó **cero operaciones nativas antes de
autenticar**, prueba HMAC incorrecta rechazada, captura roja, un clic/tecla
recibidos con sus liberaciones y captura verde posterior. Al cortar API cerró
el trabajador en **29665 ms**, rechazó captura/entrada posteriores y no hubo
más operaciones nativas. Otro arranque con Cinnamon activo terminó con **cero
intentos de captura y entrada**. El helper restituyó el escritorio de la VM,
retiró el marcador y cerró su túnel loopback. Credencial por stdin en SSH,
sin token de cuenta o secretos escritos en la VM; core dumps desactivados.

Los primeros ensayos detectaron mapeado asíncrono de la ventana y un
salvapantallas que interceptaba eventos aunque el foco figurara propio. No se
contaron como éxito. Se añadió espera de visibilidad y comprobación explícita
de sesión/Cinnamon. La ventana de ensayo sin decoraciones evita los agarres
del gestor; se verifica además el destino del puntero. Xlib se inicializa para
hilos y sus bibliotecas del SO permanecen mapeadas por sus callbacks TLS.
Una comprobación previa con API simulada de cinco segundos se usó solo para
diagnóstico; los resultados anteriores corresponden al backend real aislado.

CI detectó en Windows que EOF podía preceder al estado final del proceso:
una salida correcta se clasificaba como fallo. El supervisor ahora recoge el
estado durante una espera acotada de 250 ms sin emitir más pulsos ni renovar
autorización. Si el hijo sigue vivo, lo termina y recoge. Dos pruebas de
proceso fuerzan EOF antes de una salida correcta y EOF con un hijo que sigue
vivo. Pasan en Mac y Linux; CI verifica además la variante Windows.

Una repetición nativa se detuvo antes del clic al no coincidir el destino
real del puntero con la ventana propia. Se conserva esa denegación y se eleva
solo nuestra ventana antes de la comprobación, con contexto/foco/entrada libre
revalidados antes del clic. Se registran únicamente booleanos del fallo, sin
IDs o contenido de ventanas. Tres repeticiones con API simulada de cinco
segundos pasaron; se mantienen separadas del ensayo con backend real.

Mac/Rust 1.99.1 pasó **43 pruebas por omisión y 60 con todas las features**;
la VM Linux ARM/Rust 1.75 pasó **43 y 62**, con dos pruebas Linux adicionales
sin interfaz (propiedad exclusiva y fallo terminal). Formato, Clippy sin
advertencias y release en ambos modos correctos. El ejemplo nativo se compiló
y ejecutó en la VM; la variante C++ anterior pasó sus tres casos. TypeScript,
Vitest **276/5 omitidas**, PHPUnit **162/1077 aserciones**, sintaxis y OpenSpec
estricto correctos. CI amplía las puertas Rust a Windows/Mac/Linux, sin ejecutar
captura en sus runners. Fuentes, hashes y límites en `agent-api-workers-results.json`.

Se retiraron las cinco cuentas, contenedor/BD aislados y archivos de entorno/
credenciales. No se alteraron límites compartidos o datos de desarrollo. PHP
sigue en 8.5.12. No se instala agente final ni se publica release; producción
continúa 0.4.1. El P2P sigue probado en Mac con vídeo artificial; el trabajador
Linux nativo aún no transporta sus píxeles/entrada por WebRTC. Pendientes
procesos/IPC protegidos, captura general, contexto continuo, liberación tras
muerte, servicios e instaladores de plataforma y aceptación física/móvil.
La revisión Mac sigue vigente. **8/57 tareas aceptadas (14 %)**, sin cierre
prematuro de 3.1/3.2/3.4/3.5/6.2.


## 26/10/2026: trabajador Linux por WebRTC y gestión systemd en VM

La variante optativa `native-fixture` une autorización API, v1/huellas DTLS,
trabajador X11, VP8 y el canal `input` en el mismo recorrido Linux ARM/Electron.
Son seis casos con backend real aislado: correcto, HMAC incorrecto, huella
incorrecta, revocación, pérdida de API y Cinnamon bloqueado. Cada caso utiliza
un proceso nuevo y las cinco cuentas efímeras existentes; no usa cuentas reales.
El transporte fue directo `host`/`prflx`, sin TURN ni archivos SDP. El visor
no recibió credenciales ni pudo leer rutas privadas/archivos locales.

La prueba positiva decodificó la ventana roja de 320×180, envió por DataChannel
botón izquierdo/KeyA con sus liberaciones y decodificó verde. Los cuatro eventos
se observaron una sola vez; texto, otra tecla, duplicados y entrada previa al
reto no generaron más operaciones nativas. HMAC/huella rechazados obtuvieron
cero aperturas X11, capturas, entradas y frames. Con Cinnamon bloqueado se
completó HMAC válido, se envió entrada y el trabajador terminó por
`unlocked_cinnamon_required`: cero captura/entrada/frames y canal cerrado.
El helper restauró automáticamente el escritorio solo de la VM.

Revocación cerró el canal en **1531 ms**; pérdida de API en
**28558 ms**. Ambos casos confirmaron cierre del trabajador nativo.
El constructor consume la prueba pero espera `start()` dentro del gate antes
de abrir X11. Una prueba nueva cancela antes de armarlo y comprueba cero acceso
gráfico. El actor sigue sin esperar a Xlib; toda respuesta posterior a parada
se descarta. La secuencia fija de entrada es un subconjunto de v1 de ensayo,
no control general de teclado/ventanas ni una extensión activada en Flutter.

Compilación: Clang de la revisión fijada en Mac genera ELF Linux ARM64;
Rust 1.75/lld 18 en la VM usan el mismo sysroot oficial Bullseye ARM64.
El enlace original detectó versiones glibc incompatibles; se alinearon SDK,
rutas de biblioteca y linker sin permitir símbolos sin resolver. El sysroot
conserva el SHA-256 oficial y el informe liga fuentes/artefactos por hash.
Artefactos y salidas Linux/Mac separados; ABI por omisión ausente, siete
funciones en la variante Mac y diez en `native-fixture`. El extremo C++ se compila explícitamente; solo el lanzador de la VM marcada
ejecuta operaciones X11. Las pruebas unitarias/CI no abren acceso gráfico.

Cada conexión se ejecutó bajo una unidad **systemd de usuario transitoria**,
con supervisor y trabajador sin privilegios, `NoNewPrivileges`, runtime 0700,
archivo 0600 con credencial efímera en tmpfs, límites de memoria/procesos,
core dumps desactivados, máximo 65 segundos y `KillMode=control-group`.
La unidad no reinicia conexiones. Las seis terminaron con código cero, sin
actividad ni runtime posterior. El token de cuenta permaneció en el proxy del
Mac; la señalización/API pasó por SSH y vídeo/entrada por WebRTC.

Una prueba separada con procesos artificiales verificó un reinicio tras caída,
parada explícita que queda detenida, muerte del hijo y retirada del runtime.
UID 1000, `NoNewPrivs=1` y capacidades efectivas cero comprobados. Esto prueba
el mecanismo systemd, no recuperación del agente con teclas retenidas.

Los primeros ensayos no se contaron como éxito. El supervisor cortó al recibir
EOF porque el lanzador cerraba stdin: se conserva esa protección y se mantiene
abierto el pipe de vida. Se evitó el segundo SIGTERM durante la limpieza.
El filtro de sockets bloqueaba `getifaddrs` (errno 97); una comprobación bajo
systemd confirmó fallo sin Netlink y éxito al permitirlo. No se concedió
CAP_NET_ADMIN ni se cambiaron interfaces/rutas. El supervisor registra solo
una etapa numérica en fallos tempranos, sin argumentos o configuración.

Rust pasó **43/61 pruebas en Mac** y **43/64 en Linux ARM**, formato, Clippy
sin advertencias y ambos releases. La regresión Mac conserva nueve casos de
API/DTLS/vídeo artificial/watchdogs; la anterior sin API pasó tres. TypeScript,
Vitest **276/5 omitidas**, PHPUnit **162/1077 aserciones**, sintaxis y OpenSpec
estricto correctos. CI amplía formato/análisis/pruebas/releases a los tres SO;
no ejecuta captura en esos runners.

Se acepta **3.4** por sus criterios del núcleo común: reloj/red simulados
(caducidad exacta, RTT descontado, suspensión, respuesta tardía, renovación y
recuperación con sesión nueva), rechazo sin permiso y corte P2P real ≤30 s con
trabajador integrado. La señalización no renueva el permiso y una concesión
nueva no rehabilita el transporte anterior. La prueba Mac también verifica
que un agente revocado o sin API no crea otra PeerConnection.

**9/57 tareas completas (16 %)**. Siguen abiertas 3.1/3.2/3.5/6.1/6.2: broker
persistente, IPC/almacén protegidos, servicio de sistema y LightDM, captura/entrada
generales, transición continua y liberación desde otro proceso tras muerte.
Sin certificado de agente final, TURN/móviles o piloto físico para esta variante.
La revisión Mac sigue vigente. Se retiraron cuentas, contenedores/BD/entorno,
credenciales temporales, unidades y marcador; no cambian límites compartidos.
No se publica release ni se instala agente en producción, que continúa 0.4.1.
Evidencia acotada y hashes en `linux-webrtc-service-results.json`.


## 26/10/2026: broker persistente, servicio del sistema y diagnóstico acotado

`absor-agent-broker`, optativo `linux-broker-lab`, mantiene el actor entre
conexiones y ejecuta el transporte fijado mediante su supervisor. El UUID de
solicitud queda fijado: no elige otra oferta mientras espera la primera.
El broker consulta la API solo cuando está libre; cada transporte obtiene su
propia validación nueva y verifica DTLS/HMAC antes de abrir X11. El reinicio no
conserva autorización, y el diario de intentos deja de crearse por conexión.
No hay RPC/shell o rutas de ejecución recibidas desde WebRTC.

La unidad **del sistema** es instalada/habilitada temporalmente solo en la VM,
con ejecutables de root, UID 1000, capacidades cero, `NoNewPrivs=1`, `UMask=0077`,
montajes protegidos, límites y `KillMode=control-group`. La credencial original
es root 0600 dentro de un directorio 0700 y llega mediante `LoadCredential`,
fuera de argv/env. Se verificó la representación real de systemd 255: root:root
0440 con ACL del servicio. Un UID ajeno no puede leer configuración/copia/estado
ni sustituir el ejecutable. La identidad del broker todavía coincide con la
cuenta gráfica de laboratorio: no es el aislamiento/alta del paquete final.

La matriz de ciclo de vida usa un trabajador **artificial sin pantalla/entrada**:
dos sesiones sucesivas con el mismo PID del broker, ausencia de relanzamiento
de la solicitud pendiente, muerte del supervisor con retirada de todos los PIDs
anteriores, recuperación del cgroup, conservación del diario tras reinicio y
arranque del SO, parada explícita sin autoarranque y límite de activaciones.
Al detener el progreso del broker, el supervisor cortó su trabajador en
**2147 ms**; systemd recuperó después la unidad. Una muerte anómala del supervisor
hace salir al broker con código 75 para que la recuperación siempre limpie todo
el cgroup, en vez de admitir otro trabajador con un nieto incierto.

También se verificó el broker idle en LightDM y el arranque en frío antes del
primer login, sin Electron. El apagado del laboratorio puede esperar el plazo
de la sesión gráfica; no se modificó esa política. El reinicio en caliente
anterior quedó detenido en shim/UEFI con QEMU/HVF y requirió arrancar de nuevo
el hipervisor; **no se certifica reinicio remoto completo**. La prueba final
usa apagado limpio y arranque en frío, sin restaurar snapshots. Tras revocación,
la marca terminal permanece; un arranque manual termina con 77 antes de READY
sin volver a consultar la API ni activar un trabajador.

La matriz P2P separada usa el binario **nativo real**, API/BD y cuentas efímeras.
Los seis casos pasan bajo la nueva unidad: vídeo/entrada de ventana propia,
HMAC incorrecto, huella DTLS incorrecta, revocación, corte de API y Cinnamon
bloqueado. El caso correcto produjo 90 frames nativos, cambio rojo/verde y una
sola secuencia de clic/KeyA. Contraseña/huella erróneas y bloqueo no produjeron
frames, capturas o entrada. El corte por revocación fue **1415 ms**; sin API,
**28465 ms**. El registro muestra `worker_ended`, `worker_denied`,
`authorization_revoked`, `authorization_expired` y `worker_failed` según el caso.
El broker permanece tras sesiones ordinarias y queda detenido al revocarse.
Las seis retiraron servicio, runtime, estado y credencial al terminar. Continúan
el rechazo ocupado, cero SDP en archivos y denegación de credenciales al renderer.

El módulo común `audit` solo acepta eventos de enum, sin texto libre, datos de
usuario, red, UUID, SDP, credenciales o teclas. Máximo 64 registros y 16 KiB,
secuencia persistente, escritura exclusiva/sync/rename y fallo terminal de esa
instancia si no puede completar una escritura. Las pruebas verifican rotación,
reapertura, evento/campo/esquema ajenos, huecos, archivo grande, enlaces/permisos
Unix y transacción interrumpida. La extracción documentada en
`agent/linux-lab/README.md` lee únicamente `audit.json`; los informes reales
comprueban sus eventos. Se acepta **3.6**, sin certificar por ello el servicio
final ni su IPC/almacén de alta y controladores multiplataforma.

Rust pasa **49/71 pruebas en Mac** y **49/74 en Linux ARM**, formato, Clippy sin
advertencias y releases por omisión/todas las características; Linux conserva
Rust 1.75 y el sysroot fijado. Se conservan nueve casos de interoperabilidad Mac,
typecheck, Vitest **276 con 5 omitidas** y PHPUnit **162/1077**. La revisión CI se
consulta para el SHA exacto del PR y se conserva separada con sus logs completos.

**10/57 tareas aceptadas (18 %)**. 3.1/3.2/3.5/6.1/6.2/6.4 siguen parciales:
trabajador general, separación de identidades/IPC, credencial/K reales, guardian
de entrada tras muerte, transiciones/LightDM, paquete y piloto físico pendientes.
La revisión Mac no cambia. Producción continúa **0.4.1**, sin release ni agente
final desplegados. Se retiraron cuentas, contenedores/BD, archivos de entorno,
servicios, marcador y credenciales; la VM volvió al escritorio. Resultados y
hashes de fuentes/artefactos/evidencia en `linux-broker-results.json`.

### 27/10/2026 — credenciales únicas e IPC protegido, sonda Linux en VM

Se añade el crate `agent-security` y los binarios optativos
`absor-secret-provision-lab`, `absor-secure-broker-lab` y
`absor-ipc-worker-lab`, compilados solo con `protected-ipc-lab`. No se
incluyen en la app/release. La API normal conserva HTTPS obligatorio; la
excepción HTTP sigue limitada explícitamente a loopback del laboratorio.

El instalador nativo canjea `ace_` por una credencial real de la API efímera y
cifra esa credencial/K única con AES-256-GCM. La cuenta del servicio no es root
ni el UID del escritorio. Root guarda clave envolvente/configuración; systemd
entrega copias mediante `LoadCredential`. El trabajador no recibe esos secretos.
Se comprueban identidad del kernel y PID de la unidad root, permisos de socket,
esquemas cerrados, secuencia, límites y vencimiento de mensajes parciales.
No se confía en identificadores declarados por el emisor.

El lanzador usa Symfony/Postgres aislados, cuenta/host únicos y clave privada
exclusiva de la VM propia. Retira cuenta API, sistema/cuenta/socket/estado/secretos
y contenedor/BD. No modifica LightDM, PAM, Xauthority, polkit o SSH y no reinicia
el Mac anfitrión. La colisión de escritura posterior al canje provoca una baja
real en backend y retirada del almacenamiento parcial. Red caída o muerte del
instalador siguen necesitando reconciliación del propietario en la migración
final, que no se da por terminada.

Casos de la matriz: alta única; compensación; lecturas de secretos y `/proc`
denegadas con NNP; sustitución de socket denegada; UID ajeno/PID ajeno del mismo
UID rechazados; prueba correcta/incorrecta/repetida; secuencia repetida;
reinicio del trabajador sin resucitar sesión; pérdida/recuperación de API;
bloqueo persistente entre reinicios; blob manipulado; clave envolvente errónea;
registro de intentos ausente/corrupto; ausencia de secretos en trabajador y
auditoría; revocación terminal entre reinicios y retirada reversible. El número
de casos agrupados y sus resultados están en `protected-ipc-results.json`.
La observación de caducidad incluye viajes SSH; no se usa ese tiempo observado
como una nueva certificación de corte de captura/entrada ≤30 segundos.

**Límite de aceptación:** esta sonda solo incrementa un contador y mantiene
`os_operations_enabled=false`. Usa huellas fijas de diagnóstico, no una
PeerConnection real. La integración P2P/X11 anterior sigue separada y conserva
su clave pública de pruebas. Aún hay que unir el IPC al trabajador nativo,
conservar la identidad DTLS, conectar el corte independiente, implementar
migración/instaladores finales y las protecciones Windows/Mac. No se cierra
3.2, 6.4 o 7.2; se conserva **10/57 (18%)**. Producción continúa en 0.4.1 y
el piloto físico sigue al final. No se certifican administración general,
iOS/Android, TURN, prearranque ni nuevas versiones de Mac con esta prueba.

Resultado final: **14/14 casos IPC** con retirada comprobada; **6/6 regresiones
P2P Linux** de ventana propia y **9/9 Mac** de vídeo artificial. Typecheck,
Vitest (276, 5 omitidas), PHPUnit (162/1077), rustfmt/clippy, pruebas Rust
Mac (54 por omisión/76 con características) y Linux (59/84), y compilaciones
release por omisión/con características correctos. La primera regresión Linux
se detuvo antes del vídeo al no obtener autorización API; se retiró un marcador
de laboratorio residual y se repitió desde sesión VM preparada. El lanzador
nuevo conserva un marcador previo válido y elimina el suyo en la retirada.
Los informes privados se congelan fuera del repo en
`AbsorConnectLab/protected-ipc-evidence-20261027/`; el resumen público contiene
hashes de artefactos/fuentes y deja explícita la separación entre IPC y P2P.


### 27/10/2026 — IPC protegido unido al trabajador DTLS/X11

La característica `protected-ipc-fixture` utiliza el alta nativa/almacén cifrado
y otra identidad para el broker. El trabajador fijo termina DTLS y obtiene las
huellas realmente aplicadas; solicita desafío/verificación por el socket
validado y consume la capacidad antes de crear su superficie X11. K y los tokens
de cuenta/agente permanecen fuera del trabajador. El renderer solo recibe una
prueba HMAC del controlador de laboratorio, sin K o token. Se conservan los
vectores v1 y el contrato de clientes publicados.

La captura e input se limitan a una ventana propia; las pruebas incorrectas y
huellas alteradas registran cero aperturas, capturas e inyecciones. Se comprueba
el estado durable de intentos antes de retirar cada instalación. El broker
rechaza un segundo controlador por API y reinicia señalización por conexión,
sin crear carriles HTTP ilimitados ni aplicar respuestas de la conexión previa.
Dos conexiones al mismo host conservan PID/credencial del broker y exigen nonce
nuevo. La matriz anterior de 14 denegaciones conserva las pruebas de replay,
contador bloqueado tras reiniciar y almacenamiento ausente/manipulado.

El plazo del broker se exporta solo en el IPC autenticado del mismo sistema y
no se renueva por consultarlo. La bandera compartida del trabajador se corta al
vencer; una observación independiente del actor/mutex corta el proceso si IPC
no progresa, y systemd mata también al trabajador en SIGSTOP. Las pruebas P2P
incluyen revocación, API inaccesible, bloqueo de Cinnamon, SIGSTOP del trabajador,
SIGSTOP y SIGKILL del broker. Los tiempos y los resultados finales se registran
en `protected-native-results.json`. El indicador de cierre del hilo puede
muestrearse antes del cierre real; la retirada comprueba el fin del proceso/
cgroup. No se certifica liberación general de entrada tras caída del SO.

Se acepta **3.2 (núcleo/protocolo común)** con la integración Linux, los vectores
y las pruebas de persistencia/repetición y gate antes de captura/entrada.
Esto no acepta servicios finales Windows/Mac, sus almacenes/IPC, migración,
usuarios/greeter, escritorio completo, TURN, móvil o piloto exterior. Esas
condiciones conservan sus tareas separadas sin marcar. Avance: **11/57 (19%)**.
La distribución continúa en 0.4.1, sin nuevo agente instalado en equipos físicos.

Resultado final de la unión: **10/10 conexiones P2P protegidas** con cinco
cuentas/nueve hosts efímeros; dos conexiones conservan el mismo broker y usan
nonce distinto. Revocación observada a 342 ms; pérdida de API a 27 250 ms.
SIGSTOP del trabajador: 3177 ms hasta terminar su proceso; SIGSTOP/SIGKILL del
broker: 1592/169 ms. Son tiempos de esta VM, no un SLA de producción.
La matriz de IPC mantiene 14/14 casos, y la de Mac artificial 9/9. Se verifican
typecheck, Vitest (276, cinco omitidas), PHPUnit (162/1077), Rust/rustfmt/clippy
y builds release por omisión/con características en Mac y Linux. Se congelan
informes/logs fuera del repo en `AbsorConnectLab/protected-native-evidence-20261027`.
No se ha realizado escaneo de memoria: la separación de secretos se verifica
por flujo de datos, identidades/ACL y pruebas de acceso denegado. El resumen
público registra también esa limitación y los hashes de los artefactos probados.


## 27/10/2026 — protocolo negociado, baja del controlador y guía de viajes

Se aceptan 3.3, 7.5, 10.1 y 11.6: **15/57 (26 %)**. El objetivo solicitado de
50 % sigue pendiente. `negotiated-control-results.json` contiene resultados,
hashes de fuentes/artefactos y límites. La evidencia privada está en el
laboratorio `negotiated-control-evidence-20261027`, con informes/logs modo 0600.

- El crate Rust `absor-agent-control` exige negociación después de autenticar,
  2048 bytes, UUID/enums/campos cerrados, capacidades consistentes y secuencia de
  contexto. Conserva 64 IDs sin desalojarlos. Dos entregas del mismo reinicio
  ejecutan una sola operación en el adaptador artificial; cambiar su acción,
  saturar la caché, cerrar/revocar/caducar o no anunciarla impide otra ejecución.
- Diez casos P2P en la VM pasan con la extensión unida al IPC protegido. El
  anuncio `features` solo sale después de autenticar y con plazo vigente. El
  laboratorio anuncia todas las capacidades falsas y ninguna acción: no responde
  antes de negociar, ignora la orden malformada y devuelve dos rechazos idénticos
  para dos entregas de reinicio. Hay reconexión con nonce nuevo/mismo broker,
  rechazo de clave/huellas, revocación, caducidad y fallos de procesos. Se retiran
  servicios, secretos y cuentas temporales al terminar. No hay reinicio del SO.
- `RemoteDevice.agent` distingue legado/agente/metadatos desconocidos. La prueba
  API móvil da de alta un host nativo con `ace_`, reconoce sus capacidades, revoca
  el ID exacto y verifica 401 del token `acg_`, preservando otro host legado y las
  conexiones S3/SSH. Flutter: **164 pruebas**, sin saltar las de API/SSH/S3, y
  `flutter analyze` sin incidencias. No prueba aún Flutter ↔ P2P nativo/TURN.
- Equipos permite revocar tras diálogo de main con nombre obtenido de la API,
  ID validado, remitente/ventana principal y cuenta revalidada después del diálogo.
  Cancelación, destino ajeno y cambio de cuenta no envían DELETE. Token solo en
  main; un fallo no se muestra como éxito. Solo se cierran los visores de ese ID.
  No se acepta todavía toda 9.4: contexto protegido y otras funciones pendientes.
- Preparación visual fail-closed: incluso una declaración completa de capacidades
  se muestra como no certificada. Legado explica sesión/app y offline indica
  acceso alternativo. React SSR verifica español/inglés, datos incompletos y todas
  las capacidades; capturas reales de su propio panel Electron a 1000/430 px,
  con datos ficticios, revisadas visualmente. No acepta toda 9.2 sin salud/prueba
  de reconexión verificadas por equipo. Captura ilustrativa en la guía de viajes.
- `AGENTS.md`, README, guía de viajes, README móvil y contexto OpenSpec explican
  propiedad exclusiva, IPC de laboratorio, modos de cuenta/sistema/interfaz,
  matriz vacía de agentes certificados, FileVault/BitLocker/cifrado previo al
  arranque, recuperación y límites publicados. Los diagnósticos usan lista
  permitida, no texto libre/secretos. Self-test y resumen del informe real pasan.
- Comprobaciones: typecheck y build escritorio; Vitest **293 correctas/5 omitidas**;
  ESLint de TS tocado sin errores; PHPUnit **162/1077**; Rust Mac **66 default +
  86 all-features**, Linux **167 combinadas**, fmt/clippy y ambos release builds.
  Se conserva PHP 8.5.12, --pull y upload_progress=0. No se toca la configuración
  iOS preexistente ni el backup de entorno. No se publica una release del agente.


### Integración y protección de propiedad posterior — 27/10

PR #50 integrada en `main` tras ocho jobs correctos: núcleo Rust Windows/Mac/Linux,
paquetes de escritorio para los tres sistemas y APK Android/Runner iOS sin firma.
Logs completos revisados; el proveedor de Code Review devolvió 502 para los logs
de empaquetado/móvil, recuperados mediante el conector GitHub, sin usar CLI de CI.
Hay avisos preexistentes de runners/acciones Node y dependencias móviles, sin fallo.
Regresiones posteriores Mac 9/Linux 6 y retirada de archivos/cuenta de VM correctas.
La evidencia histórica `negotiated-control-results.json` identifica ahora su SHA
c33ef8d y CI; sus hashes de fuentes siguen perteneciendo a esa revisión.

El siguiente bloque mejora parcialmente 7.1/7.4/9.1; **no cierra tareas nuevas**:

- Un 409 `device_agent_owned` en registro, consulta, respuesta o rechazo corta la
  sesión de usuario, incluida la aún no asociada. No cambia el ID ni encola otro
  intento; deja de consultar hasta recrear el runtime. El callback de Electron
  persiste `enabled=false`. Una escritura tardía de Ajustes no lo reactiva.
- La API real verifica traspaso con sesión de usuario activa, corte, recreación
  del runtime con el mismo perfil, un solo ID y credencial `acg_` aún válida tras
  cerrar el host de usuario; la baja explícita posterior la invalida. No prueba
  aún un proceso Electron unido al servicio por su cliente local final.
- Ajustes muestra propiedad confirmada por API y bloquea mutaciones del host de
  usuario. No la presenta como salud o certificación del servicio. Un error de
  persistencia se indica y mantiene el corte en memoria. La bandeja conserva el
  estado «agente; sin verificar» incluso al cerrar el runtime de usuario.
- Se pospone instalar/reiniciar y `autoInstallOnAppQuit` al conocer propiedad de
  agente sin estado de salud. El modo legado conserva su comportamiento; tres
  pruebas del actualizador cubren ambos modos y el cambio posterior al arranque.
  No hay todavía parada local del servicio ni actualización transaccional final.
- Vitest: 300 correctas/6 omitidas sin API; ejecución independiente con API real:
  seis correctas, incluidos los cinco flujos anteriores. Typecheck, build,
  ESLint tocado y PHPUnit 162/1077 correctos. Aviso propio de Ajustes revisado con
  datos ficticios en Electron a 1000/430 px. No cambia permisos/servicios del Mac ni repite pruebas físicas de contextos protegidos.
- El lector de diagnóstico rechaza directorios, symlinks y FIFO sin bloquear ni
  imprimir contenido; conserva el resumen por lista permitida.

El porcentaje permanece **15/57 (26 %)**. Falta el cliente local protegido final,
traspaso transaccional completo y matriz de servicios; no se alcanza aún el 50 %.


## 27/10/2026 — viabilidad nativa con los tres controladores

Se acepta **1.5** para continuar con libwebrtc fijado, no como agente distribuido.
Evidencia pública: `native-mobile-input-results.json`; informes y logs originales
privados identificados por SHA-256. Se conservan los fallos previos y sus límites.

| Controlador | Directo | TURN UDP | TURN TLS |
|---|---:|---:|---:|
| Electron | 10/10 | 10/10 | 10/10 |
| iPad simulado, plugin Flutter real | 4/4 | 4/4 | 4/4 |
| Android AVD, plugin Flutter real | 4/4 con NAT local de VM | 4/4 | 4/4 |

Los 54 casos unen API real efímera, broker con cuenta separada y secretos
cifrados, IPC protegido, huellas aplicadas DTLS/HMAC y ventana X11 propia
320×180. Prueba correcta/reconexión muestran vídeo y un clic/KeyA completos;
prueba o huellas incorrectas generan cero captura y entrada. Se envía entrada
antes de autenticar para comprobar su descarte. El mismo broker atiende dos
conexiones con nonce distinto. La extensión negocia cero acciones del SO.
Electron añade revocación/caducidad, bloqueo y fallos de procesos en cada ruta.

Se corrige una incompatibilidad del subconjunto de entrada del trabajador:
exige ahora `v:1`, que los codificadores reales TS/Dart ya enviaban, y rechaza
ausencia, versión distinta y duplicación. No amplía las teclas, ventanas o
autoridad del prototipo. Los clientes móviles de laboratorio usan cinco fuentes
de protocolo de producción y el plugin real en una copia aislada de Flutter.

El AVD y QEMU tienen redes NAT aisladas con direcciones solapadas. El enlace
directo natural, también con STUN, falló. El modo explícito de laboratorio crea
mapeos UDP temporales de la VM solo sobre loopback, conserva exactamente sus
huellas y los retira por caso y al terminar. Cuatro pruebas de seguridad cubren
destino/puerto permitidos, validación antes de efectos y fallo de retirada.
No se presenta como traversal automático de NAT ni prueba desde otra red.
TURN fuerza relay y valida candidato/protocolo seleccionado; STUN y TURN se
configuran por separado, sin debilitar el validador Rust.

Los logs informativos del plugin pueden incluir credenciales ICE efímeras.
El visor móvil de producción inicializa WebRTC con `logSeverity:error` antes
de crear texturas/fábrica; una prueba verifica el orden y que no crea peer si
falla la API. No cambia codecs, permisos o el flujo de audio. Los logs previos
quedan privados; los informes públicos solo contienen contadores/hashes.

Verificación local: typecheck; Vitest 300 correctas/6 omitidas sin API; PHPUnit
162/1077; Flutter analyze y 165 pruebas con SSH/S3 y API/base aisladas; Rust Mac
66+86 y Linux 167, fmt/clippy y dos builds release por SO; Python 4, diagnóstico
y validación estricta OpenSpec. La primera suite Flutter contra desarrollo
encontró el límite 429: se repite en base/API efímeras sin vaciar límites ni
cambiar cuotas de desarrollo. El STUN ficticio `.invalid` del modo unitario solo
comprueba el contrato de la API y no se contacta.

Se retiran las unidades, cuenta de servicio, secretos, staging, marcador y NAT
temporal. Se dejan apagados solo el iPad simulado y AVD que se arrancaron para
estas pruebas. La VM Linux sigue disponible. No se toca el Mac base ni equipos
físicos, ni el backup de entorno o los cambios iOS anteriores del propietario.

El avance aceptado es **16/57 (28 %)**. Falta captura/entrada generales y
transiciones, agentes/instaladores finales, integración de controladores y
piloto físico. La matriz de servicio completo certificado continúa vacía.


## 28/10/2026 — contexto protegido del visor de escritorio

PR #52 integrada con cinco jobs correctos: Rust Windows/Mac/Linux (150/152/167
pruebas, cuatro pruebas Python y dos releases por SO), APK release con firma
verificada y Runner iOS sin firma. Logs completos/annotations revisados mediante
Code Review y conector GitHub. Solo avisos preexistentes de runners, Node de
acciones y Java 8; sin fallo. Evidencia histórica con SHA 0428e49 y hashes de CI.

Se acepta **9.4**: el visor real negocia después de autenticar, espera capacidades
y contexto, ignora secuencias antiguas y aplica retirada posterior de capacidad.
Oculta la imagen anterior sin imagen actual/transición y espera un frame nuevo
antes de mostrarla. La entrada protegida exige capacidad correspondiente.
Libera entrada y desactiva audio/portapapeles/ficheros; borra nombres/rutas de la
UI, invalida colas/esperas y no reanuda una descarga por un diálogo tardío.
Las esperas de backpressure despiertan incluso sin evento de buffer.
Tras cualquier cambio observado, el contenido sensible exige reconectar para
no atribuir trozos antiguos a otro usuario/contexto. Los hosts legados conservan
su flujo e historial de transferencias; no reciben negociación nueva.

La prueba `viewer-context-check` empaqueta HTML/CSS/main.ts de producción, con
puente API artificial y dos peers WebRTC locales, desafío v1/huellas aplicadas
y vídeo de canvas público. Verifica escritorio → transición → entrada → vuelta,
secuencia antigua, controles/sonido/portapapeles suspendidos y no renegociación.
Tres capturas ficticias revisadas visualmente; no se captura este Mac ni una
pantalla protegida. La baja exacta/cancelada/cuenta cambiada conserva la evidencia
de PR #50/#51 y las pruebas de regresión, sin nuevas mutaciones del backend.

Typecheck/build, Vitest **311 correctas/6 omitidas sin API**, ESLint tocado y
PHPUnit **162/1077** correctos. Once pruebas nuevas: política/retirada de
capacidades, integración de sesión y carreras de transferencia/portapapeles.
No se cambia el protocolo v1 ni móviles, ni configuración iOS anterior.
La responsabilidad del host de aislar fuente, entrada y colas sigue en 3.5;
los contextos físicos/servicios finales y controles Flutter siguen pendientes.
Avance aceptado **17/57 (30 %)**, todavía por debajo del 50 % solicitado.


## 28/10/2026 — visor Flutter real y efecto visible de entrada

Evidencia pública: `mobile-context-results.json`, con doce casos y hashes de
fuentes/informes privados. Se mantienen **17/57 tareas (30 %)**: 10.2 avanza
parcialmente; no se acepta UAC/macOS/LightDM desde móvil ni se cambia el denominador.

Android AVD e iPad simulado ejecutan `ViewerScreen`, `ViewerSession` y
`RemoteTransfers` de producción en una copia aislada. Cada uno pasa dos
conexiones en directo, TURN UDP y TURN TLS: reto nuevo, mismo broker, segundo
controlador ocupado rechazado, contexto autenticado, 320×180 y cuatro eventos
nativos completos. El color verde que produce la ventana propia tras el clic y
KeyA debe aparecer en el PNG del móvil. No basta el contador de frames. Los seis
recorridos prueban exactamente el mismo conjunto de fuentes Dart; el lanzador
verifica además fuentes contra el manifiesto del binario nativo.

La prueba completa descubrió audio anunciado sin fuente en el extremo C++ del
laboratorio. Android decodificaba más de doscientos frames pero no presentaba
imagen; responder audio inactivo resolvió el problema en ambas plataformas.
La prueba exige ahora esa dirección en SDP. No se atribuye esta causa al tirón
histórico iPad → Windows, que no se ha reproducido con medición.
Los intentos fallidos, incluido uno con bloqueo por inactividad de la VM Linux,
se conservan privados; no cuentan como aceptación. La vista mínima y la
inicialización adelantada fueron experimentos descartados. La matriz final usa
la pantalla completa y la inicialización del motor de producción.

La política móvil negocia después de autenticar, aplica retirada de capacidades,
ignora contexto antiguo y oculta imagen durante transición/no disponible.
Solo permite entrada protegida con capacidad e imagen nueva; libera teclas y
restablece gestos/IME al cambiar. Descarta portapapeles, colas/nombres y callbacks
pendientes; cierra solo la hoja de ficheros afectada. Audio/ficheros/portapapeles
no se reactivan hasta una conexión nueva tras cambiar de contexto porque v1 no
etiqueta cada trozo. No se amplía el protocolo ni se guardan credenciales del SO.
Al cerrar, serializa teardown antes de destruir la textura, libera sus streams
y dispone la PeerConnection nativa, incluso si close falla.

Verificación: `flutter analyze` sin incidencias; **178 pruebas Flutter**, incluidas
API aislada real y SSH/S3; typecheck correcto; **317 Vitest con API**; PHPUnit
**162/1077**; Rust Mac **66 + 86** y fmt/clippy; **7 pruebas Python** del lanzador;
OpenSpec estricto válido. La suite aislada retira su API/BD sin resetear límites
de desarrollo. El escaneo completo ESLint de `src` detecta deuda previa de
**106 errores/706 avisos**; `src` es idéntico al árbol de PR #53 (85c4bd6), sin
cambios TypeScript en esta entrega. No se declara ese escaneo limpio.

Los informes acreditan retirada de cuentas, servicios y secretos de cada ensayo;
el mapeo UDP directo del AVD es temporal y no prueba NAT exterior automático.
El AVD y el iPad de laboratorio se apagan al terminar. La captura ilustrativa
`docs/images/unattended-mobile-context.png` contiene exclusivamente la ventana
propia, sin pantallas ni credenciales del propietario. Las pruebas físicas
permanecen para el final; no se instala ni publica un agente final con este cambio.


## 28/10/2026 — operaciones del controlador de escritorio

PR #54 integrada (head fd7b46e, merge c39fcf0) tras revisar los logs completos y
annotations de sus cinco jobs: Rust Windows/Mac/Linux 150/152/167 pruebas, siete
Python y dos builds release por SO; APK firmado 98,5 MB y Runner iOS sin firma
34,5 MB. Avisos previos de runners, Node de acciones y Java/KGP. Se repitió la
regresión Electron IPC nativo: diez casos correctos; verificación separada de
retirada de secretos/cuenta/servicios/mapeos en la VM. AVD e iPad apagados.
Los hashes de CI/evidencia se añaden a `mobile-context-results.json` como historia.

Se acepta **9.3**. El visor espera autenticación, contexto y acciones anunciadas;
pide confirmación asíncrona e invalida la elección si cambia contexto/capacidad.
Usa UUID v4, una operación pendiente y límite de 64 por conexión. Correlaciona
acción e ID, rechaza resultados ajenos/repetidos y nunca reintenta una orden.
Un resultado perdido a 15 s bloquea otra operación hasta una conexión nueva.
Rechazo/fallo/cancelación se muestran sin anunciar éxito ni esperar un reinicio.

Reinicio/logout aceptados descartan K y cortan entrada/contenido. El reinicio
consulta solo presencia del mismo PC, sin ofertas hasta volver; acepta una
señal nueva por indisponibilidad observada o heartbeat posterior al registrado
antes de confirmar. La UI distingue disponibilidad de reinicio del SO terminado.
La espera vence a cinco minutos con temporizador independiente, permite cancelar
y exige contraseña/prueba nueva. Incluso tras cancelar o vencer se verifica
presencia antes de una oferta manual. El diálogo no reenvía teclas al host.
Se corrigió también un timeout de cierre que podía destruir un peer posterior.

Main fija equipo/nombre desde la API; cada visor queda vinculado a su cuenta y
frame principal. Su solicitud solo se consulta desde ese visor; no se solapan
creaciones ni se entregan resultados tardíos tras cambiar cuenta o ventana.
La presencia expone únicamente online/available/lastSeenAt. Un diálogo tardío de
guardado no crea archivo tras perder cuenta; una descarga pendiente no publica
su resultado a otra cuenta. El vigilante del portapapeles también comprueba
la cuenta al emitir, deteniéndose sin entregar datos posteriores a otra cuenta.
El puente no entrega secretos del host ni tokens de cuenta. La K del
controlador se deriva de la contraseña y solo vive en la memoria del visor;
se borra al aceptar reinicio/logout. No hay shell RPC.

`viewer-actions-check` ejecuta HTML/CSS/main.ts reales y dos peers Chromium con
canvas público. Pasa cancelación, retirada de acción, rechazo, resultado perdido,
dos ciclos de reinicio simulados, tres retos distintos y cero ofertas fuera de
línea. Comprueba teclas locales, liberación, hit-test de cancelación y capturas
es/en a 500 px. La nueva comprobación del lanzador exige informe `ok` además de
exit code: cerrar Electron no puede ocultar un fallo. Se repitió también
`viewer-context-check`. Evidencia en `viewer-actions-results.json` y capturas
`docs/images/unattended-admin-confirm.png` / `unattended-restart-wait.png`.

Typecheck/build correctos, **340 Vitest con API** (23 nuevos), **26 dirigidos**,
ESLint de archivos TypeScript tocados limpio y PHPUnit **162/1077**. Los tests de
reloj prueban vuelta a diez segundos, cinco minutos con consulta bloqueada,
respuesta tardía, cancelación y Retry-After. Las operaciones del host artificial
solo incrementan contadores; no se reinicia ni administra un SO. No acepta las
tareas de agente 4.3/5.4/6.3, Flutter ni piloto exterior. **18/57 (32 %)**.
