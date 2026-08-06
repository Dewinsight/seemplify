# Changelog

## Unreleased

- Added an original Kotlin/Android foundation for protocol 1.0 calls.
- Added consent-before-persistence/transmission, privacy minimisation, bounded
  queue/batch/age behavior, partial receipts, stable-ID retry, jitter, and
  Retry-After handling.
- Added fail-closed secure persistence plus Android Keystore AES-GCM and
  AtomicFile storage.
- Added injectable transport/time/ID/randomness and Android lifecycle/network
  bridges.
- Added ten canonical call/batch/result fixtures, 12 passing JVM tests, two
  passing API 35 emulator instrumentation tests, Windows verification, metadata
  inspection, and disabled non-publishing CI.
- Unified public credentials on `jpk_dev/stg/live` and reject legacy keys or an
  explicitly mismatched SDK environment.

Nothing in this changelog has been externally released.
