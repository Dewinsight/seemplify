#!/usr/bin/env bash
# Report what the mail queues currently hold, on either the local or the
# production Compose project.
#
# An empty Postfix spool and an empty Postal queue are cutover gates: a message
# sitting in either has been accepted from a product but not yet handed to
# Google, and moving or retiring the stack under it would strand it.
#
# Usage:
#   queue-inspect.sh [--project seemplify-mail-prod] [--require-empty] [--json]
#
# Exit codes: 0 queues empty (or --require-empty not given), 1 not empty,
# 2 the queues could not be read — which is never treated as "empty".
set -euo pipefail

PROJECT="seemplify-mail-prod"
REQUIRE_EMPTY=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --require-empty) REQUIRE_EMPTY=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

resolve_container() {
  local service="$1" names count
  names=$(docker ps --all \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${service}" \
    --filter 'status=running' \
    --format '{{.Names}}')
  count=$(printf '%s' "$names" | grep -c . || true)
  [ "$count" -eq 1 ] || { printf ''; return 0; }
  printf '%s' "$names"
}

postfix_entries=""
postfix_state="unavailable"
RELAY=$(resolve_container postfix-relay)
if [ -n "$RELAY" ]; then
  # `postqueue -p` prints one leading line per queued message, each starting
  # with the queue id. Counting those is more reliable than looking for the
  # "Mail queue is empty" banner alone.
  report=$(docker exec "$RELAY" sh -c 'postqueue -p 2>&1 || true')
  postfix_entries=$(printf '%s\n' "$report" | grep -cE '^[0-9A-F]{5,}[*!]?[[:space:]]' || true)
  postfix_state="read"
fi

postal_queued=""
postal_state="unavailable"
MARIADB=$(resolve_container mariadb)
if [ -n "$MARIADB" ]; then
  if total=$(docker exec "$MARIADB" sh -c '
      set -e
      dbs=$(mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B -e "SHOW DATABASES" \
            | grep -Ev "^(information_schema|performance_schema|mysql|sys)$")
      sum=0
      for db in $dbs; do
        n=$(mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B -D "$db" \
            -e "SELECT COUNT(*) FROM queued_messages" 2>/dev/null || echo 0)
        sum=$((sum + n))
      done
      printf "%s\n" "$sum"
    ' 2>/dev/null); then
    postal_queued=$(printf '%s' "$total" | tr -d '[:space:]')
    postal_state="read"
  fi
fi

if [ "$JSON" -eq 1 ]; then
  printf '{"project":"%s","postfix":{"state":"%s","entries":%s},"postal":{"state":"%s","queued":%s}}\n' \
    "$PROJECT" "$postfix_state" "${postfix_entries:-null}" "$postal_state" "${postal_queued:-null}"
else
  printf 'project:  %s\n' "$PROJECT"
  printf 'postfix:  %s (%s entries)\n' "$postfix_state" "${postfix_entries:-?}"
  printf 'postal:   %s (%s queued)\n' "$postal_state" "${postal_queued:-?}"
fi

[ "$REQUIRE_EMPTY" -eq 1 ] || exit 0

# An unreadable queue is not an empty queue.
if [ "$postfix_state" != "read" ] || [ "$postal_state" != "read" ]; then
  printf 'Queue depth could not be read; refusing to report the gate as passed.\n' >&2
  exit 2
fi
if [ "${postfix_entries:-1}" -ne 0 ] || [ "${postal_queued:-1}" -ne 0 ]; then
  printf 'Queues are not empty; the cutover gate is closed.\n' >&2
  exit 1
fi
printf 'Queues are empty; the cutover gate is open.\n'
exit 0
