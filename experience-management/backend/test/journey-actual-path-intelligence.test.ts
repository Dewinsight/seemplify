import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectJourneyPathIntelligence, stableJourneyPathIntelligenceJson
} from '../src/journeyActualPathIntelligence.js';

function envelope(instances: number | null, suppressed = false): any {
  const measure = (count: number, percentage: number) => ({ numerator: count, denominator: instances,
    sampleSize: instances, percentage, suppressed: false });
  return {
    scope: { designVersionId: 'version-1', identityModel: 'anonymous_instance_scoped' },
    analytics: {
      analyticsVersion: 'journey-path-analytics/v1', lineage: { journeyVersion: 'version-1' },
      sample: { acceptedInstanceCount: instances, acceptedVisitCount: instances === null ? null : instances * 2, suppressed },
      tables: {
        funnel: { rows: [{ stageId: 'stage-a', dropOffBeforeNextMeasure: measure(8, 40) }] },
        loops: { rows: [{ fromStageId: 'stage-b', toStageId: 'stage-a', occurrenceCount: 3, measure: measure(3, 15) }] },
        unexpectedTransitions: { rows: [{ fromStageId: 'stage-a', toStageId: 'stage-c', occurrenceCount: 4, measure: measure(4, 20) }] },
        stageDurations: { rows: [{ stageId: 'stage-a', durationObservationCount: 4, p90Ms: 90_000_000, measure: measure(4, 20) }] }
      }
    }
  };
}
const input = (actualPaths: any) => ({ journeyDefinitionId: 'journey-1', subjectScope: 'anonymous_only' as const,
  window: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', asOf: '2026-02-02T00:00:00.000Z' },
  minimumSampleSize: 10, secondarySuppressionThreshold: 3, actualPaths });

test('path intelligence is deterministic, provenance-exact, descriptive and review-only', () => {
  const first = detectJourneyPathIntelligence(input(envelope(20)));
  const second = detectJourneyPathIntelligence(input(envelope(20)));
  assert.equal(stableJourneyPathIntelligenceJson(first), stableJourneyPathIntelligenceJson(second));
  assert.equal(first.provenance.journeyMapVersionId, 'version-1');
  assert.deepEqual(first.indicators.map((row) => row.code), [
    'HIGH_STAGE_DROP_OFF', 'OBSERVED_LOOP', 'PROLONGED_STAGE_DURATION', 'UNEXPECTED_TRANSITION'
  ]);
  assert.equal(first.recommendations[0]?.applyMode, 'human_review_only');
  assert.equal(first.interpretation.mode, 'descriptive_rules_only');
  assert.ok(first.limitations.every((value) => !/caused|will churn|will convert/iu.test(value)));
});

test('path intelligence abstains under primary sample suppression and omits secondary-small cells', () => {
  const suppressed = detectJourneyPathIntelligence(input(envelope(null, true)));
  assert.equal(suppressed.status, 'abstained');
  assert.deepEqual(suppressed.indicators, []); assert.deepEqual(suppressed.recommendations, []);
  assert.ok(suppressed.abstentionReasons.includes('PRIMARY_SAMPLE_SUPPRESSED'));
  const small = envelope(20); small.analytics.tables.unexpectedTransitions.rows[0].occurrenceCount = 2;
  small.analytics.tables.unexpectedTransitions.rows[0].measure = { numerator: 2, denominator: 20, sampleSize: 20, percentage: 10, suppressed: false };
  const result = detectJourneyPathIntelligence(input(small));
  assert.equal(result.indicators.some((row) => row.code === 'UNEXPECTED_TRANSITION'), false);
  assert.deepEqual(result.recommendations, []);
});

test('path intelligence abstains when selected-version provenance disagrees with analytics lineage', () => {
  const value = envelope(20); value.analytics.lineage.journeyVersion = 'corrected-version';
  const result = detectJourneyPathIntelligence(input(value));
  assert.equal(result.status, 'abstained');
  assert.ok(result.abstentionReasons.includes('VERSION_PROVENANCE_MISMATCH'));
});
