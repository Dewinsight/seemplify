# ADR-0002: Event storage and rebuildable projections

**State:** Proposed  
**Scope:** Phase 0 and Phase 5A–5C  
**Decision owners:** Data platform, operations, security/privacy

## Context

Journey analytics must accept late and duplicate events, correct identity
merges, explain stage assignments, and rebuild aggregates without rewriting
history invisibly. The existing application database is the control-plane source
of truth; connected-journey volume introduces a new write and processing shape.

## Decision

1. PostgreSQL is the initial production control plane, durable event inbox, and
   aggregate store. SQLite provides bounded local/test semantics and is never
   used as evidence of production throughput.
2. Raw accepted events are append-only, keep protocol/schema/source/environment
   versions, and are separate from mutable/rebuildable projections.
3. Production raw events and processing receipts are time partitioned. Every
   partition/index includes a bounded space/source/time routing path and avoids
   unbounded JSON/text B-tree keys.
4. Approved routing and dimension fields use typed columns. Bounded properties
   may use JSONB; promoted searchable properties require tracking-plan approval.
5. Each processor writes a durable, idempotent receipt containing processor
   version, checkpoint, status, attempts, bounded error, and completion time.
6. Identity, journey instances, metric aggregates, path signatures, anomalies,
   and trigger candidates are independent versioned projections.
7. Reprocessing writes a labelled projection version and can shadow the active
   projection before promotion. Published analytics retain their rule/formula
   and projection versions.
8. Event time drives journey and metric windows. Received time drives ingest
   operations. Late-event correction windows are configurable and auditable.
9. Raw-event, debugger/dead-letter, identity/profile, instance, aggregate, and
   action retention are separate policies with resumable expiry jobs.
10. Introduce an archival interface before high-volume GA; extract a dedicated
    data service only after measured contention, isolation, or release cadence
    crosses a ratified threshold.

## Consequences

- Derived data can be corrected and rebuilt from immutable facts.
- Projection promotion and rollback are control-plane operations, not data
  deletion.
- PostgreSQL migration, partition creation, permissions, restore, and
  enterprise-sized performance tests are required for every schema tranche.

## Verification gates

- Actual PostgreSQL upgrade/fresh-install/idempotency/least-privilege tests.
- Crash/restart, lease expiry, duplicate, late, out-of-order, correction, and
  projection rollback fixtures.
- Aggregate and path results reconcile with independently computed golden data.
- Backup/restore and raw-to-projection rebuild drills complete within ratified
  recovery objectives.

