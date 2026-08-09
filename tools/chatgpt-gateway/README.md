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

Deployment and consumer environment configuration are managed by `dokploy-configure.cjs`. The deployment registry rejects unknown applications and deliberately excludes `experience-management`.

Before that configurator changes any environment or triggers any deployment,
it verifies the Identity Provider plus every current webhook receiver
(Recruiter, Performance, Leave, and Payroll) and fetches every configured
consumer. It also requires the gateway's
`/data` path to be a Docker named volume with an enabled Dokploy volume backup.
Missing application IDs, inaccessible applications, a bind/ephemeral `/data`
mount, or an absent backup aborts the run before the first mutation. This keeps
connected-account credentials and receipts recoverable.

Secret rotation is deliberately two-phase. The default `stage` run deploys
current and previous gateway/proxy/webhook keys in a compatibility-safe order:
gateway, Recruiter, Performance/other receivers, then the Identity Provider.
The configurator waits for the exact titled Dokploy deployment record to finish
before advancing. It proves both current and previous compatibility during the
stage, directly probes every receiver with its new target key before the IdP
cutover, then runs deployed Performance-to-Recruiter and IdP-to-all-receivers
end-to-end checks. A failed or slow deployment stops the sequence.

After those checks pass, rerun with
`SEEMPLIFY_SECRET_ROTATION_PHASE=finalize` and
`SEEMPLIFY_SECRET_ROTATION_APPROVED=true`; only that separately approved run
removes the previous keys. Finalization repeats current-key end-to-end checks
and repeatedly requires every captured previous gateway, proxy and webhook key
to receive HTTP 401. A failed stage therefore leaves the running release
compatible instead of splitting the services across credentials.

`IDP_WEBHOOK_MASTER_SECRET` is an operator/Identity-Provider trust root and
must contain at least 32 high-entropy bytes and must never be copied to a
product consumer. The configurator derives a unique
target key for Recruiter, Performance, Leave, and Payroll. Each receiver rejects
signatures created for another product.

The same deployment distributes a different derived
`LOCAL_LLM_SERVICE_SECRET` to each Local inference consumer. Only Recruiter
retains `LOCAL_LLM_SHARED_SECRET`, strictly to verify the independently signed
Local usage sink; the Local gateway master is removed from every other
application.

The operator environment for a shared rollout must include
`IDP_WEBHOOK_MASTER_SECRET` in addition to the gateway and Local runtime
masters. Store it in the deployment secret manager; do not add it to an app's
checked-in environment file.

## Telemetry API

Authorized consumers can call these signed endpoints using the same HMAC envelope as completion requests:

- `POST /v1/telemetry/events`
- `POST /v1/telemetry/summary`

Both endpoints accept an optional `sourceApp` filter. Events contain operational metadata and token counts only.
