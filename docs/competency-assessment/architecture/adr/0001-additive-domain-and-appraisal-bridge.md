# ADR 0001 — Additive competency domain with appraisal integration

Status: proposed, 18 October 2026. Stories: CA-001–CA-009 and evaluation/reporting stories.

## Context

Performance already has appraisals, cycle workflow, evidence, calls, AI and reports, but lacks source-versioned role expectations, deterministic compatible competency measures and full PRD result records. Current Appraisal lifecycle files have unrelated active changes. A separate silo would fail the user's requirement to select a role during appraisal setup and compare against it in human/AI analysis and the final report.

## Decision

Create separate tenant-scoped competency collections and `/api/competency` routes in the existing app. Store optional validated `appraisalId` in the competency assessment; use a narrow owned bridge to add role selection and linked result projection to current appraisal screens. Keep legacy state and endpoint contracts. Extract/reuse document/call adapters without manufacturing parent appraisals or widening their access.

## Alternatives

- Rewrite Appraisal into a single new universal assessment object: rejected for lifecycle regression risk and existing concurrent edits.
- Standalone disconnected assessment product: rejected because it cannot satisfy role selection/comparison inside appraisals.
- Put all configuration in untyped Mixed metadata: rejected because source/version, references, validation and indexable scope would be difficult to enforce.

## Consequences and proof

More explicit models and bridge reconciliation are required, but current appraisals remain compatible. Bridge launch is idempotent and reports partial failure safely. Tests prove old flows still work, participant/org match, duplicate prevention and combined report permission intersection. Rollback disables feature without deleting results/evidence.
