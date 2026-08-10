# Connected Journey Management implementation status

**Overall status:** In progress — not fully implemented
**Last reconciled:** 2026-08-08
**Programme:** [CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md](./CONNECTED-JOURNEY-MANAGEMENT-MASTER-PLAN.md)
**Requirement ledger:** [CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md](./CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md)

## Executive result

No: the complete programme in the master plan is not implemented. Seemplify
has a useful Journey Map 2.0 foundation, an exercised Research Hub workspace,
durable metric definitions/observations/rebuilds and metric-alert lifecycle,
durable collaboration/saved-view/portfolio backends, and several tested domain
contracts. It now has routed portfolio, hierarchy, service-blueprint, and first
Customer 360 workspaces, stage-intelligence comparisons, predictive-governance
and orchestration-operator workspaces, but it does not yet provide the complete
analytics experience, Phase 4 export/health/performance closure, the connected-
journey dogfood/SLO gate, complete Customer 360/privacy propagation, full
actual-path product completion, or release-qualified consequential automation.

The traceability ledger is the completion authority. A type, plan paragraph,
seed fixture, pure calculator, route name, or narrow passing test is not treated
as proof that the corresponding user outcome is shipped.

Mounted Phase 4 hierarchy and service-blueprint APIs now sit over runtime-29,
with the taxonomy-retirement correction delivered forward-only in runtime 32.
Their routed workspaces expose shared hierarchy navigation, settings,
governance and transparent health plus
immutable current/future blueprint versions, five lanes, three boundaries,
structured operational resources, analysis, gap review, and stored comparison.
Focused permission/tenant/entitlement/kill-switch proof, production frontend
build/typecheck, and desktop/mobile browser flows pass. Governed exports,
Runtime 48 targeted measurement and Runtime 55 private hierarchy/blueprint
saved views now have live PostgreSQL and browser proof. Ratified enterprise
load, accessibility/security review, and the combined Phase 4 gate remain open.

## Implemented and exercised foundations

### Journey Map 2.0

- Normalised journey definitions, immutable versions, stages, built-in and
  user-defined `custom_*` lanes, cards, persona links, and evidence links in
  SQLite and PostgreSQL migration 0012.
- Deterministic legacy conversion now retains every stored snapshot, exact
  source provenance/timestamps, source AI-job links, long legacy card content,
  and stable per-version entity IDs. The bounded `(space_id,journey_id)` cursor
  backfill emits content-safe per-item/per-space checksums and isolated failures;
  reconciliation covers current/history read equivalence and migration lineage.
  The authoritative PostgreSQL contract command rehearses five legacy journeys
  across three spaces plus a native-V2 control: collision isolation/repair,
  idempotency, exact legacy export-shape equivalence, projection-only rollback,
  byte-identical re-backfill, cross-space denial, no fabricated evidence/persona/
  connected state, unchanged source rows, and exact cleanup all pass.
- Optimistic concurrency, publication, and JSON, CSV, PDF, PNG, and PPTX export.
- Stage-column/lane-row workspace, semantic outline alternative, roving-keyboard
  navigation and movement, rich reusable personas, persona-specific card layers,
  and two-persona comparison over one map.
- Bounded session undo/redo, evidence-safe copy/paste, multi-select and atomic
  bulk status/persona/stage edits, pointer and keyboard movement, and debounced autosave that only reports saved
  after the server accepts the revision. A real `409` retains the local draft and
  offers explicit reapply rather than silently overwriting the server version.
- Two retries-disabled production-build 50-stage/20-lane/500-card browser runs
  record worst-case truthful pending move feedback at 19 ms P95, authoritative
  affected-cell acknowledgement at 448.7 ms P95, initial render at 2223.1 ms,
  outline at 572.2 ms, no ordinary long task and no page overflow. The proposed quality contract explicitly keeps
  the 100 ms interaction-feedback gate separate from the ordinary 500 ms
  authoritative API acknowledgement gate, so pending state is fast without
  presenting an uncommitted placement as saved.
- Read-only exact comparison between explicit versions and between an explicit
  current-state map and future/ideal-state map. Matching is visibly labelled,
  ambiguous content is not fuzzy-matched, and disabled persona/evidence signals
  remain redacted.
- Read-only presentation mode preserves truth/version labels, removes editor
  controls, supports desktop/mobile/linear alternatives, printing, Escape exit,
  and focus restoration.
- Designed versus evidence-backed truth state is derived rather than declared;
  connected state is not manufactured from designed content.
- Journey AI now produces a durable, typed suggestion change set instead of
  replacing a map. A native map dialog selects currently authorised evidence,
  freezes it for the run, and opens an explicit per-change accept/reject review
  with required reasons. Accepted changes apply atomically to one new draft;
  rejected changes and every decision remain in append-only audit history.
  Members can inspect the same review read-only. Runtime schema 22 supplies
  tenant-composite PostgreSQL/SQLite identities, immutable suggestion history,
  least-privilege deletion denial, and a controlled de-identified purge receipt.
  Focused backend/static contracts, the production build/typechecks, the full
  backend suite, runtime rollback/replay/privilege probes, and retries-disabled
  desktop-owner/mobile-member browser acceptance pass.
- Runtime schema 20 adds revisioned platform and per-space progressive rollout
  controls for read, write, dual-write, compare-read, deterministic cohorts,
  explicit inclusion/exclusion, and an immediate forced-legacy kill switch with
  incident/change reference and review time. Legacy-to-V2 and representable
  V2-to-legacy mutations commit source, retained history, and projection in one
  transaction; unsupported V2-only edits fail without partial writes. Shadow
  comparisons choose the served source first and record only identifiers,
  checksums, bounded reason codes, and correlation IDs in an immutable ledger.
  Platform-admin RBAC, revision conflicts, audit, native-V2 isolation, content-
  free divergence reads, and per-space reset are exercised. The disposable
  PostgreSQL gate passes runtime-20 rollback/replay, least privilege, injected
  projection failure rollback, optimistic concurrency, and exact cleanup.

