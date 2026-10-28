# Viabilidad nativa de WebRTC

Pruebas de las tareas 1.5 y 1.6 de `add-unattended-admin-access`. La matriz de
interoperabilidad del 27/10 permite continuar con esta revisión fijada; todavía
no es una dependencia distribuida ni certifica los servicios finales.
Las fuentes, herramientas y artefactos grandes quedan fuera del repositorio y
de los instaladores de Electron. La compilación y las pruebas directas no usan
cuentas; el ensayo TURN opcional usa exclusivamente credenciales temporales del
relé. Los comandos básicos no instalan servicios; la variante Linux usa una
unidad transitoria de usuario exclusivamente en su VM.

```bash
python3 prototypes/remote-desktop/webrtc-check/sync.py /ruta/externa/laboratorio
python3 prototypes/remote-desktop/webrtc-check/build.py /ruta/externa/laboratorio
node prototypes/remote-desktop/webrtc-check/run-interop.cjs /ruta/externa/laboratorio
node prototypes/remote-desktop/webrtc-check/run-interop.cjs /ruta/externa/laboratorio --synthetic-video
```

El primer comando fija libwebrtc y depot_tools con `dependencies.json`, mantiene
las revisiones transitivas de `DEPS` y descarga el toolchain mediante los hooks
oficiales. No actualiza automáticamente depot_tools. Una configuración `.gclient`
distinta o cambios en archivos versionados interrumpen la preparación, sin reset.
La compilación usa dos procesos para compartir este Mac con la VM de Windows.

`auth_check` usa el BoringSSL fijado por WebRTC y genera su entrada directamente
desde `src/shared/remote/auth-vectors.json`: comprueba PBKDF2/HMAC y rechazo de
nonce, huellas o clave distintos, y de clave vacía. Solo imprime recuentos.
`factory_check` crea y destruye una factoría de conexiones de datos; no captura,
no abre un servidor ni contacta con un equipo remoto. `offer_check` crea además
una conexión, canal de datos y oferta con huella SHA-256. No aplica la descripción,
no intercambia candidatos ni publica el SDP. Todavía no establece DTLS ni verifica
comunicación con otro cliente. Los binarios exitosos
emiten su SHA-256 para identificar el artefacto probado.

**Pendiente:** captura/entrada generales posteriores a la autenticación y
dispositivos iOS físicos. El simulador iPad ya tiene una prueba de interoperabilidad
con vídeo artificial, descrita al final. El recorrido TURN del controlador se
verifica por separado; no equivale a certificar cualquier combinación de NAT.
Estas pruebas históricas por separado no completan 1.5; la matriz posterior
añade entrada nativa y los tres controladores en directo/TURN.

## Controlador Flutter en el simulador de iPad

`mobile-interop-test.dart` usa el plugin real `flutter_webrtc` y las funciones
`deriveKey`, `computeProof` y `sdpFingerprint` de `mobile/`. No usa una cuenta ni
credenciales del propietario: la contraseña y K son las del vector público.
`serve-mobile.py` acepta solo tres nombres de caso y ejecuta exclusivamente el
binario artificial identificado por SHA-256 en `webrtc-probe-results.json`.
Escucha en `127.0.0.1:8793`, guarda SDP/informes en un directorio privado y se
cierra como máximo a los 30 minutos. No publica un servicio en la red local.

Usar una copia de `mobile/` en el laboratorio externo para que la generación de
archivos de Xcode/Flutter no altere cambios del propietario. Excluir `build/`,
`.dart_tool/`, `Pods/`, `ephemeral/`, `.swiftpm/` y `xcuserdata/` al copiar. Después
copiar `mobile-interop-test.dart` a `integration_test/native_interop_test.dart`
de esa copia y ejecutar `flutter pub get` allí. Con el runtime oficial y un iPad
de pruebas arrancado, iniciar el servidor desde la raíz del repositorio:

