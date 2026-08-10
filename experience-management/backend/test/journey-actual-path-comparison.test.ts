import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareJourneyActualPaths, MAX_ACTUAL_PATH_CANDIDATE_ROWS,
  MAX_ACTUAL_PATH_COMPARISON_ROWS } from '../src/journeyActualPathComparison.js';

function envelope(start: string, end: string, instances = 20, paths: number[] = [10, 7, 3], drop = 40): any {
  const measure = (value: number, percentage = value / instances * 100) => ({ numerator: value, denominator: instances,
    sampleSize: instances, percentage, suppressed: false });
  return { scope: { subjectKind: 'anonymous_only', identityModel: 'anonymous_instance_scoped', designVersionId: 'v1' },
    designedVsObserved: { stageRows: [{ stageId: 'a', status: 'aligned' }, { stageId: 'b', status: 'unobserved' }] },
    analytics: { analyticsVersion: 'journey-path-analytics/v1', lineage: { journeyId: 'j1', journeyVersion: 'v1',
      ruleSetVersion: 'rules-1', projectionVersion: 'projection-1', period: { start, end, timezone: 'UTC' },
      asOf: end, designedStageOrder: ['a', 'b'] }, sample: { acceptedInstanceCount: instances, acceptedVisitCount: instances * 2, suppressed: false },
      tables: { pathSignatures: { rows: paths.map((count, i) => ({ signature: `["${i}"]`, stageIds: [String(i)], measure: measure(count) })) },
        funnel: { rows: [{ stageId: 'a', dropOffBeforeNextMeasure: measure(drop, drop / instances * 100) },
          { stageId: 'b', dropOffBeforeNextMeasure: measure(0, 0) }] },
        loops: { rows: [{ fromStageId: 'b', toStageId: 'a', occurrenceCount: 3 }] } } } };
}
const correction = { latestCompletedReprojection: null, projectionFreshness: 'no_completed_reprojection' as const };
const input = (baseline: any, current: any, limit = 20) => ({ journeyDefinitionId: 'j1', subjectScope: 'anonymous_only' as const,
  baseline, current, minimumSampleSize: 10, secondarySuppressionThreshold: 3, limit,
  correctionLineage: { baseline: correction, current: correction } });

test('actual-path comparison is deterministic, bounded, provenance-exact and descriptive only', () => {
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 20, [10, 7, 3], 8);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 20, [6, 8, 6], 12);
  const first = compareJourneyActualPaths(input(baseline, current, 500));
  const second = compareJourneyActualPaths(input(baseline, current, 500));
  assert.deepEqual(first, second);
  assert.equal(first.comparisons.bounds.appliedLimit, MAX_ACTUAL_PATH_COMPARISON_ROWS);
  assert.equal(first.provenance.sourceCitations.length, 2);
  assert.equal(first.provenance.baselineRuleSetVersion, 'rules-1');
  assert.equal(first.provenance.currentProjectionVersion, 'projection-1');
  assert.ok(first.provenance.sourceCitations.every((row) => /^[a-f0-9]{64}$/u.test(row.analyticsContentSha256)));
  assert.equal(first.interpretation.mode, 'descriptive_comparison_only');
  assert.equal(JSON.stringify(first).includes('will churn'), false);
});

test('stage cells apply complementary suppression and processing lineage is exact per window', () => {
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 20, [10, 10], 1);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 20, [10, 10], 8);
  baseline.analytics.tables.funnel.rows[1].dropOffBeforeNextMeasure = {
    numerator: 5, denominator: 20, sampleSize: 20, percentage: 25, suppressed: false
  };
  current.analytics.tables.funnel.rows[1].dropOffBeforeNextMeasure = {
    numerator: 6, denominator: 20, sampleSize: 20, percentage: 30, suppressed: false
  };
  baseline.analytics.lineage.ruleSetVersion = 'rules-baseline';
  baseline.analytics.lineage.projectionVersion = 'projection-baseline';
  current.analytics.lineage.ruleSetVersion = 'rules-current';
  current.analytics.lineage.projectionVersion = 'projection-current';
  const result = compareJourneyActualPaths(input(baseline, current));
  assert.equal(result.comparisons.bounds.suppressedStageCells, true);
  assert.ok(result.comparisons.stages.every((row) => row.baselineDropOffPercentage === null
    && row.currentDropOffPercentage === null && row.percentagePointDelta === null));
  assert.deepEqual(result.cohorts.abandonment, []);
  assert.deepEqual(result.cohorts.deterioration, []);
  assert.equal(result.provenance.baselineRuleSetVersion, 'rules-baseline');
  assert.equal(result.provenance.currentRuleSetVersion, 'rules-current');
  assert.equal(result.provenance.baselineProjectionVersion, 'projection-baseline');
  assert.equal(result.provenance.currentProjectionVersion, 'projection-current');
});

