# Section 27 outcome audit — August 6, 2026

Status: In progress

Source plan: [../CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md](../CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md)  
Traceability authority: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md)  
Completion-proof rules: [../CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md](../CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md)  
Evidence register: [completion-evidence.json](./completion-evidence.json)

This audit exists to keep the section-27 programme-completion outcomes tied to
current repository evidence. It is intentionally narrower than the master plan
and more concrete than the narrative status docs.

## Current audit conclusion

The programme is not complete.

The repository proves meaningful foundations across Phases 1–5, including a
real subject-scoped actual-path product slice and release-shaped unpublished
TypeScript SDKs, but it still does not prove end-to-end completion of all
twelve section-27 outcomes and it does not yet prove authorised SDK publication
readiness.

The audit itself is now materially complete enough to guide implementation.
The limiting factor is no longer audit structure; it is the unfinished product,
proof, and publish-setup work called out below.

## Highest-confidence stale-claim corrections already required by current state

These are the main corrections this audit needed to enforce against older
narrative wording:

- actual-path persistence is no longer an anonymous-only surface; the current
  Journey Metrics product slice supports durable subject-scoped snapshots and
  rollups for both anonymous-only and known-profile stitched reads
- the current actual-path gap is no longer “basic persistence”; it is broader
  comparisons, broader designed-versus-observed productisation, and stronger
  reconciliation/correction/runtime proof
- SDK status remains “release-shaped and unpublished”, not “publishable now”

## Section-27 outcome checkpoint

| Outcome | Evidence IDs | Current honest state from repo evidence | Dominant blocker type | Strongest remaining blocker |
| --- | --- | --- | --- | --- |
| 1. Visual multi-persona designed journey | `outcome-persona-journey-proof-chain-2026-08-05` | In progress | Proof | saved-view depth, accessibility certification, release-gate reruns |
| 2. Evidence-backed journey without a second knowledge engine | `outcome-evidence-without-second-km-proof-chain-2026-08-05` | In progress | Proof + implementation | deletion/retention propagation, export negative controls, privacy/security proof |
| 3. Trustworthy stage metrics | `outcome-metrics-proof-chain-2026-08-05` | Foundation | Implementation + proof | native ticket/social adapters, richer comparisons, suppression, exports, Phase 2 release proof |
| 4. Reusable portfolio and owned initiatives | `outcome-portfolio-proof-chain-2026-08-05` | Foundation | Implementation | routed product surfaces, reporting/governance breadth, end-to-end acceptance |
| 5. Macro/subjourneys and service blueprint | `outcome-hierarchy-proof-chain-2026-08-05` | Foundation | Implementation | mounted APIs, routed workspaces, exports, permission/performance proof |
| 6. Supported consent-aware SDK and governed event source | `sdk-release-shaped-unpublished-2026-08-05`, `sdk-publish-preflight-blockers-2026-08-05`, `sdk-main-landing-proof-2026-08-06`, `sdk-publication-readiness-report-2026-08-06` | In progress | External setup + proof | dogfood/security/SLO gate, npm ownership/auth, workflow activation |
| 7. Debug and map events to published journey-stage rules | `outcome-stage-rule-debug-proof-chain-2026-08-05`, `stage-processing-retained-reprojection-slice-2026-08-05` | In progress | Proof | production-scale reprojection/performance proof, fuller dogfood/signoff |
| 8. Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed differences | `outcome-real-paths-proof-chain-2026-08-05`, `outcome-real-paths-and-observed-vs-designed-2026-08-05`, `actual-path-subject-scoped-surface-2026-08-05` | In progress | Implementation + proof | product-scale comparisons, broader designed-versus-observed reconciliation, correction/runtime proof |
| 9. Permissioned Customer/Account 360 | `outcome-customer-360-proof-chain-2026-08-05`, `journey-identity-persistence-slice-2026-08-05`, `journey-identity-groups-and-timeline-slice-2026-08-05`, `journey-identity-sessions-slice-2026-08-05`, `journey-identity-segments-slice-2026-08-05`, `journey-customer-360-read-slice-2026-08-05` | In progress in backend foundations; not started at full product scope | Implementation + proof | durable UI/product completion over identity/accounts/privacy foundations |
| 10. Deterioration, gaps, loops, abandonment, justified risk | `outcome-deterioration-risk-proof-chain-2026-08-05`, `outcome-deterioration-gaps-risk-2026-08-05` | Not started at product scope | Implementation | reviewed anomaly/risk layer and predictive governance are still missing |
| 11. Safe consent-aware idempotent human-governed recovery actions | `outcome-human-governed-action-proof-chain-2026-08-05`, `outcome-human-governed-action-2026-08-05` | Not started | Implementation | workflow definitions, action runtime, adapters, kill switches |
| 12. Roles, plans, quotas, retention, flags, audit, observability, runbooks | `outcome-governance-proof-chain-2026-08-05`, `outcome-roles-plans-quotas-runbooks-2026-08-05` | Foundation | Implementation + proof | route-by-route enforcement, ratified runbooks/SLOs, rollout proof |

