# Viabilidad nativa de WebRTC

Parte inicial de las tareas 1.5 y 1.6 de `add-unattended-admin-access`. La revisión
es una candidata para pruebas; todavía no se adopta como dependencia del agente.
Las fuentes, herramientas y artefactos grandes quedan fuera del repositorio y
de los instaladores de Electron. La compilación y las pruebas directas no usan
cuentas; el ensayo TURN opcional usa exclusivamente credenciales temporales del
relé. No se instala un servicio.

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

**Pendiente:** captura real/entrada posteriores a la autenticación, Android y
dispositivos iOS físicos. El simulador iPad ya tiene una prueba de interoperabilidad
con vídeo artificial, descrita al final. El recorrido TURN del controlador se
verifica por separado; no equivale a certificar cualquier combinación de NAT.
Ninguna de estas pruebas iniciales completa la tarea 1.5 por sí sola.

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
