# Seemplify Hostinger production runbook

## Production target

- VPS: `179.198.192.126` (`srv1907030`)
- OS: Ubuntu 24.04 LTS
- Public zone: `seemplifyai.com`
- Runtime: Docker, single-node Swarm, Dokploy and Traefik
- Server source: `/opt/seemplify/source`
- Deployment files: `/opt/seemplify/deploy/hostinger`
- Protected environment files: `/opt/seemplify/secrets` (`root:root`, mode `0600`)

Never copy protected environment values into Git, tickets, chat, screenshots or
shell history. Password SSH is disabled; use the Hostinger root SSH key.

## Deployed applications

| Product or service | Public hostname | Runtime |
|---|---|---|
| Marketing site | `seemplifyai.com`, `www.seemplifyai.com` | Extended apps |
| Seemplify Identity | `auth.seemplifyai.com` | Core apps |
| Recruiter API and UI | `api.seemplifyai.com`, `app.seemplifyai.com` | Core apps |
| Candidate Portal | `candidate.seemplifyai.com` | Core apps |
| Leave | `api-leave.seemplifyai.com`, `leave.seemplifyai.com` | Core apps |
| Performance | `api-performance.seemplifyai.com`, `performance.seemplifyai.com` | Core apps |
| Payroll | `api-payroll.seemplifyai.com`, `payroll.seemplifyai.com` | Core apps |
| Time and Attendance | `api-time.seemplifyai.com`, `time.seemplifyai.com` | Core apps |
| Approver | `approver.seemplifyai.com` | Core apps |
| Learning | `learning.seemplifyai.com` | Core apps |
| Experience Management | `experience.seemplifyai.com` | Extended apps |
| Workspace | `api-workspace.seemplifyai.com`, `workspace.seemplifyai.com` | Workspace stack |
| AI Interview | `api-interview.seemplifyai.com`, `interview.seemplifyai.com` | Extended apps |
| Zulip | `chat.seemplifyai.com` | Zulip stack |
| TURN credentials and Coturn | `turn.seemplifyai.com`, ports `3478` and `49152-49252` | Coturn stack |
| Postal control UI | `postal.seemplifyai.com` | Mail stack |
| Transactional Mail API | `mail-control.seemplifyai.com` | Mail stack |
| ChatGPT/Codex gateway | internal persistent service | Extended apps |

The deployed data services are MongoDB 8, Redis 7, PostgreSQL 17, Zulip
PostgreSQL 14, MariaDB 10.11, Weaviate and Qdrant. MongoDB has a `65536`
open-file limit so bulk index restore does not exhaust descriptors.

The intentionally excluded products are diGiLog Recruiter, Auto-Mailer,
Rocket.Chat, Mailcow and Brevo.

The Identity hub exposes only services that have a live production target.
Outline Docs and standalone Open WebUI remain hidden until their `OUTLINE_URL`
or `OPENWEBUI_URL` is configured. Workspace is deployed separately from the
core stack, and the Identity hub receives it through `MESSAGING_URL` and
`MESSAGING_API_URL`. It uses the shared ChatGPT/Codex account authority already
used by the other Seemplify applications. Experience Management opens at
`experience.seemplifyai.com`.

## Stack operations

Run these commands as root on the VPS.

