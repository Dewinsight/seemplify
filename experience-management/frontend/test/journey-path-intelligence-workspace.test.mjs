import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const page = fs.readFileSync(path.join(sourceRoot, 'pages', 'JourneyMetricsPage.tsx'), 'utf8');
const bundled = await build({ entryPoints: [path.join(sourceRoot, 'lib', 'journeyMetrics.ts')], bundle: true,
  write: false, format: 'esm', platform: 'browser', alias: { '@': sourceRoot }, logLevel: 'silent' });
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const now = '2026-08-07T12:00:00.000Z';
const recommendation = { key: 'stage-a->stage-c', kind: 'review_stage_inference_rule', fromStageId: 'stage-a',
  inferredStageId: 'stage-c', evidence: { occurrenceCount: 4, sampleSize: 20, percentage: 20 }, confidence: {
    sampleSufficiency: { observed: 20, required: 10, met: true }, recurrence: { observed: 4, required: 3, met: true },
    visibility: { suppressed: false } }, rationale: 'Review this recurrent transition.',
  limitations: ['Descriptive evidence only.'], applyMode: 'human_review_only' };
const result = { detectorVersion: 'journey-path-intelligence/v1', provenance: { journeyDefinitionId: 'journey-1',
  journeyMapVersionId: 'version-1', subjectScope: 'anonymous_only', identityModel: 'anonymous_instance_scoped',
  window: { start: '2026-08-01T00:00:00.000Z', end: now, asOf: now }, analyticsVersion: 'journey-path-analytics/v1' },
sample: { acceptedInstanceCount: 20, acceptedVisitCount: 40, minimumSampleSize: 10,
  secondarySuppressionThreshold: 3, sufficient: true, suppressed: false }, status: 'detected', abstentionReasons: [],
indicators: [{ code: 'UNEXPECTED_TRANSITION', severity: 'warning', stageId: null, fromStageId: 'stage-a', toStageId: 'stage-c',
  observed: { count: 4, denominator: 20, percentage: 20, durationMs: null }, threshold: { kind: 'count', value: 3 },
  explanation: 'An observed transition is not adjacent.', limitations: ['Descriptive evidence only.'] }],
recommendations: [recommendation], limitations: ['No causal finding.'],
interpretation: { mode: 'descriptive_rules_only', statement: 'Fixed rules describe observed conditions only.' } };

test('strict path-intelligence parsers preserve exact provenance, suppression and human-review mode', () => {
  const parsed = client.parseJourneyPathIntelligenceResult(result);
  assert.equal(parsed.provenance.journeyMapVersionId, 'version-1');
  assert.equal(parsed.sample.secondarySuppressionThreshold, 3);
  assert.equal(parsed.recommendations[0].applyMode, 'human_review_only');
  assert.throws(() => client.parseJourneyPathIntelligenceResult({ ...result, prediction: 0.91 }), /unexpected field prediction/u);
  assert.throws(() => client.parseJourneyPathIntelligenceResult({ ...result,
    recommendations: [{ ...recommendation, applyMode: 'automatic' }] }), /applyMode is not an allowed value/u);
});

test('run and recommendation parsers reject drift in freshness, lifecycle and immutable digests', () => {
  const run = client.parseJourneyPathIntelligenceRun({ id: 'run-1', journeyDefinitionId: 'journey-1',
    journeyMapVersionId: 'version-1', subjectScope: 'anonymous_only', period: { start: '2026-08-01T00:00:00.000Z', end: now },
    asOf: now, minimumSampleSize: 10, secondarySuppressionThreshold: 3, detectorVersion: result.detectorVersion,
    contentSha256: 'a'.repeat(64), result, freshness: { status: 'stale', staleReasons: ['newer_completed_reprojection'],
      latestObservedAt: now, latestCorrectionAt: now, currentJourneyMapVersionId: 'version-1' },
    createdByUserId: null, createdAt: now });
  assert.deepEqual(run.freshness.staleReasons, ['newer_completed_reprojection']);
  const parsed = client.parseJourneyStageInferenceRecommendation({ id: 'recommendation-1', runId: 'run-1',
    journeyDefinitionId: 'journey-1', journeyMapVersionId: 'version-1', recommendation,
    contentSha256: 'b'.repeat(64), state: 'in_review', revision: 2, reviewedByUserId: 'user-1',
    reviewReason: 'Needs review.', reviewedAt: now, createdAt: now, updatedAt: now });
  assert.equal(parsed.state, 'in_review'); assert.equal(parsed.revision, 2);
  assert.throws(() => client.parseJourneyStageInferenceRecommendation({ ...parsed, contentSha256: 'bad' }), /SHA-256 digest/u);
  assert.throws(() => client.parseJourneyStageInferenceRecommendation({ ...parsed, state: 'applied' }), /state is not an allowed value/u);
});

test('the workspace is explicit, accessible, responsive and never offers automatic application', () => {
  assert.match(page, /Actual path intelligence and stage-inference review/u);
  assert.match(page, /do not predict outcomes, establish causes/u);
  assert.match(page, /Every stage-inference recommendation requires human review/u);
  assert.match(page, /No automatic stage application/u);
  assert.match(page, /acceptance records a reviewed decision only/iu);
  assert.match(page, /path-intelligence-history-stacked/u);
  assert.match(page, /caption className="sr-only">Saved path-intelligence runs/u);
  assert.match(page, /canManage && nextStates\.length/u);
  assert.doesNotMatch(page, /apply stage|auto-apply/iu);
});