This remains incomplete for packaged prior-production-binary compatibility
proof, durable offline/session editor persistence,
durable saved views and filters, rich card/media/touchpoint schemas, branded
exports, accessibility-at-scale, large-map
performance, and signed rollout operations. Session history and the redacted
clipboard intentionally do not survive a reload.

### Authoritative evidence

- Fail-closed source adapters for knowledge documents, survey responses, saved
  survey analysis, social mentions, social intelligence, service-recovery
  tickets, assistant artefacts, and agreements.
- Bounded, permission-aware evidence search and attachment. Caller-supplied
  labels, excerpts, populations, samples, and dates are ignored in favour of
  the source of record.
- Evidence-state calculations preserve hypothesis, support, contradiction,
  staleness, invalidation, and inaccessible-link semantics.
- A tested lifecycle contract detects field-level source changes, redacts old
  snapshots when the source is inaccessible, enforces optimistic review, and
  prevents in-place refresh of published evidence.

The lifecycle is now wired into read-time source authorisation, map evidence
counts, runtime-schema-14 link metadata, explicit editor-only refresh and
content-free audit endpoints, and unavailable/changed/refresh drawer states.
Route integration now covers stale refresh conflicts, explicit refresh/audit,
published-version immutability, source loss, complete viewer redaction, and
designed-state degradation; focused browser acceptance covers changed and
unavailable drawer states. Source-change jobs/notifications, audit retention,
broader deletion propagation, and export negative controls remain.

The Journey Research Hub backend/data tranche is implemented behind
`/api/journey-research`. It provides a bounded catalogue/search/inbox over the
existing authoritative adapters; exact fail-closed source and snapshot reads;
immutable snapshots; polymorphic draft-target validation; version-pinned links;
reviewer assessments; deterministic contradiction, freshness and triangulation
rules; research gaps; and content-free audit/list projections. Interview,
observation, and research-note intake reuses the existing knowledge/document
pipeline with resumable idempotency across filesystem, knowledge job, source,
and intake boundaries. Durable monitored-source refresh runs use fenced leases,
bounded diffs, retry/recovery, explicit non-null notification deduplication, and
owner notifications. Runtime schema 19 supplies SQLite/PostgreSQL parity,
same-space composite keys, immutable-history triggers, and least-privilege
application grants. A responsive Research Hub page now exposes source discovery,
exact current and retained-snapshot inspection, target linking, human assessment,
apply-latest review, research-gap lifecycle, knowledge-backed intake, monitors,
explicit refresh, notifications, and content-free audit. Focused client contracts
and retries-disabled desktop-owner/mobile-member browser acceptance pass. Complete
deletion/retention sweeps, synthesis-output integration, combined accessibility,
performance and security proof, and the Phase 2 release gates remain.

### Personas and templates

- Reusable personas now support lifecycle, owner, structured attributes, goals,
  behaviours, needs, barriers, review date, evidence state, search/filter,
  current-record comparison, working-map reuse, and explicit retirement.
- Every persona save creates an immutable version with exact claims. Authorised
  source evidence is frozen to exact claim fingerprints, re-authorised on read,
  and reported as current, changed, invalidated, deleted, or inaccessible.
  Review fails closed on unsafe evidence and requires independent approval by a
  different space owner or administrator; review history is append-only and
  members receive a read-only alternative.
- Published journey versions pin exact persona versions while working journeys
  follow the current reusable record. Two-map reuse, two-persona comparison,
  persona-specific card integrity, optimistic conflicts, unlinked/retired
  assignment denial, and explicit deletion semantics are exercised.
- Runtime schema 23 and SQLite parity enforce composite tenant identities,
  current-version pointer integrity, immutable versions/claims/pins, and
  least-privilege application access. The current runtime-24 migration chain
  passes runtime-23 malformed-migration rollback, lossless legacy backfill,
  replay/idempotency, direct NULL/orphan denial, trigger drift detection, and a
  PostgreSQL two-connection conflict/rollback probe.
- The plan-gated Personas workspace uses runtime-validated responses and covers
  structured authoring, evidence/claims, version history, review, usage, pinned
  versions, and responsive list/detail alternatives. Focused backend and client
  contracts, production build/typechecks, desktop owner and independent-admin
  acceptance, and mobile member read-only/no-overflow acceptance pass.
- Eight structurally validated draft template seeds exist for onboarding,
  purchase, service recovery, renewal, employee onboarding, citizen service,
  patient access, and a blank service blueprint.
- Governed template persistence now exists in SQLite and PostgreSQL migration
  0013. The backend supports immutable version history, explicit system-template
  review before publication, organisation publication, retirement, tenant-scoped
  visibility, platform/space permissions, plan and journey-map quota checks,
  audit events, published-only map creation, and exact template-version pinning.
- A typed gallery previews an exact published version before map creation. Space
  and platform governance surfaces support authoring, review, reject-to-draft,
  retirement, bounded append-only audit reads, and two-person system-template
  publication. Stable custom-lane keys survive template authoring and creation.

Persona P1-07 is implemented but not Verified: combined accessibility,
independent security/privacy, enterprise performance/load, operational, and
signed release gates remain. Organisation-template deletion policy and the
template programme's final combined release gates also remain incomplete.

### Deterministic analytics and management contracts

- Versioned NPS, CSAT, and CES calculation with golden fixtures, revision
  correction, source lineage, periods, freshness, exclusions, and minimum-sample
  warnings.
- Versioned operational measures for stage entry/completion/conversion/dropout,
  ticket and repeat-contact rates, recovery, social sentiment distribution and
  trends, and bounded custom count/distinct/rate/duration definitions. Outputs
  preserve formulas, populations, correction/conflict handling, exact lineage,
  freshness, exclusions, samples, and warnings.
