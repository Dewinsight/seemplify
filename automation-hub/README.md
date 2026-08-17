# Seemplify Automation Hub

The Automation Hub is Seemplify's organization-scoped workflow engine. It
coordinates typed internal product actions and external provider actions while
leaving each product as the authority for its own records and state changes.

## What is implemented

- canonical, versioned event and action catalogues;
- reviewed workflow templates for Workspace/Boards, onboarding, Payroll,
  Leave/Time, and Pages/Google Drive;
- semantic compilation that rejects incompatible subjects, unsafe approval
  placement, missing connections, external data-boundary violations, and
  unbounded loops;
- immutable published workflow versions, run/attempt history, idempotency,
  retry classification, unknown-outcome reconciliation, caps, and audit;
- exact R3 approvals bound to an action, canonical payload hash, entity
  revision, expiry, and maker-checker policy;
- Seemplify Identity OIDC login and live organization/app authorization in
  production; test actors exist only when `NODE_ENV=test`;
- signed, replay-protected internal action calls and authoritative outcome IDs;
- Nango-backed connection enablement, Connect sessions, verification,
  revocation, and a constrained provider proxy;
- reviewed Gmail send and Google Drive create/update adapters;
- scoped incoming webhook URLs and signed outgoing event subscriptions with
  retry history and SSRF protection;
- default internal slash commands and install/connection-gated external
  commands;
- an admin UI for templates, drafts/publishing, runs, approvals, connections,
  commands, webhooks, deliveries, and audit.

Nango is deliberately only the OAuth/token/proxy boundary. Seemplify owns the
workflow language, policies, approvals, retries, business audit, and internal
product contracts, so the connector layer remains replaceable.

Nango currently advertises 900+ API definitions. Its repository uses the
Elastic License, so “open source” should be understood operationally as
source-available and self-hostable rather than assumed to be an OSI-approved
license. The limited free self-hosted edition provides Auth and Proxy; this Hub
does not depend on Nango's paid Functions, sync, or webhook runtime.

## Local verification

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` starts an isolated Automation Hub and a deterministic mock
suite for Seemplify products and Nango/provider APIs. The browser test performs
the full cumulative journey, including real UI clicks and forms. It does not
replace provider OAuth verification against production Google accounts.

For manual acceptance against the same isolated runtime:

```powershell
npm run build
npm run e2e:server
```

Then open `http://127.0.0.1:5420`. Test login is intentionally unavailable in a
production process.

## Production requirements

Production starts only with a valid Seemplify Identity OIDC configuration.
Plaintext production credentials must be installed as root-owned files and
referenced with the `*_FILE` variables shown in `.env.example`.

The Hostinger deployment is defined in
`../deploy/hostinger/automation-nango.compose.yml`. Before deploying:

1. Build and publish the Automation Hub image, then set
   `AUTOMATION_HUB_IMAGE` to its immutable tag or digest.
2. Install the root-only files listed in the deployment runbook.
3. Deploy/restart Identity, Payroll, Leave, and Time with their matching HMAC
   files. Never generate different keys for the two ends of one contract.
4. Deploy Nango and register the `google-mail` and `google-drive` integrations
   with the reviewed OAuth scopes and redirect URIs.
5. Complete Google OAuth consent-screen and verification requirements.
6. Deploy the Hub, perform OIDC-start and authenticated acceptance, then enable
   one connector at a time.

The Workspace/Boards/Pages service is deployed from a separate source checkout
and must implement the signed `/api/internal/automation/actions` contract before
those internal recipes are enabled in production. The same rule applies to any
catalogue action whose owning service has not yet shipped its target adapter.

## Security boundaries

- Organization IDs from workflow payloads never override the authenticated
  organization.
- Internal requests are timestamped, nonce-protected, body/path-bound HMAC
  calls with stable idempotency keys.
- Product APIs revalidate live state and return authoritative outcome IDs.
- R3 approval never means “a channel said approved”; the owning product applies
  the final transition.
- Restricted data cannot cross an external connection unless the descriptor
  and workflow explicitly allow that destination.
- Outgoing webhooks allow public HTTPS targets only in production, do not
  follow redirects, and reject private or metadata addresses.
- Connection credentials stay in Nango. The Hub stores connection references,
  status, ownership, and audit metadata only.

## Adding a connector or product action

Do not expose Nango's entire provider catalogue automatically. Add a reviewed
connector descriptor, narrow scopes, a fixed adapter endpoint set, data-class
rules, revocation behavior, test fixtures, and browser acceptance. Internal
actions additionally require an owning product, exact preconditions,
idempotency, authoritative outcomes, and target-side authorization tests.
