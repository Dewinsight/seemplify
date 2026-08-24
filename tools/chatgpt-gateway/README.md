# Seemplify shared AI gateway

This is a platform service, not a Recruiter service. It hosts connected ChatGPT/Codex sessions, request scheduling, execution receipts, and content-free usage telemetry for the Seemplify product suite.

## Current consumers

- Identity Provider
- Leave Management
- Payroll
- Performance Management
- Recruiter
- Time & Attendance

Experience Management is intentionally excluded. Its existing AI implementation remains separate until a later, explicit migration.

## Runtime boundary

- `CHATGPT_GATEWAY_BASE_URL` points consumers to this hosted connected-ChatGPT service.
- `LOCAL_LLM_BASE_URL` points consumers to the independent Control Center-selected Local inference runtime.
- A request must select one runtime. Neither runtime silently falls back to the other.
- Connected ChatGPT subjects are namespaced by product and user.
- Prompt, CV, appraisal, payroll, leave, and attendance content is never written to the telemetry ledger.

## Platform ownership

The gateway persists its own execution receipts, connected-account state, and usage ledger on its server volume. It does not depend on Recruiter being healthy. An optional `PLATFORM_AI_USAGE_SINK_URL` may mirror sanitized usage events to another platform-owned analytics service, but the gateway ledger remains authoritative.

Production deployment is managed by
`.github/workflows/deploy-chatgpt-gateway-hostinger.yml`. The workflow runs the
gateway and Recruiter ingestion contract tests, snapshots the named gateway
data volume, deploys revision-labelled images through the Hostinger compose
stack, verifies both running image revisions, and finishes with the shared
production smoke suite.

Consumer and storage secrets come from the root-owned files under
`/opt/seemplify/secrets`; they must not be embedded in this repository or in a
compose file. Product-specific HMAC identities remain scoped to their named
consumer, and `experience-management` remains deliberately excluded from the
connected-ChatGPT gateway until an explicit migration changes that boundary.

## Telemetry API

Authorized consumers can call these signed endpoints using the same HMAC envelope as completion requests:

- `POST /v1/telemetry/events`
- `POST /v1/telemetry/summary`

Both endpoints accept an optional `sourceApp` filter. Events contain operational metadata and token counts only.