- Runtime schema 21 and SQLite parity persist authorised journey/stage/
  touchpoint/persona/segment bindings, versioned metric definitions, immutable
  observations, exact aggregate lineage, checkpoints, fenced rebuild runs and
  append-only attempts/audit. Survey corrections/deletions and authenticated,
  published-schema operational imports produce revised observations without
  mutating history. Definition-scoped revision streams, credential/source/schema/
  lineage denial, idempotent metering, PostgreSQL migration/replay/rollback,
  least privilege, and a two-connection race probe pass. The permissioned
  binding/analytics workspace and native ticket/social adapters are present.
  An executable Phase 2 report now assembles 22 source-parity tests, 7 focused
  Research Hub/metric access-deletion-citation tests, and a 2,000-response
  SQLite candidate load probe. The measured initial, correction, and deletion
  rebuilds pass the configured five-second local budget with fresh output and
  complete source/window/sample metadata. This advances P2-11 only to In
  progress: the load profile is explicitly unratified, SLO approval is not
  recorded, and production-scale resilience/security approval remains open.
- Runtimes 41, 43, and 45 now provide a governed stage-intelligence store and
  authoritative survey-response and journey-event producers. The product shows
  persona, segment, cohort and channel comparisons plus deterministic sentiment/
  emotion aggregates with primary/secondary suppression, unknown/null states,
  bounded content-safe lineage and export. Facts retain exact server-owned
  metric/source/window/version provenance, HMAC pseudonyms and resumable
  retention/deletion semantics; raw text and caller-supplied lineage are not
  accepted. Ticket/social feeds, external privacy approval, accessibility and
  ratified production scale remain open.
- The stage-intelligence product now also exposes sentiment/emotion time-series
  over those same governed facts: 1–31-day intervals, at most 52 explicit
  buckets, independent suppression in each bucket, empty periods, and exact
  fingerprint/lineage. The accessible table and interval control pass desktop
  manager and mobile member scenarios. Persisted views and alert linkage remain
  open and are not inferred from the trend surface.
- Runtime schema 25 and SQLite parity add deterministic versioned journey-metric
  alerts for falling values, stale sources, small/privacy-suppressed samples and
  contradictory governed research. Exact windows, direction-aware thresholds,
  explicit insufficient-data reasons, allowlisted lineage, idempotent evaluation,
  deduplicated lifecycle, correction auto-resolution and per-owner/admin notification
  preferences/read state are enforced. Small or privacy-suppressed samples never
  produce a strong alert, and qualitative contradiction requires current authorised
  Research Hub assessments rather than sentiment. Focused backend/frontend tests,
  desktop-owner/mobile-member browser acceptance with retries disabled, and a
  disposable PostgreSQL rollback/replay, tenant, append-only, least-privilege,
  recipient-dedupe, role-removal and concurrent-idempotency probe pass. Combined
  accessibility, security/privacy, scale/resilience and release approval remain.
- Versioned RICE and ICE arithmetic that preserves incomplete states and returns
  its inputs and formula.
- Reusable portfolio domain for pain points, opportunities, solutions, and
  initiatives with typed cross-journey links, pinned published snapshots,
  lifecycle readiness, dependencies, scoring lineage, checksummed baselines,
  and descriptive before/after outcomes that do not claim causation.
- A first mounted Journey Portfolio backend surface now exists through
  `/api/journey-portfolio`, exposing item, relationship, journey-link,
  dependency, scoring-policy, assessment, outcome, and operational-link reads
  and writes over the durable portfolio module. Typed operational attribution
  now validates exact same-space assistant actions and recovery tickets without
  converting them into initiatives, while immutable baseline capture and
  before/after comparison read exact persisted metric observations and pinned
  definition versions rather than caller-supplied values. Focused HTTP proof
  covers member-read versus manager-write behaviour, tenant isolation,
  idempotency, optimistic outcome conflicts, incomparable evidence, and routed
  creation/listing of the broader portfolio records.
- The first routed Journey Portfolio product workspace now exists at
  `/journey-portfolio` behind the `journeyPortfolio` entitlement. It provides
  table, status-driven lifecycle Kanban, priority-matrix, improvement-chain, dependency, scoring-
  policy, assessment-history, filtering, and canonical item create/edit
  flows. Initiative detail now also presents typed operational links and
  outcomes plus immutable metric baseline/comparison evidence with versions,
  windows, samples, checksums, attribution, and explicit non-causation wording.
  Members receive a read-only alternative while owner/admin mutations continue
  to be enforced by the backend. Focused frontend contract tests and isolated
  Playwright acceptance pass on desktop and mobile. A member-readable aggregate
  executive snapshot and formula-safe CSV now avoid raw item identifiers/titles
  and causal claims. Runtime27 still has no portfolio-specific durable saved-view
  identity, and its governance review row cannot encode the exact protected
  lifecycle target required for drag-style approval moves. Graph-scale traversal,
  retention, accessibility and enterprise-volume proof remain.
- Journey collaboration is now mounted at `/api/journey-collaboration` and
  routed at `/journey-collaboration`. The tenant-free strict client and
  workspace expose threaded comments/replies/mentions, immutable edit history,
  resolution, watch/mute, personal notifications, role assignment/revocation,
  two-person governance review/publication, content-safe activity, and
  revisioned collaboration settings. Backend route/domain/schema tests and four
  isolated desktop/mobile manager/member Playwright scenarios pass. Broader
  notification delivery, retention/deletion sweeps, scale, certification, and
  combined Phase 3 release evidence remain.
- Versioned actual-path analytics for signatures, transitions, ordered funnels,
  drop-off, loops, repeats, skipped/unexpected transitions, entry/exit, duration
  distributions, revision/conflict handling, lineage, and minimum-group
  suppression.
