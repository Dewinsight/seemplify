import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createJourneyPredictionAudit, evaluateJourneyPrediction, validateJourneyPredictiveModel,
  type JourneyPredictionPolicy, type JourneyPredictionRequest, type JourneyPredictiveModel
} from '../src/journeyPredictiveGovernance.js';

const model: JourneyPredictiveModel = Object.freeze({
  id: 'churn-model-1', spaceId: 'space-1', target: 'churn', version: '2026.08.1', state: 'approved',
  trainingWindow: { from: '2026-01-01T00:00:00.000Z', to: '2026-05-01T00:00:00.000Z' },
  validationWindow: { from: '2026-05-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  trainingSamples: 2000, positiveSamples: 600, negativeSamples: 1400, validationSamples: 500,
  areaUnderRoc: 0.78, brierScore: 0.16, featureNames: ['failed_payments', 'support_contacts', 'active_days'],
  trainedByUserId: 'analyst-1', approvedByUserId: 'reviewer-1', approvedAt: '2026-07-03T10:00:00.000Z',
  contentSha256: 'a'.repeat(64)
});
const policy: JourneyPredictionPolicy = Object.freeze({ enabled: true, purpose: 'retention-support',
  minimumTrainingSamples: 1000, minimumClassSamples: 200, minimumValidationSamples: 300,
  minimumAreaUnderRoc: 0.7, maximumBrierScore: 0.2, maximumPopulationStabilityIndex: 0.2,
  maximumMissingFeatureRatio: 0.34, maximumOutOfDistributionScore: 3 });
const request: JourneyPredictionRequest = Object.freeze({ spaceId: 'space-1', subjectId: 'profile-private-1',
  purpose: 'retention-support', optedIn: true, consentAllowed: true,
  sourceWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }, score: 0.72,
  confidence: 0.81, featureValues: { failed_payments: 1, support_contacts: 3, active_days: 4 },
  featureContributions: { failed_payments: 0.33, support_contacts: 0.21, active_days: -0.12 },
  populationStabilityIndex: 0.08, outOfDistributionScore: 1.2 });

test('requires independent approval and out-of-time validation evidence', () => {
  assert.deepEqual(validateJourneyPredictiveModel(model), []);
  assert.deepEqual(validateJourneyPredictiveModel({ ...model, approvedByUserId: model.trainedByUserId }),
    ['INDEPENDENT_APPROVAL_REQUIRED']);
  assert.deepEqual(validateJourneyPredictiveModel({ ...model,
    validationWindow: { from: '2026-04-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' } }),
  ['VALIDATION_WINDOW_INVALID']);
});

test('returns an explainable governed prediction with exact lineage and no raw subject', () => {
  const result = evaluateJourneyPrediction({ model, policy, request });
  assert.equal(result.decision, 'predicted');
  assert.equal(result.score, 0.72); assert.equal(result.modelVersion, model.version);
  assert.match(result.subjectRefSha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes(request.subjectId), false);
  assert.deepEqual(result.explanation.map((item) => item.feature),
    ['failed_payments', 'support_contacts', 'active_days']);
});

test('abstains on missing consent, insufficient data, drift, OOD and missing explanation', () => {
  const result = evaluateJourneyPrediction({ model: { ...model, trainingSamples: 800, positiveSamples: 100,
    negativeSamples: 700, validationSamples: 100 }, policy, request: { ...request, consentAllowed: false,
    populationStabilityIndex: 0.4, outOfDistributionScore: 5, featureContributions: {} } });
  assert.equal(result.decision, 'abstained'); assert.equal(result.score, null); assert.equal(result.confidence, null);
  for (const code of ['PURPOSE_CONSENT_DENIED','TRAINING_SAMPLE_INSUFFICIENT','CLASS_SAMPLE_INSUFFICIENT',
    'VALIDATION_SAMPLE_INSUFFICIENT','POPULATION_DRIFT_EXCEEDED','OUT_OF_DISTRIBUTION','EXPLANATION_MISSING']) {
    assert.ok(result.reasonCodes.includes(code), code);
  }
  assert.deepEqual(result.explanation, []);
});

test('fails closed when drift evidence or prediction output is unavailable', () => {
  const result = evaluateJourneyPrediction({ model, policy, request: { ...request, score: null, confidence: null,
    populationStabilityIndex: null, outOfDistributionScore: null } });
  assert.equal(result.decision, 'abstained');
  assert.ok(result.reasonCodes.includes('DRIFT_EVIDENCE_MISSING'));
  assert.ok(result.reasonCodes.includes('DISTRIBUTION_EVIDENCE_MISSING'));
  assert.ok(result.reasonCodes.includes('PREDICTION_OUTPUT_MISSING'));
});

test('creates a content-safe immutable audit without feature values or raw subject identity', () => {
  const result = evaluateJourneyPrediction({ model, policy, request });
  const audit = createJourneyPredictionAudit({ spaceId: model.spaceId, actorUserId: 'manager-1', result,
    createdAt: '2026-08-07T22:00:00.000Z' });
  assert.match(audit.detailSha256, /^[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes(request.subjectId), false);
  assert.equal(serialized.includes('failed_payments":1'), false);
  assert.throws(() => { (audit.detail as any).decision = 'abstained'; }, TypeError);
});