## Per-outcome proof checklist

Each outcome below is kept deliberately short and operational:

- Proves now: what current repository evidence positively supports
- Does not yet prove: what the current evidence explicitly leaves open
- Remaining blocker class: implementation, proof, or external setup
- Next anchor: the single most direct file, test, or script to inspect or move next
- Next command: the single most direct command to rerun or use when the next step is proof-heavy

### 1. Visual multi-persona designed journey

- Evidence IDs: `outcome-persona-journey-proof-chain-2026-08-05`
- Proves now: strong Phase 1 journey-design foundations and a real proof chain exist.
- Does not yet prove: saved-view depth, accessibility certification, or signed release-grade gates.
- Remaining blocker class: proof
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) for the Phase 1 requirement chain before choosing the next product/test slice.
- Next command: `npm run validate:journey-plan`

### 2. Exact existing evidence without a second knowledge engine

- Evidence IDs: `outcome-evidence-without-second-km-proof-chain-2026-08-05`
- Proves now: Research Hub and authoritative evidence-link foundations are real and tracked.
- Does not yet prove: full deletion/retention propagation, export negative controls, or complete privacy/security release proof.
- Remaining blocker class: implementation + proof
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) for the Phase 1 and Phase 2 evidence requirements that still remain open.
- Next command: `npm run validate:journey-plan`

### 3. Trustworthy stage NPS/CSAT/CES, sentiment and operations

- Evidence IDs: `outcome-metrics-proof-chain-2026-08-05`
- Proves now: deterministic metric foundations and Phase 2 proof-chain anchoring exist.
- Does not yet prove: full analytics product completion, native ticket/social adapters, richer comparisons, suppression, exports, or Phase 2 release proof.
- Remaining blocker class: implementation + proof
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) for the Phase 2 requirement chain and missing proof list.
- Next command: `npm run validate:journey-plan`

### 4. Reusable portfolio and owned initiatives

- Evidence IDs: `outcome-portfolio-proof-chain-2026-08-05`
- Proves now: durable Phase 3 foundations and proof-chain binding exist.
- Does not yet prove: complete product surfaces, reporting/export/governance breadth, or release-grade acceptance.
- Remaining blocker class: implementation
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) for the Phase 3 requirement chain before selecting the next routed product surface.

### 5. Macro/subjourneys and complete service blueprint

- Evidence IDs: `outcome-hierarchy-proof-chain-2026-08-05`
- Proves now: durable Phase 4 groundwork and proof-chain binding exist.
- Does not yet prove: mounted APIs, routed hierarchy/blueprint workspaces, export fidelity, or performance/permission release proof.
- Remaining blocker class: implementation
- Next anchor: [backend/src/journeyServiceBlueprint.ts](../../backend/src/journeyServiceBlueprint.ts) because this is the current repo anchor for the newer blueprint foundation that still needs fuller productisation.

### 6. Supported consent-aware SDK and governed event source

- Evidence IDs: `sdk-release-shaped-unpublished-2026-08-05`, `sdk-publish-preflight-blockers-2026-08-05`, `sdk-main-landing-proof-2026-08-06`, `sdk-publication-readiness-report-2026-08-06`
- Proves now: release-shaped unpublished SDK packages and explicit publish-preflight blockers are recorded; the destructive-isolated PostgreSQL ingest gate now also passes with zero reconciliation drift, exercised stage processing, least-privilege runtime-role proof, and zero stored/logged sentinel findings; and the consolidated August 6, 2026 SDK publication-readiness artifact now also proves that `main` still lacks the full required publish-state while npm authentication, `@seemplify` scope readiness, disabled workflow activation, and local Node/npm version gaps remain open blockers.
- Does not yet prove: authorised npm publication readiness, ratified SLO/capacity approval, full dogfood completion, or npm-side ownership/auth readiness.
- Remaining blocker class: external setup + proof
- Next anchor: [operations/latest-sdk-publication-readiness-report.md](./operations/latest-sdk-publication-readiness-report.md) because it is the most complete current executable summary of landing, delta, publish-preflight, and workstation blockers.
- Next command: `npm run report:sdk:publication-readiness`

