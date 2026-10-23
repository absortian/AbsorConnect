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

**Pendiente:** captura real/entrada posteriores a la autenticación y conexión con
Android/iOS. Vídeo artificial y recorrido TURN del controlador están probados
por separado, como se describe abajo.
Ninguna de estas pruebas iniciales completa la tarea 1.5 por sí sola.

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
