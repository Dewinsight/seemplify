# Seemplify Experience

Seemplify Experience is a standalone experience-management application inspired by XEBO.ai. It has its own Express/SQLite backend and React frontend, while using the shared Seemplify Terra gateway for every generative-AI operation and Brevo for survey email delivery.

## Product coverage

- AI survey generation from a business brief, with CX, EX, and market-research templates.
- Rich survey builder with NPS, CSAT, CES, choice, rating, matrix, ranking, text, contact, date, file, and media questions.
- Display and branch logic, page grouping, validation, preview, and a public respondent experience.
- Web-link, QR, email, API, manual-entry, and kiosk collectors.
- Brevo invitations, reminders, and completion messages with recipient-level delivery tracking.
- Individual and aggregate response analysis, NPS/CSAT/CES, trends, drop-off, cross-variable breakdowns, and key-driver correlations.
- Terra sentiment, emotion, topic, intent, risk, recommendation, translation, executive-report, and ask-your-data workflows.
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

`npm run test:all` runs strict type checks, backend and frontend tests, a production build, and Playwright in desktop Chromium and a Pixel-sized mobile viewport. `scripts/live-ai-smoke.mjs` validates all Terra workflows against the real signed local gateway; it removes its synthetic survey and AI-job history afterward.
