# Journey Management documentation index

## Product and domain contracts

- **[ACTUAL-PATH-ANALYTICS-V1.md](./ACTUAL-PATH-ANALYTICS-V1.md)** - Deterministic actual-path analytics foundation contract
- **[EVENT-CONTROL-PLANE-V1.md](./EVENT-CONTROL-PLANE-V1.md)** - Environment-scoped event source governance
- **[EVIDENCE-LIFECYCLE-V1.md](./EVIDENCE-LIFECYCLE-V1.md)** - Authoritative evidence refresh and access lifecycle
- **[METRIC-CALCULATION-V1.md](./METRIC-CALCULATION-V1.md)** - Explainable NPS, CSAT, and CES calculations
- **[OPERATIONAL-MEASURES-V1.md](./OPERATIONAL-MEASURES-V1.md)** - Deterministic operational measure calculations
- **[PORTFOLIO-DOMAIN-V1.md](./PORTFOLIO-DOMAIN-V1.md)** - Reusable improvement portfolio domain contract
- **[SERVICE-BLUEPRINT-CONTRACT-V1.md](./SERVICE-BLUEPRINT-CONTRACT-V1.md)** - Structured service blueprint validation contract
- **[STAGE-REPROJECTION-RUNTIME-30.md](./STAGE-REPROJECTION-RUNTIME-30.md)** - Retained event stage reprojection design
- **[USAGE-METERING-RUNTIME-15.md](./USAGE-METERING-RUNTIME-15.md)** - Immutable usage metering and reconciliation
- **[UX-CONCEPTS.md](./UX-CONCEPTS.md)** - Cross-surface interaction and truth-state concepts

## Programme evidence

- **[completion-evidence.json](./completion-evidence.json)** - Machine-readable requirement evidence register
- **[SECTION-27-OUTCOME-AUDIT-2026-08-06.md](./SECTION-27-OUTCOME-AUDIT-2026-08-06.md)** - Twelve-outcome completion audit and blockers

## Architecture and governance

- **[ADR-0001-event-protocol-and-ingestion.md](./architecture/ADR-0001-event-protocol-and-ingestion.md)** - Canonical event protocol and ingestion
- **[ADR-0002-event-storage-and-projections.md](./architecture/ADR-0002-event-storage-and-projections.md)** - Immutable storage and rebuildable projections
- **[ADR-0003-identity-consent-and-privacy.md](./architecture/ADR-0003-identity-consent-and-privacy.md)** - Identity, consent, and privacy propagation
- **[ADR-0004-tenancy-and-evidence-links.md](./architecture/ADR-0004-tenancy-and-evidence-links.md)** - Tenant and evidence-reference boundaries
- **[ADR-0005-metric-definitions-and-observations.md](./architecture/ADR-0005-metric-definitions-and-observations.md)** - Versioned metrics, observations, and lineage
- **[ADR-0006-orchestration-safety.md](./architecture/ADR-0006-orchestration-safety.md)** - Safe idempotent action orchestration
- **[ADR-0007-sdk-compatibility.md](./architecture/ADR-0007-sdk-compatibility.md)** - Cross-SDK compatibility and conformance
- **[ADR-0008-migration-and-progressive-delivery.md](./architecture/ADR-0008-migration-and-progressive-delivery.md)** - Additive migration and progressive delivery
- **[DATA-CLASSIFICATION.md](./architecture/DATA-CLASSIFICATION.md)** - Journey data classification and retention
- **[DOGFOOD-TRACKING-PLAN.md](./architecture/DOGFOOD-TRACKING-PLAN.md)** - Internal activation journey tracking plan
- **[DOMAIN-GLOSSARY.md](./architecture/DOMAIN-GLOSSARY.md)** - Canonical Journey Management vocabulary
- **[FEATURE-CONTROL-CATALOGUE.md](./architecture/FEATURE-CONTROL-CATALOGUE.md)** - Flags, entitlements, quotas, and kill switches
- **[IDENTITY-RESOLUTION-POLICY-V1.md](./architecture/IDENTITY-RESOLUTION-POLICY-V1.md)** - Deterministic identity resolution policy
- **[OPERATIONS-AND-INCIDENTS.md](./architecture/OPERATIONS-AND-INCIDENTS.md)** - Operations ownership and incident contract
- **[QUALITY-BUDGETS.md](./architecture/QUALITY-BUDGETS.md)** - Performance, accessibility, and resilience budgets
- **[README.md](./architecture/README.md)** - Architecture decision status and governance
- **[THREAT-MODEL.md](./architecture/THREAT-MODEL.md)** - Connected journey security threat ledger

## Dogfood evidence

- **[latest-activation-report.json](./dogfood/latest-activation-report.json)** - Machine-readable activation reconciliation report
- **[latest-activation-report.md](./dogfood/latest-activation-report.md)** - Human-readable activation reconciliation report

## Operations evidence

- **[latest-connected-journey-release-gate-report.json](./operations/latest-connected-journey-release-gate-report.json)** - Machine-readable connected-journey release gate
- **[latest-connected-journey-release-gate-report.md](./operations/latest-connected-journey-release-gate-report.md)** - Connected-journey release blockers and status
- **[latest-phase2-release-gate-report.json](./operations/latest-phase2-release-gate-report.json)** - Machine-readable Phase 2 release gate
- **[latest-phase2-release-gate-report.md](./operations/latest-phase2-release-gate-report.md)** - Phase 2 metrics gate and blockers
- **[latest-phase4-enterprise-load-report.json](./operations/latest-phase4-enterprise-load-report.json)** - Machine-readable Phase 4 synthetic load evidence
- **[latest-phase4-enterprise-load-report.md](./operations/latest-phase4-enterprise-load-report.md)** - Phase 4 performance candidate and blockers
- **[latest-ingest-gate-report.json](./operations/latest-ingest-gate-report.json)** - Machine-readable PostgreSQL ingest gate
- **[latest-ingest-gate-report.md](./operations/latest-ingest-gate-report.md)** - PostgreSQL ingest security and load report
- **[latest-journey-closure-blockers-report.json](./operations/latest-journey-closure-blockers-report.json)** - Machine-readable programme closure blockers
- **[latest-journey-closure-blockers-report.md](./operations/latest-journey-closure-blockers-report.md)** - Programme closure blocker summary
- **[latest-sdk-publication-readiness-report.json](./operations/latest-sdk-publication-readiness-report.json)** - Machine-readable SDK publication readiness
- **[latest-sdk-publication-readiness-report.md](./operations/latest-sdk-publication-readiness-report.md)** - SDK publication blockers and non-claims
