#!/usr/bin/env bash
set -euo pipefail

PROJECT="seemplify-mail-prod"; PUBLIC_URL=''; REQUIRE_ACTIVE=0; JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2;;
    --public-url) PUBLIC_URL="${2:-}"; shift 2;;
    --require-active) REQUIRE_ACTIVE=1; shift;;
    --json) JSON=1; shift;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2;;
  esac
done

service_container() {
  docker ps --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' | head -n 2
}
one() { local lines; lines="$(service_container "$1")"; [ "$(printf '%s\n' "$lines" | grep -c . || true)" -eq 1 ] && printf '%s' "$lines"; }

db="$(one mariadb || true)"; web="$(one postal-web || true)"; relay="$(one postfix-relay || true)"
api="$(one mail-api || true)"; worker="$(one postal-worker || true)"; tunnel="$(one cloudflared || true)"
base_ok=1
for pair in "mariadb:$db" "postal-web:$web" "postfix-relay:$relay"; do [ -n "${pair#*:}" ] || base_ok=0; done
active_ok=1
if [ "$REQUIRE_ACTIVE" -eq 1 ]; then
  for pair in "mail-api:$api" "postal-worker:$worker" "cloudflared:$tunnel"; do [ -n "${pair#*:}" ] || active_ok=0; done
fi
api_live=0; api_ready=0; public_ok=0
if [ -n "$api" ]; then
  docker exec "$api" node -e "fetch('http://127.0.0.1:8080/health/live').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" && api_live=1 || true
  docker exec "$api" node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" && api_ready=1 || true
fi
if [ -n "$PUBLIC_URL" ]; then curl -fsS --max-time 15 "${PUBLIC_URL%/}/health/live" >/dev/null && public_ok=1 || true; else public_ok=1; fi
ok=0; [ "$base_ok" -eq 1 ] && [ "$active_ok" -eq 1 ] && { [ "$REQUIRE_ACTIVE" -eq 0 ] || { [ "$api_live" -eq 1 ] && [ "$api_ready" -eq 1 ]; }; } && [ "$public_ok" -eq 1 ] && ok=1
if [ "$JSON" -eq 1 ]; then printf '{"ok":%s,"base":%s,"active":%s,"apiLive":%s,"apiReady":%s,"public":%s}\n' "$([ "$ok" -eq 1 ] && echo true || echo false)" "$([ "$base_ok" -eq 1 ] && echo true || echo false)" "$([ "$active_ok" -eq 1 ] && echo true || echo false)" "$([ "$api_live" -eq 1 ] && echo true || echo false)" "$([ "$api_ready" -eq 1 ] && echo true || echo false)" "$([ "$public_ok" -eq 1 ] && echo true || echo false)"; else printf 'base=%s active=%s api-live=%s api-ready=%s public=%s\n' "$base_ok" "$active_ok" "$api_live" "$api_ready" "$public_ok"; fi
[ "$ok" -eq 1 ]
