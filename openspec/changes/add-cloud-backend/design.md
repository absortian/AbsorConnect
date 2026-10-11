# Design

## Context

Ver proposal.md (Why). Se replican las convenciones de los demás proyectos del propietario, con Politinder como referencia:

- **Stack:** Symfony 8.1 (PHP 8.5) sobre FrankenPHP, Doctrine ORM 3 y Postgres 16.
- **Estilo:** `final class`, propiedades promovidas `readonly`, atributos (`#[Route]`), y errores de API como `ApiException(code, status)` con códigos `snake_case` estables.
- **Producción:** imagen única `absortian/absortian:php-<proyecto>-<versión>` construida con el builder **clásico** de Docker (sin BuildKit: nada de heredocs, `#syntax` ni `COPY --link/--chmod`).
- **Kubernetes:** Job de migraciones (la imagen lleva `RUN_MIGRATIONS=0`), Deployment de 3 réplicas repartidas por nodo, NodePort, PDB y Secret `<proyecto>-env` creado a mano con `make-env-secret.sh`.
- **Infraestructura:** Postgres externo compartido en `data0.absor.top:25432`. El TLS termina en el proxy (Cloudflare) y el pod sirve HTTP plano en `:80`.
- **NodePorts ocupados:** 30020-30021, 30049, 30066-30067 y 30069-30080. Los siguientes libres son **30081** (NodePort) y **8068** (puerto interno), tras AbsorDofus (30080/8067).

La app de escritorio no tiene sesión de navegador: hablará con la API desde el proceso principal de Electron, con un token en una cabecera.

## Goals / Non-Goals

**Goals:**
- Una API pequeña, sin estado en el pod (todo en Postgres), desplegable con el mismo pipeline que el resto.
- No guardar secretos legibles: ni las contraseñas de las cuentas (solo hash) ni los tokens (solo SHA-256) ni las credenciales de las conexiones (cifradas con una clave propia).

**Non-Goals:**
- Worker, cola o Messenger: no hay trabajo asíncrono.
- SPA o frontend web: la API solo la usa la app de escritorio.

## Decisions

### D1. Estructura en el monorepo
- `backend/`: app Symfony, con un `Dockerfile` para desarrollo vía compose (con BuildKit), `frankenphp/` y `tests/`.
- `docker/prod/php/Dockerfile`: imagen de producción para Jenkins, con contexto en la raíz y sin stage de SPA.
- `kube/`, `Jenkinsfile`, `compose.yaml` y `compose.override.yaml` en la raíz. Puertos de desarrollo: **8020** para la API y **5434** para Postgres, distintos de AbsorQuiz (8000/5432) y Politinder (8010/5433).
- `electron-builder.yml` excluye `backend/**`, `docker/**`, `kube/**`, `Jenkinsfile`, `compose*.yaml` y `openspec/**`. Si no, electron-builder metería el backend en `app.asar`.

### D2. Modelo de datos
| Tabla | Campos |
|---|---|
| `app_user` | `id` (UUID v7), `email` (único, en minúsculas), `password` (hash `auto`), `created_at`, `connections_revision` (int, 0 al crear) |
| `user_session` | `id`, `user_id` (FK, `ON DELETE CASCADE`), `token_hash` (SHA-256 hex, único), `device_name`, `created_at`, `last_used_at`, `expires_at` |
| `connection_entry` | PK (`user_id`, `id`), donde `id` es el identificador del cliente (texto ≤ 64); `position` (int); `parent_id` (texto o null); `kind` (`folder` \| `s3` \| `ssh`); `name`; `data` (jsonb con los campos no secretos del tipo); `secrets` (texto cifrado o null); `updated_at` |

La PK compuesta permite que dos cuentas usen el mismo `id` sin chocar (escenario de aislamiento).

### D3. Autenticación con token opaco por dispositivo
Se usa el autenticador nativo `access_token` de Symfony con un `AccessTokenHandler` propio:
- **Token:** 32 bytes aleatorios en base64url con prefijo `acs_`. En BD solo se guarda su SHA-256.
- **Validación:** se busca `token_hash` con `expires_at > now`.
- **Caducidad deslizante:** `last_used_at` y `expires_at` (+90 días) se actualizan como mucho una vez por hora por sesión, para no escribir en cada petición.
- **Logout:** borra la sesión.
- **Cambio de contraseña y restablecimiento:** borran las demás sesiones, o todas en el caso del restablecimiento.
- **Inicio de sesión:** borra de paso las sesiones caducadas de esa cuenta, así que no hace falta un CronJob.

