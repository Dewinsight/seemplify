# ADR-0001: Canonical event protocol and durable ingestion

**State:** Proposed  
**Scope:** Phase 0 and Phase 5A  
**Decision owners:** Product, data platform, developer platform, security

## Context

Connected journeys need browser, server, mobile, webhook, and connector events
to mean the same thing. Existing `backend/src/events.ts` is an authenticated
in-process UI notification stream and is explicitly not a customer telemetry
API. Accepting an event before it is durable, trusting a client-supplied space,
or allowing SDK-specific envelopes would make deduplication, privacy, metrics,
and replay unreliable.

## Decision

1. A versioned protocol package owns the JSON Schemas, TypeScript types, golden
   examples, validation fixtures, and stable error codes.
2. Protocol v1 uses the master-plan envelope: `protocolVersion`, `eventId`,
   `event`, `eventVersion`, `occurredAt`, permitted subject/session identifiers,
   bounded `properties`, privacy-minimised `context`, and purpose-specific
   `consent`.
3. Event names are lower snake case; reserved prefixes and prototype-pollution
   keys are rejected. Names, nesting, arrays, strings, numbers, bytes, batch
   size, and clock skew are bounded.
4. The credential resolves space, source, and environment. Payload values can
   never override those boundaries.
5. `POST /v1/events` and `/v1/batch` authenticate, enforce source/origin/scope,
   validate protocol/schema/privacy, deduplicate, and append durably before
   acknowledging acceptance.
6. Delivery is at least once. `(space, source, eventId)` is the idempotency key.
   A duplicate returns its prior acceptance outcome and never increments usage
   or derived measures again.
7. A valid new event returns `202` only after durable commit; a duplicate
   returns `200`; a mixed batch returns `207` with one stable result per input.
8. Identity, stage evaluation, aggregates, and trigger candidates are
   asynchronous, independently versioned processors with durable receipts.
9. Unknown schemas follow an explicit source mode: strict reject, quarantine,
   or migration-only restricted acceptance. Strict is the production default.
10. Ordinary logs and traces contain receipt IDs and routing metadata, not raw
    identifiers or payloads.

## Rejected alternatives

- Reusing the SSE bus: it is process-local, read-oriented, and not durable.
- A best-effort analytics endpoint: it violates the no-acknowledged-loss target.
- Trusting `spaceId` in a payload: it creates a tenant-confusion boundary.
- One schema per SDK: it guarantees semantic and error drift.
- Exactly-once transport claims: retries and network ambiguity still exist;
  durable idempotency is the honest contract.

## Consequences

- Ingest and application routes may start in one deployment but remain separate
  modules, connection pools, credentials, limits, and observability domains.
- Protocol compatibility becomes a release gate for every SDK and connector.
- Quarantined events consume controlled storage but cannot enrich identities,
  affect journeys, or trigger actions until an authorised resolution.

## Verification gates

- Golden valid/invalid/batch fixtures run against protocol, server, and SDKs.
- Crash after commit/before response returns duplicate on retry without loss.
- Invalid, over-limit, wrong-origin, revoked-key, cross-space, consent-denied,
  and partial-batch cases have stable negative tests.
- Failure injection proves `202` is impossible without durable append.
- Load/soak evidence meets the ratified latency and durability objectives.

