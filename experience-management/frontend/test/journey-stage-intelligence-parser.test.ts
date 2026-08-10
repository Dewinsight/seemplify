import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJourneyStageComparisonResult, parseJourneyStageTrendResult } from '../src/lib/journeyStageIntelligence.js';

const row = {
  stageId: 'stage-one', dimension: 'persona', dimensionId: 'buyer', metricDefinitionId: 'metric-one',
  metricDefinitionVersionId: 'metric-v1', metricDefinitionVersionSha256: 'a'.repeat(64), metricName: 'NPS',
  metricUnit: 'score', window: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z',
    asOf: '2026-08-02T01:00:00.000Z' }, calculationVersion: 'journey-stage-comparison/v1', sampleSize: 30,
  value: 45, sentiment: { negative: 20, neutral: 20, positive: 60, mixed: 0, unknown: 0 },
  emotions: { anger: 0, anxiety: 0, confusion: 0, delight: 50, disappointment: 0, frustration: 0,
    relief: 0, sadness: 0, trust: 50, unknown: 0 },
  suppression: { suppressed: false, kind: null, reason: null, minimumSampleSize: 30 },
  lineage: [{ sourceType: 'survey', sourceIdSha256: 'b'.repeat(64), sourceVersion: '1',
    schemaVersion: 'survey/v1', projectionVersion: 'metric/v1' }], lineageTruncated: false
};
const result = { schemaVersion: 'journey-stage-intelligence/v1', purpose: 'analytics', window: row.window,
  minimumSampleSize: 30, rows: [row], exclusions: { total: 0, suppressed: false }, fingerprint: 'c'.repeat(64) };

test('strict parser accepts a complete governed projection', () => {
  const parsed = parseJourneyStageComparisonResult(result);
  assert.equal(parsed.rows[0].sampleSize, 30);
  assert.equal(parsed.rows[0].lineage[0].sourceIdSha256, 'b'.repeat(64));
});

test('strict parser rejects response drift and every suppressed-cell disclosure', () => {
  assert.throws(() => parseJourneyStageComparisonResult({ ...result, extra: true }), /unexpected field extra/u);
  const suppressed = { ...row, sampleSize: null, value: null,
    sentiment: Object.fromEntries(Object.keys(row.sentiment).map((key) => [key, null])),
    emotions: Object.fromEntries(Object.keys(row.emotions).map((key) => [key, null])),
    suppression: { suppressed: true, kind: 'primary', reason: 'BELOW_MINIMUM_SAMPLE', minimumSampleSize: 30 },
    lineage: [] };
  assert.doesNotThrow(() => parseJourneyStageComparisonResult({ ...result, rows: [suppressed] }));
  assert.throws(() => parseJourneyStageComparisonResult({ ...result, rows: [{ ...suppressed, sampleSize: 2 }] }),
    /suppressed row discloses protected detail/u);
  assert.throws(() => parseJourneyStageComparisonResult({ ...result, rows: [{ ...suppressed, lineage: row.lineage }] }),
    /suppressed row discloses protected detail/u);
});

test('strict trend parser accepts contiguous protected buckets and rejects response drift', () => {
  const trend = { schemaVersion: 'journey-stage-trends/v1', purpose: 'analytics', window: {
    from: '2026-08-01T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z', asOf: '2026-08-03T01:00:00.000Z' },
  bucketDays: 1, minimumSampleSize: 30, fingerprint: 'd'.repeat(64), buckets: [
    { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z', fingerprint: 'e'.repeat(64),
      exclusions: { total: 0, suppressed: false }, rows: [row] },
    { from: '2026-08-02T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z', fingerprint: 'f'.repeat(64),
      exclusions: { total: 0, suppressed: false }, rows: [] }
  ] };
  assert.equal(parseJourneyStageTrendResult(trend).buckets.length, 2);
  assert.throws(() => parseJourneyStageTrendResult({ ...trend, buckets: [trend.buckets[0], {
    ...trend.buckets[1], from: '2026-08-02T01:00:00.000Z' }] }), /contiguous/u);
  assert.throws(() => parseJourneyStageTrendResult({ ...trend, secret: true }), /unexpected field secret/u);
});
