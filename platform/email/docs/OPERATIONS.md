# Mail operations and incident response

## Routine health

Dokploy health checks and `restart: unless-stopped` own process recovery. The
Cloudflare connector reconnects after a container or server restart. Control
Center reads the unchanged public Mail API for live/ready, analytics, events,
suppressions and credential usage.

Healthy means:

- `/health/live` and `/health/ready` return `200` with no blocked gates;
- exactly one production Mail API, Postal worker and tunnel connector run;
- Postal and Postfix queues are readable and empty after normal processing;
- relay logs show `smtp-relay.gmail.com:587` and Google `250 2.0.0`;
- no sustained `5xx`, bounce or complaint spike is present.

An API `202` is a queue acknowledgement, not delivery proof.

## Queue, throughput and scaling

The delivery path has two durable queue boundaries:

1. Postal stores accepted messages and per-recipient queue entries in MariaDB.
2. Postfix retains messages in its spool while Google is temporarily unavailable.

The Hostinger deployment currently runs one Postal worker with two threads.
The Mail API accepts a 60-request burst and sustains 2 requests/second per key,
which is a theoretical 172,800 single-recipient API calls per day. That is an
intake ceiling, not a delivery SLA. Google quotas, recipient-domain throttling,
bounces, reputation and the single-host worker are the practical boundaries.

Google documents the following SMTP relay ceilings for a paid Workspace
organization: 4.6 million non-unique recipients per 24 hours, 319,444
recipients per rolling 10 minutes, 10,000 messages and 10,000 unique recipients
per registered Workspace user per 24 hours, and 100 recipients per SMTP
transaction. Trial accounts have lower limits and Google may reduce limits in
response to sending practices. The envelope sender, not `From` or `Reply-To`,
is used for per-user counting. See
<https://support.google.com/a/answer/2956491>.

Ramp a new domain conservatively and watch bounce, complaint, deferral and spam
placement before increasing volume. Do not use alias rotation to evade quotas.
When measured demand exceeds the current worker, benchmark first, then increase
Postal worker replicas/threads and the Mail API rate limit in controlled steps.
The VPS has ample CPU/RAM, but scaling must preserve MariaDB and Google relay
headroom.

## Security and monitoring

- Traefik provides origin TLS and Cloudflare protects the public control hosts.
- The final Google hop requires TLS and authorizes only the Hostinger public IP.
- Application bearers are stored only in protected server environments and only
  their SHA-256 hashes are kept by the Mail API. New applications must receive
  separate `send` credentials; rotate any migration-era shared credential to
  per-application keys without interrupting delivery.
- Idempotency, per-key rate limits, request-size limits, header-injection
  rejection and recipient suppressions protect the send endpoint.
- Recipient identities in operational storage are salted hashes plus masked
  display values.
- Webhook HMAC, timestamp tolerance and nonce replay protection secure event
  intake.
- SPF, domain-specific Postal DKIM, DMARC and aligned return paths are required
  before a domain enters `MAIL_API_ALLOWED_DOMAINS`.
- `/v1/metrics?format=prometheus` exposes counters, delivery rates and
  suppression totals to an authenticated collector. Postal also exposes local
  worker/SMTP health and Prometheus endpoints; keep them on the private Docker
  network. See <https://docs.postalserver.io/features/health-metrics/>.
- Postal webhooks report sent, delayed, failed, held and bounced events. See
  <https://docs.postalserver.io/developer/webhooks/>.

Alert on readiness failure, queue growth, relay `4xx/5xx`, sustained API `5xx`,
bounce/complaint spikes, disk pressure and backup failure. Postal's existing UI
is the first-line message inspector; the custom Seemplify dashboard described
in `INTEGRATION.md` should consume only the protected Mail API.

## Backups

The `mail-backup` profile creates a consistent MariaDB dump plus Postal config
and Mail API state, hashes the plaintext payload, archives it, encrypts it with
an offline-held age public key, hashes the encrypted object and uploads only the
encrypted object to R2. The decrypting age identity never resides on Dokploy.

1. Configure an R2 bucket/token and `BACKUP_AGE_RECIPIENT` in protected Dokploy
   environment. Confirm the account remains inside its chosen free allowance;
   the repository does not enable or purchase an R2 feature.
2. Run one manual backup and restore it with `backup/restore.sh` into an empty
   inspection directory. The restore script verifies encrypted and decrypted
   hashes and does not alter live volumes.
3. Explicitly apply `backup/lifecycle.sh --apply`; it refuses retention other
   than 14 days.
4. Install the nightly systemd timer with
   `scripts/linux/install-backup-timer.sh --install`.

Cloudflare documents lifecycle rules and the S3-compatible lifecycle API at
<https://developers.cloudflare.com/r2/buckets/object-lifecycles/>. Tunnel image
releases are checked against <https://github.com/cloudflare/cloudflared/releases>
before updating the pinned `MAIL_TUNNEL_IMAGE` value.

## Incident response

- Public API down: inspect Dokploy container health and cloudflared metrics;
  restart the compose deployment, then verify live/ready. Do not change DNS
  until the target is healthy.
- Google relay rejection: stop the worker to prevent repeated attempts, confirm
  the Google SMTP relay still allows only `179.198.192.126`, confirm TLS, recreate
  the relay, send one test and resume the worker after `250`. Production uses IP
  authorization and does not store a Google SMTP password.
- Suspected API-key compromise: create replacement, deploy it to the product,
  revoke the old key, apply credential changes by recreating Mail API, and
  confirm old bearer `401`.
- Queue growth: stop new acceptance if necessary, retain database/spool, inspect
  Postal and relay errors, and never delete or migrate a nonempty queue.
- Backup failure: production sending may continue, but local cleanup or risky
  maintenance is blocked until a new encrypted backup passes restore validation.

Never place bearer values, Google credentials, tunnel tokens, R2 secrets or
database passwords in Git, issue comments, screenshots or deployment logs.

## Production verification record (17 August 2026)

- Identity, Recruiter, Leave, Performance, Payroll, Time, Approver, Learning,
  Experience Management, AI Interview and Workspace each submitted a controlled
  message with its deployed Mail API credential; all 11 requests returned `202`
  and all 11 messages reached the test mailbox.
- The real AI Interview invitation function and Experience Management password
  reset workflow both reached the test mailbox through Postal and Google.
- Zulip's built-in email test delivered both its normal and no-reply variants
  through the private Postfix relay.
- `postal._domainkey.bounce.seemplifyai.com` publishes Postal's public DKIM key.
  A post-propagation message from `no-reply@seemplifyai.com` reached Inbox with
  SPF, DKIM and DMARC all passing.
- Postfix rewrites only the SMTP envelope sender for Google authorization. It
  preserves the visible application `From` header and its Postal signature.
- The relay queue was empty after verification and Mail API live/readiness both
  returned `200` with no blocked gates.

An application credential/transport test does not execute every business email
template. When releasing a new mail-producing workflow, test its real action in
addition to the shared transport checks above.
