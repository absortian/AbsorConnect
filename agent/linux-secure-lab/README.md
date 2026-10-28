# Credenciales e IPC de laboratorio

Dos modos optativos de la VM propia, ausentes del paquete de producción:

- `protected-ipc-lab`: sonda de contador y huellas fijas, sin captura/entrada.
- `protected-ipc-fixture`: conexión API → broker con secretos → IPC → trabajador
  libwebrtc/X11. Captura una ventana propia de 320×180 y admite un clic/KeyA
  completos exclusivamente en ella. Usa las huellas de las descripciones
  realmente aplicadas de esa PeerConnection; no usa K pública compartida.

El trabajador P2P anterior de `linux-lab/` se conserva como regresión separada.
Estos modos no ofrecen escritorio general, administración o soporte de greeter.

## Alta y secretos

El cliente `EnrollmentClient` canjea una sola vez un permiso `ace_`, consume el
tipo de permiso y rechaza tokens `acs_`/`acg_` como entrada de alta. La cuenta
solicita el permiso fuera del servicio. El instalador recibe por stdin el
permiso y los parámetros K/salt/iteraciones; nunca un token de cuenta. El canje
se realiza dentro de la VM, contra la API Symfony/Postgres aislada real.
La credencial emitida y K son únicas para el ensayo; no se usan claves públicas
de los vectores compartidos. No se imprime ni guarda el JSON de entrada.

La construcción normal exige HTTPS y conserva redirecciones deshabilitadas,
proxy del entorno deshabilitado y límites de tiempo/cuerpo/esquema. Los
binarios `*-lab` usan explícitamente HTTP loopback por túnel SSH; eso no es
validación de TLS de producción. El canje devuelve solo una credencial del
host, que se cifra con AES-256-GCM de ring. La clave envolvente tiene 32 bytes
aleatorios nuevos por instalación; cada cifrado usa nonce aleatorio de 12
bytes y vincula esquema/UUID del host como datos autenticados. Se rechazan
manipulación, cambio de UUID y clave incorrecta. No se garantiza borrado
criptográfico de las copias temporales en memoria.

Si falla la escritura posterior al canje, el instalador intenta dar de baja
esa credencial y retira su almacenamiento parcial. La prueba provoca una
colisión de archivo real y comprueba la baja en el backend. Un fallo de red o
muerte del proceso puede impedir esa compensación: el cliente de alta final
necesita reconciliación por propietario antes de reintentar una migración.
No se reusa automáticamente un permiso consumido.

## Identidades y archivos propios

| Ruta | Propietario/permisos | Uso |
|---|---|---|
| `/opt/absorconnect-secure-lab/` | root, 0755; marcador 0600 | Ejecutables/biblioteca y configuración pública verificados por SHA-256 y marcador de instalación propia |
| `/etc/absorconnect-secure-lab/` | root, 0700 | `wrapping.key` y `host.sealed.json`, ambos 0600; marcador 0600 |
| `/run/credentials/absorconnect-secure-lab.service/` | systemd, archivos root:root 0440 + ACL del servicio | Copias de `LoadCredential`, ajenas al trabajador |
| `/var/lib/absorconnect-secure-lab/` | cuenta dedicada, 0700 | Intentos 0600, exclusión `flock`, auditoría acotada y marcador terminal |
| `/run/absorconnect-secure-lab/` | root, 0755 | Socket 0660 de cuenta dedicada:grupo gráfico |
| `/run/absorconnect-ipc-worker-lab/` | absorlab, 0700 | Buzón de órdenes/respuestas de la sonda, sin secretos; retirada explícita |
| `/var/lib/absorconnect-protected-worker-lab/` | usuario del trabajador, 0700 | Resultado JSON propio del ensayo P2P, sin píxeles o secretos |
| `/etc/systemd/system/absorconnect-{secure-lab.socket,secure-lab.service,ipc-worker-lab.service,protected-worker-lab.service}` | root, 0644 | Unidades exclusivas del ensayo |

