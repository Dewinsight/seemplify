import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateStageInferenceRecommendations, MAX_STAGE_INFERENCE_CANDIDATES,
  transitionStageInferenceReview, type StageInferenceRecommendationInput } from '../src/journeyStageInferenceRecommendations.js';

const sha = (value: string) => value.repeat(64).slice(0, 64);
function request(): StageInferenceRecommendationInput {
  const window = { designVersionId: 'design-v1', ruleSetVersion: 'rules-v1', projectionVersion: 'projection-v1',
    analyticsContentSha256: sha('a'), correction: { latestCompletedAt: '2026-02-01T00:00:00.000Z', correctionRunContentSha256: sha('b') },
    acceptedInstanceCount: 100, suppressed: false };
  return { journeyDefinitionId: 'journey-1', subjectScope: 'anonymous_only',
    baseline: { ...window, start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', asOf: '2026-02-01T00:00:00.000Z' },
    current: { ...window, start: '2026-02-01T00:00:00.000Z', end: '2026-03-01T00:00:00.000Z', asOf: '2026-03-01T00:00:00.000Z' },
    designedStageIds: ['discover', 'activate'], candidateEvidenceSuppressed: false, minimumSampleSize: 20, minimumRecurrence: 10,
    minimumCoverage: 0.7, minimumWinningMargin: 0.2, proposerRef: 'internal-proposer-1', candidates: [{
      signalKey: 'activation.completed', proposedStageId: 'activate', occurrenceCount: 80,
      eligibleObservationCount: 100, supportingInstanceCount: 75, suppressed: false, evidenceContentSha256: sha('c') }] };
}

test('recommendations are deterministic, version-exact, measurable and never executable', () => {
  const first = generateStageInferenceRecommendations(request()); const second = generateStageInferenceRecommendations(request());
  assert.deepEqual(first, second); assert.equal(first.status, 'recommended'); const item = first.recommendations[0]!;
  assert.match(item.recommendationId, /^stage-inference-[a-f0-9]{32}$/u);
  assert.match(item.deterministicRuleId, /^stage-rule-[a-f0-9]{32}$/u);
  assert.equal(item.confidence.method, 'measured_coverage_and_recurrence'); assert.equal(item.confidence.coverage, 0.8);
  assert.equal(item.review.applyMode, 'never_automatic'); assert.equal(item.review.minimumDistinctReviewers, 2);
  assert.equal(item.lineage.current.correction.correctionRunContentSha256, sha('b'));
  assert.equal(item.lineage.current.analyticsContentSha256, sha('a'));
  assert.equal(JSON.stringify(item).includes('internal-proposer-1'), false);
  assert.ok(item.limitations.some((value) => /never changes a stage assignment/u.test(value)));
});

test('low coverage is a no-recommendation false positive, while competing stages abstain as ambiguous', () => {
  const low = request(); low.candidates[0]!.occurrenceCount = 20; low.candidates[0]!.supportingInstanceCount = 20;
  const lowResult = generateStageInferenceRecommendations(low); assert.equal(lowResult.status, 'no_recommendation');
  assert.equal(lowResult.bounds.belowThresholdSignalCount, 1);
  const ambiguous = request(); ambiguous.candidates.push({ ...ambiguous.candidates[0]!, proposedStageId: 'discover', occurrenceCount: 72,
    supportingInstanceCount: 70, evidenceContentSha256: sha('d') });
  const ambiguousResult = generateStageInferenceRecommendations(ambiguous); assert.equal(ambiguousResult.status, 'abstained');
  assert.deepEqual(ambiguousResult.abstentionReasons, ['AMBIGUOUS_COMPETING_CANDIDATE']);
  assert.equal(ambiguousResult.bounds.ambiguousSignalCount, 1); assert.deepEqual(ambiguousResult.recommendations, []);
});

test('suppressed or unknown evidence abstains without candidate identity or count leakage', () => {
  const input = request(); input.candidates[0]!.suppressed = true; input.candidates[0]!.occurrenceCount = null;
  input.candidates[0]!.signalKey = 'sensitive.segment.signal';
  const result = generateStageInferenceRecommendations(input); assert.equal(result.status, 'abstained');
  assert.equal(result.bounds.evaluatedCandidateCount, null); assert.deepEqual(result.recommendations, []);
  assert.equal(JSON.stringify(result).includes('sensitive.segment.signal'), false);
  const tableSuppressed = request(); tableSuppressed.candidateEvidenceSuppressed = true;
  assert.deepEqual(generateStageInferenceRecommendations(tableSuppressed).abstentionReasons,
    ['CANDIDATE_EVIDENCE_UNKNOWN_OR_SUPPRESSED']);
});

test('overlap, lineage drift and corrections after as-of explicitly abstain before recommendation', () => {
  const overlap = request(); overlap.current.start = '2026-01-15T00:00:00.000Z';
  assert.deepEqual(generateStageInferenceRecommendations(overlap).abstentionReasons, ['WINDOWS_OVERLAP']);
  const drift = request(); drift.current.projectionVersion = 'projection-v2';
  assert.deepEqual(generateStageInferenceRecommendations(drift).abstentionReasons, ['PROJECTION_VERSION_DRIFT']);
  const corrected = request(); corrected.current.correction.latestCompletedAt = '2026-03-02T00:00:00.000Z';
  assert.deepEqual(generateStageInferenceRecommendations(corrected).abstentionReasons, ['CORRECTION_AFTER_AS_OF']);
});

test('candidate processing is bounded and content-safe taxonomy grammar rejects raw-looking content', () => {
  const oversized = request(); oversized.candidates = Array.from({ length: MAX_STAGE_INFERENCE_CANDIDATES + 1 }, () => oversized.candidates[0]!);
  assert.throws(() => generateStageInferenceRecommendations(oversized), /Candidate count exceeds/u);
  const unsafe = request(); unsafe.candidates[0]!.signalKey = 'customer@example.com';
  assert.throws(() => generateStageInferenceRecommendations(unsafe), /content-safe taxonomy/u);
  const duplicate = request(); duplicate.candidates.push({ ...duplicate.candidates[0]! });
  assert.throws(() => generateStageInferenceRecommendations(duplicate), /must be unique/u);
});

test('maximum product-scale candidate set stays output-bounded', () => {
  const input = request(); input.designedStageIds = ['activate'];
  input.candidates = Array.from({ length: MAX_STAGE_INFERENCE_CANDIDATES }, (_value, index) => ({
    ...input.candidates[0]!, signalKey: `signal.${String(index).padStart(5, '0')}`
  }));
  const started = performance.now(); const result = generateStageInferenceRecommendations(input);
  assert.equal(result.recommendations.length, 100); assert.equal(result.bounds.truncated, true);
  assert.ok(performance.now() - started < 3_000, '10k candidates must remain inside the bounded pure-domain budget');
});

test('two-person review requires capabilities, revision safety and distinct content-safe reviewers', () => {
  const recommendation = generateStageInferenceRecommendations(request()).recommendations[0]!;
  const record = { recommendationId: recommendation.recommendationId, state: 'draft' as const, revision: 1,
    proposerRefSha256: recommendation.review.proposerRefSha256, submittedByRefSha256: null, decidedByRefSha256: null,
    decisionReasonSha256: null, decisionReasonLength: null };
  assert.throws(() => transitionStageInferenceReview({ record, expectedRevision: 1, action: 'submit_for_review',
    actorRef: 'internal-proposer-1', capabilities: ['journey_stage_inference_review'], reason: 'Self review.' }), /proposer cannot/u);
  assert.throws(() => transitionStageInferenceReview({ record, expectedRevision: 1, action: 'submit_for_review',
    actorRef: 'reviewer-1', capabilities: [], reason: 'Review the evidence.' }), /not authorised/u);
  const submitted = transitionStageInferenceReview({ record, expectedRevision: 1, action: 'submit_for_review', actorRef: 'reviewer-1',
    capabilities: ['journey_stage_inference_review'], reason: 'Review the evidence.' });
  assert.equal(submitted.state, 'in_review'); assert.equal(JSON.stringify(submitted).includes('Review the evidence.'), false);
  assert.throws(() => transitionStageInferenceReview({ record: submitted, expectedRevision: 1, action: 'approve', actorRef: 'reviewer-2',
    capabilities: ['journey_stage_inference_approve'], reason: 'Approve.' }), /revision conflict/u);
  assert.throws(() => transitionStageInferenceReview({ record: submitted, expectedRevision: 2, action: 'approve', actorRef: 'reviewer-1',
    capabilities: ['journey_stage_inference_approve'], reason: 'Approve.' }), /distinct second reviewer/u);
  const approved = transitionStageInferenceReview({ record: submitted, expectedRevision: 2, action: 'approve', actorRef: 'reviewer-2',
    capabilities: ['journey_stage_inference_approve'], reason: 'Evidence is sufficient.' });
  assert.equal(approved.state, 'approved'); assert.equal(approved.revision, 3);
  assert.equal(JSON.stringify(approved).includes('reviewer-2'), false);
});
