# Connected-journey release-gate report

Generated at: 2026-08-06T21:55:39.499Z

## Summary

- Date: Thursday, August 6, 2026
- Gate open: yes
- Open blocker count: 5
- Stage processing exercised: true
- Request latency p95 ms: 4992.58
- Generated load events: 600
- Dogfood ChatGPT connected: 1
- Dogfood ChatGPT selected: 1
- Dogfood journey created: 1

## Blocker statuses

### Independent security/privacy review

- ID: independent_security_privacy_review
- Open: yes
- Evidence: Connected-journey ingest gate still records INDEPENDENT_SECURITY_PRIVACY_REVIEW_PENDING.

### Ratified hardware and load profile

- ID: ratified_hardware_load_profile
- Open: yes
- Evidence: Current local request latency p95 is 4992.58 ms against an unratified candidate.

### Multi-node production PostgreSQL failover

- ID: multi_node_failover
- Open: yes
- Evidence: Connected-journey ingest gate still records MULTI_NODE_PRODUCTION_POSTGRES_FAILOVER_NOT_EXERCISED.

### Sustained recovery and live-traffic soak

- ID: sustained_recovery_live_traffic_soak
- Open: yes
- Evidence: Bounded local soak exists, but the gate still records SUSTAINED_RECOVERY_AND_LIVE_TRAFFIC_SOAK_PENDING.

### Signed SLO and capacity approval

- ID: signed_slo_capacity_approval
- Open: yes
- Evidence: Connected-journey ingest gate still records SIGNED_SLO_AND_CAPACITY_APPROVAL_PENDING.

### Dogfood ChatGPT/runtime activity

- ID: dogfood_chatgpt_runtime_activity
- Open: no
- Evidence: Dogfood summary currently shows audited ChatGPT connected=1, audited ChatGPT selected=1, stored ChatGPT runtime preference=0, Codex runtime homes=2, Codex auth files=1, journey created=1.