```bash
python3 prototypes/remote-desktop/webrtc-check/serve-mobile.py /ruta/externa/laboratorio
```

En otra terminal, desde la copia de `mobile/`:

```bash
flutter analyze integration_test/native_interop_test.dart --no-pub
flutter drive --no-pub --driver=test_driver/integration_test.dart \
  --target=integration_test/native_interop_test.dart -d <udid-del-simulador>
```

El servidor debe arrancarse de nuevo antes de repetir una ejecución: cada caso
se acepta una sola vez. Ctrl+C o SIGTERM cierran sus procesos y archivos propios.
Para obligar al controlador a usar relé, iniciar el servidor con
`--turn-config /ruta/privada/turn-temporal.json`. El JSON tiene la misma estructura
`iceServers` descrita para Electron, pero cada servidor debe contener exactamente
`urls`, `username` y `credential`. Incluir un TURN y, cuando haga falta, un STUN
para el candidato reflejado del host. El archivo debe ser ordinario, del usuario,
privado y de hasta 16 KiB. El servidor retira su copia al salir; quien lo invoca
retira el original. Nunca usar el secreto HMAC ni el token de la cuenta.

Cada ejecución verifica:

- DTLS y una única solicitud `hello`, PBKDF2/CommonCrypto compatible con el vector
  completo y prueba HMAC vinculada a las huellas de esa conexión.
- Contraseña correcta: al menos dos fotogramas decodificados de 320×180; no se
  recibe vídeo antes de responder al desafío.
- Prueba incorrecta y huella alterada: autenticación rechazada y cero fotogramas
  generados/decodificados.
- Par real `host/host` en directo o candidato local `relay` cuando se exige TURN.
  El informe conserva también `relayProtocol`, sin direcciones IP ni credenciales.

Resultado del 23/10/2026: **9/9 casos**, iPad Pro 11 pulgadas M4 simulado,
iOS 27.0 (24A434), arm64: tres directos, tres con el controlador por TURN UDP y
tres por TURN TLS. Por relé se eligió `relay/srflx`, con el protocolo esperado.
El binario nativo conserva SHA-256
`f016a99680d201a5b13298b6efdb38cefc705fe5b49c70e2f7525c7fe61e9fbe`.

Es una prueba del transporte y la autenticación con vídeo artificial. No ejecuta
el flujo completo de `ViewerSession`/Equipos, no prueba la captura de Windows,
la entrada, el rendimiento del iPad físico ni una sesión real desde otra red.
La tarea 1.5 permanece abierta.

El mismo ensayo pasó **9/9 casos en Android 16/API 36 arm64**, emulador Google
APIs, con el mismo binario nativo y plugin real: directo `prflx/host`, TURN UDP
y TLS `relay/srflx`. Para reproducir, arrancar el emulador existente, ejecutar
`adb -s <id> reverse tcp:8793 tcp:8793` y usar su ID en `flutter drive`. Mantener
el servidor en loopback; retirar ese reenvío y apagar el emulador al terminar.
Los candidatos `host`/`prflx` son directos; no aceptar relé ni valores ausentes
en ese caso. El primer ensayo falló por exigir únicamente `host/host`; la
repetición final mantiene todas las aserciones de autenticación y vídeo.
Resultados sin secretos en `openspec/changes/add-unattended-admin-access/android-native-results.json`.
No certifica Android físico ni entrada/captura del sistema.

## Fuentes y distribución

