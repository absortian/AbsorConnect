#!/usr/bin/env bash
# Crea o actualiza el Secret `absorconnect-env` (namespace `absorconnect`) a partir
# de backend/.env_prod, que NO está en el repo (gitignorado): por eso lo lanza una
# persona con acceso al cluster, no Jenkins. Los pods lo cargan con `envFrom`.
#
#   KUBECONFIG=~/Documents/KUBE/kubeconf kube/make-env-secret.sh
#
# Idempotente: --dry-run=client | apply actualiza el Secret en sitio. Tras cambiar
# un valor hay que reiniciar los pods (kubectl rollout restart deployment/... -n
# absorconnect o un despliegue de Jenkins): envFrom se lee al arrancar el contenedor.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=backend/.env_prod
NS=absorconnect
NAME=absorconnect-env

if [ ! -f "$ENV_FILE" ]; then
	echo "ERROR: falta $ENV_FILE (usa backend/.env como plantilla)" >&2
	exit 1
fi

# kubectl --from-env-file toma los valores tal cual (no quita comillas, Symfony sí):
# se normalizan aquí para que DATABASE_URL="..." llegue sin comillas al contenedor.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" \
	| sed -E 's/^([A-Za-z_][A-Za-z0-9_]*)="(.*)"$/\1=\2/; s/^([A-Za-z_][A-Za-z0-9_]*)='"'"'(.*)'"'"'$/\1=\2/' > "$TMP"

value() { grep -E "^$1=" "$TMP" | tail -n 1 | cut -d= -f2- || true; }

if ! grep -q '^APP_SECRET=.\{16,\}' "$TMP" || ! grep -q '^DATABASE_URL=postgres' "$TMP"; then
	echo "ERROR: $ENV_FILE necesita al menos APP_SECRET (>= 16 caracteres) y DATABASE_URL (postgresql://...)" >&2
	exit 1
fi

# La clave de las credenciales no tiene valor de desarrollo en prod: sin ella, o
# con una mal formada, la API no puede leer ni guardar conexiones. Nunca se imprime.
for key in CONNECTIONS_KEY CONNECTIONS_KEY_PREVIOUS; do
	v=$(value "$key")
	if [ -z "$v" ]; then
		[ "$key" = CONNECTIONS_KEY_PREVIOUS ] && continue
		echo "ERROR: falta $key en $ENV_FILE. Genérala con: php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'" >&2
		exit 1
	fi
	if [ "$(printf %s "$v" | base64 --decode 2>/dev/null | wc -c | tr -d ' ')" != 32 ]; then
		echo "ERROR: $key debe ser de 32 bytes en base64" >&2
		exit 1
	fi
done

# Sin proxies de confianza, todas las peticiones parecen venir de la IP del nodo y
# los límites por IP (5 registros por hora) se aplicarían a todo el mundo a la vez.
if [ -z "$(value TRUSTED_PROXIES)" ]; then
	echo "ERROR: TRUSTED_PROXIES está vacío en $ENV_FILE (ver kube/AGENTS.md, sección Configuración)" >&2
	exit 1
fi

# Toda variable de backend/.env que falte aquí conserva en el pod el valor de
# desarrollo compilado en la imagen (.env.local.php). Avisar, no fallar: hay
# variables legítimamente vacías (CONNECTIONS_KEY_PREVIOUS fuera de una rotación).
missing=$(comm -23 <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*' backend/.env | sort -u) <(cut -d= -f1 "$TMP" | sort -u) || true)
if [ -n "$missing" ]; then
	echo "AVISO: variables de backend/.env sin valor en $ENV_FILE (el pod usará el valor de desarrollo):"
	printf '  - %s\n' $missing
fi

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl apply -f kube/00-namespace.yaml
kubectl create secret generic "$NAME" -n "$NS" --from-env-file="$TMP" --dry-run=client -o yaml \
	| kubectl apply -f -

echo "Claves en $NS/$NAME:"
kubectl get secret "$NAME" -n "$NS" -o go-template='{{range $k, $v := .data}}  - {{$k}}{{"\n"}}{{end}}'