### 7. Debug and map events to published journey-stage rules

- Evidence IDs: `outcome-stage-rule-debug-proof-chain-2026-08-05`, `stage-processing-retained-reprojection-slice-2026-08-05`
- Proves now: stage-rule runtime, reprojection slice, and proof-chain anchoring exist; runtime-30 retained reprojection passes inside the disposable PostgreSQL harness, and the destructive ingest gate also exercises runtime-18 stage processing successfully.
- Does not yet prove: production-scale reprojection/performance capacity, fuller dogfood/signoff, or signed release approval.
- Remaining blocker class: proof
- Next anchor: [../../scripts/probe-journey-stage-reprojection-postgres.mjs](../../scripts/probe-journey-stage-reprojection-postgres.mjs) because the next meaningful movement is stronger runtime/performance evidence, not just more narrative.
- Next command: `node scripts/test-postgres-e2e.mjs --contract-only` because the reprojection probe is designed to run inside the disposable PostgreSQL harness that provides the required write flag and E2E database shape.

### 8. Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed differences

- Evidence IDs: `outcome-real-paths-proof-chain-2026-08-05`, `outcome-real-paths-and-observed-vs-designed-2026-08-05`, `actual-path-subject-scoped-surface-2026-08-05`
- Proves now: a real subject-scoped actual-path surface exists with durable snapshots/rollups and known-profile stitched reads.
- Does not yet prove: product-scale comparisons, broader designed-versus-observed reconciliation, or operational correction/runtime proof.
- Remaining blocker class: implementation + proof
- Next anchor: [../../frontend/src/pages/JourneyMetricsPage.tsx](../../frontend/src/pages/JourneyMetricsPage.tsx) because broader comparisons and designed-versus-observed productisation will surface there first.
- Next command: `npx tsx --test backend/test/journey-actual-paths-routes.test.ts`

### 9. Permissioned Customer/Account 360

- Evidence IDs: `outcome-customer-360-proof-chain-2026-08-05`, `journey-identity-persistence-slice-2026-08-05`, `journey-identity-groups-and-timeline-slice-2026-08-05`, `journey-identity-sessions-slice-2026-08-05`, `journey-identity-segments-slice-2026-08-05`, `journey-customer-360-read-slice-2026-08-05`
- Proves now: meaningful backend identity, timeline, session, segment, and first 360 read-model slices exist.
- Does not yet prove: a full end-user 360 product surface, full privacy-job completion across raw/derived stores, or broader connector-backed 360 completeness.
- Remaining blocker class: implementation + proof
- Next anchor: [../../backend/src/journeyIdentityRoutes.ts](../../backend/src/journeyIdentityRoutes.ts) because the current 360 surface is still backend-first and any extension of scope or proof begins there.
- Next command: `npx tsx --test backend/test/journey-identity-routes.test.ts`

### 10. Detect deterioration, gaps, loops, abandonment and justified risk

- Evidence IDs: `outcome-deterioration-risk-proof-chain-2026-08-05`, `outcome-deterioration-gaps-risk-2026-08-05`
- Proves now: the proof chain explicitly records that only limited foundations exist today.
- Does not yet prove: reviewed anomaly/risk detection or predictive churn/conversion controls.
- Remaining blocker class: implementation
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) because the next step is choosing which unmet P5C-02 or P5C-03 slice to implement first.
- Next command: `npm run validate:journey-plan`

### 11. Safe consent-aware idempotent human-governed recovery actions

- Evidence IDs: `outcome-human-governed-action-proof-chain-2026-08-05`, `outcome-human-governed-action-2026-08-05`
- Proves now: the proof chain explicitly records this runtime/product area as not started.
- Does not yet prove: workflow runtime, action adapters, kill switches, or consequential-action safety gates.
- Remaining blocker class: implementation
- Next anchor: [../CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md](../CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md) section 3.8 and Phase 5D requirements, because this lane is still plan-first rather than code-first.
- Next command: `npm run validate:journey-plan`

