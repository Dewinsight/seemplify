# Journey Management domain glossary

**Status:** Proposed  
**Last updated:** 2026-08-04

This is the canonical vocabulary for APIs, database records, product copy,
analytics, SDK documentation, audit events, and support material. A synonym may
be used in customer-facing copy only when it does not change the meaning below.

## Journey truth states

| Term | Canonical meaning | Must never imply |
| --- | --- | --- |
| Designed journey | A human- or AI-authored hypothesis about an intended experience. | That customers followed the path or that a claim is observed. |
| Evidence-backed journey | A designed map with authorised evidence supporting one or more claims. Evidence state is evaluated per artefact; the label does not validate every card. | Continuous telemetry, causality, or complete research coverage. |
| Connected journey | A published definition with versioned stage rules and observed journey instances derived from accepted events. | That every event matched, every identity is known, or an association is causal. |
| Current-state map | A representation intended to describe the experience today. Its truth state is still designed, evidence-backed, or connected. | That “current” automatically means observed. |
| Future-state map | A proposed target experience. | An operational commitment or forecast. |
| Ideal-state map | An unconstrained or aspirational target experience. | A delivery plan. |
| Service blueprint | A journey view connecting participant experience to frontstage, backstage, systems, policy, ownership, and operations. | An observed process unless its elements cite evidence or telemetry. |

Truth state is independent of map type and lifecycle. For example, a published
future-state journey can remain `designed`; publication means approved content,
not observed truth.

## People, groups, and identity

| Term | Definition |
| --- | --- |
| Persona | A reusable, versioned, evidence-backed archetype; never an individual person. |
| Segment | A dynamic or materialised cohort selected by versioned rules over authorised data. |
| Profile | A space-scoped known or anonymous individual projection with identifiers, traits, consent, provenance, and interactions. |
| Account | An organisation, household, team, or other grouping of profiles. |
| Anonymous identity | A pseudonymous identifier that is not merged with a known profile without an authenticated or privileged deterministic link. |
| Alias | An audited assertion that two identifiers refer to the same profile within one space. |
| Identity merge | A reversible, audited graph operation; not a destructive rewrite of source facts. |

Names, email addresses, IP addresses, devices, and shared accounts are not by
themselves safe automatic merge keys.

## Maps and observations

| Term | Definition |
| --- | --- |
| Journey definition | The stable identity and governance record for a journey across versions. |
| Journey version | An immutable published/superseded snapshot or one mutable draft. |
| Journey instance | Observed progress of one permitted profile or account under an exact journey and mapping-rule version. |
| Stage | A meaningful phase defined primarily by the participant’s goal. |
| Step | A finer activity within a stage. |
| Lane | A typed or custom row used to organise map artefacts. |
| Card | A structured map artefact placed at a stage/lane intersection. |
| Touchpoint | An interaction between participant and organisation, partner, or system. |
| Channel | The medium through which a touchpoint occurs. |
| Moment of truth | A touchpoint or stage with disproportionate effect on the intended outcome. |
| Journey view | A saved presentation/filter configuration that does not alter underlying facts. |

## Research, claims, and metrics

| Term | Definition |
| --- | --- |
| Evidence source | An authorised, space-scoped source record resolved by an authoritative adapter. |
| Evidence link | A reference from a journey artefact to a source/version, bounded excerpt or aggregate definition, relationship, and access state. |
| Claim | A falsifiable statement associated with a journey artefact. |
| Hypothesis | A claim without sufficient supporting evidence. |
| Contradiction | Authorised evidence that materially conflicts with a claim or other cited evidence; it is not silently resolved by AI. |
| Research gap | A specific missing population, period, method, source, or validation needed to strengthen a claim. |
| Metric definition | A versioned formula, source, filters, aggregation, window, unit, and target. |
| Metric observation | A computed/imported value for an exact metric definition version, period, filter scope, numerator, denominator, and sample. |
| Proposed measure | A desired metric without an observed value. |
| Benchmark | A comparison whose population, period, provenance, and compatibility are known. |

An AI summary is an interpretation, never an evidence source or metric
observation. Percentages without denominators and “live” metrics without
freshness/source information are invalid product states.

## Management and action

| Term | Definition |
| --- | --- |
| Pain point | A reusable, evidence-backed participant problem that may affect multiple journeys. |
| Opportunity | An outcome-oriented improvement area linked to evidence and pain points. |
| Solution | A proposed response to one or more opportunities. |
| Initiative | An owned, scheduled, measurable delivery effort implementing a solution. |
| Workflow | A versioned trigger/condition/action definition with consent, suppression, approval, and idempotency policy. |
| Workflow run | An immutable evaluation of one published workflow version against a triggering fact. |
| Action attempt | One adapter delivery attempt within a workflow run. |
| Closed-loop outcome | The measured result of an approved action, linked without claiming causality unless the study design supports it. |

## Event platform

| Term | Definition |
| --- | --- |
| Event source | A space-owned producer configuration for one environment and credential policy. |
| Tracking plan | The approved event names, schemas, classifications, and compatibility rules for a source. |
| Receipt | Durable acknowledgement metadata for an ingestion request. |
| Canonical event | An accepted, validated, consent-permitted immutable event. |
| Rejection | An event not accepted as canonical, with deterministic machine-readable reasons. |
| Dead letter | A durably accepted record that exhausted downstream processing and awaits controlled replay or disposition. |
| Mapping rule | A versioned rule assigning canonical events to stage entry, progress, success, failure, or exit. |
| Reprojection | Explicit recalculation into a named mapping/projection version; historical results are never silently rewritten. |

## Invariants

1. `spaceId` is derived from authenticated membership or a scoped credential,
   never trusted from an arbitrary browser field.
2. Published content and rules are immutable; changes create new versions.
3. Every observed or calculated claim retains lineage and access scope.
4. Public keys are ingestion-only; server secrets never ship in clients.
5. Event acknowledgement follows durable persistence.
6. Processing assumes at-least-once delivery and is idempotent by message ID.
7. Consent, retention, suppression, deletion, entitlement, and permission are
   enforced on the server and propagated to derived stores.
8. External generated content requires human approval unless a separately
   authorised bounded workflow explicitly permits automatic delivery.
9. UI hiding is never the only security or entitlement control.
10. Long-running work is durable, observable, restart-recoverable, and
    cancellable where cancellation is safe.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Product | Unassigned | — | Pending |
| Engineering | Unassigned | — | Pending |
| Security/privacy | Unassigned | — | Pending |
| Operations/data | Unassigned | — | Pending |
