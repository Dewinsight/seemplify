# Journey Management quality budgets

**Status:** Proposed  
**Last updated:** 2026-08-04

These are release gates, not aspirational dashboard numbers. The representative
dataset, hardware/browser profile, network conditions, and test report must be
recorded with every result. Values can change only through a reviewed decision.

## Accessibility gates

- All authoring and read workflows meet WCAG 2.2 AA for supported web surfaces.
- Every map, curve, matrix, funnel, flow, path, hierarchy, blueprint, timeline,
  and dashboard has a keyboard-operable non-visual table or outline exposing
  the same data and actions.
- Focus order follows reading order; drag operations have keyboard move
  equivalents and announce the result through a polite live region.
- No action is colour-only. Evidence, freshness, alert, consent, and workflow
  states include text or programmatic labels.
- At 200% browser zoom and 320 CSS pixels wide, content reflows without losing
  operations or requiring two-dimensional page scrolling; map canvases may
  scroll internally when an equivalent outline is available.
- Automated axe checks have zero critical/serious findings; manual keyboard,
  screen-reader, high-contrast, reduced-motion, and zoom checks are recorded for
  each release-critical workflow.

## Web interaction budgets

Measured on the documented reference device with a production build:

| Surface | Dataset | Gate |
| --- | --- | --- |
| Journey library | 1,000 definitions | P95 filter/sort response ≤ 150 ms after data load; virtualised list where needed. |
| Visual editor | 50 stages, 20 lanes, 500 cards | Initial usable render ≤ 2.5 s; P95 honest card edit/move feedback ≤ 100 ms; P95 authoritative acknowledgement ≤ 500 ms on the ordinary local API profile; no task > 200 ms during ordinary editing. |
| Persona comparison | 2 personas, 50 stages, 500 cards | P95 switch/filter feedback ≤ 150 ms after data load. |
| Portfolio | 10,000 linked items | P95 server query ≤ 1 s and first usable page ≤ 2.5 s. |
| Customer timeline | 10,000 permitted facts | First page ≤ 2.5 s; pagination/virtualisation; no unbounded DOM. |
| Actual-path view | 100 displayed nodes/links | Interactive ≤ 3 s and equivalent table available immediately after the same data response. |

Autosave must not block editing. Conflict detection is revision-based and must
not silently drop either actor’s changes.

“Feedback” means immediate, truthful acknowledgement that the operation is
pending; it must not render an uncommitted placement as saved. “Authoritative
acknowledgement” means the server revision and affected ordering have been
validated and presented. This distinction preserves the shared truth-state
contract while applying the ordinary control-plane API budget below.

## API and data budgets

- Ordinary control-plane read/write APIs: P95 ≤ 500 ms excluding explicit
  long-running work; requests exceeding 2 s become durable jobs where practical.
- Event acceptance candidate: 99.9% availability and P95 ≤ 300 ms for ordinary
  accepted batches under the ratified load profile.
- No acknowledged event loss. Duplicate delivery must not duplicate canonical
  events, metric contributions, journey assignments, or external actions.
- Event-to-debugger candidate freshness: P95 ≤ 10 s.
- Event-to-aggregate candidate freshness: P95 ≤ 60 s under normal operation.
- Immediate orchestration eligibility candidate: P95 ≤ 60 s, excluding human
  approval and third-party adapter time.
- All list/search APIs use bounded page size, stable cursor/sort semantics, and
  explicit query budgets. No tenant-wide unbounded read is releaseable.

## Scale and resilience profiles to ratify

At minimum, benchmark and failure-test four profiles:

1. Local: 1 space, 1 source, 10 events/s burst, SQLite degradation documented.
2. Small production: 100 spaces, 1,000 events/s aggregate.
3. Growth: 10,000 spaces, 25,000 events/s aggregate, noisy-neighbour scenario.
4. Recovery: two hours of queued traffic replayed while live ingest continues.

Each profile records event size/cardinality, source distribution, identity mix,
late/out-of-order ratio, metric/rule count, retention, database shape, worker
count, CPU/memory/I/O, queue lag, errors, cost, and recovery time.

## Export budgets

- JSON/CSV export streams bounded pages and preserves version/provenance.
- PDF/PNG/PPTX export runs as a cancellable durable job for large maps.
- A 50-stage/500-card export completes within the ratified worker timeout and
  never truncates cards without an explicit warning and manifest.
- Accessible PDF is the preferred document output. Other visual exports include
  an accessible structured-data companion when equivalence is not possible.

## Test evidence required

- Reproducible benchmark command and fixture generator.
- Production-shaped PostgreSQL report and SQLite compatibility report.
- Playwright plus accessibility scan for all critical workflows.
- Crash/restart, duplicate, late-event, queue-backpressure, and third-party
  failure-injection reports.
- Trend comparison against the previous accepted release; regressions require a
  recorded waiver with owner, expiry, and mitigation.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Product/design | Unassigned | — | Pending |
| Engineering | Unassigned | — | Pending |
| Accessibility | Unassigned | — | Pending |
| Operations/data | Unassigned | — | Pending |
