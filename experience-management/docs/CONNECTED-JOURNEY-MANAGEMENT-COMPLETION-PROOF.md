# Connected Journey Management completion proof

**Status:** In progress  
**Last updated:** 2026-08-08
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

The repository validator now enforces more than table shape. It also requires
every one of the 85 requirements to have at least one evidence record, checks
artifact and invalidation paths against the project or repository root, checks
referenced root npm scripts and supporting evidence IDs, and rejects a
`Verified` row that lacks implemented test plus runtime/operations evidence or
still has a registered blocking record. A green validator therefore proves
referential integrity and minimum proof-chain structure; it still does not
prove that a command was recently executed or that an external approval was
granted.

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
- `npm run report:journey:release-gate`
- `npm run qualify:sdk`
- `npm run report:journey:closure-blockers`
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
- complete Customer/Account 360 privacy propagation, broader actual-path comparisons and designed-versus-observed completion, or release-qualified consequential automation
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
| Trustworthy stage NPS/CSAT/CES, sentiment and operations | In progress | Runtime41/43/45 add privacy-suppressed stage comparisons and authoritative survey/event feeds, and Runtime 52 adds the governed response-linked service-recovery-ticket feed. A governed social contract, broader feeds, product scale, external privacy/accessibility review and Phase 2 release proof remain. |
| Reusable portfolio and owned initiatives | In progress | Status Kanban, aggregate executive CSV, Runtime 46 private saved views and approval-gated requested-target transitions now pass focused backend, live PostgreSQL and manager/member desktop/mobile acceptance. Retention, enterprise performance and release proof remain. |
| Macro/subjourneys and complete service blueprint | In progress | Hierarchy and service blueprints have mounted, entitlement-aware APIs and routed workspaces. Shared-tree/impact/breadcrumb/taxonomy governance, revisioned settings, transparent health snapshots and governed export pass; five-lane blueprint authoring, resources/relationships, exact-revision portfolio causality links, analysis, persisted gap review, current/future comparison, Runtime 48 targeted non-causal measurement, governed export and Runtime 55 private saved views pass focused backend, live PostgreSQL and desktop/mobile browser proof. Ratified enterprise performance, the full release matrix and signed review remain. |
| Supported consent-aware SDK and governed event source | In progress | Ratified browser/runtime matrices, durable-endpoint/dogfood/security gates, verified npm scope/authentication, and intentional workflow activation. |
| Debug and map events to published stage rules | In progress | Runtime-30 retained reprojection now has execution proof plus a stronger August 5, 2026 multi-batch contract-run slice over 25 retained events in 6 batches, and the dogfood activation report now prefers authoritative onboarding/workspace platform-audit milestones where present, but broader production-scale performance proof, a fuller dogfood reconciliation run with fresh ChatGPT/runtime activity, and signed release approval remain open. |
| Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed | In progress | Journey Metrics now includes bounded previous-period path/stage comparisons, complementary suppression, exact baseline/current processing lineage, accessible flow tables and governed correction/reprojection UX. Runtime 50 adds PostgreSQL/SQLite durable snapshots, rollups, artifact revisions and fenced privacy invalidation with live rollback/replay and least-privilege proof. Broader automatic reconciliation, sustained performance and release evidence remain open. |
| Permissioned Customer/Account 360 | In progress | Routed Customer identities and Customer/Account 360 workspaces now present persisted profiles, accounts/groups, sessions, memberships, segments, purpose-gated timelines and privacy operations. Manager merge/split preflight/confirmation/audit and Runtime 47 fenced privacy propagation also pass focused desktop/mobile and live PostgreSQL proof. Richer connectors, automated privacy refresh, external legal/backup/regional authority and release qualification remain. |
| Detect deterioration, gaps, loops, abandonment and justified risk | In progress | Deterministic alerts/path indicators and persisted abstention-first predictive governance exist; trained production-model validation, calibration/fairness, monitoring and release proof remain. |
| Safe consent-aware idempotent human-governed action | In progress | Runtimes35–44 provide workflows, queue/worker safety, reviewed internal/signed-webhook effects and five-level kill switches; live providers, multi-node no-duplicate proof and signed operations approval remain. |
| Roles, plans, quotas, retention, flags, audit, observability and runbooks | Foundation | Managed plan catalogues, quota/usage-ledger foundations, rollout controls, and proposed operations records already exist, but route-by-route capability enforcement, privacy controls, ratified runbooks/telemetry/SLOs, published docs, and signed rollout gates remain. |

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
| Exact existing evidence without a second knowledge engine | Authoritative fail-closed evidence adapters and the routed Research Hub exist. Exact reauthorisation, immutable snapshots, assessments, contradictions/staleness rules, resumable intake, monitored refresh, and desktop/mobile focused browser acceptance are proven. Runtime 54 adds a disabled-by-default evidence-link monitor with fenced leases, current/changed/stale/unavailable/authority-missing outcomes, content-safe transition receipts and authority-loss invalidation that also drops the link from viewer-authorised export notes. | It does not yet prove full deletion/retention propagation, synthesis presentation depth, export negative controls, external monitor notifications, sustained multi-node monitoring, or ratified privacy/security release proof. | Complete deletion/retention/export controls and bind them to explicit security/privacy/runtime evidence. |
| Trustworthy stage NPS/CSAT/CES, sentiment and operations | Durable metrics/rebuilds/alerts now extend through runtimes41/43/45/52 to a governed stage-intelligence store, authoritative survey-response, journey-event and response-linked service-recovery-ticket feeds, sample-thresholded persona/segment/cohort/channel comparisons, deterministic sentiment/emotion aggregates and bounded privacy-safe lineage/export. A schema-free trends route and semantic table add independently suppressed 1–31-day buckets, explicit empty periods and exact fingerprints. Focused SQLite/PostgreSQL, route, worker and desktop/mobile evidence passes, including a runtime-52 dedicated-role two-worker crash/reclaim/stale-fence probe. | It does not prove an authoritative social stage feed, which stays fail-closed without immutable classifier, consent, purpose, retention and identity provenance, nor persisted trend views, alert linkage, product-scale calibration, external privacy/accessibility approval, ratified SLO/soak or Phase 2 release eligibility. | Add only further authoritative producers where governed source semantics exist, then bind scale, privacy/accessibility and release approvals. |
| Reusable portfolio and owned initiatives | Durable portfolio/collaboration foundations feed table, lifecycle Kanban, matrix, relationship/dependency and scoring views plus an aggregate-only executive report and formula-safe CSV. Runtime 46 adds private saved-view versions/defaults and exact approval-gated requested-target transitions. Exact baseline/comparison evidence remains descriptive and non-causal. Manager/member backend, live PostgreSQL and desktop/mobile tests pass. | Graph/enterprise scale, retention, accessibility/security and combined release proof remain. | Close the permission/export/performance/retention/release matrix and broader saved-view parity. |
| Macro/subjourneys and complete service blueprint | Durable runtime-29 hierarchy/blueprint schemas, mounted APIs, strict clients and routed workspaces include hierarchy health/settings, governed hierarchy/blueprint JSON and formula-safe CSV export, exact-revision blueprint portfolio causality links, Runtime 48 targeted descriptive measurement and Runtime 55 private hierarchy/blueprint saved views. Focused tenant/permission/entitlement tests, live PostgreSQL contracts and desktop/mobile flows pass. | It does not yet prove ratified enterprise graph/blueprint performance, accessibility/security certification or Phase 4 release acceptance. | Bind the existing product paths to the combined permission/export/performance and signed release proof. |
| Supported consent-aware SDK and governed event source | Canonical protocol, durable source/key/schema control plane, `/v1/events` and `/v1/batch`, replay/debug/dead-letter foundations, Runtime 53 dedicated-role raw retention that purges only terminal, fully expired, non-stage-linked chains while active and stage-linked chains fail closed, and five release-shaped unpublished npm SDKs are proven locally. `qualify:sdk`, `verify:sdk:release`, native contract gates, and GitHub `npm-production` environment checks pass. | It does not yet prove npm publication, trusted publisher configuration, ratified browser/runtime/device support matrices, or completion of the connected-journey dogfood/security/operations gates. | Finish the connected-journey release gate, then clear repo/workflow and npm-side publish blockers. |
| Debug and map events to published stage rules | Durable stage-rule authoring/simulation/publication, restarted worker, immutable decisions/visits, anonymous instances, and aggregate reads are implemented. Runtime-30 retained reprojection now has focused execution proof, a stronger August 5, 2026 multi-batch contract-run slice over 25 retained events in 6 batches, the targeted browser regressions are green again, and the dogfood activation report now prefers authoritative onboarding/workspace audit milestones where available. | It does not yet prove production-scale retained reprojection/performance capacity, release-grade observability/operations, or fuller dogfood/signoff. | Add production-scale reprojection/performance proof and a fuller dogfood/release signoff run. |
| Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed | Pure analytics, the routed Journey Metrics surface, bounded 10,000-candidate previous-period path/stage comparisons, primary plus complementary suppression, exact processing lineage, correction/reprojection UX, and Runtime 50 PostgreSQL durability/privacy now have focused and live-database proof. | It does not yet prove broad automatic reconciliation across every producer, sustained production-scale concurrency/soak, accessibility/security approval or rollout. | Connect remaining producer-specific reconciliation scopes and obtain stronger operational, performance and release proof. |
| Permissioned Customer/Account 360 | Routed Customer identities and Customer/Account 360 workspaces present persisted identity/binding/group/session/segment state, purpose-gated profile/account timelines and privacy/export/suppression jobs. Manager merge/split governance, Runtime 47 fenced propagation and the Runtime 52 latest-only service-recovery timeline projection with correction/deletion/consent-withdrawal supersession add focused desktop/mobile and live PostgreSQL proof. | It does not prove broader connector-backed timelines beyond that one governed producer, full field-level sensitive controls, automated completion across unresolved raw/backup/legal/regional boundaries or release qualification. | Complete authoritative connector depth and external privacy authority/approval while preserving Runtime 47 operator-required states. |
| Detect deterioration, gaps, loops, abandonment and justified risk | Deterministic alerts/path indicators are routed, and runtime39 persists approved model/version evidence, drift evaluations and abstention-first prediction decisions behind a manager/member governance workspace. | No trained production model, automated scoring provider, fairness/calibration study, scheduled drift operation, production outcome or release certification exists. | Independently validate and operate a real model without weakening abstention, consent, lineage or human review gates. |
| Safe consent-aware idempotent human-governed action | Runtimes35–44 provide revisioned workflows, transactional queue admission, leases/retries/dead letters, live consent/suppression/pause/quiet-hour/quota/frequency reservations, reviewed atomic internal effects and signed-webhook execution, canonical receipts, and routed five-level kill switches. Failure-injection and live PostgreSQL rollback/replay/least-privilege proof pass; worker activation is disabled by default. | No live provider acceptance, unreviewed email/social delivery, multi-node consequential exactly-once proof, sustained load/security certification or signed operations approval exists. Same-day checks do not prove long-lived ChatGPT credential refresh. | Run bounded provider-specific acceptance and multi-node crash/replay/soak under approved destinations and service authority, then close X-01 through X-08 release controls. |
| Roles, plans, quotas, retention, flags, audit, observability and runbooks | Managed plan catalogues, quota/usage ledger foundations, rollout controls, proposed architecture/operations records, legacy `/api/journeys` capability guards, and focused route-level governance proof across Journey Map publish, shared saved-view management/settings/audit, Journey Research gap creation, Journey Rich Card catalogue mutation, Journey AI suggestion review/apply entry points, Journey Metric alert-definition creation, Journey Identity customer-360/export/privacy-job entry points, Journey Persona governance, Journey Evidence governance, Journey Map persona link/unlink, and both space/platform Journey Template permission surfaces already exist. | It does not yet prove the full release-grade privacy/DPIA and retention controls, ratified telemetry/SLO/runbooks, signed rollout gates, or published operator/developer/customer documentation. | Complete X-05, X-08, X-09, and X-10 proof to turn the cross-cutting chain from foundational to release-grade. |

