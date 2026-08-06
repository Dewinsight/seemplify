# Connected Journey Management completion proof

**Status:** In progress  
**Last updated:** 2026-08-06  
**Master plan:** [CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md](./CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md)  
**Traceability ledger:** [CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](./CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md)  
**Evidence register:** [journey-management/completion-evidence.json](./journey-management/completion-evidence.json)

This document does not replace the traceability ledger. It defines how a
programme-completion claim must be proved from current repository evidence.
The ledger remains the authority for requirement IDs and requirement state.
This document governs the quality of the evidence behind those states.

## 1. Evidence grammar

Every evidence record must be addressable, reproducible, bounded, and explicit
about what it does not prove.

Each record in `completion-evidence.json` must contain:

- `evidenceId`
- `requirementIds`
- `class`
- `summary`
- at least one of `command` or `artifactPath`
- `observed`
- `notClaimed`
- `status`

When a record is tied to a real execution, it should also name:

- `commitSha`
- `branch`
- `ranAtUtc`
- `host`
- `invalidatedByPaths`
- `expiresAt`

Records may report external blockers, but external blockers are never treated
as satisfied by implication.

## 2. Evidence classes

The evidence classes match the six classes already defined in the traceability
ledger:

1. Code
2. Data
3. Controls
4. Tests
5. Runtime
6. Operations

No requirement reaches **Verified** unless its named evidence spans the classes
the requirement actually depends on.

## 3. Reproduction matrix

These commands already exist in this repository and should be referenced rather
than re-invented:

- `npm run validate:journey-plan`
- `npm run test:all`
- `node scripts/test-postgres-e2e.mjs --contract-only`
- `node scripts/test-postgres-runtime-migration.mjs`
- `node scripts/journey-postgres-ingest-security-load.mjs`
- `npm run qualify:sdk`
- `npm run report:sdk:publication-readiness`
- `npm run preflight:sdk:publish`
- `npm run verify:sdk:release`
- `npm run test:journey-swift:contract`
- `npm run test:journey-kotlin:contract`

Per-migration PostgreSQL probes under `scripts/probe-journey-*-postgres.mjs`
are also first-class evidence sources.

## 4. Suite-count and run binding rules

Raw suite counts in prose are too easy to stale. The completion-proof model is:

- the evidence register stores the execution record;
- the narrative docs cite the evidence record;
- a future run supersedes an older run by evidence ID, not by silently editing
  counts into prose.

Until all major cited runs are bound this way, narrative counts remain
informative only and do not constitute completion proof.

## 5. Negative controls and non-claims

Every externally meaningful area must state both:

- the negative controls that passed, and
- the scope it still does not claim.

Examples already present elsewhere in the repo include:

- SDK `notClaimed` limits in
  [packages/SDK-QUALIFICATION.json](./../packages/SDK-QUALIFICATION.json)
- operational release prerequisites in
  [journey-management/architecture/OPERATIONS-AND-INCIDENTS.md](./journey-management/architecture/OPERATIONS-AND-INCIDENTS.md)
- quality-gate evidence requirements in
  [journey-management/architecture/QUALITY-BUDGETS.md](./journey-management/architecture/QUALITY-BUDGETS.md)

## 6. Ratification ledger

No major programme gate is complete merely because code exists. Ratification is
separate evidence.

The following sources remain authoritative for ratification scope:

- [journey-management/architecture/README.md](./journey-management/architecture/README.md)
- [journey-management/architecture/QUALITY-BUDGETS.md](./journey-management/architecture/QUALITY-BUDGETS.md)
- [journey-management/architecture/OPERATIONS-AND-INCIDENTS.md](./journey-management/architecture/OPERATIONS-AND-INCIDENTS.md)

An implementation requirement that depends on a proposed/unratified record may
be **Implemented** but not **Verified**.

## 7. Programme-completion gate sheet

The twelve completion outcomes in section 27 of the master plan are not
complete until their traceability proof chains are all **Verified** and the
required release/operations evidence also exists.

The authoritative twelve-outcome proof chain remains:

- [CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](./CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md)

This completion-proof document adds the evidence discipline for those outcomes;
it does not redefine them.

## 8. SDK publish gate sheet

