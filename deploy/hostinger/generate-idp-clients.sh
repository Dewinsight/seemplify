#!/usr/bin/env bash
set -euo pipefail

apps_env=${1:-/opt/seemplify/secrets/core-apps.env}
source_clients=${2:-/opt/seemplify/source/Identityprovider/clients.json}
output_clients=${3:-/opt/seemplify/secrets/idp-clients.json}

set -a
# shellcheck disable=SC1090
. "$apps_env"
set +a

output_dir=$(dirname "$output_clients")
output_name=$(basename "$output_clients")
install -d -m 700 "$output_dir"

docker run --rm \
  -e OIDC_RECRUITER_SECRET \
  -e OIDC_LEAVE_SECRET \
  -e OIDC_PERFORMANCE_SECRET \
  -e OIDC_PAYROLL_SECRET \
  -e OIDC_TIME_SECRET \
  -e OIDC_LEARNING_SECRET \
  -e OIDC_MESSAGING_SECRET \
  -e OIDC_APPROVER_SECRET \
  -e OIDC_EXPERIENCE_SECRET \
  -e OIDC_AUTOMATION_SECRET \
  -e OUTPUT_NAME="$output_name" \
  -v "$source_clients:/input/clients.json:ro" \
  -v "$output_dir:/output" \
  seemplify/identity-provider:hostinger \
  node -e '
    const fs = require("node:fs");
    const source = JSON.parse(fs.readFileSync("/input/clients.json", "utf8"));
    const secretByClient = new Map([
      ["smarthr-backend", process.env.OIDC_RECRUITER_SECRET],
      ["leave-management", process.env.OIDC_LEAVE_SECRET],
      ["performance-management", process.env.OIDC_PERFORMANCE_SECRET],
      ["payroll-management", process.env.OIDC_PAYROLL_SECRET],
      ["time-attendance", process.env.OIDC_TIME_SECRET],
      ["seemplify-learning", process.env.OIDC_LEARNING_SECRET],
      ["messaging", process.env.OIDC_MESSAGING_SECRET],
      ["approver", process.env.OIDC_APPROVER_SECRET],
      ["experience-management", process.env.OIDC_EXPERIENCE_SECRET],
      ["automation-hub", process.env.OIDC_AUTOMATION_SECRET]
    ]);
    source.clients = source.clients
      .filter((client) => secretByClient.has(client.client_id))
      .map((client) => ({ ...client, client_secret: secretByClient.get(client.client_id) }));
    fs.writeFileSync(`/output/${process.env.OUTPUT_NAME}`, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
  '

chmod 600 "$output_clients"
printf 'idp_clients=%s\n' ready