## 11B. Weakest outcome proof-status matrix

This matrix is narrower than the full section-27 verification table above. It
exists to prevent the weakest outcomes from being described only in broad
programme language when their missing proof is more specific than that.

| Outcome | Current strongest positive evidence | Current proof status | Highest-confidence missing proof |
| --- | --- | --- | --- |
| Trustworthy stage NPS/CSAT/CES, sentiment and operations | `P2-05` through `P2-10` include runtime41 governed comparisons, privacy suppression and bounded sentiment/emotion trends plus runtime43 survey, runtime45 journey-event and runtime52 governed response-linked service-recovery-ticket feeds, alongside the existing metrics/rebuild/alert stack and local P2-11 gate. | Implemented foundation with partial product proof: persisted trend views/alert linkage, an authoritative social classifier/governance contract, broader feeds, product-scale calibration, external privacy/accessibility review, ratified SLO/soak and release approval remain. | Add only authoritative governed producers, then exercise the agreed production profile and complete privacy/accessibility/security/release approval. |
| Reusable portfolio and owned initiatives | `P3-01` through `P3-10` include durable portfolio/collaboration, exact operational and metric attribution, lifecycle Kanban, aggregate executive reporting, formula-safe CSV, Runtime 46 private saved views/protected requested-target transitions, and Runtime 49 immutable tenant branding with exact saved-view-pinned export resolution and bounded viewer-authorised source notes. Manager/member desktop/mobile and live PostgreSQL proof pass. | Enterprise performance, formal tagged-PDF/PPTX/PNG accessibility, font/licensing, broader security and combined release proof remain incomplete. | Close Phase 3 performance/accessibility/security and signed release proof without weakening exact viewer scope. |
| Macro/subjourneys and complete service blueprint | `P4-01` through `P4-07` have durable contracts, mounted hierarchy/blueprint APIs and routed accessible workspaces. Focused tests cover hierarchy reuse/navigation/governance/health/settings/export and blueprint lanes/boundaries/resources/causality-link authoring/analysis/gap review/comparison/export, Runtime 48 targeted descriptive measurement and Runtime 55 private saved views with live PostgreSQL and desktop/mobile proof. | Ratified large-scale performance, accessibility/security certification and signed release evidence remain incomplete. | Close the Phase 4 permission/export/performance release gate in `P4-08`; do not infer completion from the routed slices alone. |
| Real conversion/drop-off/duration/cohorts/paths and designed-versus-observed | `P5C-01` proves version-lineaged analytics, routed Journey Metrics, durable anonymous and known-profile projections, bounded period comparisons, complementary suppression, exact processing/correction lineage and governed correction requests. Runtime 50 adds PostgreSQL snapshots/rollups and privacy invalidation; `P5C-02` adds reviewed deterministic indicators. | Implemented product slices still lack broad automatic producer reconciliation and release-grade sustained performance/accessibility/security evidence. | Complete remaining producer-specific reconciliation, detector calibration and release proof while retaining abstention and non-causal semantics. |
| Detect deterioration, gaps, loops, abandonment and justified risk | `P2-09/10` and `P5C-01/02` provide deterministic signals; runtime39 now persists and routes abstention-first model/version/drift/run governance. | In progress: there is no trained production model, automated scoring, fairness/calibration study, scheduled drift operation or release certification. | Independently validate a real model and production operation while retaining abstention, consent, lineage and review gates. |
| Safe consent-aware idempotent human-governed action | Runtimes35–44 provide workflows, queue/worker safety, live consent/suppression/pause/quota/frequency reservations, reviewed atomic internal/signed-webhook effects and five-level kill switches; live PostgreSQL rollback/replay passes. | In-progress controlled runtime: tests do not send live external effects, survey invitations fail closed without an idempotent provider, and multi-node exactly-once/soak/security/operations approval remain absent. | Run provider-specific acceptance and multi-node crash/replay/soak, then close X-01 through X-08 without enabling unreviewed email/social effects. |
| Roles, plans, quotas, retention, flags, audit, observability and runbooks | `X-01` and `X-03` already prove managed plan catalogues, usage-ledger foundations, and progressive rollout/kill-switch controls; `X-02` now also has broader route-level HTTP proof across suggestions, metric alerts, identity-governance entry points, persona/evidence/template governance, and platform template permission/origin enforcement. | In progress but materially incomplete: governance primitives and route-level enforcement are now substantially stronger, but the release-grade proof chain is still broken across multiple cross-cutting requirements. | Completion proof for `X-05`, `X-08`, `X-09`, and `X-10`: privacy/DPIA/retention controls, ratified telemetry/SLO/runbooks, signed rollout gates, and published verified documentation. |

