# Kubernetes Agent Guidelines

## Namespace
Todos los manifiestos apuntan al namespace `absorconnect`.

## Estructura de manifiestos
- `00-*`: namespace
- `01-*`: deployments y jobs (`01-00-*` se aplica primero dentro del grupo)
- `02-*`: services
- `03-*`: políticas (presupuesto de interrupción)
- `make-env-secret.sh`: crea/actualiza el Secret `absorconnect-env` desde `backend/.env_prod`

Etiqueta única `app: absorconnect-<componente>` como `metadata.name`, `labels.app`,
selector y nombre de contenedor.

## Objetos
| Manifiesto | Descripción |
|---|---|
| `01-00-php-job` | Job de migraciones Doctrine (Jenkins lo borra, re-aplica y espera a que complete) |
| `01-php-deployment` | FrankenPHP: API Symfony en :80. **3 réplicas, una por nodo** (`topologySpreadConstraints`) |
| `02-php-service` | NodePort **30081** → puerto interno 8068 (siguientes huecos tras AbsorDofus 8067/30080) → contenedor :80 |
| Secret `absorconnect-env` | Config y secretos de runtime (`envFrom` en el Deployment y el Job). **No lo crea Jenkins**: `make-env-secret.sh` desde `backend/.env_prod` (gitignorado) |
| `03-php-pdb` | Un drenaje de nodo nunca deja menos de 2 pods `php` |

No hay worker: la API no tiene trabajo asíncrono.

## Networking
Camino de una petición: Cloudflare (registro `absorconnect.absor.top` con proxy)
→ HAProxy de `head0` (contenedor `infra-haproxy-and-certs_haproxy_1`, TLS con el
certificado comodín `*.absor.top`) → NodePort **30081** de worker0-2 → pod :80.
Dentro del cluster es HTTP plano (`SERVER_NAME=:80`). Solo se sirven `/api/*` y
`/healthz`. Sin SSE ni WebSockets.

La ruta de HAProxy está en `head0:/root/infra-haproxy-and-certs/conf/haproxy.cfg`
(acl `absorconnect_host`, `use_backend absorconnect_backend` y el backend con
`option forwardfor` y `option httpchk GET /healthz`). Ese fichero está montado en
el contenedor como fichero suelto: hay que editarlo sin cambiar su inodo (no
`sed -i`), validarlo con `docker exec infra-haproxy-and-certs_haproxy_1 haproxy -c
-f /etc/haproxy/haproxy.cfg` y recargar con `reload.sh`.

## Configuración
Sin ConfigMaps ni volúmenes. La config de producción es el Secret
`absorconnect-env`, cargado con `envFrom`; lo que es fijo por imagen
(`SERVER_NAME`, `RUN_MIGRATIONS=0`, workers) va como `ENV` en
`docker/prod/php/Dockerfile`. Cambiar un valor requiere reiniciar los pods
(`envFrom` se lee al arrancar). La imagen lleva compilado el `.env` versionado,
pero las variables del Secret ganan (Dotenv no pisa el entorno real).

| Variable | Notas |
|---|---|
| `APP_SECRET` | Aleatorio, ≥ 16 caracteres. No cifra nada guardado: rotarlo es inocuo. |
| `DATABASE_URL` | `postgresql://…@data0.absor.top:25432/absorconnect?serverVersion=16&charset=utf8` |
| `CONNECTIONS_KEY` | 32 bytes en base64 (`php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'`). Cifra las credenciales de las conexiones: **si se pierde, nadie puede volver a leer las suyas**. Guárdala también fuera del cluster. |
| `CONNECTIONS_KEY_PREVIOUS` | Solo durante una rotación: la clave anterior. Lo cifrado con ella se sigue leyendo y se vuelve a cifrar con la nueva al guardarse. |
| `TRUSTED_PROXIES` | Obligatorio (el script falla sin él). Ver abajo. |
| `REMOTE_ENABLED` | `1` (por defecto) o `0`. Con `0`, los endpoints del control remoto (`/api/devices*`, `/api/remote*`) responden 503 `remote_unavailable` y las apps lo muestran como no disponible: sirve para apagarlo sin publicar una versión. |
| `STUN_URLS` | Servidores STUN para WebRTC, separados por comas. Por defecto, `stun:stun.cloudflare.com:3478`; con el relé propio, también el suyo. |
| `TURN_URLS` | URLs del relé TURN propio (coturn), separadas por comas, por ejemplo `turn:turn.absor.top:3478?transport=udp,turns:turn.absor.top:5349?transport=tcp`. Vacío: sin relé, y algunas redes no conectarán. |
| `TURN_SECRET` | El `static-auth-secret` de coturn (`use-auth-secret`). La API firma con él credenciales que caducan a las 24 h. Si se cambia, hay que cambiarlo a la vez en coturn. |

