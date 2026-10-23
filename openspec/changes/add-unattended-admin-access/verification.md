# Verificación de acceso desatendido

## Estado al 23/10/2026

Aplicación del cambio autorizada e iniciada. **0/57 tareas completas.** Hay avances
parciales en 1.1–1.6 y 11.6; no existe todavía un agente operativo ni se ha publicado
una release o modificado producción.

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

Se preparó la revisión diagnóstica 0.2.0, todavía sin instalar: añade fase del
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
de scripts/enlaces y permisos root sin escritura de grupo/otros. La instalación
0.2.0 y su ejecución real en `LoginWindow` permanecen pendientes.

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
