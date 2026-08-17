#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="/var/backups/seemplify"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="${BACKUP_ROOT}/${STAMP}"
LOCK_FILE="/run/lock/seemplify-backup.lock"

case "${BACKUP_ROOT}" in
  /var/backups/seemplify) ;;
  *)
    echo "Refusing to use unexpected backup root: ${BACKUP_ROOT}" >&2
    exit 1
    ;;
esac

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another Seemplify backup is already running" >&2
  exit 0
fi

mkdir -p "${DESTINATION}"
chmod 700 "${BACKUP_ROOT}" "${DESTINATION}"

cleanup_failed_backup() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    printf 'Backup failed at %s\n' "$(date -u +%FT%TZ)" >"${DESTINATION}/FAILED"
  fi
  exit "${exit_code}"
}
trap cleanup_failed_backup EXIT

require_container() {
  if ! docker inspect "$1" >/dev/null 2>&1; then
    echo "Required container is missing: $1" >&2
    exit 1
  fi
}

archive_volume() {
  local volume="$1"
  local output_name="$2"

  if ! docker volume inspect "${volume}" >/dev/null 2>&1; then
    echo "Required volume is missing: ${volume}" >&2
    exit 1
  fi

  docker run --rm \
    --volume "${volume}:/source:ro" \
    --volume "${DESTINATION}:/backup" \
    alpine:3.21 \
    tar -C /source -czf "/backup/${output_name}" .
}

require_container seemplify-shared-mongodb-1
require_container seemplify-shared-experience-postgres-1
require_container seemplify-mail-mariadb-1
require_container seemplify-shared-redis-1

docker exec seemplify-shared-mongodb-1 sh -lc \
  'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  >"${DESTINATION}/mongodb.archive.gz"

docker exec seemplify-shared-experience-postgres-1 sh -lc \
  'exec pg_dumpall --username "$POSTGRES_USER"' \
  | gzip -9 >"${DESTINATION}/experience-postgres.sql.gz"

docker exec seemplify-mail-mariadb-1 sh -lc \
  'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump --user=root --all-databases --single-transaction --routines --events --triggers' \
  | gzip -9 >"${DESTINATION}/mail-mariadb.sql.gz"

DOKPLOY_POSTGRES_CONTAINER="$(docker ps --filter name=dokploy-postgres --format '{{.Names}}' | head -n 1)"
if [[ -z "${DOKPLOY_POSTGRES_CONTAINER}" ]]; then
  echo "Dokploy PostgreSQL container is missing" >&2
  exit 1
fi
docker exec "${DOKPLOY_POSTGRES_CONTAINER}" sh -lc \
  'exec pg_dumpall --username "$POSTGRES_USER"' \
  | gzip -9 >"${DESTINATION}/dokploy-postgres.sql.gz"

docker exec seemplify-shared-redis-1 sh -lc \
  'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" SAVE >/dev/null'
docker cp seemplify-shared-redis-1:/data/dump.rdb "${DESTINATION}/shared-redis.rdb"

archive_volume seemplify-shared_qdrant_data qdrant-data.tar.gz
archive_volume seemplify-shared_weaviate_data weaviate-data.tar.gz
archive_volume seemplify-extended_chatgpt_gateway_data chatgpt-gateway-data.tar.gz
archive_volume seemplify-extended_experience_runtime experience-runtime.tar.gz
archive_volume seemplify-workspace_workspace_uploads workspace-uploads.tar.gz
archive_volume seemplify-mail_postal_config postal-config.tar.gz
archive_volume seemplify-mail_mail_api_data mail-api-data.tar.gz
archive_volume dokploy dokploy-data.tar.gz

{
  printf 'created_utc=%s\n' "$(date -u +%FT%TZ)"
  printf 'hostname=%s\n' "$(hostname --fqdn 2>/dev/null || hostname)"
  printf 'docker_version=%s\n' "$(docker version --format '{{.Server.Version}}')"
  docker ps --format 'container={{.Names}} image={{.Image}} status={{.Status}}' | sort
} >"${DESTINATION}/metadata.txt"

(
  cd "${DESTINATION}"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum >SHA256SUMS
)

ln -sfn "${STAMP}" "${BACKUP_ROOT}/latest"

find "${BACKUP_ROOT}" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -name '20??????T??????Z' \
  -mtime "+${RETENTION_DAYS}" \
  -print \
  -exec rm -rf -- {} +

trap - EXIT
printf 'Backup completed: %s\n' "${DESTINATION}"
