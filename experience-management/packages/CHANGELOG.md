# Journey SDK changelog

This coordinated changelog covers the protocol, Browser, React, Node, React
Native, Swift and Kotlin/Android packages. None has been published externally.

## Unreleased

### Changed

- Unified every SDK and the control-plane contract on canonical environment-
  scoped credentials: `jpk_dev/stg/live` for distributed public write keys and
  `jsk_dev/stg/live` for server secrets. Legacy `sp_test/live` keys are rejected,
  and an explicitly configured SDK environment must match the key environment.

### Added

- Canonical protocol schemas, reference validators, conformance fixtures and a
  non-durable loopback mock.
- Consent-aware Browser SDK, SSR-safe React integration and server-only Node SDK
  foundations.
- Clean-checkout-safe source path mappings for SDK typechecks and tests.
- Deterministic clean/build verification and fail-closed `prepack` artifact
  guards.
- Dry-run tarball validation and isolated runtime/declaration consumer tests.
- Explicit repository, support and future-registry metadata.
- Compatibility, release, deprecation and disabled trusted-publishing guidance.
- Canonical Node page, screen, consent and server-metric calls; bounded
  per-envelope import; conflicting-ID rejection; and privacy-safe authenticated
  request-context middleware.
- Browser-resolvable built-artifact and restricted-host compatibility checks,
  plus a Node 20/22 SDK CI matrix definition.
- Private React Native foundation with public-key-only configuration, canonical
  calls, explicit encrypted/atomic host storage, consent-gated persistence,
  bounded lifecycle/offline/battery delivery, opt-in minimised context, stable
  IDs, partial-result retry and host-failure isolation.
- Neutral React Native built-artifact compatibility and restricted-host checks,
  plus offline tarball runtime/declaration consumption across all five packages.
- Dual ESM/CommonJS distributions for all five npm packages, each with a
  condition-matched declaration set and a `dist/cjs` CommonJS scope marker.
  `@seemplify/journey-event-protocol/mock` resolves in both formats while
  staying blocked from browser roots, and `@seemplify/journey-node` stays behind
  a `node`-only condition.
- CommonJS evidence that does not rely on an export merely being callable: the
  isolated consumer asserts `require.resolve` lands under `dist/cjs/` and that
  the required value is not an ES module namespace object, because Node
  `>=20.19` can `require()` an ES module without throwing.
- A mixed ESM + CommonJS consumer proving `@seemplify/journey-node` shares
  verified-identity state across both module instances while still rejecting an
  unmarked object. The matching `@seemplify/journey-react` lease registry is
  internal, so only the distinct-instance precondition is asserted for it.
- Restricted-host browser and React Native compatibility checks now run in both
  ESM and CommonJS, resolving by specifier through package self-reference so the
  result reflects the export map rather than workspace install topology.
- Private SwiftPM foundation for iOS 15+ and macOS 12+ with all eight canonical
  calls, consent-first bounded delivery, partial/duplicate retry semantics,
  public-key-only configuration, injectable host dependencies, privacy-safe
  diagnostics and Keychain/AES-GCM/atomic-file persistence without a plaintext
  fallback.
- All eight canonical Swift call fixtures plus batch/result fixtures, 10
  authored XCTest scenarios, a passing Windows static contract, and a pinned
  read-only macOS/Xcode 15.4 CI definition. Swift compilation and runtime
  execution are not claimed locally.
- Private Kotlin/Android foundation for minSdk 23 with all eight canonical
  calls, bounded consent-aware delivery, host adapters and an
  AndroidKeyStore/AES-GCM/AtomicFile store; canonical/no-publication guards,
  a passing Windows static contract, 12/12 JVM tests, zero-finding lint,
  release AAR/sources/metadata, instrumentation
  APK, and 2/2 Keystore/AtomicFile tests on one Android 15/API 35 emulator pass
  locally while the broader Android qualification matrix stays explicitly open.

### Release blockers

- Durable ingestion, dogfood and the master-plan production gates are incomplete.
- The ratified real-browser/CSP matrix remains incomplete; the new Node 20/22
  matrix still requires successful CI evidence. Dual ESM/CommonJS delivery is
  implemented and gated locally, but only against Node `v22.11.0` and esbuild's
  resolver on one host.
- React Native and both native foundations still need their declared real-device
  or simulator/OS, historical-upgrade, crash/storage, lifecycle, dogfood and
  durable-endpoint evidence. Swift also still needs compiler/XCTest evidence;
  Kotlin still needs physical devices and a ratified multi-version Android
  matrix beyond its single API 35 emulator run.
- npm scope ownership and a legal licence decision are not established.
