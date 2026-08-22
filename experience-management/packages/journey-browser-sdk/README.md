# Seemplify Journey Browser SDK

`@seemplify/journey-browser-sdk` is the framework-independent browser client for
the canonical `@seemplify/journey-event-protocol` v1 envelope. It is designed to
fail closed for consent and configuration errors, and to fail safely when event
ingestion is unavailable.

## Delivery status

This package is an isolated Phase 5A SDK foundation. **There is no durable,
production ingestion server in this repository yet.** The protocol package's
mock ingest server is an in-memory conformance helper only; it does not provide
tenant resolution, key governance, durable acknowledgement, identity
processing, analytics, or production security controls.

Do not point this SDK at the mock in a production application. Shipping a real
source key and endpoint requires the source/key control plane, durable data
plane, origin policy, quotas, schema registry, privacy enforcement, and
operational review described in the Connected Journey master plan.

## Basic use

```ts
import {
  createBrowserJourneySdk,
  createLocalStorageQueueStorage
} from '@seemplify/journey-browser-sdk';

const journey = createBrowserJourneySdk({
  // This is a public, write-only source key. It is not a server secret.
  writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
  endpoint: 'https://ingest.example.com',
  environment: 'development',
  consent: {
    analytics: 'granted',
    source: 'your_cmp',
    updatedAt: new Date().toISOString()
  },
  storage: createLocalStorageQueueStorage(window.localStorage)
});

// Creation and storage hydration do not block page startup.
void journey.track('onboarding_started', { entry_point: 'welcome' });

// Await only when the caller needs a delivery checkpoint.
await journey.flush();
```

A complete executable-shaped example is in
[`examples/basic.ts`](./examples/basic.ts).

## Public API

- `track(event, properties?, options?)`
- `identify(userId, traits?, options?)`
- `alias(userId, anonymousId?, options?)`
- `group(accountId, traits?, options?)`
- `page(name?, properties?, options?)`
- `screen(name?, properties?, options?)`
- `consent(snapshot, options?)`
- `reset()`
- `flush()`
- `destroy()`
- `status()`

Every event accepts an optional caller-supplied UUID `eventId`. That ID is kept
across every retry and is the server deduplication key. If it is omitted, the SDK
generates a UUID. Calls return outcomes rather than throwing into the host app.

## Consent behaviour

Analytics consent defaults to `unknown`, and pre-consent events are dropped by
default. A customer may explicitly choose `beforeConsent: 'buffer-memory'`; in
that mode facts remain only in a bounded in-memory queue and are neither
persisted nor transmitted until consent is granted.

When analytics consent is denied:

- new behavioural, identity, group, page, and screen facts are dropped before
  persistent queueing;
- prohibited queued and pre-consent facts are purged immediately;
- persisted anonymous and known identity state is removed;
- only the minimal purpose-specific `consent` control envelope may be sent so a
  future durable service can enforce withdrawal; it contains no event
  properties or traits and is never persisted while analytics is denied.

The future ingestion service must repeat all consent and suppression checks.
Client enforcement is a privacy boundary, not proof of lawful processing.

## Queue, delivery, and lifecycle

The queue is bounded independently by event count, encoded bytes, and age. Its
default overflow strategy drops the oldest entry and reports a sanitised
outcome; `drop-newest` is also available. A supplied storage adapter can use
first-party localStorage, IndexedDB, or a host-approved store. Corrupt or
unavailable storage is isolated and never breaks the page.

Delivery is at least once:

- protocol-valid events are batched within canonical event and byte limits;
- accepted, duplicate, quarantined, rejected, retryable, missing, and mixed
  batch results are handled per event;
- retryable responses use bounded exponential backoff and jitter and honour a
  bounded `Retry-After` value;
- network and timeout failures retain the same event ID;
- offline queues flush after `online`;
- `pagehide` and hidden-document transitions use `fetch(..., { keepalive:
  true })` so the public write key remains in an authorization header rather
  than leaking into a URL.

All fetches have an abort timeout. Injected fetch, clock, random, timers,
storage, lifecycle, document, navigator, and location adapters make behaviour
deterministic in tests.

## Privacy and context

Automatic page and device context is disabled by default. When explicitly
enabled, URL fragments, credentials, and all query parameters are removed unless
a parameter is allowlisted. Page titles remain separately opt-in. Common
credential, session, token, password, payment-card, and government-identifier
property names plus a customer deny list are removed recursively before local
validation or queueing. Server validation remains authoritative.

The SDK never writes keys, identities, URLs, event bodies, or traits to the
console. Production mode disables debug diagnostics even if `debug: true` is
set. Operational callbacks receive stable codes and counts only.

## Packaging and browser safety

The package is strict TypeScript, ESM, side-effect-free, SSR-safe, tree-shakable,
and CSP-safe. It performs no global browser access at module evaluation and uses
no `eval`, dynamic code generation, Node built-ins, or Node `Buffer` polyfill.
Automatic collection is opt-in, so importing the package alone does not attach
listeners or collect facts.

The current package is private and pre-release. Semantic-version compatibility,
browser matrix, bundle-size budget, provenance/signing, and external package
publication remain release gates rather than completed claims.

The repository's local compatibility check bundles the built package with a
browser platform resolver, rejects Node built-ins/dynamic code, and executes it
in a restricted host where browser globals, storage, transport, timers, and
callbacks can fail. This proves the current ES2022 ESM artifact is browser-
resolvable and failure-isolated; it is not a substitute for a ratified real-
browser/version/CSP matrix and does not imply CommonJS support.

## Verification

```sh
npm run typecheck --workspace @seemplify/journey-browser-sdk
npm run test --workspace @seemplify/journey-browser-sdk
npm run build --workspace @seemplify/journey-browser-sdk
npm run test:sdk:browser-compat
```

The tests cover canonical conformance, consent drop/buffer/grant/withdrawal,
duplicate-safe retry, mixed results, queue bounds and expiry, persistence
hydration and corruption, offline/lifecycle behaviour, reset, timeout/abort,
privacy-minimised context, invalid configuration, and endpoint failure
isolation.

Repository-wide compatibility and release policy is recorded in the
[support matrix](https://github.com/Dewinsight/seemplify/blob/main/experience-management/packages/SDK-SUPPORT.md)
and [release/deprecation process](https://github.com/Dewinsight/seemplify/blob/main/experience-management/packages/SDK-RELEASE.md).
Those documents explicitly record the remaining CJS, browser-matrix, durable
ingestion, legal and publication gates.