- [Desarrollo oficial y GN/Ninja](https://webrtc.googlesource.com/src/+/main/docs/native-code/development/).
- [Requisitos de plataforma](https://webrtc.googlesource.com/src/+/main/docs/native-code/development/prerequisite-sw/).
- [Licencia del proyecto](https://webrtc.googlesource.com/src/+/5d27ce25e244b90d09de3429dd3e702fd70f400b/LICENSE)
  y [PATENTS](https://webrtc.googlesource.com/src/+/5d27ce25e244b90d09de3429dd3e702fd70f400b/PATENTS).

La licencia principal permite redistribuir conservando sus avisos; no sustituye
la revisión de cada dependencia ni los avisos del paquete final. Antes de
distribuir se deben generar y revisar los avisos de los componentes realmente
enlazados. No se ha resuelto todavía la firma/notarización del helper Mac.
Registrar tiempo, espacio, versión efectiva del compilador y resultado al acabar;
no presentar estimaciones de la documentación como medidas de este laboratorio.

## Canal nativo con Electron

`run-interop.cjs` comprueba la huella del binario contra el informe de `build.py`
y usa el Electron/esbuild ya instalados en la raíz del proyecto. Crea un perfil
aislado y una ventana oculta de laboratorio, sin conectarse al backend ni leer
cuentas. El extremo C++ intercambia SDP y mensajes v1 con ese controlador.

Se prueban una autenticación válida, una prueba HMAC incorrecta y otra calculada
con una huella de oferta alterada. El controlador usa `computeProof` y
`sdpFingerprint` del código compartido de producción, y PBKDF2 a partir de la
contraseña pública de `auth-vectors.json`. Se comprueba DTLS, acuerdo entre ambos
extremos y selección de candidatos `host`/`host`.

El ejecutable usa exclusivamente datos públicos de prueba, dura una conexión y
no contiene captura, entrada, portapapeles ni transferencia de archivos. No es
un servicio ni debe utilizarse como host de acceso remoto. Las credenciales de
prueba no protegen acceso a un equipo: no se implementa ninguna acción sobre él.

Los informes solo incluyen resultados, versiones y huellas de binarios. El SDP,
que contiene datos de red local, queda dentro del laboratorio privado; no debe
añadirse al repositorio. Este paso aún no prueba TURN, vídeo, entrada ni móvil.

## Vídeo artificial autenticado

La opción `--synthetic-video` utiliza el ejecutable separado
`video_channel_check`, que se compila desde el mismo desafío v1 y añade únicamente
VP8 y una fuente artificial roja de 320 × 180. El dispositivo de audio es vacío;
no se accede a micrófono, altavoz ni pantalla. El target de datos conserva su
factoría sin medios y no enlaza este adaptador.

Como el host de producción, negocia transceptores sin pista y asigna la pista
solo después de aceptar la prueba de contraseña. El controlador usa la API
WebRTC de Electron y comprueba dimensiones, al menos dos fotogramas decodificados
y el color del patrón, sin guardarlo. Antes de enviar la prueba comprueba que
no se han decodificado fotogramas. En los casos de prueba errónea y huella
alterada verifica cero fotogramas generados y recibidos durante la conexión.

El informe distingue `syntheticVideoTested` de `videoTested`: pasar el patrón
artificial acredita ese transporte/códec y su condición de autenticación;
todavía no acredita captura real conectada a WebRTC, entrada, TURN ni Flutter.


## Recorrido TURN autenticado

```bash
node prototypes/remote-desktop/webrtc-check/run-interop.cjs /ruta/externa/laboratorio \
  --synthetic-video --turn-config /ruta/privada/turn-temporal.json --relay-controller
```

El archivo debe pertenecer al usuario, ser ordinario, sin permisos para grupo u
otros y de hasta 16 KiB. Es `{iceServers: [{urls: ["turn:…", "stun:…"], username,
credential}]}` con credencial **temporal**, nunca el secreto HMAC del servidor ni
un token de cuenta. Las URLs pueden ser TURN UDP/TCP/TLS y STUN; debe existir TURN.
Se pasan mediante archivos privados, no argumentos con credenciales. Las copias
locales se retiran cuando sale Electron. El archivo original sigue perteneciendo
al llamador, que debe retirarlo cuando termine. El SDP y stderr son privados.

`--relay-controller` obliga al controlador a seleccionar `relay` y deja al host
usar los candidatos del servidor. Es el recorrido de la prueba existente de la
app: un par `relay/srflx` pasa por TURN y no puede elegir conexión directa entre
ambos extremos. El informe incluye el par seleccionado y `relayProtocol`
(`udp` o `tls` en los ensayos realizados), además de la política efectiva del host.
Sin esta opción, ambos extremos se fuerzan a relé. Esta variante produjo 403
CreatePermission en el relé actual al usar su propia IP como peer, coherente con
su lista `denied-peer-ip`. No se cambiaron cuotas, ACL ni protecciones del servidor
para permitirla; **relay/relay permanece sin validar**.

El diagnóstico acepta un candidato utilizable sin exigir que termine toda la
búsqueda ICE y después comprueba el transporte seleccionado real. La primera
versión esperaba la finalización y venció pese a tener candidatos `relay`; el
fallo se conservó y no se contó como éxito. La matriz posterior pasó directo,
TURN UDP por nombre DNS y TURN TLS por nombre DNS, en cada caso con contraseña
correcta, prueba incorrecta y huella alterada. Los negativos generaron y
recibieron cero fotogramas. Solo se transmite el patrón artificial: sigue sin
captura real, entrada de sistema ni controladores Flutter certificados.

## Avisos de dependencias del target compilado

```bash
python3 prototypes/remote-desktop/webrtc-check/licenses.py \
  /ruta/externa/laboratorio /ruta/nueva/avisos
```

El wrapper comprueba la revisión fijada y utiliza el generador oficial de WebRTC
para los targets `channel_check` y `video_channel_check`. Su única adaptación del
comando GN es conservar `--root-target=//absor_connect_probe:all`, necesario para
el laboratorio reducido. No modifica fuentes de terceros ni acepta bibliotecas
sin licencia identificada. Genera `LICENSE.md` y un informe de hashes; los avisos
no completan por sí solos la revisión de distribución/patentes del agente final.


El caso `relay/relay` también pasó después en un coturn **local aislado** 4.18.0,
publicado solo en loopback y con secreto temporal propio. Se verificó STUN antes
de conectar; los tres casos de autenticación seleccionaron `relay/relay`, con
vídeo artificial solo en el positivo. El contenedor y las credenciales se retiraron.
Esto separa la viabilidad del adaptador de la política del relé de producción:
no demuestra que el recorrido doble esté permitido en ese servidor.

## Rust, autorización de API y DTLS en una misma conexión

```bash
python3 prototypes/remote-desktop/webrtc-check/build.py /ruta/laboratorio --rust-bridge
python3 prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node
```

La opción adicional compila `rust_video_channel_check`, enlazado a la dylib
`absor-agent-webrtc-lab` con el compilador Rust fijado del checkout. Se mantiene
el runtime separado del Rust interno de libwebrtc; no mezclar dos bibliotecas
estándar estáticas ni eliminar errores del enlazador para conseguir el binario.
El build usa objetivo macOS 13, pero eso no certifica soporte de esa versión:
esta integración se ha ejecutado en Mac ARM del laboratorio. Sin la opción,
los targets y el procedimiento anteriores no necesitan Cargo.

El target nuevo requiere la credencial efímera y el diario de intentos de su
directorio privado marcado. Solo HTTP loopback, K/salt públicos fijos y vídeo
artificial; nunca usarlo como host. Las huellas que recibe Rust proceden de las
descripciones aplicadas de la PeerConnection que valida el certificado DTLS.
Se requiere autorización API antes de crearla y HMAC correcto antes de añadir
la pista. Las pruebas negativas generan/reciben cero fotogramas; revocación o
caducidad detienen fuente/canal/conexión. No se inyecta entrada ni captura pantalla.

`--agent-config` permite al runner consumir el manifiesto privado creado por el
lanzador. El proceso principal conserva las credenciales y el visor solo recibe
recursos públicos por un protocolo limitado; comprueba rechazo de rutas privadas
y lectura de archivos. Las cuentas y copias de credenciales se retiran al acabar.
No incorporar manifiestos, SDP, stderr, logs de la API o diarios privados al repo.

Los resultados nuevos no heredan automáticamente las pruebas TURN/móviles de
la variante C++ anterior. El supervisor optativo siguiente añade vigilancia entre procesos; siguen pendientes aislamiento
de privilegios, almacenes del SO, captura real o un servicio instalable. El CI
verifica Rust/ABI en los tres SO; el recorrido P2P de este target es evidencia
local Mac/Electron, pendiente del resto de la matriz antes de publicar soporte.


## Fallos de procesos con supervisor

`run-interop.cjs --agent-config <manifiesto> --supervised` usa el supervisor
compilado junto al extremo nativo. El lanzador de API aislada ya selecciona
esta variante: conserva los cinco casos originales y añade cuatro casos
secuenciales con credencial de laboratorio válida, diarios separados y vídeo
artificial: actor bloqueado, trabajador terminado, supervisor bloqueado cinco
segundos y supervisor terminado. Solo crea cinco cuentas efímeras propias;
los casos de procesos reutilizan la cuenta positiva, sin alterar sus permisos.

Cada fallo se solicita desde main por un comando fijo a su proceso hijo;
no acepta ejecutables, PIDs ni comandos del renderer. El watchdog tiene un
plazo de dos segundos y sondeo de veinte milisegundos. El informe registra
la recogida del hijo, el cierre de los pipes y la ausencia de nuevos frames;
no interpreta una desconexión UDP como un cierre DTLS inmediato del visor.
El observador del pipe mide también la salida del trabajador mientras el
actor del supervisor está bloqueado. `processCutMilliseconds` incluye los
cinco segundos de ese bloqueo provocado; el tiempo del pipe refleja la
terminación efectiva y se exige inferior a 3,5 segundos en este ensayo.

Las pruebas Cargo de procesos usan exactamente el mismo supervisor y guardia
del hijo, con un ejecutable artificial sin WebRTC. La matriz CI de tres SO
verifica este ciclo de vida; el ensayo WebRTC sigue siendo Mac/Electron.
Nada se instala como servicio y no cambia los permisos TCC, UAC o LightDM.


## Ofertas, respuestas e ICE por API

El manifiesto privado del lanzador aislado selecciona `apiSignaling`. El
controlador crea la solicitud con su sesión de cuenta a través de main; el
nativo recoge la oferta con su credencial limitada y publica la respuesta
para el ID retenido por Rust. Main consulta el resultado por API. No se
escriben `.sdp`, y el renderer continúa sin recibir tokens o archivos privados.

El carril de señalización es independiente de la renovación, acotado a un
trabajo. Sus resultados no amplían la autorización. ICE conserva el TTL desde
el inicio de la consulta; una configuración caducada no inicia un peer nuevo.
No se emite el reto hasta confirmar la respuesta de la solicitud; las huellas
siguen procediendo de las descripciones aplicadas en libwebrtc. La prueba
positiva crea además otra solicitud y exige rechazo `busy` mientras sigue
recibiendo vídeo. Esta variante usa ICE vacío de la API aislada; no acredita
TURN o móviles. El modo anterior conserva su intercambio por archivos.


## Trabajador nativo Linux por WebRTC, en VM

La variante `native-fixture` une el gate/API/verificador Rust con el trabajador
X11 y la pista VP8. Captura exclusivamente su ventana pública 320×180. El canal
`input` v1 admite solo la secuencia fija botón izquierdo/KeyA, con liberaciones,
una vez por conexión; no implementa entrada general ni modifica Flutter.

```bash
python3 prototypes/remote-desktop/webrtc-check/sync.py /ruta/laboratorio --linux-target
python3 prototypes/remote-desktop/webrtc-check/build-linux.py /ruta/laboratorio /ruta/VM-privada
python3 prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node --linux-webrtc-vm /ruta/VM-privada
```

`build-linux.py` se ejecuta en Mac y solo reconoce la VM privada existente en
loopback:22223, usuario `absorlab`. Rust y lld se ejecutan en ella; Clang del
checkout genera el extremo ELF ARM64 con el mismo sysroot oficial Bullseye.
Las revisiones y los hashes quedan en `linux-webrtc-build.json`. El linker
conserva la comprobación de símbolos; no se permite una biblioteca sin resolver.
El directorio `out/AbsorLinuxProbe`, `.so` y supervisor Linux quedan separados
de los artefactos Mac. El build no ejecuta captura/entrada ni instala servicios.

El runner comprueba en Electron rojo → entrada por DataChannel → verde,
entrada anterior al reto ignorada, secuencias arbitrarias/repetidas rechazadas,
cero captura/entrada con prueba/huella incorrectas, revocación/caducidad y
rechazo con Cinnamon bloqueado. Solo la señalización/API viaja por el túnel SSH;
los píxeles y la entrada usan WebRTC/DTLS directo con la VM. Se conserva el
rechazo de segunda solicitud y la prohibición de leer credenciales en el visor.
No escribe SDP o imágenes; los informes solo contienen contadores y metadatos.

`linux-service-worker.py` ejecuta el supervisor/trabajador bajo una unidad
transitoria systemd de usuario, con runtime privado en tmpfs, credencial de
agente efímera, `NoNewPrivileges`, límites y parada de todo el cgroup. Mantiene
abierto el pipe del lanzador: cerrarlo es un corte seguro. Netlink se permite
para `getifaddrs`, conservando cero capacidades administrativas. El caso de
bloqueo restaura la sesión solo de la VM. No instala unidades permanentes ni
prueba arranque/greeter, servicio privilegiado, entrada sostenida o liberación
tras caída. TURN, móviles y Mint físico siguen fuera de esta matriz.

## Plugin móvil real contra el trabajador IPC de la VM

`mobile-protected-interop-test.dart` ejecuta los codificadores de autenticación e
input de producción y el plugin `flutter_webrtc` real contra la ventana X11 propia
(320×180) del laboratorio Linux. Exige `v:1` también en input; el subconjunto del
trabajador solo admite un clic izquierdo y KeyA completos. No acepta texto,
combinaciones arbitrarias, rueda u otras ventanas. No es el host final.

Desde el Mac de laboratorio, con la VM propia ya preparada y una copia aislada
Flutter inicializada en `<lab>/mobile-simulator`:

```bash
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py <lab> \
  --protected-p2p-vm <vm-lab> --mobile-device <uuid-del-simulador-ios>
# Android: únicamente el AVD propio absorconnect en emulator-5554.
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py <lab> \
  --protected-p2p-vm <vm-lab> --mobile-device emulator-5554
```

El lanzador copia solo cinco fuentes del protocolo y la prueba en esa copia,
nunca la configuración iOS del proyecto principal. Crea una API/base efímeras,
alta de un uso y claves por host: en este ensayo K se deriva de la contraseña
pública del laboratorio con una sal aleatoria y 600000 iteraciones. El controlador
no recibe el token de cuenta ni `acg_`. La captura/entrada permanece limitada a
la ventana de la VM. Se retiran unidades, secretos y cuentas al terminar.

Casos: conexión, reconexión con el mismo broker/nonce nuevo, contraseña incorrecta
y huellas alteradas. Se comprueba cero vídeo antes de autenticar; se envía input
antes de autenticar para verificar su descarte, luego mensajes reales `RemoteInput`
y se validan los cuatro eventos del SO en la ventana. La extensión administrativa
negocia capacidades falsas y ninguna acción. El clic/KeyA de este ensayo no
certifica control de pantallas protegidas ni el resto de teclas.

Para TURN, añade `--turn-config <json-temporal>`; el archivo debe ser propio,
regular, sin symlink y modo 0600. Debe usar credenciales efímeras y **separar** STUN
sin credenciales de TURN con credenciales, como la API real:

```json
{"iceServers":[
  {"urls":["turns:relay.example.invalid:443?transport=tcp"],"username":"temporal","credential":"efimera"},
  {"urls":["stun:relay.example.invalid:3478"]}
]}
```

El controlador fuerza `iceTransportPolicy: relay` y comprueba el candidato real;
no cuenta un fallback directo como prueba TURN. La misma configuración sirve
para el controlador Electron del laboratorio IPC protegido. No se elimina la
validación del agente para aceptar configuraciones malformadas. Los informes
públicos conservan tipos de candidato/transporte y hashes, sin direcciones
personales, contraseñas ni tokens. Ejecuta las matrices de VM **en serie**.

Para el enlace directo AVD ↔ QEMU se dispone de `--android-mapped-direct`: las
redes virtuales aisladas reutilizan direcciones privadas y, sin una ruta común,
no garantizan conexión directa ni siquiera con STUN. Este modo publica únicamente
puertos UDP efímeros de la VM sobre loopback mediante QMP y anuncia al AVD su
puerta de enlace del host; no modifica el router, interfaces del Mac, certificados
DTLS ni la autenticación. Valida todo el SDP antes de abrir puertos, conserva sus
huellas y retira los mapeos al finalizar cada caso y al limpiar el ensayo. Los
informes lo identifican como **directo con NAT local de laboratorio**; no prueba
traversal automático de NAT de redes reales. `--stun-config` permite observar
por separado un intento directo con STUN, sin contar un relé como éxito.

Las pruebas unitarias Flutter pueden usar la misma API/base aislada sin tocar
los límites de desarrollo. Conserva el entorno SSH/S3 de `mobile/tool/test_env.sh`
ya preparado y ejecuta desde la raíz:

```bash
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py <lab> --flutter-tests
```

Este modo declara un STUN ficticio de `.invalid` únicamente para comprobar el
contrato de la API; no abre conexiones WebRTC ni contacta ese dominio. La API,
la base y las cuentas temporales desaparecen al terminar; los servidores SSH/S3
de pruebas existentes no se modifican. No ejecutes el preparador del entorno
contra una base que quieras conservar: su script histórico vacía los límites.

## Pantalla y sesión Flutter completas

El modo `--mobile-runtime` de `isolated-webrtc-renewal.py` copia `mobile/lib` a
la app aislada y ejecuta `mobile-runtime-interop-test.dart`. Usa `ViewerScreen`,
`ViewerSession` y `RemoteTransfers` de producción con una API local de laboratorio,
sin tokens de cuenta en el dispositivo. Comprueba dos conexiones con reto nuevo
y el mismo broker, una solicitud ocupada, contexto negociado y cuatro eventos
nativos completos. Un PNG del simulador/AVD propio debe mostrar el verde que la
ventana nativa pinta al recibir el clic y KeyA: contar frames no prueba ese efecto.
`check-green-frame.swift` solo analiza el PNG; no captura ni modifica imágenes.

El extremo nativo no tiene fuente de sonido y responde audio inactivo, aunque
el visor real ofrezca recibirlo. Anunciar envío de audio vacío bloqueaba la
presentación de vídeo Android pese a recibir y decodificar frames. El caso de
runtime verifica ahora esa dirección SDP antes de autenticar. No se añade audio
al agente ni se certifica sincronización audiovisual general.

Las capturas automáticas se limitan al AVD `absorconnect` o al simulador
`AbsorConnect iPad Lab` identificado expresamente en el lanzador. No capturan el
Mac, pantallas protegidas ni equipos físicos. Los logs e imágenes quedan privados;
el resumen público contiene hashes, contadores y tipos de candidato. El directo
Android necesita el mapeo UDP temporal de la VM descrito antes; no demuestra
travesía NAT automática en una red exterior. Los controles administrativos y la
certificación del host completo siguen pendientes.
