# Hostinger production deployment coverage

All active Seemplify production applications are released from `main` to the
Hostinger VPS. Dokploy and Traefik run on that host, while application lifecycle
is owned by the Compose definitions in this directory. The Dokploy application
and project tables are intentionally empty; workflows must not call legacy
application IDs.

| Production scope | Canonical workflow | Compose definition |
| --- | --- | --- |
| Identity, Recruiter, Candidate Portal, Leave, Performance, Payroll, Time and Attendance, Learning | `deploy-core-hostinger.yml` | `core-apps.compose.yml` |
| Approver | `deploy-approver-hostinger.yml` | `core-apps.compose.yml` |
| Experience, Knowledge, AI Interview, Marketing | `deploy-experience-hostinger.yml` | `core-apps.compose.yml`, `extended-apps.compose.yml` |
| Shared ChatGPT gateway | `deploy-chatgpt-gateway-hostinger.yml` | `core-apps.compose.yml`, `extended-apps.compose.yml` |
| Shared connector runtime (Nango) | `deploy-connectors-hostinger.yml` | `automation-nango.compose.yml` |
| Transactional mail | `deploy-mail-service.yml` | `mail.compose.yml` |
| TURN credentials API and Coturn | `deploy-coturn-hostinger.yml` | `coturn/docker-compose.yml` |

Each application workflow builds immutable images labeled with
`org.opencontainers.image.revision`, deploys the exact tested commit, waits for
health, verifies the running revision, and performs public smoke checks. Shared
connector infrastructure uses its pinned upstream image and records the exact
Seemplify release in the container label `com.seemplify.release`.

`digilog-recruiter`, `auto-mailer`, Rocket.Chat, Zulip, and the former LMS
deployment are not active Hostinger production applications. Their executable
legacy deployment workflows are deliberately absent.
