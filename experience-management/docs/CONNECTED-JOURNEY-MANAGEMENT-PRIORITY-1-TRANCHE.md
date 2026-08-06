# Connected Journey Management Priority 1 tranche

**Status:** Proposed from current audit  
**Date:** Wednesday, August 5, 2026  
**Depends on:** [CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md](./CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md)  
**Master plan:** [CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md](./CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md)

This tranche turns the current Priority 1 conclusion into an executable
implementation target. It is intentionally narrow: finish the connected-journey
release gate around the event/data/stage foundations that already exist.

As of Wednesday, August 5, 2026, part of this tranche is already complete:

- runtime-30 retained stage reprojection is now implemented and exercised; and
- a first bounded Seemplify activation dogfood reconciliation artifact now
  exists.

This document therefore focuses on the remaining Priority 1 release-gate work,
not on re-describing completed substeps as if they were still hypothetical.

## Why this tranche is first

The current audit shows:

- the event control plane, ingestion plane, and stage-processing runtime already
  exist and have meaningful correctness evidence;
- the SDKs are locally release-shaped but still blocked by programme-level
  release gates; and
- the biggest current gap is executable release evidence, not another layer of
  abstract domain modelling.

The two most leveraged remaining capabilities are:

1. scale-grade proof and operationalisation for retained reprojection
2. fuller dogfood/telemetry/runbook/SLO evidence for the connected-journey plane

Together they improve both:

- section-27 connected-journey outcomes, and
- the eventual SDK publication path

## Current repo evidence that this tranche builds on

### Runtime 18 stage processing already exists

- [backend/migrations/postgres/0018_journey_stage_processing.sql](../backend/migrations/postgres/0018_journey_stage_processing.sql)
- [backend/src/journeyStageProcessing.ts](../backend/src/journeyStageProcessing.ts)
- [backend/src/journeyStageRuleRepository.ts](../backend/src/journeyStageRuleRepository.ts)
- [backend/src/journeyEventIngestionRepository.ts](../backend/src/journeyEventIngestionRepository.ts)
- [backend/src/journeyEventControlPlaneRoutes.ts](../backend/src/journeyEventControlPlaneRoutes.ts)
- [frontend/src/components/journeys/JourneyStageRulesWorkspace.tsx](../frontend/src/components/journeys/JourneyStageRulesWorkspace.tsx)
- [frontend/src/components/journey-events/EventSourceDeadLetters.tsx](../frontend/src/components/journey-events/EventSourceDeadLetters.tsx)
- [frontend/src/pages/JourneyEventSourcesPage.tsx](../frontend/src/pages/JourneyEventSourcesPage.tsx)

### Existing proof scripts already cover correctness slices

- [scripts/probe-journey-stage-processing-postgres.mjs](../scripts/probe-journey-stage-processing-postgres.mjs)
- [scripts/probe-journey-stage-reprojection-postgres.mjs](../scripts/probe-journey-stage-reprojection-postgres.mjs)
- [scripts/journey-postgres-ingest-security-load.mjs](../scripts/journey-postgres-ingest-security-load.mjs)
- [scripts/test-postgres-e2e.mjs](../scripts/test-postgres-e2e.mjs)

### Newly completed tranche artifacts

- [backend/migrations/postgres/0030_journey_stage_reprojection.sql](../backend/migrations/postgres/0030_journey_stage_reprojection.sql)
- [backend/src/journeyStageProjectionCore.ts](../backend/src/journeyStageProjectionCore.ts)
- [backend/src/journeyStageReprojection.ts](../backend/src/journeyStageReprojection.ts)
- [backend/test/journey-stage-reprojection.test.ts](../backend/test/journey-stage-reprojection.test.ts)
- [scripts/probe-journey-stage-reprojection-postgres.mjs](../scripts/probe-journey-stage-reprojection-postgres.mjs)
- [scripts/generate-journey-dogfood-report.mts](../scripts/generate-journey-dogfood-report.mts)
- [docs/journey-management/dogfood/latest-activation-report.md](./journey-management/dogfood/latest-activation-report.md)

### Existing release-evidence contracts already exist as docs

- [docs/journey-management/architecture/DOGFOOD-TRACKING-PLAN.md](./journey-management/architecture/DOGFOOD-TRACKING-PLAN.md)
- [docs/journey-management/architecture/QUALITY-BUDGETS.md](./journey-management/architecture/QUALITY-BUDGETS.md)
- [docs/journey-management/architecture/OPERATIONS-AND-INCIDENTS.md](./journey-management/architecture/OPERATIONS-AND-INCIDENTS.md)

## What is missing right now

### A. Governed retained reprojection

Current state:

- live event-by-event stage processing exists
- one dead-letter replay path exists
- runtime-30 now provides a durable reprojection-run model for retained
  historical events, with queue/claim/checkpoint/complete behaviour and focused
  PostgreSQL execution proof

Missing:

- larger-scale capacity/resumability proof for historical reprojection
- richer targeted operator controls where the product needs
  journey/rule/time-window/source scoping beyond the current slice
- labelled before/after reconciliation artifacts suitable for release review
- ratified operator audit/runbook evidence around reprojection execution

### B. Dogfood reconciliation

Current state:

- the dogfood plan exists as a document
- a first generated activation reconciliation report now exists and is bound to
  current durable records
- AI runtime adoption now emits durable audit data for future dogfood runs

Missing:

- a fuller end-to-end activation run with fresh ChatGPT/runtime milestones
- stronger reconciliation across more real emitted steps, not only the current
  bounded activation report
- signed dogfood evidence tied to the release gate

### C. Telemetry / operations / SLO evidence

Current state:

- operations and quality-budget contracts exist
- destructive correctness/load scripts exist
- the repo still explicitly says signed SLO/capacity approval is pending

Missing:

- stable report artifacts rather than only pass/fail script output
- synthetic trigger / dashboard / alert evidence
- named runbook artifacts and exercised proof
- ratified operational evidence for the connected-journey plane

## Recommended concrete implementation sequence

### Step 1 — complete stage reprojection from focused execution proof to release-grade proof

Recommended new/changed files:

- extend [backend/src/journeyStageReprojection.ts](../backend/src/journeyStageReprojection.ts)
- extend [backend/test/journey-stage-reprojection.test.ts](../backend/test/journey-stage-reprojection.test.ts)
- extend [scripts/probe-journey-stage-reprojection-postgres.mjs](../scripts/probe-journey-stage-reprojection-postgres.mjs)
- update [docs/journey-management/STAGE-REPROJECTION-RUNTIME-30.md](./journey-management/STAGE-REPROJECTION-RUNTIME-30.md) if scope expands

Expected capabilities:

- prove larger retained-history reprojection windows with honest timings
- add richer before/after reconciliation summaries fit for release review
- harden resumability/idempotency/observability at scale
- add pause/cancel/audit controls where policy allows

### Step 2 — deepen reprojection proof scripts and capacity evidence

Recommended new/changed files:

- extend [scripts/probe-journey-stage-reprojection-postgres.mjs](../scripts/probe-journey-stage-reprojection-postgres.mjs)
- extend [scripts/test-postgres-e2e.mjs](../scripts/test-postgres-e2e.mjs)
- extend [scripts/journey-postgres-ingest-security-load.mjs](../scripts/journey-postgres-ingest-security-load.mjs) if it becomes the correct place for sustained retained-history load slices

Expected proof:

- resumable checkpoints
- safe rerun/idempotency
- no raw-event mutation
- before/after labelled reconciliation
- operator fencing and audit
- larger-scale performance/capacity evidence

### Step 3 — deepen dogfood reconciliation artifacts

Recommended new/changed files:

- one or more application/service files that own signup, onboarding, space
  creation, ChatGPT connection, survey/journey/subscription activation flows
- [backend/src/events.ts](../backend/src/events.ts) only if it is the correct
  in-process hook for internal dogfood observability, not for customer ingest
- new script under [scripts](../scripts) for reconciliation reports
- update [docs/journey-management/architecture/DOGFOOD-TRACKING-PLAN.md](./journey-management/architecture/DOGFOOD-TRACKING-PLAN.md)

Expected proof:

- emitted internal activation events
- durable correlation to source/state transitions
- a fuller reconciled report artifact with fresh ChatGPT/runtime milestones
- release-review-ready caveats and signoff hooks

### Step 4 — materialise operations evidence

Recommended new/changed files:

- extend [scripts/journey-postgres-ingest-security-load.mjs](../scripts/journey-postgres-ingest-security-load.mjs)
- new runbook docs under a new
  `docs/journey-management/architecture/runbooks/` folder
- update
  [docs/journey-management/architecture/OPERATIONS-AND-INCIDENTS.md](./journey-management/architecture/OPERATIONS-AND-INCIDENTS.md)
- update
  [docs/journey-management/architecture/QUALITY-BUDGETS.md](./journey-management/architecture/QUALITY-BUDGETS.md)

Expected proof:

- stable machine-readable load/SLO result artifact
- synthetic trigger / dashboard / alert evidence references
- runbook artifacts for the first critical connected-journey incidents

## Success criteria for this tranche

This tranche is successful when the repo can honestly prove all of the
following:

1. stage-processing history can be reprojected safely and durably, not only
   replayed one failed event at a time;
2. the Seemplify activation dogfood journey is instrumented and reconciled with
   release-review-ready evidence;
3. connected-journey operational evidence exists as artifacts, not only as
   prose contracts; and
4. the audit can upgrade the connected-journey outcomes with stronger runtime
   and operations evidence, even if they are still not fully `Verified`.

## What this tranche does not attempt

- Customer/Account 360
- actual-path full product surfaces
- orchestration/runtime actions
- final npm publication itself

Those remain downstream of this tranche.