## 12. Current SDK publication blocker sheet

The SDKs are closer to publication than the full programme, but the publish
path is still blocked by both repo-side and external requirements.

### Repo/workflow blockers still present

- The publish workflow is still disabled at
  `../.github/workflows/publish-journey-sdks.yml.disabled`.
- The current working branch is not `main`.
- `npm run preflight:sdk:landing` now passes and proves that `main` contains
  the required SDK publish-state files.
- `npm run evidence:sdk:delta` now shows no remaining required-file delta
  between the current working tree and `main`.

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
- Seemplify dogfood now has a generated reconciliation artifact, and the current August 6, 2026 report now shows one audited ChatGPT-connected user, one audited ChatGPT-selected user, zero stored ChatGPT runtime preferences, two Codex runtime homes, one Codex auth file, one journey-created milestone, and five AI-runtime audit events in the sampled local evidence; ratified load/SLO/security gates and a fuller end-to-end activation run remain open
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
| Publish branch state | SDK publication | Repo/workflow | Current branch is not `main`. The landing and delta checks are now green, so the remaining repo-side branch-state work is enabling the publish workflow only on `main` once the external npm and programme release gates are truly satisfied. |
| npm authentication and scope ownership | SDK publication | External setup | Prove `npm whoami`, confirm `@seemplify` organisation ownership, and complete trusted-publisher configuration for the exact repository/workflow/environment. |
| Connected-journey durable endpoint release gate | SDK publication and programme | Proof/ops | The durable ingest plane is correct and well-tested, but not yet release-complete: ratified security/privacy, sustained load/SLO, failover, and signed release proof remain open. |
| Connected-journey release-gate consolidation | SDK publication and programme | Proof/ops | Maintain the dedicated connected-journey release-gate artifact so the ingest gate, dogfood activity, and remaining blocker families are current in one place before attempting SDK publication. |
| Seemplify activation dogfood | SDK publication and programme | Runtime/proof | The repo has a generated activation report, and the current August 6, 2026 artifact now shows one audited ChatGPT-connected user, one audited ChatGPT-selected user, one journey-created milestone, five AI-runtime audit events, zero stored ChatGPT runtime preferences, two Codex runtime homes, one Codex auth file, and zero activation audit events; a fuller end-to-end run with broader live product activity and release-grade signoff remains missing. |
| Stage reprojection scale proof | SDK publication and programme | Runtime/proof | Runtime-30 retained reprojection is implemented, exercised, and now has a multi-batch contract-run slice over 25 retained events, but production-scale reprojection/performance evidence is still missing. |
| Visual designed-journey completion | Programme only | Product + proof | Finish saved-view depth and final accessibility/security/performance/release gates. |
| Evidence/Research Hub completion | Programme only | Product + proof | Complete retention/deletion propagation, export negative controls, synthesis presentation depth, and privacy/security release evidence. |
| Metrics/sentiment completion | Programme only | Product + proof | Runtime41/43/45/52 provide governed comparisons, privacy-safe export and survey/event/eligible-ticket feeds. Add an authoritative social contract, broader governed feeds, product-scale calibration and final privacy/accessibility/SLO/release proof. |
| Portfolio productisation | Programme only | Product + proof | The mounted portfolio now includes lifecycle Kanban and aggregate executive CSV reporting with desktop/mobile acceptance. Remaining work is explicit durable portfolio saved views and requested protected-transition persistence, graph-scale interaction, retention/performance matrices, and end-to-end release acceptance. |
| Hierarchy/blueprint productisation | Programme only | Proof + approval | Durable hierarchy/blueprint APIs and routed workspaces include shared navigation/governance/health, five-lane blueprint authoring, operational resources, causality links, analysis, gap review, comparison, governed exports, Runtime 48 targeted descriptive measurement and Runtime 55 private saved views. Remaining work is ratified enterprise-scale permission/performance evidence, accessibility/security certification and signed release approval. |
| Actual paths and designed-vs-observed | Programme only | Product + proof | Extend the existing durable subject-scoped path projections/rollups with broader comparisons, designed-versus-observed productisation, and reconciliation/correction/runtime proof. |
| Customer/Account 360 | Programme only | Product + proof | Backend identity persistence, accounts/groups, sessions, segments, permissioned timelines, Customer/Account 360 reads, and privacy/export/suppression foundations now have a first routed, plan-gated workspace with strict contracts and desktop/mobile proof. Remaining work is richer connectors and inference provenance, broader field-level controls, lower-level identity correction workflows, and end-to-end privacy propagation/release proof. |
| Deterioration/risk layers | Programme only | Product + proof | Runtime39 persists/routes abstention-first predictive governance, but no trained model, operational drift loop, calibration/fairness or release certification exists. |
| Human-governed action runtime | Programme only | Proof/ops | Runtimes35–44 implement workflow, queue/worker safety, reviewed internal/signed-webhook effects and layered kill switches. Live provider acceptance, multi-node exactly-once/soak/security and signed operations proof remain. |
| Cross-cutting governance/runbooks/docs | Programme only | Controls/ops/docs | Managed plan catalogues, quota/usage-ledger foundations, rollout controls, and proposed architecture/operations records already exist; remaining work is route-by-route capability enforcement, privacy controls, ratified telemetry/SLO/runbooks, rollout gates, and published documentation. |

