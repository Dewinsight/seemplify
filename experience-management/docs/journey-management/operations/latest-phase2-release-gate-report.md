# Phase 2 release-gate report

Generated at: 2026-08-08T06:55:38.712Z

## Result

- Requirement: P2-11
- Executable proof passed: yes
- Release-gate eligible: no
- Load profile: local_candidate_unratified
- Open blockers: PHASE2_LOAD_PROFILE_NOT_RATIFIED, PHASE2_SLO_APPROVAL_NOT_RECORDED

## Components

| Component | Result | Evidence |
| --- | --- | --- |
| Source parity | pass | npx tsx --test backend/test/journey-metric-calculations.test.ts backend/test/journey-operational-measures.test.ts backend/test/journey-native-metric-sources.test.ts |
| Access, deletion, and citation | pass | npx tsx --test backend/test/journey-research-hub.test.ts backend/test/journey-evidence-lifecycle.test.ts backend/test/journey-metrics-persistence.test.ts |
| Freshness and rebuild candidate | pass | npx tsx scripts/probe-phase2-metric-load.mts |
| Metric source/window/sample metadata | pass | Persistence suite plus load-probe assertions |

## Candidate measurements

- Rows: 2000
- Candidate rebuild budget: 5000 ms
- Initial rebuild: 26.75 ms
- Correction rebuild: 39.98 ms
- Deletion rebuild: 33.49 ms
- Initial freshness: fresh
- Deletion result: revision 3, sample 1999

## Limitations

- The bundled load probe is a bounded single-process SQLite characterization, not an agreed production load profile.
- Ratification and SLO approval require a matching phase2-release-approval/v1 artifact supplied through PHASE2_RELEASE_APPROVAL_FILE; this script never infers either from a fast local run.
- The gate does not claim accessibility, independent security/privacy review, multi-node failover, or sustained soak proof.
