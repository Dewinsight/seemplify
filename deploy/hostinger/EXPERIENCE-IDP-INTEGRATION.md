# Experience Management: IdP, admin, and shared AI integration

## User authentication

Experience is registered in Seemplify Identity as OIDC client `experience-management`.
Production login and signup both launch `/api/auth/oidc/start`; password login,
signup, verification, and reset APIs return `IDENTITY_PROVIDER_REQUIRED` when
`LOCAL_AUTH_ENABLED=false`.

The callback requires a stable subject and verified email. It links an existing
account by email or creates one, then mirrors entitled IdP organizations into
the reserved `idp-*` Experience-space namespace. Product-local spaces are not
deleted or renamed. IdP owner/admin/member roles map to the corresponding
Experience space role, and the IdP current organization becomes the active
space.

Required production variables in `/opt/seemplify/secrets/core-apps.env`:

- `OIDC_EXPERIENCE_SECRET`
- `EXPERIENCE_ADMIN_SSO_SECRET`
- `EXPERIENCE_AI_SHARED_SECRET`

The protected IdP client registry is regenerated with
`deploy/hostinger/generate-idp-clients.sh`; it must never be replaced by the
development secret in `Identityprovider/clients.json`.

## Central administration

Seemplify IdP Admin exposes **Experience Admin** at
`/admin/experience-admin`. The launch creates a one-minute, audience-bound
HS256 token and sends it to `/api/auth/idp-admin`. Tokens are accepted only
once. IdP super administrators receive the Experience `superadmin` platform
role; IdP system administrators receive `support`.

The product's existing platform-admin UI and APIs remain the operational
surface, but access begins from and is authorized by Seemplify IdP Admin.

## Shared ChatGPT/Codex gateway

Experience calls the Recruiter-hosted gateway at
`/api/internal/ai/v1` as service `experience-management`. Requests use the v2
HMAC contract with timestamp and nonce replay protection. The gateway accepts
only activities registered under the `experience` application and stores
Experience-specific data-sharing consent on the shared ChatGPT account.

The forwarded identity contains the IdP subject, verified email, display name,
and active IdP organization. The local Codex app-server runtime remains a
development/test fallback only when `EXPERIENCE_AI_SHARED_SECRET` is absent.

## Release and verification

`.github/workflows/deploy-experience-hostinger.yml` builds immutable Experience,
IdP, and Recruiter backend images, regenerates the protected IdP client file,
recreates the three affected services, waits for health, and runs the full VPS
smoke suite. The smoke suite verifies that Experience OIDC start redirects to
`https://auth.seemplifyai.com/auth`.

Focused local contracts:

```text
npx tsx --test experience-management/backend/test/idp-provisioning.test.ts
node --test Identityprovider/test/experience-oidc-client.test.mjs
node --test recruiter/backend/tests/internalServiceAuth.test.js
```