```bash
docker compose \
  --env-file /opt/seemplify/secrets/shared-infrastructure.env \
  -f /opt/seemplify/deploy/hostinger/shared-infrastructure.compose.yml \
  up -d

docker compose \
  --env-file /opt/seemplify/secrets/shared-infrastructure.env \
  --env-file /opt/seemplify/secrets/core-apps.env \
  -f /opt/seemplify/deploy/hostinger/core-apps.compose.yml \
  up -d

docker compose \
  --env-file /opt/seemplify/secrets/shared-infrastructure.env \
  --env-file /opt/seemplify/secrets/core-apps.env \
  -f /opt/seemplify/deploy/hostinger/extended-apps.compose.yml \
  up -d

docker compose \
  --env-file /opt/seemplify/secrets/zulip.env \
  -f /opt/seemplify/deploy/hostinger/zulip.compose.yml \
  up -d

docker compose \
  --env-file /opt/seemplify/secrets/mail.env \
  -f /opt/seemplify/deploy/hostinger/mail.compose.yml \
  up -d

cd /opt/seemplify/source/coturn
docker compose \
  --env-file /opt/seemplify/secrets/core-apps.env \
  up -d

cd /opt/seemplify-workspace/source
docker compose \
  --env-file /opt/seemplify/secrets/workspace.env \
  -f docker-compose.messaging.yml \
  up -d
```

Use `--force-recreate` after a protected environment value changes. A plain
restart does not reload container environment variables.

## Health and protocol checks

Run the complete on-server check:

```bash
/usr/local/sbin/seemplify-smoke
```

From an external machine with Node.js 18 or newer, run the authenticated TURN
allocation check:

```bash
node deploy/hostinger/turn-udp-smoke.mjs
```

The TURN DNS record must remain DNS-only in Cloudflare. Web hostnames are
proxied. In particular, `workspace.seemplifyai.com` and
`api-workspace.seemplifyai.com` are proxied to make the Workspace edge
reachable from GitHub-hosted runners. All origins use Let's Encrypt
certificates through Traefik.

### Live acceptance baseline (17 August 2026)

The production acceptance pass verified:

- authenticated browser launches to the Recruiter, Leave, Performance,
  Payroll, Time & Attendance, Learning and People Transitions workspaces;
- the Recruiter dashboard completes organization authorization after SSO;
- Experience Management, Candidate Portal, AI Interview and the marketing
  site render without browser console errors;
- the hub shows nine live cards, uses the new Experience hostname and exposes
  working embedded attendance status and controls;
- Zulip serves its Seemplify OIDC login, while its first OIDC sign-in may
  auto-create the user's Zulip profile;
- all public API health routes, all five OIDC start routes, the AI Interview
  feature flag, Google-relayed mail control and Postal, ChatGPT/Codex gateway,
  MongoDB, Redis, PostgreSQL, MariaDB, Weaviate, Qdrant and Zulip dependencies;
- authenticated external UDP TURN allocation; and
- the local backup timer, an empty Postfix queue and zero failed systemd units.

Workspace release `35a180c2c3e10ebcdc65d8e52bfb324a614ec5c1` additionally
passed public HTTPS, backend health, OIDC launch, Socket.IO handshake, release
manifest, shared ChatGPT/Codex authority and external TURN allocation checks.
Automatic deployment run `32034686965` passed both QA gates and exact-release
verification. Production smoke run `32035770110` passed its three public
checks and the full authenticated IdP, dashboard, messaging, permission-aware
search and sign-out journey. The dedicated AIIN `staff` smoke identity has only
the `messaging` app grant, and its email/password are stored only as encrypted
repository secrets `MESSAGING_TEST_EMAIL` and `MESSAGING_TEST_PASSWORD`.

The IdP membership idempotency and claims-cache repair is deployed as
`seemplify/identity-provider:hostinger-20260817-membershipfix` and preserved in
GitHub by merged PR `#45` (`c05578cd3c959f4cbf5f9f712761f57c78329d56`).

Redis consumers use stack-specific hostnames (`seemplify-shared-redis-1` and
`seemplify-zulip-redis-1`). Do not change them back to the generic Docker alias
`redis`: Dokploy, shared infrastructure and Zulip all attach Redis services to
the same network, so the generic alias resolves to multiple different servers.
Recruiter and AI Interview must both use shared Redis database `1` for
`CV_GLOBAL_DISPATCH_REDIS_URL`; their cross-service inference limit is one
persisted fail-closed contract, not two independent queues.

