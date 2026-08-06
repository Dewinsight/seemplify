# ADR-0007: SDK compatibility and conformance

**State:** Proposed  
**Scope:** Phase 5A and 5E  
**Decision owners:** Developer platform, mobile, security/privacy

## Decision

1. One protocol package owns schemas, generated/static types, golden valid and
   invalid fixtures, normalisation, stable error codes, and a mock ingest server.
2. Browser, React, Node, React Native, Swift, Kotlin, and connectors pass the
   same protocol/error/retry/consent fixtures. Platform-specific code implements
   storage, lifecycle, transport, and context only.
3. Every SDK provides appropriate `track`, `identify`, `group`, consent,
   reset/logout, flush, and debug hooks; stable event IDs; retry-safe batching;
   bounded exponential backoff with jitter; `Retry-After`; and bounded expiry.
4. Automatic context is privacy-minimised and opt-in where practical. URLs drop
   query/fragment by default. Common credential/payment keys and configured deny
   lists are redacted client-side while server validation remains authoritative.
5. Public client keys are ingestion-only. Server secrets cannot be accepted by
   browser/mobile constructors or included in distributed artefacts.
6. Browser uses first-party storage subject to consent and `sendBeacon`/fetch;
   host application failure isolation, CSP, SSR, Strict Mode, tree shaking, and
   bundle budgets are release contracts.
7. Mobile queues use approved protected storage, bounded retention, lifecycle
   and network awareness, crash-safe persistence, battery-conscious flush, and
   explicit reinstall/logout/reset semantics.
8. Packages use semantic versioning, changelogs, compatibility/deprecation
   policy, supported-platform matrix, provenance/signing/SBOM where supported,
   and a cross-SDK conformance dashboard.

## Delivery order

Protocol/conformance → Browser → React → Node → dogfood → React Native → Swift
→ Kotlin → demand-driven connectors. Native work cannot begin before the
protocol and ingestion contract are stable in dogfood.

## Verification gates

- Golden conformance across all released SDK versions.
- Offline, overflow, retry, duplicate, clock, consent, revoke-midflight,
  lifecycle, reinstall/reset, upgrade, and hostile-host tests appropriate to the
  platform.
- Documentation examples execute against the mock and real test ingest service.

