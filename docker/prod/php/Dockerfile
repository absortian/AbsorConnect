# Imagen de PRODUCCIÓN para Kubernetes (contexto de build = raíz del repo):
#   docker build -t absortian/absortian:php-absorconnect-1.0.0 -f docker/prod/php/Dockerfile .
#
# IMPORTANTE: el agente de Jenkins usa el builder CLÁSICO de Docker (sin
# BuildKit), así que este fichero no puede usar heredocs (RUN <<EOF), #syntax,
# ni COPY --link/--exclude/--chmod. Es el espejo "legacy" de la stage base de
# backend/Dockerfile (que sí usa BuildKit vía compose). La config de producción
# NO va en la imagen: la inyecta el Secret absorconnect-env
# (kube/make-env-secret.sh desde backend/.env_prod). MANTENER EN SINCRONÍA con
# backend/Dockerfile cuando cambie (bump de PHP, extensiones...).

# Versions
FROM dunglas/frankenphp:1.13.2-php8.5.12 AS frankenphp_upstream

# Base FrankenPHP image
FROM frankenphp_upstream AS frankenphp_base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

# persistent deps
RUN apt-get update && \
	apt-get install -y --no-install-recommends git && \
	install-php-extensions @composer apcu intl opcache pdo_pgsql && \
	rm -rf /var/lib/apt/lists/*

# https://getcomposer.org/doc/03-cli.md#composer-allow-superuser
ENV COMPOSER_ALLOW_SUPERUSER=1

ENV PHP_INI_SCAN_DIR=":$PHP_INI_DIR/app.conf.d"

COPY backend/frankenphp/conf.d/10-app.ini $PHP_INI_DIR/app.conf.d/
COPY backend/frankenphp/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
COPY backend/frankenphp/Caddyfile /etc/frankenphp/Caddyfile
RUN chmod 755 /usr/local/bin/docker-entrypoint

ENTRYPOINT ["docker-entrypoint"]

CMD [ "frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile" ]

# Builder for the prod FrankenPHP image
FROM frankenphp_base AS frankenphp_prod_builder

ENV APP_ENV=prod

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY backend/frankenphp/conf.d/20-app.prod.ini $PHP_INI_DIR/app.conf.d/

# prevent the reinstallation of vendors at every changes in the source code
COPY backend/composer.json backend/composer.lock backend/symfony.lock ./
RUN composer install --no-cache --prefer-dist --no-dev --no-autoloader --no-scripts --no-progress

# copy sources (el equivalente legacy de COPY --exclude=frankenphp/)
COPY backend/ ./
RUN rm -rf ./frankenphp

# Config de producción: `composer dump-env prod` compila el .env versionado (valores
# de desarrollo) en .env.local.php, pero las variables reales del contenedor ganan
# (Dotenv no pisa lo que ya existe en el entorno). En Kubernetes las pone el Secret
# absorconnect-env vía envFrom; en la imagen no queda ningún secreto.
RUN mkdir -p var/cache var/log var/share && \
	composer dump-autoload --classmap-authoritative --no-dev && \
	composer dump-env prod && \
	composer run-script --no-dev post-install-cmd && \
	chmod +x bin/console && \
	chmod -R g=u var && \
	sync

# Collect shared libraries needed by FrankenPHP and PHP extensions
RUN apt-get update && \
	apt-get install -y --no-install-recommends libtree && \
	mkdir -p /tmp/libs && \
	for target in $(which frankenphp php) \
		$(find "$(php -r 'echo ini_get("extension_dir");')" -maxdepth 2 -name "*.so"); do \
		libtree -pv "$target" 2>/dev/null | grep -oP '(?:── )\K/\S+(?= \[)' | while IFS= read -r lib; do \
			[ -f "$lib" ] && cp -n "$lib" /tmp/libs/; \
		done; \
	done; \
	rm -rf /var/lib/apt/lists/*

# Prod FrankenPHP image
FROM debian:13-slim AS frankenphp_prod

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

ENV APP_ENV=prod
ENV PHP_INI_SCAN_DIR=":/usr/local/etc/php/app.conf.d"

COPY --from=frankenphp_prod_builder /usr/local/bin/frankenphp /usr/local/bin/frankenphp
COPY --from=frankenphp_prod_builder /usr/local/bin/php /usr/local/bin/php
COPY --from=frankenphp_prod_builder /usr/local/bin/docker-php-entrypoint /usr/local/bin/docker-php-entrypoint
COPY --from=frankenphp_prod_builder /usr/local/lib/php/extensions /usr/local/lib/php/extensions
COPY --from=frankenphp_prod_builder /tmp/libs /usr/lib

COPY --from=frankenphp_prod_builder /usr/local/etc/php/conf.d /usr/local/etc/php/conf.d
COPY --from=frankenphp_prod_builder /usr/local/etc/php/php.ini /usr/local/etc/php/php.ini
COPY --from=frankenphp_prod_builder /usr/local/etc/php/app.conf.d /usr/local/etc/php/app.conf.d

COPY --from=frankenphp_prod_builder /etc/frankenphp/Caddyfile /etc/frankenphp/Caddyfile

# CA certificates for TLS
COPY --from=frankenphp_prod_builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=frankenphp_prod_builder /etc/ssl/openssl.cnf /etc/ssl/openssl.cnf

ENV OPENSSL_CONF=/etc/ssl/openssl.cnf XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

RUN mkdir -p /data/caddy /config/caddy && \
	chown -R www-data:www-data /data /config && \
	{ find / -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true; }

# El contenedor corre como www-data y debe poder bindear :80 (puerto privilegiado
# en Kubernetes/containerd). El builder clásico no preserva file capabilities en
# COPY --from, así que se aplica setcap aquí explícitamente.
RUN apt-get update && \
	apt-get install -y --no-install-recommends libcap2-bin && \
	setcap cap_net_bind_service=+ep /usr/local/bin/frankenphp && \
	apt-get purge -y libcap2-bin && \
	apt-get autoremove -y && \
	rm -rf /var/lib/apt/lists/*

# (equivalente legacy de COPY --exclude=var + COPY --chown de /app/var)
COPY --from=frankenphp_prod_builder /app /app
RUN chown -R www-data:0 /app/var && chmod -R g=u /app/var

COPY backend/frankenphp/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 755 /usr/local/bin/docker-entrypoint

# ===== Entorno de runtime para Kubernetes (los manifiestos kube/ no llevan env) =====
# HTTP plano en :80 — el TLS de https://absorconnect.absor.top termina en Cloudflare y el proxy
ENV SERVER_NAME=:80
# En k8s las migraciones las ejecuta SOLO el Job (kube/01-00-php-job.yaml), no el arranque del pod
ENV RUN_MIGRATIONS=0
# Número de workers PHP por pod, fijo en vez del 2 x nº de CPU por omisión: cada
# worker sostiene su conexión al Postgres compartido, y 3 pods x 4 workers = 12
# conexiones como máximo. De sobra para una API que solo usa la app de escritorio.
ENV FRANKENPHP_WORKER_CONFIG="num 4"

USER www-data

WORKDIR /app

ENTRYPOINT ["docker-entrypoint"]

HEALTHCHECK --start-period=60s CMD php -r 'exit(false === @file_get_contents("http://localhost:2019/metrics", context: stream_context_create(["http" => ["timeout" => 5]])) ? 1 : 0);'
CMD [ "frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile" ]