Do not use only container status as an acceptance test. The smoke script now
checks the OIDC launches and browser-facing API dependencies that previously
allowed a healthy container to mask a broken user journey.

## Backups and restore testing

`seemplify-backup.timer` runs daily at 02:15 Africa/Lagos with up to 15 minutes
of randomized delay. Backups are root-only under `/var/backups/seemplify`, with
14-day local retention.

```bash
systemctl list-timers seemplify-backup.timer
systemctl start seemplify-backup.service
journalctl -u seemplify-backup.service --since today
readlink -f /var/backups/seemplify/latest
```

The backup includes native dumps of MongoDB, Experience PostgreSQL, Zulip
PostgreSQL, Dokploy PostgreSQL and MariaDB; a Redis RDB; and archives of Qdrant,
Weaviate, Zulip, Postal, Mail API, Experience runtime, Dokploy and gateway
state, including the Workspace uploads volume.

Run an isolated, non-production restore verification with:

```bash
/usr/local/sbin/seemplify-restore-smoke
```

The restore check uses temporary containers and tmpfs storage. It verifies
checksums, restores every database, counts restored structures, validates the
Redis RDB, and removes its temporary containers on exit.

Local backups do not protect against loss of the VPS. Configure an Azure Blob
or Cloudflare R2 destination when credentials are issued; no usable off-host
backup credential was present in the repository or access folder at migration
time.

The current Cloudflare token is DNS-only and receives HTTP `403` from the R2
bucket API. To finish R2, activate R2 without changing DNS, create a dedicated
`seemplify-hostinger-backups` bucket, then create a bucket-scoped **Object Read
& Write** R2 API token. Record its one-time Access Key ID and Secret Access Key
in the encrypted access vault, not in Git plaintext. R2 may require an account
subscription, so activation is an owner-approved billing step.

## Google Workspace SMTP activation

Inbound company mail remains on Google Workspace. Outbound product email uses:

`Mail API -> Postal -> Postfix relay -> smtp-relay.gmail.com:587`

The Google relay uses source-IP authorization, not a stored Google password.
Its allowlist contains only `179.198.192.126`; the retired Azure IP was removed
after delivery succeeded. `MAIL_API_SEND_ENABLED=true` is active.

Enabled sender domains are `seemplifyai.com` and `aiinnigeria.com`. Postal's
SPF, DKIM and aligned return-path checks pass for both, and controlled messages
received Google `250 2.0.0`. `dewinsight.com` is staged in Postal but remains
outside `MAIL_API_ALLOWED_DOMAINS` until its DNS zone is accessible and passes
the same checks.

Do not add a Brevo fallback or rotate aliases to evade quotas. See
`platform/email/docs/INTEGRATION.md` and `platform/email/docs/OPERATIONS.md` for
future-app integration, sender policy, documented Google limits, queue behavior,
security, monitoring and the custom-dashboard interface.

## Required follow-up credentials

The base applications run without these integrations, but the related features
remain disabled until the owner supplies and authorizes the credentials:

- Azure OpenAI for Approver and other Azure-hosted AI features.
- Azure Speech for AI Interview voice features.
- Cloudinary for media uploads where enabled.
- Nylas for connected inbox and calendar features.
- Flutterwave and Paystack for paid Learning flows.
- Per-user ChatGPT/Codex connected-account sessions.
- Azure Blob or Cloudflare R2 for off-host backups.

## Administrative follow-up

- Reconnect required ChatGPT/Codex accounts through the gateway UI.
- Rotate the Cloudflare API token because an older access document contains a
  plaintext copy.
- Review and remediate the npm audit findings recorded during the build.
- Decide whether Recruiter, Performance and Time should accept the synthetic
  `system.webhook_probe` event. Their current legacy handlers reject that probe,
  while Workspace, Leave, Payroll and SmartHR accept it.
- Add Azure OpenAI and Speech only through protected server environment files.
