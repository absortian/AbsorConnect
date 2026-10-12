# Tasks

## 1. Andamiaje del backend

- [x] 1.1 Crear `backend/` con Symfony 8.1 (PHP 8.5) a partir de la estructura de Politinder: `Dockerfile` de desarrollo, `frankenphp/` (Caddyfile, `conf.d`, entrypoint), `composer.json` con Doctrine ORM 3, migrations, security, rate-limiter, validator, uid, monolog y phpunit. Verificar: `docker compose up -d --wait` levanta la API en :8020 y Postgres en :5434.
- [x] 1.2 `compose.yaml` y `compose.override.yaml` en la raíz (datos en `./.docker/`, gitignorado), `backend/.env` con valores de desarrollo y entradas en `.gitignore` (`backend/.env_prod`, `.env.local`, `.docker/`). Verificar: `git status` no muestra `.docker/` ni `vendor/`.
- [x] 1.3 Excluir del paquete de Electron `backend/**`, `docker/**`, `kube/**`, `Jenkinsfile`, `compose*.yaml` y `openspec/**` (`electron-builder.yml`). Verificar: `npx electron-builder --dir` y `npx asar list` del `app.asar` no contienen `backend/`.

## 2. Cuentas y sesiones

- [x] 2.1 Entidades `User` y `UserSession` con su migración (D2). Verificar: `doctrine:migrations:migrate` y `doctrine:schema:validate` sin diferencias.
- [x] 2.2 `ApiException`, listener de errores JSON y lector de cuerpo JSON (estilo Politinder). Verificar: test de un JSON mal formado → `invalid_json`.
- [x] 2.3 Autenticador `access_token` con `AccessTokenHandler` sobre `user_session` (hash SHA-256 y caducidad deslizante de 90 días, actualizada como mucho una vez por hora) (D3). Verificar con tests: token válido, caducado, revocado e inexistente.
- [x] 2.4 `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` y `GET /api/me`, con normalización de email y validación de contraseña. Verificar con tests: los escenarios de "Registro abierto", "Inicio de sesión por dispositivo" y "Cierre de sesión".
- [x] 2.5 `PUT /api/me/password` y `DELETE /api/me`. Verificar con tests: los escenarios de "Cambio de contraseña" y "Borrado de la cuenta" (incluido que no queda ninguna fila del usuario).
- [x] 2.6 Límites de intentos en un pool de caché sobre Postgres y `trusted_proxies` por entorno (D8). Verificar con tests: 6.º intento de login fallido → 429 y 6.º registro desde la misma IP → 429.
- [x] 2.7 Comandos `app:user:reset-password` y `app:user:list` (D9). Verificar con tests de consola: el reset revoca sesiones, conserva conexiones y la contraseña nueva funciona.

## 3. Conexiones en la nube

- [x] 3.1 Entidad `ConnectionEntry` con PK (`user_id`, `id`), `revision` en el usuario, y su migración (D2). Verificar: `doctrine:schema:validate`.
- [x] 3.2 `ConnectionsCrypto` con sodium, `CONNECTIONS_KEY` y `CONNECTIONS_KEY_PREVIOUS` (D6). Verificar con tests unitarios: ida y vuelta, rotación (lee con la previa y vuelve a cifrar con la actual) y fallo de descifrado.
- [x] 3.3 Validador de entradas portado de `normalizeEntry` más los límites de D7. Verificar con tests: tipo desconocido, campos ausentes, puerto fuera de rango, `parentId` sin carpeta, id duplicado y más de 1000 entradas → `connections_invalid` con índice y motivo.
- [x] 3.4 `GET /api/connections` y `PUT /api/connections` con revisión y bloqueo `FOR UPDATE` (D5), separando `data` y `secrets` y conservando el secreto si llega `credentialsUnavailable` sin secreto nuevo. Verificar con tests: los escenarios de "Conexiones por usuario", "Sincronización con revisión", "Secretos ilegibles se conservan" y "Secretos cifrados en reposo" (consultando la tabla).
- [x] 3.5 `GET /api/health` (PHP + `SELECT 1`). Verificar: 200 con la BD levantada y 503 sin ella.

## 4. Despliegue

- [x] 4.1 `docker/prod/php/Dockerfile` para el builder clásico (sin heredocs ni `COPY --link`), espejo de las stages de producción de `backend/Dockerfile`, con `SERVER_NAME=:80`, `RUN_MIGRATIONS=0` y `FRANKENPHP_WORKER_CONFIG="num 4"`. Verificar: `DOCKER_BUILDKIT=0 docker build -f docker/prod/php/Dockerfile .` construye, y la imagen arranca contra Postgres respondiendo `/api/health`.
- [x] 4.2 `kube/`: `00-namespace` (`absorconnect`), `01-00-php-job` (migraciones), `01-php-deployment` (3 réplicas y reparto por nodo), `02-php-service` (NodePort 30081 → 8068), `03-php-pdb`, `make-env-secret.sh` y `AGENTS.md`. Verificar: `kubectl apply --dry-run=client -f kube/` valida sin errores.
- [x] 4.3 `Jenkinsfile` según D10 (imagen `php-absorconnect-1.0.0`). Verificar: revisión de que coincide con el pipeline de Politinder salvo el worker.
- [x] 4.4 Documentación: sección de backend en el README (desarrollo, comandos, primer despliegue con los pasos manuales del propietario), `AGENTS.md` del repo y `docker/AGENTS.md`. Verificar: los comandos documentados funcionan tal cual.

## 5. Verificación

- [x] 5.1 `docker compose exec php php bin/phpunit` pasa entero.
- [x] 5.2 Prueba manual con `curl` contra el compose de desarrollo: registro, login, guardar y leer conexiones, conflicto con dos tokens, cambio de contraseña y borrado de cuenta.
- [x] 5.3 La imagen de producción (builder clásico) arranca con `RUN_MIGRATIONS=0`. El Job de migraciones (mismo comando que `01-00-php-job`) crea el esquema en un Postgres limpio, y después la API responde.
- [x] 5.4 `npm run typecheck` de la app sigue pasando y el paquete de Electron no incluye nada del backend.

## Workflow follow-up

- **Propietario:** crear la BD `absorconnect`, el Secret `absorconnect-env`, el job de Jenkins y el dominio en Cloudflare, y lanzar el primer despliegue.
- Archivar el change tras verificarlo.
