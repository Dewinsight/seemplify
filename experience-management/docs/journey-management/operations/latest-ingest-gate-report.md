# Connected-journey PostgreSQL ingest gate report

Generated at: 2026-08-06T21:56:49.254Z

Status: passed
Command: `node scripts/journey-postgres-ingest-security-load.mjs`

## Summary

- Exit code: 0
- Runtime schema version: 30
- Generated load events: 600
- Soak duration ms: 5359.77
- Request latency p95 ms: 4992.58
- Candidate batch target status: outside
- Stage processing exercised: true
- Reconciliation raw/dedupe drift: 0
- Reconciliation raw/inbox drift: 0
- Reconciliation raw/meter drift: 0

## Phases

- preflight
- backend-build
- sqlite-bootstrap
- postgres-provision
- sqlite-to-postgres-migration
- postgres-runtime-upgrade
- least-privilege-grants
- postgres-runtime-verification
- least-privilege-runtime-role
- http-process-startup
- bounded-sustained-soak
- atomic-deduplication-and-conflict
- runtime18-stage-processing
- credential-revocation

## Security and operational signals

- Least-privilege runtime role: true
- Output/log sentinel findings: 0
- Stored sentinel findings: 0
- Oldest pending queue age ms: 0

## Remaining blockers

- INDEPENDENT_SECURITY_PRIVACY_REVIEW_PENDING
- RATIFIED_HARDWARE_AND_LOAD_PROFILE_PENDING
- MULTI_NODE_PRODUCTION_POSTGRES_FAILOVER_NOT_EXERCISED
- SUSTAINED_RECOVERY_AND_LIVE_TRAFFIC_SOAK_PENDING
- SIGNED_SLO_AND_CAPACITY_APPROVAL_PENDING

