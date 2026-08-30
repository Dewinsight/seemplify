#!/usr/bin/env bash
set -euo pipefail

apps_env=${1:-/opt/seemplify/secrets/core-apps.env}
source_clients=${2:-/opt/seemplify/source/Identityprovider/clients.json}
output_clients=${3:-/opt/seemplify/secrets/idp-clients.json}

set -a
# shellcheck disable=SC1090
. "$apps_env"
set +a

case "${COMMUNITY_PRODUCTION_ENABLED:-false}" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On)
    : "${COMMUNITY_URL:?COMMUNITY_URL is required when COMMUNITY_PRODUCTION_ENABLED=true}"
    : "${COMMUNITY_API_URL:?COMMUNITY_API_URL is required when COMMUNITY_PRODUCTION_ENABLED=true}"
    : "${OIDC_COMMUNITY_SECRET:?OIDC_COMMUNITY_SECRET is required when COMMUNITY_PRODUCTION_ENABLED=true}"
    ;;
  *)
    # A stale secret must not register the client while the staged rollout is dormant.
    unset OIDC_COMMUNITY_SECRET
    ;;
esac

case "${N8N_INTEGRATION_ENABLED:-false}" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On)
    : "${OIDC_N8N_WORKSPACE_NODE_SECRET:?OIDC_N8N_WORKSPACE_NODE_SECRET is required when N8N_INTEGRATION_ENABLED=true}"
    ;;
  *)
    # Stale secrets must not register the n8n node client while integration is dormant.
    unset OIDC_N8N_WORKSPACE_NODE_SECRET
    ;;
esac

output_dir=$(dirname "$output_clients")
output_name=$(basename "$output_clients")
install -d -m 700 "$output_dir"

identity_provider_image=${IDENTITY_PROVIDER_IMAGE:-seemplify/identity-provider:hostinger}

docker run --rm \
  -e OIDC_RECRUITER_SECRET \
  -e OIDC_LEAVE_SECRET \
  -e OIDC_PERFORMANCE_SECRET \
  -e OIDC_PAYROLL_SECRET \
  -e OIDC_TIME_SECRET \
  -e OIDC_LEARNING_SECRET \
  -e OIDC_MESSAGING_SECRET \
  -e OIDC_N8N_WORKSPACE_NODE_SECRET \
  -e OIDC_COMMUNITY_SECRET \
  -e OIDC_APPROVER_SECRET \
  -e OIDC_EXPERIENCE_SECRET \
  -e OUTPUT_NAME="$output_name" \
  -v "$source_clients:/input/clients.json:ro" \
  -v "$output_dir:/output" \
  "$identity_provider_image" \
  node --input-type=module -e '
    import fs from "node:fs";
    import { materializeProductionOidcClients } from "./src/config/productionOidcClients.js";
    const source = JSON.parse(fs.readFileSync("/input/clients.json", "utf8"));
    source.clients = materializeProductionOidcClients(source.clients, {
      "smarthr-backend": process.env.OIDC_RECRUITER_SECRET,
      "leave-management": process.env.OIDC_LEAVE_SECRET,
      "performance-management": process.env.OIDC_PERFORMANCE_SECRET,
      "payroll-management": process.env.OIDC_PAYROLL_SECRET,
      "time-attendance": process.env.OIDC_TIME_SECRET,
      "seemplify-learning": process.env.OIDC_LEARNING_SECRET,
      messaging: process.env.OIDC_MESSAGING_SECRET,
      "n8n-workspace-node": process.env.OIDC_N8N_WORKSPACE_NODE_SECRET,
      community: process.env.OIDC_COMMUNITY_SECRET,
      approver: process.env.OIDC_APPROVER_SECRET,
      "experience-management": process.env.OIDC_EXPERIENCE_SECRET
    });
    fs.writeFileSync(`/output/${process.env.OUTPUT_NAME}`, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
  '

chmod 600 "$output_clients"
printf 'idp_clients=%s\n' ready
