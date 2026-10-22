# Seemplify Hostinger production runbook

## Automatic delivery after the KVM4 migration

All Seemplify component push workflows deploy canonical `main` to KVM4
`191.215.40.99` through pinned SSH and the shared production deployment lock.
The complete-release workflow starts a host-side coordinator, then releases the
only controller runner for scans and other control work while component
workflows use the build runner. Track the
`hostinger-ci/seemplify-all` GitHub commit status for completion of all nine
components, including Stanbic Frappe LMS. Its launcher success means queued;
the combined status is the complete release result. Request evidence is under
`/opt/seemplify/deploy-all/<GitHub run ID>` on KVM4.

Workspace (`Dewinsight/experienments2`) uses its durable KVM4 GitHub polling
queue while private Actions cannot start. `HOSTINGER_CI_DRIVER=local` selects
that driver and prevents duplicate native deployment jobs. It runs the existing
QA/deployment workflow and checks the exact public release; it does not deploy
untested source. Unit `hostinger-ci.service`, configuration `/etc/hostinger-ci`,
and state/private logs `/var/lib/hostinger-ci` remain on KVM4. A fresh
`HOSTINGER_CI_REQUEST` repository variable requests the current main again.
The native build runner and Workspace queue share one filesystem lease. Native
leases follow the actual runner worker process; local leases retain a recovery
marker until orphan job containers are removed after a coordinator crash.
The controller remains independent. Keep both drivers on the same lock inode
and keep the local queue at one worker when replacing runner volumes.

Milo (`michaelegbo/milo`) keeps its GitHub QA and managed Dokploy deployment.
Its restricted SSH key can request only a canonical Milo deployment. The
root-owned helper preserves existing Dokploy environment values, updates the
revision, uses the local API and verifies all three services plus public release
metadata. Model/account volumes stay attached. GitHub never receives the
Dokploy API credential. CRM remains on KVM2 `89.116.229.22` with its independent
four-lane durable GitHub deployment queue.

Daily backups now include root-only host deployment settings and a consistent
SQLite snapshot of the Workspace queue alongside existing application data.
The Stanbic image uses a pinned Frappe OCI build context under
`/opt/seemplify/build/lms-base-e703fe9`; its base builds inside the same bounded
BuildKit instance. A host-local image tag is not sufficient for that builder.
The existing site's restore-completion marker is required before automatic
redeployment; an unmarked existing site is refused instead of overwritten by
historical SQL. Complete-release API reads retry transient disconnects, while
ambiguous workflow dispatches are never automatically replayed.

## Production target

- VPS: Hostinger KVM4, ID `1903452`, `191.215.40.99` (`srv1903452`)
- Capacity: 4 vCPU, 16 GiB RAM, 200 GiB disk and 4 GiB swap
- OS: Ubuntu 24.04 LTS
- Public zone: `seemplifyai.com`
- Runtime: Docker, single-node Swarm, Dokploy and Traefik
- Server source: `/opt/seemplify/source`
- Deployment files: `/opt/seemplify/deploy/hostinger`
- Protected environment files: `/opt/seemplify/secrets` (`root:root`, mode `0600`)

Never copy protected environment values into Git, tickets, chat, screenshots or
shell history. Password SSH is disabled; use the Hostinger root SSH key.

Seemplify and Milo moved here from KVM8 on 16 October 2026. All application
databases, Docker volumes, protected configuration, Dokploy state and Milo
models were copied and verified before public DNS changed. Workspace's protected
environment must retain `WORKSPACE_ANNOUNCED_IP=191.215.40.99`, and the core
environment must retain `COTURN_EXTERNAL_IP=191.215.40.99`.

Use the two-runner `github-runner/kvm4.compose.yml` profile and the bounded
`seemplify-production` BuildKit worker. The older `kvm8` runner names and labels
remain routing aliases. They do not identify the physical host.

