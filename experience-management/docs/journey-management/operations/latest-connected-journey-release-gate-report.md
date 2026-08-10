# Connected-journey release-gate report

Generated at: 2026-08-08T13:43:03.201Z

## Summary

- Date: Saturday, August 8, 2026
- Gate open: yes
- Open blocker count: 5
- Ingest gate evidence refreshed this run: no (Disposable Docker ingest gate not opted into; pass --allow-docker-gate (npm run report:journey:release-gate:local) or set JOURNEY_POSTGRES_GATE_ALLOW_DOCKER=true to refresh it. Recorded ingest gate evidence was reused unchanged.)
- Ingest gate evidence usable: no
- Ingest gate evidence runtime schema version: 54
- Stage processing exercised: true
- Request latency p95 ms: 4821.03
- Generated load events: 600
- Dogfood ChatGPT connected: 1
- Dogfood ChatGPT selected: 1
- Dogfood journey created: 1

## Blocker statuses

### Independent security/privacy review

- ID: independent_security_privacy_review
- Open: yes
- Evidence: Reused ingest gate evidence is not usable (ok true, runtime schema version 54 against expected 55); treated as open. Refresh with npm run report:journey:release-gate:local.

### Ratified hardware and load profile

- ID: ratified_hardware_load_profile
- Open: yes
- Evidence: Reused ingest gate evidence is not usable (ok true, runtime schema version 54 against expected 55); treated as open. Refresh with npm run report:journey:release-gate:local.

### Multi-node production PostgreSQL failover

- ID: multi_node_failover
- Open: yes
- Evidence: Reused ingest gate evidence is not usable (ok true, runtime schema version 54 against expected 55); treated as open. Refresh with npm run report:journey:release-gate:local.

### Sustained recovery and live-traffic soak

- ID: sustained_recovery_live_traffic_soak
- Open: yes
- Evidence: Reused ingest gate evidence is not usable (ok true, runtime schema version 54 against expected 55); treated as open. Refresh with npm run report:journey:release-gate:local.

### Signed SLO and capacity approval

- ID: signed_slo_capacity_approval
- Open: yes
- Evidence: Reused ingest gate evidence is not usable (ok true, runtime schema version 54 against expected 55); treated as open. Refresh with npm run report:journey:release-gate:local.

### Dogfood ChatGPT/runtime activity

- ID: dogfood_chatgpt_runtime_activity
- Open: no
- Evidence: Dogfood summary currently shows audited ChatGPT connected=1, audited ChatGPT selected=1, stored ChatGPT runtime preference=0, Codex runtime homes=2, Codex auth files=1, journey created=1.

