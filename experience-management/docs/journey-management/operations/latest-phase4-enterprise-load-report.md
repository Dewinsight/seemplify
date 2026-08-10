# Phase 4 enterprise synthetic-load evidence

Generated at: 2026-08-08T08:04:06.960Z

## Result

- Requirements: P4-02, P4-03, P4-04, P4-05, P4-07, P4-08, X-07, X-09
- Executable backend evidence passed: yes
- Release-gate eligible: no
- Profile status: local candidate, unratified
- Open blockers: PHASE4_LOAD_PROFILE_AND_BUDGETS_NOT_RATIFIED

## Candidate profile

- Hierarchy: 500 nodes, 2000 links, depth 12
- Blueprint: 50 stages, 2500 elements, 1450 relationships
- Fixture SHA-256: `2f3ce81404e1935e7df2c7f954633d05e4dd08820a83d2059ee4797046ab7333`
- Production data used: no
- Browser certified: no

## Backend measurements

| Operation | Measured ms | Candidate budget ms | Result |
| --- | ---: | ---: | --- |
| hierarchyValidate | 4.67 | 1000 | pass |
| hierarchyTraverse | 4.71 | 1000 | pass |
| hierarchyBreadcrumbs | 2.18 | 1000 | pass |
| hierarchyHealth | 5.18 | 1500 | pass |
| hierarchyRepositoryRead | 16.17 | 2000 | pass |
| hierarchyRepositoryTraverse | 22.11 | 2000 | pass |
| hierarchyRepositoryBreadcrumbs | 14.86 | 2000 | pass |
| hierarchyJsonExport | 29.05 | 4000 | pass |
| hierarchyCsvExport | 45 | 4000 | pass |
| blueprintAnalyse | 12.32 | 2000 | pass |
| blueprintCompare | 49.72 | 3000 | pass |
| blueprintRepositoryPersist | 108.76 | 20000 | pass |
| blueprintRepositoryRead | 16.82 | 4000 | pass |
| blueprintJsonExport | 87.43 | 8000 | pass |
| blueprintCsvExport | 114.13 | 8000 | pass |
| backendProjectionSerialise | 12.05 | 3000 | pass |

Artifact byte sizes and complete host metadata are retained in the JSON report.

## Approval contract

Release eligibility remains false unless `PHASE4_ENTERPRISE_LOAD_APPROVAL_FILE` points to an approval containing:

- `version: phase4-enterprise-load-approval/v1`
- `decision: approved`
- a named approver and exact approval timestamp
- the exact profile and candidate budgets from this report
- the exact fixture SHA-256 from this report

## Limitations

- Measurements are a deterministic single-process SQLite backend characterization on the recorded host, not production capacity certification.
- The backend projection serialization measurement is not browser rendering, visual, accessibility, interaction-latency, or device certification.
- The probe is bounded and not a sustained soak, concurrency, failover, PostgreSQL query-plan, network, or multi-region exercise.
- Release eligibility requires an exact phase4-enterprise-load-approval/v1 artifact matching the profile, budgets, and fixture SHA-256; a fast local run never self-ratifies.
- Independent security/privacy, accessibility, operational readiness, and signed Phase 4 release decisions remain separate gates.
