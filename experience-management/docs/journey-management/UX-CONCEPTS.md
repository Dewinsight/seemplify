# Journey Management UX concepts

**Status:** Proposed  
**Last updated:** 2026-08-04  
**Applies to:** desktop, responsive web, keyboard/screen-reader alternatives,
exports, and platform administration

These concepts define interaction and truth-state behaviour, not visual polish.
They extend Seemplify’s existing shell, forms, tables, dialogs, status language,
and audit patterns. Every implementation still requires rendered usability and
accessibility review with production-shaped datasets.

## Shared interaction contract

Every Journey surface shows, where applicable:

- Space, selected journey/profile/source/workflow, effective version, lifecycle,
  owner, permission state, plan state, freshness, and last successful update.
- One primary task at a time. Destructive, publishing, sharing, identity, and
  external-action operations require explicit confirmation and consequences.
- Loading, empty, partial, stale, conflict, unavailable, paused, restricted,
  deleted/inaccessible, failed, retrying, and read-only states.
- Whether content is a hypothesis, authorised evidence, observed fact,
  calculated aggregate, imported value, inferred assignment, or AI
  interpretation. Colour is supplementary.
- Source, calculation, rule, profile/identity, workflow, and audit explanations
  in context; users do not have to enter a separate admin area to understand a
  number or state.
- Stable URLs for permitted records and saved views. Back/forward navigation
  preserves filters without preserving secrets or transient approval tokens.

Mutations use optimistic concurrency and return the current revision on conflict.
The UI preserves the user’s draft and offers compare/reapply; it never silently
overwrites another actor.

## 1. Journey library

Primary jobs: find, create, review, compare, archive, and resume journeys.

- A bounded, pageable table/list with name, designed/evidence-backed/connected
  truth state, map type, owner/team, lifecycle, personas, evidence coverage,
  metric freshness, review date, version, and modified time.
- Search plus saved filters for type, state, owner, team, persona, product,
  geography, tags, freshness, review status, and connected readiness.
- “Create journey” starts blank, from a published pinned template, or from an AI
  suggestion review. These choices never imply evidence.
- Bulk archive/owner/tag actions require permission and show per-record outcomes.
- Empty state distinguishes “no journeys exist” from “none match filters” and
  “plan/permission hides this capability.”

## 2. Visual map workspace

Primary jobs: author a map, inspect its truth, compare people/states, and publish.

- Header: name, truth state, lifecycle, map type, effective draft/published
  version, owner/team, personas, freshness, review status, permission, share and
  export state.
- Stage columns and lane rows use one underlying ordered data model. The visual
  grid, outline/table, small-screen stage detail, and export render the same
  records rather than separate copies.
- Cards expose type, title, bounded detail, persona layer, lifecycle, owner when
  applicable, evidence state/count, and linked reusable item.
- Add/move/edit/remove operations work by pointer and keyboard. Move announces
  source and destination. Bulk selection never relies on drag.
- Active-session undo/redo is local and labelled; committed history remains the
  immutable version/audit record.
- Current/future/ideal/blueprint is independent from truth state. Publishing a
  future map does not make it observed.
- Large maps progressively render/virtualise while the outline remains complete,
  pageable/searchable, and keyboard available.

Publication opens a review summary listing changed stages/cards/persona pins,
evidence changes, unsupported/contradicted/stale items, metric freshness, and
permissions. Publishing freezes the reviewed snapshot and creates the next
draft; historical content cannot be edited through a stale UI.

## 3. Persona library and comparison

Primary jobs: create/reuse research archetypes without treating them as people.

- Library lists name, lifecycle, owner, evidence state, last review, linked
  journeys, and current/published persona version.
- Editor groups summary, goals, behaviours, needs, barriers, channels, attributes,
  claims/evidence, review date, and lifecycle. Free-form attributes remain
  bounded and classified.
- A journey can link several personas; cards/stage variants can apply to all or
  selected personas.
- Comparison uses one map with two or more persona columns/layers. Shared items
  are visibly shared; absent content is “not applicable/no mapped item,” not
  duplicated blank data.