The former KVM8 at `179.198.192.126` has no production role. All its containers
are stopped with automatic restarts disabled and both Swarm services scaled to
zero. Its cached-DNS forwarding edge and temporary SMTP transport are retired.
The five original migration recovery archives and temporary Traefik binary were
retired on 22 October 2026 after checking that no container, process or service
depended on them, verifying the completed migration, and saving a fully
restore-tested current backup in an encrypted off-host archive. Verification
metadata remains under `/opt/seemplify-migration/kvm4-20261015`; the large bundles
are no longer needed on KVM4. Do not restart the old applications. Before deleting or
allowing the old VPS subscription to expire, retain and verify an encrypted
off-host copy of the current KVM4 backup as well.

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
| Community (staged, disabled by default) | `community.seemplifyai.com` (shared `api-workspace.seemplifyai.com` API) | Workspace stack |
| AI Interview | `api-interview.seemplifyai.com`, `interview.seemplifyai.com` | Extended apps |
| TURN credentials and Coturn | `turn.seemplifyai.com`, ports `3478` and `49152-49252` | Coturn stack |
| Postal control UI | `postal.seemplifyai.com` | Mail stack |
| Transactional Mail API | `mail-control.seemplifyai.com` | Mail stack |
| ChatGPT/Codex gateway | internal persistent service | Extended apps |

The deployed data services are MongoDB 8, Redis 7, PostgreSQL 17,
MariaDB 10.11 and Weaviate. MongoDB has a `65536`
open-file limit so bulk index restore does not exhaust descriptors.

The intentionally excluded products are diGiLog Recruiter, Auto-Mailer,
Rocket.Chat, Zulip, Mailcow and Brevo.

The Identity hub exposes only services that have a live production target.
Outline Docs and standalone Open WebUI remain hidden until their `OUTLINE_URL`
or `OPENWEBUI_URL` is configured. Workspace is deployed separately from the
core stack, and the Identity hub receives it through `MESSAGING_URL` and
`MESSAGING_API_URL`. It uses the shared ChatGPT/Codex account authority already
used by the other Seemplify applications. Experience Management opens at
`experience.seemplifyai.com`.

Community is a second, account-level lens on the same Workspace deployment. It
is dormant by default: existing production deployments do not need Community
DNS, URLs, or a secret, and the IdP client generator omits the `community`
client. Once enabled, the Identity hub receives it through `COMMUNITY_URL` and
`COMMUNITY_API_URL` and uses the separate OIDC client `community`. Store one
generated `OIDC_COMMUNITY_SECRET` value in both the protected core-apps
environment and the protected Workspace environment; never copy that value
into source. The IdP generator writes it into the root-only
`idp-clients.json`, while the Workspace backend receives the matching client
secret. Individual Community accounts may launch this app without first
creating or joining an organization; the existing Workspace launch remains
organization-, membership-, plan-, and app-access-gated.

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

Before the first Community rollout, provision `community.seemplifyai.com` at
the Workspace frontend edge and verify its DNS/TLS. Then add all four values to
the protected core-apps environment: `COMMUNITY_PRODUCTION_ENABLED=true`,
`COMMUNITY_URL=https://community.seemplifyai.com`,
`COMMUNITY_API_URL=https://api-workspace.seemplifyai.com`, and the generated
`OIDC_COMMUNITY_SECRET`. Put the matching secret in the protected Workspace
environment, regenerate `/opt/seemplify/secrets/idp-clients.json`, and recreate
Identity and Workspace. The generator fails closed if the flag is true while a
URL or secret is missing. The production smoke suite skips Community while the
flag is false; once true, it verifies Community HTTPS, its dedicated OIDC start
path, the shared API health, the Hub catalog, and the Community release
manifest.

## Deployment coordination

Each component keeps its own GitHub concurrency queue. Every upload and remote
build/deploy command also acquires `/var/lock/seemplify-production-deploy.lock`
with `flock`. The server lock is the authoritative queue across components and
repositories, so the separate Workspace deployment waits instead of competing
with a Seemplify deployment for SSH and Docker resources. Do not replace this
with one shared GitHub concurrency group: GitHub retains only one pending job
per group and cancels older pending jobs when more deployments arrive.

SSH uploads and commands use five attempts with exponential backoff. Keep the
shared behavior in `deploy/hostinger/github-actions-ssh-retry.sh`; do not add
one-off unretried `scp` or `ssh` calls to production workflows.

