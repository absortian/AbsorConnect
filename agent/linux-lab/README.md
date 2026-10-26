# Broker persistente de laboratorio en Linux

`absor-linux-broker-lab` mantiene el proceso entre conexiones. La unidad es del
**sistema**, se habilita en `multi-user.target` y ejecuta el broker como
`absorlab` (UID 1000), sin capacidades ni privilegios nuevos. Es exclusiva de
la VM ARM desechable. No es el agente de producción: conserva la K pública del
vector, HTTP loopback y captura/entrada limitadas a una ventana propia de prueba.

El broker consulta solicitudes mientras está libre. Durante una conexión deja
ese carril inactivo: el proceso de transporte realiza su propia validación API
nueva, señalización, DTLS/HMAC y renovación. El UUID seleccionado se fija en la
configuración local; otra oferta no puede sustituirlo. No hay un permiso de
captura serializado entre procesos ni dos consumidores activos del heartbeat.
Cada trabajador termina antes de admitir el siguiente. Si el supervisor
termina de forma anómala, el broker sale con código 75: systemd limpia todos
los descendientes del cgroup antes de recuperar el servicio. No continúa
admitiendo trabajo con un nieto de estado incierto. Una solicitud que sigue
pendiente tras un fallo no se relanza en bucle dentro de la misma instancia.

El supervisor recibe pulsos numerados desde el actor del broker por un pipe
anónimo heredado. Un bloqueo, EOF, repetición o mensaje inválido corta al
trabajador; los pulsos prueban progreso, nunca autorización. El trabajador sigue
vigilando a su supervisor y su gate sigue exigiendo API válida. systemd vigila
al broker con `WatchdogSec=5s` y limpia el cgroup al detenerlo. Una parada
explícita no se reinicia sola. Tres activaciones en sesenta segundos agotan el
límite de arranques; tras corregir la causa se usa `systemctl reset-failed`
antes del arranque administrativo.

La credencial original se instala como root en un directorio 0700 y fichero
0600. [`LoadCredential`](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#LoadCredential=ID[:PATH])
entrega una copia de solo lectura al servicio; no viaja en argv ni en el entorno.
En la VM con systemd 255 es root:root 0440 con ACL para su UID. El broker valida
esa representación concreta y deniega otras. El usuario del servicio puede
acceder a su copia: todavía falta separar la identidad del broker de la del
escritorio mediante IPC protegido para el paquete final.

Los ejecutables y sus padres son de root y no escribibles por usuarios ajenos.
`/var/lib/absorconnect-broker-lab/rust-agent-state` conserva el diario de intentos
al terminar una conexión, reiniciar el servicio o arrancar el SO. Una
revocación observada crea una marca terminal persistente: ni una parada ni un
arranque manual la eliminan. No implementa aún alta nueva/migración de Electron.
`/run/absorconnect-broker-lab/session-*` contiene la configuración temporal 0600;
se retira al terminar cada trabajador o al parar la unidad. Solo se conserva
el último resultado acotado, sin SDP, contraseñas ni teclas recibidas.

El broker puede estar esperando en LightDM, sin Electron ni una sesión de
usuario. Esto **no certifica captura o entrada en LightDM**. El adaptador X11
actual comprueba con logind asiento, sesión, UID, clase, tipo y pantalla; exige
Cinnamon desbloqueado. Rechaza greeter, bloqueo, otra identidad o contexto y
Wayland. Faltan el trabajador general, transiciones, liberación de entrada tras
muerte abrupta, IPC/almacén final, paquete `.deb` y piloto físico.

## Reproducción

Desde la raíz del repositorio, con el laboratorio privado ya preparado:

```bash
python3 -B prototypes/remote-desktop/webrtc-check/build-linux.py "$LAB" "$VM"
python3 -B prototypes/backend-agent-check/linux-broker-check.py "$LAB" "$VM"
python3 -B prototypes/backend-agent-check/isolated-webrtc-renewal.py "$LAB" \
  --node "$NODE" --linux-webrtc-vm "$VM" --linux-broker
```

`linux-broker-check.py` usa un trabajador artificial sin pantalla/entrada para
probar secuencias, repetición pendiente, caída/bloqueo del broker, reinicio,
parada, arranque sin sesión, persistencia y denegación a otro UID. La matriz
WebRTC independiente usa el binario nativo real y cuentas efímeras contra una
API/BD aisladas: vídeo/entrada de ventana propia, HMAC/DTLS erróneos, bloqueo,
revocación y pérdida de API. No confundir esos dos tipos de evidencia.

## Archivos y retirada

El instalador de prueba solo admite la VM marcada, rutas fijas, hashes de los
artefactos y destinos ausentes. Comprueba la unidad con `systemd-analyze verify`.
Crea exclusivamente:

- `/opt/absorconnect-broker-lab/`: broker, supervisor, transporte, biblioteca y marca.
- `/etc/absorconnect-broker-lab/agent.json`: configuración original protegida.
- `/etc/systemd/system/absorconnect-broker-lab.service` y enlace de habilitación.
- `/var/lib/absorconnect-broker-lab/`: estado persistente de esa instalación.
- `/run/absorconnect-broker-lab/`: runtime administrado por systemd.

La retirada de laboratorio verifica su marca, para/deshabilita la unidad,
recarga systemd y elimina **sus propios** archivos, estado y credencial. No
modifica PAM, polkit, LightDM, Xauthority ni `xhost`. Los lanzadores la ejecutan
en `finally`; una instalación fallida también retira lo que acaba de crear.
Esta retirada destructiva del diario es para pruebas efímeras; una
actualización de producción tendrá que conservarlo transaccionalmente.

## Informe local sin secretos

El módulo común `agent-broker::audit` acepta únicamente variantes de un enum,
sin ningún parámetro de texto libre. Conserva los últimos 64 eventos, un contador
de secuencia persistente y esquema 1, hasta 16 KiB. Rechaza campos desconocidos,
eventos ajenos, secuencias discontinuas, archivos grandes, enlaces y permisos
abiertos en Unix. Escribe mediante creación exclusiva, sincronización y rename;
un fallo deja la instancia inhabilitada y no pisa una transacción interrumpida.
Las pruebas comunes cubren rotación, reapertura y esas denegaciones.

En una instalación de laboratorio activa se extrae **solo este informe**:

```bash
sudo -u absorlab cat /var/lib/absorconnect-broker-lab/audit.json
```

Sus campos son únicamente `schema`, `records`, `sequence` y `event`. Incluye
inicio del broker/trabajador, fin, rechazo, fallo, caducidad y revocación.
Un arranque manual de una identidad ya revocada termina antes de `READY`;
systemd puede mostrarlo como fallido, y no vuelve a consultar la API. Una
muerte abrupta puede dejar un inicio sin fin; el arranque posterior añade un
nuevo evento y el journal de systemd permite investigar la caída. No se inventa
un cierre que el proceso no llegó a registrar. No extraer ni compartir
`agent.json`, el directorio de credenciales, SDP o el diario de intentos como
parte de este informe. La retirada de laboratorio borra su historial efímero.

La prueba de arranque usa apagado limpio y arranque en frío de QEMU/HVF. El
reinicio en caliente observado se detuvo en shim/UEFI y sigue pendiente; esto
no demuestra un reinicio remoto completo. El servicio sí se comprueba activo
antes del primer inicio de sesión y sin Electron.