- A first actual-path product surface now exists in Journey
  Metrics through `/api/journey-metrics/actual-paths`, exposing accepted
  instance/visit counts, common observed paths, designed funnel progression,
  skipped transitions, loops/repeats, an initial designed-versus-observed
  stage-alignment comparison, and explicit descriptive-only scope notes.
  Durable append-only snapshots of the current view can now be saved
  and reread for a fixed scope/version through the same workspace, and the
  workspace now reports whether the latest saved snapshot is current or stale
  relative to newer observed visits or completed stage reprojections; recent
  snapshot history is also inspectable from the same page and historical
  snapshots can be reopened into the current workspace view. Saved snapshots
  also now expose a bounded reconciliation block against the current live
  view. A follow-on backend slice now also adds a first durable anonymous-only
  rollup read model, so editors can materialise a stable per-version/per-period
  rollup, reopen the latest rollup through a dedicated route, and see it become
  stale and then refresh as newer observed visits arrive. The Journey Metrics
  workspace now also surfaces that latest durable rollup directly beside the
  live view and append-only snapshots so the product can show current/stale
  rollup state without leaving the actual-path workspace. A further backend
  slice now also adds a first known-profile stitched mode on the same route,
  reusing the existing anonymous-binding and account-membership bridge from the
  identity layer so the response can report stitched known-profile/account
  coverage where deterministic identity links already exist. The Journey
  Metrics workspace can now switch the live actual-path view between
  anonymous-only and known-profile stitched modes, and the same selected
  subject scope now also flows through persisted rollups and snapshots so each
  mode can be materialised, reopened, and inspected honestly from the same
  workspace. Runtime 33 now also adds deterministic, descriptive-only anomaly
  indicators and human-review-only stage-inference recommendations with exact
  journey/version/window/subject provenance, primary abstention, secondary
  suppression, confidence components, immutable checksums, freshness, and
  optimistic review lifecycle. The Journey Metrics product presents manager
  preview/save/history/review and a read-only member alternative, repeatedly
  states that no recommendation is applied automatically, and passes isolated
  desktop/mobile acceptance. The product is still not a full known-identity
  path workspace: broader designed-versus-observed reconciliation, operational
  correction, product-scale detector calibration, and governed predictive
  controls remain.
- A typed service-blueprint contract for customer, frontstage, backstage,
  systems, policies/controls, handoffs, dependencies, SLA, cost, risk, failure
  points, the three blueprint lines, causal-gap analysis, and current/future
  comparison.
- A guarded hierarchy graph for parent/child, stage/subjourney, variant,
  handoff, and related links with cycle, depth, size, duplicate, stage,
  missing-node, and cross-space checks.

Runtime schema 21 now backs the metric subset with durable same-space bindings,
canonical segments, immutable versioned definitions/observations, bounded
content-free lineage, definition-scoped operational imports, fenced rebuild and
correction jobs, checkpoints, audit, permissions, quotas, and SQLite/PostgreSQL
parity. A routed permissioned Journey Metrics workspace now manages exact
survey/collector/question bindings, segments, immutable definitions and rebuilds,
and presents values, baselines/targets, samples, windows, freshness, comparable
trends, stage overlays, evidence coverage, and exact source-revision lineage.
Focused desktop-owner and mobile-member browser scenarios pass with retries
disabled. The actual-path lane has now moved beyond a pure calculator into a
subject-scoped product slice with an initial designed-versus-observed
comparison, persisted snapshots, and a first durable rollup read model, but it
is still not the full Phase 5 outcome: known-identity pathing, broader
designed-versus-observed reconciliation, secondary suppression, operational
correction, and broader release proof remain. Portfolio and
hierarchy/blueprint work have now crossed into durable backend and migration
ground but are not yet fully routed, productised, or release-proven. Native ticket/social adapters, full
  cohort/persona/segment/channel and sentiment views, exports, privacy
suppression, production load/soak/accessibility/security approval, and
operational SLO evidence remain.

### Connected-journey foundations

- Canonical event protocol package with versioned TypeScript contracts, JSON
  Schemas, OpenAPI description, valid/invalid fixtures, naming guidance, and a
  loopback-only non-durable mock server.
- Pure versioned stage-rule evaluator with bounded predicates, source,
  environment, event-time and sequence conditions, deterministic conflict
  resolution, safe explain traces, and idempotent assignment keys.
- Pure identity reducer with space-scoped anonymous/known identities,
  authenticated identification, privileged alias/merge/split, conflict and
  heuristic rejection, replay safety, memberships, and deletion tombstones.
- Durable source/key/schema administration now extends the pure contract with
  runtime-schema-16 PostgreSQL storage and SQLite parity, revision-safe APIs,
  one-time public/server credentials, scrypt-only verification material,
  bounded overlap rotation/revocation, exact public origin/bundle binding,
  quotas, RBAC/entitlements, immutable schema versions, content-free audit, and
  a responsive developer workspace.
- Runtime schema 17 and `/v1/events` plus `/v1/batch` provide durable ingestion:
  commit-before-`202`, global accepted/quarantined idempotency, conflict and
  partial-batch receipts, rate/monthly quota admission, consent/privacy/schema
  enforcement, immutable partitioned raw and receipt facts, HMAC identity
  routing, a fenced processing inbox, redacted debugger/rejections/dead letters,
  audited inspection, and confirmed idempotent replay.
- Runtime schema 18 adds governed draft/publish/retire stage rules, a safe
  operational-property simulator, crash-recoverable fenced processing,
  immutable explain decisions and visits, anonymous journey instances,
  terminal-state protection, event-time late/out-of-order handling, aggregate
  reads, replay recovery, and content-free audit. A dedicated PostgreSQL probe
  exercises real `/v1` ingestion and a restarted worker under the least-
  privilege application role.
- Browser SDK foundation is implemented with browser-safe protocol validation,
  consent-aware collection, batching, bounded durable/in-memory queues,
  duplicate-safe retry/backoff, offline/lifecycle handling, privacy
  minimisation, safe diagnostics, and host-application failure isolation. Its
  built ES2022 ESM artifact passes a local browser-resolver and restricted-host
  failure-isolation check; a ratified real-browser/CSP matrix remains open.