To redeploy every monorepo component sequentially from GitHub, run **Deploy All
Seemplify Apps to Hostinger**. To include the private Workspace repository in
the same sequence, use an authenticated GitHub CLI from this checkout:

```powershell
./deploy/hostinger/Deploy-All.ps1
```

The local orchestrator needs no stored cross-repository token and stops at the
first failed workflow.

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
- Approver serves its React application from the same protected origin as its
  API, launches the `approver` OIDC client with PKCE, provisions IdP tenants and
  consumes signed authorization-invalidation webhooks;
- the Recruiter dashboard completes organization authorization after SSO;
- Experience Management, Candidate Portal, AI Interview and the marketing
  site render without browser console errors;
- the hub uses the new Experience hostname and exposes
  working embedded attendance status and controls;
- all public API health routes, all configured OIDC start routes, the AI Interview
  feature flag, Google-relayed mail control and Postal, ChatGPT/Codex gateway,
  MongoDB, Redis, PostgreSQL, MariaDB and Weaviate dependencies;
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

Approver release `seemplify/approver:hostinger-20260817-idp` and Identity
release `seemplify/identity-provider:hostinger-20260817-approver-idp` passed the
public SPA, health, OIDC launch and seven-target signed webhook readiness checks.
Performance and Time use matching `hostinger-20260817-webhook-contract` backend
images so every receiver returns the same authenticated acknowledgement.

The IdP membership idempotency and claims-cache repair is preserved in GitHub
by merged PR `#45` (`c05578cd3c959f4cbf5f9f712761f57c78329d56`). The current
image is `seemplify/identity-provider:hostinger-20260817-approver-idp`.

Redis consumers use the stack-specific hostname `seemplify-shared-redis-1`.
Do not change it back to the generic Docker alias `redis`.
Recruiter and AI Interview must both use shared Redis database `1` for
`CV_GLOBAL_DISPATCH_REDIS_URL`; their cross-service inference limit is one
persisted fail-closed contract, not two independent queues.

Do not use only container status as an acceptance test. The smoke script checks
the Workspace and, when enabled, Community OIDC launches plus the
browser-facing API dependencies that previously allowed a healthy container to
mask a broken user journey.

## Shared AI administration

IdP system administrators can inspect platform-wide shared gateway operations
at `https://auth.seemplifyai.com/admin/shared-ai`. The page reports gateway and
queue health, logical requests and provider executions, success/failure rates,
latency, token and cost metering, failovers, app/provider/model/activity and
organisation breakdowns, request history, connected-account consent, and
gateway audit history.

The IdP calls Recruiter's read-only internal endpoint with a replay-protected
HMAC v2 signature. Both containers receive the dedicated
`AI_GATEWAY_ADMIN_ANALYTICS_SECRET` from the root-only
`/opt/seemplify/secrets/core-apps.env`. This key authorizes analytics only and
must not be added to the normal inference service allow-list.

The hosted ChatGPT gateway must also receive
`PLATFORM_AI_USAGE_SINK_URL=http://recruiter-backend:5001/api/internal/ai/v1/chatgpt-usage/events`.
The gateway keeps its volume-backed ledger as the source of truth and mirrors
sanitized, content-free usage envelopes to Recruiter so the IdP dashboard can
show app, activity, status, latency, and token history. Recreate the gateway
container after changing this value; a normal restart does not apply updated
Compose environment values.

Prompt text, generated content, CV contents, credentials, raw provider errors,
IP addresses, user agents, per-user runtime subjects, and queue job documents
are excluded from the analytics response. After changing this integration,
verify the focused contract tests, the signed internal endpoint, an
authenticated browser view, and the complete production smoke suite.

## Backups and restore testing

`seemplify-backup.timer` runs daily at 02:15 Africa/Lagos with up to 15 minutes
of randomized delay. Backups are root-only under `/var/backups/seemplify`, with
**one verified complete snapshot retained**. The previous copy remains until
the replacement passes SHA-256, compressed-stream checks and real restores into
isolated disposable databases. A failed replacement preserves the previous
`latest` pointer and good recovery copy. Unusable failed-attempt payloads are
removed after writers resume, with a bounded `last-failure.txt` diagnostic and
the service journal retained. Old good snapshots are retired only after
promotion. Shared model hardlinks remain valid in the retained snapshot.

