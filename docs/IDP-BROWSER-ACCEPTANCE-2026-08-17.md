# IdP browser acceptance — 2026-08-17

## Scope

Production acceptance was run against the live Seemplify IdP catalogue at
`https://auth.seemplifyai.com` using an authenticated Microsoft Edge session
controlled through Playwright. The VPS service smoke suite was also run on
`179.198.192.126` after the Approver deployment.

## Application results

| Application | IdP launch | Authenticated landing | Result |
| --- | --- | --- | --- |
| Recruiter | `/launch/smarthr` | `https://app.seemplifyai.com/dashboard` | Pass |
| Leave Management | IdP catalogue launch | `/dashboard` | Pass |
| Learning | IdP catalogue launch | `/simple-lms?view=my-learning` | Pass |
| Workspace / Messaging | IdP catalogue launch | `/dashboard` | Pass |
| Approver | `/launch/approver` | `https://approver.seemplifyai.com/` dashboard | Pass after fix |
| People Transitions | IdP catalogue launch | `/people-transitions` | Pass |
| Performance | IdP catalogue launch | `/dashboard` | Pass |
| Payroll | IdP catalogue launch | `/dashboard` | Pass |
| Time & Attendance | IdP catalogue launch | `/dashboard` | Pass |
| Experience Management | External catalogue link | `https://experience.seemplifyai.com/login` | Blocked: no IdP/OIDC implementation in this application |

The IdP rendered all ten expected catalogue entries. Nine applications passed
authenticated end-to-end launch. Experience Management is online and its health
endpoint passes, but it currently exposes only its local email/password flow.
This is an application feature gap, not an IdP environment-variable failure.

## Approver correction

Approver's production frontend was calling the nonexistent
`api.approver.seemplifyai.com` host. Its production API base now uses the
same-origin `/api` path. The application also uses its own host-only session
cookie, accepts and clears the legacy cookie during rollout, and no longer
crashes when optional Azure OpenAI configuration is absent.

Verified production image:

`seemplify/approver:hostinger-be4c34f0b03f09af850659d44fa75c417853f5d6`

The live browser launch returned an authenticated Approver dashboard for
`Obiageli Egbo` in the `AIIN (2ac121)` organization.

## Connected-service evidence

The Hostinger smoke suite passed after deployment, including:

- frontend and API reachability;
- IdP discovery and OIDC starts for Recruiter, Workspace, Leave, Performance,
  Payroll, Time, Learning, and Approver;
- Recruiter, Workspace, Leave, Performance, Payroll, Time, Approver,
  Experience, and AI Interview health endpoints;
- Workspace realtime handshake and release manifest;
- TURN credential API and container health;
- mail API health;
- live IdP application catalogue.

Additional authenticated browser checks confirmed the shared ChatGPT connection
in Recruiter and the live Codex chat/model selector in Workspace.

## Remaining release blocker

Experience Management needs a first-class OIDC client and callback flow, IdP
client registration, account/space provisioning rules, production secrets, and
an authenticated browser regression test. Until that work is implemented and
deployed, it must not be reported as IdP-integrated even though the application
itself is healthy and reachable.