## 12B. Closure matrix for programme-completion and SDK-publication blockers

This matrix is the current bridge between the audit and the real closure work.
It is intentionally narrower than the full execution checklist above: it names
the blocker families that still dominate both programme completion and eventual
SDK publication as of Thursday, August 6, 2026.

| Blocker family | Scope blocked | Current strongest evidence | Exact proof still required |
| --- | --- | --- | --- |
| Connected-journey release gate | Programme + SDK publication | `P5A-01` through `P5A-08` now prove the canonical protocol, source/key/schema control plane, durable ingest plane, replay/debug/dead-letter foundations, runtime-30 retained reprojection execution slices, and release-shaped unpublished npm SDKs; the destructive-isolated August 6, 2026 ingest/security/load artifact also exists. | Production-scale retained reprojection/performance proof, ratified security/privacy/operations approval, sustained load/SLO/failover evidence, and fuller connected-journey signoff that can support a publish claim rather than only a local qualification claim. |
| Seemplify activation dogfood and rollout evidence | Programme + SDK publication | A generated activation reconciliation artifact exists and now prefers authoritative onboarding-completed and explicit workspace-created platform-audit milestones where available; the current artifact now also shows non-zero audited ChatGPT/runtime selection, non-zero journey activity, and five AI-runtime audit events in sampled local evidence. | A fuller end-to-end dogfood run with broader live product activity and signed rollout/release signoff sufficient for `X-09` and the connected-journey publish lane. |
| Cross-cutting governance, privacy, telemetry, and runbooks | Programme + SDK publication | `X-01` and `X-03` already prove managed plan catalogues, immutable usage-ledger foundations, and progressive rollout/kill-switch controls; proposed operations records exist for `X-08`. | Completion proof for `X-02`, `X-05`, `X-08`, `X-09`, and `X-10`: route-by-route `journeys.*` capability enforcement, privacy/DPIA/retention controls, ratified telemetry/SLO/runbooks, signed rollout gates, and published verified operator/developer/customer documentation. |
| SDK repo/workflow publish readiness | SDK publication | `qualify:sdk`, `verify:sdk:release`, the August 6, 2026 consolidated publication-readiness artifact, `preflight:sdk:landing`, and `evidence:sdk:delta` now prove the packages are release-shaped and unpublished, that `main` contains the required SDK publish-state, and that no required-file delta remains against the current working tree. | Intentionally enable the publish workflow only once the connected-journey and cross-cutting release gates above are satisfied, then complete the protected npm publication path from `main`. |
| npm authentication and scope readiness | SDK publication | Local qualification, release docs, and repo-side readiness checks exist; GitHub `npm-production` environment evidence also exists. | Prove `npm whoami`, confirm `@seemplify` organisation ownership/readiness, complete trusted-publisher configuration for the exact repo/workflow/environment, and observe a successful protected publish run before claiming any SDK is actually published. |

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

### Priority 3 — extend Customer/Account 360 from backend foundations into the full product

Why third:

- it depends on identity, consent, and connected data foundations
- the backend foundation now exists, so the remaining gap is product depth and full privacy completion rather than first persistence
- it is a prerequisite for any credible consequential-action layer

Concrete scope:

- full routed profile/account/group/segment/360 product surfaces over the existing backend reads
- richer timeline, fact, inference, and evidence distinctions plus broader connectors
- broader field-level sensitive controls and operator/admin UX depth
- end-to-end consent/suppression/export/correction/erasure/retention completion proof across every raw/derived/action store

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
