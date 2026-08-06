# Seemplify Journey React Native SDK

`@seemplify/journey-react-native` is a private Phase 5E foundation for emitting
the canonical Seemplify Journey Event Protocol from React Native applications.
It is framework-module-neutral: the runtime artifact imports neither React
Native modules nor Node built-ins and never touches DOM globals.

## Delivery status

This package has not been published, run against a production ingestion plane,
or qualified on real iOS and Android devices. The protocol package's mock server
is an in-memory conformance helper only. Do not interpret a mock receipt as
durable delivery.

A supported release still requires a durable source/key control plane and data
plane, real-device and operating-system matrices, historical upgrade fixtures,
dogfood and soak evidence, security/privacy review, and the release decisions
listed in the repository support matrix.

## Security and storage boundary

- Configure only a public `jpk_dev.*`, `jpk_stg.*`, or `jpk_live.*` write key. Server secrets
  are rejected.
- HTTPS is required except for loopback conformance tests.
- The package does not bundle `AsyncStorage`, a keychain library, filesystem
  access, SQLite, or another persistence implementation.
- Durable queueing is enabled only when the host explicitly injects an adapter
  attesting both encryption at rest and atomic replacement.
- A missing adapter means an explicit bounded process-memory queue. An invalid,
  corrupt, or failing configured secure adapter disables collection and clears
  in-memory identity/queue state; it never silently changes to another store.
- Events collected before analytics consent are dropped by default. Optional
  `buffer-memory` mode is bounded and cannot write to persistent storage. A
  denial purges analytics queue and identity state before its control event can
  be sent.

The adapter's security markers are an integration contract, not cryptographic
verification by JavaScript. The application owner must select, configure, and
test a native store that actually provides the stated guarantees on every
supported platform.

## Host integration

```ts
import { createReactNativeJourneySdk } from '@seemplify/journey-react-native';
import { secureJourneyStorage } from './secureJourneyStorage';
import { journeyRuntime } from './journeyRuntime';

const journey = createReactNativeJourneySdk({
  writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
  endpoint: 'https://ingest.example.com',
  environment: 'development',
  storage: secureJourneyStorage,
  runtime: journeyRuntime,
  consent: {
    analytics: 'granted',
    source: 'application_privacy_settings',
    updatedAt: new Date().toISOString()
  },
  queue: {
    maxEvents: 500,
    maxBytes: 512 * 1024,
    maxAgeMs: 24 * 60 * 60 * 1_000
  },
  delivery: {
    flushIntervalMs: 30_000,
    flushOnBackground: true,
    flushOnForeground: true,
    flushOnNetworkReconnect: true,
    backgroundBatchBytes: 60_000,
    minimumBatteryLevel: 0.15,
    pauseAutomaticFlushInLowPowerMode: true
  },
  // Every automatic field is opt-in. No advertising or hardware identifier is
  // collected by the SDK.
  automaticContext: { app: true, device: true, locale: true, timezone: true },
  privacy: { denyPropertyNames: ['email_body', 'survey_answer', 'ai_prompt'] }
});

await journey.ready;
await journey.screen('Onboarding');
await journey.track('onboarding_started', { entry_point: 'welcome' });
```

An adapter-shaped example is in [`examples/basic.ts`](./examples/basic.ts).

`runtime.lifecycle`, `runtime.network`, `runtime.battery`, and `runtime.context`
are explicit bridges owned by the host application. Subscription methods must
return cleanup functions. Battery policy applies only to automatic flushes;
an explicit `flush()` remains an operator/application checkpoint.

## API

- `track(event, properties?, options?)`
- `identify(userId, traits?, options?)`
- `alias(userId, anonymousId?, options?)`
- `group(accountId, traits?, options?)`
- `screen(name?, properties?, options?)`
- `consent(snapshot, options?)`
- `flush()`
- `reset()`
- `destroy()`
- `status()`

`reset()` purges queue, buffered pre-consent events, and identity state. Use it
at sign-out or an equivalent account boundary. `destroy()` unsubscribes host
lifecycle/network bridges, attempts a final bounded flush, and cancels SDK
timers. The host still owns its background-execution deadline.

## Delivery, privacy, and failure behavior

- Event IDs are created once and retained through retry; caller-supplied IDs
  allow authoritative idempotency.
- Queue count, encoded bytes, event age, batch count, batch bytes, retry count,
  retry delay, timeout, and background work are bounded.
- Partial receipts are applied per event; only retryable or missing results are
  retained with exponential backoff and jitter.
- Recursive property filtering removes common credentials, payment fields,
  government identifiers, advertising identifiers, and configured denied
  fields. URL credentials/fragments are removed and query parameters are denied
  unless explicitly allowlisted.
- App, device class/model/OS, locale, and timezone context are opt-in and supplied
  by the host. The SDK does not discover or emit a device, installation,
  advertising, hardware, IP, email, or phone identifier.
- Transport, timer, adapter, callback, and malformed-response failures resolve
  to stable outcomes/diagnostics rather than escaping into the application.
  Diagnostics contain no payload, identity, URL, credential, or exception text.

Server-side schema, purpose, consent, privacy, quota, and tenant enforcement
remain authoritative. An SDK filter is defense in depth, not a data-governance
boundary.

## Verification

```sh
npm run typecheck --workspace @seemplify/journey-react-native
npm run test --workspace @seemplify/journey-react-native
npm run build --workspace @seemplify/journey-react-native
npm run test:sdk:react-native-compat
npm run test:sdk:consumer
```

The focused suite covers protocol/mock conformance, all public calls, stable
IDs, consent gating and withdrawal, encrypted/atomic adapter enforcement,
state hydration/corruption/version handling, bounded count/byte/age queues,
offline/network/app-state/battery transitions, partial receipts, timeout,
callback isolation, and source/runtime portability. The compatibility gate
bundles the built artifact for a neutral React Native resolver and executes it
with DOM/network/crypto globals denied. These local tests do not establish a
real-device support matrix.

See the repository-wide [support matrix](../SDK-SUPPORT.md) and
[release process](../SDK-RELEASE.md).