La cuenta `absorconnect-lab` es de sistema, sin login ni home; su UID difiere de
root y del escritorio (1000). No se reutiliza una cuenta existente. El servicio
no tiene capacidades, usa `NoNewPrivileges`, sistema de archivos protegido,
core dumps deshabilitados y límites de memoria/procesos. La sonda solo
permite AF_UNIX. La unidad P2P admite también IP/Netlink para WebRTC, sin
credencial de API ni K; usa Xauthority de su usuario en lectura. Ambos deshabilitan dumpability
para que otro proceso del mismo usuario no lea entorno/descriptores/memoria
mediante `/proc` o ptrace ordinario. Root sigue siendo parte de la base confiable.

El estado de intentos se crea **solo durante un alta nueva**, con escritura
exclusiva. El broker exige archivo regular privado y propietario correcto;
no lo crea por ausencia, corrupción, enlace simbólico o escritura fallida.
Reemplaza de forma atómica, sincroniza archivo/directorio y conserva el bloqueo
entre reinicios. Una revocación genera marcador terminal; reiniciar no vuelve
a consultar API ni rehabilita esa instalación. La exclusión impide dos actores
que consuman el mismo registro a la vez.

## Canal local

Systemd crea el listener en un directorio root. El broker recibe exactamente
un descriptor de activación, valida ruta/propietarios/modos y aplica
`SO_PEERCRED` al extremo conectado. Solo admite UID 1000 y el PID principal de
la unidad fija del trabajador, cuyo archivo y ejecutable pertenecen a root.
Otro PID del mismo usuario no basta. El trabajador verifica el socket y las
credenciales del creador del listener: UID 0/PID 1 por activación de systemd.
No se confía en un UID, nombre de ejecutable o PID declarado en JSON.

Los mensajes tienen longitud prefijada (máximo 1 MiB para transportar SDP/ICE, sin superar 64 KiB de respuesta SDP), versión y esquema
cerrados, secuencia estricta y una respuesta pendiente como máximo. Las lecturas
son no bloqueantes; los mensajes parciales y escrituras pendientes caducan a
los dos segundos. Se corta al repetir secuencia o desconectar. No existen RPC
para shell, rutas, configuración, instalación o administración. El buzón de
archivos pertenece **solo a la sonda** y no existe en la variante P2P: no es un canal del producto ni otorga autoridad del sistema.

El broker consulta API en un carril asíncrono separado. El IPC nunca renueva el
permiso. La operación diagnóstica exige autorización vigente y prueba HMAC v1
correcta; una nueva prueba sobre una sesión activa cierra esa sesión. Al perder
API, el permiso caduca por BootClock; recuperar API exige un desafío nuevo.
La variante P2P recibe un plazo absoluto validado del mismo `CLOCK_BOOTTIME`;
consultarlo nunca lo renueva. El trabajador lo comprueba antes/después de
obtener píxeles y antes de aceptar entrada. Una capacidad consumible vincula
la autenticación IPC/HMAC con la misma conexión; el trabajador X11 comparte
su bandera de corte. Un observador independiente del mutex/actor corta el
proceso al perder IPC (2 s) o progreso del actor (3 s). La unidad P2P añade
watchdog externo de 3 s con SIGKILL: cubre también SIGSTOP del proceso entero.
El cierre normal envía Disconnect; perder un trabajador activo deja un evento
worker_failed. El broker no puede escribir un evento después de SIGKILL: para
ese fallo se usa también el estado de systemd.

No se certifican con estas ventanas la liberación general de entrada del SO,
otros escritorios, monitores, escalados o usuarios. La observación `closed` de
la sonda puede preceder al cierre de su hilo; la retirada comprueba el fin del
proceso/cgroup y todas las pulsaciones admitidas son completas.

## Reproducción y retirada

