# Seemplify Journey Swift changelog

The package is private and has never been released.

## Unreleased

### Added

- SwiftPM foundation for iOS 15+ and macOS 12+ using Journey Event Protocol
  `1.0` without a forked wire schema.
- Public-key-only `track`, `metric`, `identify`, `alias`, `group`, `page`,
  `screen`, and `consent` APIs plus `reset`, `flush`, and `shutdown`.
- Consent-first bounded memory/secure queues, stable IDs, partial-result and
  duplicate handling, retry/backoff/jitter/`Retry-After`, safe diagnostics, and
  injectable host dependencies.
- Keychain/AES-GCM/atomic-file Apple storage with iOS file protection and no
  plaintext fallback.
- Canonical fixtures and XCTest cases for protocol drift, privacy, consent,
  reset, offline, retry, duplicate, corruption, upgrade boundary, and host
  failures.
- Windows static contract verifier and pinned macOS/Xcode 15.4 CI definition.

### Changed

- Replaced the obsolete `sp_test/live` key grammar with canonical
  `jpk_dev/stg/live` public credentials and fail-closed environment matching.

### Verification gaps

- Swift is unavailable on the current Windows host, so no local compile or
  XCTest execution is claimed.
- The macOS workflow is configured but has not yet supplied a successful-run
  artifact for this change.
- Simulator/device, lifecycle, locked-device persistence, historical upgrade,
  crash-recovery, durable-endpoint, dogfood, security, and performance evidence
  remain open.

### Release blockers

- No licence, support ratification, version tag, distribution approval, or
  production ingestion endpoint exists.
