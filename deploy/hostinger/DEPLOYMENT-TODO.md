# Hostinger production deployment

Target: `179.198.192.126` (`srv1907030`)

## Completed

- [x] Verify Hostinger VPS ownership and key-based root SSH.
- [x] Harden SSH, enable UFW, Fail2ban, unattended upgrades and swap.
- [x] Install Docker, initialize single-node Swarm and install Dokploy.
- [x] Clone the Seemplify source and build the new AI Interview images.
- [x] Refactor the central mail relay to support Google Workspace IP relay.
- [x] Exclude diGiLog Recruiter, Auto-Mailer, Rocket.Chat, Zulip, Mailcow and Brevo.
- [x] Provision and health-check MongoDB, Redis, Weaviate, Qdrant and PostgreSQL.
- [x] Deploy Identity, Recruiter, Candidate Portal, Leave, Performance, Payroll and Time.
- [x] Deploy Approver, Learning, Marketing, Experience Management and AI Interview.
- [x] Deploy Coturn with a direct, DNS-only TURN record.
- [x] Deploy the ChatGPT/Codex gateway with persistent account-session storage.
- [x] Deploy the Mail API, Postal, MariaDB and Google Workspace relay chain.
- [x] Cut the production Cloudflare app records to Hostinger.
- [x] Issue and verify public HTTPS certificates for every web hostname.
- [x] Install a root-only daily backup job with 14-day local retention.
- [x] Complete and checksum the first full backup.
- [x] Restore-test MongoDB, Experience PostgreSQL, Dokploy PostgreSQL, MariaDB and Redis in isolation.
- [x] Run public HTTPS, OIDC and authenticated external TURN smoke tests.
- [x] Write the production operations and recovery runbook.
- [x] Complete Dokploy administrator registration, create its API key and close direct port `3000`.
- [x] Authorize the Hostinger IP in Google Workspace and remove the retired relay IP.
- [x] Enable outbound Mail API sending and verify Google `250 2.0.0` delivery.
- [x] Configure and verify Postal/SPF/DKIM/return-path sending for `seemplifyai.com` and `aiinnigeria.com`.
- [x] Remove retired Brevo DNS authentication records from accessible zones.
- [x] Add tested multi-domain Mail API allowlisting and future-app integration documentation.
- [x] Browser-test every live hub application with the production Identity session.
- [x] Fix Recruiter OIDC issuer configuration and populated-organization authorization, then deploy a versioned backend image.
- [x] Fix the AI Interview browser API/WebSocket origin and CSP configuration.
- [x] Restore the hub Time & Attendance panel with a shared, protected signing secret.
- [x] Point Experience Management at `experience.seemplifyai.com` and hide unconfigured Outline, Open WebUI and Workspace cards.
- [x] Extend the repeatable smoke suite with API health, all seven OIDC launch routes, AI Interview availability, hub catalog and restart checks.
- [x] Deploy Workspace on Hostinger with IdP OIDC, Coturn, mediasoup UDP, shared ChatGPT/Codex authority and protected runtime secrets.
- [x] Add GitHub Actions QA and SSH-based automatic Workspace deployment.
- [x] Add Workspace HTTPS, health, OIDC, realtime and release checks to the
  platform smoke suite and pass the full suite.
- [x] Include the Workspace uploads volume in daily backups and verify a real
  backup archive and checksum.
- [x] Remove the shared Docker-network `redis` alias collision, authenticate
  Recruiter's enrichment worker, and pin AI Interview to shared Redis.
- [x] Align Recruiter and AI Interview on one shared Redis database and verify
  both services register in the same zero-active-lease dispatch contract.
- [x] Fix IdP membership idempotency and claims-cache invalidation, deploy the
  versioned Identity image, and preserve the repair in GitHub PR `#45`.
- [x] Create a dedicated non-administrator AIIN Workspace smoke identity with
  only `messaging` access and store its credentials as encrypted GitHub
  secrets.
- [x] Proxy the Workspace web and API records through Cloudflare while keeping
  the TURN record DNS-only.
- [x] Pass the authenticated production Workspace journey through IdP login,
  dashboard, messaging, permission-aware search and sign-out on release
  `35a180c2c3e10ebcdc65d8e52bfb324a614ec5c1`.
- [x] Switch Experience Management and AI Interview from log-only email to
  production send mode and verify their real password-reset/invitation flows.
- [x] Retire Zulip from Docker, Cloudflare DNS, the IdP hub/client registry,
  deployment automation, backup automation and email documentation while
  preserving a checksum-verified final backup and detached data volumes.
- [x] Preserve visible Seemplify sender headers with envelope-only relay rewrite,
  publish the Postal DKIM selector and verify Gmail Inbox authentication.
- [x] Test deployed Mail API credentials for Identity, Recruiter, Leave,
  Performance, Payroll, Time, Approver, Learning, Experience, AI Interview and
  Workspace; all 11 controlled submissions were accepted and received.

## In progress

- [ ] Reconnect each required ChatGPT/Codex user account.
- [ ] Activate/approve Cloudflare R2 billing, create `seemplify-hostinger-backups`, issue a bucket-scoped Object Read & Write token, and connect/restore-test off-host backups. The existing DNS token has no R2 permission.
- [ ] Gain DNS access to `dewinsight.com`, publish its Postal DKIM and return path, then add it to the sender allowlist.
- [ ] Decide the compatibility policy for legacy webhook handlers that reject
  `system.webhook_probe`.

## External credentials still required or pending rotation for full feature coverage

- Choose and rotate a dedicated Azure OpenAI credential before enabling it in production; active local credentials were found but are not yet approved for Seemplify production reuse.
- Azure Speech credentials for AI Interview voice features were not found.
- Rotate or replace the active local Cloudinary credential before enabling media uploads in production.
- Rotate or replace the active local Nylas credential before enabling connected inbox/calendar features in production.
- Flutterwave and Paystack credentials for paid Learning flows.
- Per-user ChatGPT/Codex connected-account sessions.
- Cloudflare R2 credentials for off-host backups.
- DNS-management access for `dewinsight.com`.