```bash
cargo build --manifest-path agent/Cargo.toml --locked --release --all-features
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --secure-ipc-vm /ruta/vm-lab
# Compilar además libwebrtc con el toolchain/sysroot fijados del laboratorio:
python3 prototypes/remote-desktop/webrtc-check/build-linux.py /ruta/lab /ruta/vm-lab
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --protected-p2p-vm /ruta/vm-lab --node /ruta/node
```

Requiere la VM propia de Ubuntu ARM con `absorlab` UID 1000, acceso SSH por
clave fija/known_hosts y sudo de laboratorio sin contraseña, Rust/dependencias
instalados y los tres binarios ya compilados en su árbol `api-workers`.
No ejecutar el instalador en el host físico. El lanzador crea una cuenta API y
una BD/contenedor efímeros, escenifica instalación y denegaciones y retira
servicio/cuenta/socket/estado/secretos en `finally`. No reinicia la VM ni cambia
LightDM, PAM, políticas polkit, Xauthority o SSH. El puerto de proxy solo se
escucha en loopback, sin router abierto. La prueba de usuario sin privilegios
usa `setpriv --no-new-privs`; no aprovecha el sudo de la cuenta de laboratorio.

`install-vm.py remove`/`remove-native` exige root, el marcador de VM propia y el marcador de
instalación. Para uso del lanzador se transmite el código revisado por SSH;
los artefactos se validan con hashes antes de copiarlos a archivos root. Los
hashes proceden del operador del laboratorio; **no son un manifiesto firmado
de actualización**. La retirada para ambos servicios y el socket, borra solo
sus tres unidades y sus directorios, recarga systemd y elimina la cuenta propia.
No habilita unidades al arrancar ni deja acceso desatendido instalado.

El informe `secure-ipc-*/report.json` contiene casos/indicadores/hashes, sin
contraseñas, tokens o huellas de una sesión personal. El diario privado solo
contiene eventos estáticos del servicio. Para extraer únicamente el registro
acotado durante un ensayo activo:

```bash
sudo cat /var/lib/absorconnect-secure-lab/audit.json
```

Pendientes: trabajadores/contextos generales, migración de identidad y
K desde Electron, instalador final/recuperación transaccional, credenciales
Windows/Mac, contextos protegidos, compilación y piloto de configuraciones
finales. Estas pruebas no certifican los adaptadores finales de los tres SO, ni cierran
6.4 o 7.2. La aceptación del protocolo común 3.2 se evalúa en OpenSpec.


La matriz P2P usa cinco cuentas efímeras y nueve hosts con claves distintas, con diez conexiones
(dos consecutivas al mismo host/broker, con nonce nuevo).
La clave del controlador solo permanece en memoria del lanzador Python; el
main de Electron pide HMAC a su endpoint loopback efímero y el renderer recibe
solo la prueba. Ese endpoint es exclusivo del ensayo y se retira al terminar;
no es una ruta de producción. El trabajador recibe únicamente configuración
pública fija, ofertas/ICE, desafíos/pruebas y plazos; no recibe contraseñas,
K ni tokens de agente/cuenta. No se escriben archivos SDP ni se guardan píxeles.
La instalación Native añade su unidad, ejecutable/biblioteca y resultado JSON;
`remove-native` retira también esos archivos y su directorio. No altera LightDM.

Al cerrar una conexión, la máquina de señalización descarta respuestas en vuelo,
rechaza solicitudes pendientes de la conexión anterior y vuelve a ofrecer ICE
para la siguiente. Reutiliza un único carril/hilo HTTP; no crea hilos nuevos
por reconexión. Un fallo de señalización cierra esa conexión; únicamente la
revocación o un fallo terminal del núcleo inhabilita el alta. La matriz verifica
un PID de broker idéntico en las dos primeras conexiones y nonce distinto.


### Selección local de sesión

