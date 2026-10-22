#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="/var/backups/seemplify"
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

[[ ! -L "${BACKUP_ROOT}" && ! -e "${DESTINATION}" ]] || { echo 'Unsafe or existing backup destination' >&2; exit 1; }
mkdir -p "${BACKUP_ROOT}"
mkdir "${DESTINATION}"
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
    printf 'Backup failed at %s (exit %s); previous verified snapshot preserved\n' "$(date -u +%FT%TZ)" "${exit_code}" >&2
    # Failed attempts must not accumulate gigabytes while the last good copy
    # remains intact. Keep a bounded diagnostic instead of unusable payloads.
    python3 - "${BACKUP_ROOT}" "${STAMP}" "${exit_code}" <<'FAILED_BACKUP_PY'
import datetime, os, pathlib, re, shutil, sys
root, stamp = pathlib.Path(sys.argv[1]), sys.argv[2]
candidate = root / stamp
assert not root.is_symlink() and re.fullmatch(r'20\d{6}T\d{6}Z', stamp)
if (root / 'latest').resolve() != candidate.resolve():
    note = root / '.last-failure.partial'
    fd = os.open(note, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(f'{datetime.datetime.now(datetime.timezone.utc).isoformat()} candidate={stamp} exit={sys.argv[3]}\n')
    os.replace(note, root / 'last-failure.txt')
    assert candidate.is_dir() and not candidate.is_symlink() and not candidate.is_mount()
    assert candidate.resolve().parent == root.resolve()
    shutil.rmtree(candidate)
FAILED_BACKUP_PY
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

# Competency originals/PDFs are a bind mount, not a named Docker volume.
# Briefly pause only its actual running writers while pairing Mongo metadata
# with private bytes. The EXIT trap resumes them if either bounded step fails.
# These local snapshots follow the existing backup retention. Live source
# deletion does not erase older backups or third-party recording providers.
COMPETENCY_SOURCE="/opt/seemplify/data/competency"
COMPETENCY_PRESENT=false
COMPETENCY_CONTAINERS="$(docker ps -a --filter "volume=${COMPETENCY_SOURCE}" --format '{{.Names}}')"
if [[ -n "${COMPETENCY_CONTAINERS}" && ! -d "${COMPETENCY_SOURCE}" ]]; then
  echo 'Configured competency private root is missing' >&2
  exit 1
fi
if [[ -d "${COMPETENCY_SOURCE}" ]]; then
  COMPETENCY_PRESENT=true
  while IFS= read -r container; do
    [[ -n "${container}" ]] || continue
    if [[ "$(docker inspect --format '{{range .Mounts}}{{if and (eq .Source "/opt/seemplify/data/competency") .RW}}writer{{end}}{{end}}' "${container}")" == writer ]]; then
      pause_container_if_running "${container}"
    fi
  done <<<"${COMPETENCY_CONTAINERS}"
fi

timeout 300 docker exec seemplify-shared-mongodb-1 sh -lc \
  'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  >"${DESTINATION}/mongodb.archive.gz"

# Capture managed CV references while Performance writers are still paused.
# Download through the existing authenticated storage adapter after resuming;
# never put provider credentials or signed URLs in the backup metadata/logs.
timeout 60 docker exec seemplify-shared-mongodb-1 sh -lc '
  exec mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval '\''
    const now=new Date(), d=db.getSiblingDB("performance_db");
    print(JSON.stringify(d.competencyevidences.find({status:"ready",storageKey:{$regex:"^cloudinary-cv:"},$or:[{"retention.expiresAt":null},{"retention.expiresAt":{$gt:now}}]},{storageKey:1,sha256:1,_id:0}).toArray()));
  '\''
' >"${DESTINATION}/managed-cv-backup.json"

if [[ "${COMPETENCY_PRESENT}" == true ]]; then
  timeout 300 python3 - "${DESTINATION}" "${COMPETENCY_SOURCE}" <<'COMPETENCY_ARCHIVE_PY'
import hashlib, json, os, pathlib, re, stat, sys, tarfile
destination, source = map(pathlib.Path, sys.argv[1:3])
assert source.is_dir() and not source.is_symlink(), 'Invalid competency private root'
assert stat.S_IMODE(source.stat().st_mode) == 0o700, 'Competency root must be mode 0700'
manifest = {'schemaVersion': 1, 'rootMode': 0o700, 'files': []}
archive = destination / '.competency-private.tar.gz.partial'
with tarfile.open(archive, 'w:gz', dereference=False) as output:
    for item in sorted(source.iterdir()):
        details = item.lstat()
        assert re.fullmatch(r'[a-fA-F0-9-]{36}', item.name), 'Unexpected private storage key'
        assert stat.S_ISREG(details.st_mode), 'Private source must be a regular file'
        assert stat.S_IMODE(details.st_mode) == 0o600, 'Private source must be mode 0600'
        with item.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        manifest['files'].append({'key': item.name, 'size': details.st_size,
            'sha256': digest, 'mode': 0o600, 'uid': details.st_uid, 'gid': details.st_gid})
        output.add(item, arcname=item.name, recursive=False)
os.chmod(archive, 0o600)
manifest_path = destination / '.competency-private.manifest.json.partial'
with manifest_path.open('x', encoding='utf-8') as stream:
    json.dump(manifest, stream, sort_keys=True)
os.chmod(manifest_path, 0o600)
os.replace(archive, destination / 'competency-private.tar.gz')
os.replace(manifest_path, destination / 'competency-private.manifest.json')
print('competency private archive ok files=' + str(len(manifest['files'])))
COMPETENCY_ARCHIVE_PY
else
  printf 'optional_bind_skipped=%s\n' "${COMPETENCY_SOURCE}" >>"${DESTINATION}/SKIPPED"
fi
resume_paused_containers

timeout 300 docker exec -i seemplify-core-performance-backend-1 node -e '
  const crypto=require("node:crypto"), fs=require("node:fs");
  const storage=require("./services/competency/fileSafetyService");
  (async()=>{
    const references=JSON.parse(fs.readFileSync(0,"utf8")), files=[];
    if(!Array.isArray(references)||references.length>1000) throw Error("Invalid CV backup inventory");
    let total=0;
    for(const reference of references){
      const bytes=await storage.readPrivate(reference.storageKey);
      if(crypto.createHash("sha256").update(bytes).digest("hex")!==reference.sha256) throw Error("CV backup hash mismatch");
      total+=bytes.length;if(total>256*1024*1024) throw Error("CV backup exceeds bounded batch size");
      files.push({...reference,dataBase64:bytes.toString("base64")});
    }
    process.stdout.write(JSON.stringify({schemaVersion:1,files}));
  })().catch(()=>{console.error("Managed CV backup failed; previous recovery snapshot preserved");process.exit(1);});
' <"${DESTINATION}/managed-cv-backup.json" >"${DESTINATION}/.managed-cv-backup.partial"
chmod 600 "${DESTINATION}/.managed-cv-backup.partial"
mv "${DESTINATION}/.managed-cv-backup.partial" "${DESTINATION}/managed-cv-backup.json"

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

archive_consistent_volume seemplify-shared_weaviate_data weaviate-data.tar.gz
archive_consistent_volume seemplify-shared_arangodb_data arangodb-data.tar.gz
archive_consistent_volume seemplify-extended_chatgpt_gateway_data chatgpt-gateway-data.tar.gz
archive_consistent_volume seemplify-extended_experience_runtime experience-runtime.tar.gz
archive_volume seemplify-extended_knowledge_runtime_state knowledge-runtime-state.tar.gz
archive_volume seemplify-extended_knowledge_runtime_data knowledge-runtime-data.tar.gz
archive_volume_if_present seemplify-nomic-model-cache nomic-model-cache.tar.gz
archive_volume seemplify-workspace_workspace_uploads workspace-uploads.tar.gz
archive_volume seemplify-mail_postal_config postal-config.tar.gz
archive_consistent_volume seemplify-mail_mail_api_data mail-api-data.tar.gz
archive_volume dokploy dokploy-data.tar.gz

# Keep host deployment settings recoverable in the root-only backup directory.
python3 - "${DESTINATION}" <<'PY'
from pathlib import Path
import json
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
for volume in ['github-actions-runner_seemplify-worker-state',
               'github-actions-runner_control-state']:
    result = subprocess.run(['docker', 'volume', 'inspect', volume], capture_output=True, text=True)
    if result.returncode:
        continue
    mount = Path(json.loads(result.stdout)[0]['Mountpoint'])
    for name in ['.runner', '.credentials', '.credentials_rsaparams', 'hooks']:
        item = mount / name
        if item.exists():
            paths.append(str(item.relative_to('/')))
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

# Restore the candidate into disposable isolated databases before promotion.
# This helper takes no second deployment lock: the caller already owns it.
SEEMPLIFY_RESTORE_BACKUP="${DESTINATION}" timeout 1800 /usr/local/sbin/seemplify-restore-smoke

# Publish only after every byte and compressed stream has been checked. A
# failed replacement leaves the previous latest pointer and recovery copy.
python3 - "${BACKUP_ROOT}" "${STAMP}" <<'BACKUP_RETENTION_PY'
import hashlib, json, os, pathlib, re, shutil, stat, subprocess, sys

def finalize(root, stamp):
    root = pathlib.Path(root)
    if root.is_symlink() or not root.is_dir() or not re.fullmatch(r'20\d{6}T\d{6}Z', stamp):
        raise ValueError('Unsafe backup root or timestamp')
    destination = root / stamp
    if destination.is_symlink() or not destination.is_dir() or (destination / 'FAILED').exists():
        raise ValueError('Replacement backup is incomplete')
    manifest = destination / 'SHA256SUMS'
    if manifest.is_symlink() or not manifest.is_file():
        raise ValueError('Missing backup manifest')
    expected = {}
    for line in manifest.read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  \./([A-Za-z0-9_.-]+)', line)
        if not match or match[2] in expected:
            raise ValueError('Unsafe or duplicate checksum entry')
        expected[match[2]] = match[1]
    required = {'mongodb.archive.gz', 'production-configuration.tar.gz', 'metadata.txt',
                'experience-postgres.sql.gz', 'dokploy-postgres.sql.gz', 'mail-mariadb.sql.gz',
                'shared-redis.rdb', 'chatgpt-gateway-data.tar.gz', 'workspace-uploads.tar.gz', 'managed-cv-backup.json'}
    if not required.issubset(expected):
        raise ValueError('Required recovery payload missing')
    actual = {item.name for item in destination.iterdir() if item.name not in {'SHA256SUMS', 'VERIFIED.json'}}
    if actual != set(expected):
        raise ValueError('Backup manifest does not cover all files')
    for name, checksum in expected.items():
        item = destination / name
        if item.is_symlink() or not stat.S_ISREG(item.lstat().st_mode):
            raise ValueError('Backup contains a non-regular file')
        with item.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != checksum:
                raise ValueError('Backup checksum mismatch: ' + name)
        if name.endswith('.gz'):
            subprocess.run(['gzip', '-t', '--', str(item)], check=True, capture_output=True)
    proof = destination / 'VERIFIED.json'
    proof.write_text(json.dumps({'policy': 'keep-one-after-verified-replacement', 'files': len(expected),
                                 'checksumsAndCompressedStreamsVerified': True}) + '\n')
    proof.chmod(0o600)
    temporary = root / ('.latest-' + stamp)
    temporary.symlink_to(stamp)
    os.replace(temporary, root / 'latest')
    # Hardlinked models stay alive in the retained snapshot. Never traverse a
    # symlink or remove a newer directory, including an unfinished replacement.
    removed = []
    for older in sorted(root.iterdir()):
        if (re.fullmatch(r'20\d{6}T\d{6}Z', older.name) and older.name < stamp
                and not older.is_symlink() and older.is_dir()
                and older.resolve().parent == root.resolve() and not older.is_mount()):
            shutil.rmtree(older)
            removed.append(older.name)
    print(json.dumps({'verifiedBackup': stamp, 'removedOlderBackups': removed}))

if __name__ == '__main__':
    finalize(sys.argv[1], sys.argv[2])
BACKUP_RETENTION_PY

trap - EXIT
printf 'Backup completed: %s\n' "${DESTINATION}"
