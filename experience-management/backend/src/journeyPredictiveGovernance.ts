import crypto from 'node:crypto';

export type JourneyPredictionTarget = 'churn' | 'conversion';
export type JourneyPredictionDecision = 'predicted' | 'abstained';

export type JourneyPredictiveModel = Readonly<{
  id: string;
  spaceId: string;
  target: JourneyPredictionTarget;
  version: string;
  state: 'approved' | 'retired';
  trainingWindow: Readonly<{ from: string; to: string }>;
  validationWindow: Readonly<{ from: string; to: string }>;
  trainingSamples: number;
  positiveSamples: number;
  negativeSamples: number;
  validationSamples: number;
  areaUnderRoc: number;
  brierScore: number;
  featureNames: readonly string[];
  trainedByUserId: string;
  approvedByUserId: string;
  approvedAt: string;
  contentSha256: string;
}>;

export type JourneyPredictionPolicy = Readonly<{
  enabled: boolean;
  purpose: string;
  minimumTrainingSamples: number;
  minimumClassSamples: number;
  minimumValidationSamples: number;
  minimumAreaUnderRoc: number;
  maximumBrierScore: number;
  maximumPopulationStabilityIndex: number;
  maximumMissingFeatureRatio: number;
  maximumOutOfDistributionScore: number;
}>;

export type JourneyPredictionRequest = Readonly<{
  spaceId: string;
  subjectId: string;
  purpose: string;
  optedIn: boolean;
  consentAllowed: boolean;
  sourceWindow: Readonly<{ from: string; to: string }>;
  score: number | null;
  confidence: number | null;
  featureValues: Readonly<Record<string, number | null>>;
  featureContributions: Readonly<Record<string, number>>;
  populationStabilityIndex: number | null;
  outOfDistributionScore: number | null;
}>;

export type JourneyPredictionResult = Readonly<{
  decision: JourneyPredictionDecision;
  target: JourneyPredictionTarget;
  modelId: string;
  modelVersion: string;
  modelContentSha256: string;
  subjectRefSha256: string;
  sourceWindow: Readonly<{ from: string; to: string }>;
  score: number | null;
  confidence: number | null;
  reasonCodes: readonly string[];
  limitations: readonly string[];
  explanation: readonly Readonly<{ feature: string; contribution: number; direction: 'increases' | 'decreases' | 'neutral' }>[];
}>;

export class JourneyPredictiveGovernanceError extends Error {
  constructor(message: string, public code = 'JOURNEY_PREDICTIVE_GOVERNANCE_INVALID') {
    super(message);
    this.name = 'JourneyPredictiveGovernanceError';
  }
}

const bounded = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) && value >= minimum && value <= maximum;
const iso = (value: string) => Number.isFinite(Date.parse(value));
const token = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function validateJourneyPredictiveModel(model: JourneyPredictiveModel): readonly string[] {
  const issues: string[] = [];
  if (!token(model.id) || !token(model.spaceId) || !token(model.version)) issues.push('MODEL_IDENTITY_INVALID');
  if (!iso(model.trainingWindow.from) || !iso(model.trainingWindow.to)
    || Date.parse(model.trainingWindow.from) >= Date.parse(model.trainingWindow.to)) issues.push('TRAINING_WINDOW_INVALID');
  if (!iso(model.validationWindow.from) || !iso(model.validationWindow.to)
    || Date.parse(model.validationWindow.from) >= Date.parse(model.validationWindow.to)
    || Date.parse(model.validationWindow.from) < Date.parse(model.trainingWindow.to)) issues.push('VALIDATION_WINDOW_INVALID');
  if (![model.trainingSamples, model.positiveSamples, model.negativeSamples, model.validationSamples]
    .every((value) => Number.isInteger(value) && value >= 0)) issues.push('SAMPLE_COUNTS_INVALID');
  if (model.positiveSamples + model.negativeSamples !== model.trainingSamples) issues.push('CLASS_COUNTS_INCONSISTENT');
  if (!bounded(model.areaUnderRoc, 0, 1) || !bounded(model.brierScore, 0, 1)) issues.push('VALIDATION_METRICS_INVALID');
  if (!model.featureNames.length || new Set(model.featureNames).size !== model.featureNames.length
    || model.featureNames.some((feature) => !token(feature))) issues.push('FEATURE_CATALOG_INVALID');
  if (!token(model.trainedByUserId) || !token(model.approvedByUserId)
    || model.trainedByUserId === model.approvedByUserId) issues.push('INDEPENDENT_APPROVAL_REQUIRED');
  if (!iso(model.approvedAt) || !/^[a-f0-9]{64}$/u.test(model.contentSha256)) issues.push('APPROVAL_EVIDENCE_INVALID');
  return Object.freeze(issues);
}

