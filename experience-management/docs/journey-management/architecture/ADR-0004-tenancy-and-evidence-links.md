# ADR-0004: Tenancy and evidence-reference boundaries

**State:** Proposed  
**Scope:** All journey control, evidence, analytics, profile, and action planes  
**Decision owners:** Application platform, evidence/intelligence, security

## Decision

1. Authenticated membership or a verified source/key resolves space identity;
   browser-supplied `spaceId` is never authoritative.
2. Every durable object carries a space predicate, including join/link tables,
   jobs, receipts, aggregates, exports, and audit. Repositories accept a resolved
   space context and include it in every read/write predicate.
3. The Journey Research Hub is a reference and assessment control plane, not a
   second document/vector store. Original documents, survey responses, social
   records, tickets, messages, agreements, and events stay in their systems of
   record.
4. Evidence uses an adapter plus immutable/version-pinned locator. Attach
   resolves the source, checks target and source permissions, captures a bounded
   excerpt or aggregate explanation, checksum, population/window, visibility,
   relationship, reviewer/method, freshness, and deletion/access state.
5. Read, synthesis, export, sharing, and AI context recheck source permission.
   A stored excerpt does not bypass later restriction, suppression, or deletion.
6. Published versions never silently replace evidence. Source change produces a
   notification and an explicit reviewed refresh change set.
7. Source deletion/restriction invalidates or redacts links and derived claims
   without leaking prohibited content into history, search, AI prompts, or
   exports. Audit retains identifiers and decisions only where policy permits.
8. Cross-space source/target IDs are rejected even when their shapes are valid.

## Consequences

- Adapters own source-specific resolution, pinning, permission, deletion, and
  source-view URLs behind one common contract.
- Evidence-backed state is computed from accessible evidence; inaccessible
  evidence is visible as a reason, not counted as support.

## Verification gates

- Positive and negative adapter tests for every source type.
- Cross-space ID, revoked membership, restricted/deleted source, stale snapshot,
  export, sharing, and AI-context tests.
- Published-version reproducibility and explicit refresh-diff E2E.

