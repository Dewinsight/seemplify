# Seemplify Journey Swift

Private Swift Package Manager foundation for emitting Seemplify Journey Event
Protocol `1.0` envelopes from Apple applications. The package is MIT licensed
but is not released and has no production Journey ingestion service to target.

## Supported foundation surface

- Swift tools `5.10`, iOS 15+, and macOS 12+
- canonical `track`, `metric`, `identify`, `alias`, `group`, `page`, `screen`,
  and `consent` calls
- client `reset`, `flush`, and `shutdown` operations
- bounded event count, byte size, age, and batch size
- stable event IDs, partial-result handling, duplicate acceptance, bounded
  exponential backoff, jitter, and `Retry-After`
- injectable transport, clock, ID generator, randomness, lifecycle source, and
  network source
- privacy-key rejection and URL query minimisation before an envelope reaches
  either storage or transport
- an opt-in Apple store using a Keychain-held AES-256-GCM key, atomic file
  replacement, and iOS file protection

This is a source foundation, not a support promise. The current Windows host
does not contain Swift, Xcode, simulators, or Apple platform SDKs. The repository
static contract check therefore makes **no compilation or runtime-test claim**.
The pinned macOS workflow must complete successfully before this package gains
even CI compilation evidence; real-device, lifecycle, upgrade, and crash-recovery
qualification remain separate release gates.

## Installation during private development

Add the local package directory in Xcode or declare a local SwiftPM dependency.
Do not add a remote package URL or tag until the remaining release approvals
are complete.

```swift
import SeemplifyJourney

let secureStore = try AppleProtectedJourneyStore()
let client = JourneyClient(configuration: JourneyClientConfiguration(
    writeKey: "jpk_dev.replace_me.00000000000000000000000000000000",
    endpoint: URL(string: "https://journey-ingest.example.com")!,
    environment: .development,
    initialConsent: JourneyConsent(
        analytics: .granted,
        source: "cmp",
        updatedAt: JourneyProtocol.timestamp(Date())
    ),
    secureStore: secureStore
))

await client.track(
    "onboarding_started",
    properties: ["entry_point": .string("welcome")]
)
await client.metric(
    "workspace_activation_seconds",
    name: "time_to_activation",
    value: 183.5,
    unit: "seconds",
    dimensions: ["plan": .string("team")]
)
_ = await client.flush()
```

Only a public write key (`jpk_dev.*`, `jpk_stg.*`, or `jpk_live.*`) belongs in an app.
Server secrets are rejected by configuration validation and must never be
embedded in an iOS or macOS binary.

## Consent and persistence

Analytics events are neither persisted nor transmitted until analytics consent
is granted. With `beforeConsent: .bufferMemory`, they can remain only in a
bounded process-memory buffer; the default is to drop them. With denied consent,
the client purges analytics events and identifiers before queuing the consent
control signal. `reset()` clears queue, consent, and identity state and removes
the encrypted store.

Passing no `secureStore` is an explicit memory-only mode: it is bounded but not
durable and loses queued work on process termination. The SDK never falls back
to `UserDefaults` or a plaintext file. If a configured store does not promise
both encryption and atomic replacement, or a store operation fails, the client
fails closed and disables delivery instead of downgrading protection.

`AppleProtectedJourneyStore` encrypts the serialized queue with AES-256-GCM. Its
key is stored as a Keychain generic-password item using
`AfterFirstUnlockThisDeviceOnly`; its opaque, hashed queue file is replaced
atomically and uses complete file protection until first unlock on iOS. Use a
unique `storageKey` for each logical client and do not run multiple writers for
the same key. File-protection behaviour while a device is locked and crash
recovery still require real-device qualification.

## Host hooks and diagnostics

Applications may implement `JourneyLifecycleSource` and `JourneyNetworkSource`
to trigger bounded background, foreground, and reconnect delivery. The SDK does
not manufacture application lifecycle or reachability state. Host failures are
contained and surfaced only as stable diagnostic codes.

Diagnostics are disabled in production even if `debug` is true. They contain
codes, counts, bounded delays, and HTTP status only—never event payloads,
identifiers, credentials, URLs, or exception strings.

## Private verification

From `experience-management` on any host with Node:

```sh
npm run test:journey-swift:contract
```

That command checks protocol constants, canonical JSON fixtures, privacy and
credential guardrails, secure-store primitives, test-category presence, and the
pinned CI definition. It intentionally does not parse or compile Swift.

On an approved macOS/Xcode 15.4 host:

```sh
swift package dump-package --package-path packages/journey-swift
swift test --package-path packages/journey-swift --parallel
swift build --package-path packages/journey-swift -c release
```

The authored XCTest suite covers canonical fixtures, all wire calls, consent,
reset, offline reconnect, partial and duplicate results, retry timing, corrupt
and unsupported state, secure-store failure, lifecycle failure, and transport
failure. Those tests remain unverified until Swift execution succeeds.

## Release state

There is no registry upload, binary distribution, tag, or release artifact in
this MIT-licensed foundation. See `../SDK-SUPPORT.md`, `../SDK-RELEASE.md`, and
`CHANGELOG.md` for the explicit open gates.