function policyIssues(policy: JourneyPredictionPolicy) {
  const issues: string[] = [];
  if (!policy.purpose.trim() || policy.purpose.length > 500) issues.push('POLICY_PURPOSE_INVALID');
  if (![policy.minimumTrainingSamples, policy.minimumClassSamples, policy.minimumValidationSamples]
    .every((value) => Number.isInteger(value) && value >= 1)) issues.push('POLICY_SAMPLE_LIMIT_INVALID');
  if (![policy.minimumAreaUnderRoc, policy.maximumBrierScore, policy.maximumMissingFeatureRatio]
    .every((value) => bounded(value, 0, 1))) issues.push('POLICY_RATIO_LIMIT_INVALID');
  if (!bounded(policy.maximumPopulationStabilityIndex, 0, 10)
    || !bounded(policy.maximumOutOfDistributionScore, 0, 100)) issues.push('POLICY_DRIFT_LIMIT_INVALID');
  return issues;
}

export function evaluateJourneyPrediction(input: {
  model: JourneyPredictiveModel;
  policy: JourneyPredictionPolicy;
  request: JourneyPredictionRequest;
}): JourneyPredictionResult {
  const modelIssues = validateJourneyPredictiveModel(input.model);
  const configuredIssues = policyIssues(input.policy);
  if (modelIssues.length || configuredIssues.length) throw new JourneyPredictiveGovernanceError(
    `Prediction governance is invalid: ${[...modelIssues, ...configuredIssues].join(', ')}`);
  const { model, policy, request } = input;
  if (request.spaceId !== model.spaceId) throw new JourneyPredictiveGovernanceError(
    'The predictive model does not belong to this space.', 'JOURNEY_PREDICTIVE_SPACE_MISMATCH');
  if (!token(request.subjectId) || !iso(request.sourceWindow.from) || !iso(request.sourceWindow.to)
    || Date.parse(request.sourceWindow.from) >= Date.parse(request.sourceWindow.to)) throw new JourneyPredictiveGovernanceError(
    'The prediction request identity or source window is invalid.');

  const reasons: string[] = [];
  const limitations: string[] = ['A probability is decision support, not proof of a future customer outcome.'];
  if (!policy.enabled) reasons.push('PREDICTION_NOT_OPTED_IN');
  if (!request.optedIn) reasons.push('SUBJECT_NOT_OPTED_IN');
  if (!request.consentAllowed) reasons.push('PURPOSE_CONSENT_DENIED');
  if (request.purpose !== policy.purpose) reasons.push('PURPOSE_MISMATCH');
  if (model.state !== 'approved') reasons.push('MODEL_NOT_APPROVED');
  if (model.trainingSamples < policy.minimumTrainingSamples) reasons.push('TRAINING_SAMPLE_INSUFFICIENT');
  if (Math.min(model.positiveSamples, model.negativeSamples) < policy.minimumClassSamples) reasons.push('CLASS_SAMPLE_INSUFFICIENT');
  if (model.validationSamples < policy.minimumValidationSamples) reasons.push('VALIDATION_SAMPLE_INSUFFICIENT');
  if (model.areaUnderRoc < policy.minimumAreaUnderRoc || model.brierScore > policy.maximumBrierScore) {
    reasons.push('VALIDATION_PERFORMANCE_INSUFFICIENT');
  }
  if (request.populationStabilityIndex === null) reasons.push('DRIFT_EVIDENCE_MISSING');
  else if (!bounded(request.populationStabilityIndex, 0, 10)
    || request.populationStabilityIndex > policy.maximumPopulationStabilityIndex) reasons.push('POPULATION_DRIFT_EXCEEDED');
  if (request.outOfDistributionScore === null) reasons.push('DISTRIBUTION_EVIDENCE_MISSING');
  else if (!bounded(request.outOfDistributionScore, 0, 100)
    || request.outOfDistributionScore > policy.maximumOutOfDistributionScore) reasons.push('OUT_OF_DISTRIBUTION');

  const knownFeatures = new Set(model.featureNames);
  const suppliedFeatures = Object.keys(request.featureValues);
  if (suppliedFeatures.some((feature) => !knownFeatures.has(feature))) reasons.push('UNKNOWN_FEATURE');
  const missing = model.featureNames.filter((feature) => request.featureValues[feature] === null
    || request.featureValues[feature] === undefined).length;
  if (missing / model.featureNames.length > policy.maximumMissingFeatureRatio) reasons.push('FEATURE_COVERAGE_INSUFFICIENT');
  if (request.score === null || request.confidence === null) reasons.push('PREDICTION_OUTPUT_MISSING');
  else if (!bounded(request.score, 0, 1) || !bounded(request.confidence, 0, 1)) reasons.push('PREDICTION_OUTPUT_INVALID');
  if (Object.keys(request.featureContributions).some((feature) => !knownFeatures.has(feature)
    || !Number.isFinite(request.featureContributions[feature]))) reasons.push('EXPLANATION_INVALID');
  if (!model.featureNames.some((feature) => Number.isFinite(request.featureContributions[feature]))) {
    reasons.push('EXPLANATION_MISSING');
  }

  const explanation = reasons.length ? [] : model.featureNames
    .filter((feature) => Number.isFinite(request.featureContributions[feature]))
    .map((feature) => ({ feature, contribution: request.featureContributions[feature]!,
      direction: request.featureContributions[feature]! > 0 ? 'increases' as const
        : request.featureContributions[feature]! < 0 ? 'decreases' as const : 'neutral' as const }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution)
      || (left.feature < right.feature ? -1 : left.feature > right.feature ? 1 : 0))
    .slice(0, 10);
  if (reasons.includes('POPULATION_DRIFT_EXCEEDED')) limitations.push('The scoring population has drifted beyond the approved model envelope.');
  if (reasons.includes('OUT_OF_DISTRIBUTION')) limitations.push('This subject is outside the approved model distribution.');

  const abstained = reasons.length > 0;
  return Object.freeze({ decision: abstained ? 'abstained' : 'predicted', target: model.target, modelId: model.id,
    modelVersion: model.version, modelContentSha256: model.contentSha256, subjectRefSha256: hash(request.subjectId),
    sourceWindow: Object.freeze({ ...request.sourceWindow }), score: abstained ? null : request.score,
    confidence: abstained ? null : request.confidence, reasonCodes: Object.freeze(reasons.sort()),
    limitations: Object.freeze(limitations), explanation: Object.freeze(explanation.map((item) => Object.freeze(item))) });
}

export function createJourneyPredictionAudit(input: {
  spaceId: string;
  actorUserId: string;
  result: JourneyPredictionResult;
  createdAt: string;
}) {
  if (!token(input.spaceId) || !token(input.actorUserId) || !iso(input.createdAt)) throw new JourneyPredictiveGovernanceError(
    'Prediction audit attribution is invalid.');
  const detail = { decision: input.result.decision, target: input.result.target, modelId: input.result.modelId,
    modelVersion: input.result.modelVersion, modelContentSha256: input.result.modelContentSha256,
    subjectRefSha256: input.result.subjectRefSha256, sourceWindow: input.result.sourceWindow,
    score: input.result.score, confidence: input.result.confidence, reasonCodes: input.result.reasonCodes,
    explanationFeatures: input.result.explanation.map((item) => item.feature) };
  const serialized = JSON.stringify(detail);
  return Object.freeze({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'journey.prediction.evaluated',
    detail: Object.freeze(detail), detailSha256: hash(serialized), createdAt: input.createdAt });
}
