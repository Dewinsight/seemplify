# Connected Journey Management threat model

**State:** Draft for formal review  
**Method:** Asset/trust-boundary review using STRIDE-style threat categories and
privacy-abuse cases. This is a living control ledger, not a claim of security
approval or certification.

## Assets and trust boundaries

High-value assets include tenant configuration, maps/evidence, raw events,
identities/profiles/accounts, consent/suppression, aggregates, source/server
keys, workflow definitions/approvals, external action credentials, exports, and
audit/usage ledgers.

Trust boundaries:

1. Untrusted browser/mobile application → public ingest API.
2. Customer server/connector/webhook → privileged ingest/control APIs.
3. Ingest → durable event store → asynchronous processors.
4. Identity/profile processing → analytics and Customer 360.
5. Evidence systems of record → Research Hub → map/AI/export/share.
6. Trigger evaluation → approval → action adapter → external provider.
7. Space user → application API; platform support/admin → global control plane.
8. Local SQLite/test environments → production PostgreSQL/runtime contracts.

## Threat and mandatory-control ledger

| ID | Threat/abuse | Mandatory preventive controls | Required detection/recovery evidence |
| --- | --- | --- | --- |
| T-01 | Public/server key theft or copied public key abuse | Ingestion-only public scope, protected server secrets, one-time display, prefixes/fingerprints, origin/app diagnostics, IP scope where useful, limits, rotation/revoke | Unusual traffic alerts, last-use audit, revoke-midflight and compromise runbook |
| T-02 | Tenant confusion/IDOR | Space resolved from membership/key; space predicate in every table/query/link/job/export; opaque IDs are not authorisation | Automated cross-space reads/writes/search/export/debug/profile tests |
| T-03 | Event poisoning and schema bypass | Versioned tracking plans/schemas, strict default, bounds, type/range/cardinality controls, trust/source labels, quarantine without processing | Rejection/quarantine metrics, schema spike alerts, authorised resolution/replay audit |
| T-04 | Payload denial of service | Pre-parse byte/decompression limits, depth/array/string/batch bounds, rate/byte budgets before expensive work | Abuse/load/soak tests, throttling telemetry and source/global pause |
| T-05 | Prototype pollution/stored XSS/formula injection | Dangerous-key rejection, canonical JSON parsing, output sanitisation/encoding, bounded formulas, export escaping | Hostile fixture suite across API/UI/export/SDK |
| T-06 | Sensitive data leakage to events, logs, debugger, AI, export | Default-deny classification, SDK/server redaction, content prohibitions, permissioned short-retention debugger, reference-only evidence, prompt boundaries | Payload/log sampling audit, secret/PII scanners, deletion/export negative tests |
| T-07 | Identity takeover or false merge | Configured namespaces, authenticated identify, no email/IP heuristics, high-assurance conflict queue, privileged merge, redirects/tombstones, reversible split | Merge/conflict anomaly metrics, merge/split/undo/cross-device property tests |
| T-08 | Tracking or action without consent | Purpose-specific consent, explicit pre-consent SDK behaviour, suppression before processing and execution, durable propagation | Consent-block metrics, queued-action withdrawal tests, privacy-job checkpoints |
| T-09 | Incomplete export/erasure/retention | Data-lineage registry, resumable jobs, tombstones, derived-store propagation/rebuild, retention by class/environment | Backlog alerts, portable export reconciliation and end-to-end erasure proof |
| T-10 | Duplicate/lost/corrupted events | 202 after durable commit, stable event ID, unique receipt, idempotent processors, immutable raw facts, checksums/backups | Crash-at-boundary and replay tests; inbox/receipt/aggregate reconciliation |
| T-11 | Misleading analytics or path continuity | Versioned deterministic formulas/rules, numerator/denominator/sample/window/source, small-cohort suppression, no anonymous identity implication | Golden datasets, drift/reconciliation alerts, explain surfaces and correction tests |
| T-12 | Rule/workflow change rewrites history | Immutable published versions, effective dates, shadow projection/simulation, labelled reprocessing | Version lineage, rollback/reprojection drill and publication audit |
| T-13 | Duplicate or harmful consequential action | Transactional outbox, stable action idempotency, approval by default, execution-time policy, caps/quiet hours, unknown-outcome review | Failure injection, provider reconciliation, action duplicate-prevention and global pause drill |
| T-14 | SSRF/webhook secret/replay abuse | HTTPS/host policy, DNS/IP revalidation, reserved/private blocking, redirect limits, signed timestamp/nonce/body digest, protected secrets | Hostile DNS/redirect/signature/replay tests and adapter kill switch |
| T-15 | Malicious evidence/event prompt injection | Treat content as data, structured prompts/schemas, source selection/permission, exact citation validation, no tool instructions from evidence | Injection fixtures, unsupported-reference rejection, human suggestion/action review |
| T-16 | Privileged admin/support abuse | Least privilege, sensitive capabilities separated, break-glass workflow, immutable audit, restricted profile/debug access | Access reviews, alerting, session/reason audit and revocation tests |
| T-17 | Downgrade silently destroys or bypasses policy | Pause/read-only/grace, preview, delayed audited expiry, immutable usage ledger, backend enforcement | Upgrade/downgrade/retention tests and restore window |
| T-18 | SQLite/PostgreSQL or mixed-version drift | Checksummed additive migrations, runtime contract, production-shaped cutover, dual/shadow comparison, least privilege | Fresh/upgrade/rollback/mixed-version/backup tests block release |
| T-19 | SDK supply-chain or semantic drift | Shared conformance, generated types, semver/deprecation, provenance/SBOM/signing where supported, supported-version telemetry | Cross-SDK dashboard, dependency/secret/static scans and compatibility gates |
| T-20 | Public sharing/export exposes restricted evidence | Dedicated share capability, security review, unguessable expiring/revocable token, source permission at render, no cached prohibited content | Revoke/expiry/source-restriction/cross-space/export tests and kill switch |

## Mandatory review gates

- Public ingest/Browser SDK: threat review, hostile protocol tests, key/source
  incident drill, load/abuse test, and no acknowledged-loss proof.
- Customer 360: privacy impact assessment, identity merge policy approval,
  purpose permissions, export/erasure/suppression reconciliation.
- Public sharing: dedicated privacy/security approval before enablement.
- Orchestration: SSRF/provider review, approval matrix, failure injection, and
  platform/space/adapter global-pause drill.
- Connected Journey GA: penetration test and resolution policy; backup/restore,
  kill-switch, migration rollback, and incident communication rehearsals.

## Residual decisions

Throughput/retention/regions, exact consent purposes and pre-consent behaviour,
identifier namespaces, correction windows, sharing policy, formula operators,
external action approval matrix, data-plane extraction threshold, export
technology, and residency/compliance commitments require recorded approval.