SDK publication is downstream of programme evidence, not separate from it.

The publish claim must satisfy all of:

- required clean verification in
  [packages/SDK-RELEASE.md](./../packages/SDK-RELEASE.md)
- repo/workflow and external npm setup in
  [packages/SDK-PUBLISH-CHECKLIST.md](./../packages/SDK-PUBLISH-CHECKLIST.md)
- the current combined SDK publication-readiness snapshot in
  [journey-management/operations/latest-sdk-publication-readiness-report.md](./journey-management/operations/latest-sdk-publication-readiness-report.md)
- policy constraints and non-claims in
  [packages/SDK-QUALIFICATION.json](./../packages/SDK-QUALIFICATION.json)

As of Thursday, August 6, 2026, the SDKs are release-shaped but unpublished.
No `@seemplify` package is yet published to npm from this repository state.

## 9. Evidence expiry and invalidation

Evidence becomes stale when the thing it proves has materially changed. At
minimum, evidence should be considered invalidated by:

- migration file changes for the cited runtime slice
- validator or test-runner changes
- relevant route, domain, or UI path changes
- package manifest or release-workflow changes for SDK publication claims
- toolchain drift outside the approved/pinned range where the claim depends on
  that toolchain

The evidence register supports `invalidatedByPaths` and `expiresAt` so this can
be tracked explicitly instead of by memory.

## 10. Current audit conclusion

The programme is not complete.

Current evidence proves meaningful implemented foundations across Phases 1–5
and the SDK lane, but it does not yet prove:

- full product completion across the twelve programme outcomes
- full release/operational/ratification gates
- Customer 360, full actual-path product completion, or orchestration runtime
- authorised npm publication readiness

The audit should keep moving by binding more existing claims to explicit
evidence records and by completing missing implementation tranches rather than
repeating broad narrative summaries.

## 11. Current programme-outcome blocker sheet

This section restates the twelve section-27 outcomes as an explicit blocker
view. It is intentionally compact: the traceability ledger remains the detailed
source of truth for the proof chains.

| Outcome | Current state | Highest-value current blockers |
| --- | --- | --- |
| Visual multi-persona designed journey | In progress | Saved-view completion, accessibility certification, release-gate reruns, and broader route-by-route entitlement proof. |
| Exact existing evidence without a second knowledge engine | In progress | Security/privacy gates, retention/deletion propagation, export negative controls, and release-gate reruns. |
| Trustworthy stage NPS/CSAT/CES, sentiment and operations | Foundation | Native ticket/social adapters, privacy suppression, exports, full comparison surfaces, and Phase 2 release proof. |
| Reusable portfolio and owned initiatives | Foundation | Routed portfolio UX, permissions breadth, collaboration/reporting completion, and end-to-end acceptance. |
| Macro/subjourneys and complete service blueprint | Foundation | Mounted APIs, routed hierarchy/blueprint workspace UX, exports, permissions matrix, and release proof. |
| Supported consent-aware SDK and governed event source | In progress | Ratified browser/runtime matrices, durable-endpoint/dogfood/security gates, verified npm scope/authentication, and intentional workflow activation. |
| Debug and map events to published stage rules | In progress | Runtime-30 retained reprojection now has execution proof plus a stronger August 5, 2026 multi-batch contract-run slice over 25 retained events in 6 batches, and the dogfood activation report now prefers authoritative onboarding/workspace platform-audit milestones where present, but broader production-scale performance proof, a fuller dogfood reconciliation run with fresh ChatGPT/runtime activity, and signed release approval remain open. |
| Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed | In progress | A first actual-path product surface now exists inside Journey Metrics with durable subject-scoped snapshots/rollups for both anonymous-only and known-profile stitched views, but product-scale comparisons, broader designed-versus-observed reconciliation, and operational correction/performance proof remain open. |
| Permissioned Customer/Account 360 | In progress | Backend identity persistence, accounts/groups, permissioned timeline and Customer/Account 360 reads, plus consent/privacy-job foundations now exist; richer connectors, broader privacy completion, and user-facing product depth remain. |
| Detect deterioration, gaps, loops, abandonment and justified risk | Not started | Full alerts/analytics/path productisation beyond the new subject-scoped actual-path slice plus reviewed anomaly/risk and governed predictive layers. |
| Safe consent-aware idempotent human-governed action | Not started | Workflow definitions, action runtime, adapters, kill switches, and consequential-action safety proof. |
| Roles, plans, quotas, retention, flags, audit, observability and runbooks | Foundation | Route-by-route enforcement completion, privacy controls, ratified runbooks/telemetry/SLOs, and signed rollout gates. |

