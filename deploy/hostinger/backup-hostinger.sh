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

PAUSED_CONTAINERS=()

resume_paused_containers() {
  local index container
  for ((index=${#PAUSED_CONTAINERS[@]} - 1; index >= 0; index--)); do
    container="${PAUSED_CONTAINERS[$index]}"
    docker unpause "${container}" >/dev/null 2>&1 || true
  done
  PAUSED_CONTAINERS=()
}

pause_container_if_running() {
  local container="$1"
  if [[ "$(docker inspect --format '{{.State.Status}}' "${container}" 2>/dev/null || true)" == running ]]; then
    docker pause "${container}" >/dev/null
    PAUSED_CONTAINERS+=("${container}")
  fi
}

pause_volume_writers() {
  local volume="$1"
  local container
  while IFS= read -r container; do
    [[ -n "${container}" ]] && pause_container_if_running "${container}"
  done < <(docker ps --filter "volume=${volume}" --format '{{.Names}}' | sort -u)
}

cleanup_failed_backup() {
  local exit_code=$?
  resume_paused_containers
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

archive_volume_if_present() {
  local volume="$1"
  local output_name="$2"

  if ! docker volume inspect "${volume}" >/dev/null 2>&1; then
    printf 'optional_volume_skipped=%s\n' "${volume}" >>"${DESTINATION}/SKIPPED"
    return 0
  fi
  archive_volume "${volume}" "${output_name}"
}

archive_consistent_volume() {
  local volume="$1"
  local output_name="$2"
  pause_volume_writers "${volume}"
  archive_volume "${volume}" "${output_name}"
  resume_paused_containers
}

require_container seemplify-shared-mongodb-1
require_container seemplify-shared-experience-postgres-1
require_container seemplify-mail-mariadb-1
require_container seemplify-shared-redis-1
require_container seemplify-shared-arangodb-1

docker exec seemplify-shared-mongodb-1 sh -lc \
  'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  >"${DESTINATION}/mongodb.archive.gz"

docker exec seemplify-shared-experience-postgres-1 sh -lc \
  'exec pg_dumpall --username "$POSTGRES_USER"' \
  | gzip -9 >"${DESTINATION}/experience-postgres.sql.gz"

docker exec seemplify-mail-mariadb-1 sh -lc \
  'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump --user=root --all-databases --single-transaction --routines --events --triggers' \
  | gzip -9 >"${DESTINATION}/mail-mariadb.sql.gz"

# Connectors and LMS are independent databases, not part of the Experience
# or Postal dump. Include both when those optional stacks are deployed.
if [[ "$(docker inspect --format '{{.State.Status}}' seemplify-connectors-nango-db-1 2>/dev/null || true)" == running ]]; then
  docker exec seemplify-connectors-nango-db-1 sh -lc \
    'exec pg_dumpall --username "$POSTGRES_USER"' \
    | gzip -9 >"${DESTINATION}/nango-postgres.sql.gz"
fi
if [[ "$(docker inspect --format '{{.State.Status}}' seemplify-lms-db-1 2>/dev/null || true)" == running ]]; then
  docker exec seemplify-lms-db-1 sh -lc \
    'MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}" exec mariadb-dump --user=root --all-databases --single-transaction --routines --events --triggers' \
    | gzip -9 >"${DESTINATION}/lms-mariadb.sql.gz"
  archive_consistent_volume seemplify-lms_lms-sites lms-sites.tar.gz
fi
if docker volume inspect milo-web-s0mht6_milo_codex_accounts >/dev/null 2>&1; then
  archive_consistent_volume milo-web-s0mht6_milo_codex_accounts milo-codex-accounts.tar.gz
fi
if [[ -d /opt/milo/models ]]; then
  # Model weights are large and usually immutable. Retain each snapshot's
  # archive while sharing its inode when a content manifest is unchanged.
  python3 - "${DESTINATION}" "${BACKUP_ROOT}/latest" <<'PY'
import hashlib, json, os, pathlib, stat, subprocess, sys
destination = pathlib.Path(sys.argv[1])
previous = pathlib.Path(sys.argv[2]).resolve()
root = pathlib.Path('/opt/milo/models')
manifest = []
for path in sorted(root.rglob('*')):
    details = path.lstat()
    item = {'path': str(path.relative_to(root)), 'mode': stat.S_IMODE(details.st_mode),
            'uid': details.st_uid, 'gid': details.st_gid}
    if path.is_symlink():
        item['link'] = os.readlink(path)
    elif path.is_file():
        item['size'] = details.st_size
        with path.open('rb') as stream:
            item['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest.append(item)
manifest_file = destination / 'milo-models.manifest.json'
manifest_file.write_text(json.dumps(manifest, sort_keys=True))
prior_manifest = previous / manifest_file.name
prior_archive = previous / 'milo-models.tar.gz'
archive = destination / prior_archive.name
if (previous.parent == destination.parent and previous != destination
        and prior_manifest.is_file() and prior_archive.is_file()
        and prior_manifest.read_bytes() == manifest_file.read_bytes()):
    os.link(prior_archive, archive)
else:
    subprocess.run(['tar', '-C', '/opt/milo', '-czf', str(archive), 'models'], check=True)
PY
fi

# n8n is staged independently from the core stack, so its backup is
# conditional. When present, use a native PostgreSQL dump and preserve its home
# volume. Neither the n8n volumes nor the legacy Automation Hub volume are ever
# removed by this script.
N8N_POSTGRES_CONTAINER="seemplify-automations-n8n-db-1"
N8N_APP_CONTAINER="seemplify-automations-n8n-1"
pause_container_if_running "${N8N_APP_CONTAINER}"
if [[ "$(docker inspect --format '{{.State.Status}}' "${N8N_POSTGRES_CONTAINER}" 2>/dev/null || true)" == running ]]; then
  docker exec "${N8N_POSTGRES_CONTAINER}" sh -lc \
    'exec pg_dump --format=custom \
      --username "$(cat /run/seemplify/n8n/database-user)" \
      --dbname "$(cat /run/seemplify/n8n/database-name)"' \
    >"${DESTINATION}/n8n-postgres.dump"
else
  printf 'optional_container_skipped=%s\n' "${N8N_POSTGRES_CONTAINER}" >>"${DESTINATION}/SKIPPED"
fi
archive_volume_if_present seemplify-automations_n8n-home n8n-home.tar.gz
resume_paused_containers

if [[ -n "${LEGACY_AUTOMATION_HUB_SQLITE_VOLUME:-}" ]]; then
  if [[ ! "${LEGACY_AUTOMATION_HUB_SQLITE_VOLUME}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "Refusing invalid legacy Automation Hub volume name" >&2
    exit 1
  fi
  pause_volume_writers "${LEGACY_AUTOMATION_HUB_SQLITE_VOLUME}"
  archive_volume_if_present \
    "${LEGACY_AUTOMATION_HUB_SQLITE_VOLUME}" \
    legacy-automation-hub-sqlite.tar.gz
  resume_paused_containers
else
  printf 'optional_volume_unconfigured=LEGACY_AUTOMATION_HUB_SQLITE_VOLUME\n' >>"${DESTINATION}/SKIPPED"
fi

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

archive_volume seemplify-shared_weaviate_data weaviate-data.tar.gz
archive_volume seemplify-shared_arangodb_data arangodb-data.tar.gz
archive_consistent_volume seemplify-extended_chatgpt_gateway_data chatgpt-gateway-data.tar.gz
archive_consistent_volume seemplify-extended_experience_runtime experience-runtime.tar.gz
archive_volume seemplify-extended_knowledge_runtime_state knowledge-runtime-state.tar.gz
archive_volume seemplify-extended_knowledge_runtime_data knowledge-runtime-data.tar.gz
archive_volume seemplify-workspace_workspace_uploads workspace-uploads.tar.gz
archive_volume seemplify-mail_postal_config postal-config.tar.gz
archive_consistent_volume seemplify-mail_mail_api_data mail-api-data.tar.gz
archive_volume dokploy dokploy-data.tar.gz

# Keep host deployment settings recoverable in the root-only backup directory.
python3 - "${DESTINATION}" <<'PY'
from pathlib import Path
import sqlite3
import subprocess
import sys
destination = Path(sys.argv[1])
paths = ['opt/seemplify/secrets', 'opt/seemplify/deploy/hostinger',
         'opt/seemplify/github-actions-runner',
         'etc/dokploy/traefik', 'etc/seemplify', 'etc/hostinger-ci',
         'opt/hostinger-ci', 'etc/systemd/system/hostinger-ci.service',
         'etc/systemd/system/seemplify-mail-egress-bridge.service',
         'etc/ssh/sshd_config.d', 'root/.ssh/authorized_keys',
         'usr/local/sbin/milo-github-deploy.py']
paths = [name for name in paths if Path('/' + name).exists()]
subprocess.run(['tar', '--acls', '--xattrs', '--numeric-owner',
                '--exclude=__pycache__', '-C', '/', '-czf',
                str(destination / 'production-configuration.tar.gz')] + paths, check=True)
queue = Path('/var/lib/hostinger-ci/queue.sqlite3')
if queue.is_file():
    source = sqlite3.connect('file:' + str(queue) + '?mode=ro', uri=True)
    target = sqlite3.connect(destination / 'hostinger-ci-queue.sqlite3')
    source.backup(target)
    assert target.execute('pragma integrity_check').fetchone()[0] == 'ok'
    target.close()
    source.close()
PY

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
