import { api, json } from '@/lib/api';

export type StageInferenceReviewAction = 'submit_for_review' | 'approve' | 'reject' | 'retire';
export type StageInferenceReviewState = 'draft' | 'in_review' | 'approved' | 'rejected' | 'retired';

export type GovernedStageInferenceRecommendation = {
  id: string;
  runId: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  contentSha256: string;
  state: StageInferenceReviewState;
  revision: number;
  content: {
    deterministicRuleId: string;
    signalKey: string;
    proposedStageId: string;
    evidence: { occurrenceCount: number; eligibleObservationCount: number; supportingInstanceCount: number;
      coverage: number; winningMargin: number; evidenceContentSha256: string };
    lineage: { designVersionId: string; ruleSetVersion: string; projectionVersion: string;
      baseline: { start: string; end: string; asOf: string; analyticsContentSha256: string;
        correction: { latestCompletedAt: string | null; correctionRunContentSha256: string | null } };
      current: { start: string; end: string; asOf: string; analyticsContentSha256: string;
        correction: { latestCompletedAt: string | null; correctionRunContentSha256: string | null } } };
    confidence: { method: 'measured_coverage_and_recurrence'; coverage: number; recurrence: number; winningMargin: number };
    explanation: string;
    limitations: string[];
    review: { applyMode: 'never_automatic'; minimumDistinctReviewers: 2; proposerMayApprove: false };
  };
  reviewReasonProof: { sha256: string; length: number } | null;
  reviewEligibility: { isProposer: boolean; isFirstReviewer: boolean; canSubmit: boolean; canDecide: boolean; canRetire: boolean } | null;
};

export type StageInferencePermissions = { canRequestReview: boolean; canReview: boolean };
export type StageInferenceScope = { journeyDefinitionId: string; subjectScope: 'anonymous_only' | 'known_profiles';
  baselineFrom: string; baselineTo: string; currentFrom: string; currentTo: string;
  minimumSampleSize?: number; minimumRecurrence?: number; minimumCoverage?: number; minimumWinningMargin?: number };

