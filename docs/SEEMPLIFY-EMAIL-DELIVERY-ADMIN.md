# Seemplify email delivery admin

Seemplify Experience now exposes a root-only platform admin screen at:

- `/admin/email-delivery`

It is intended to close the gap between:

- the repo-local `.env` and `.local-runtime/mail/*.bearer` files
- the production Dokploy application environments
- the first-party transactional mail API at `https://mail-control.seemplifyai.com`

## What the page shows

For each transactional sender app in the Seemplify Dokploy project, the page shows:

- local `MAIL_API_BASE_URL`
- local `MAIL_FROM_EMAIL`
- local `MAIL_FROM_NAME`
- local `MAIL_API_TOKEN` resolution, including token source, key id, and fingerprint
- current production Dokploy values for the same variables

The page is backed by:

- `experience-management/backend/src/mailDeliveryAdmin.ts`
- `GET /api/platform-admin/email-delivery`

## What the sync action does

The **Sync Dokploy env** action:

1. resolves a working Dokploy API token from the local `access/` documents
2. reads the current per-app bearer tokens from `.local-runtime/mail/*.bearer`
3. writes these production env variables into each Dokploy app:
   - `MAIL_API_BASE_URL=https://mail-control.seemplifyai.com`
   - `MAIL_API_TOKEN=<per-app bearer token>`
   - `MAIL_FROM_EMAIL=<resolved sender>`
   - `MAIL_FROM_NAME=<resolved sender name>`
4. removes `MAIL_API_TOKEN_FILE` from the Dokploy env payload
5. triggers a Dokploy deployment for each updated app

The sync endpoint is:

- `POST /api/platform-admin/email-delivery/sync`

and requires a root platform administrator plus an audit reason.

## Apps currently covered

- Identity Provider
- Recruiter Backend
- Leave Backend
- Performance Backend
- Payroll Backend
- Time Attendance Backend
- Seemplify Learning

## Notes

- The page intentionally exposes the resolved mail API key only to a root admin because the user explicitly asked to see the implemented credential on the Seemplify side.
- The Dokploy token itself is never shown in the UI.
- Marketing-only Brevo integrations are intentionally preserved and are not touched by this admin flow.
