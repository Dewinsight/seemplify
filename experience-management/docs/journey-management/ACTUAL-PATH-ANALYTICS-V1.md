# Actual-path analytics v1

Status: foundation calculation contract; no persistence, API, scheduler, or user interface.

Implementation: `backend/src/journeyPathAnalytics.ts`

Golden contract: `backend/test/fixtures/journey-path-analytics/v1/golden.json`

Version: `journey-path-analytics/v1`

## Purpose

The v1 calculator turns already-labelled journey-instance stage visits into deterministic, table-ready descriptive aggregates. It compares observed sequences with one explicitly versioned designed stage order. It does not label raw events, resolve identities, query an event store, render charts, or recommend actions.

Every request must supply the exact journey, journey version, rule-set version, and projection version. The result repeats this lineage together with the calculation version, period, as-of instant, optional cohort filter, and designed stage order. Data from another version is excluded rather than silently mixed.

## Input contract

Each visit has stable identifiers for the visit, source event, journey instance, profile, optional account, and cohorts. It also has a stage identifier, event time, positive revision, and the four version-lineage fields.

The calculator assumes upstream identity resolution and stage labelling have already happened. Within one journey instance, profile, account, and cohort labels must be stable. An instance with conflicting labels is excluded in full because choosing one label would make the cohort attribution arbitrary.

Periods use `[start, end)` semantics. `asOf` is a separate reproducibility boundary. Visits later than `asOf` are excluded even when their event time would otherwise be in the requested period.

## Correction and ordering rules

Visits are corrected by `visitId` and positive `revision`:

1. Structurally invalid records are rejected.
2. The greatest revision is selected before period and cohort filtering.
3. Lower revisions are superseded. This means an old in-period record cannot reappear when its correction moves outside the period.
4. Exact duplicates of the selected revision collapse to one visit.
5. Conflicting records at the same greatest revision exclude that visit; v1 never chooses one by arrival order.
6. A selected record carrying `invalidReason` retracts the visit.

Accepted visits are ordered by event time and then by `visitId`. This is deterministic for shuffled or replayed input. Equal event times are reported as ambiguous ordering. The identifier tie-break is a reproducibility rule, not evidence that one event caused or preceded the other in the real world.

## Output tables

All count and rate rows use a common measure shape:

- `numerator`: the observed count or summed duration;
- `denominator`: the population or observation count used by that calculation;
- `sampleSize`: distinct journey instances supporting the row;
- `percentage`: `numerator / denominator * 100` for count/rate rows, otherwise `null`;
- `suppressed`: whether values were redacted.

The result is deliberately a collection of rows suitable for an accessible table, CSV, or later API response. No chart semantics are embedded.

### Path signatures

The signature is the JSON encoding of the complete ordered stage-id array. Repeats remain in the signature. Count and percentage use journey instances with that exact signature over all accepted journey instances.

### Transition matrix

Each row is an observed adjacent `fromStageId`/`toStageId` pair. The numerator is occurrence count, the denominator is all observed adjacent transitions, and sample size is distinct journey instances supporting the pair. Rows are sparse: an absent row does not distinguish zero from privacy suppression without reading the table suppression metadata.

Transitions are classified against the designed order as:

- `expected`: exactly one stage forward;
- `skipped_forward`: more than one stage forward, with the missing designed stages listed;
- `backward_loop`: movement to an earlier designed stage;
- `repeated_stage`: the same stage twice in succession;
- `unexpected_unknown_stage`: either stage is absent from the designed order.

The skipped and unexpected tables are filtered views of the same transition calculation, so their numerators and lineage remain consistent with the matrix. Backward and repeated transitions also feed the loops table.

### Funnel

The first designed stage is the funnel entry. An instance completes later stages only in designed order after that entry. Repeated, backward, skipped, and unknown visits do not advance the contiguous completion cursor, but a later visit to the next expected stage can advance it. The funnel therefore measures ordered progression, not merely whether a stage appeared anywhere.

Each stage row reports the entrant cohort, stage completions, and drop-off before the next designed stage. The final stage has zero post-stage drop-off because v1 has no separately configured success event after completion.

### Loops and repeats

Loops list visible backward or same-stage adjacent transitions. Repeats aggregate stages visited more than once within an instance and count visits beyond the first. A repeat can be non-consecutive; a same-stage loop is necessarily consecutive.

### Entry and exit

Entry and exit are the first and last accepted visits inside the requested period for an instance. They are observational window boundaries. They do not assert that the customer journey began or ended there.

### Stage durations

Duration is the elapsed event time from a visit to the next accepted visit in the same instance and is attributed to the earlier stage. Terminal visits are right-censored and contribute no duration. Durations do not bridge events omitted by the period boundary.

Rows report total, observation count, minimum, arithmetic mean, p50, p90, p95, and maximum in milliseconds. Percentiles use deterministic linear interpolation at `(n - 1) * p`, rounded to the nearest millisecond. Sample size remains the number of distinct journey instances, which can be smaller than the duration observation count when a stage repeats.

## Minimum-cohort suppression

`minimumCohortSize` is required and positive.

- When the accepted cohort has fewer instances than the threshold, sample counts, data-quality counts, and all table rows are redacted.
- Categorical path, transition, loop, repeat, entry/exit, and duration groups supported by fewer instances than the threshold are omitted. The table reports `small_groups_omitted` without revealing how many groups or people were hidden.
- Funnel labels are part of the designed map and remain structurally known, but individual measures below the threshold are null and marked suppressed.
- Small non-zero data-quality counts are null because record-quality categories can themselves be sensitive.
- Zero values remain visible when the surrounding cohort is large enough.

This is a calculation-level minimum-cell rule, not a complete privacy system. A production query layer must also prevent differencing attacks across overlapping cohorts and periods, enforce permissions, bound query cardinality, rate-limit exploration, audit access, and apply the platform's approved secondary-suppression or privacy-budget policy. Raw profile, account, visit, and event identifiers are never returned by this calculator.

## Interpretation boundary

Every result carries a `descriptive_only` statement. The outputs describe labelled observations. They do not establish:

- why a person transitioned, repeated, skipped, or dropped off;
- causal effects of a touchpoint, intervention, persona, or channel;
- statistical significance, confidence intervals, or representativeness;
- whether a missing visit means inactivity, collection failure, consent withdrawal, or mapping failure;
- the duration of the final stage;
- a complete lifetime journey outside the selected period.

No score, prediction, anomaly claim, recommendation, or automated action is produced.

## Operational work still required

This foundation is intentionally pure and in-memory. Before production use, the programme still needs:

- durable versioned journey-instance and stage-visit projections;
- late-arrival watermarks, replay checkpoints, and correction audit records;
- authorised cohort definitions and identity/consent enforcement;
- bounded query and materialisation strategies for large populations;
- API schemas, pagination, caching, and export controls;
- secondary suppression and differencing protections;
- projection freshness and completeness indicators;
- user-interface copy that preserves the descriptive-only and period-boundary caveats;
- parity tests against the production projection and database engines.

Until those controls exist, this module is evidence for the calculation contract only, not evidence that Phase 5C is production-complete.
