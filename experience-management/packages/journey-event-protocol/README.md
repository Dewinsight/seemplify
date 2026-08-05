# `@seemplify/journey-event-protocol`

Canonical Phase 0 wire contract and conformance kit for Seemplify Connected
Journeys. It implements the protocol foundation from master-plan sections 10
and 12. It deliberately does **not** provide an ingestion endpoint, event store,
identity resolver, journey processor, SDK transport, or database migration.

## Versioned contract

Protocol `1.0` is defined by JSON Schema Draft 2020-12 files in `schemas/v1`:

- `event-envelope.schema.json` — one canonical envelope for every SDK call.
- `event-batch.schema.json` — ordered, bounded delivery of up to 100 envelopes.
- `event-result.schema.json` — stable per-event acceptance outcome.
- `batch-result.schema.json` — index-preserving mixed batch results.
- `protocol-error.schema.json` — stable machine code and retry decision.

Static TypeScript contracts and deterministic reference validators are exported
from `src/index.ts`. Golden examples are under `fixtures/v1/valid`; intentionally
invalid security and boundary cases are under `fixtures/v1/invalid`.

`openapi/v1/openapi.json` is the OpenAPI 3.1 contract for the future
`POST /v1/events` and `POST /v1/batch` endpoints. Its only server uses the
reserved `.invalid` domain and the document is marked `future-not-deployed`.

```ts
import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  validateEventEnvelope,
  type JourneyEventEnvelope
} from '@seemplify/journey-event-protocol';

const result = validateEventEnvelope(candidate);
if (!result.ok) {
  // Stable path/code/message tuples suitable for an SDK debug hook.
  console.error(result.errors);
}
```

## Supported calls

| Call | Purpose | Required call-specific fields | Authority boundary |
| --- | --- | --- | --- |
| `track` | Behavioural or business fact | `event`, `eventVersion` | Public or server source |
| `identify` | Associate an approved known ID and traits | `userId` | Only configured identity namespaces |
| `alias` | Associate anonymous activity with a known ID | `anonymousId`, `userId` | Arbitrary known-to-known merge remains server/admin-only |
| `group` | Associate a profile with an account | `accountId` plus `userId` or `anonymousId` | Source must be allowed to assert membership |
| `page` | Privacy-minimised web navigation | Subject/session identifier | Automatic collection is opt-in |
| `screen` | Privacy-minimised app navigation | Subject/session identifier | Automatic collection is opt-in |
| `consent` | Update purpose-specific consent state | `consent` | Never reduced to one Boolean |
| `metric` | Approved operational measurement | `event`, `eventVersion`, `metric` | Server-only |

`delete` and `suppress` are intentionally absent. They are authenticated privacy
operations, not public browser/mobile event calls.

## Envelope rules

- `protocolVersion`, canonical UUID `eventId`, `call`, UTC `occurredAt`, and at
  least one permitted subject/session identifier are required.
- `eventId` is the future ingest idempotency key. SDK retry must preserve it.
- Event names use lower `snake_case`; reserved-prefix policy belongs to source
  configuration when ingestion is implemented.
- One envelope is at most 64 KiB. A batch is at most 512 KiB and 100 events.
- Objects are bounded to 100 properties, arrays to 64 values, nesting to eight
  levels, and strings to 4,096 characters unless a narrower field limit applies.
- `__proto__`, `prototype`, and `constructor` keys are prohibited at every depth.
- `occurredAt` remains business time. Optional `sentAt` is delivery diagnostics;
  a future ingest service adds trusted `receivedAt`.
- Personally identifying properties require a published schema/source policy.
  The protocol accepting JSON does not authorise collecting it.

The reference validators are deterministic: equivalent input produces the same
sorted path/code/message list. Server validation will remain authoritative even
when SDKs validate before sending.

See [EVENT-NAMING.md](./EVENT-NAMING.md) for event grammar, property conventions,
schema-version rules, prohibited payloads and the tracking-plan review checklist.

## Security and privacy boundaries

- Public write keys will be ingestion-only and resolve space, source and
  environment server-side. They can never read journey or profile data.
- Server secrets must never ship in Browser, React, React Native, iOS or Android
  packages. Known-to-known identity merges and `metric` use server authority.
- Origin and app-ID allowlists are abuse controls, not secret protection.
- SDKs must redact common credential/payment fields, strip URL query strings and
  fragments by default, support customer deny lists, and avoid raw payload logs.
- Consent is purpose-specific. SDKs must explicitly buffer or drop while consent
  is unknown, using bounded storage and documented expiry/overflow behaviour.
- At-least-once delivery is assumed. Retries use exponential backoff with jitter,
  honour `Retry-After`, and never generate a new ID for the same logical event.
- No accepted event may be acknowledged until a future ingest implementation has
  durably persisted it or used an explicitly documented durable edge buffer.

## Result and HTTP semantics for the future ingest service

- `202 Accepted` after durable append of a new valid event.
- `200 OK` with status `duplicate` for an already accepted `eventId`.
- `207 Multi-Status` for a mixed batch; result order/index maps to input order.
- `400/422` protocol/schema errors, `401/403` key/scope/origin errors, `413`
  byte limits, `429` rate/quota policy, and `503` only when durable acceptance
  is unavailable.
- Rejected and quarantined results carry stable machine codes. `retryable`
  controls transport retry; human-readable messages are not program logic.

## Conformance workflow

```bash
npm run typecheck --workspace @seemplify/journey-event-protocol
npm run test --workspace @seemplify/journey-event-protocol
npm run build --workspace @seemplify/journey-event-protocol
```

Every SDK must eventually run the same valid/invalid fixtures and golden error
fingerprints. A breaking field or semantic change requires a new protocol/schema
version; adding an optional field still requires compatibility tests and release
notes. Phase 5 ingestion and SDK packages must consume this contract rather than
forking protocol logic.

## Non-durable mock for SDK tests

`createMockIngestServer` supplies a loopback-only HTTP helper for SDK contract
tests. It validates protocol payloads and remembers event IDs only in process so
tests can exercise accepted, duplicate and mixed-batch responses.

```ts
import { createMockIngestServer } from '@seemplify/journey-event-protocol/mock';

const mock = createMockIngestServer();
const url = await mock.listen(); // Always 127.0.0.1 with an ephemeral port.
// Authorization: Bearer jpk_dev.<key-id>.<secret>
await mock.close();
```

Every response includes `x-seemplify-mock-ingest: non-durable-test-helper`.
The handle exposes `isDurable: false` and `productionSafe: false`. It has no
source/space resolution, durable acknowledgement, identity processing,
analytics, rate limiting or orchestration and must never be deployed or used as
a substitute for the future ingestion service.

## Release governance

This package remains private and unpublished. The repository-wide
[support matrix](https://github.com/michaelegbo/seemplify/blob/main/experience-management/packages/SDK-SUPPORT.md)
and [release/deprecation process](https://github.com/michaelegbo/seemplify/blob/main/experience-management/packages/SDK-RELEASE.md)
are release gates, not current public support promises.
