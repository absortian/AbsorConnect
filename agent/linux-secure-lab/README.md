# Credenciales e IPC de laboratorio

Prototipo optativo `protected-ipc-lab`. No se distribuye, no captura, no inyecta
entrada y no ejecuta acciones administrativas. El trabajador es una sonda de
protocolo con una operación que incrementa un contador. Sus huellas son datos
fijos de diagnóstico: **no demuestra todavía el enlace a una PeerConnection**.
El trabajador WebRTC/X11 de `linux-lab/` continúa siendo una integración distinta.

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
| `/opt/absorconnect-secure-lab/` | root, 0755; marcador 0600 | Tres ejecutables verificados por SHA-256 y marcador de instalación propia |
| `/etc/absorconnect-secure-lab/` | root, 0700 | `wrapping.key` y `host.sealed.json`, ambos 0600; marcador 0600 |
| `/run/credentials/absorconnect-secure-lab.service/` | systemd, archivos root:root 0440 + ACL del servicio | Copias de `LoadCredential`, ajenas al trabajador |
| `/var/lib/absorconnect-secure-lab/` | cuenta dedicada, 0700 | Intentos 0600, exclusión `flock`, auditoría acotada y marcador terminal |
| `/run/absorconnect-secure-lab/` | root, 0755 | Socket 0660 de cuenta dedicada:grupo gráfico |
| `/run/absorconnect-ipc-worker-lab/` | absorlab, 0700 | Buzón de órdenes/respuestas de la sonda, sin secretos; retirada explícita |
| `/etc/systemd/system/absorconnect-{secure-lab.socket,secure-lab.service,ipc-worker-lab.service}` | root, 0644 | Unidades exclusivas del ensayo |

La cuenta `absorconnect-lab` es de sistema, sin login ni home; su UID difiere de
root y del escritorio (1000). No se reutiliza una cuenta existente. El servicio
no tiene capacidades, usa `NoNewPrivileges`, sistema de archivos protegido,
core dumps deshabilitados y límites de memoria/procesos. El trabajador solo
permite AF_UNIX, sin credenciales ni acceso IP. Ambos deshabilitan dumpability
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

Los mensajes tienen longitud prefijada (máximo 4096 bytes), versión y esquema
cerrados, secuencia estricta y una respuesta pendiente como máximo. Las lecturas
son no bloqueantes; los mensajes parciales y escrituras pendientes caducan a
los dos segundos. Se corta al repetir secuencia o desconectar. No existen RPC
para shell, rutas, configuración, instalación o administración. El buzón de
archivos pertenece **solo a la sonda** y debe desaparecer al unir el trabajador
nativo: no es un canal del producto ni otorga autoridad del sistema.

El broker consulta API en un carril asíncrono separado. El IPC nunca renueva el
permiso. La operación diagnóstica exige autorización vigente y prueba HMAC v1
correcta; una nueva prueba sobre una sesión activa cierra esa sesión. Al perder
API, el permiso caduca por BootClock; recuperar API exige un desafío nuevo.
No se certifican con esta sonda captura/entrada ni liberación de teclas del SO.

## Reproducción y retirada

```bash
cargo build --manifest-path agent/Cargo.toml --locked --release --all-features
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/lab \
  --secure-ipc-vm /ruta/vm-lab
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

`install-vm.py remove` exige root, el marcador de VM propia y el marcador de
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

Pendientes: enlace IPC ↔ DTLS/WebRTC/captura/entrada, migración de identidad y
K desde Electron, instalador final/recuperación transaccional, credenciales
Windows/Mac, contextos protegidos, compilación y piloto de configuraciones
finales. Estas pruebas parciales no cierran por sí solas 3.2, 6.4 o 7.2.
