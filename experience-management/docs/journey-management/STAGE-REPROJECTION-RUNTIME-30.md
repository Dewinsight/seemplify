# Stage reprojection runtime 30

**Status:** Proposed from current audit  
**Date:** Wednesday, August 5, 2026  
**Depends on:** runtime 18 stage processing, runtime 29 current runtime window

This document defines the next connected-journey runtime slice after the
current runtime 29 window. It fills the largest connected-journey release-gap
identified by the audit: retained labelled reprojection of stage-processing
history.

## 1. Problem statement

Runtime 18 already provides:

- durable live stage processing over accepted raw events
- immutable decisions and visits
- mutable anonymous instance watermarks
- dead-letter handling and one-item replay

What it does not yet provide is a governed, durable, resumable reprojection job
for historical retained events after rule/version/correction changes.

That is a release blocker because:

- one dead-letter replay is not enough for correction of already-accepted
  historical events;
- rule changes need an auditable, bounded way to re-evaluate retained history;
- dogfood and operational release evidence require a labelled before/after
  projection story, not just live-forward processing.

## 2. Non-goals

This slice does not attempt:

- Customer/Account 360
- actual-path product surfaces
- orchestration / consequential actions
- known-identity merge logic
- npm publication

## 3. Design goals

Runtime 30 must:

1. replay retained accepted raw events without mutating raw facts;
2. support bounded reprojection scopes by space, source, journey definition,
   published rule definition/version, environment, and time window;
3. preserve append-only attempts and audit history;
4. be resumable with checkpoints and lease fencing;
5. produce labelled before/after reconciliation summaries;
6. fail closed on cross-tenant, stale-version, and retention-boundary issues;
7. reuse the runtime-18 evaluator/apply logic rather than fork it.

## 4. Proposed durable entities

### 4.1 `journey_stage_reprojection_runs`

One requested reprojection run.

Suggested core columns:

- `id`
- `space_id`
- `reason`:
  - `manual`
  - `rule_published`
  - `rule_corrected`
  - `reconcile`
  - `incident_recovery`
- `journey_definition_id`
- `journey_map_version_id`
- `rule_definition_id` nullable
- `rule_version_id` nullable
- `source_id` nullable
- `environment`
- `window_start` nullable
- `window_end` nullable
- `state`:
  - `pending`
  - `leased`
  - `retryable`
  - `completed`
  - `failed`
  - `cancelled`
- `available_at`
- `lease_owner`
- `lease_token`
- `lease_generation`
- `lease_expires_at`
- `attempt_count`
- `max_attempts`
- `summary_json`
- `error_code`
- `idempotency_key`
- `intent_sha256`
- `requested_by_user_id`
- `created_at`
- `updated_at`
- `completed_at`

### 4.2 `journey_stage_reprojection_attempts`

Append-only attempt history.

Suggested columns:

- `id`
- `run_id`
- `space_id`
- `attempt_number`
- `lease_generation`
- `status`
  - `succeeded`
  - `retryable_failed`
  - `terminal_failed`
  - `lease_expired`
  - `cancelled`
- `error_code`
- `started_at`
- `completed_at`

### 4.3 `journey_stage_reprojection_checkpoints`

Durable bounded progress.

Suggested columns:

- `run_id`
- `space_id`
- `last_raw_received_at`
- `last_raw_event_id`
- `processed_count`
- `matched_count`
- `no_match_count`
- `late_count`
- `out_of_order_count`
- `replayed_dead_letter_count`
- `revision`
- `updated_at`

Checkpoint ordering should follow the retained raw-event total ordering already
used by runtime 18:

- `occurred_at`
- then `event_id`
- and repository-safe tie-breaking by raw receive identity where needed

### 4.4 `journey_stage_reprojection_audit_events`

Append-only operator and system audit for:

- `reprojection.requested`
- `reprojection.started`
- `reprojection.completed`
- `reprojection.failed`
- `reprojection.cancelled`
- `reprojection.viewed`

### 4.5 `journey_stage_reprojection_summaries`

Optional separate row or folded into `summary_json`.

Must preserve labelled before/after comparison at minimum:

- prior instance/visit/decision counts
- new counts
- changed-watermark count
- changed-terminal-state count
- changed-current-stage count
- no-change count
- source scope metadata

## 5. Execution model

The reprojection job should mirror the metric rebuild worker model.

### 5.1 Queueing

Request path:

- validate scope against tenant and published-rule state
- compute deterministic `intent_sha256`
- enforce idempotency by `(space_id, idempotency_key)`
- insert `pending` run
- append audit record

### 5.2 Claiming

Worker path:

- recover expired leases
- claim oldest eligible `pending` / `retryable` run
- increment `attempt_count`
- assign `lease_owner`, `lease_token`, `lease_generation`, `lease_expires_at`

### 5.3 Processing

The job must not duplicate runtime-18 logic. Instead:

- factor shared evaluation/apply primitives out of
  [backend/src/journeyStageProcessing.ts](../../backend/src/journeyStageProcessing.ts)
- read retained accepted raw events in bounded order within the requested scope
- re-run the existing rule-evaluation logic against the published snapshot the
  run was created for
- advance checkpoints every bounded batch
- emit labelled before/after aggregate changes

### 5.4 Completion

On success:

- persist final checkpoint
- write summary
- mark run `completed`
- append succeeded attempt
- append audit record

On retryable failure:

- preserve checkpoint
- mark `retryable`
- clear live lease
- backoff availability
- append failed attempt

On terminal failure:

- mark `failed`
- preserve checkpoint and summary-so-far
- append failed attempt and audit

## 6. Safety and invariants

Runtime 30 must preserve these invariants:

- raw events are immutable and never rewritten by reprojection
- prior decisions/visits remain immutable historical facts
- reprojection results are labelled and auditable, not silent replacement
- cross-space scope is impossible
- cancelled or stale leased runs cannot commit
- retention boundaries are honoured: expired raw events are not silently
  treated as present
- the run cannot claim compatibility with known-identity 360/profile logic that
  does not exist yet

## 7. Suggested file layout

### New backend files

- `backend/src/journeyStageReprojection.ts`

### Likely changed backend files

- [backend/src/journeyStageProcessing.ts](../../backend/src/journeyStageProcessing.ts)
- [backend/src/journeyEventControlPlaneRoutes.ts](../../backend/src/journeyEventControlPlaneRoutes.ts)
- [backend/src/journeyEventIngestionRepository.ts](../../backend/src/journeyEventIngestionRepository.ts)
- [backend/src/platformSchema.ts](../../backend/src/platformSchema.ts)
- [backend/src/server.ts](../../backend/src/server.ts)

### Likely migration

- `backend/migrations/postgres/0030_journey_stage_reprojection.sql`

### Likely tests/probes

- `backend/test/journey-stage-reprojection.test.ts`
- `scripts/probe-journey-stage-reprojection-postgres.mjs`
- updates to [scripts/test-postgres-e2e.mjs](../../scripts/test-postgres-e2e.mjs)

### Likely frontend/operator touch points

- [frontend/src/components/journey-events/EventSourceDeadLetters.tsx](../../frontend/src/components/journey-events/EventSourceDeadLetters.tsx)
- [frontend/src/pages/JourneyEventSourcesPage.tsx](../../frontend/src/pages/JourneyEventSourcesPage.tsx)
- [frontend/src/components/journeys/JourneyStageRulesWorkspace.tsx](../../frontend/src/components/journeys/JourneyStageRulesWorkspace.tsx)

## 8. Proof required before claiming this slice is complete

At minimum:

1. SQLite parity and PostgreSQL migration proof
2. claim/lease/expiry/fencing tests
3. idempotent queueing tests
4. bounded checkpoint/resume tests
5. labelled before/after reconciliation proof
6. no-raw-mutation proof
7. least-privilege/runtime-role proof
8. operator audit proof
9. destructive PostgreSQL probe over real retained accepted events

## 9. Recommended next coding move

Start by extracting the shared pure evaluation/apply core out of
[backend/src/journeyStageProcessing.ts](../../backend/src/journeyStageProcessing.ts),
because every later reprojection implementation will be cleaner and safer if it
reuses that path directly.