- The React integration package is implemented as an isolated foundation: its
  provider is inert during SSR, lease-safe under React Strict Mode, supports
  owned or external browser clients, and exposes stable fail-closed hooks.
- The Node SDK foundation is implemented with environment-matched server-secret
  validation, canonical track/identify/alias/group/page/screen/consent/server-
  metric calls, retry-stable event IDs with content-conflict rejection, bounded
  per-envelope import, opaque host-verified request identity/context middleware,
  bounded memory-only batching, partial-result handling, retry/timeout/abort
  behavior, graceful flush/close, and host-safe callbacks. It deliberately makes
  no durable-delivery or self-authentication claim.
- An unpublished React Native SDK foundation emits the canonical protocol with a
  public write key, bounded count/byte/age queues and batches, stable IDs,
  partial-result retry, consent-gated persistence and withdrawal purge. It has
  explicit host lifecycle/network/battery/context bridges and accepts durable
  state only through a host adapter attesting encrypted-at-rest and atomic
  replacement; invalid, corrupt or failing configured storage disables rather
  than falling back. Its artifact imports no DOM, Node or implicit native
  module. Real-device/OS qualification, historical installed-artifact upgrade
  tests, reviewed native adapters, dogfood and production data-plane proof remain.
- Unpublished native SwiftPM and Kotlin/Android foundations now cover every
  canonical call, including operational metrics, plus reset/flush semantics,
  bounded consent-aware queues, retry-stable IDs, partial receipts, privacy
  minimisation, injectable host boundaries, and fail-closed encrypted storage.
  Swift has a passing Windows static/protocol contract and 10 authored but
  locally unexecuted XCTest scenarios because this host has no Swift toolchain.
  Kotlin has a clean Windows Gradle gate with 12/12 JVM tests, zero-finding
  lint, release AAR/sources/metadata, an instrumentation APK, and 2/2
  Keystore/AtomicFile tests passing on one Android 15/API 35 emulator.

The durable control, ingestion, and anonymous stage-projection planes now exist
and have local, browser, SQLite, and production-shaped PostgreSQL evidence.
The next connected-journey identity tranche has also moved beyond a pure policy
contract: a first persisted backend slice now stores reducer-backed anonymous
and known profiles, exact bindings, merges, memberships, source facts,
tombstones, processed commands, and audit, and exposes a permissioned
`/api/journey-identities` surface for list/detail/resolve and explicit
identity-command workflows. A follow-on backend slice now also adds durable
account/group catalog rows plus rebuilt profile/group interaction timelines
backed by those persisted identity facts. A further follow-on slice now adds a
first durable session read model backed by anonymous identifier bindings plus
persisted identity source facts. A further backend-first slice now also adds
connected-journey segment/version/materialisation foundations with simple
identity and membership rule clauses. A further backend slice now also adds a
first permissioned Customer 360 read surface for profile/account detail over
the existing identity, segment, session, consent-state, timeline, and anonymous
journey-instance foundations, and the account 360 read now filters suppressed
or denied member profiles plus their timeline and journey-instance traces for
the requested purpose while the plain profile/group/account/session identity
projections now also suppress suppressed profiles from list/detail/member/count,
timeline, direct session, correction-history, audit, and segment-detail reads. A further privacy/export
foundation now also adds
purpose-specific profile privacy states plus governed profile-export jobs, and
it blocks profile Customer 360 and export reads when the requested purpose is
denied or suppressed. A further privacy-operations slice now also records
durable suppression and erasure job requests, immediately applies suppression
state where appropriate, and now also immediately propagates to existing
profile export bundles, materialised segment memberships, profile timeline
events, identity sessions, and anonymous journey instances when no append-only
anonymous stage-visit traces remain while still explicitly keeping the deeper
anonymous actual-path trace stores pending when they block cleanup and still
returning the remaining downstream targets that have not yet been executed. A
further correction-window foundation now also records
durable correction runs whenever identity commands trigger merge-driven or
late-source-fact rebuilds of profile timelines, derived sessions, and
materialised segment memberships. A first routed Customer identities workspace
now presents deterministic profile facts and bindings, timelines, sessions,
accounts/groups, segments, purpose-gated profile/account 360, privacy states,
exports/jobs, and correction status. Frontend contracts, production build, and
desktop/mobile browser proof pass. Runtime 52 now also projects eligible
response-linked service-recovery-ticket facts into stage intelligence and a
separate latest-only Customer 360 timeline, with correction, deletion and
consent-withdrawal tombstones. This is still not complete Customer 360:
remaining source stores, broader concurrency/runtime proof, richer segment
semantics/connectors, and finer field-level sensitive controls still remain.

The remaining connected-journey blockers include a reconciled Seemplify
activation dogfood journey, ratified and stable load/SLO results, retained
projection rebuilds, complete Customer 360/privacy propagation, actual-path
materialisation, and orchestration. The mock protocol
server remains test-only and must not be deployed or confused with the durable
`/v1` routes.

### Plans, controls, architecture, and operations

- Managed plan catalogue and platform-admin plan editor now name the Journey
  design, evidence, metrics, portfolio, collaboration, hierarchy, blueprint,
  connected, profiles, paths, orchestration, mobile, and connector features and
  their planned quotas.
- Proposed ADRs, glossary, UX contract, feature-control vocabulary, quality
  budgets, threat model, data classification, identity policy, dogfood tracking
  plan, operational ownership, alerts, and runbook catalogue exist.