El broker consulta logind mediante `agent-linux-session`, en un carril distinto
de API y sin bloquear el actor. Fija el asiento al iniciar HMAC y cierra la
conexión si la muestra caduca o cambia la sesión. El modo de ventana propia
rechaza LightDM y Wayland. La matriz IPC añade cierre/entrada reales de la VM:
autoridad activa y desafío pendiente se anulan, mientras el broker conserva
su PID. La nueva sesión necesita otro desafío; esto no certifica captura de
escritorio general o entrada en greeter. La unidad raíz de selección y la sonda
de Xauthority se describen en `agent-linux-session/README.md` del crate.


### Complemento de concesión X11 posterior a HMAC

El modo `--secure-ipc-authority` del lanzador instala temporalmente el proveedor
root sin capacidades/red IP y un archivo de concesión root:grupo del broker,
0660. HMAC/API siguen en el broker; token/K no llegan al proveedor ni a la sonda.
La concesión de hasta 400 ms vincula los procesos y el asiento real; solo el PID
de unidad autenticado puede recibir un memfd Xauthority sellado. El trabajador
no puede escribir el ejecutable/perfil/concesión, y otro PID de su UID se rechaza.
La sonda cierra el descriptor sin capturar o enviar entrada. Falta unirlo a un
trabajador P2P dedicado y a los contextos generales; no cierra 6.2/6.4.
Véase `crates/agent-linux-session/README.md` para contrato y retirada. No activar
este complemento fuera de la VM propia ni presentar su éxito como certificación.


### Cuenta dedicada y captura contada

```bash
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --secure-ipc-vm /ruta/vm --secure-ipc-authority --secure-ipc-dedicated
```

El modo dedicado crea `absorconnect-worker-lab` sin contraseña de login/home y
con shell nologin. Root instala un perfil local cerrado y drop-ins propios para
separar UID/GID de broker, sonda y usuario gráfico. La cuenta y grupo se retiran
al terminar; el buzón se vacía de sus archivos conocidos y se devuelve al usuario
del laboratorio antes de retirar el laboratorio base. Se conservan drop-ins o
archivos ajenos; una colisión se rechaza. No es un instalador de producción.

Tras HMAC, la sonda fija recibe el fd como stdin y cuenta imágenes de una región
128×72 en X11 con red privada, sin capacidades/home ni lectura de archivos root.
No guarda/transmite imágenes o entrada. Su salida solo admite contadores y
booleanos conocidos y se descarta si la autenticación dejó de ser válida. La
cuenta gráfica anterior ya no tiene acceso al buzón/socket dedicado. Faltan la
unión P2P y la captura/entrada/contextos generales; no cambia la certificación.


## Guardián de entrada fija, optativo de VM

`--secure-ipc-input-lease` requiere `--secure-ipc-dedicated`, autoridad y la VM
propia. Añade `absor-input-lease-probe-lab`, compilado solo con `input-lease-lab`.
No recibe entrada WebRTC: el operador inicia un único evento A/izquierdo en una
ventana propia, después de validar la concesión HMAC/API y su foco. Cada prueba
usa una concesión diferente. El tipo `ValidatedGrant` no admite deserialización
por IPC; el guardián corta al caducar, cambiar autorización, retroceder/fallar el
reloj, repetir secuencia, liberar entrada no poseída o fallar el dispositivo.

El adaptador Rust carga dinámicamente la biblioteca de sistema `libevdev.so.2`
desde un árbol root protegido. El fd uinput nunca sale del proceso. Exige marcador
propio, UID root, NoNewPrivileges y cero capacidades, y no expone texto/rutas/
comandos. La unidad no tiene red IP, limita dispositivos y usa watchdog de 500 ms;
un hilo independiente comprueba el plazo durante las consultas del actor.
SIGKILL o un fallo de ese proceso retiran el dispositivo por el kernel, sin
necesitar enviar keyup globales de XTest. La sonda no se instala al arrancar.

