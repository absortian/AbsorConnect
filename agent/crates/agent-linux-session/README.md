# Selección de sesión Linux

Componente del supervisor en desarrollo (6.1). No es aún un agente remoto:
no consulta la API ni captura, envía entrada o recibe operaciones. El broker
protegido usa el mismo lector de logind en su propio carril, fija el asiento
al iniciar el desafío y descarta autoridad/desafío si cambia o caduca. El
trabajador general y la entrega de Xauthority aún están pendientes. `readyForUnattended` permanece siempre en `false`.

`LogindSource` consulta solo `seat0`, una sesión local X11 y propiedades cerradas.
Usa binarios del sistema protegidos por root, argumentos validados, entorno
vacío, límite de salida y un timeout de proceso. Relee el asiento después de
consultar la sesión para detectar transiciones. Rechaza Wayland, sesión remota,
root gráfico, datos incompletos, duplicados, identificadores/rutas libres y
metadatos que ya no correspondan al asiento activo.

`Monitor` tiene un solo lector y una consulta pendiente. Su actor no espera la
respuesta: descarta muestras al segundo desde que se inició la consulta, usa el
reloj continuo del núcleo y queda terminal ante fallo/retroceso o una consulta
bloqueada durante cinco segundos. No crea lectores sustitutos. Los metadatos no
son permisos de captura ni una autorización recibida por red.

Un `LockedHint=no` de logind no acredita que Cinnamon esté desbloqueado: hace
falta evidencia local adicional. Un greeter exige además el UID que proceda de
la configuración local confiable, no de un controlador. Este componente todavía
no obtiene esa evidencia ni abre Xlib.

## Unidad y diagnóstico

`agent/linux/absorconnect-sessiond.service` ejecuta `absor-sessiond`, sin red IP,
capacidades, dispositivos o acceso al home. Tiene watchdog de tres segundos,
recuperación de fallo, exclusión de otra instancia y parada con todo el cgroup.
La unidad no se instala o habilita en el host desde estos comandos.

```bash
cargo test --manifest-path agent/Cargo.toml -p absor-agent-linux-session
cargo run --manifest-path agent/Cargo.toml --release --example seat-inventory
```

El ejemplo es Linux y de solo lectura: imprime booleanos/contadores, sin UID,
sesión, ruta o credenciales. La unidad publica únicamente diagnóstico acotado
en `/run/absorconnect-sessiond/status.json`, archivo root de solo lectura,
escrito mediante sustitución atómica. La secuencia de publicación **no** es una
secuencia de contexto de WebRTC ni permite ejecutar entrada. Un consumidor
requiere instancia/arranque/PID correctos y frescura; estar `active` en systemd
no hace vigente una selección vieja. No contiene un nombre o contenido de usuario.

## Ensayo reproducible de la unidad

Solo en la VM propia descrita en `prototypes/remote-desktop/unattended-check/`:

```bash
python3 -B prototypes/backend-agent-check/linux-session-service-check.py \
  /ruta/privada/laboratorio /ruta/privada/laboratorio/linux-arm-vm-20261025 --cold-boot
```

Requiere compilar previamente el workspace dentro de esa VM. El controlador
comprueba su SSH loopback/clave fija, no admite un PC físico como destino, y
registra una reclamación privada para retirar exclusivamente archivos propios.
Prueba escritorio/LightDM/nueva sesión, escritura e invocación denegadas,
instancia duplicada, caída, selección caducada antes del watchdog, recuperación,
parada explícita y arranque en frío sin usuario o Electron. Finalmente deshabilita
y retira unidad/binario/directorios propios. Nunca cambia LightDM ni lee
contraseñas o Xauthority. Este ensayo no acredita conexión del broker o captura.


## Vinculación con la autorización

`SeatBinding` conserva la sesión completa solo en memoria del broker; no la
serializa ni permite seleccionarla desde un mensaje IPC/de red. API, HMAC y
huellas DTLS mantienen sus comprobaciones independientes. Una consulta ausente,
caducada, otro UID/Leader/display, otro ID de logind o bloqueo publicado invalida
tanto una conexión activa como un desafío pendiente. Volver al mismo escritorio
no vuelve a fijarlo: hace falta un desafío nuevo. El laboratorio solo permite
iniciar su ventana propia desde una sesión de usuario activa, nunca LightDM.
`LockedHint=no` sigue sin reemplazar la comprobación de Cinnamon del trabajador.

