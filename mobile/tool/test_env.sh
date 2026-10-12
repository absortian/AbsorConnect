#!/usr/bin/env bash
# Entorno para `flutter test` y las pruebas en el emulador: backend de desarrollo, servidor SSH
# de pruebas (con contraseña y con clave) y servidor S3 que valida las firmas (Versity Gateway).
#   eval "$(mobile/tool/test_env.sh)"   y después   (cd mobile && flutter test)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEYS="${TMPDIR:-/tmp}/absorconnect-test-keys"
{
  docker compose -f "$ROOT/compose.yaml" -f "$ROOT/compose.override.yaml" up -d --wait
  docker compose -f "$ROOT/compose.yaml" -f "$ROOT/compose.override.yaml" exec -T database psql -U app -d app -qc "delete from cache_items"
  docker start sftp-test 2>/dev/null || docker run -d --name sftp-test -p 2222:2222 -e USER_NAME=test -e USER_PASSWORD=test -e PASSWORD_ACCESS=true lscr.io/linuxserver/openssh-server
  docker start s3-test 2>/dev/null || docker run -d --name s3-test -p 7070:7070 -e ROOT_ACCESS_KEY=testkey -e ROOT_SECRET_KEY=testsecret-1234 versity/versitygw:latest --port :7070 posix /tmp
  docker exec s3-test mkdir -p /tmp/pruebas
  mkdir -p "$KEYS"
  [ -f "$KEYS/id_test" ] || ssh-keygen -q -t ed25519 -N frase-de-prueba -C absorconnect-test -f "$KEYS/id_test"
  for i in $(seq 1 30); do docker exec sftp-test test -d /config/.ssh && break; sleep 1; done
  docker exec -i sftp-test sh -c 'cat >> /config/.ssh/authorized_keys && chown -R test /config/.ssh' < "$KEYS/id_test.pub"
} >&2
echo "export API_TEST_URL=http://127.0.0.1:8020 SSH_TEST_PORT=2222 SSH_TEST_KEY=$KEYS/id_test S3_TEST_ENDPOINT=http://127.0.0.1:7070"