The strongest completion blocker across the whole programme remains the same:
many areas have meaningful foundations, but the release-grade proof chain is
not yet complete for the twelve outcomes above.

## 11A. Section-27 outcome verification matrix

This matrix is stricter than the compact blocker sheet above. It records, for
each section-27 outcome, what current repository evidence positively proves,
what it still does not prove, and the shortest remaining path to a credible
**Verified** claim from the present worktree.

| Outcome | Current proof from repo evidence | What current evidence still does not prove | Highest-value next proof or implementation step |
| --- | --- | --- | --- |
| Visual multi-persona designed journey | Journey Map 2.0 now has durable definitions/versions, current-vs-future comparison, governed templates, custom lanes, editor sessions with conflict recovery, rich cards, presentation/export, and reusable personas with comparison. Focused backend contracts, production build/typecheck, and targeted desktop/mobile browser scenarios pass. | It does not yet prove complete saved-view depth, packaged prior-release compatibility, WCAG certification, or the combined release/security/performance gates. | Finish saved-view/routing depth and bind final accessibility plus release-gate reruns to explicit evidence records. |
| Exact existing evidence without a second knowledge engine | Authoritative fail-closed evidence adapters and the routed Research Hub exist. Exact reauthorisation, immutable snapshots, assessments, contradictions/staleness rules, resumable intake, monitored refresh, and desktop/mobile focused browser acceptance are proven. | It does not yet prove full deletion/retention propagation, synthesis presentation depth, export negative controls, or ratified privacy/security release proof. | Complete deletion/retention/export controls and bind them to explicit security/privacy/runtime evidence. |
| Trustworthy stage NPS/CSAT/CES, sentiment and operations | Durable metric bindings, versioned definitions/observations, rebuild/correction jobs, lineage, freshness/sample warnings, and deterministic metric-alert lifecycle are implemented and tested. A routed metrics workspace exists. | It does not yet prove the full product outcome because native ticket/social adapters, richer comparison surfaces, privacy suppression, exports, and final Phase 2 release gates are incomplete. | Finish native adapters/comparisons/exports and bind performance/freshness/security gates to the metric outcome proof chain. |
| Reusable portfolio and owned initiatives | Durable portfolio, collaboration, saved-view, ownership, lifecycle, scoring, links, baselines, and some governance foundations now exist in backend/migrations and are reflected in the traceability ledger. | It does not yet prove a complete portfolio product with routed UX breadth, collaboration/reporting completeness, or end-to-end governance/release acceptance. | Productise the routed portfolio surfaces and prove role/reporting/export behaviour end to end. |
| Macro/subjourneys and complete service blueprint | Durable hierarchy and runtime-29 blueprint schemas, typed links, comparison contracts, and backend tests exist. The audit now correctly treats this as more than a pure contract-only area. | It does not yet prove mounted APIs, full routed hierarchy/blueprint workspaces, export fidelity, permission breadth, or Phase 4 release acceptance. | Mount and validate the routed hierarchy/blueprint product surfaces and bind export/permission/performance proof. |
| Supported consent-aware SDK and governed event source | Canonical protocol, durable source/key/schema control plane, `/v1/events` and `/v1/batch`, replay/debug/dead-letter foundations, and five release-shaped unpublished npm SDKs are proven locally. `qualify:sdk`, `verify:sdk:release`, native contract gates, and GitHub `npm-production` environment checks pass. | It does not yet prove npm publication, trusted publisher configuration, ratified browser/runtime/device support matrices, or completion of the connected-journey dogfood/security/operations gates. | Finish the connected-journey release gate, then clear repo/workflow and npm-side publish blockers. |
| Debug and map events to published stage rules | Durable stage-rule authoring/simulation/publication, restarted worker, immutable decisions/visits, anonymous instances, and aggregate reads are implemented. Runtime-30 retained reprojection now has focused execution proof, a stronger August 5, 2026 multi-batch contract-run slice over 25 retained events in 6 batches, the targeted browser regressions are green again, and the dogfood activation report now prefers authoritative onboarding/workspace audit milestones where available. | It does not yet prove production-scale retained reprojection/performance capacity, release-grade observability/operations, or fuller dogfood/signoff. | Add production-scale reprojection/performance proof and a fuller dogfood/release signoff run. |
| Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed | Pure actual-path analytics and stage-processing foundations now extend to a real actual-path API and Journey Metrics surface with focused route/runtime proof, durable subject-scoped snapshots and rollups, known-profile stitched reads, freshness signals, and snapshot-to-current reconciliation deltas. | It does not yet prove product-scale comparisons, broader designed-vs-observed reconciliation UX, secondary suppression depth, or operational reconciliation/correction at product scale. | Extend the current durable subject-scoped slice into broader comparisons and reconciliation workflows, then add stronger runtime/performance proof. |
| Permissioned Customer/Account 360 | A durable backend foundation now exists: persisted identity/binding/group/session/segment state, permissioned profile and account timeline reads, permissioned Customer/Account 360 reads, and first purpose-gated privacy/export/suppression job behaviour are all present with focused route proof. | It does not yet prove a full routed 360 product surface, broader connector-backed timelines, field-level sensitive controls, or privacy-job completion across every raw/derived/action store. | Extend the backend foundation into the full user-facing 360 product and complete end-to-end privacy propagation/release proof. |
| Detect deterioration, gaps, loops, abandonment and justified risk | Deterministic metric-alert lifecycle exists and actual-path analytics now have an initial subject-scoped product surface, so there is stronger foundation for future governed risk surfaces. | It does not yet prove reviewed anomaly/risk detection, full-scope path analytics/risk productisation, or governed predictive layers. | Finish broader path productisation first, then add reviewed deterministic deterioration/risk surfaces before any predictive layer. |
| Safe consent-aware idempotent human-governed action | Cross-cutting consent, metering, and audit foundations exist elsewhere in the programme. | It does not yet prove workflow definitions, action runtime, adapters, kill switches, or consequential-action safety proof. This remains genuinely not started at product/runtime scope. | Implement workflow definitions and the idempotent action runtime only after identity/privacy/path foundations are stronger. |
| Roles, plans, quotas, retention, flags, audit, observability and runbooks | Managed plan catalogues, quota/usage ledger foundations, rollout controls, and proposed architecture/operations records exist. Some route-level feature enforcement already exists in specific areas. | It does not yet prove route-by-route capability enforcement across the programme, privacy controls, ratified telemetry/SLO/runbooks, rollout gates, or published docs. | Complete route-by-route enforcement and bind ratified ops/runbook/rollout proof to the cross-cutting chain. |

