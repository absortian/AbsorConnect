# Docker Agent Guidelines

## Desarrollo local
El backend se lanza desde los compose de la RAÍZ del repo (`compose.yaml` y
`compose.override.yaml`), NO desde este directorio. Ver el README raíz.

Servicios: `php` (FrankenPHP con la API Symfony, `backend/Dockerfile`, :8020) y
`database` (Postgres 16, :5434). Los datos viven en `./.docker/` (gitignorado).

## Producción (Kubernetes)
`docker/prod/php/Dockerfile` construye la única imagen de producción con
contexto de build = raíz del repo:

    docker build -t absortian/absortian:php-absorconnect-1.0.0 -f docker/prod/php/Dockerfile .

| Stage | Propósito |
|---|---|
| `frankenphp_base` / `frankenphp_prod_builder` | Espejo de la stage base de `backend/Dockerfile` (MANTENER EN SINCRONÍA) con rutas prefijadas `backend/`; `composer install --no-dev` y `dump-env prod` |
| `frankenphp_prod` | `debian:13-slim` + binarios frankenphp/php y sus librerías; corre como `www-data` |

RESTRICCIÓN: el agente de Jenkins compila con el builder CLÁSICO de Docker (sin
BuildKit/buildx), así que este Dockerfile NO puede usar heredocs (`RUN <<EOF`),
`#syntax`, ni `COPY --link/--exclude/--chmod`. Verificable en local con
`DOCKER_BUILDKIT=0 docker build ...`.

Convenciones:
- El `.dockerignore` de la raíz excluye todo salvo `backend/` (la raíz es la app
  de Electron) y nunca deja entrar `backend/.env_prod`. El contexto de build
  ronda los 500 KB; si crece de golpe, algo se ha colado.
- La config de producción NO se hornea: `composer dump-env prod` compila el
  `.env` versionado y en el cluster las variables reales del Secret
  `absorconnect-env` (`envFrom`) tienen prioridad. `backend/.env_prod`
  (gitignorado) es la fuente de ese Secret: `kube/make-env-secret.sh`. Ver
  `kube/AGENTS.md`.
- `RUN_MIGRATIONS=0` va como `ENV` en la stage final: en k8s solo migra el Job.
- `FRANKENPHP_WORKER_CONFIG="num 4"`: 3 pods × 4 workers = 12 conexiones como
  máximo al Postgres compartido.