```bash
systemctl list-timers seemplify-backup.timer
systemctl start seemplify-backup.service
journalctl -u seemplify-backup.service --since today
readlink -f /var/backups/seemplify/latest
```

Scheduled and standalone manual backups must use this service so they share
`/var/lock/seemplify-production-deploy.lock` with deployments. The service waits
up to 30 minutes for the deployment lock, then the backup script takes its own
backup lock. The daily timer cadence remains unchanged. A lock
timeout is a failed backup to investigate, not a successful snapshot.

When rebuilding/restoring a host, install the reviewed drop-in from a verified
repository checkout before enabling the backup timer:

```bash
install -d -m 755 /etc/systemd/system/seemplify-backup.service.d
install -m 644 deploy/hostinger/backup-service/production-deploy-lock.conf \
  /etc/systemd/system/seemplify-backup.service.d/production-deploy-lock.conf
systemctl daemon-reload
systemctl show seemplify-backup.service -p ExecStart -p TimeoutStartUSec
```

The drop-in preserves the existing infinite service start timeout so systemd
does not terminate a valid lock wait at its usual short default. Individual
private-file/database snapshot phases remain bounded by the backup script.
Deployment scripts that **already hold** the deployment lock call
`/usr/local/sbin/seemplify-backup` directly. They must never synchronously start
the service or add another deployment-lock acquisition inside the script:
that would deadlock. Do not run the raw script as an independent manual backup.

The backup includes native dumps of MongoDB, Experience PostgreSQL,
Dokploy PostgreSQL and MariaDB; a Redis RDB; and archives of
Weaviate, Postal, Mail API, Experience runtime, Dokploy and gateway
state, including the Workspace uploads volume. If the separately staged n8n
containers exist, it also writes a native n8n PostgreSQL dump and archives the
n8n home volume. All generated files are covered by `SHA256SUMS`.
Managed Cloudinary CVs are downloaded through the existing authenticated storage
adapter into root-only `managed-cv-backup.json`. Every CV byte hash must match
its paired MongoDB reference during restore. Local private files retain their
existing manifest and isolated restore checks. Provider credentials and signed
download URLs are never embedded in CV metadata. To recover after provider data
loss, restore the saved bytes through the storage adapter and reconcile the
resulting references before reopening assessments.

Keep the pre-n8n Automation Hub SQLite volume as a rollback asset. Record only
its Docker volume name in root-owned `/etc/seemplify/backup.env`:

```bash
LEGACY_AUTOMATION_HUB_SQLITE_VOLUME=<verified-volume-name>
N8N_BACKUP_RETENTION_DAYS=30
```

The backup service conditionally archives that complete volume, including any
SQLite WAL/SHM files. A missing n8n or legacy volume is recorded in `SKIPPED`
without failing unrelated platform backups. Backup automation never removes or
reattaches the source volumes. Separately, the Workspace-owned n8n release
script fails dark deploy and cutover unless the configured legacy volume exists
and a checksum-verified archive is produced; rollback remains best-effort.

Run an isolated, non-production restore verification with:

```bash
/usr/local/sbin/seemplify-restore-smoke
```

The restore check uses temporary containers and tmpfs storage. It verifies
checksums, restores every database, counts restored structures, validates the
Redis RDB, and removes its temporary containers on exit.

Before reopening a restored Performance database to users, verify the current
IdP policy and expire the restored Performance login sessions during a
controlled backend stop/restart. Restored session claims must not reintroduce
older grants. Retain users, appraisals, evidence and saved drafts. Reconcile
withdrawals and deletion tombstones newer than the restored snapshot before
allowing access to private evidence. Do not downgrade a newer IdP policy by
blindly starting an older application image.

