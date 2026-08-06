# Journey SDK support and compatibility

This document records what is implemented and tested. It is not a public
support promise. The five npm packages now carry MIT release metadata and
remain unpublished; the two native package foundations still remain private,
and there is no production ingestion service for any of them to target yet.

## Current matrix

| Package | Package version | Wire protocol | Runtime/module surface | Automated evidence | Release status |
| --- | --- | --- | --- | --- | --- |
| `@seemplify/journey-event-protocol` | `0.1.0` | `1.0` | Dual ESM/CommonJS; browser-safe root; explicit Node-only `/mock` subpath in both formats; JSON Schema and OpenAPI assets | Node 22 CI, strict TypeScript, schema/reference-validator parity, mock contract | Prepared for release (not published) |
| `@seemplify/journey-browser-sdk` | `0.1.0` | `1.0` | Dual ES2022 ESM/CommonJS behind a `browser` condition, for modern bundlers and direct module loading | Deterministic adapters plus built-artifact browser bundles and restricted-host failure-isolation checks in both formats; no ratified real-browser matrix | Prepared for release (not published) |
| `@seemplify/journey-react` | `0.1.0` | Via Browser SDK | Dual ESM/CommonJS; React peer range `>=18.3 <20`; SSR-inert provider and hooks | React `19.2.x`, server rendering, Strict Mode and failure isolation | Prepared for release (not published) |
| `@seemplify/journey-node` | `0.1.0` | `1.0` | Node `>=20`, dual ESM/CommonJS, server-only conditional export with no `default` fallback | Local Node 22 tests cover canonical calls, bounded import, request identity/context, transport/retry/close/privacy; Node 20/22 CI matrix is configured but awaits a successful remote run | Prepared for release (not published) |
| `@seemplify/journey-react-native` | `0.1.0` | `1.0` | Dual ES2022 ESM/CommonJS behind a `react-native` condition; no DOM, Node built-ins, or bundled native module | Deterministic host adapters plus neutral built-artifact/restricted-host checks in both formats and 12 conformance, consent, secure-storage, lifecycle, offline, retry and failure-isolation tests; no real-device/OS matrix | Prepared for release (not published) |
| `SeemplifyJourney` (SwiftPM) | `0.1.0` | `1.0` | Swift tools 5.10; iOS 15+ and macOS 12+; source package with an optional Keychain/AES-GCM/atomic-file store | Windows protocol/static contract passes against all eight canonical call fixtures plus batch/result fixtures; 10 XCTest scenarios are authored but Swift is unavailable locally; pinned macOS/Xcode 15.4 CI is configured but unobserved | Private foundation |
| `com.seemplify:journey-kotlin` | `0.1.0-foundation` | `1.0` | Android minSdk 23/compileSdk 35; JVM 17; Gradle 8.10.2, AGP 8.7.3 and Kotlin 2.0.21 | Static protocol/package contract and clean Windows gate pass ten-fixture/no-publication checks, 12/12 JVM tests, zero-finding lint, release AAR/sources/metadata and instrumentation APK; 2/2 Keystore/AtomicFile tests pass on one Android 15/API 35 emulator; broader device/OS evidence remains open | Private foundation |

The repository's npm package gate also performs a clean deterministic double
build, recursively enumerates every declared export target and checks that its
on-disk format matches the condition that reaches it, checks source maps for
embedded or absolute source data, asserts the packed payload of each tarball,
then installs real local tarballs offline into isolated temporary consumers and
exercises them.

What that consumer run proves, on Node `v22.11.0`, for all five packages:

- ESM `import` and CommonJS `require` both load every package.
- `require.resolve` returns a path under `dist/cjs/` for every specifier,
  including `@seemplify/journey-event-protocol/mock`. This is the decisive
  check: Node `>=20.19` can `require()` an ES module without throwing, so a
  callable export alone would not prove which target was selected.
- The required value is not an ES module namespace object
  (`Symbol.toStringTag !== 'Module'`).
- Published declarations typecheck from both a `.cts` and an `.mts` consumer.
- Internal `@seemplify/*` dependencies resolve at their exact pinned versions.
- A single host graph loading both the ESM and CommonJS build of
  `@seemplify/journey-node` shares verified-identity state across the two module
  instances, and an unmarked object is still rejected by both copies.

These are local-toolchain facts. They are not a real-browser, multi-Node or
physical-device matrix, and none is claimed.