## 12. Current SDK publication blocker sheet

The SDKs are closer to publication than the full programme, but the publish
path is still blocked by both repo-side and external requirements.

### Repo/workflow blockers still present

- The publish workflow is still disabled at
  `../.github/workflows/publish-journey-sdks.yml.disabled`.
- The current working branch is not `main`.
- `main` does not yet contain the newer SDK publish-policy and evidence files
  that this branch now relies on, including `packages/SDK-QUALIFICATION.json`,
  `packages/SDK-RELEASE.md`, `packages/SDK-PUBLISH-CHECKLIST.md`, and
  `scripts/sdk-publish-preflight.mjs`.
- `npm run preflight:sdk:landing` now proves that those required files are
  still missing on `main`.
- `npm run evidence:sdk:delta` now shows the exact required-file delta between
  the current working tree and `main`, including untracked working-tree files
  that have not yet landed on `main`.

### External blockers still present

- `npm whoami` is not currently authenticated on this machine.
- `npm org ls seemplify` does not yet prove the `@seemplify` organisation is
  ready.
- Trusted publishing cannot yet be treated as configured from repository
  evidence alone.

### Programme blockers that still constrain SDK publication

Even with release-shaped packages, publication is still downstream of the
programme gates explicitly called out in the SDK release docs:

