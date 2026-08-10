# Kotlin/Android release gate

No release is authorised. Do not upload an AAR, Maven module, POM, Gradle module
metadata, source archive, signature, or provenance statement to any registry.

The Gradle build may generate local POM/module metadata for inspection, but all
publish tasks are disabled and no repository is configured. The disabled CI
template is verification-only.

Release remains blocked until all of the following are evidenced and approved:

1. Durable `/v1/batch` production ingestion and source/key control plane.
2. Canonical protocol and cross-SDK conformance against the durable endpoint.
3. Real Android device/OS/manufacturer/background/process-death matrix.
4. Historical installed-artifact and encrypted-state upgrade tests.
5. Threat model, mobile privacy review, dependency/SBOM and binary scan.
6. Dogfood, soak, load, outage, retry, quota, and incident exercises.
7. Ratified support/deprecation/compatibility policy and named ownership.
8. Maven coordinates, signing keys, provenance, and a protected publication
   environment. MIT licensing is already recorded in `LICENSE` and generated
   POM metadata.

Any future publication change must remove `-foundation`, deliberately enable a
review-protected publication task, and update the programme traceability ledger.

