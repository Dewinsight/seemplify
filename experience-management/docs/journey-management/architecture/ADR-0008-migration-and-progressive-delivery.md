# ADR-0008: Additive migration and progressive delivery

**State:** Proposed  
**Scope:** All phases  
**Decision owners:** Application platform, data platform, operations

## Decision

1. Every stateful tranche includes a checksummed additive PostgreSQL migration,
   runtime compatibility contract, SQLite fresh-install/upgrade parity, and
   actual PostgreSQL upgrade test before application cutover.
2. Journey Map 2.0 follows converter → bounded idempotent backfill → detailed
   reconciliation → flag-controlled dual write → shadow/compare read → internal
   cutover → design partner → percentage rollout → default v2 → approved cleanup.
3. Reconciliation includes definitions, historical versions, stages/items,
   ordering, provenance, timestamps, ownership, checksums, and export equivalence;
   counts alone are insufficient.
4. Mixed-version application/database deployment, least privilege, source
   preconditions, drift, backup/restore, rollback, and enterprise-sized values
   are tested. Unbounded text/JSON is never used as a B-tree key.
5. Progressive flags are server-enforced and audited. UI flags are presentation
   only. Entitlements, permissions, quotas, and kill switches remain independent
   decisions and are included in bounded diagnostics.
6. Rollback selects a compatible read/projection/workflow version and pauses new
   incompatible work. It does not delete raw facts or fabricate legacy state.
7. Destructive cleanup requires signed reconciliation, restore rehearsal,
   stability window, privacy/retention review, and explicit approval.

## Verification gates

- Fresh install, every supported upgrade path, replay/idempotency, drift,
  downgrade/rollback, backup/restore, mixed-version, and least-privilege tests.
- Dual-write divergence and shadow-read comparison are observable and bounded.
- A release cannot advance while the production PostgreSQL E2E gate is red.