- Published maps pin persona versions. Editing a reused persona shows affected
  drafts and offers an explicit upgrade review; it does not rewrite published maps.

## 4. Evidence and Journey Research Hub

Primary jobs: discover, attach, validate, refresh, and synthesise authorised
research without building a second knowledge system.

- Search is source-type aware, bounded, permission filtered, and shows canonical
  source label/reference, record state, population/sample/window, collected and
  updated dates, freshness, visibility, and safe excerpt/aggregate definition.
- Users select a source record; they cannot type a label/excerpt/sample and make
  it appear authoritative.
- Evidence drawer lists relationship (supports/contradicts/neutral), confidence,
  evidence strength, freshness, access state, validation history, exact target,
  and current source link.
- Inaccessible/deleted evidence retains an audit-safe reference and an explicit
  state but does not disclose cached content to an unauthorised viewer.
- Refresh creates a change set: still valid, changed, inaccessible, deleted,
  stale, newly contradictory, and claims requiring review. It never silently
  rewrites published conclusions.
- AI synthesis requires selected authorised inputs and returns claims/citations
  plus unsupported/contradiction warnings for per-change accept/reject.

## 5. Metrics and journey analytics

Primary jobs: define trustworthy measurement, see trends/comparisons, and explain
every number.

- Metric definition editor shows formula/calculation version, source binding,
  question/event field, population, filters, aggregation, direction, unit,
  timezone/window, late/correction policy, minimum sample, baseline, and target.
- Every observation shows value, numerator, denominator, sample, period, source,
  filters/cohort, calculation version, freshness, exclusions, correction state,
  and explain link.
- Stage overlay and analytics tabs share filters and saved view. Visual trends,
  funnels, heat maps, and health summaries have equivalent tables.
- Small samples are visibly suppressed/warned according to policy. The UI does
  not imply significance or causality from colour, rank, or an AI summary.
- Delayed refresh preserves the last labelled observation with its as-of time;
  the map remains usable.
- Alerts distinguish first threshold crossing, ongoing condition, recovery,
  acknowledgement, suppression, and rule/version change.

## 6. Portfolio and collaboration

Primary jobs: reuse problems/opportunities, decide priorities, deliver initiatives,
and measure outcomes.

- Reusable entity page links evidence, affected stages/journeys/personas,
  frequency/severity/impact, owner/team, state, tags, validation, and review date.
- Initiatives include solution, outcome, owner, dates, RICE/ICE input and formula
  explanation, target/baseline, dependencies, risks, milestones, approval, and
  before/after metric lineage.
- Portfolio table is the canonical large-data view. Kanban, matrix, dependency
  tree, heat map, and executive summary are saved presentations over the same
  records and offer table alternatives.
- Comments are threaded, sanitised, mention-aware, resolvable, permissioned, and
  tied to exact entity/version context. Watch/notification state is explicit;
  repeated events are deduplicated.
- Approval shows the frozen proposal, evidence and consequences; rejecting or
  requesting changes records a reason without deleting prior review.

## 7. Hierarchy and service blueprints

Primary jobs: navigate macro-to-micro journeys and connect participant experience
to operating delivery.

- Hierarchy tree plus relationship table supports parent/child, stage-subjourney,
  variant, handoff, related, shared touchpoint, and shared metric links.
- Cycle/depth/size or cross-space violations are explained before save. Shared
  reuse is distinguished from a copied snapshot.
- Breadcrumbs identify the current hierarchy path; impact traversal explains
  every included relationship and respects permissions.
- Blueprint mode has typed customer/frontstage/backstage/system/policy/handoff
  lanes, lines of interaction/visibility/internal interaction, teams, systems,
  vendors, controls, SLA, cost, risk, failures, dependencies, and owners.
- Current/future comparison highlights structured differences and linked
  initiatives/metrics without claiming a future state has occurred.

## 8. Event sources, tracking plans, debugger, and mapping

Primary jobs: configure safe collection, prove data quality, and explain stage
assignments.

- Source setup selects environment, key type, allowed origin/app/signature policy,
  rate/byte allowance, retention/region, and tracking plan. Secrets display once;
  later UI shows prefix/fingerprint, scope, last use, expiry, rotation overlap,
  and revoke history.
