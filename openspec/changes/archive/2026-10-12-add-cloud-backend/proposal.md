# Proposal

## Why

Hoy cada equipo guarda sus conexiones en local (`connections.json`), así que un usuario con varios ordenadores tiene que darlas de alta en cada uno y las pierde si pierde el equipo. Queremos que las conexiones vivan en la nube, asociadas a una **cuenta de usuario**. Este change crea el backend que lo hace posible: registro abierto con email y contraseña, sesiones por dispositivo y almacenamiento de las conexiones. La app lo usará en el change `require-account-in-app`.

## What Changes

- **Nuevo backend** en `backend/`, en este mismo repo: Symfony 8.1 + FrankenPHP + Postgres 16, con el estilo de Politinder y AbsorQuiz.
- **Cuentas:**
  - Registro abierto con email y contraseña, sin verificación de email.
  - Inicio y cierre de sesión con un token por dispositivo.
  - Cambio de contraseña, que cierra el resto de sesiones.
  - Borrado de la cuenta con todos sus datos.
- **Recuperación de contraseña:** no hay email, así que se hace por el operador con un comando de consola (`app:user:reset-password`).
- **Conexiones en la nube:** cada usuario lee y guarda su lista de conexiones y carpetas, con **control de concurrencia por revisión** (dos dispositivos no se pisan en silencio).
- **Cifrado en reposo en el servidor:** claves S3, contraseñas y passphrases se cifran con una clave propia del servicio (`CONNECTIONS_KEY`), separada de `APP_SECRET` y con soporte de rotación.
- **Protección del registro abierto:** límites de intentos de registro y de inicio de sesión, compartidos entre réplicas.
- **Despliegue como el resto de proyectos:**
  - `docker/prod/php/Dockerfile` para el builder clásico de Jenkins.
  - `kube/`: namespace `absorconnect`, Job de migraciones, Deployment con 3 réplicas, Service NodePort **30081** → **8068**, PDB y `make-env-secret.sh`.
  - `Jenkinsfile`.
  - Compose de desarrollo.
- El empaquetado de Electron excluye todo lo del backend.

## Fuera de alcance

- Cambios en la app de escritorio (change `require-account-in-app`).
- Verificación de email, recuperación de contraseña por correo y cualquier envío de correo.
- Cifrado de extremo a extremo (se decidió cifrar en el servidor).
- Panel web de administración, compartir conexiones entre usuarios, equipos u organizaciones.
- Crear el job en Jenkins y el dominio en Cloudflare: los hace el propietario.
- Crear la base de datos en el Postgres externo y el Secret de Kubernetes: son pasos manuales documentados.

## Impacto en usuarios existentes

- **Ninguno mientras la app no use el backend.** Este change no toca la app; solo excluye `backend/`, `docker/`, `kube/` y los ficheros de despliegue del paquete de Electron.

## Capabilities

### New Capabilities
- `user-accounts`: registro, inicio y cierre de sesión, sesiones por dispositivo, cambio de contraseña, borrado de cuenta, restablecimiento por el operador y límites de intentos.
- `cloud-connections`: almacenamiento por usuario de conexiones y carpetas en la nube, secretos cifrados en reposo, sincronización con revisión y validación de entradas.

### Modified Capabilities
(ninguna)

## Impact

- **Nuevo código:**
  - `backend/`: app Symfony con entidades `User`, `UserSession` y `ConnectionEntry`, controladores `/api/*`, autenticador por token, cifrado, comandos y tests PHPUnit.
  - `docker/prod/php/Dockerfile`, `kube/*`, `Jenkinsfile`, `compose.yaml`, `compose.override.yaml` y `backend/.env`. `.env_prod` y `.env.local` quedan gitignorados.
- **Existente:**
  - `electron-builder.yml`: excluir `backend/**`, `docker/**`, `kube/**`, `Jenkinsfile` y `compose*.yaml` del paquete.
  - `.gitignore`, README y `AGENTS.md`.
- **Infraestructura (manual):**
  - Base de datos `absorconnect` en `data0.absor.top:25432`.
  - Secret `absorconnect-env`.
  - Job de Jenkins.
  - Dominio en Cloudflare hacia el NodePort 30081.