- durable endpoint / ingestion proof is not yet release-complete
- Seemplify dogfood now has a generated reconciliation artifact, but the current August 6, 2026 report still shows zero ChatGPT-connected users, zero ChatGPT-selected users, and zero journey-created milestones in the sampled local evidence; ratified load/SLO/security gates and a fuller end-to-end activation run remain open
- privacy/security/operations evidence is not yet fully ratified

### What would prove the first publish actually happened

All of the following must be true:

1. `npm run preflight:sdk:publish` reports no repo/workflow or external
   blockers.
2. `npm run preflight:sdk:landing` reports that `main` already contains the
   required SDK publish-state files, and `npm run evidence:sdk:delta` shows no
   remaining required-file delta against `main`.
3. The publish workflow is active on `main`.
4. The GitHub Actions publish run succeeds in `npm-production`.
5. `npm view @seemplify/journey-event-protocol@next version` returns the
   released version.
6. The coordinated package set exists on npm under the `next` dist-tag.

Until then, the SDK lane should be described as release-shaped and unpublished,
not published.

## 12A. Execution checklist from current evidence

This checklist converts the current audit into an execution view. Each row is
classified by the kind of work that remains and whether it blocks SDK
publication specifically or only the wider end-to-end programme completion.

| Area | Blocking scope | Remaining work type | Concrete remaining work from current evidence |
| --- | --- | --- | --- |
| Publish workflow activation | SDK publication | Repo/workflow | Rename `../.github/workflows/publish-journey-sdks.yml.disabled` only when npm-side setup and programme gates are actually ready. |
| Publish branch state | SDK publication | Repo/workflow | Merge the intended SDK publish state onto `main`; current branch is not `main`, `main` does not yet contain the newer SDK publish-policy/checklist/preflight files this branch now uses, and the new landing/delta commands should both turn green before workflow activation is treated as meaningful. |
| npm authentication and scope ownership | SDK publication | External setup | Prove `npm whoami`, confirm `@seemplify` organisation ownership, and complete trusted-publisher configuration for the exact repository/workflow/environment. |
| Connected-journey durable endpoint release gate | SDK publication and programme | Proof/ops | The durable ingest plane is correct and well-tested, but not yet release-complete: ratified security/privacy, sustained load/SLO, failover, and signed release proof remain open. |
| Seemplify activation dogfood | SDK publication and programme | Runtime/proof | The repo has a generated activation report, but the current August 6, 2026 artifact still shows zero ChatGPT-connected users, zero ChatGPT-selected users, zero journey-created milestones, and zero activation/runtime audit events in its sampled local evidence; a fuller end-to-end run with live ChatGPT/runtime milestones and release-grade signoff remains missing. |
| Stage reprojection scale proof | SDK publication and programme | Runtime/proof | Runtime-30 retained reprojection is implemented, exercised, and now has a multi-batch contract-run slice over 25 retained events, but production-scale reprojection/performance evidence is still missing. |
| Visual designed-journey completion | Programme only | Product + proof | Finish saved-view depth and final accessibility/security/performance/release gates. |
| Evidence/Research Hub completion | Programme only | Product + proof | Complete retention/deletion propagation, export negative controls, synthesis presentation depth, and privacy/security release evidence. |
| Metrics/sentiment completion | Programme only | Product + proof | Add native ticket/social adapters, richer comparisons, privacy suppression, exports, and final Phase 2 release proof. |
| Portfolio productisation | Programme only | Product | Route and finish portfolio UX, collaboration/reporting breadth, and end-to-end permissions/governance acceptance. |
| Hierarchy/blueprint productisation | Programme only | Product | Mount the routed hierarchy/blueprint APIs and workspaces, then prove exports/permissions/performance. |
| Actual paths and designed-vs-observed | Programme only | Product + proof | Extend the existing durable subject-scoped path projections/rollups with broader comparisons, designed-versus-observed productisation, and reconciliation/correction/runtime proof. |
| Customer/Account 360 | Programme only | New implementation | Build persistence, accounts/groups, privacy jobs, and permissioned 360 timelines. |
| Deterioration/risk layers | Programme only | New implementation | Productise path/alert surfaces, then add reviewed deterministic risk layers before any predictive gates. |
| Human-governed action runtime | Programme only | New implementation | Implement workflow definitions, idempotent action runtime, adapters, kill switches, and consequential-action proof. |
| Cross-cutting governance/runbooks/docs | Programme only | Controls/ops/docs | Finish route-by-route capability enforcement, privacy controls, ratified telemetry/SLO/runbooks, rollout gates, and published documentation. |

