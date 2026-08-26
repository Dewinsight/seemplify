# CV ingestion rollout

The Recruiter and AI Interview CV pipelines now accept uploads at a durable
boundary, process them asynchronously, and retain an operational history for
recovery. Roll out the API/workers before the frontend so every UI request has
the new history, retry, replacement, and capability endpoints available.

## Required production services and secrets

- Persistent MongoDB for both applications. AI Interview intentionally refuses
  production startup without `AI_INTERVIEW_MONGO_URI`, `MONGO_URI`, or
  `MONGODB_URI`.
- Persistent Redis/BullMQ for Recruiter and AI Interview queue delivery.
- Set `REDIS_ENABLED=true` in Recruiter production and configure either
  `CV_GLOBAL_DISPATCH_REDIS_URL` or the shared `REDIS_HOST`, `REDIS_PORT`,
  `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, and `REDIS_TLS` values.
  Recruiter and AI Interview must point at the same Redis database.
- Keep the shared dispatch contract identical in both services:
  `CV_GLOBAL_DISPATCH_IDENTITY=seemplify-cv-inference`,
  `CV_GLOBAL_DISPATCH_KEY_PREFIX=seemplify:cv:dispatch:v2`,
  `CV_GLOBAL_DISPATCH_APPROVED_LIMIT`, `CV_GLOBAL_DISPATCH_LEASE_MS=120000`,
  `CV_GLOBAL_DISPATCH_FAIRNESS_WINDOW_MS=10000`, and
  `CV_GLOBAL_DISPATCH_RETRY_MS=30000`. A mismatched contract
  fails closed instead of allowing unapproved parallel inference.
- Stable, random secrets shared by every replica of the corresponding service:
  `CV_STATUS_TOKEN_SECRET`, `PUBLIC_APPLICATION_CAPABILITY_SECRET`,
  `PUBLIC_FEEDBACK_CAPABILITY_SECRET`, and
  `AI_INTERVIEW_CV_STATUS_TOKEN_SECRET`. Do not rotate these independently of
  a coordinated cutover; in-flight status and public capabilities depend on
  them.
- Existing private Cloudinary credentials and the configured Recruiter AI
  runtime. In ChatGPT-only mode, anonymous public applications prefer the
  connected, consented ChatGPT account of the recruiter who created the job.
  The assigned hiring manager and recruiters are deterministic fallbacks; an
  eligible organization member is used only for legacy or imported jobs whose
  ownership metadata cannot provide a routable account. If no eligible account
  is available, AI enrichment waits durably and the next Recruiter login
  promotes it for another attempt. A recruiter can also use **Run analysis
  now** in processing history once a runtime is ready; previous attempts remain
  visible as audit history. The public candidate and managed CV reference are
  committed before AI analysis, so the uploaded CV remains visible and
  downloadable while waiting.
- Mongo roles must be able to list, create, and update indexes. The CV job,
  audit, cleanup, batch, and AI Interview intake collections initialize their
  indexes automatically.

The minimum Recruiter production CV variables are therefore:

```dotenv
NODE_ENV=production
MONGO_URI=<persistent-recruiter-mongodb-uri>
REDIS_ENABLED=true
CV_GLOBAL_DISPATCH_REDIS_URL=<persistent-redis-or-rediss-url>
CV_GLOBAL_DISPATCH_IDENTITY=seemplify-cv-inference
CV_GLOBAL_DISPATCH_KEY_PREFIX=seemplify:cv:dispatch:v2
CV_GLOBAL_DISPATCH_APPROVED_LIMIT=1
CV_GLOBAL_DISPATCH_LEASE_MS=120000
CV_GLOBAL_DISPATCH_FAIRNESS_WINDOW_MS=10000
CV_GLOBAL_DISPATCH_RETRY_MS=30000
CV_ANALYSIS_QUEUE_CONCURRENCY=1
CV_ANALYSIS_QUEUE_APPROVED_CONCURRENCY=1
CV_STATUS_TOKEN_SECRET=<separate-long-random-secret>
PUBLIC_APPLICATION_CAPABILITY_SECRET=<separate-long-random-secret>
PUBLIC_FEEDBACK_CAPABILITY_SECRET=<separate-long-random-secret>
CLOUDINARY_CLOUD_NAME=<private-cloud-name>
CLOUDINARY_API_KEY=<private-api-key>
CLOUDINARY_API_SECRET=<private-api-secret>
```

Increase the three concurrency/approved-limit values only as one coordinated,
capacity-tested change across Recruiter and AI Interview. The shared persisted
limit must never exceed the approved limit.

## Capacity and retention controls

- `CV_BULK_MAX_TOTAL_BYTES` caps one Recruiter bulk multipart request. It
  defaults to 500 MiB and is enforced while streaming, before the whole batch
  can fill local staging storage.
- `CV_PROCESSING_JOB_RETENTION_DAYS` defaults to 30 days for terminal job
  records.
- `CV_FAILED_RETRY_RETENTION_DAYS` controls how long failed raw CV bytes remain
  available for a no-reupload retry; it defaults to the job retention window.
- `CV_PROCESSING_AUDIT_RETENTION_DAYS` defaults to 180 days. Audit rows retain
  operational facts, not raw CV bytes, and are redacted on candidate or
  organization erasure.
- Size local Recruiter staging storage above the chosen aggregate bulk cap.
  Startup and periodic sweepers reclaim abandoned multipart and durable-intake
  files after their safety grace period.

## Legacy public-feedback links

Bare pre-cutover feedback links remain closed. Reissue still-actionable
invitations with capability-bound links after the backend deployment.

From `recruiter/backend`, preview each batch first:

```powershell
npm run feedback:reissue:dry-run -- --limit=100
```

Optionally restrict the preview/send to one organization:

```powershell
npm run feedback:reissue:dry-run -- --organization=<organization-object-id> --limit=100
npm run feedback:reissue -- --organization=<organization-object-id> --limit=100
```

Without an organization filter, send in bounded batches and repeat the dry run
until `eligible` is zero. A partial email failure invalidates that attempt's
links and leaves the interview eligible for a complete rerun.

## Cutover verification

1. Confirm Mongo and Redis are persistent and healthy before starting workers.
2. Deploy Recruiter and AI Interview backends/workers. Recruiter
   `GET /api/health` must return HTTP 200 with `healthy: true`,
   `cvIngestion.durableStorage.ready: true`, `cvIngestion.indexes.ready: true`,
   and `cvIngestion.dispatcher.ready: true`. Normal queued jobs or jobs parked
   pending user ChatGPT consent do not make this infrastructure check fail.
3. Submit one private CV, one multi-file Recruiter batch, and one public job
   application. Verify each reaches `stored`, `extracting`, `analyzing`,
   `profile_creation`, and `completed` in processing history.
4. Force one extraction failure, confirm its stage/time/error remains visible,
   then exercise Retry or corrected-CV Replacement as offered by the job.
5. Verify a platform admin can filter cross-organization history while a normal
   recruiter sees only their organization and an interviewer cannot submit or
   retry CV jobs.
6. Run the feedback-link dry run, reissue the required invitations, and verify
   cancellation immediately revokes questions, feedback submission, and resume
   proxy access.
