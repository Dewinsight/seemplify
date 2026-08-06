# ADR-0005: Metric definitions, observations, and lineage

**State:** Provisionally implemented; governance ratification pending  
**Scope:** Phase 2 and Phase 5 analytics  
**Decision owners:** Product analytics, data platform, security/privacy

## Decision

1. A metric definition is versioned and contains type, unit, direction, source,
   journey/stage/touchpoint binding, bounded formula/operator AST, filters,
   population, window, aggregation, baseline, target, and minimum sample policy.
2. Initial formulas use an allowlisted operator vocabulary rather than arbitrary
   executable expressions. Division-by-zero, non-finite values, numeric bounds,
   and incompatible units are explicit validation errors.
3. An observation records definition version, source/projection version, cohort,
   window, value, numerator, denominator, sample, confidence where applicable,
   freshness, correction state, and lineage references.
4. NPS, CSAT, CES, completion/dropout, ticket, and social measures reuse existing
   deterministic calculators and reconcile with their systems of record.
5. Imported operational values require scoped server credentials and an approved
   schema; they are labelled imported, never observed raw events. The existing
   `events:write` server capability is accepted only when the active credential,
   source, environment, published schema, definition-authorised source reference,
   schema version, and configured projection/rule lineage all match. Public
   credentials and caller-supplied lineage overrides fail closed.
6. Event time controls business windows. Corrections and late data produce new
   labelled observation/projection versions and auditable rebuild jobs.
7. Every UI/exported value exposes definition, numerator/denominator/sample,
   filters, window, source, freshness, and lineage. A percentage without a
   denominator is prohibited.
8. Small/stale samples cannot automatically produce strong evidence or
   consequential triggers. Comparison and driver language never claims
   causation without an appropriate experiment design.

## Verification gates

- Golden NPS/CSAT/CES and numeric/formula-boundary datasets.
- Source correction/deletion, late event, cohort filter, timezone, and rebuild
  reconciliation tests.
- UI/E2E assertion that every number has an explain surface and accessible text.

## Implementation note

Runtime schema 21 implements the durable backend decision: tenant-safe bindings,
segments, immutable definition versions and observations, bounded lineage,
definition-scoped revision streams, fenced rebuild attempts, checkpoints, audit,
entitlements, and usage metering. SQLite parity and PostgreSQL rollback/replay,
least-privilege, drift, and two-connection revision probes pass. This is not a
`Verified` product capability until the explain/binding UI and remaining
accessibility, privacy, capacity, security, and release gates pass.
