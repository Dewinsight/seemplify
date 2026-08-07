#!/usr/bin/env bash
# Restore a migration snapshot into the isolated Dokploy production volumes.
#
# Safety properties this script holds to:
#
#   * It verifies the snapshot with the host's own sha256sum before touching
#     anything, so a truncated transfer cannot become a production database.
#   * It resolves containers and volumes by Compose project label and refuses to
#     act when a target does not resolve to exactly one thing.
#   * It refuses to overwrite a volume that already holds data unless --force is
#     given, so re-running after a partial attempt cannot silently merge two
#     states.
#   * The database is restored by importing the dump into a running MariaDB, not
#     by copying a data directory, so the server's own upgrade and consistency
#     rules apply.
#   * The Postfix spool is restored only when the snapshot contains one. An
#     empty spool is not migrated at all.
#   * The MariaDB password is read inside the container from the environment
#     Compose already gave it. It is never an argument here and never logged.
#
# Usage:
#   restore-into-volumes.sh --snapshot /opt/seemplify-mail-migration/snapshots/<name> [--force] [--project seemplify-mail-prod]
set -euo pipefail

PROJECT="seemplify-mail-prod"
SNAPSHOT=""
FORCE=0
HELPER_IMAGE="alpine:3.20"

log()  { printf '[restore] %s\n' "$*"; }
ok()   { printf '[restore] OK   %s\n' "$*"; }
warn() { printf '[restore] WARN %s\n' "$*" >&2; }
die()  { printf '[restore] FATAL %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAPSHOT="${2:-}"; shift 2 ;;
    --project)  PROJECT="${2:-}"; shift 2 ;;
    --force)    FORCE=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *)          die "Unknown argument: $1" ;;
  esac
done

[ -n "$SNAPSHOT" ] || die 'Pass --snapshot <directory>.'
[ -d "$SNAPSHOT" ] || die "Snapshot directory not found: $SNAPSHOT"
command -v docker >/dev/null 2>&1 || die 'docker is not on PATH.'

MARKER="$SNAPSHOT/.restored-into-$PROJECT"

# ------------------------------------------------------------------ verify
log "Verifying $SNAPSHOT with sha256sum"
[ -f "$SNAPSHOT/SHA256SUMS" ] || die 'SHA256SUMS is missing; refusing to restore an unverifiable snapshot.'
[ -f "$SNAPSHOT/manifest.json" ] || die 'manifest.json is missing; refusing to restore an unverifiable snapshot.'
( cd "$SNAPSHOT" && sha256sum -c SHA256SUMS ) >/dev/null || die 'Checksum verification failed. Re-transfer the snapshot.'
ok 'Every file matches its checksum.'

[ -f "$SNAPSHOT/mariadb.sql.gz" ] || die 'mariadb.sql.gz is missing from the snapshot.'
[ -f "$SNAPSHOT/postal-config.tar.gz" ] || die 'postal-config.tar.gz is missing from the snapshot.'
[ -f "$SNAPSHOT/mail-api-state.tar.gz" ] || die 'mail-api-state.tar.gz is missing from the snapshot.'

if [ -f "$MARKER" ] && [ "$FORCE" -eq 0 ]; then
  ok "This snapshot was already restored into $PROJECT on $(cat "$MARKER"). Nothing to do."
  exit 0
fi