Local backups do not protect against loss of the VPS. Before retiring an old
host, copy the current restore-tested backup to the private access workspace in
an AES-256 encrypted archive, verify every member against `SHA256SUMS`, and
verify the archive by decrypting and reading every member. Keep that data backup
outside Git; the encrypted access handover contains its checksum and location.
This one-time offline copy does not configure recurring off-host backups.
Configure a Cloudflare R2 destination when its credentials are issued.

### Bounded runner and deployment storage

`seemplify-runner-cache.timer` scans the build runner hourly with up to five
minutes of jitter. Above 1 GiB, its service clears only `/home/runner/.npm` using
the runner's installed npm CLI as the non-root runner user. It takes the existing
production lock and the **same compute-lock inode** used by native and local CI.
Busy workers, dependency processes, recovery markers, changed runner identity,
unexpected cache paths and missing locks prevent cleanup. Toolchains, browser
caches, checkouts, application volumes and release images are preserved.

`seemplify-storage-maintenance.timer` also bounds each derived archive category
to its newest readable tar: `release-source-archives` and
`chatgpt-gateway-deployments`. Retention runs even with ample free space. A corrupt
replacement prevents retirement; partial writes and symlinks are ignored.
The shared deployment lock excludes archive writers during retention checks.
Existing running-image and rollback-image protections stay in force.

Install from a tested checkout while holding the production deployment lock:

```bash
flock --exclusive --wait 1800 /run/lock/seemplify-production-deploy.lock \
  bash deploy/hostinger/install-storage-policy.sh
systemctl start seemplify-runner-cache.service
systemctl list-timers seemplify-runner-cache.timer seemplify-storage-maintenance.timer
```

The `Hostinger storage policy` workflow tests and installs this policy without
recreating application containers. Its deployed Git SHA is recorded in
`/opt/seemplify/deploy/hostinger/storage-policy.revision`.

On 22 October 2026, the replacement backup passed MongoDB, PostgreSQL, MariaDB,
Redis, ArangoDB, Weaviate and private-file recovery checks, including two managed
CVs and nine private references. Retention removed 18 old daily snapshots,
205 old source archives and 12 old gateway archives, retaining one complete
daily backup and one archive per deployment category. Together with retiring
the migration bundles, available disk space increased from approximately
31 GiB to 89 GiB (84% used to 54%). The encrypted off-host copy was fully
decrypted and all 31 members checked against the backup manifest. Private proof
is under the sibling access workspace's `private-storage-policy-20261022` folder;
server cleanup proof is under `/var/lib/seemplify-storage-maintenance`.

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
The `Seemplify authenticated transactional relay` rule authorizes only KVM4's
`191.215.40.99`, with IP authentication and TLS encryption required. The old
`179.198.192.126` authorization was removed on 16 October 2026 after direct
delivery from KVM4 reached Gmail Inbox with SPF, DKIM and DMARC passing.
`MAIL_API_SEND_ENABLED=true` remains active.

Postfix and Mail API resolve `smtp-relay.gmail.com` directly. They must not have
the temporary `172.31.250.1` ExtraHosts override. Both bridge service units and
the dedicated forwarding credential have been removed. KVM8 is not required
for product email. The mail workflow uses the canonical Compose file without
the legacy `mail-egress.compose.yml` override when the bridge unit is absent.

For a future server-IP change, authorize the new IP first, verify a direct
SMTP envelope with TLS and without sending DATA, then recreate Postfix and
Mail API without a tunnel override. Verify an approved delivery test and its
authentication results before revoking the old IP. Do not enable broad IP
ranges or turn off TLS to complete a migration.

Enabled sender domains are `seemplifyai.com` and `aiinnigeria.com`. Postal's
SPF, DKIM and aligned return-path checks pass for both, and controlled messages
received Google `250 2.0.0`. `dewinsight.com` is staged in Postal but remains
outside `MAIL_API_ALLOWED_DOMAINS` until its DNS zone is accessible and passes
the same checks.

The production DKIM selector used by the Seemplify sender is
`postal._domainkey.bounce.seemplifyai.com`. Postfix applies its canonical map to
the envelope sender only, preserving each application's visible
`no-reply@seemplifyai.com` From header. On 17 August 2026 a final controlled
message reached Gmail Inbox with SPF, DKIM and DMARC all passing.

