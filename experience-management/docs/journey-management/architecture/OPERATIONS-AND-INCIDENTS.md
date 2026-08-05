# Journey Management operations and incident contract

**Status:** Proposed  
**Last updated:** 2026-08-04

The connected-journey programme introduces an internet-facing data plane,
identity and consent processing, analytics, and consequential actions. These
capabilities cannot inherit an informal “application team owns everything”
model. Names below are ownership roles; people and rotations remain unassigned
until ratification.

## Ownership boundaries

| Boundary | Accountable owner | Responsibilities |
| --- | --- | --- |
| Journey design and evidence | Journey product/service owner | Map APIs/UI, versions, templates, evidence adapters, research validation, exports |
| Metrics and research intelligence | Journey data owner | Metric definitions, calculations, lineage, rebuilds, alerts, reconciliation |
| Portfolio and collaboration | Journey management owner | Reusable entities, permissions, comments/approvals, notification correctness |
| Hierarchy and blueprints | Journey design owner | Link graph, blueprint semantics, shared elements, export fidelity |
| Event control plane | Connected-journey platform owner | Sources, environments, keys, schemas, plans, admin, audit |
| Event data plane | Ingestion on-call | Durable acceptance, throttling, partitions, leases, dead letters, replay |
| Identity, consent, and privacy | Identity/privacy owner | Merge/split, consent, suppression, export/deletion, residency, legal hold |
| Mapping and analytics | Journey processing owner | Rules, instances, transitions, rollups, paths, correction/reprojection |
| SDKs and developer experience | SDK owner | Compatibility, releases, conformance, examples, deprecation, supply chain |
| Orchestration | Automation on-call | Workflow publication, outbox, adapters, approvals, caps, suppressions, effects |
| Commercial controls | Platform administration owner | Entitlements, quotas, usage ledger, downgrade/overage, support diagnostics |

Every boundary needs a primary/secondary rotation, service repository, dashboard,
runbook, data steward, security contact, capacity owner, and dependency list
before external beta.

## Incident severity

| Severity | Examples | Initial response candidate |
| --- | --- | --- |
| SEV-0 | Cross-space disclosure; public/server secret exposure; consent-bypassing or duplicate consequential action; acknowledged event loss; deletion data reappears | Page security/privacy and service owners immediately; contain with scoped/global kill switch; preserve evidence; executive/legal process |
| SEV-1 | Sustained regional ingest outage; widespread identity corruption; orchestration adapter sending incorrect recipients/content; unrecoverable projection corruption | Page owning teams ≤ 5 minutes; disable affected processing/effects; status communication and incident command |
| SEV-2 | Significant lag/SLO breach; dead-letter growth; schema regression; large reconciliation drift; broken SDK release; exports expose stale/restricted citations | Page/on-call ≤ 15 minutes; pause affected source/consumer; establish customer impact and recovery plan |
| SEV-3 | Isolated source failure; bounded UI/API degradation; one workflow/rule misconfiguration with no unsafe effect | Ticket plus business-hours or agreed on-call response; scope/retry/revert |

Candidate times require operational ratification. Security/privacy classification
can raise severity irrespective of record count.

## Mandatory non-sensitive telemetry

- Request counts/bytes, accepted, duplicate, rejected, quarantined, throttled.
- Acceptance latency, queue/inbox depth and oldest age, processing/checkpoint lag.
- Schema/version rejection classes and unknown event/property cardinality.
- Canonical event, identity, mapping, aggregate, and workflow counts by opaque
  space/source identifiers suitable for restricted operations only.
- Identity create/alias/merge/split/conflict/tombstone rates.
- Unmatched/conflicting stage rules and projection/reprojection lag.
- Aggregate freshness, correction volume, and reconciliation drift.
- Workflow eligible/suppressed/approval-pending/succeeded/failed/dead-lettered,
  adapter latency, and duplicate-prevention hits.
- Entitlement denials, usage/allowance, forecast, and ledger reconciliation.
- SDK/version/source last activity and credential verification failures.

