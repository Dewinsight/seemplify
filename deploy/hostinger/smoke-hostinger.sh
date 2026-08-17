#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

check_status() {
  local host="$1"
  local expected="$2"
  local actual

  actual="$(curl -sS -o /dev/null -w '%{http_code}' "https://${host}/" --max-time 20)"
  [[ "${actual}" == "${expected}" ]] || fail "${host} returned ${actual}; expected ${expected}"
  printf 'https %-38s %s\n' "${host}" "${actual}"
}

check_status_path() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local actual

  actual="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" --max-time 20)"
  [[ "${actual}" == "${expected}" ]] || fail "${label} returned ${actual}; expected ${expected}"
  printf 'health %-37s %s\n' "${label}" "${actual}"
}

while read -r host expected; do
  check_status "${host}" "${expected}"
done <<'HOSTS'
seemplifyai.com 200
www.seemplifyai.com 200
auth.seemplifyai.com 302
api.seemplifyai.com 200
app.seemplifyai.com 200
candidate.seemplifyai.com 200
workspace.seemplifyai.com 200
api-workspace.seemplifyai.com 404
api-leave.seemplifyai.com 404
leave.seemplifyai.com 200
api-performance.seemplifyai.com 404
performance.seemplifyai.com 200
api-payroll.seemplifyai.com 404
payroll.seemplifyai.com 200
api-time.seemplifyai.com 404
time.seemplifyai.com 200
approver.seemplifyai.com 200
learning.seemplifyai.com 200
experience.seemplifyai.com 200
api-interview.seemplifyai.com 404
interview.seemplifyai.com 200
mail-control.seemplifyai.com 401
postal.seemplifyai.com 302
turn.seemplifyai.com 404
HOSTS

while read -r label url expected; do
  check_status_path "${label}" "${url}" "${expected}"
done <<'HEALTH_ENDPOINTS'
recruiter https://api.seemplifyai.com/api/health 200
workspace https://api-workspace.seemplifyai.com/api/health 200
leave https://api-leave.seemplifyai.com/health 200
performance https://api-performance.seemplifyai.com/health 200
payroll https://api-payroll.seemplifyai.com/health 200
time https://api-time.seemplifyai.com/health 200
approver https://approver.seemplifyai.com/api/health 200
experience https://experience.seemplifyai.com/health 200
ai-interview https://api-interview.seemplifyai.com/health 200
HEALTH_ENDPOINTS

curl -fsS https://api-interview.seemplifyai.com/api/platform/features \
  | python3 -c 'import json, sys; assert json.load(sys.stdin)["features"]["aiInterviews"] is not False' \
  || fail "AI Interview platform availability is disabled or unreachable"
echo "ai interview platform availability ok"

oidc_issuer="$(
  curl -fsS https://auth.seemplifyai.com/.well-known/openid-configuration \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["issuer"])'
)"
[[ "${oidc_issuer}" == "https://auth.seemplifyai.com" ]] || fail "OIDC issuer mismatch"
echo "oidc discovery ok"

check_oidc_start() {
  local app="$1"
  local api_host="$2"
  local return_to="$3"
  local actual
  local redirect_url

  read -r actual redirect_url < <(
    curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
      "https://${api_host}/api/auth/oidc/start?returnTo=${return_to}" \
      --max-time 20
  )
  [[ "${actual}" == "302" ]] || fail "${app} OIDC start returned ${actual}; expected 302"
  [[ "${redirect_url}" == https://auth.seemplifyai.com/auth\?* ]] \
    || fail "${app} OIDC start did not redirect to the Seemplify identity provider"
  printf 'oidc  %-38s 302 -> auth\n' "${app}"
}

while read -r app api_host return_to; do
  check_oidc_start "${app}" "${api_host}" "${return_to}"
done <<'OIDC_APPS'
Recruiter api.seemplifyai.com https%3A%2F%2Fapp.seemplifyai.com
Workspace api-workspace.seemplifyai.com https%3A%2F%2Fworkspace.seemplifyai.com
Leave api-leave.seemplifyai.com https%3A%2F%2Fleave.seemplifyai.com
Performance api-performance.seemplifyai.com https%3A%2F%2Fperformance.seemplifyai.com
Payroll api-payroll.seemplifyai.com https%3A%2F%2Fpayroll.seemplifyai.com
Time api-time.seemplifyai.com https%3A%2F%2Ftime.seemplifyai.com
Learning learning.seemplifyai.com https%3A%2F%2Flearning.seemplifyai.com
Approver approver.seemplifyai.com https%3A%2F%2Fapprover.seemplifyai.com
Experience experience.seemplifyai.com https%3A%2F%2Fexperience.seemplifyai.com
OIDC_APPS

curl -fsS 'https://api-workspace.seemplifyai.com/socket.io/?EIO=4&transport=polling' --max-time 20 \
  | grep -q '^0{' \
  || fail "Workspace Socket.IO handshake failed"
echo "workspace realtime handshake ok"

curl -fsS https://workspace.seemplifyai.com/release.json --max-time 20 \
  | python3 -c 'import json, re, sys; release=json.load(sys.stdin); assert re.fullmatch(r"[0-9a-f]{40}", release["sha"])' \
  || fail "Workspace release manifest is missing a full Git commit SHA"
echo "workspace release manifest ok"

curl -fsS https://turn.seemplifyai.com/api/health \
  | python3 -c 'import json, sys; assert json.load(sys.stdin)["status"] == "ok"' \
  || fail "TURN credentials API is unhealthy"

turn_json="$(curl -fsS https://turn.seemplifyai.com/api/turn-credentials)"
python3 -c 'import json, sys, time; payload=json.load(sys.stdin); expiry=int(payload["username"].split(":", 1)[0]); assert expiry > int(time.time()); assert payload["credential"]' \
  <<<"${turn_json}" \
  || fail "TURN credentials are missing or expired"
echo "turn credentials api ok"

curl -fsS https://mail-control.seemplifyai.com/health/live >/dev/null \
  || fail "Mail API liveness failed"
curl -fsS https://mail-control.seemplifyai.com/health/ready >/dev/null \
  || fail "Mail API readiness failed"
echo "mail api health ok"

if docker ps --filter health=unhealthy --format '{{.Names}}' | grep -q .; then
  docker ps --filter health=unhealthy --format '{{.Names}}' >&2
  fail "unhealthy containers detected"
fi
if docker ps --filter status=restarting --format '{{.Names}}' | grep -q .; then
  docker ps --filter status=restarting --format '{{.Names}}' >&2
  fail "restarting containers detected"
fi
echo "container health ok"

docker exec seemplify-core-identity-provider-1 node --input-type=module -e '
  import("./src/config/hubApps.js").then(({ getHubApps }) => {
    const active = new Set(getHubApps().map((app) => app.appId));
    const configured = [
      ["outline", "OUTLINE_URL"],
      ["openwebui", "OPENWEBUI_URL"],
      ["messaging", "MESSAGING_URL"]
    ];
    if (configured.some(([appId, key]) => !process.env[key] && active.has(appId))) process.exit(1);
  });
' || fail "Hub exposes an app without a configured live service"
echo "hub live-app catalog ok"

echo "All Hostinger smoke tests passed"
