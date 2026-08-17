# Automation Hub and Nango deployment runbook

This runbook accompanies `automation-nango.compose.yml`. It contains names and
procedures only; it must never contain plaintext production credentials.

## Required root-only files

Create `/opt/seemplify/secrets/automation-hub` with mode `0700`. Install these
files with mode `0400`, owned by root:

- `oidc-client-secret`
- `session-secret`
- `webhook-encryption-key`
- `nango-api-key`
- `identity-hmac-secret`
- `workspace-hmac-secret`
- `payroll-hmac-secret`
- `leave-hmac-secret`
- `time-hmac-secret`
- `learning-hmac-secret`

The matching product service and Automation Hub must mount the same per-service
HMAC value. The Identity OIDC client secret must also match the generated
`automation-hub` client entry in `/opt/seemplify/secrets/idp-clients.json`.

Create `/opt/seemplify/secrets/nango` with mode `0700` and install:

- `database.env`, containing Nango Postgres database/user/password settings;
- `server.env`, containing the Nango server secret key, encryption key,
  database name/user/password, `NANGO_DASHBOARD_USERNAME`,
  `NANGO_DASHBOARD_PASSWORD`, and any release-required runtime variables. The
  encryption key must be the required base64-encoded 256-bit value and must be
  backed up before first use because Nango does not support rotating it in
  place.

Use the sibling encrypted `access` workspace for the operational inventory and
follow the repository's vault/archive procedure after any authorized credential
change. Do not add generated values to this repository or deployment logs.

## Deployment sequence

1. Create DNS for `automations.seemplifyai.com`, `nango.seemplifyai.com`, and
   `connect.seemplifyai.com` and verify they terminate through Traefik.
2. Build and publish the image from `automation-hub/Dockerfile`.
3. Generate the `automation-hub` OIDC client with
   `generate-idp-clients.sh`; install only the generated production file.
4. Install all root-only secret files and verify their ownership and modes.
5. Deploy the updated core services so Identity, Payroll, Leave, and Time have
   their HMAC mounts and automation routes.
6. Deploy `automation-nango.compose.yml` with an immutable
   `AUTOMATION_HUB_IMAGE` value.
7. In Nango, create `google-mail` and `google-drive` integrations using the
   reviewed Google OAuth clients/scopes. Do not enable providers merely because
   Nango lists them.
8. Verify Nango health, Connect UI TLS, Automation Hub health, and OIDC start.
9. Sign in through Seemplify Identity and run the acceptance checklist below.

The pinned Nango tag must be upgraded deliberately after reviewing its release
notes and upstream self-hosting configuration. Do not silently track `latest`.

## Authenticated production acceptance

- OIDC start redirects only to `auth.seemplifyai.com` and returns to the exact
  registered callback.
- A member without the Automation Hub application claim is denied.
- An owner can create and publish a reviewed R1 workflow.
- A Payroll maker can request but cannot approve their own exact R3 action.
- A different eligible reviewer can decide it and Payroll confirms the exact
  run revision/totals hash before finalization.
- Leave rejection is authoritative in Leave and creates no approved-only Time
  side effect.
- Gmail and Drive connections complete through Nango, can be verified, and
  stop working after revocation.
- Incoming webhook scope, outgoing signature/delivery history, failure retry,
  and the audit trail are visible and correct.
- Workspace/Boards/Pages recipes stay disabled until that separately deployed
  service passes its signed action-contract acceptance.

## Rollback

Pause affected workflows first. Roll back the Hub image to its previous
immutable tag without deleting `automation-data` or `nango-data`. If a provider
or product outcome is uncertain, reconcile it against the authoritative system;
never blindly repeat an R2/R3 effect. Rotate only the affected secret, update
both ends, refresh the encrypted access vault, and retain the audit database.