## Deliberately unsupported today

- A browser/version, bundler, CSP and tree-shaking matrix has not been ratified.
  ES2022 output is a build fact, not a claim that every browser supports it.
  The CommonJS builds are proven only against Node `v22.11.0` and esbuild's
  resolver locally; no other CommonJS host has been exercised.
- `@seemplify/journey-node` exposes only a `node` condition with no `default`
  sibling. That keeps server code out of browser roots deliberately, but it also
  means resolvers that do not activate the `node` condition — notably TypeScript
  `moduleResolution: "bundler"` — cannot resolve the package. Only `NodeNext`
  resolution is covered by the declaration consumers.
- The dual-format shared-state registries in `@seemplify/journey-react` and
  `@seemplify/journey-node` live on versioned `globalThis` symbols. Only the
  `journey-node` verified-identity set is proven shared across formats by an
  executed test; the React lease registry is internal and unreachable through
  the export map, so the tarball consumer asserts only the precondition that the
  two builds load as distinct module instances.
- React `18.3` lies in the peer range but is not yet part of the automated
  compatibility matrix.
- The Node SDK deliberately has no durable queue/outbox. Its bounded
  `importBatch` helper is not a resumable production import job, and request
  identity verification remains the host application's responsibility. The
  verified-identity marker is an in-process integrity hint that stops an
  unmarked object being trusted as an identity; because it must be shared across
  module instances it is reachable on `globalThis`, so it is not a security
  boundary against code already running inside the process.
- The React Native package is a host-adapter-based foundation only. It has no
  real-device/OS qualification, historical installed-artifact upgrade matrix,
  or bundled native secure-storage/lifecycle/network adapter.
- The Swift/iOS/macOS package has no local compiler evidence, successful remote
  workflow evidence, simulator/device matrix, locked-device/file-protection
  qualification, historical upgrade run or crash-recovery run. Its Apple store
  is a source implementation, not a qualified production guarantee.
- The Kotlin/Android package has JVM and one Android 15/API 35 emulator run, but
  no ratified device/OS matrix, physical-device evidence, historical
  installed-AAR upgrade run, production lifecycle qualification or
  durable-endpoint evidence.
- The protocol mock is loopback-only and non-durable. It is a conformance helper,
  not an ingestion service.

## Compatibility rules before a public release

1. Package compatibility and wire-protocol compatibility are versioned
   separately. A package version must state every protocol version it can emit
   or consume.
2. A protocol-breaking change requires a new protocol schema/version and
   parallel conformance fixtures; changing only the npm major version is not
   enough.
3. Internal package dependencies remain exact during the foundation phase, so
   releases must follow the order in `SDK-RELEASE.md`.
4. Published artifacts are immutable. A defect is corrected with a new package
   version, never by overwriting a registry version.
5. No runtime, browser, framework or operating-system combination becomes
   supported until it is represented in CI and in this table.

## Changing a repository-enforced budget

The bundle ceilings in `SDK-QUALIFICATION.json` are repository-enforced local
measurements, not public support promises. If a deliberate SDK change needs a
higher limit, rerun the clean measurement workflow on the approved toolchain,
update the recorded budget numbers and rationale in the reviewed commit, and
keep the change paired with the code that caused the increase. Never raise a
budget just to green-light unexplained drift.

## Release gates still open

- Durable ingestion and control-plane conformance
- Shared golden-fixture execution across every SDK
- Ratified real-browser/CSP matrix and bundle-size budget (dual ESM/CommonJS
  delivery is implemented and locally gated; no size budget is ratified)
- React 18.3/19 compatibility jobs and successful Node 20/22 matrix evidence
- Real browser, bundler, SSR, CSP and tree-shaking jobs
- Real React Native iOS/Android device, lifecycle, secure-storage and upgrade jobs
- Successful Swift macOS compilation/XCTest CI followed by iOS/macOS simulator,
  device, lifecycle, locked-device storage, corruption and historical-upgrade jobs
- Expanded Kotlin physical-device/emulator/OS, Keystore/AtomicFile, lifecycle,
  crash-recovery and installed-artifact upgrade matrices beyond the single API
  35 emulator foundation run
- Security/privacy review, SCA, secret scan, SBOM and provenance
- npm `@seemplify` scope ownership and trusted-publisher setup
- Dogfood, load/soak and incident-response evidence from the master plan
