#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="/var/backups/seemplify"
LATEST_BACKUP="$(readlink -f "${BACKUP_ROOT}/latest")"
RUN_ID="$$"
MONGO_CONTAINER="seemplify-restore-smoke-mongo-${RUN_ID}"
EXPERIENCE_CONTAINER="seemplify-restore-smoke-experience-${RUN_ID}"
DOKPLOY_CONTAINER="seemplify-restore-smoke-dokploy-${RUN_ID}"
MARIADB_CONTAINER="seemplify-restore-smoke-mariadb-${RUN_ID}"

case "${LATEST_BACKUP}" in
  /var/backups/seemplify/20??????T??????Z) ;;
  *)
    echo "Latest backup does not resolve to an expected backup directory" >&2
    exit 1
    ;;
esac

cleanup_container() {
  local container="$1"
  case "${container}" in
    seemplify-restore-smoke-*-${RUN_ID}) docker rm -f "${container}" >/dev/null 2>&1 || true ;;
    *) echo "Refusing to clean unexpected restore container: ${container}" >&2 ;;
  esac
}

cleanup() {
  cleanup_container "${MONGO_CONTAINER}"
  cleanup_container "${EXPERIENCE_CONTAINER}"
  cleanup_container "${DOKPLOY_CONTAINER}"
  cleanup_container "${MARIADB_CONTAINER}"
}
trap cleanup EXIT
trap 'echo "Restore smoke failed at line ${LINENO}" >&2' ERR

wait_for_container_command() {
  local container="$1"
  shift
  for _ in $(seq 1 40); do
    if docker exec "${container}" "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restore_postgres() {
  local label="$1"
  local image="$2"
  local archive="$3"
  local container="$4"
  local password
  local database_count
  local table_count=0
  local database
  local current_count

  password="$(openssl rand -hex 24)"
  docker run -d --rm \
    --name "${container}" \
    --network none \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1g \
    --env "POSTGRES_PASSWORD=${password}" \
    "${image}" >/dev/null
  wait_for_container_command "${container}" pg_isready --username postgres \
    || { echo "${label} PostgreSQL did not become ready" >&2; return 1; }
  sleep 3
  wait_for_container_command "${container}" pg_isready --username postgres \
    || { echo "${label} PostgreSQL did not remain ready" >&2; return 1; }

  gzip -cd "${archive}" \
    | docker exec -i --env "PGPASSWORD=${password}" "${container}" \
      psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
      >/dev/null 2>&1 \
    || { echo "${label} PostgreSQL restore failed" >&2; return 1; }

  database_count="$(
    docker exec --env "PGPASSWORD=${password}" "${container}" \
      psql --tuples-only --no-align --username postgres --dbname postgres \
      --command "SELECT count(*) FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres';"
  )"
  while IFS= read -r database; do
    [[ -n "${database}" ]] || continue
    current_count="$(
      docker exec --env "PGPASSWORD=${password}" "${container}" \
        psql --tuples-only --no-align --username postgres --dbname "${database}" \
        --command "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"
    )"
    table_count=$((table_count + current_count))
  done < <(
    docker exec --env "PGPASSWORD=${password}" "${container}" \
      psql --tuples-only --no-align --username postgres --dbname postgres \
      --command "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres' ORDER BY datname;"
  )

  (( database_count > 0 && table_count > 0 )) \
    || { echo "${label} PostgreSQL restore produced no application data structures" >&2; return 1; }
  printf '%s restore ok databases=%s tables=%s\n' "${label}" "${database_count}" "${table_count}"
  cleanup_container "${container}"
}

