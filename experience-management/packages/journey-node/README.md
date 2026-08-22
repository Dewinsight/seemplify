# Seemplify Journey Node SDK

`@seemplify/journey-node` is the server-only Node.js client for the canonical
`@seemplify/journey-event-protocol` v1 envelope. It sends authoritative backend
facts with scoped server credentials while containing ingestion failures inside
the SDK.

## Delivery status

This package is an isolated Phase 5A SDK foundation. **There is no durable,
production ingestion service in this repository yet.** The protocol package's
mock server is an in-memory conformance helper only. It does not provide tenant
resolution, credential governance, durable acknowledgement, identity
processing, metering, or journey analytics.

Do not treat a successful mock response as durable delivery. A production
deployment still requires the source/key control plane, durable data plane,
schema enforcement, receipts, quotas, privacy controls, and operational gates
described in the Connected Journey master plan.

## Requirements and server-only boundary

- Node.js 20 or newer
- ESM
- A scoped `jsk_dev`, `jsk_stg`, or `jsk_live` server secret
- An HTTPS endpoint, except for HTTP loopback during local testing

The constructor intentionally has only a `serverSecret` credential field. It
rejects browser/public write keys and rejects an explicit environment that does
not match the secret prefix. The package export is available through Node's
conditional export and imports Node built-ins, so it is not a browser package.
Never pass its credential to browser, mobile, logs, exceptions, or event
properties.

## Basic use

```ts
import { createNodeJourneySdk } from '@seemplify/journey-node';

const journey = createNodeJourneySdk({
  serverSecret: process.env.SEEMPLIFY_JOURNEY_SERVER_SECRET ?? '',
  endpoint: process.env.SEEMPLIFY_JOURNEY_ENDPOINT ?? '',
  environment: 'production'
});

await journey.track(
  'survey_published',
  { survey_id: 'survey_123' },
  {
    userId: 'user_123',
    accountId: 'space_456',
    // Supply a stable UUID from the authoritative operation when possible.
    eventId: '01958f52-c169-7b87-8d6f-3a5ae80bd104'
  }
);

// At a worker checkpoint or graceful-shutdown boundary:
await journey.flush();
await journey.close();
```

An executable-shaped example is in [`examples/basic.ts`](./examples/basic.ts).

## API

- `track(event, properties?, options?)`
- `identify(userId, traits?, options?)`
- `alias(userId, anonymousId, options?)`
- `group(accountId, traits?, options?)`
- `page(name?, properties?, options?)`
- `screen(name?, properties?, options?)`
- `consent(snapshot, options?)`
- `metric(event, metric, options?)`
- `importBatch(envelopes)`
- `flush()`
- `close()`
- `status()`

Protocol v1 requires every envelope to contain at least one subject or session
identifier. `identify` and `alias` supply their own subjects. `track`, `page`,
`screen`, `consent`, and `metric` require a `userId`, `anonymousId`, `accountId`,
or `sessionId` in their options. `group` requires a `userId` or `anonymousId` in
addition to its account ID. Invalid calls return a stable result and are never
sent. `metric` is intentionally server-only and still depends on an approved
server-side tracking schema.

## Bounded historical import

`importBatch()` accepts at most the canonical protocol batch limit of 100
envelopes per call. Each envelope is independently validated and privacy-
sanitised before it reaches the normal bounded queue. Caller-supplied `eventId`
and `occurredAt` values are preserved, while stale caller `sentAt` delivery
metadata is replaced when the SDK actually sends the batch. Repeating an exact
queued envelope returns `ALREADY_QUEUED`; reusing an ID for different content
returns `EVENT_ID_CONFLICT`. Within the 100-envelope bound, the result contains
one outcome per input in the same order; an oversized call is rejected as a
whole without allocating an unbounded result list.

This helper is bounded queue input, not a direct durable import endpoint. It
does not add disk persistence, resumable import jobs, checkpointing, or a
historical correction window. Production-scale imports still require the
durable data plane and import tooling described in the master plan.

Unlike a browser client, this server client carries no ambient current-user
identity, so logout/reset is not a Node SDK operation: every call supplies its
subject explicitly. Suppress, delete, and known-to-known merge remain separate
authenticated privacy/identity APIs in the plan and are not disguised as event
calls before those server contracts exist.