*Alternativa descartada:* JWT con tokens de refresco (lexik + gesdinet, como en AbsorShopCatalog). Añade dos bundles y la complejidad de la rotación, y un JWT no se puede revocar antes de caducar. Aquí cada petición puede consultar la sesión en Postgres sin coste apreciable.

### D4. Contrato de la API
Todas las rutas son JSON. Los errores tienen la forma `{ "error": "<code>", ...detalle }`.

| Método y ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /api/auth/register` | — | `{email, password, deviceName}` | 201 `{token, user: {id, email}}` |
| `POST /api/auth/login` | — | `{email, password, deviceName}` | 200 `{token, user}` |
| `POST /api/auth/logout` | token | — | 204 |
| `GET /api/me` | token | — | 200 `{id, email, createdAt}` |
| `PUT /api/me/password` | token | `{currentPassword, newPassword}` | 204 |
| `DELETE /api/me` | token | `{password}` | 204 |
| `GET /api/connections` | token | — | 200 `{revision, entries: [...]}` |
| `PUT /api/connections` | token | `{revision, entries: [...]}` | 200 `{revision, entries}` o 409 `{error: connections_conflict, revision, entries}` |
| `GET /api/health` | — | — | 200 si PHP y Postgres responden (readiness) |

- **Códigos de error:** `email_invalid`, `email_taken`, `password_too_short`, `password_too_long` (>4096), `invalid_credentials`, `password_incorrect`, `unauthorized` (401), `too_many_attempts` (429), `connections_conflict` (409), `connections_invalid` (400, con `{index, reason}`) y `invalid_json`.
- **Formato de las entradas:** el mismo que usa hoy la app (`ConnectionEntry` de `src/shared/types.ts`), con los secretos en claro (por HTTPS) y `credentialsUnavailable` cuando aplique. El servidor separa los secretos (`accessKeyId`, `secretAccessKey`, `password`, `passphrase`) en `secrets` y el resto en `data`, y conserva el orden recibido en `position`.

### D5. Guardado de la lista: reemplazo completo con revisión
`PUT /api/connections` reemplaza la lista entera en una transacción:
1. Bloquea la fila del usuario con `SELECT … FOR UPDATE`.
2. Compara la revisión. Si no coincide, responde 409 con la lista actual.
3. Valida todas las entradas (D7).
4. Borra las que ya no vienen e inserta o actualiza las demás.
5. Incrementa `connections_revision`.

Encaja con cómo guarda hoy la app: la barra lateral envía la lista completa en cada cambio.

*Alternativa descartada:* CRUD por conexión con `updated_at` por entrada. Es más granular, pero obliga a rehacer el cliente, y los conflictos entre dispositivos de una misma persona son raros.

### D6. Cifrado de los secretos
- **Algoritmo:** `sodium_crypto_secretbox` (XSalsa20-Poly1305) con la clave `CONNECTIONS_KEY` (32 bytes en base64).
- **Formato:** `v1:` + base64(nonce ‖ ciphertext). El contenido es el JSON de los secretos de la entrada.
- **Rotación:** se admite `CONNECTIONS_KEY_PREVIOUS`. Si el descifrado con la clave actual falla, se prueba con la previa, y el siguiente guardado vuelve a cifrar con la actual.
- **Fallo de descifrado:** la entrada sale con los secretos vacíos y `credentialsUnavailable: true`. Si el cliente la devuelve así, se conserva el `secrets` guardado, con la misma semántica que el almacén local de `harden-connection-store`.

*Por qué no `APP_SECRET`:* rotar `APP_SECRET` (por ejemplo, ante una filtración) no debe dejar ilegibles las credenciales de todos los usuarios, como pasa con `SecretCrypto` en Politinder.

### D7. Validación
Se porta a PHP la lógica de `normalizeEntry` (`src/shared/connections.ts`):
- Una entrada sin tipo es S3.
- Tipos permitidos: `s3`, `ssh` y carpeta.
- Campos obligatorios por tipo.
- `port` entre 1 y 65535.
- `authMethod` válido y `privateKeyPath` obligatorio con clave privada.

Además: `id` único y de 64 caracteres como máximo, `parentId` que apunte a una carpeta de la misma lista, 1000 entradas como máximo, campos de texto de 1000 caracteres como máximo y secretos de 16 KB como máximo.

### D8. Límites de intentos compartidos entre réplicas
Se usa `symfony/rate-limiter` con almacenamiento en un pool de caché sobre Postgres (`cache.adapter.doctrine_dbal`). Así el límite es global y no 3 veces mayor, que es lo que pasa en Politinder con la caché local de cada pod.

| Acción | Límite |
|---|---|
| Registro por IP | 5 por hora |
| Inicio de sesión por email | 5 intentos fallidos por minuto |
| Inicio de sesión por IP | 30 por minuto |

En `test` no hay límite, salvo en el test que los comprueba. La IP se toma de `X-Forwarded-For` a través de proxies de confianza (`trusted_proxies` configurable por entorno, porque el TLS termina en el proxy).

### D9. Comandos de consola
- `app:user:reset-password <email>`: genera una contraseña aleatoria, la muestra una vez y revoca las sesiones.
- `app:user:list`: email, fecha de alta, número de conexiones y de sesiones activas. Sirve para el soporte; nunca muestra secretos.

### D10. Despliegue
Imagen `absortian/absortian:php-absorconnect-1.0.0`.

**Jenkinsfile**, calcado de Politinder sin el worker:
1. `build`/`push`.
2. Namespace y secret de registro.
3. Comprobar que existe el Secret `absorconnect-env`.
4. Service y PDB.
5. Job de migraciones, esperando a que complete.
6. Deployment y `rollout restart`/`status`.

**Kubernetes:**
- 3 réplicas con `topologySpreadConstraints`, `maxSurge: 1` y `maxUnavailable: 0`.
- `preStop` con `sleep 10`.
- Readiness contra `/api/health` y liveness contra `/healthz` de Caddy.
- `FRANKENPHP_WORKER_CONFIG="num 4"`, para no agotar el `max_connections` del Postgres compartido.

**Secret `absorconnect-env`:** `APP_SECRET`, `DATABASE_URL`, `CONNECTIONS_KEY` (`CONNECTIONS_KEY_PREVIOUS` opcional) y `TRUSTED_PROXIES`.

### D11. Logs
Ningún log incluye contraseñas, tokens ni secretos de conexión. Los errores de descifrado solo registran el id de la entrada y el de la cuenta.

## Risks / Trade-offs

- **[Cifrado en el servidor]** Quien obtenga a la vez la base de datos y `CONNECTIONS_KEY` puede leer todas las credenciales. → Clave solo en el Secret de Kubernetes, separada de `APP_SECRET` y rotable, y nada de secretos en logs. Es la decisión del propietario frente al cifrado de extremo a extremo.
- **[Sin verificación de email]** Se pueden crear cuentas con emails ajenos, y una contraseña olvidada solo se recupera pidiéndosela al operador. → Límite de registro por IP, restablecimiento por consola y verificación como posible change futuro.
- **[Reemplazo de lista completa]** Un conflicto descarta el cambio del dispositivo que pierde. → Es raro (una persona, varios equipos), y el cliente recibe la lista actual para que la persona rehaga el cambio.
- **[Postgres compartido]** → `num 4` workers × 3 réplicas = 12 conexiones como máximo.
- **[La API queda pública en internet]** → Solo expone `/api/*` y `/healthz`, sin panel. Los límites de intentos frenan la fuerza bruta.

## Migration Plan

1. Mergear este change: no afecta a la app publicada.
2. **Propietario:**
   - `CREATE DATABASE absorconnect ENCODING 'UTF8';` en `data0.absor.top:25432`.
   - Rellenar `backend/.env_prod` y lanzar `kube/make-env-secret.sh`.
   - Crear el job de Jenkins.
   - Crear el dominio en Cloudflare hacia el NodePort 30081.
3. Lanzar el pipeline: construye, migra y despliega.
4. Comprobar `GET https://<dominio>/api/health`.
5. **Rollback:** `kubectl rollout undo`. Las migraciones de este change solo crean tablas nuevas.
