# Journey Management feature-control catalogue

**Status:** Proposed  
**Last updated:** 2026-08-04

Five independent controls are evaluated for every protected operation:

1. Progressive feature flag (code exposure/rollout).
2. Subscription entitlement and quota (commercial allowance).
3. Member capability (authorisation).
4. Operational kill switch (incident containment).
5. Data-policy gate (consent, retention, suppression, region, source access).

The server denies if any required control denies. UI navigation and actions
reflect the effective decision but never replace it. Diagnostic output records
the decision categories and policy versions without leaking secrets.

## Progressive flags

| Flag | Default before its phase gate | Primary protected surface |
| --- | --- | --- |
| `journeys_v2_read` | Enabled for migrated internal spaces | V2 reads and compatibility view |
| `journeys_v2_write` | Internal allowlist | Structured edits |
| `journeys_v2_dual_write` | Disabled | Compatibility dual-write |
| `journeys_v2_compare_reads` | Internal allowlist | Shadow reconciliation |
| `journey_personas` | Internal allowlist | Persona library and linking |
| `journey_multi_persona` | Internal allowlist | Persona layers/comparison |
| `journey_visual_editor` | Internal allowlist | Map editor |
| `journey_research_hub` | Disabled | Source search/linking |
| `journey_evidence_validation` | Disabled | Refresh, contradictions, gaps |
| `journey_templates` | Disabled | Template create/apply/governance |
| `journey_exports_v2` | JSON/CSV only | Document/presentation exports |
| `journey_live_metrics` | Disabled | Observations and dashboards |
| `journey_metric_alerts` | Disabled | Threshold/anomaly evaluation |
| `journey_portfolio` | Disabled | Reusable problems/opportunities/initiatives |
| `journey_collaboration` | Disabled | Comments, mentions, approvals, notifications |
| `journey_hierarchy` | Disabled | Parent/child and link graph |
| `journey_blueprints` | Disabled | Structured blueprint operations |
| `journey_event_sources` | Disabled | Sources, environments, credentials, schemas |
| `journey_event_ingestion` | Disabled | Public data plane |
| `journey_event_processing` | Disabled | Identity/mapping/projection consumers |
| `journey_identity_resolution` | Disabled | Alias/merge/split and profiles |
| `journey_customer_360` | Disabled | Profile/account read surfaces |
| `journey_actual_paths` | Disabled | Path aggregates and drill-down |
| `journey_ai_path_insights` | Disabled | Grounded path summaries |
| `journey_orchestration_authoring` | Disabled | Workflow builder/test/publish |
| `journey_orchestration_execution` | Disabled | Trigger evaluation/actions |
| `journey_mobile_sdks` | Disabled | Mobile source enablement |
| `journey_connectors` | Disabled | External connector control plane |

Flags are environment-aware and optionally space-cohorted. Defaults live in a
durable control-plane record with revision, author, reason, effective time, and
audit event; they are not mutable process environment variables alone.

## Entitlements and quotas

Required features:

- `journeyMapping`, `journeyEvidence`, `journeyLiveMetrics`
- `journeyPortfolio`, `journeyCollaboration`, `journeyBlueprints`
- `connectedJourneys`, `customerProfiles`, `advancedJourneyAnalytics`
- `journeyOrchestration`, `mobileSdks`, `journeyConnectors`

Required metered limits:

- journeys, personas, published templates, expiring shares
- event sources, schema definitions, active mapping rule sets
- monthly accepted unique events, retained profiles, retention days
- active workflows, monthly action attempts, webhook destinations
- stored event/debug/dead-letter bytes and export jobs

Unique accepted facts are metered atomically from immutable usage-ledger entries.
Retries and duplicates do not consume additional event/action allowance. Every
limit defines warning thresholds, reset period, grace/overage/reject policy,
suspension behaviour, and reconciliation job.

## Member capabilities

- `journeys.view`, `journeys.create`, `journeys.edit`, `journeys.delete`
- `journeys.publish`, `journeys.export`, `journeys.share`
- `journeys.manage_personas`, `journeys.manage_evidence`
- `journeys.manage_metrics`, `journeys.manage_portfolio`
- `journeys.comment`, `journeys.approve`
- `journeys.manage_hierarchy`, `journeys.manage_blueprints`
- `journeys.view_profiles`, `journeys.export_profiles`
- `journeys.manage_sources`, `journeys.manage_keys`, `journeys.manage_schemas`
- `journeys.manage_identity`
- `journeys.manage_workflows`, `journeys.publish_workflows`
- `journeys.approve_actions`, `journeys.view_audit`

Raw events, debug payloads, profile export, key management, identity merge/split,
workflow publication, and action approval remain separately assignable sensitive
capabilities. Platform support uses time-bound, reasoned, audited break-glass
access rather than implicit global application membership.

## Kill switches

| Switch | Scope | Safe behaviour |
| --- | --- | --- |
| Event acceptance | Global, region, space, source | Reject before persistence with retry guidance; never acknowledge dropped data. |
| Event processing | Global, region, space, source, consumer | Continue durable acceptance within capacity; pause leases and expose lag. |
| Identity merge | Global or space | Continue events; suppress new merges while preserving links for later replay. |
| Mapping/reprojection | Global, space, definition | Pause projection jobs; keep immutable events and current labelled results. |
| Journey AI | Global, space, action | Reject new AI work; do not corrupt queued/manual editing. |
| Workflow execution | Global, space, workflow, adapter, profile | Stop new eligible effects; preserve run/audit state and define delayed-attempt cancellation. |
| Credential/source | One key, source, connector | Revoke promptly; keep historical audit and non-secret fingerprint. |
| Compatibility read | Global or space | Force legacy reads during the migration window. |
| Sharing/export | Global, space, share/export type | Block creation and optionally revoke existing public shares by policy. |

Every activation requires actor/service, reason, incident/reference, expiry or
review time, scope, previous value, and audit event. Automated activation is
allowed only for ratified thresholds and must page the owning team.

## Evaluation result contract

A server decision exposes a stable machine code and safe remediation category:

- `FEATURE_NOT_ROLLED_OUT`
- `SUBSCRIPTION_FEATURE_DISABLED`
- `SUBSCRIPTION_LIMIT_REACHED`
- `CAPABILITY_REQUIRED`
- `OPERATION_PAUSED`
- `CONSENT_REQUIRED`
- `SOURCE_ACCESS_RESTRICTED`
- `RETENTION_POLICY_DENIED`
- `REGIONAL_POLICY_DENIED`

Tests must prove navigation hiding and direct API denial independently, including
cross-space IDs, stale clients, disabled plans, exhausted quotas, role changes,
kill-switch races, and execution-time consent withdrawal.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Product/commercial | Unassigned | — | Pending |
| Engineering | Unassigned | — | Pending |
| Security/privacy | Unassigned | — | Pending |
| Operations/support | Unassigned | — | Pending |