# ------------------------------------------------------------------ resolve
# Exactly one container per service, or nothing happens.
resolve_container() {
  local service="$1" names count
  names=$(docker ps --all \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${service}" \
    --format '{{.Names}}')
  count=$(printf '%s' "$names" | grep -c . || true)
  if [ "$count" -eq 0 ]; then printf ''; return 0; fi
  if [ "$count" -ne 1 ]; then
    die "Expected one container for ${PROJECT}/${service} but found ${count}. Refusing to guess."
  fi
  printf '%s' "$names"
}

volume_name() { printf '%s_%s' "$PROJECT" "$1"; }

volume_exists() { docker volume inspect "$1" >/dev/null 2>&1; }

volume_is_empty() {
  local contents
  contents=$(docker run --rm --network none -v "$1":/v:ro "$HELPER_IMAGE" sh -c 'ls -A /v 2>/dev/null | head -n 1' || true)
  [ -z "$contents" ]
}

ensure_volume() {
  local name="$1"
  if ! volume_exists "$name"; then
    log "Creating volume $name"
    docker volume create "$name" >/dev/null
  fi
}

MARIADB_CONTAINER=$(resolve_container mariadb)
[ -n "$MARIADB_CONTAINER" ] || die "No MariaDB container in project ${PROJECT}. Deploy the compose stack first, then restore."
log "MariaDB container: $MARIADB_CONTAINER"

# ------------------------------------------------------------------ quiesce
# Everything that reads Postal's configuration or the API's state directory is
# stopped for the duration. MariaDB stays up because the dump is imported
# through it.
STOPPED=""
for service in mail-api postal-worker postal-web postal-smtp; do
  container=$(resolve_container "$service")
  [ -n "$container" ] || continue
  if [ "$(docker inspect -f '{{.State.Running}}' "$container")" = "true" ]; then
    log "Stopping $container for the duration of the restore"
    docker stop --time 30 "$container" >/dev/null
    STOPPED="$STOPPED $service"
  fi
done

restart_stopped() {
  for service in $STOPPED; do
    container=$(resolve_container "$service" || true)
    [ -n "$container" ] || continue
    log "Restarting $container"
    docker start "$container" >/dev/null || warn "Could not restart $container; start it from Dokploy."
  done
}
trap 'warn "Restore did not complete; restarting whatever was stopped."; restart_stopped' EXIT

# ------------------------------------------------------------------ database
log 'Ensuring MariaDB is running'
if [ "$(docker inspect -f '{{.State.Running}}' "$MARIADB_CONTAINER")" != "true" ]; then
  docker start "$MARIADB_CONTAINER" >/dev/null
fi

log 'Waiting for MariaDB to accept connections'
deadline=$(( $(date +%s) + 180 ))
until docker exec "$MARIADB_CONTAINER" sh -c 'mariadb-admin ping --user=root --password="$MARIADB_ROOT_PASSWORD" --silent' >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || die 'MariaDB did not become ready within 180s.'
  sleep 3
done
ok 'MariaDB is accepting connections.'

log 'Importing the database dump'
# The dump carries CREATE DATABASE IF NOT EXISTS and per-table DROP TABLE IF
# EXISTS, so a repeated import converges rather than duplicating rows.
# `--password` is expanded by the container's shell from its own environment.
if ! gunzip -c "$SNAPSHOT/mariadb.sql.gz" \
  | docker exec -i "$MARIADB_CONTAINER" sh -c 'exec mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" --default-character-set=utf8mb4'; then
  die 'The database import failed. The production database is in a partial state: re-run this script once the cause is fixed, or restore from backup.'
fi
ok 'Database imported.'

log 'Confirming the imported schema is readable'
TABLE_COUNT=$(docker exec "$MARIADB_CONTAINER" sh -c \
  'mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('"'"'information_schema'"'"','"'"'performance_schema'"'"','"'"'mysql'"'"','"'"'sys'"'"')"' \
  | tr -d '[:space:]')
[ "${TABLE_COUNT:-0}" -gt 0 ] || die 'The import produced no application tables. Refusing to report success.'
ok "Imported schema holds ${TABLE_COUNT} table(s)."

# ------------------------------------------------------------------ archives
restore_archive() {
  local archive="$1" volume_suffix="$2" label="$3"
  local volume; volume=$(volume_name "$volume_suffix")

  ensure_volume "$volume"
  if ! volume_is_empty "$volume"; then
    if [ "$FORCE" -eq 0 ]; then
      die "$volume already holds data. Re-run with --force to replace it, after confirming nothing live depends on it."
    fi
    log "Clearing $volume before restore (--force)"
    docker run --rm --network none -v "$volume":/v "$HELPER_IMAGE" \
      sh -c 'find /v -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  fi

  log "Restoring $label into $volume"
  # The archive is fed on stdin, so no host path is mounted into the helper.
  docker run --rm --interactive --network none -v "$volume":/dst "$HELPER_IMAGE" \
    sh -c 'set -e; tar -xzf - -C /dst' < "$archive"

  if volume_is_empty "$volume"; then
    die "$volume is still empty after restoring $label."
  fi
  ok "$label restored."
}

restore_archive "$SNAPSHOT/postal-config.tar.gz" 'postal-config' 'Postal configuration'
restore_archive "$SNAPSHOT/mail-api-state.tar.gz" 'mail-api-data' 'Mail API state'

if [ -f "$SNAPSHOT/relay-spool.tar.gz" ]; then
  warn 'The snapshot contains a Postfix spool, which means the source spool was not empty.'
  RELAY_CONTAINER=$(resolve_container postfix-relay)
  if [ -n "$RELAY_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$RELAY_CONTAINER")" = "true" ]; then
    log "Stopping $RELAY_CONTAINER to restore its spool"
    docker stop --time 30 "$RELAY_CONTAINER" >/dev/null
    STOPPED="$STOPPED postfix-relay"
  fi
  restore_archive "$SNAPSHOT/relay-spool.tar.gz" 'relay-spool' 'Postfix spool'
  warn 'Cutover remains blocked until that spool drains on this host.'
else
  ok 'No Postfix spool in the snapshot: the source spool was empty, so nothing was migrated. This is the wanted state.'
fi

# ------------------------------------------------------------------ finish
trap - EXIT
restart_stopped

date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
chmod 600 "$MARKER"

ok "Restore into ${PROJECT} complete."
log 'The cutover gates were not changed. Postal worker, Mail API and tunnel replicas are still whatever Dokploy holds.'
log "Next: ${0%/*}/remote-readiness.sh"
