#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

BACKUP_ROOT="/var/backups/seemplify"
LATEST_BACKUP="${SEEMPLIFY_RESTORE_BACKUP:-$(readlink -f "${BACKUP_ROOT}/latest")}"
RUN_ID="$$"
MONGO_CONTAINER="seemplify-restore-smoke-mongo-${RUN_ID}"
EXPERIENCE_CONTAINER="seemplify-restore-smoke-experience-${RUN_ID}"
DOKPLOY_CONTAINER="seemplify-restore-smoke-dokploy-${RUN_ID}"
MARIADB_CONTAINER="seemplify-restore-smoke-mariadb-${RUN_ID}"
LMS_CONTAINER="seemplify-restore-smoke-lms-${RUN_ID}"
NANGO_CONTAINER="seemplify-restore-smoke-nango-${RUN_ID}"
WEAVIATE_CONTAINER="seemplify-restore-smoke-weaviate-${RUN_ID}"
ARANGO_CONTAINER="seemplify-restore-smoke-arango-${RUN_ID}"

case "${LATEST_BACKUP}" in
  /var/backups/seemplify/20??????T??????Z) ;;
  *)
    echo "Latest backup does not resolve to an expected backup directory" >&2
    exit 1
    ;;
esac
[[ -d "${LATEST_BACKUP}" && ! -L "${LATEST_BACKUP}" ]] || { echo 'Unsafe restore snapshot' >&2; exit 1; }

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
  cleanup_container "${LMS_CONTAINER}"
  cleanup_container "${NANGO_CONTAINER}"
  cleanup_container "${ARANGO_CONTAINER}"
  cleanup_container "${WEAVIATE_CONTAINER}"
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
    --cpus 1 --memory 1536m --memory-swap 1536m \
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

# Restore private bytes only into a fresh, root-only temporary directory.
# Never extract an archive directly over the live competency bind mount.
# A real recovery must reconcile later consent withdrawals/deletion tombstones
# and retention before enabling access; this smoke test never starts the app.
timeout 300 python3 - "${LATEST_BACKUP}" <<'COMPETENCY_RESTORE_PY'
import hashlib, json, pathlib, re, shutil, stat, sys, tarfile, tempfile
backup = pathlib.Path(sys.argv[1])
archive = backup / 'competency-private.tar.gz'
manifest_path = backup / 'competency-private.manifest.json'
assert archive.exists() == manifest_path.exists(), 'Incomplete competency private backup'
if archive.exists():
    for item in (archive, manifest_path):
        assert not item.is_symlink() and item.is_file(), 'Invalid private backup file'
        assert stat.S_IMODE(item.stat().st_mode) == 0o600, 'Private backup must be mode 0600'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert manifest['schemaVersion'] == 1 and manifest['rootMode'] == 0o700
    expected = {}
    for item in manifest['files']:
        key = item['key']
        assert re.fullmatch(r'[a-fA-F0-9-]{36}', key) and key not in expected, 'Invalid private key'
        assert item['mode'] == 0o600 and isinstance(item['size'], int) and item['size'] >= 0
        assert re.fullmatch(r'[0-9a-f]{64}', item['sha256']), 'Invalid private content hash'
        expected[key] = item
    with tempfile.TemporaryDirectory(prefix='seemplify-competency-restore-') as name:
        root = pathlib.Path(name)
        root.chmod(0o700)
        assert sum(item['size'] for item in expected.values()) < shutil.disk_usage(root).free
        seen = set()
        with tarfile.open(archive, 'r:gz') as stream:
            members = stream.getmembers()
            for member in members:
                assert member.name in expected and member.name not in seen, 'Unknown/duplicate private member'
                item = expected[member.name]
                assert member.isfile() and member.mode == 0o600, 'Unsafe private member type/mode'
                assert member.size == item['size'], 'Private member size mismatch'
                seen.add(member.name)
            assert seen == set(expected), 'Private files missing from archive'
            for member in members:
                item = expected[member.name]
                target = root / member.name
                with stream.extractfile(member) as incoming, target.open('xb') as output:
                    shutil.copyfileobj(incoming, output)
                target.chmod(0o600)
                with target.open('rb') as restored:
                    assert hashlib.file_digest(restored, 'sha256').hexdigest() == item['sha256'], 'Private hash mismatch'
                assert stat.S_IMODE(target.stat().st_mode) == 0o600
        assert stat.S_IMODE(root.stat().st_mode) == 0o700
    print('competency private isolated restore ok files=' + str(len(expected)))