(cd "${LATEST_BACKUP}" && sha256sum --check --quiet SHA256SUMS)
for archive in "${LATEST_BACKUP}"/*.gz; do
  gzip -t "${archive}"
done
echo "checksums and compressed archives ok"

MONGO_PASSWORD="$(openssl rand -hex 24)"
docker run -d --rm \
  --name "${MONGO_CONTAINER}" \
  --network none \
  --ulimit nofile=65536:65536 \
  --tmpfs /data/db:rw,nosuid,nodev,size=1g \
  --env MONGO_INITDB_ROOT_USERNAME=restore_admin \
  --env "MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}" \
  mongo:8.0.28-noble >/dev/null
wait_for_container_command "${MONGO_CONTAINER}" \
  mongosh --quiet --username restore_admin --password "${MONGO_PASSWORD}" \
  --authenticationDatabase admin --eval 'db.adminCommand({ping: 1}).ok' \
  || { echo "MongoDB restore target did not become ready" >&2; exit 1; }
docker exec -i "${MONGO_CONTAINER}" sh -lc \
  'exec mongorestore --username restore_admin --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  <"${LATEST_BACKUP}/mongodb.archive.gz" >/dev/null 2>&1
MONGO_DATABASES="$(
  docker exec "${MONGO_CONTAINER}" mongosh --quiet \
    --username restore_admin --password "${MONGO_PASSWORD}" \
    --authenticationDatabase admin \
    --eval 'db.adminCommand({listDatabases: 1}).databases.filter((item) => !["admin", "config", "local"].includes(item.name)).length'
)"
(( MONGO_DATABASES > 0 )) || { echo "MongoDB restore produced no application databases" >&2; exit 1; }
printf 'mongodb restore ok databases=%s\n' "${MONGO_DATABASES}"
cleanup_container "${MONGO_CONTAINER}"

restore_postgres \
  experience \
  postgres:17.10-alpine3.23 \
  "${LATEST_BACKUP}/experience-postgres.sql.gz" \
  "${EXPERIENCE_CONTAINER}"

restore_postgres \
  dokploy \
  'postgres:16@sha256:11a9d238fbb48bab14599c57e41123254452b1a2d93c6c8595bce96f346bd082' \
  "${LATEST_BACKUP}/dokploy-postgres.sql.gz" \
  "${DOKPLOY_CONTAINER}"

MARIADB_PASSWORD="$(openssl rand -hex 24)"
docker run -d --rm \
  --name "${MARIADB_CONTAINER}" \
  --network none \
  --tmpfs /var/lib/mysql:rw,nosuid,nodev,size=1g \
  --env "MARIADB_ROOT_PASSWORD=${MARIADB_PASSWORD}" \
  mariadb:10.11 >/dev/null
wait_for_container_command "${MARIADB_CONTAINER}" \
  mariadb --user root --password="${MARIADB_PASSWORD}" --execute 'SELECT 1' \
  || { echo "MariaDB restore target did not become ready" >&2; exit 1; }
sleep 2
wait_for_container_command "${MARIADB_CONTAINER}" \
  mariadb --user root --password="${MARIADB_PASSWORD}" --execute 'SELECT 1' \
  || { echo "MariaDB restore target did not remain ready" >&2; exit 1; }
MARIADB_TABLES="$(
  {
    gzip -cd "${LATEST_BACKUP}/mail-mariadb.sql.gz"
    printf "\nSELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','mysql','performance_schema','sys');\n"
  } | docker exec -i "${MARIADB_CONTAINER}" \
    mariadb --batch --skip-column-names --user root --password="${MARIADB_PASSWORD}" 2>/dev/null \
    | tail -n 1
)"
(( MARIADB_TABLES > 0 )) || { echo "MariaDB restore produced no application tables" >&2; exit 1; }
printf 'mariadb restore ok tables=%s\n' "${MARIADB_TABLES}"
cleanup_container "${MARIADB_CONTAINER}"

docker run --rm \
  --volume "${LATEST_BACKUP}:/backup:ro" \
  redis:7.4.10-alpine3.21 \
  redis-check-rdb /backup/shared-redis.rdb >/dev/null
echo "redis rdb validation ok"

echo "All backup restore smoke tests passed"
