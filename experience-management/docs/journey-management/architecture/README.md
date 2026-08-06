# Journey Management architecture decisions

These records turn the programme plan into explicit engineering contracts.
The ADRs and policy records remain **Proposed** or **Draft** until product,
engineering, security/privacy, and operations ratify the decisions that affect
their release gates. Tested domain and SDK foundations are labelled separately;
that label does not imply their complete user outcome or release gate is shipped.
Implementation may proceed behind disabled flags using the conservative defaults
recorded here; external release cannot.

| Record | Subject | State |
| --- | --- | --- |
| [ADR-0001](./ADR-0001-event-protocol-and-ingestion.md) | Canonical event protocol and durable ingestion | Proposed |
| [ADR-0002](./ADR-0002-event-storage-and-projections.md) | Event storage, partitions, and rebuildable projections | Proposed |
| [ADR-0003](./ADR-0003-identity-consent-and-privacy.md) | Identity, consent, profiles, and privacy propagation | Proposed |
| [ADR-0004](./ADR-0004-tenancy-and-evidence-links.md) | Tenancy and evidence-reference boundaries | Proposed |
| [ADR-0005](./ADR-0005-metric-definitions-and-observations.md) | Metric formulas, observations, and lineage | Proposed |
| [ADR-0006](./ADR-0006-orchestration-safety.md) | Orchestration, approval, and idempotent action delivery | Proposed |
| [ADR-0007](./ADR-0007-sdk-compatibility.md) | SDK compatibility and conformance | Proposed |
| [ADR-0008](./ADR-0008-migration-and-progressive-delivery.md) | Additive migration and progressive delivery | Proposed |
| [Threat model](./THREAT-MODEL.md) | Threats, trust boundaries, and mandatory controls | Draft |
| [Data classification](./DATA-CLASSIFICATION.md) | Default data classes and handling rules | Draft |
| [Domain glossary](./DOMAIN-GLOSSARY.md) | Canonical product vocabulary and semantic invariants | Proposed |
| [Quality budgets](./QUALITY-BUDGETS.md) | Accessibility, performance, reliability, and scale gates | Proposed |
| [Feature controls](./FEATURE-CONTROL-CATALOGUE.md) | Flags, entitlements, permissions, quotas, and kill switches | Proposed |
| [Dogfood tracking plan](./DOGFOOD-TRACKING-PLAN.md) | Seemplify activation events, emitters, fields, owners, and privacy constraints | Proposed |
| [Operations and incidents](./OPERATIONS-AND-INCIDENTS.md) | Ownership boundaries, severity, telemetry, response, and runbook gates | Proposed |
| [Identity policy v1](./IDENTITY-RESOLUTION-POLICY-V1.md) | Deterministic identity, alias, merge/split, membership, and tombstone rules | Proposed |
| [UX concepts](../UX-CONCEPTS.md) | Cross-surface interaction, truth-state, responsive, and accessibility contract | Proposed |
| [Metric calculation v1](../METRIC-CALCULATION-V1.md) | Deterministic NPS, CSAT, and CES formula and lineage contract | Implemented foundation |
| [Operational measures v1](../OPERATIONAL-MEASURES-V1.md) | Stage progression, service/recovery, sentiment, and bounded custom measures with exact lineage | Implemented foundation |
| [Evidence lifecycle v1](../EVIDENCE-LIFECYCLE-V1.md) | Authorised read state, source-change review, redaction, and immutable refresh rules | Implemented foundation |
| [Service blueprint contract v1](../SERVICE-BLUEPRINT-CONTRACT-V1.md) | Typed lanes, operational semantics, lines, validation, and comparison | Implemented foundation |
| [Actual-path analytics v1](../ACTUAL-PATH-ANALYTICS-V1.md) | Versioned descriptive path, funnel, transition, loop, duration, and suppression rules | Implemented foundation |
| [Event control plane v1](../EVENT-CONTROL-PLANE-V1.md) | Source policy, one-time hashed credentials, rotation/revocation, schemas, and validation modes | Implemented foundation |
| [Portfolio domain v1](../PORTFOLIO-DOMAIN-V1.md) | Reusable improvement chain, links, lifecycle, dependencies, scoring, baselines, and outcomes | Implemented foundation |
| [Governed template backend](../../../backend/src/journeyTemplates.ts) | Durable system/organisation template versions, review/publication, retirement, audit, permissions, quotas, and exact map pinning | Implemented backend slice; UI and release gates pending |

## SDK package guides

| Package | Implemented foundation | Not yet delivered |
| --- | --- | --- |
| [`@seemplify/journey-browser-sdk`](../../../packages/journey-browser-sdk/README.md) | Consent-aware collection, privacy minimisation, bounded queues, batching, duplicate-safe retry, offline/lifecycle handling, safe diagnostics, and host isolation; 21 focused tests. | Durable ingest endpoint conformance, release pipeline, application dogfood, compatibility/bundle/CSP gates, and production support evidence. |
| [`@seemplify/journey-react`](../../../packages/journey-react/README.md) | SSR-inert and StrictMode-safe provider, shared owned-client leases, external-client support, and stable fail-closed hooks; 11 focused tests. | Application integration, end-to-end durable-ingest proof, release packaging, compatibility matrix, and browser/runtime gates. |
| [`@seemplify/journey-node`](../../../packages/journey-node/README.md) | Node-only server client with environment-matched server secrets, canonical events, retry-stable IDs, bounded memory batching, partial acceptance, retry/timeout/abort, flush/close, safe callbacks, and redaction; 14 focused tests. | Durable ingest endpoint conformance, optional durable server queue decision, application dogfood, release packaging, compatibility matrix, and production support evidence. |

These package guides describe isolated client foundations. They are not evidence
that the event control plane, durable `/v1/events` data plane, event debugger,
journey projections, mobile SDKs, or production rollout are complete.

## Ratification

Each record needs named approval from:

- Product for user-visible semantics and packaging.
- Engineering for correctness, operability, and compatibility.
- Security/privacy for ingestion, identity, consent, export/deletion, sharing,
  webhooks, and consequential actions.
- Operations for SLOs, capacity, incident controls, and recovery.

Approval must record the date, approvers, unresolved follow-ups, and the first
release gate to which it applies. A merge alone does not mean approval.