- The PostgreSQL cutover/runtime-contract defect around the social publication
  SHA checks and type/index drift was repaired. The independently rerun
  production-shaped contract gate now passes through runtime schema 20 with
  runtime-16/17/18/19/20 rollback and replay, event control/data-plane/stage and
  Journey rollout probes, 139 contract indexes, 42 protected tables, nested
  rollback, and zero residual
  durable writes. Focused
  evidence-lifecycle, custom-lane, atomic export-metering, event-control, and
  durable-ingestion/stage-processing regressions are green. A separate two-
  process PostgreSQL 16 gate twice passed hostile-input, least-privilege,
  dedupe/rate/quota, crash/restart, replay, redaction, metering reconciliation,
  and runtime-18 stage projection with exact cleanup. Its local p95 latency was
  unstable at roughly 5.1 to 7.1 seconds, outside the unratified 300 ms
  candidate, so it is evidence of correctness rather than production capacity.

Runtime schema 15 now supplies an immutable, idempotent usage ledger and
reconcilable monthly buckets. Journey exports use atomic per-space admission,
enforce the exact UTC-month quota after successful rendering, and expose only
aggregate usage. The generic ledger does not make the whole catalogue complete:
several newer Journey capabilities still lack full route-by-route
entitlement/quota integration and a completed granular `journeys.*`
capability matrix. Legacy `/api/journeys` now have explicit
read/edit/export guards, and focused HTTP governance proof now covers Journey
Map publish, shared saved-view management/settings/audit, Journey Research gap
creation, Journey Rich Card catalogue mutation, Journey AI suggestion
review/apply entry points, Journey Metric alert-definition creation, Journey
Identity customer-360/export/privacy-job entry points, Journey Persona
governance mutations plus read-only usage, Journey Evidence
attach/refresh/assess/delete plus member-readable source/audit, Journey Map
persona link/unlink, and space/platform Journey Template permission surfaces
including platform manage-vs-read and origin enforcement. The
mixed direct/durable
`monthlyAiActions` concurrency gap is closed: both paths share one immutable
ledger and per-space mutex, and durable creation/retries use idempotent
job/generation/attempt reservations. Durable feature flags
and kill switches, ratified privacy/security decisions, instrumented telemetry,
exercised runbooks, and signed rollout gates also remain.

## Verification evidence currently available

The following focused evidence has passed on the current programme branch:

- Journey Research Hub backend/route contract: 1 production-shaped integration
  test covering catalogue replay/conflict, exact reauthorisation, private-source
  redaction, all four exact inbox variants, immutable snapshots/assessments,
  refresh fencing and pinned links, null-run notification deduplication,
  resumable intake crash recovery, composite-key denial, and content-free audit.
- Runtime schema 19: `node scripts/test-postgres-runtime-migration.mjs` passes
  schema/tenant-key/deduplication/privilege/drift checks; the contract-only
  PostgreSQL E2E passes runtime-19 rollback/replay and exact isolated cleanup.
  The committed `0019_journey_research_hub.sql` SHA-256 at reconciliation was
  `24c03287ec66fdcf613307ec5831727bd7beae0b5bb9b3f8ddb10070d2d9ecf9`.
- Runtime schema 20 and P1-03: focused rollout tests pass platform/space RBAC,
  audit and revision conflicts; deterministic cohorts and forced legacy;
  atomic legacy-to-V2 and compatible V2-to-legacy writes; unsupported-edit and
  injected-database rollback; shadow source stability; and immutable content-
  free divergence records. The contract-only PostgreSQL run passes runtime-20
  rollback/replay, schema/privilege verification, optimistic concurrency and
  exact cleanup.
- Complete local suites after this tranche: backend 299/299 and frontend 90/90.
- Journey evidence backend tests: 23 passing, plus 5 pure lifecycle tests.
- Journey evidence frontend contracts: 9 passing.
- Authoritative knowledge-document evidence browser flow: 1 passing.
- Event protocol contracts/mock behaviour: 17 passing.
- Browser SDK: 21 passing.
- React SDK: 11 passing, including SSR and Strict Mode lifecycle coverage.
- Node SDK: 17 passing, including every canonical Node call, bounded import,
  verified request context, partial acceptance, retry, timeout, close,
  idempotency conflict handling, and redaction behavior.
- React Native SDK: 12 passing across canonical calls/mock conformance, consent
  persistence and purge, secure-storage corruption/version/failure handling,
  bounded queueing, offline/network/app-state/battery transitions, stable-ID
  partial retry, timeout and host-failure isolation.
- Swift SDK: Windows static/protocol contract passing across all eight call
  fixtures plus batch/result fixtures; 10 XCTest scenarios and pinned macOS
  CI are authored but no Swift compile/runtime result is claimed locally.
- Kotlin/Android SDK: 12/12 JVM tests, canonical ten-fixture and unreleased
  guards, zero-finding lint, release artifact/metadata and instrumentation-APK
  assembly passing; 2/2 encrypted Keystore/AtomicFile tests pass on one Android
  15/API 35 emulator. Physical devices and the wider OS/lifecycle/upgrade matrix
  remain open.
- SDK aggregate: root typecheck and 78 tests pass across protocol (17), Browser
  (21), Node (17), React (11), and React Native (12).
- Browser built-artifact compatibility: ES2022 browser resolution plus
  restricted-host failure isolation passing locally; real-browser/CSP coverage
  and a successful Node 20/22 CI matrix run remain outstanding.
- SDK packaging: a stable rerun passes clean no-`dist` typecheck/build,
  deterministic double-build hashes, Browser and React Native built-artifact
  compatibility, real prepack/dry-run tarballs, isolated offline
  runtime/declaration/dependency consumers across all five TypeScript packages,
  `qualify:sdk`, the explicit `release-ready` gate, the Swift static/protocol
  contract, and the Kotlin static/protocol contract. All five npm package
  manifests are now MIT with a per-package `LICENSE` file and `private: false`.
  Publication remains blocked by the durable-endpoint/dogfood/security gates,
  unverified npm `@seemplify` scope ownership and publish authentication, and
  the still-disabled publish workflow; no registry write has occurred and no
  `@seemplify` SDK package exists on npm as of Wednesday, August 5, 2026.
