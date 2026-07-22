# Groq AI Runtime

The recruiter backend owns text-generation routing for both Seemplify and the standalone AI Interview service. Groq credentials are encrypted in MongoDB and are never sent to the standalone service or returned by an API.

Credential creation, testing, rotation, disabling, and removal require the explicit `systemSettings` admin permission. Secret values are accepted only by credential endpoints and are never valid quota-group metadata.

## Required deployment secrets

- `AI_PROVIDER_ENCRYPTION_KEY`: a dedicated 32-byte base64 value or 64-character hexadecimal value.
- `AI_PROVIDER_ENCRYPTION_KEY_VERSION`: active key version, for example `v1`.
- `AI_PROVIDER_ENCRYPTION_KEYS`: optional JSON key ring used while rotating encryption keys.
- `AI_GATEWAY_HMAC_SECRET`: a separate high-entropy service-to-service signing secret.
- `AI_GATEWAY_ALLOWED_SERVICES`: normally `ai-interview`.
- `GROQ_BOOTSTRAP_API_KEY`: a newly rotated key used only while seeding. Remove it immediately after a successful seed.

Do not reuse `JWT_SECRET` for either AI runtime secret. Do not bootstrap with a key that has appeared in chat, source control, logs, tickets, or screenshots.

## Bootstrap

The seeder is dry-run first and refuses to apply without the dedicated encryption key.

```powershell
npm run seed:ai-runtime
npm run seed:ai-runtime:apply
```

Apply mode encrypts the key, verifies `openai/gpt-oss-20b` and `openai/gpt-oss-120b`, synchronizes model access, and seeds routes and alerts without overwriting later admin routing changes. A fresh seed starts at the 10% canary and therefore requires the existing Azure text baseline configuration. Set `GROQ_BOOTSTRAP_ROLLOUT_PERCENT=100` only for a deliberate Groq-only deployment. Remove `GROQ_BOOTSTRAP_API_KEY` from the deployment after it succeeds.

## Rollout

Use **Admin > AI Runtime > Routing** to move through these stages:

1. `10%`: deterministic organization-level Groq canary; the remaining traffic uses the explicitly configured Azure text baseline.
2. `50%`: expand only after schema, policy, quality, latency, and error gates pass.
3. `100%`: Groq-only text generation. Saving this stage disables Azure text baseline routing, so provider failures never fall back to Azure.

Canary assignment hashes the organization, then actor/candidate/request identity when no organization exists. The same organization stays in the same cohort as the percentage increases. Azure Speech and Azure embeddings are not part of this switch.

Keep the Azure text configuration available but disabled for 14 stable days after reaching 100%. Then remove `LLAMA_AZURE_*`, `AZURE_OPENAI_*`, and the rollback adapter while preserving Azure Speech and embedding variables.

## Verification

```powershell
npm run test:ai-runtime
npm run evaluate:ai-runtime
npm run test:admin-ai-interviews
npm run test:platform-features
```

Live provider checks are opt-in and use encrypted database credentials:

```powershell
$env:RUN_LIVE_GROQ_CHECK='1'; npm run test:llm
$env:RUN_LIVE_GROQ_EVAL='1'; npm run evaluate:ai-runtime
```

Production gates are 100% schema-valid fixtures after at most one repair, no critical tool/chat policy failures, quality within two points of the Azure baseline, live-chat p95 below three seconds, and canary error rate below 1%.

## Telemetry and limits

Request events contain routing, identity dimensions, token usage, estimated cost, latency, provider request IDs, retries, error codes, and normalized rate headers. Prompts, completions, candidate text, and secrets are not stored. Detailed events expire after 90 days; daily organization, user, activity, model, provider, and application rollups are retained for all-time analytics.

Keys in one Groq organization normally share limits. Put credentials in another quota group only when that scope is genuinely independent and authorized. See Groq's official [rate limits](https://console.groq.com/docs/rate-limits), [projects](https://console.groq.com/docs/projects), and [spend limits](https://console.groq.com/docs/spend-limits).