Logs, traces, and metric labels must not contain event payloads, profile traits,
emails, survey responses, prompts, document/message/agreement content, tokens,
complete URLs, exception payloads, or high-cardinality customer identifiers.
A receipt/correlation ID joins ingest → canonical event → identity → mapping →
aggregate → workflow under access-controlled support tooling.

## Alert candidates

- Any cross-space guard failure, duplicate external action, acknowledged-loss
  assertion, or secret exposure: SEV-0 immediate page.
- Sustained acceptance error/latency/traffic anomaly by region/source.
- Inbox or projection age crossing warning/critical freshness budgets.
- Dead-letter count/rate/age growth; repeated replay failure.
- Schema rejection spike after a tracking-plan/SDK deployment.
- Identity merge/conflict/deletion-resurrection anomaly.
- Unmatched/conflicting mapping-rule spike after publication.
- Aggregate reconciliation drift beyond ratified absolute/relative threshold.
- Workflow suppression/cap/consent-denial change, adapter error spike, or pending
  approval/action age above policy.
- Quota ledger reconciliation drift or unexpected usage surge.

Alerts use bounded identifiers and link to permissioned tools. A dashboard alone
is not an alert.

## Containment mapping

| Symptom | First safe control |
| --- | --- |
| Malicious/broken source traffic | Revoke key/source; throttle or stop that source before global ingest |
| Validation or schema regression | Quarantine/reject affected schema version; preserve bounded diagnostics |
| Processing bug | Continue durable acceptance within proven capacity; pause affected consumer |
| Identity corruption | Pause merges, not event acceptance; preserve merge graph and checkpoints |
| Bad mapping/aggregate | Pause projection/reprojection; retain immutable events and last labelled good result |
| AI-generated unsafe claim | Disable journey AI action; preserve manual editor and review history |
| Incorrect workflow behaviour | Pause workflow/adapter/space; cancel eligible delayed work according to recorded policy |
| Suspected cross-space access | Disable affected read/export/share path and engage security; do not delete evidence |

Operators prefer the narrowest safe control. Every change records actor/service,
reason, incident, scope, previous/new value, time, expiry/review, and recovery.

## Required runbooks before each gate

1. Source/key abuse, rotation, revocation, and credential compromise.
2. Schema rejection spike, quarantine, and compatibility rollback.
3. Ingest outage/backpressure, durable capacity, and no-loss recovery.
4. Worker lease failure, poison event, dead-letter inspection, and safe replay.
5. Identity conflict, erroneous merge, split/reversal, and tombstone recovery.
6. Consent/suppression error, collection stop, execution stop, and data review.
7. Privacy export/deletion/retention/legal-hold failure and reconciliation.
8. Mapping-rule rollback, shadow comparison, correction, and reprojection.
9. Metric drift, late/corrected source, aggregate rebuild, and published caveat.
10. SDK bad release, disablement guidance, deprecation, and customer recovery.
11. Workflow/adapter pause, pending-work disposition, duplicate prevention, and
    third-party incident coordination.
12. Cross-space or sensitive-data incident response and evidence preservation.
13. PostgreSQL backup/restore, partition maintenance, capacity, and region loss.
14. Feature-flag/entitlement/quota failure, downgrade, and ledger reconciliation.

Each runbook includes prerequisites, access level, safe dry run, exact scope
checks, rollback/recovery, verification queries, communications, and follow-up.
Destructive reprocessing/deletion steps require a second approver where policy
requires it.

## Operational release evidence

- Dashboard and alert links with synthetic trigger proof.
- Current owner/rotation and dependency escalation list.
- Capacity/load/soak report against the ratified quality budgets.
- Backup/restore and deterministic reprojection exercises.
- Kill-switch and credential-revocation exercise with measured propagation.
- Privacy export/deletion and consent-withdrawal drill.
- Orchestration failure injection proving one visible effect.
- Post-incident review template and at least one game-day report before beta.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Engineering/operations | Unassigned | — | Pending |
| Product/support | Unassigned | — | Pending |
| Security/privacy | Unassigned | — | Pending |
| Data/analytics | Unassigned | — | Pending |