## 13. Recommended next implementation order from the current audit

The audit now makes it clearer which unfinished areas are merely broad and
which ones are real dependency bottlenecks. The next implementation order
should follow the dependency path already described in the master plan while
prioritising the areas that unblock the largest number of outcomes.

### Priority 1 — finish the connected-journey release gate around what already exists

Why first:

- it directly affects the SDK publication path
- it strengthens the event/control/data-plane foundations already built
- it reduces the risk of publishing SDKs against an incompletely evidenced
  backend

Concrete scope:

- runtime-30 retained reprojection is now implemented, exercised, and strengthened by a multi-batch contract-run slice, but broader reprojection/performance proof remains open
- Seemplify dogfood reconciliation for the activation journey now has a generated bounded report with authoritative onboarding/workspace audit milestones where available, but it still needs a fuller run with live ChatGPT/runtime milestones and release-grade sign-off
- stronger ratified security/privacy/operations evidence
- ratified load/SLO/capacity proof for the connected-journey plane

Primary outcome impact:

- Supported consent-aware SDK and governed event source
- Debug and map events to published stage rules
- Roles, plans, quotas, retention, flags, audit, observability and runbooks

### Priority 2 — extend actual-path comparisons and product surfaces

Why second:

- it depends on the connected-journey foundations above
- it unlocks both actual-path outcomes and deterioration/risk outcomes
- it closes a major section-27 gap without requiring orchestration first

Concrete scope:

- broader path comparisons over the existing durable subject-scoped projections/rollups
- path APIs and accessible UI/table alternatives
- designed-versus-observed comparison surfaces
- reconciliation and correction handling for path data

Primary outcome impact:

- Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed
- Detect deterioration, gaps, loops, abandonment and justified risk

### Priority 3 — build Customer/Account 360 and privacy jobs

Why third:

- it depends on identity, consent, and connected data foundations
- it is one of the most obviously absent section-27 outcomes
- it is a prerequisite for any credible consequential-action layer

Concrete scope:

- identity persistence and jobs beyond the current pure reducer
- accounts/groups/memberships/materialised segments
- permissioned 360 timeline and fact/inference/evidence distinctions
- consent/suppression/export/correction/erasure/retention jobs

Primary outcome impact:

- Permissioned Customer/Account 360
- Roles, plans, quotas, retention, flags, audit, observability and runbooks

### Priority 4 — finish hierarchy/blueprint and portfolio productisation

Why fourth:

- durable foundations exist already
- these areas are behind the code less because of missing contracts and more
  because of incomplete routed UX and release evidence
- they improve product completeness without blocking the SDK publish gate as
  directly as the earlier priorities

Concrete scope:

- mounted APIs and routed workspaces for hierarchy and blueprints
- portfolio table/Kanban/matrix/dashboard surfaces
- export fidelity, permission breadth, and large-volume performance

Primary outcome impact:

- Reusable portfolio and owned initiatives
- Macro/subjourneys and complete service blueprint

### Priority 5 — only then build orchestration/runtime actions

Why last:

- the master plan explicitly makes orchestration downstream of identity,
  consent, idempotency, stage rules, and audit
- it is still largely not started
- doing it earlier would outrun the proof chain for safe consequential actions

Concrete scope:

- workflow definitions and simulation
- idempotent action runtime and transactional outbox
- reviewed external adapters
- layered kill switches and approval controls

Primary outcome impact:

- Safe consent-aware idempotent human-governed action

## 14. Current audit verdict

The audit is now mature enough to support prioritised implementation decisions,
not just narrative status reporting.

What it proves today:

- the programme has meaningful foundations across Phases 1–5
- the proof map now explicitly covers all twelve section-27 outcomes
- the SDKs are release-shaped locally but unpublished

What it still does not prove:

- any requirement is **Verified**
- the programme is end-to-end complete
- the SDKs are publishable today
