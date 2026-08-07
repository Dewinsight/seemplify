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
- relay logs show authenticated `smtp.gmail.com:587` and Google `250 2.0.0`;
- no sustained `5xx`, bounce or complaint spike is present.

An API `202` is a queue acknowledgement, not delivery proof.

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
- Google authentication failure: stop the worker to prevent repeated attempts,
  rotate the Workspace app password in protected Dokploy configuration,
  recreate only the relay, send one test and resume the worker after `250`.
- Suspected API-key compromise: create replacement, deploy it to the product,
  revoke the old key, apply credential changes by recreating Mail API, and
  confirm old bearer `401`.
- Queue growth: stop new acceptance if necessary, retain database/spool, inspect
  Postal and relay errors, and never delete or migrate a nonempty queue.
- Backup failure: production sending may continue, but local cleanup or risky
  maintenance is blocked until a new encrypted backup passes restore validation.

Never place bearer values, Google credentials, tunnel tokens, R2 secrets or
database passwords in Git, issue comments, screenshots or deployment logs.
