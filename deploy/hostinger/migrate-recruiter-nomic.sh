#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${RECRUITER_BACKEND_IMAGE:?An exact Recruiter image is required}"
root=/opt/seemplify
proof="$root/recruiter-nomic-index-proof.json"
log="$root/recruiter-nomic-index-migration.log"
compose=(docker compose --env-file "$root/secrets/shared-infrastructure.env" --env-file "$root/secrets/core-apps.env" -f "$root/deploy/hostinger/core-apps.compose.yml")
test -s "$root/secrets/knowledge/recruiter-embedding-hmac"
# Test the private capability before interrupting the current application.
"${compose[@]}" run --interactive=false --rm --no-deps --entrypoint node recruiter-backend -e "require('./services/embeddingService').generateEmbedding('Recruiter Nomic deployment readiness probe').then(v=>{if(v.length!==768)process.exit(1);process.exit(0)}).catch(()=>process.exit(1))" >"$log" 2>&1
if [[ ! -s "$proof" ]]; then /usr/local/sbin/seemplify-backup >>"$log" 2>&1; fi
old_container=$(docker ps -aq --filter label=com.docker.compose.project=seemplify-core --filter label=com.docker.compose.service=recruiter-backend)
# A stopped API also stops its ingestion/embedding workers. Never migrate a
# moving source; fingerprints are checked again before the caller recreates it.
rollback(){ if [[ -n "$old_container" ]]; then docker start "$old_container" >/dev/null 2>&1 || true; fi; }
trap rollback ERR
"${compose[@]}" stop recruiter-backend >>"$log" 2>&1
"${compose[@]}" run --interactive=false --rm --no-deps --entrypoint node recruiter-backend scripts/migrateNomicEmbeddings.js >>"$log" 2>&1
python3 - "$log" "$proof" <<'PY'
import json,sys,os
from pathlib import Path
rows=[]
for line in Path(sys.argv[1]).read_text().splitlines():
 try:
  row=json.loads(line)
  if row.get('event')=='recruiter-nomic-index-verified':rows.append(row)
 except ValueError:pass
assert len(rows)==1 and rows[0]['originalsRetained'] is True
p=Path(sys.argv[2]);temporary=p.with_suffix('.tmp');temporary.write_text(json.dumps(rows[0],indent=2));temporary.chmod(0o600);os.replace(temporary,p)
print('Recruiter Nomic index verified: candidates=%s jobs=%s written=%s unchanged=%s' % tuple(rows[0][k] for k in ['candidates','jobs','written','unchanged']))
PY
trap - ERR
