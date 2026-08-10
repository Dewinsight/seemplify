import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const panel = fs.readFileSync(path.join(sourceRoot, 'components', 'journeys', 'JourneyStageInferenceReviewPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(sourceRoot, 'pages', 'JourneyMetricsPage.tsx'), 'utf8');
const bundled = await build({ entryPoints: [path.join(sourceRoot, 'lib', 'journeyStageInferenceGovernance.ts')], bundle: true,
  write: false, format: 'esm', platform: 'browser', alias: { '@': sourceRoot }, logLevel: 'silent' });
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const proof = 'a'.repeat(64);
const recommendation = { id: 'recommendation-1', runId: 'run-1', journeyDefinitionId: 'journey-1', journeyMapVersionId: 'version-1',
  contentSha256: proof, state: 'in_review', revision: 2, content: { deterministicRuleId: 'stage-rule-1', signalKey: 'transition.abc',
    proposedStageId: 'stage-2', evidence: { occurrenceCount: 18, eligibleObservationCount: 20, supportingInstanceCount: 18,
      coverage: 0.9, winningMargin: 0.9, evidenceContentSha256: proof }, lineage: { designVersionId: 'version-1',
      ruleSetVersion: 'rules-1', projectionVersion: 'projection-1', baseline: { start: '2026-07-01T00:00:00.000Z',
        end: '2026-07-08T00:00:00.000Z', asOf: '2026-07-08T00:00:00.000Z', analyticsContentSha256: proof,
        correction: { latestCompletedAt: null, correctionRunContentSha256: null } }, current: { start: '2026-07-08T00:00:00.000Z',
        end: '2026-07-15T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z', analyticsContentSha256: proof,
        correction: { latestCompletedAt: '2026-07-14T00:00:00.000Z', correctionRunContentSha256: proof } } },
    confidence: { method: 'measured_coverage_and_recurrence', coverage: 0.9, recurrence: 18, winningMargin: 0.9 },
    explanation: 'Measured recurrence supports independent review.', limitations: ['Descriptive evidence only.'],
    review: { applyMode: 'never_automatic', minimumDistinctReviewers: 2, proposerMayApprove: false } },
  reviewReasonProof: { sha256: proof, length: 22 }, reviewEligibility: { isProposer: false, isFirstReviewer: true,
    canSubmit: false, canDecide: false, canRetire: true } };

test('stage-inference client preserves exact evidence, correction lineage and actor-specific eligibility', () => {
  const parsed = client.parseGovernedStageInferenceRecommendation(recommendation);
  assert.equal(parsed.content.evidence.coverage, 0.9);
  assert.equal(parsed.content.lineage.current.correction.correctionRunContentSha256, proof);
  assert.equal(parsed.reviewEligibility.isFirstReviewer, true);
  assert.throws(() => client.parseGovernedStageInferenceRecommendation({ ...recommendation, contentSha256: 'not-a-proof' }), /proof is invalid/u);
  assert.throws(() => client.parseGovernedStageInferenceRecommendation({ ...recommendation,
    content: { ...recommendation.content, confidence: { ...recommendation.content.confidence, method: 'llm_score' } } }), /Confidence method is invalid/u);
});

test('review UI is read-resilient and exposes controls only through server permissions and two-person eligibility', () => {
  assert.match(page, /JourneyStageInferenceReviewPanel/u);
  assert.match(panel, /Approval records a recommendation only; it never applies or changes a stage rule/u);
  assert.match(panel, /permissions\.canRequestReview/u);
  assert.match(panel, /permissions\.canReview && Boolean\(eligibility\?\.canSubmit\)/u);
  assert.match(panel, /permissions\.canReview && Boolean\(eligibility\?\.canDecide\)/u);
  assert.match(panel, /distinct second reviewer/u);
  assert.match(panel, /suppressed, insufficient, ambiguous, overlapping, corrected after the as-of time, or version-drifted/u);
  assert.doesNotMatch(panel, /applyStage|automatic mutation|predicted confidence/iu);
});
