# Seemplify Experience

Seemplify Experience is a standalone experience-management application inspired by XEBO.ai. It has its own Express/PostgreSQL backend and React frontend, while using the shared Seemplify Terra gateway for every generative-AI operation and Brevo for survey email delivery. Local test runs retain isolated SQLite databases; the managed runtime uses the dedicated `seemplify_experience` database in the installed PostgreSQL 16 container.

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
- Durable PostgreSQL AI jobs with fair, lock-safe parallel claims, retries, progress, operational history, and live Server-Sent Events.
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

Runtime secrets, uploads, and the pre-cutover SQLite recovery snapshot are stored under `.local-runtime/experience-management` outside Git. Application records are stored in the dedicated `seemplify_experience` PostgreSQL database. The hosted target is `https://experience.aiinnigeria.com`.

The first `initialize` or `start` creates random admin, session, PostgreSQL runtime, and migration-owner secrets outside Git. `start` snapshots SQLite, migrates it transactionally, validates every imported row through the built application adapter, records the immutable source manifest, and only then starts PostgreSQL-backed workers. The runtime login is DML-only: it cannot create or own database objects, while the separate migration owner is disabled outside a migration. The default admin email is `admin@seemplify.local`; the password remains in `.local-runtime/experience-management/admin-password` on the host.

After the cutover marker is committed, the manager refuses to start a legacy SQLite-only release. The original SQLite database and timestamped backups remain untouched for recovery, but they are not used for new application writes.

### Nylas read-only assistant setup

The managed runtime looks for an explicitly protected `.local-runtime/experience-management/nylas.env`, then for the approved Recruiter hand-off in `recruiter/backend/.env`. `NYLAS_ENV_FILE` takes precedence. Experience never scans Xplorer or another product for an account-wide Nylas key. Configure Nylas v3 hosted OAuth with this exact callback:

```text
https://experience.aiinnigeria.com/api/integrations/nylas/callback
```

`manage.ps1 -Action initialize` creates an independent AES encryption key at `.local-runtime/experience-management/nylas-credential-encryption-key` and restricts its Windows ACL to the current user and SYSTEM. Grant IDs and assistant source snapshots are encrypted at rest; OAuth state is random, hashed, expiring, and single-use. Requested scopes are restricted to identity and read-only mail. There is deliberately no assistant send-mail or calendar-mutation route.

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

`npm run test:all` runs strict type checks, backend and frontend tests, a production build, and Playwright in desktop Chromium and a Pixel-sized mobile viewport. `scripts/migrate-sqlite-to-postgres.mjs --mode dry-run` validates and plans a source database without changing PostgreSQL. `scripts/live-ai-smoke.mjs` validates all signed Terra activities—including social listening and journey generation/optimization—against the real local gateway; it removes its synthetic surveys, mentions, journey maps, and AI-job history afterward.
