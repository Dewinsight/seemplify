# Zero-downtime migration to Dokploy

The local `seemplify-mail` project remains the production rollback source until
the Dokploy stack has been continuously healthy for 30 minutes. Never operate
two production Mail APIs, Postal workers or production tunnel connectors.

## Deployment ownership

- Dokploy project: `seemplify`, production environment.
- Compose file: `platform/email/compose/docker-compose.dokploy.yml`.
- GitHub secret: `SEEMPLIFY_MAIL_COMPOSE_ID`.
- Public API: `https://mail-control.seemplifyai.com`.
- Last SMTP hop: authenticated `smtp.gmail.com:587` using Dew Insight Google
  Workspace.
- Inbound mail: unchanged on Google Workspace.

Copy `.env.dokploy.example` into Dokploy's protected compose environment and
fill values from the existing private runbook/runtime. Keep
`MAIL_API_SEND_ENABLED=false`, `MAIL_API_REPLICAS=0`,
`POSTAL_WORKER_REPLICAS=0`, and `MAIL_TUNNEL_REPLICAS=0` initially.

## Migration phases

1. Run `scripts/migrate/preflight.ps1`; generate a dedicated temporary key with
   `new-migration-key.ps1`. Add only its public key to the server through the
   existing controlled GitHub SSH workflow.
2. Run `export-state.ps1 -Phase staging`, transfer with `transfer-state.ps1`,
   and restore into isolated `seemplify-mail-prod_*` volumes. Verify both the
   local manifest and remote `sha256sum -c` result.
3. Start MariaDB, Postal web/SMTP and the relay. Keep Mail API, worker and
   production tunnel at zero. Use a separate staging tunnel/hostname and enable
   a single staging API only for health/authentication tests. A test worker must
   be started only long enough for one Dew Insight delivery and stopped again.
4. Confirm API authentication, invalid/revoked `401`, sending-disabled behavior,
   Postal acceptance, SMTP authentication and Google `250 2.0.0`. Stop staging
   API/worker afterward.
5. Require empty Postal and Postfix queues. Run `freeze-local.ps1 -Execute`,
   create a final snapshot, transfer and restore it. Start the Dokploy services
   in dependency order. Open only the Dokploy worker/API gates.
6. Stop the old local mail tunnel connector. Open the Dokploy connector, run
   `remote-readiness.sh --require-active`, then change the existing Cloudflare
   public hostname/CNAME to the new tunnel. The edge certificate and public API
   URL stay unchanged.
7. Test public live/ready, every existing bearer scope, Identity forgot-password,
   Recruiter onboarding and one direct API message. Require no `5xx`, Google
   `250 2.0.0`, and empty queues.
8. Run `soak.ps1`. One unhealthy or missing interval fails the soak and keeps
   rollback open. Only after it records 30 continuously healthy minutes may
   `cleanup.ps1` remove its exact allowlist.

## Rollback

Before the soak completes, stop Dokploy ingress/API/worker, drain its queues,
export remote database/API state, reverse-transfer and restore it locally,
start the local stack, restore the old Cloudflare tunnel target, and verify
public delivery. Keep Dokploy stopped. `rollback.ps1` enforces the ordering and
refuses to run after the soak journal is complete.

No cleanup command uses wildcards. It can remove only the six named local mail
containers, exactly four named volumes, an explicitly named cloudflared
connector, temporary migration material and obsolete local runtime images/env.
Unrelated Docker resources and all Xplorer/Digilog repositories are out of
scope.
