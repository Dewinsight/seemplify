# Seemplify Experience

Seemplify Experience is a standalone experience-management application inspired by XEBO.ai. It has its own Express/SQLite backend and React frontend, while using the shared Seemplify Terra gateway for every generative-AI operation and Brevo for survey email delivery.

## Product coverage

- AI survey generation from a business brief, with CX, EX, and market-research templates.
- Rich survey builder with NPS, CSAT, CES, choice, rating, matrix, ranking, text, contact, date, file, and media questions.
- Display and branch logic, page grouping, validation, preview, and a public respondent experience.
- Web-link, QR, email, API, manual-entry, and kiosk collectors.
- Brevo invitations with recipient-level delivery tracking, using the shared Seemplify sender configuration.
- Individual and aggregate response analysis, NPS/CSAT/CES, trends, drop-off, cross-variable breakdowns, and key-driver correlations.
- Terra sentiment, emotion, topic, intent, risk, recommendation, translation, executive-report, and ask-your-data workflows.
- Multi-account X social listening through OAuth 2.0 PKCE, with durable credit/rate-limit waits, account-specific cursors, posts, mentions, recent-search queries, and encrypted refresh tokens.
- Human-reviewed Terra reply drafts that are editable and copyable but never posted automatically.
- Saved social-intelligence reports and a cross-source Intelligence workspace that synthesizes selected survey and social report snapshots with traceable evidence and history.
- A read-only personal assistant that connects Google or Microsoft mail through Nylas, summarises bounded thread snapshots, prepares editable human-reviewed drafts, and answers questions from selected saved Experience intelligence. It never sends mail or changes calendars.
- Terra-generated customer journey maps covering stages, touchpoints, actions, emotions, friction, measures, opportunities, and a repeatable AI audit workflow.
- Durable SQLite AI jobs with retries, progress, operational history, and live Server-Sent Events.
- CSV/JSON exports and service-recovery tickets generated from negative feedback.

The admin application uses an HTTP-only, signed single-admin session. Only published respondent links and their submission path are accessible without authentication. The service listens on loopback and is published through a dedicated Cloudflare Tunnel.

## Local development

```powershell
cd experience-management
npm install
npm run dev
```

- Frontend: `http://127.0.0.1:5411`
- Backend: `http://127.0.0.1:5410`

Production mode serves the built frontend from the backend on port `5410`.

## Managed runtime

```powershell
.\scripts\manage.ps1 -Action start
.\scripts\cloudflare-tunnel.ps1 -Action start
```

Runtime state is stored under `.local-runtime/experience-management` outside Git. The hosted target is `https://experience.aiinnigeria.com`.

The first `initialize` or `start` creates a random admin password and session secret outside Git. The default admin email is `admin@seemplify.local`; the password remains in `.local-runtime/experience-management/admin-password` on the host.

### Nylas read-only assistant setup

The managed runtime looks for an explicitly protected `.local-runtime/experience-management/nylas.env`, then for the requested Recruiter hand-off in `recruiter/backend/.env`. An explicitly configured `NYLAS_ENV_FILE` takes precedence in the backend. It never scans another product's environment for an account-wide Nylas key. Nylas v3 hosted OAuth must allow this exact callback URL:

```dotenv
NYLAS_CLIENT_ID=<Experience or approved Recruiter application client ID>
NYLAS_API_KEY=<matching Nylas API key>
NYLAS_API_URI=https://api.us.nylas.com
```

```text
https://experience.aiinnigeria.com/api/integrations/nylas/callback
```

`manage.ps1 -Action initialize` creates an independent AES encryption key at `.local-runtime/experience-management/nylas-credential-encryption-key`, restricts its Windows ACL to the current user and SYSTEM, and exports its path to the service. Grant IDs are encrypted at rest; OAuth state is high-entropy, hashed, expiring, and single-use. The requested provider scopes are restricted to identity and mail-read permissions. There is deliberately no assistant send-mail or calendar-mutation route.

For an alternative environment, set `NYLAS_ENV_FILE`, `NYLAS_REDIRECT_URI`, and `NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE` in `backend/.env`. Keep `NYLAS_CLIENT_ID` and `NYLAS_API_KEY` in the referenced protected environment file, never in Git. `manage.ps1 -Action status` reports credential and encryption readiness without printing either secret.

```powershell
.\scripts\manage.ps1 -Action status
.\scripts\manage.ps1 -Action stop
.\scripts\manage.ps1 -Action restart
.\scripts\manage.ps1 -Action enable-auto-start
.\scripts\cloudflare-tunnel.ps1 -Action status
.\scripts\auto-deploy.ps1 -Action status
```

Auto-deploy polls `origin/main`, exports only the Experience Management subtree into an isolated release under `.local-runtime/experience-management/deployments`, then runs install, typecheck, tests, build, and a health-checked local restart. It never switches, resets, or overwrites the developer checkout; a failed release restores the previous active deployment.

## Verification

`npm run test:all` runs strict type checks, backend and frontend tests, a production build, and Playwright in desktop Chromium and a Pixel-sized mobile viewport. `scripts/live-ai-smoke.mjs` validates all signed Terra activities—including social listening and journey generation/optimization—against the real local gateway; it removes its synthetic surveys, mentions, journey maps, and AI-job history afterward.