## Authenticated request context

The package exports `createVerifiedJourneyIdentity()` and
`createJourneyRequestContextMiddleware()`. The middleware has a framework-
neutral Connect/Express-shaped signature and stores resolved options in a
`WeakMap`; it does not mutate the request or make identity data enumerable in
request logs.

The host must authenticate the session, service credential, or signed webhook
first. `createVerifiedJourneyIdentity()` only marks that completed host decision;
it does not inspect or verify cookies, bearer tokens, email addresses, or
signatures. The middleware ignores forged identity objects, sanitises explicit
context, never automatically copies headers or URLs, and continues the host
request if optional telemetry resolution fails. Diagnostics contain stable
codes only.

```ts
const middleware = createJourneyRequestContextMiddleware({
  async resolve(request: AuthenticatedRequest) {
    const identity = createVerifiedJourneyIdentity(
      request.authenticatedUser.id,
      'application_session'
    );
    return identity ? { identity, sessionId: request.session.id } : undefined;
  }
});

// After middleware has run:
await journey.track('settings_saved', {}, middleware.eventOptions(request));
```

## Idempotency and delivery

The canonical wire field is `eventId`; it is the message idempotency key. A
caller-supplied UUID is retained unchanged across all attempts. If it is
omitted, the SDK creates a UUID once when the event is enqueued. Retrying never
rebuilds the event or changes its ID.

Delivery is at least once:

- events and batches are validated against the canonical protocol before send;
- the in-memory queue is bounded by count, bytes, and age;
- batching is bounded by canonical count/byte limits and by work per flush;
- retryable HTTP, network, timeout, partial-result, missing-result, and invalid
  response cases use bounded exponential backoff with jitter;
- bounded `Retry-After` seconds and HTTP-date values are honoured;
- accepted, duplicate, quarantined, rejected, and retryable event results are
  applied individually;
- concurrent flush calls share one request pipeline;
- every request has an abort timeout;
- timers are `unref`'d when the host timer supports it.

`close()` stops accepting new events, attempts a final bounded flush, cancels
SDK timers, and returns any retained count. It never terminates the process or
installs signal handlers. The host owns its shutdown deadline and should inspect
the returned `retained` count.

## No disk persistence

The queue is process-local memory only. There is no file, database, Redis,
local-storage, or custom persistence adapter in this package. A crash or process
exit can therefore lose events that were not acknowledged. This is deliberate
for the first isolated foundation and avoids making durability claims before a
real ingestion service exists.

Applications that require transactional event production should eventually use
their own durable outbox and call this SDK from an idempotent worker. Do not
mistake an SDK retry queue for a transactional outbox.

## Failure and privacy behaviour

Public calls resolve to outcomes rather than throwing transport, validation,
callback, timer, or response failures into the host process. Callbacks receive
stable codes, counts, delays, and statuses only. The SDK never emits credentials,
identities, traits, properties, response bodies, URLs, or exception text through
its callbacks or the console.

Common credential, password, token, payment-card, and government-identifier
property names are removed recursively before protocol validation. Additional
denied names can be configured. Explicit page URLs are restricted to HTTP(S),
have credentials/fragments removed, and drop every query parameter unless its
name is explicitly allowed. Server-side schema and privacy enforcement remain
authoritative.

## Verification

```sh
npm run typecheck --workspace @seemplify/journey-node
npm run test --workspace @seemplify/journey-node
npm run build --workspace @seemplify/journey-node
```

The focused suite covers server-secret and environment enforcement, every
canonical Node call, bounded imports, verified request context, protocol/mock
conformance, stable IDs and ID conflicts, recursive redaction, bounded queue and
flush work, duplicate handling, partial results, retry/backoff/jitter,
`Retry-After`, timeouts/abort, concurrent flushes, graceful close, callback and
transport isolation, and the no-persistence boundary.

See the repository-wide
[support matrix](https://github.com/Dewinsight/seemplify/blob/main/experience-management/packages/SDK-SUPPORT.md)
and [release/deprecation process](https://github.com/Dewinsight/seemplify/blob/main/experience-management/packages/SDK-RELEASE.md).
The repository CI defines Node 20 and 22 SDK jobs, but only a successful remote
run is evidence for both matrix entries. CommonJS, durable ingestion and the
broader production release gates remain incomplete.