COMPETENCY_RESTORE_PY

python3 - "${LATEST_BACKUP}" <<'QUEUE_RESTORE_PY'
from pathlib import Path, PurePosixPath
import sqlite3
import sys
import tarfile
backup = Path(sys.argv[1])
archive = backup / 'production-configuration.tar.gz'
if archive.is_file():
    with tarfile.open(archive) as stream:
        names = set()
        for member in stream:
            path = PurePosixPath(member.name)
            assert not path.is_absolute() and '..' not in path.parts
            names.add(member.name)
        assert 'opt/seemplify/secrets/shared-infrastructure.env' in names
    print('production configuration archive validation ok')
queue = backup / 'hostinger-ci-queue.sqlite3'
if queue.is_file():
    # sqlite3.backup produced a standalone immutable snapshot. Avoid creating
    # WAL/SHM sidecars during verification of the checksum-covered directory.
    database = sqlite3.connect('file:' + str(queue) + '?mode=ro&immutable=1', uri=True)
    assert database.execute('pragma integrity_check').fetchone()[0] == 'ok'
    assert database.execute("select count(*) from sqlite_master where name='jobs'").fetchone()[0] == 1
    database.close()
    print('deployment queue snapshot validation ok')
QUEUE_RESTORE_PY

MONGO_PASSWORD="$(openssl rand -hex 24)"
docker run -d --rm \
    --cpus 1 --memory 1536m --memory-swap 1536m \
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
if [[ -f "${LATEST_BACKUP}/competency-private.manifest.json" ]]; then
  docker cp "${LATEST_BACKUP}/competency-private.manifest.json" \
    "${MONGO_CONTAINER}:/tmp/competency-private.manifest.json"
fi
if [[ -f "${LATEST_BACKUP}/managed-cv-backup.json" ]]; then
  docker cp "${LATEST_BACKUP}/managed-cv-backup.json" "${MONGO_CONTAINER}:/tmp/managed-cv-backup.json"
