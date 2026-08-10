# Seemplify Journey Kotlin/Android SDK

`com.seemplify:journey-kotlin` is a private, unreleased Phase P5E-02 foundation
for emitting the canonical Seemplify Journey Event Protocol from Android and
Kotlin applications. It is not available from a Maven registry and must not be
represented as a production SDK.

## Delivery status

This foundation has not been published, dogfooded, or exercised against a
durable production ingestion plane. The repository protocol mock is a
non-durable conformance helper only. A supported release still requires real
device/OS and application lifecycle matrices, installed-artifact upgrades,
durable endpoint conformance, security/privacy review, load/soak results,
signing/provenance, support ownership, and protected publication controls. The
source is licensed under MIT; licensing no longer closes the other gates.

The Gradle project intentionally uses a `-foundation` version and disables all
Maven publication tasks. Its disabled CI template has read-only permissions and
contains no registry credentials or publish step.

## Security boundary

- Only public `jpk_dev.*`, `jpk_stg.*`, and `jpk_live.*` write keys are accepted. Server-secret
  key shapes cannot initialise the client.
- HTTPS is mandatory except for loopback conformance tests.
- Analytics events are neither persisted nor transmitted before explicit
  analytics consent. The default is to drop them; optional pre-consent buffering
  is bounded and process-memory-only.
- Consent withdrawal removes queued analytics, the pre-consent buffer, and
  local identity state before its latest control event is admitted. That
  revocation event retains only its prior protocol subject for server-side
  association; the subject is not restored as current SDK identity.
- Recursive minimisation removes credentials, tokens, payment/government IDs,
  advertising/hardware IDs, dangerous object keys, and configured denied keys.
  URL credentials/fragments/query values are removed unless a query key is
  explicitly allowlisted.
- Diagnostics expose stable codes and bounded counts/status/delay only. Outcome
  callbacks may receive the opaque event ID already returned to the host, but
  neither callback receives payloads, user/account/session identities,
  endpoints, keys, response bodies, exception messages, or URLs.

Server-side protocol, schema, consent, purpose, tenancy, quota, and privacy
enforcement remains authoritative. Client filtering is defense in depth.

## Crash-safe encrypted persistence

`SecureJourneyQueueStore` is an explicit host boundary. A configured adapter
must attest encryption at rest, atomic replacement, and crash safety. Invalid
guarantees or read/commit/remove failure disable collection and clear in-memory
state; there is no plaintext fallback.

`AndroidKeystoreQueueStore` is the included Android implementation:

- a non-exportable AES-GCM key in `AndroidKeyStore`;
- a versioned binary ciphertext envelope;
- authenticated decryption;
- storage under the application's no-backup directory; and
- `AtomicFile` write, `fsync`, finish/fail semantics.

Corrupt or unsupported SDK state is deleted and reported by code. Keystore or
I/O failure never falls back to preferences, SQLite, filesystem plaintext, or
an unencrypted in-memory substitute when secure persistence was configured.

## Android setup

The package currently builds from source in this repository. Until a governed
publication exists, do not copy its AAR into a production application.

```kotlin
import com.seemplify.journey.ConsentSnapshot
import com.seemplify.journey.ConsentState
import com.seemplify.journey.EventOptions
import com.seemplify.journey.JourneyClient
import com.seemplify.journey.JourneyClientConfig
import com.seemplify.journey.JourneyEnvironment
import com.seemplify.journey.android.AndroidJourneyNetwork
import com.seemplify.journey.android.AndroidKeystoreQueueStore
import com.seemplify.journey.android.AndroidProcessLifecycle
import com.seemplify.journey.android.androidJourneyContext
import com.seemplify.journey.http.UrlConnectionJourneyHttpClient

val lifecycle = AndroidProcessLifecycle()
val network = AndroidJourneyNetwork(application)
val journey = JourneyClient(
    JourneyClientConfig(
        writeKey = "jpk_dev.replace_me.00000000000000000000000000000000",
        environment = JourneyEnvironment.DEVELOPMENT,
        endpoint = "https://ingest.example.com",
        consent = ConsentSnapshot(
            analytics = ConsentState.GRANTED,
            source = "application_privacy_settings",
            updatedAt = "2026-08-04T12:30:00.000Z",
        ),
        storage = AndroidKeystoreQueueStore(application, "development"),
        http = UrlConnectionJourneyHttpClient(),
        lifecycle = lifecycle,
        network = network,
    ),
)

journey.screen("Workspace setup", options = EventOptions(context = androidJourneyContext(application)))
journey.track("onboarding_started", mapOf("entry_point" to "welcome"))
```

The host must close the client and adapters at the application/process boundary.
Android automatically contributes no advertising, hardware, installation,
email, phone, IP, or stable device identifier. `androidJourneyContext` is
explicit and limited to app name/version/build, Android, locale, and timezone.

## API

All collection and delivery functions are suspending and return stable outcomes:

- `track(event, properties?, options?)`
- `identify(userId, traits?, options?)`
- `alias(userId, anonymousId?, options?)`
- `group(accountId, traits?, options?)`
- `page(name?, properties?, options?)`
- `screen(name?, properties?, options?)`
- `metric(event, name, value, unit?, dimensions?, options?)`
- `consent(snapshot, options?)`
- `flush()`
- `reset()`
- `status()`
- `close()`

Event IDs are created exactly once and retained through every retry. A repeated
queued ID with identical content is idempotent; changed content under the same
ID is rejected. Queue count, encoded bytes, age, batch count/bytes, retry count,
backoff, jitter, Retry-After, and response body size are bounded. Partial
receipts remove accepted/duplicate events, discard terminal rejections, and
retain only missing/retryable events.

HTTP, clock, ID generation, randomness, secure storage, lifecycle, network, and
diagnostic callbacks are injectable for deterministic tests and host control.
Transport, adapter, and callback failures are contained inside the SDK.

## Verification

Windows:

```powershell
.\scripts\verify-windows.ps1
```

Direct Gradle tasks:

```text
gradlew.bat clean verifyCanonicalFixtures verifyUnreleased testDebugUnitTest lintDebug assembleRelease assembleDebugAndroidTest
```

`assembleDebugAndroidTest` only compiles the instrumentation APK. It is not
evidence that device tests ran. Use `-RunInstrumented` only with an explicitly
selected attached emulator/device; the script fails rather than silently
claiming instrumentation when no target exists.

The JVM suite covers canonical call/batch/result fixtures, consent/buffer/purge/reset,
privacy filtering, duplicate IDs, bounded count/bytes/age, secure state
hydration/corruption/upgrade, storage failure, offline/lifecycle/network
behavior, partial results, backoff/jitter/Retry-After, and host failure
containment. Android instrumentation covers Keystore encryption and AtomicFile
replacement. Both tests pass on one local Android 15/API 35 emulator, but the
supported physical-device and multi-OS matrix remains a release gate.

See [SUPPORT.md](./SUPPORT.md), [RELEASE.md](./RELEASE.md), and the repository
canonical protocol package for the governing contracts.