La matriz de credenciales/IPC usa LightDM real en la VM para comprobar el corte,
el rechazo desde el greeter, la entrada posterior con prueba distinta y PID de
broker conservado, y un desafío incompleto invalidado por cerrar sesión. Estos
casos no envían teclas, acceden a archivos del usuario ni capturan el greeter.

## Entrega de autoridad: siguiente componente

La sonda `linux-authority-fd-check.py` verifica por separado que una identidad
sin login, capacidades ni red IP puede contar imágenes X11 en escritorio,
greeter y escritorio nuevo cuando recibe un memfd root sellado. Elige Xorg y
su autoridad localmente y rechaza ambigüedad; no copia cookies a archivos,
argumentos o entorno. Sin descriptor la conexión falla; no puede leer los
archivos root comprobados. El lector binario tiene pruebas de truncamiento,
ambigüedad, familia/protocolo/display ajenos y tamaño.

`absor-agent-security::fd` añade SCM_RIGHTS con CLOEXEC atómico y cierre de todos
los descriptores recibidos al rechazar multiplicidad o truncamiento. Es solo
transporte local: no autentica, no otorga permiso y todavía no lo usa el P2P.
La entrega final deberá ocurrir después de HMAC y validar UID/PID/unidad del
trabajador y el asiento vigente. No se debe heredar la cookie antes de autenticar.


## Concesión efímera optativa de laboratorio

`authority-lab` añade `absor-seat-authority-lab`, un proveedor local separado
activado por socket systemd. Arranca únicamente con el marcador de VM propia y
un perfil instalado por root. No tiene red IP, capacidades, acceso al home ni
RPC para shell, rutas, UID o administración. La única petición es el byte fijo
`G`, con una respuesta SCM_RIGHTS. Su cliente exige listener UID 0/PID 1, inode
root, grupo del trabajador, modo cerrado, sellos completos y CLOEXEC.

El broker sigue siendo la autoridad de HMAC/API. Solo después de una prueba
correcta publica una concesión de hasta 400 ms, limitada además por el plazo de
API. Vincula boot, PID/UID/inicio de proceso del broker y trabajador y un digest
de la sesión X11 local fijada durante el desafío. Se refresca como mucho cada
100 ms; desconectar, cambiar sesión o caducar la API la vacía. Reiniciar el
broker borra el archivo antes de aceptar conexiones. Una escritura incompleta
se rechaza; nunca se confunde con una concesión anterior válida.

Root crea el archivo efímero con propietario root y grupo exclusivo del broker
(0660), en directorio root sin escritura ajena. El trabajador no puede leerlo
ni modificarlo. El proveedor comprueba MainPID de las dos unidades protegidas,
credenciales del núcleo, inicio de proceso, reloj, concesión y asiento antes y
después de preparar el descriptor. No acepta identidad o display del mensaje.
Lee solo la ruta cerrada de autoridad de LightDM correspondiente al display
local y entrega una única cookie, sin copiarla a argumentos, entorno o archivos.
El lector binario rechaza truncamiento, ambigüedad y otros protocolos/displays.

La sonda del trabajador recibe y cierra el descriptor sin abrir X11. Esto une
HMAC → concesión → fd; **todavía no** une el descriptor a libwebrtc o al trabajador
general. La cuenta de la sonda sigue siendo la de escritorio del laboratorio,
con unidad sin red IP/home: falta el perfil dedicado del trabajador P2P.
No garantiza borrar criptográficamente todas las copias temporales de memoria.
No añade acciones, capacidades certificadas o disponibilidad de producción.

```bash
cargo build --manifest-path agent/Cargo.toml --locked --release --all-features
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py \
  /ruta/lab --secure-ipc-vm /ruta/lab/linux-arm-vm-20261025 --secure-ipc-authority
```

El complemento root vive solo en `/opt/absorconnect-seat-authority-lab`, sus dos
unidades, un drop-in propio del broker y `/run/absorconnect-seat-authority-lab`.
No crea usuarios nuevos. Exige grupos separados; no cambia LightDM/PAM/polkit.
Su retirada verifica marcador/hashes, para las unidades y borra solo archivos
propios, incluido el drop-in; conserva otros drop-ins. El lanzador lo retira
antes del laboratorio base y elimina cuenta API/BD/túnel temporales incluso si
una comprobación falla. El informe distingue entrega de descriptor de captura.