fi
# Metadata-only DB restoration is insufficient: every currently usable private
# reference must have matching bytes in the independently restored manifest.
# COMPETENCY_REFERENCE_CHECK_START
docker exec "${MONGO_CONTAINER}" mongosh --quiet \
  --username restore_admin --password "${MONGO_PASSWORD}" \
  --authenticationDatabase admin --eval '
    const fs = require("fs");
    const p = "/tmp/competency-private.manifest.json";
    const entries = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).files : [];
    const files = new Map(entries.map(item => [item.key, item]));
    const managedPath = "/tmp/managed-cv-backup.json";
    if (fs.existsSync(managedPath)) {
      const managed = JSON.parse(fs.readFileSync(managedPath, "utf8"));
      if (managed.schemaVersion !== 1 || !Array.isArray(managed.files)) throw Error("Invalid managed CV backup");
      for (const item of managed.files) {
        if (!item.storageKey.startsWith("cloudinary-cv:v1:") || files.has(item.storageKey)) throw Error("Invalid managed CV reference");
        const bytes = Buffer.from(item.dataBase64, "base64");
        if (require("crypto").createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw Error("Managed CV backup hash mismatch");
        files.set(item.storageKey, item);
      }
      print("managed CV backup bytes verified files=" + managed.files.length);
    }
    const database = db.getSiblingDB("performance_db");
    const now = new Date();
    const references = [
      ...database.competencyimports.find({storageKey: {$type: "string"}}, {storageKey: 1, sha256: 1}).toArray(),
      ...database.competencyevidences.find({status: "ready", storageKey: {$type: "string"}, $or: [{"retention.expiresAt": null}, {"retention.expiresAt": {$gt: now}}]}, {storageKey: 1, sha256: 1}).toArray(),
      ...database.competencyexports.find({status: "ready", expiresAt: {$gt: now}, storageKey: {$type: "string"}}, {storageKey: 1, sha256: 1}).toArray()
    ];
    for (const reference of references) {
      const file = files.get(reference.storageKey);
      if (!file || file.sha256 !== reference.sha256) throw Error("Competency private reference/hash mismatch");
    }
    print("competency restored reference integrity ok references=" + references.length);
  '
# COMPETENCY_REFERENCE_CHECK_END
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

restore_mariadb() {
  local label="$1"
  local archive="$2"
  local container="$3"
  local password table_count
  password="$(openssl rand -hex 24)"
  docker run -d --rm \
    --cpus 1 --memory 1536m --memory-swap 1536m \
    --name "${container}" \
    --network none \
    --tmpfs /var/lib/mysql:rw,nosuid,nodev,size=1g \
    --env "MARIADB_ROOT_PASSWORD=${password}" \
    mariadb:10.11 >/dev/null
  wait_for_container_command "${container}" \
    mariadb --user root --password="${password}" --execute 'SELECT 1' \
    || { echo "${label} MariaDB restore target did not become ready" >&2; exit 1; }
  sleep 2
  wait_for_container_command "${container}" \
    mariadb --user root --password="${password}" --execute 'SELECT 1' \
    || { echo "${label} MariaDB restore target did not remain ready" >&2; exit 1; }
  table_count="$(
    {
      gzip -cd "${archive}"
      printf "\nSELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','mysql','performance_schema','sys');\n"
    } | docker exec -i "${container}" \
      mariadb --batch --skip-column-names --user root --password="${password}" 2>/dev/null \
      | tail -n 1
  )"
  (( table_count > 0 )) || { echo "${label} MariaDB restore produced no application tables" >&2; exit 1; }
  printf '%s mariadb restore ok tables=%s\n' "${label}" "${table_count}"
  cleanup_container "${container}"
}

restore_mariadb mail "${LATEST_BACKUP}/mail-mariadb.sql.gz" "${MARIADB_CONTAINER}"
if [[ -f "${LATEST_BACKUP}/lms-mariadb.sql.gz" ]]; then
  restore_mariadb lms "${LATEST_BACKUP}/lms-mariadb.sql.gz" "${LMS_CONTAINER}"
fi
if [[ -f "${LATEST_BACKUP}/nango-postgres.sql.gz" ]]; then
  restore_postgres nango postgres:16.10-alpine "${LATEST_BACKUP}/nango-postgres.sql.gz" "${NANGO_CONTAINER}"
fi

docker run --rm \
  --volume "${LATEST_BACKUP}:/backup:ro" \
  redis:7.4.10-alpine3.21 \
  redis-check-rdb /backup/shared-redis.rdb >/dev/null
echo "redis rdb validation ok"

# Restore the paused RocksDB snapshot with the exact production Arango version.
# Authentication is disabled only inside this temporary network-isolated target.
docker run -d --rm --name "${ARANGO_CONTAINER}" --network none \
  --cpus 1 --memory 1536m --memory-swap 1536m \
  --tmpfs /var/lib/arangodb3:rw,nosuid,nodev,size=1g \
  --volume "${LATEST_BACKUP}/arangodb-data.tar.gz:/backup.tar.gz:ro" \
  --entrypoint /bin/sh \
  arangodb@sha256:bf5eabc0fb3a16a13d0d4de00cddfbf2209e3d25630e5331832efb206519ff8f \
  -ec 'tar -xzf /backup.tar.gz -C /var/lib/arangodb3; exec arangod --server.authentication false --vector-index --rocksdb.block-cache-size 67108864 --cache.size 67108864' >/dev/null
wait_for_container_command "${ARANGO_CONTAINER}" arangosh --server.authentication false \
  --javascript.execute-string 'require("@arangodb").db._databases()' \
  || { echo "ArangoDB snapshot did not become ready" >&2; exit 1; }
