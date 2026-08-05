# Journey operational measures v1

Status: foundation calculation contract; no persistence, API, scheduled materialisation, alerting, or user interface.

Implementation: `backend/src/journeyOperationalMeasures.ts`

Golden fixtures: `backend/test/fixtures/journey-operational-measures/v1/golden.json`

Tests: `backend/test/journey-operational-measures.test.ts`

Version: `journey-operational-measure/v1`

## Purpose

This module provides deterministic operational journey measures beyond NPS, CSAT, and CES. It covers stage progression, service/recovery outcomes, social sentiment, and a deliberately bounded custom-measure vocabulary. It consumes already-authorised, version-labelled observations and does not query source systems or infer stage membership.

The output is table-ready. Every calculated value retains numerator, denominator, sample size, unit, exact source/version lineage, period, as-of time, freshness, exclusions, minimum-sample warning, transparent formula, and a descriptive-only interpretation statement.

## Exact lineage

Every definition declares one or more exact source lineages:

- source reference and source version;
- schema version;
- projection version;
- optional journey ID, journey version, and rule-set version as one all-or-nothing group.

Stage measures require the journey fields. Observations with any lineage mismatch are excluded; v1 never silently combines journey, rule, schema, source, or projection versions. Definitions with duplicate source-lineage tuples are invalid.

The requested period uses `[start, end)` semantics. Sentiment trend also carries its comparison period. Comparison and current windows must be non-overlapping, equal in duration, and use the same timezone.

## Correction and deduplication

Each observation has a stable `observationId` and positive revision.

1. Structurally invalid records are rejected.
2. The greatest revision is selected before period filtering.
3. Lower revisions are superseded, so an older in-period value cannot reappear when a correction moves outside the period.
4. Exact duplicates of the selected revision collapse to one observation.
5. Conflicting records at the same greatest revision are all excluded; input or arrival order never chooses a winner.
6. A selected record with `invalidReason` retracts that observation.
7. Records after the calculation's `asOf` time are excluded.

Accepted observations are sorted by event time and then observation ID. Reversing the input produces the same result.

## Standard measures

### Stage entry

```text
distinct eligible journey instances entering the stage
-------------------------------------------------------- x 100
distinct eligible journey instances
```

The entry must be at or after the subject's first population-eligibility event in the period.

### Stage completion

```text
distinct stage entrants with a later/equal completion event
------------------------------------------------------------ x 100
distinct stage entrants
```

Completion is an explicit event for that stage. It is not inferred from another stage appearing or from inactivity.

### Stage conversion

```text
distinct source-stage entrants later entering the target stage
---------------------------------------------------------------- x 100
distinct source-stage entrants
```

A target entry before the source entry is not a conversion. V1 does not claim the source stage caused the target entry.

### Stage dropout

```text
distinct stage entrants with a later/equal explicit dropout event
------------------------------------------------------------------ x 100
distinct stage entrants
```

Missing completion data is not dropout. This avoids converting collection gaps, consent suppression, long-running instances, or late events into false customer outcomes.

### Ticket rate

```text
distinct eligible subjects with one or more later/equal tickets
---------------------------------------------------------------- x 100
distinct eligible subjects
```

Multiple tickets for one subject do not increase the numerator. Use a custom event count when ticket volume is the intended measure.

### Repeat-contact rate

```text
subjects with at least the configured number of contacts
---------------------------------------------------------- x 100
subjects with at least one contact
```

The threshold is an explicit integer of at least two. The unit of analysis is the definition's profile or ticket subject.

### Recovery rate

```text
eligible tickets with a later/equal observed recovery success
---------------------------------------------------------------- x 100
eligible tickets
```

Recovery requires an explicit success event. Closing a ticket, stopping contact, or the absence of another complaint is not automatically recovery.

## Social sentiment

Sentiment categories are `negative`, `neutral`, `positive`, and `unknown`. Distribution uses the latest accepted sentiment observation for each social-post subject inside the period. An invalid latest category excludes that post; an earlier category is not resurrected.

Each distribution row reports category posts over posts with a valid latest sentiment. A trend row reports:

- the comparison-period numerator, denominator, sample, and percentage;
- the current-period numerator, denominator, sample, and percentage;
- current percentage minus comparison percentage in percentage points.

Trend is a descriptive change between equal windows. It is not a test of statistical significance, does not adjust for changing audience/source composition, and cannot explain why sentiment changed.

## Safe custom measures

V1 offers three declarative templates. It does not accept JavaScript, SQL, arbitrary expressions, user-defined AST nodes, or executable formulas.

### Custom count

- `events`: count matching accepted event observations.
- `distinct_subjects`: count subjects with at least one matching event.

For an event count, numerator/value is the event count while denominator/sample size is the number of supporting distinct subjects. The denominator is context, not a division formula.

### Custom rate

The denominator is distinct subjects with a configured denominator event. The numerator is the subset also having the configured numerator event. A fixed flag controls whether the numerator must occur at or after the first denominator event. Numerator-only subjects never enter the rate.

### Custom duration

For each subject, v1 pairs the first start with the first end at or after that start. It produces one duration per subject. Missing ends are unpaired exclusions; durations above the required maximum are excluded. The summary is:

```text
sum of accepted subject durations / paired subjects
```

The output also gives observation count, minimum, p50, p90, p95, and maximum in milliseconds. Percentiles use linear interpolation at `(n - 1) * p`, rounded to the nearest millisecond. Terminal/censored durations are not estimated.

## Samples, freshness, and exclusions

`minimumSampleSize` is required. A result below the threshold remains visible but carries a warning with the configured and actual sample. Suppression is a separate privacy policy and must be enforced by the future query/materialisation layer.

Freshness reports the latest accepted, lineage-matching, relevant source observation in the current period relative to `asOf`. A formula-level exclusion such as an invalid sentiment or over-maximum duration can still demonstrate that the source feed is current; sample and exclusion fields show that it did not support the calculated value.

Exclusion counts are deterministic and cover malformed/retracted/conflicting records, source-lineage and subject-type mismatches, as-of/period boundaries, revisions/duplicates, invalid sentiments, and invalid duration pairs.

## Interpretation boundary

Every result states that it is descriptive only. None of these values establishes:

- causation or the reason for conversion, dropout, recovery, contact, or sentiment change;
- statistical significance, confidence intervals, or representative sampling;
- completeness of event collection or identity resolution;
- that missing observations mean a negative outcome;
- comparability across different definitions, versions, sources, filters, or periods;
- a benchmark, forecast, anomaly, priority, or recommended action.

## Durable backend and remaining production work

Runtime schema 21 now persists versioned definitions, immutable aggregate
observations, bounded lineage, definition-scoped server imports, corrections and
deletes, fenced rebuild attempts, checkpoints, audit, entitlements, and metering.
Imports require an active exact source/environment, published schema, and the
definition-authorised source/schema/projection lineage; arbitrary properties and
raw identifiers are not copied into the metric store.

Production completion still requires native ticket/social adapters, governed
population/filter expressions with consent, calendar bucketing and late-event
policy, scheduled materialisation SLOs, minimum/secondary cohort suppression,
explain/analytics UI, caching/exports, alerts that preserve statistical caveats,
retention operations, and volume/accessibility/security approval. Accordingly,
the backend is `Implemented`, but the product capability is not `Verified`.