- Tracking plan editor versions events/properties/classification/compatibility.
  Example validation uses synthetic/redacted data.
- Debugger defaults to test sources, bounded recent receipts, redacted payload,
  accepted/duplicate/rejected/quarantined/dead-letter state, deterministic reason,
  schema version, consent/policy, identity outcome, matched rules/stages, and lag.
- Mapping editor supports draft/test/shadow/publish/retire. Historical preview
  and one-event simulation show each condition and deterministic conflict result.
- Unmatched/conflicting events are an explicit queue; no client selects a stage
  and bypasses rules.

## 9. Customer/Account 360 and actual paths

Primary jobs: investigate permitted facts and compare designed versus observed
experience.

- Profile header separates known/anonymous state, source identifiers, aliases,
  accounts, consent/policy, deletion/suppression, freshness, and inferred fields.
- Timeline labels observed events, survey evidence, service/communication facts,
  journey projections, actions, and AI interpretations distinctly. Permission
  or purpose restrictions remove content and record access where required.
- Identity merge/split UI shows facts and conflicts, requires privileged reason,
  previews impact, preserves audit, and never offers email/name/IP/device as an
  automatic heuristic.
- Actual paths include table-first transition matrix, funnel, top successful and
  unsuccessful signatures, entry/exit, loops/repeats, skipped/unexpected stages,
  stalls/durations, cohort comparison, and permitted drill-down.
- Flow/Sankey is supplementary. Suppressed cohorts and approximate counts are
  explicit. AI summaries cite aggregate IDs/sample sizes and can abstain.

## 10. Orchestration

Primary jobs: author, simulate, approve, operate, and audit controlled actions.

- Builder separates trigger, conditions, timing, consent purpose, suppressions,
  caps/quiet hours, action adapters, idempotency, approvals, owner, and effective
  dates. Published versions are immutable.
- Simulation/dry run explains eligibility, current policy, suppression/cap,
  proposed action, recipient class, and data used without producing an effect.
- Generated/external content enters a human approval queue by default. Approval
  shows exact content/destination/effect, current consent, and expiry.
- Run view traces trigger → evaluation → outbox → attempts → visible effect or
  suppression/dead letter, including retry classification and idempotency key.
- Pause/kill switch UI states what happens to queued/delayed/approval-pending
  work and requires reason/scope/recovery review.

## 11. Administration and diagnostics

- Plans manage each Journey feature and quota independently; unavailable
  navigation is hidden and direct APIs deny with the same effective reason.
- Platform operations can inspect aggregate per-space/source/profile/storage/
  action usage and lag without reading ordinary customer payloads.
- Feature flags, entitlements, capabilities, kill switches, and data policy are
  shown as separate decision layers in diagnostics.
- Audit filters cover template/rule/workflow publication, key lifecycle,
  identity/consent/privacy, exports/shares, quota overrides, replay/reprojection,
  and break-glass access.

## Responsive and accessibility validation

Required prototypes/tests cover:

1. 50-stage/20-lane/500-card map with keyboard moves and outline equivalence.
2. Two-persona comparison and a shared card.
3. Evidence access removed while a drawer is open.
4. Metric refresh delayed, small sample, corrected source, and stale observation.
5. 10,000-item portfolio with saved filters and dependency navigation.
6. Deep hierarchy/blueprint with a prevented cycle and missing permission.
7. Debugger rejection, duplicate, redaction, unmatched and conflicting rules.
8. 10,000-fact profile timeline with consent withdrawal and restricted facts.
9. Actual-path flow/table equivalence with a suppressed cohort.
10. Workflow simulation, approval, retry, duplicate prevention, and pause.
11. 320px width, 200% zoom, high contrast, reduced motion, keyboard-only, and
    supported screen-reader flows for every release-critical surface.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Product/design | Unassigned | — | Pending |
| Engineering | Unassigned | — | Pending |
| Accessibility | Unassigned | — | Pending |
| Security/privacy | Unassigned | — | Pending |
| Data/operations | Unassigned | — | Pending |
