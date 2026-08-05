# ADR-0003: Identity, consent, and privacy propagation

**State:** Proposed  
**Scope:** Phase 5B and all downstream personal-data processing  
**Decision owners:** Product, data platform, security/privacy

## Context

Customer 360 and actual paths require identity continuity, but heuristic merges
can combine different people and make analytics, actions, and privacy responses
unsafe. Consent and suppression must remain purpose-specific and must propagate
to raw and derived stores.

## Decision

1. Profiles, accounts, personas, segments, and journey instances are distinct
   entities in schemas, APIs, permissions, and UI.
2. Browser/mobile sources create a first-party anonymous identifier only under
   the configured consent policy. A public key cannot perform arbitrary
   known-to-known merges.
3. `identify` links the active anonymous profile to an authorised configured
   external-ID namespace. Known-to-known merge is a privileged server/admin
   operation with conflict detection and audit.
4. Email and phone are disabled as identity keys by default. If ratified for a
   source, normalisation, keyed hash/encryption, verification provenance,
   purpose, retention, and deletion are explicit.
5. High-assurance identity conflicts stop automatic processing and enter a
   permissioned resolution queue. Merge operations are idempotent and preserve
   redirects/tombstones plus a controlled split/reversal path.
6. Consent records are purpose-specific (`analytics`, `personalisation`,
   `research_contact`, `marketing`) and retain source, policy basis, version,
   effective time, and audit. They are not represented as one Boolean.
7. Suppression is checked before enrichment, segmentation, stage processing,
   profile drill-down, and every orchestration action.
8. Export, correction, suppression, erasure, and retention use durable,
   resumable jobs with checkpoints and completion proof across identities,
   events, instances, segments, evidence, aggregates, debug/dead-letter, and
   actions.
9. Cross-space identity matching is prohibited. Sensitive profile operations
   require separately assignable capabilities and purpose-aware audit.
10. Customer 360 distinguishes observed facts, source assertions, inferred
    traits/persona assignments, survey evidence, and AI interpretations.

## Consequences

- Some cross-device activity remains separate until a deterministic authorised
  link exists; correctness is preferred to inflated continuity.
- Aggregate deletion policy must be explicit: either recompute affected buckets
  or irreversibly anonymise only where policy allows.
- Customer 360 external beta requires a privacy impact assessment.

## Verification gates

- Anonymous-to-known, repeat identify, cross-device, conflicting identity,
  merge/split/undo, late event, and tombstone tests.
- Cross-space enumeration and unauthorised sensitive-field tests.
- Consent withdrawal and suppression prevent prohibited downstream processing
  and actions, including queued work.
- Portable export and erasure reconcile across every registered data lineage.