```bash
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --secure-ipc-vm /ruta/vm-lab --secure-ipc-authority \
  --secure-ipc-dedicated --secure-ipc-input-lease
```

Archivos adicionales del ensayo: `/opt/absorconnect-input-release-lab/` y su
marcador `/run/absorconnect-owned-vm-input-release-probe`; binario propio bajo
`/opt/absorconnect-seat-authority-lab/` y unidad
`/etc/systemd/system/absorconnect-input-lease-probe-lab.service`. El observador
usa una unidad transitoria distinta. La retirada comprueba nonce/hashes, detiene
ambas unidades y verifica que no queda su dispositivo, antes de retirar los
archivos. No modifica LightDM, PAM, polkit ni políticas del dispositivo.

Pasan 41 comprobaciones del laboratorio, incluidas diez de entrada propia y tres
de denegación/aislamiento. El informe `linux-input-lease-results.json` no acepta
3.5/6.2: faltan receptor local de entrada, trabajador P2P/captura general,
transiciones protegidas y aislamiento de contenido de cada configuración.


**Límite detectado antes de la adopción:** con dos teclados virtuales propios
manteniendo A, un keyup/retirada de uno puede borrar el estado maestro de Xorg
aunque el otro continúe pulsado en el kernel. No se certifica aislamiento de
teclado local/remoto ni se adopta este teclado general. Se reproduce sin entrada
física con el mismo lanzador independiente:

```bash
python3 -B prototypes/backend-agent-check/linux-uinput-release-check.py /ruta/lab \
  /ruta/vm-lab --verify-local-hold
```

Devuelve 3 por el límite observado, **después** de guardar el informe y retirar
los recursos. Las 41 pruebas de entrada fija/IPC anterior no prueban esa
simultaneidad. `linux-input-overlap-results.json` conserva ambos resultados sin
contabilizar la limitación como éxito. Las pruebas del laboratorio requieren
mantener libres teclado/ratón de esa VM.


### Consulta local de estado independiente (D10)

El modo optativo `ui-status-lab` añade un segundo socket de solo consulta, separado
por completo del par que autoriza al trabajador. El perfil root público
`/opt/absorconnect-secure-lab/ui-profile.json` fija UID/GID del dueño del escritorio
y UID del broker. La unidad `absorconnect-ui-status-lab.socket` crea
`/run/absorconnect-ui-lab/status.sock` con modo 0660. El cliente sin privilegios
`absor-agent-status-lab status --json` comprueba ruta, identidades del kernel,
nonce y plazo antes de devolver un máximo de 512 bytes. El broker comprueba el
UID/GID del cliente y permite una respuesta pendiente durante 250 ms.

La respuesta solo contiene identidad pública y estado; nunca K, token, SDP,
concesiones o autoridad X11. No hay operaciones de configuración, parada o shell.
Cerrar Electron solo cancela esa consulta. Un marcador nativo observado que deja
de responder bloquea el retorno automático al host legado; no demuestra salud.
El DTO público siempre declara `readyForUnattended: false`.

```bash
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --secure-ipc-vm /ruta/vm-lab --secure-ipc-ui-status
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --protected-p2p-vm /ruta/vm-lab --protected-p2p-ui-status --node /ruta/node
```

La primera matriz comprueba consultas repetidas, UID ajeno, tramas malformadas,
clientes parciales y argumentos rechazados sin tocar al trabajador. La segunda
ejecuta seis ciclos de las clases Main reales como usuario sin privilegios, con
vídeo WebRTC activo en Electron y el mismo broker/equipo. No es una prueba del
instalador final ni de una app Electron empaquetada: usa un adaptador explícito de
laboratorio. Requiere el Node 22 privado del laboratorio y conserva su versión y
hash del arnés en el informe. La retirada elimina socket, perfil y drop-in propios.
Los clientes Windows/ACL y Mac/XPC permanecen pendientes y se muestran como no
verificados si existe intención nativa; no se invoca un ejecutable sin validarla.