### 12. Roles, plans, quotas, retention, flags, audit, observability and runbooks

- Evidence IDs: `outcome-governance-proof-chain-2026-08-05`, `outcome-roles-plans-quotas-runbooks-2026-08-05`
- Proves now: cross-cutting governance foundations and proof-chain binding exist, and the destructive ingest gate now produces a stable machine-readable operations artifact with reconciliation, latency, security, and remaining-blocker fields.
- Does not yet prove: route-by-route enforcement completion, ratified runbooks/SLOs, rollout gates, or published-documentation completion.
- Remaining blocker class: implementation + proof
- Next anchor: [../../docs/journey-management/operations/latest-ingest-gate-report.md](../../docs/journey-management/operations/latest-ingest-gate-report.md) for the newest machine-readable operations evidence and [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md) for the broader cross-cutting proof chain.
- Next command: `$env:JOURNEY_POSTGRES_GATE_ALLOW_DOCKER='true'; npm run report:journey-ingest-gate`

## First implementation tranche to execute from the current audit

The best first tranche from the current dependency and evidence picture is:

1. connected-journey release-grade proof
2. then broader actual-path comparisons and reconciliation
3. then Customer/Account 360 product completion

Why this order:

- SDK publication is blocked most directly by the connected-journey proof chain,
  not by package metadata alone
- broader actual-path work depends on the connected-journey runtime and
  strengthens two section-27 outcomes at once
- Customer/Account 360 already has stronger backend foundations than the
  orchestration lane, but it should still follow the higher-dependency
  connected/runtime proof work first

Strongest first execution anchor:

- [../../scripts/probe-journey-stage-reprojection-postgres.mjs](../../scripts/probe-journey-stage-reprojection-postgres.mjs)

Strongest first execution command:

- `node scripts/test-postgres-e2e.mjs --contract-only`

## Evidence and source anchors worth checking first

When continuing the audit or implementation, these are the most useful current
anchors:

- [../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](../CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md)
- [../CONNECTED-JOURNEY-MANAGEMENT-IMPLEMENTATION-STATUS.md](../CONNECTED-JOURNEY-MANAGEMENT-IMPLEMENTATION-STATUS.md)
- [../CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md](../CONNECTED-JOURNEY-MANAGEMENT-COMPLETION-PROOF.md)
- [completion-evidence.json](./completion-evidence.json)
- [../../package.json](../../package.json)
- [../../packages/SDK-RELEASE.md](../../packages/SDK-RELEASE.md)
- [../../packages/SDK-PUBLISH-CHECKLIST.md](../../packages/SDK-PUBLISH-CHECKLIST.md)
- [../../scripts/sdk-publish-preflight.mjs](../../scripts/sdk-publish-preflight.mjs)
- [../../backend/src/journeyActualPathAnalytics.ts](../../backend/src/journeyActualPathAnalytics.ts)
- [../../backend/src/journeyMetricRoutes.ts](../../backend/src/journeyMetricRoutes.ts)
- [../../frontend/src/lib/journeyMetrics.ts](../../frontend/src/lib/journeyMetrics.ts)
- [../../frontend/src/pages/JourneyMetricsPage.tsx](../../frontend/src/pages/JourneyMetricsPage.tsx)

## SDK publication blockers visible from current repository state

The repository currently shows four concrete blockers before an authorised
first npm publish:

1. the publish workflow is still disabled at
   [../../../.github/workflows/publish-journey-sdks.yml.disabled](../../../.github/workflows/publish-journey-sdks.yml.disabled)
2. the intended publish state is not yet on `main`
3. local npm authentication is not yet available
4. `@seemplify` scope ownership/readiness is not yet proven from current npm checks

These are in addition to programme-level blockers already recorded in the SDK
release docs: release-grade durable-ingest proof, fuller Seemplify dogfood, and
ratified privacy/security/operations evidence.

The consolidated current-state artifact for this section is
[./operations/latest-sdk-publication-readiness-report.md](./operations/latest-sdk-publication-readiness-report.md),
which binds the landing check, required-file delta against `main`, publish
preflight blockers, and workstation-version limitations into one dated audit
snapshot.

## Recommended next audit move

The next audit improvement should be to expand the evidence IDs above into a
small per-outcome checklist that explicitly separates:

- what current evidence positively proves
- what current evidence explicitly does not prove
- whether the remaining blocker is missing implementation, missing proof, or
  external publish/setup state