test('primary suppression forces complementary secondary suppression and never treats unknown as zero', () => {
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 20, [15, 4, 1]);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 20, [14, 4, 2]);
  const result = compareJourneyActualPaths(input(baseline, current));
  assert.equal(result.comparisons.bounds.suppressedPathCells, true);
  assert.equal(result.comparisons.bounds.totalCandidatePathCount, null);
  assert.equal(result.comparisons.paths.length, 1, 'primary and complementary secondary path rows are omitted together');
});

test('upstream-suppressed paths and small loop identities cannot be re-exposed', () => {
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 20, [10, 10]);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 20, [10, 10]);
  current.analytics.tables.pathSignatures.rows[0].measure.suppressed = true;
  current.analytics.tables.loops.rows = [
    { fromStageId: 'rare-from', toStageId: 'rare-to', occurrenceCount: 1, measure: { suppressed: false } },
    { fromStageId: 'companion-from', toStageId: 'companion-to', occurrenceCount: 9, measure: { suppressed: false } }
  ];
  const result = compareJourneyActualPaths(input(baseline, current));
  assert.equal(result.comparisons.paths.length, 1, 'upstream suppression remains authoritative even with a large numerator');
  assert.deepEqual(result.cohorts.loops, [], 'primary and complementary-secondary loop identities are both omitted');
  assert.equal(JSON.stringify(result).includes('rare-from'), false);
  assert.equal(JSON.stringify(result).includes('companion-from'), false);
});

test('comparison abstains for insufficient windows and rejects overlap or version mismatch', () => {
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 5);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 20);
  const result = compareJourneyActualPaths(input(baseline, current));
  assert.equal(result.status, 'abstained');
  assert.equal(result.sample.baselineAcceptedInstanceCount, null);
  assert.deepEqual(result.comparisons.paths, []);
  const overlap = envelope('2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z');
  assert.throws(() => compareJourneyActualPaths(input(baseline, overlap)), /must not overlap/u);
  current.scope.designVersionId = 'v2'; current.analytics.lineage.journeyVersion = 'v2';
  assert.throws(() => compareJourneyActualPaths(input(baseline, current)), /one exact designed journey version/u);
  current.scope.designVersionId = 'v1'; current.analytics.lineage.journeyVersion = 'v1'; current.scope.identityModel = 'changed_model';
  assert.throws(() => compareJourneyActualPaths(input(baseline, current)), /one exact identity model/u);
});

test('product-scale path comparison stays bounded and rejects over-cardinality input', () => {
  const rows = Array.from({ length: MAX_ACTUAL_PATH_CANDIDATE_ROWS }, (_value, index) => 3 + index % 7);
  const baseline = envelope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 100_000, rows);
  const current = envelope('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 100_000, [...rows].reverse());
  const started = performance.now();
  const result = compareJourneyActualPaths(input(baseline, current, 50));
  assert.equal(result.comparisons.paths.length, 50);
  assert.ok(performance.now() - started < 3_000, '10k candidate comparison should stay within the bounded load budget');
  current.analytics.tables.pathSignatures.rows.push({ signature: '["overflow"]', stageIds: ['overflow'],
    measure: { numerator: 3, denominator: 100_000, sampleSize: 100_000, percentage: 0.003, suppressed: false } });
  assert.throws(() => compareJourneyActualPaths(input(baseline, current)), /candidate-path bound/u);
});