Experience Management and AI Interview run with their email mode set to `send`.

## Platform integration secret permissions

Keep `/opt/seemplify/secrets/platform-integrations/experience-hmac-secret`
owned by `root:root` with mode `0640`. Recruiter runs as root. AI Interview runs
as the unprivileged `node` user and receives supplemental group `0` only so it
can read the bind-mounted HMAC file at
`/run/seemplify/platform-integration-hmac`. Do not make the host secret
world-readable and do not copy it into an image or environment variable.

Workspace uses a protocol-separated key derived from the existing pairwise OIDC
client secret that Identity exposes as `MESSAGING_OIDC_CLIENT_SECRET` and
Workspace exposes as `OIDC_CLIENT_SECRET`. Both sides require at least 32
characters and apply HKDF-SHA256 to exactly 32 bytes with fixed salt
`seemplify:workspace-platform-integration:hkdf-salt:v1` and versioned info
`seemplify:workspace-platform-integration:v1`. The raw OIDC secret is never used
as an HMAC key, and `experience-hmac-secret` is neither mounted by Workspace nor
accepted as a fallback. Deployment compares SHA-256 fingerprints of the two
OIDC inputs inside their containers without printing either fingerprint and
requires derivation version `v1` on both images.

This creates no new stored credential while encrypted-vault recovery material
is unavailable. The operational tradeoff is rotation coupling: changing the
Workspace OIDC client secret also changes this derived protocol key, so Identity
and Workspace must receive the same new OIDC value in one coordinated rollout.
`IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_SECRET_FILE` remains the preferred
future override when a direction-specific input can be created and safely added
to the encrypted vault; both sides still apply the same HKDF contract to that
file. Data backups require no new secret inventory.

Azure Speech for AI Interview is centrally configured in Identity under
**Admin → Media & Speech**. Identity encrypts the write-only provider key and
delivers it only to the `ai-interview` and `recruiter` service identities over
the signed internal configuration route.

## Retired Zulip service

Zulip was retired on 17 August 2026. Its containers and Cloudflare DNS record
were removed, it is no longer an IdP client or hub application, and production
automation must not recreate it. A final checksum-verified backup is stored in
`/var/backups/seemplify/20260817T142511Z`; its named Docker volumes remain on
the VPS temporarily for recoverability and must not be reattached without an
explicit restore decision. The inactive named volumes were removed during the
16 October 2026 cleanup after verifying their migration archive coverage.

Qdrant was retired on 16 October 2026 after verifying zero collections, no
application configuration clients and no application-code references. Its
production service, volume definition and mandatory backup dependency were
removed. Current vector search uses Weaviate; Experience knowledge services
use ArangoDB and Docling. Keep these active dependencies and the separate
Nango connectors. The `qdrant/` directory is a local development example,
not a production service.

Do not add a Brevo fallback or rotate aliases to evade quotas. See
`platform/email/docs/INTEGRATION.md` and `platform/email/docs/OPERATIONS.md` for
future-app integration, sender policy, documented Google limits, queue behavior,
security, monitoring and the custom-dashboard interface.

## Required follow-up credentials

The base applications run without these integrations, but the related features
remain disabled until the owner supplies and authorizes the credentials:

- Azure OpenAI for Approver and other AI features.
- Cloudinary for media uploads where enabled.
- Nylas for connected inbox and calendar features.
- Flutterwave and Paystack for paid Learning flows.
- Per-user ChatGPT/Codex connected-account sessions.
- Cloudflare R2 for off-host backups.

Azure Speech is configured centrally in Identity for AI Interview voice
features; retain the encrypted access-vault recovery entry during rotations.

## Administrative follow-up

- Reconnect required ChatGPT/Codex accounts through the gateway UI.
- Rotate the Cloudflare API token because an older access document contains a
  plaintext copy.
- Review and remediate the npm audit findings recorded during the build.
- Decide whether Recruiter, Performance and Time should accept the synthetic
  `system.webhook_probe` event. Their current legacy handlers reject that probe,
  while Workspace, Leave, Payroll and SmartHR accept it.
- Add Azure OpenAI and Speech only through protected server environment files.
