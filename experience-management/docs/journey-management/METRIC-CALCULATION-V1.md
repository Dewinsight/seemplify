# Journey metric calculation v1

**Contract version:** `journey-metric-calculation/v1`  
**Fixture version:** `journey-metric-golden/v1`  
**Status:** deterministic calculation foundation; not yet a persisted Journey
metric-definition or observation service

## Purpose

This contract calculates explainable NPS, CSAT, and CES observations from an
authorised set of response samples. It does not query surveys or write Journey
observations. A future source adapter must perform tenant, permission, consent,
and stage-binding checks before constructing the calculation request.

Every result exposes:

- the metric-definition and calculator versions;
- value, unit, numerator, denominator, and sample size;
- an event-time period using an inclusive start and exclusive end;
- canonical definition and contributing source references;
- freshness as of an explicit instant;
- invalid, duplicate, and out-of-period exclusions;
- the minimum-sample warning state;
- the effective scale, direction, formula, favourable rule, and precision; and
- a deterministic plain-language explanation.

## Formula catalogue

### NPS

Version 1 supports standard NPS only. Its definition must explicitly declare:

- scale `0..10`, step `1`;
- detractors `0..6`;
- promoters `9..10`;
- direction `higher_is_better`; and
- output decimal precision.

The formula is:

```text
((promoter count - detractor count) / valid response count) * 100
```

The numerator is `promoter count - detractor count`; the denominator and sample
size are the valid response count. A definition with different bands is not
silently treated as NPS. Integer precision produces the same rounding semantics
as the existing survey `computeAnalytics` path.

### CSAT and CES

CSAT and CES do not have an implicit universal scale or polarity. Each
definition must declare:

- minimum, maximum, and allowed step;
- `higher_is_better` with a `>=` favourable threshold, or
  `lower_is_better` with a `<=` favourable threshold;
- either `mean` or `favourable_percentage`; and
- output decimal precision.

For `mean`:

```text
sum of valid scores / valid response count
```

The numerator is the score sum and the unit is `scale_points`. This option
reconciles with the current survey CSAT/CES arithmetic averages when supplied
the same values and precision.

For `favourable_percentage`:

```text
(responses matching the favourable rule / valid response count) * 100
```

The numerator is the favourable response count and the unit is `percent`.
Consequently, an effort-worded CES can be lower-is-better while an ease-worded
CES can be higher-is-better; neither interpretation is guessed from its name.

## Determinism and exclusions

1. Timestamps must be RFC 3339 instants with `Z` or an explicit offset.
2. Period membership uses `start <= occurredAt < end` and excludes observations
   after the calculation's `asOf` instant.
3. Values must be finite JSON numbers. Numeric strings are not coerced.
4. Values outside the scale or between configured scale steps are invalid.
5. A source-marked invalid/retracted sample is excluded with its supplied
   reason.
6. `sampleId` is the idempotency key. The highest positive integer revision is
   authoritative. Older revisions are duplicate exclusions.
7. Multiple byte-distinct records at the same highest revision are all rejected
   as a conflict. The calculator never chooses one based on input order.
8. Accepted samples, source references, and exclusion records are sorted using
   stable ordinal text ordering before producing the result.

No-response observations use `value: null` and `numerator: null`; they never
manufacture zero as a metric value.

## Freshness and minimum sample

Freshness is based on the latest accepted sample's event time relative to
`asOf` and the definition's explicit maximum age. It is `unavailable` when no
sample is accepted. Freshness says when the underlying evidence was observed;
it is not a statement that a projection job or external source is healthy.

The minimum-sample warning is active whenever accepted sample size is below the
definition threshold, including zero. The calculator still returns the
mathematical result for a non-empty small sample so the observation remains
auditable. Downstream UI, alerts, comparisons, and orchestration must prevent a
small sample from being represented as strong evidence or used for a
consequential trigger.

## Golden datasets

`backend/test/fixtures/journey-metrics/v1/golden.json` locks:

- standard NPS with a corrected response, invalid data, a retraction, a future
  event, an out-of-window event, staleness, and a small-sample warning;
- 1-to-5 mean CSAT with a favourable threshold and exclusive period end;
- 1-to-7 lower-is-better mean CES; and
- 1-to-7 higher-is-better ease CES using favourable percentage.

The test also reverses every input array to prove order independence and checks
NPS/mean CSAT/mean CES parity against `backend/src/analytics.ts`.

## Durable backend and deliberate limitations

Runtime schema 21 now provides durable survey/collector/question bindings to
journey targets, immutable definition versions and aggregate observations,
source permission resolution, correction/deletion rebuild jobs, baselines,
targets, bounded operational imports, checkpoints and audit. The companion
operational calculator covers completion/dropout, ticket, social sentiment and
bounded custom measures.

Still deliberately absent are a ratified definition approval workflow,
governed cohort/consent expressions, timezone calendar bucketing, confidence
intervals and trend materialisation, native ticket/social adapters, privacy
suppression, alerts, and accessible explain/analytics interfaces. The pure
calculator remains the authoritative arithmetic contract used by that durable
backend; neither layer should be described as `Verified` until the remaining
product and release gates pass.