- Event source/key/schema control plane: 8 backend route/domain tests, 7
  frontend contract tests, and 3 focused desktop/mobile browser scenarios pass.
- Durable event ingestion: 8 focused policy/integration tests and the full
  backend suite (now 299/299 including the Research Hub tranche) pass. The integration proof covers atomic rollback,
  duplicate/conflict, retryable rate/quota failure, partial batch, revocation,
  redaction, tenant/member controls, debugger, dead-letter audit, and replay.
- Metric calculation: 5 passing.
- Operational journey measures: 8 passing.
- Portfolio scoring: 5 passing.
- Portfolio domain: 7 passing.
- Hierarchy validation: 4 passing.
- Stage-rule evaluation: 6 passing.
- Identity policy: 9 passing.
- Evidence lifecycle: 5 passing.
- Governed journey templates: 9 focused backend tests plus 6 dedicated frontend
  contracts and 4 focused browser scenarios, including two-person publication,
  reject-to-draft audit, blueprint-only instantiation, and custom-lane roundtrip.
- Exact journey comparison: 3 frontend contracts and 2 focused browser
  scenarios cover explicit version identity, deterministic non-fuzzy matching,
  current/future selection, and persona/evidence redaction.
- Custom lanes: the 28-test Journey Map backend suite, 9-test template suite,
  62-test frontend suite, and a focused browser scenario pass with stable unique
  keys, optimistic mutations, limits, safe deletion, immutable versions, and
  template/export/presentation preservation.
- Journey-map exports: 4 renderer tests plus route coverage for JSON, CSV, PDF,
  PNG, and PPTX. PNG is a bounded in-process rasterisation, not a placeholder.
- Subscription usage: 9 focused backend tests cover atomic/replay-safe monthly
  decisions, legacy direct-AI backfill, exact durable attempt/retry charging,
  cross-month direct and durable replay, partial legacy adoption, reconciliation,
  aggregate-only reads, domain
  rollback, terminal linked-run denial, worker continuation, and Journey export
  charging. Two static admission tests prevent production bypasses and verify
  shared terminal bookkeeping/publication. Two production-shaped PostgreSQL
  concurrency scenarios are green, including independent direct/durable
  application processes racing against one shared allowance without overshoot.
- Journey subfeature enforcement: focused backend and browser tests prove
  disabled personas/evidence are removed from UI and redacted/denied by APIs.
- The last recorded complete backend suite passed 299 tests through runtime
  schema 19, including evidence lifecycle, template governance, custom lanes,
  exports, metering, event control, durable ingestion, and stage processing.
  The added runtime-20 focused suites and production-shaped probes pass, but a
  new complete-suite count remains to be recorded after concurrent work settles.
- Service-blueprint contract: 5 passing.
- Actual-path analytics: 6 passing.
- Platform-admin plan tests: 12 passing before the last catalogue alignment;
  stable rerun remains required.
- Frontend contracts cover Journey Map templates, custom lanes, exact
  comparison, exports/presentation, subfeature gating, event-source control,
  debugger/dead letters/usage, the routed Research Hub, and runtime-20
  alignment; the current complete frontend contract suite is 96/96 green.
- The Research Hub production build and retries-disabled browser acceptance pass
  the complete owner catalogue/inspect/link/monitor/refresh/intake/audit flow on
  desktop and the read-only, no-overflow member alternative on mobile.
- PostgreSQL schema/cutover/runtime/privilege proof through runtime schema 20:
  independently passed with runtime-16/17/18/19/20 rollback/replay, control,
  data-plane, stage, legacy-backfill and rollout probes, 139 contract indexes,
  42 protected runtime tables, nested rollback, and exact cleanup. Focused event-
  source browser coverage passes on desktop and mobile, including viewer and
  disabled-plan negative controls.
- The isolated PostgreSQL correctness/load gate passed twice with two real app
  processes and exact cleanup. The stage probe produced five decisions, five
  visits and three anonymous instances across restart, late/out-of-order,
  terminal, fencing and replay scenarios. Local latency is outside the
  provisional target and therefore is not production capacity evidence.
- The first routed Journey hierarchy workspace is now mounted behind the
  `journeyHierarchy` entitlement. Its strict client and responsive workspace
  cover canonical hierarchy reads, type-specific relationship creation,
  optimistic review/lifecycle transitions, shared-subjourney trees, all visible
  breadcrumb paths, bounded upstream/downstream impact traversal, taxonomy
  creation/assignment/correction, revisioned enablement and size limits, and
  member-read/manager-write behavior. It now also manages versioned health
  policies and persists transparent snapshots with exact own/child inputs,
  weights, rules and lineage; unknown remains null/unknown. Runtime 32 adds the
  assigned-term retirement guard forward-only after shipped runtime 31, and the
  aggregate runtime chain now continues through runtime 45. Six focused
  frontend contracts and four desktop/mobile manager/member Playwright
  scenarios pass. This is product proof for the mounted governance/health
  slice, not hierarchy export, enterprise performance, certification, or signed
  release closure.
- The first routed service-blueprint workspace is mounted behind the dedicated
  `journeyBlueprints` entitlement. Its mounted aggregate API and strict client
  cover blueprint/resource governance, immutable current/future versions,
  structured five-lane operational content, relationships, analysis, persisted
  gap review, and stored comparison. Focused hierarchy/blueprint tests,
  the complete 779-test backend suite, frontend contracts/build/typecheck, and
  desktop/mobile Playwright scenarios pass. Portfolio-link authoring, Runtime 48
  targeted measurement, governed exports and Runtime 55 private saved views now
  exist; enterprise performance/accessibility/security and release proof remain.
- The first routed Customer identities and Customer 360 workspace is mounted
  behind `journeyProfiles`. It presents exact profile facts/bindings, timelines,
  sessions, accounts/groups, segments, purpose-gated derived 360 context,
  privacy state, export/privacy jobs, and correction status. Desktop and mobile
  browser flows pass, including pointer-operable overflowed tabs and table
  containment. Resumable privacy propagation, richer connectors/inference
  provenance, and complete Customer/Account 360 release proof remain.