docker exec "${ARANGO_CONTAINER}" arangosh --server.authentication false \
  --javascript.execute-string '
    const db=require("@arangodb").db; let tenants=0,chunks=0,nomic=0;
    for(const name of db._databases().filter(n=>n.startsWith("exp_"))){
      db._useDatabase(name);tenants++;
      if(db._collection("chunks")) chunks+=db._collection("chunks").count();
      if(db._collection("experience_chunks_nomic_v1")){
        nomic+=db._collection("experience_chunks_nomic_v1").count();
        if(db._query("FOR c IN experience_chunks_nomic_v1 FILTER c.embeddingDimensions != 768 OR LENGTH(c.embedding) != 768 RETURN 1").toArray().length) throw Error("Invalid Nomic vectors in restored snapshot");
      }
    }
    print("arangodb restore ok tenants="+tenants+" legacy_chunks="+chunks+" nomic_chunks="+nomic);
  '
cleanup_container "${ARANGO_CONTAINER}"

# Recover the Weaviate snapshot using the exact current immutable image. This
# target has no network and no published port; anonymous access is local only.
weaviate_image=$(docker inspect --format '{{.Image}}' seemplify-shared-weaviate-1)
docker run -d --rm --name "${WEAVIATE_CONTAINER}" --network none \
  --cpus 1 --memory 1536m --memory-swap 1536m \
  --tmpfs /var/lib/weaviate:rw,nosuid,nodev,size=1g \
  --volume "${LATEST_BACKUP}/weaviate-data.tar.gz:/backup.tar.gz:ro" \
  --env AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true --env AUTHORIZATION_ADMINLIST_ENABLED=false \
  --env PERSISTENCE_DATA_PATH=/var/lib/weaviate --env DEFAULT_VECTORIZER_MODULE=none \
  --env CLUSTER_HOSTNAME=seemplify-weaviate-1 --env CLUSTER_ADVERTISE_ADDR=127.0.0.1 \
  --env RAFT_BOOTSTRAP_EXPECT=1 --env RAFT_ENABLE_ONE_NODE_RECOVERY=true --env DISABLE_TELEMETRY=true \
  --entrypoint /bin/sh "$weaviate_image" \
  -ec 'tar -xzf /backup.tar.gz -C /var/lib/weaviate; exec /bin/weaviate --host 127.0.0.1 --port 8080 --scheme http' >/dev/null
wait_for_container_command "${WEAVIATE_CONTAINER}" wget -T 3 -t 1 -qO- http://127.0.0.1:8080/v1/.well-known/ready
schema=$(docker exec "${WEAVIATE_CONTAINER}" wget -T 3 -t 1 -qO- http://127.0.0.1:8080/v1/schema)
python3 - "$WEAVIATE_CONTAINER" "$schema" <<'PY'
import json,sys,subprocess
container=sys.argv[1];schema=json.loads(sys.argv[2]);counts={}
for item in schema['classes']:
 name=item['class']
 if not name.isalnum():raise ValueError('Invalid restored class')
 query=json.dumps({'query':'{Aggregate{'+name+'{meta{count}}}}'})
 response=json.loads(subprocess.check_output(['docker','exec',container,'wget','-qO-','--header=Content-Type: application/json','--post-data='+query,'http://127.0.0.1:8080/v1/graphql']))
 assert not response.get('errors')
 counts[name]=response['data']['Aggregate'][name][0]['meta']['count']
 objects=json.loads(subprocess.check_output(['docker','exec',container,'wget','-qO-','http://127.0.0.1:8080/v1/objects?class='+name+'&limit=10000&include=vector']))['objects']
 assert len(objects)==counts[name]
 if name.startswith('Recruiter') and name.endswith('NomicV1'):
  assert all(len(obj['vector'])==768 and obj['properties']['embeddingProfile']=='nomic-embed-text-v1.5-q8-v1' for obj in objects)
assert 'Candidate' in counts and 'Job' in counts
print('weaviate restore ok '+json.dumps(counts,sort_keys=True))
PY
cleanup_container "${WEAVIATE_CONTAINER}"

echo "All backup restore smoke tests passed"