const object = (value: unknown, name: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} is invalid.`);
  return value as Record<string, unknown>;
};
const string = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is invalid.`); return value;
};
const number = (value: unknown, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} is invalid.`); return value;
};
const bool = (value: unknown, name: string) => {
  if (typeof value !== 'boolean') throw new Error(`${name} is invalid.`); return value;
};
const sha = (value: unknown, name: string) => {
  const digest = string(value, name); if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(`${name} is invalid.`); return digest;
};
const optionalSha = (value: unknown, name: string) => value === null ? null : sha(value, name);

export function parseGovernedStageInferenceRecommendation(value: unknown): GovernedStageInferenceRecommendation {
  const row = object(value, 'Stage-inference recommendation'); const content = object(row.content, 'Recommendation content');
  const evidence = object(content.evidence, 'Recommendation evidence'); const confidence = object(content.confidence, 'Recommendation confidence');
  const lineage = object(content.lineage, 'Recommendation lineage'); const review = object(content.review, 'Recommendation review contract');
  const window = (value: unknown, name: string) => { const item = object(value, name); const correction = object(item.correction, `${name} correction`);
    return { start: string(item.start, `${name} start`), end: string(item.end, `${name} end`), asOf: string(item.asOf, `${name} as-of`),
      analyticsContentSha256: sha(item.analyticsContentSha256, `${name} analytics proof`), correction: {
        latestCompletedAt: item.correction && correction.latestCompletedAt !== null ? string(correction.latestCompletedAt, `${name} correction time`) : null,
        correctionRunContentSha256: optionalSha(correction.correctionRunContentSha256, `${name} correction proof`) } }; };
  const state = string(row.state, 'Recommendation state');
  if (!['draft', 'in_review', 'approved', 'rejected', 'retired'].includes(state)) throw new Error('Recommendation state is invalid.');
  const eligibilityValue = row.reviewEligibility === null ? null : object(row.reviewEligibility, 'Review eligibility');
  const reasonValue = row.reviewReasonProof === null ? null : object(row.reviewReasonProof, 'Review reason proof');
  return { id: string(row.id, 'Recommendation id'), runId: string(row.runId, 'Run id'),
    journeyDefinitionId: string(row.journeyDefinitionId, 'Journey id'), journeyMapVersionId: string(row.journeyMapVersionId, 'Journey version'),
    contentSha256: sha(row.contentSha256, 'Recommendation proof'), state: state as StageInferenceReviewState,
    revision: number(row.revision, 'Recommendation revision'), content: {
      deterministicRuleId: string(content.deterministicRuleId, 'Rule id'), signalKey: string(content.signalKey, 'Signal key'),
      proposedStageId: string(content.proposedStageId, 'Proposed stage'), evidence: {
        occurrenceCount: number(evidence.occurrenceCount, 'Occurrence count'), eligibleObservationCount: number(evidence.eligibleObservationCount, 'Eligible count'),
        supportingInstanceCount: number(evidence.supportingInstanceCount, 'Supporting instance count'), coverage: number(evidence.coverage, 'Coverage'),
        winningMargin: number(evidence.winningMargin, 'Winning margin'), evidenceContentSha256: sha(evidence.evidenceContentSha256, 'Evidence proof') },
      lineage: { designVersionId: string(lineage.designVersionId, 'Design version'), ruleSetVersion: string(lineage.ruleSetVersion, 'Rule-set version'),
        projectionVersion: string(lineage.projectionVersion, 'Projection version'), baseline: window(lineage.baseline, 'Baseline'), current: window(lineage.current, 'Current') },
      confidence: { method: confidence.method === 'measured_coverage_and_recurrence' ? confidence.method : (() => { throw new Error('Confidence method is invalid.'); })(),
        coverage: number(confidence.coverage, 'Confidence coverage'), recurrence: number(confidence.recurrence, 'Confidence recurrence'),
        winningMargin: number(confidence.winningMargin, 'Confidence winning margin') },
      explanation: string(content.explanation, 'Recommendation explanation'),
      limitations: Array.isArray(content.limitations) ? content.limitations.map((item) => string(item, 'Recommendation limitation')) : (() => { throw new Error('Recommendation limitations are invalid.'); })(),
      review: { applyMode: review.applyMode === 'never_automatic' ? review.applyMode : (() => { throw new Error('Apply mode is invalid.'); })(),
        minimumDistinctReviewers: number(review.minimumDistinctReviewers, 'Minimum reviewers') as 2,
        proposerMayApprove: review.proposerMayApprove === false ? false : (() => { throw new Error('Proposer approval contract is invalid.'); })() } },
    reviewReasonProof: reasonValue ? { sha256: sha(reasonValue.sha256, 'Reason proof'), length: number(reasonValue.length, 'Reason length') } : null,
    reviewEligibility: eligibilityValue ? { isProposer: bool(eligibilityValue.isProposer, 'Proposer eligibility'),
      isFirstReviewer: bool(eligibilityValue.isFirstReviewer, 'First reviewer eligibility'), canSubmit: bool(eligibilityValue.canSubmit, 'Submit eligibility'),
      canDecide: bool(eligibilityValue.canDecide, 'Decision eligibility'), canRetire: bool(eligibilityValue.canRetire, 'Retirement eligibility') } : null };
}

const base = '/api/journey-metrics/actual-path-stage-inference';
export async function listGovernedStageInferenceRecommendations(journeyDefinitionId: string) {
  const raw = object(await api<unknown>(`${base}/recommendations?${new URLSearchParams({ journeyDefinitionId })}`), 'Recommendations response');
  const permissions = object(raw.permissions, 'Recommendation permissions');
  if (!Array.isArray(raw.recommendations)) throw new Error('Recommendations are invalid.');
  return { recommendations: raw.recommendations.map(parseGovernedStageInferenceRecommendation), permissions: {
    canRequestReview: bool(permissions.canRequestReview, 'Request-review permission'), canReview: bool(permissions.canReview, 'Review permission') } };
}

export async function createGovernedStageInferenceRun(scope: StageInferenceScope) {
  const raw = object(await api<unknown>(`${base}/runs`, json('POST', { minimumSampleSize: 20, minimumRecurrence: 10,
    minimumCoverage: 0.7, minimumWinningMargin: 0.2, ...scope })), 'Create recommendation response');
  if (!Array.isArray(raw.recommendations)) throw new Error('Created recommendations are invalid.');
  return { recommendations: raw.recommendations.map(parseGovernedStageInferenceRecommendation), replayed: bool(raw.replayed, 'Replay marker') };
}

export async function reviewGovernedStageInferenceRecommendation(recommendationId: string, expectedRevision: number,
  action: StageInferenceReviewAction, reason: string) {
  const raw = object(await api<unknown>(`${base}/recommendations/${encodeURIComponent(recommendationId)}/review`,
    json('POST', { expectedRevision, action, reason })), 'Review response');
  return parseGovernedStageInferenceRecommendation(raw.recommendation);
}