- Runtime 35 provides the durable Journey orchestration definition backend:
  strict mounted workflow routes, revisioned drafts, immutable published
  versions, persisted dry-run/historical simulation traces, held action records,
  approval evidence, append-only audit, and a held-only outbox foundation. It is
  manager-write/member-read, tenant-scoped, fail-closed across twelve safety
  gates, and restricts bounded automation authorisation to Journey
  administrators. Fourteen focused tests, runtime compatibility, live
  PostgreSQL rollback/replay/least-privilege verification pass. Runtime 36 adds
  the bounded retry state machine described below.
- The routed Journey Orchestration workspace is now mounted behind its plan
  entitlement. Managers can author, revise, publish and retire workflows, run
  dry/historical simulations with all twelve safety gates, inspect exact
  decision traces and record approvals; members are read-only. Runtime 36 adds transactional
  approval-to-queue admission, fenced leases, retry/backoff/dead-letter states,
  immutable attempts and a deterministic no-effect receipt. Runtime 38 adds
  reviewed internal effects and an allowlisted signed-webhook adapter with
  atomic receipts, idempotency, SSRF/signature/replay controls and failure
  injection; survey invitation fails closed without an idempotent provider.
  Runtime 40 adds routed five-level kill-switch operator controls. Runtime 42
  provides disabled-by-default service authority and live consent/suppression/
  pause/quiet-hours/quota/frequency reservations; runtime 44 atomically bridges
  reviewed effects into that settlement. Ordinary tests do not send live
  external effects, and no provider acceptance or production exactly-once claim
  is made. Focused desktop/mobile scenarios pass.
- Runtime 37 adds the first approved connector/import foundation for bounded
  CSV, JSONL and approved-object-store inputs. It provides exact cursor CAS,
  concurrent idempotency locking, retry-after handling, partial item receipts,
  durable deletion tombstones and content-safe audit behind mounted tenant- and
  entitlement-scoped routes. Runtime 51 adds the disabled-by-default execution
  plane behind it: external file-reference-only principals, CAS key rotation,
  explicit tenant/connector scope, a dedicated least-privilege worker role,
  fenced leases, crash reap/reclaim, stale-completion denial and live
  entitlement/principal rechecks, with one first-party
  `service_recovery_tickets_v1` adapter that imports survey, status, priority
  and timestamps only. Third-party provider credentials/adapters, any external
  dispatch, downstream qualification and release proof remain. A routed strict client/workspace now covers
  owner/admin create, enable/disable, start/load/submit, partial receipts,
  checkpoints, retries and tombstones with a member read-only alternative and
  focused desktop/mobile acceptance.
- The registered aggregate runtime is now 54. The full backend suite passes
  894/894 with zero skips; frontend source passes 219/219 and backend/frontend
  typecheck and production-build gates pass. Live PostgreSQL reaches schema 54 with
  rollback/replay, least-privilege worker roles, connector/stage-feed/retention
  two-adapter crash/fence/cross-tenant probes and the application-role evidence
  monitor operation probe, zero residual durable writes and exact cleanup. The
  programme-wide combined desktop/mobile browser inventory must still be rerun
  against the final aggregate before a release claim is made.

This is not yet a release result. Full typecheck, all unit tests, production
build, a green complete desktop/mobile Playwright run, supported migration
replay/rollback, accessibility, security, performance, resilience, and
operational checks must be rerun together after the active implementation
changes stop. No failing or unobserved release gate can be waived.

## Major outcomes not yet implemented

1. Complete accessible visual journey authoring at the specified scale.
2. Research synthesis presentation plus the Research Hub's complete
   accessibility, performance, security, deletion/retention and release proof.
3. Complete live metric experience: governed survey, journey-event and Runtime 52
   response-linked service-recovery-ticket feeds plus stage comparisons,
   sentiment/emotion and privacy-safe export now exist;
   an authoritative social feed, broader governed feeds, product-scale calibration, ratified load/SLO approval,
   accessibility/privacy certification and the remaining Phase 2 matrix remain.
4. Complete portfolio/collaboration: lifecycle Kanban, aggregate executive CSV,
   Runtime 46 private saved views and protected requested-target transition
   governance now exist; notification delivery, deletion/retention, scale,
   certification and release proof remain.
5. Complete ratified hierarchy/blueprint enterprise performance,
   accessibility/security and release proof. Runtime 48 targeted measurement and
   Runtime 55 private saved views now join hierarchy health/settings, blueprint
   portfolio-link authoring and governed exports.
6. Reconciled Seemplify activation dogfood, stable capacity/SLO proof, and
   retained labelled reprojection over the implemented stage runtime.
7. Known-identity journey instances, product-scale actual-path comparisons, and broader designed-versus-observed reconciliation.
8. Release-qualify the routed permissioned Customer and Account 360, merge/split
   governance and Runtime 47 privacy propagation across every authoritative store.
9. Product-scale deterministic risk calibration and a trained, independently
   approved model behind the implemented abstention-first governance controls.
10. Release-qualify the implemented consent-aware worker, reviewed adapters and
    kill switches with live provider, multi-node and operational proof.
11. Complete roles, plans, quotas, retention, flags, audit, telemetry, runbooks,
    documentation, dogfood, beta, and GA evidence.

## Current implementation order

The work continues in dependency order: close remaining Phase 1 editor and
migration gaps; finish the routed Research Hub and metrics experience; extend
the newer durable portfolio/collaboration/saved-view and hierarchy/blueprint
foundations into complete product surfaces; complete stage processing, SDK dogfood, and Phase 5A
security/load gates on the now-durable event platform; then identity,
instances, paths/360, and finally orchestration. Each tranche is added to the
traceability ledger with its missing proof kept explicit.
