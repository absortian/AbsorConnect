# API del agente desatendido

Contrato aditivo de `add-unattended-admin-access`, preparado para el agente nativo.
Estas rutas no instalan un servicio ni convierten los hosts actuales en desatendidos.
La certificación y publicación de los agentes Windows/Mac/Mint siguen pendientes.
El token de cuenta nunca se copia al servicio ni se entrega a sus renderers.

## Alta y propietario

1. La app registrada pide `POST /api/devices/{id}/agent-enrollments`, con su
   `Authorization: Bearer acs_…` y `X-Device-Key`. Respuesta 201:
   `{enrollmentToken: "ace_…", expiresAt: "…"}`. Se conserva solo SHA-256;
   caduca a los cinco minutos y crear otra autorización invalida la anterior.
2. El instalador autorizado entrega esa autorización, por IPC local protegido,
   al agente. `POST /api/host-agent/enroll` no exige el token de cuenta. Cuerpo:
   `{enrollmentToken, agentVersion, capabilities}`. El canje devuelve 201:
   `{token: "acg_…", deviceId, expiresAt}` y consume atómicamente el alta.
   El propietario pasa a ser el agente dentro de esa misma transacción.
3. Mientras exista ese propietario, el host legado recibe 409
   `device_agent_owned` al registrarse, consultar, responder o retirarse.
   Los controladores de cuenta siguen listando equipos y creando solicitudes.
   El traspaso retira únicamente las ofertas pendientes del equipo transferido.
4. `DELETE /api/devices/{id}/agent` acepta el token de cuenta propietaria o la
   credencial de ese agente. Devuelve 204. La cuenta puede repetirlo con el mismo
   resultado. Una credencial revocada ya no autentica una segunda petición.
   La baja borra altas pendientes y solicitudes, y deja el equipo desactivado
   hasta que la app vuelva a registrarlo. No borra conexiones S3/SSH.

La clave del equipo sigue siendo necesaria para el modo legado y crear un alta;
no basta por sí sola para operar el agente. No se transfiere el token de cuenta.
La pérdida temporal del trabajador o de la API no devuelve el propietario al modo
legado. Una credencial caducada tampoco lo hace: el propietario debe revocarla y
crear un alta nueva. Las sesiones invalidadas se retiran con sus agentes.

## Rutas de servicio

Todas usan exclusivamente `Authorization: Bearer acg_…`. Un token de cuenta no
sirve en ellas; el agente no tiene `ROLE_USER`. Solo se guarda SHA-256.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `PUT /api/host-agent/device` | Datos actuales de `PUT /api/devices/{id}` más `agentVersion` y `capabilities`; solo actualiza el propio equipo. Devuelve `{deviceId}`. |
| `GET /api/host-agent/remote-requests` | `{requests: [{id, controllerName, offer, createdAt}], authorization: {validForSeconds: 30, authorizedUntil}}`. Mantiene el heartbeat. |
| `PUT /api/host-agent/remote-requests/{id}/answer` | El mismo `{answer}` o `{rejected: {reason, retryAfter?}}` del host legado; 204. Exige que la solicitud sea del propio equipo y siga viva. |
| `GET /api/host-agent/ice-servers` | Mismo `{iceServers, ttl}` y misma cuota TURN de la cuenta; las credenciales TURN son temporales. |

`agentVersion` tiene de 1 a 32 caracteres alfanuméricos, punto, guion o `+`.
`capabilities` admite solo booleanos `administration`, `login`, `secureAttention`
y `restart`; un campo ausente significa `false`. Solo se anuncian las capacidades
que el paquete nativo haya verificado. El backend conserva la declaración del
agente: **no certifica mediante una petición HTTP que la captura/entrada funcione**.
En `GET /api/devices`, `remote` incorpora opcionalmente `mode: "agent"`,
`agentVersion` y `capabilities`; un host legado conserva exactamente su respuesta
anterior, sin esos campos. Las funciones antiguas `clipboard/files/audio` no cambian.

El agente consulta normalmente cada tres segundos. Debe contar la autorización
con reloj monotónico, descontar el tiempo de ida/vuelta de la petición y nunca
extenderla más de 30 segundos desde el inicio de la última consulta válida.
Un error HTTP, falta de red o respuesta tardía no renueva ese permiso: al vencer
se corta cualquier sesión, incluso P2P. Esta regla todavía requiere pruebas del
agente; estas rutas solo proporcionan el contrato de renovación.

La credencial caduca tras 90 días sin uso. Las escrituras de renovación se agrupan
como máximo una por hora. **Nunca renuevan la sesión de cuenta origen**. Cada
operación revalida su existencia y caducidad. Logout de origen, cambio o reset de
contraseña y borrado de cuenta invalidan el vínculo; cambiar la contraseña también
revoca agentes originados en la sesión actual, aunque su token de cuenta continúe.
Cerrar otra sesión no vinculada no revoca el agente.

## Denegaciones y límites

| Código HTTP / error | Significado |
|---|---|
| 400 `agent_enrollment_invalid` | Alta desconocida, consumida, sustituida, caducada o sin origen válido. No emite credencial. |
| 400 `agent_invalid` | Versión o capacidades inválidas; `details.field` identifica el campo. |
| 401 `unauthenticated` | Credencial ausente, revocada/caducada, de otro tipo o usada fuera de su firewall. |
| 403 `device_key_invalid` | La cuenta es propietaria pero la clave del equipo no coincide. |
| 404 `device_not_found` / `remote_request_not_found` | Recurso inexistente o ajeno. Una solicitud de otro equipo de la misma cuenta también responde 404. |
| 409 `device_agent_owned` | El host legado ya no es el propietario. |
| 409 `remote_request_answered` | Solicitud ya resuelta. |
| 410 `remote_request_expired` | Solicitud propia caducada. |
| 429 `too_many_requests` | Límite compartido; respetar `Retry-After`. |
| 503 `remote_unavailable` | `REMOTE_ENABLED=0`; incluye el canje público de altas. |

No se permite al agente leer conexiones o cuenta, listar otros equipos, crear
solicitudes de controlador ni dar de alta otros agentes. Las consultas usan el
mismo contador por equipo del host legado; ICE usa el mismo contador y usuario
TURN por cuenta. Crear altas comparte el límite de solicitudes de la cuenta.

## Verificación reproducible

Desde la raíz, con la API de desarrollo y la base de pruebas preparadas:

```bash
docker compose exec -T php php bin/phpunit tests/Api/HostAgentTest.php
python3 prototypes/backend-agent-check/run.py
```

La segunda prueba solo apunta a `http://127.0.0.1:8020`, genera una cuenta temporal
aleatoria y la elimina al terminar. Comprueba canjes concurrentes, traspaso frente
al registro legado y canje frente a logout. Solo imprime resultados y estados;
no tokens, emails, contraseñas ni SDP. No ejecutar contra producción ni cambiar
su dirección para reutilizar credenciales reales. El código sirve de ejemplo
completo de petición permitida (consulta ICE con credencial nueva) y denegada
(la misma consulta tras revocación).

Las migraciones solo añaden `agent_enrollment` y `host_agent` con índices y claves
foráneas; no cambian claves de cifrado, conexiones, sesiones ni `cache_items`.
Antes de restaurar un backend anterior, retirar las altas y revocar los agentes
activos: un backend antiguo no aplica su autoridad. Las tablas aditivas pueden
conservarse durante el rollback del binario.