**`TRUSTED_PROXIES`**: los límites por IP (5 registros por hora, 30 inicios de
sesión por minuto) usan la IP del cliente, que llega en `X-Forwarded-For` a través de
Cloudflare → proxy → NodePort (SNAT del nodo) → pod. Symfony solo acepta esa
cabecera de los saltos de confianza, recorriéndola de derecha a izquierda. Sin
ninguno, todas las peticiones parecen venir de la IP del nodo y los límites se
aplicarían a todo el mundo a la vez. Valor recomendado: `REMOTE_ADDR` (el salto
inmediato) más los rangos de Cloudflare (<https://www.cloudflare.com/ips/>),
separados por comas. Comprobado en producción: llega `REMOTE_ADDR` = IP interna
del nodo y `X-Forwarded-For: <cliente>, <Cloudflare>` (Cloudflare añade al
cliente y HAProxy, con `option forwardfor`, la IP de Cloudflare), así que Symfony
ve la IP real. Los NodePort también responden desde internet sin pasar por
HAProxy: por ahí alguien podría falsear su IP en los límites por IP; el límite
por email sigue valiendo.

Todo el estado vive en el Postgres externo: cuentas, sesiones (solo el hash del
token), conexiones (secretos cifrados) y los contadores de los límites de
intentos (`cache_items`, pool `app.rate_limiter_cache`). A diferencia de
Politinder, los límites son uno para todas las réplicas, no uno por pod.

## Relé TURN (coturn en `head0`)
El control remoto usa un relé TURN propio para las redes en las que WebRTC no conecta directo
(add-remote-desktop D13). No está en el cluster: es coturn 4.18.0 en Docker en `head0`
(46.38.240.212), con red del host, en `/root/infra-coturn/`. Al actualizarlo, revisar antes los
avisos de seguridad de coturn: la 4.6.3 con la que se desplegó tenía vulnerabilidades conocidas
(entre ellas, saltarse `denied-peer-ip` con direcciones `::ffff:…`, CVE-2026-27624).

| Fichero | Qué es |
|---|---|
| `docker-compose.yaml` | El contenedor `coturn` (`restart: always`, `network_mode: host`, logs con tope de 10 MB × 3). Se levanta con `docker-compose up -d` desde esa carpeta. |
| `turnserver.conf` | Configuración, con el `static-auth-secret` (= `TURN_SECRET`). Es de `nobody` con permisos 600, porque la imagen corre como `nobody`. |
| `sync-certs.sh` | Copia el certificado comodín `*.absor.top` de HAProxy (`/root/infra-haproxy-and-certs/letsencrypt/live/absor.top`) a `certs/` y le manda `SIGUSR2` a coturn para que lo recargue sin cortar sesiones. Lo lanza `/etc/cron.d/infra-coturn` a las 03:00, después de la renovación de las 02:45. |

- **Puertos:** 3478 UDP/TCP, TLS en 5349 TCP y relé en 49160–49259 UDP (unas 25 sesiones a la vez). Escucha solo en 46.38.240.212 (IPv4). `head0` no tiene cortafuegos: no hay que abrir nada.
- **DNS:** `turn.absor.top` → 46.38.240.212 sin el proxy de Cloudflare, que no reenvía TURN.
- **Cuotas:** 12 asignaciones por usuario TURN y 100 en total, 1 MB/s por sesión y 100 Mbit/s en total. La API da a cada cuenta el mismo usuario durante toda la hora (caducidad redondeada a la hora) y como mucho 120 credenciales por hora, así que la cuota por usuario es, en la práctica, por cuenta.
- **Endurecido:**
  - sin relé TCP (`no-tcp-relay`: WebRTC pide siempre relé UDP, también sobre TCP o TLS);
  - solo TLS 1.2 y 1.3;
  - sin DTLS ni CLI (en la 4.18 van apagados salvo con `--dtls` o `--cli`);
  - sin versión en las respuestas (`no-software-attribute`).
- **`denied-peer-ip`:** las redes privadas y reservadas, y además las IP públicas de `head0`, `data0`, `worker0-2`, `cp00` y `cp01`. Si no, una credencial válida bastaría para usar el relé para llegar a servicios que confían en esas máquinas, como el Postgres de `data0`. **Si cambia la IP de alguna, hay que actualizar la lista** y reiniciar el contenedor.
- **Cambiar el secreto:** generarlo con `openssl rand -hex 32` y cambiarlo a la vez en `turnserver.conf` (con `docker restart coturn`) y en `backend/.env_prod` (`make-env-secret.sh` y reiniciar los pods). Mientras no coincidan, el relé rechaza las credenciales que firma la API. No hay otra copia: el `backend-env.txt` del despliegue se borró después de pasarlo a `.env_prod`.
- **En el Secret:** `TURN_URLS`, `STUN_URLS` y `TURN_SECRET`, también en `backend/.env_prod`.
- **Comprobar:** `prototypes/remote-desktop/relay-check` hace una sesión solo por relé y mira que el par elegido pase por 46.38.240.212. Para probar el relé a mano, `turnutils_uclient` de la imagen `coturn/coturn:4.6.3`, con credenciales firmadas con el secreto (`<caducidad>:<id>` y HMAC-SHA1 en base64).

## Anisette para AltStore (`head0`)
AltStore Classic 2.3+ instala y renueva las apps en el iPhone o el iPad sin ordenador ("Remote
AltServer" en sus ajustes, con la VPN local LocalDevVPN). Para firmar necesita datos de *anisette*
(la autenticación de máquina que Apple pide al firmar), y en vez de los servidores de la comunidad
usamos uno propio: `anisette-v3-server` en Docker en `head0`, en `/root/infra-anisette/`, publicado como
`https://anisette.absor.top`.
- **Qué ve:** no recibe el Apple ID ni su contraseña, que van del dispositivo a Apple. Solo da las cabeceras
  `X-Apple-I-MD…` de una máquina aprovisionada.
- **Contenedor:** `dadoum/anisette-v3-server` con versión fija (`10-2026`; las etiquetas son mensuales),
  `restart: always`, en `127.0.0.1:6969` y con logs con tope de 10 MB × 3. Al arrancar descarga de
  Apple las librerías que necesita y las guarda en el volumen `infra-anisette_anisette-lib`. Se levanta
  con `docker-compose up -d` desde esa carpeta.
- **HAProxy:** `acl anisette_host` y `use_backend anisette_backend` en `web_443_frontend`, y el
  backend a `127.0.0.1:6969` con `timeout tunnel 1h`, porque el aprovisionamiento va por websocket
  (`/v3/provisioning_session`). Usa el certificado comodín. Para recargar, `reload.sh`. Al editar
  `conf/haproxy.cfg`, hay que conservar el inodo (no vale `sed -i`), porque está montado en el contenedor.
- **DNS:** `anisette.absor.top` apunta directo a `head0`, sin el proxy de Cloudflare, como
  `turn.absor.top`. Con el proxy también funcionaría, porque Cloudflare deja pasar los websockets.
- **Comprobarlo:** `curl https://anisette.absor.top/` devuelve las cabeceras en JSON, y
  `/v3/client_info` la versión del cliente.

## Despliegue sin cortar peticiones
`maxSurge: 1` / `maxUnavailable: 0`, `preStop` con `sleep 10`, readiness contra
`/api/health` (atraviesa PHP y Postgres) y liveness contra `/healthz` (ruta
estática de Caddy: una caída de la BD no reinicia los pods).

## CI/CD
Jenkins construye `absortian/absortian:php-absorconnect-1.0.0` (tag estable), lo
sube a DockerHub, aplica namespace, comprueba que exista el Secret
`absorconnect-env`, aplica service, PDB y el Job de migraciones, espera a que
complete y hace `rollout restart` de `absorconnect-php`. Con tag estable,
`kubectl apply` no recrea pods: el `rollout restart` es lo que despliega la
imagen nueva.

## Primer despliegue
1. **Crear la base de datos** en el Postgres externo (`data0.absor.top:25432`),
   con un usuario propio que solo es dueño de ella (no `postgres`):
   `CREATE ROLE absorconnect LOGIN PASSWORD '…'; CREATE DATABASE absorconnect OWNER absorconnect ENCODING 'UTF8';`.
   Las tablas las crea el Job.
2. **Rellenar `backend/.env_prod`** (tabla de arriba) y lanzar `kube/make-env-secret.sh`.
3. **Crear el job de Jenkins** con este `Jenkinsfile` y lanzarlo.
4. **Crear el dominio** `absorconnect.absor.top` en Cloudflare (con proxy) y su
   ruta en el HAProxy de `head0` hacia el NodePort 30081 (ver Networking).
5. Comprobar: `curl https://absorconnect.absor.top/api/health` → `{"status":"ok"}`.

## Operación
```bash
# Restablecer la contraseña de una cuenta (la muestra una vez y cierra sus sesiones)
kubectl exec -n absorconnect deploy/absorconnect-php -- php bin/console app:user:reset-password persona@correo.com

# Cuentas, número de conexiones y sesiones activas (nunca secretos)
kubectl exec -n absorconnect deploy/absorconnect-php -- php bin/console app:user:list
```
