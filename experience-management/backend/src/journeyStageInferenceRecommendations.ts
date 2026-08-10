import crypto from 'node:crypto';

export const JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION = 'journey-stage-inference-recommendation/v1' as const;
export const MAX_STAGE_INFERENCE_CANDIDATES = 10_000;
export const MAX_STAGE_INFERENCE_RECOMMENDATIONS = 100;

type WindowLineage = {
  start: string; end: string; asOf: string; designVersionId: string; ruleSetVersion: string; projectionVersion: string;
  analyticsContentSha256: string;
  correction: { latestCompletedAt: string | null; correctionRunContentSha256: string | null };
};

export type StageInferenceCandidate = {
  signalKey: string;
  proposedStageId: string;
  occurrenceCount: number | null;
  eligibleObservationCount: number | null;
  supportingInstanceCount: number | null;
  suppressed: boolean;
  evidenceContentSha256: string;
};

export type StageInferenceRecommendationInput = {
  journeyDefinitionId: string;
  subjectScope: 'anonymous_only' | 'known_profiles';
  baseline: WindowLineage & { acceptedInstanceCount: number | null; suppressed: boolean };
  current: WindowLineage & { acceptedInstanceCount: number | null; suppressed: boolean };
  designedStageIds: string[];
  candidates: StageInferenceCandidate[];
  candidateEvidenceSuppressed: boolean;
  minimumSampleSize: number;
  minimumRecurrence: number;
  minimumCoverage: number;
  minimumWinningMargin: number;
  proposerRef: string;
};

export type StageInferenceRecommendation = {
  recommendationId: string;
  deterministicRuleId: string;
  state: 'draft';
  revision: 1;
  signalKey: string;
  proposedStageId: string;
  evidence: {
    occurrenceCount: number;
    eligibleObservationCount: number;
    supportingInstanceCount: number;
    coverage: number;
    winningMargin: number;
    evidenceContentSha256: string;
  };
  lineage: {
    journeyDefinitionId: string; subjectScope: 'anonymous_only' | 'known_profiles'; designVersionId: string;
    ruleSetVersion: string; projectionVersion: string;
    baseline: Omit<WindowLineage, 'designVersionId' | 'ruleSetVersion' | 'projectionVersion'>;
    current: Omit<WindowLineage, 'designVersionId' | 'ruleSetVersion' | 'projectionVersion'>;
  };
  confidence: { method: 'measured_coverage_and_recurrence'; coverage: number; recurrence: number; winningMargin: number };
  explanation: string;
  limitations: string[];
  review: {
    state: 'draft'; applyMode: 'never_automatic'; requiredCapabilities: readonly ['journey_stage_inference_review', 'journey_stage_inference_approve'];
    minimumDistinctReviewers: 2; proposerMayApprove: false; proposerRefSha256: string;
  };
  contentSha256: string;
};

export type StageInferenceReviewRecord = {
  recommendationId: string; state: 'draft' | 'in_review' | 'approved' | 'rejected' | 'retired'; revision: number;
  proposerRefSha256: string; submittedByRefSha256: string | null; decidedByRefSha256: string | null;
  decisionReasonSha256: string | null; decisionReasonLength: number | null;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const digest = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const isDigest = (value: string | null) => value === null || /^[a-f0-9]{64}$/u.test(value);
const instant = (value: string) => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error('Lineage timestamps must be ISO-compatible instants.'); return parsed; };

function validateWindow(window: WindowLineage, name: string) {
  const start = instant(window.start); const end = instant(window.end); const asOf = instant(window.asOf);
  if (start >= end || asOf < start) throw new Error(`${name} must have a non-empty window and an as-of at or after its start.`);
  if (!isDigest(window.analyticsContentSha256) || !isDigest(window.correction.correctionRunContentSha256))
    throw new Error(`${name} lineage requires SHA-256 content citations.`);
  const correctedAfterAsOf = Boolean(window.correction.latestCompletedAt && instant(window.correction.latestCompletedAt) > asOf);
  return { start, end, correctedAfterAsOf };
}

function validateInput(input: StageInferenceRecommendationInput) {
  if (!Number.isInteger(input.minimumSampleSize) || input.minimumSampleSize < 3 || input.minimumSampleSize > 1_000)
    throw new Error('minimumSampleSize must be between 3 and 1000.');
  if (!Number.isInteger(input.minimumRecurrence) || input.minimumRecurrence < 3 || input.minimumRecurrence > 1_000)
    throw new Error('minimumRecurrence must be between 3 and 1000.');
  if (!(input.minimumCoverage > 0 && input.minimumCoverage <= 1) || !(input.minimumWinningMargin >= 0 && input.minimumWinningMargin <= 1))
    throw new Error('Coverage and winning-margin thresholds must be bounded ratios.');
  if (input.candidates.length > MAX_STAGE_INFERENCE_CANDIDATES) throw new Error(`Candidate count exceeds ${MAX_STAGE_INFERENCE_CANDIDATES}.`);
  if (!input.proposerRef.trim() || input.proposerRef.length > 256) throw new Error('A bounded internal proposer reference is required.');
  if (!input.designedStageIds.length || new Set(input.designedStageIds).size !== input.designedStageIds.length)
    throw new Error('Designed stages must be non-empty and unique.');
  const baseline = validateWindow(input.baseline, 'Baseline'); const current = validateWindow(input.current, 'Current');
  const safetyReasons: string[] = [];
  if (baseline.end > current.start) safetyReasons.push('WINDOWS_OVERLAP');
  if (baseline.correctedAfterAsOf || current.correctedAfterAsOf) safetyReasons.push('CORRECTION_AFTER_AS_OF');
  for (const key of ['designVersionId', 'ruleSetVersion', 'projectionVersion'] as const) {
    if (input.baseline[key] !== input.current[key]) safetyReasons.push(`${key.replace(/([A-Z])/gu, '_$1').toUpperCase()}_DRIFT`);
  }
  const candidateKeys = new Set<string>();
  for (const candidate of input.candidates) {
    if (!/^[a-z][a-z0-9_.:-]{0,99}$/u.test(candidate.signalKey)) throw new Error('Signal keys must be content-safe taxonomy identifiers.');
    if (!input.designedStageIds.includes(candidate.proposedStageId)) throw new Error('A proposed stage must belong to the exact designed version.');
    if (!isDigest(candidate.evidenceContentSha256)) throw new Error('Candidate evidence requires a SHA-256 citation.');
    const key = `${candidate.signalKey}\u001f${candidate.proposedStageId}`;
    if (candidateKeys.has(key)) throw new Error('Candidate signal and proposed-stage pairs must be unique.');
    candidateKeys.add(key);
  }
  return safetyReasons;
}

export function generateStageInferenceRecommendations(input: StageInferenceRecommendationInput) {
  const abstentionReasons = validateInput(input);
  const sampleInsufficient = input.baseline.suppressed || input.current.suppressed
    || input.baseline.acceptedInstanceCount === null || input.current.acceptedInstanceCount === null
    || input.baseline.acceptedInstanceCount < input.minimumSampleSize || input.current.acceptedInstanceCount < input.minimumSampleSize;
  if (sampleInsufficient) abstentionReasons.push('WINDOW_SAMPLE_UNKNOWN_SUPPRESSED_OR_INSUFFICIENT');
  if (input.candidateEvidenceSuppressed || input.candidates.some((candidate) => candidate.suppressed || candidate.occurrenceCount === null
    || candidate.eligibleObservationCount === null || candidate.supportingInstanceCount === null))
    abstentionReasons.push('CANDIDATE_EVIDENCE_UNKNOWN_OR_SUPPRESSED');
  if (abstentionReasons.length) return { version: JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION,
    status: 'abstained' as const, abstentionReasons, recommendations: [] as StageInferenceRecommendation[],
    bounds: { maximumCandidates: MAX_STAGE_INFERENCE_CANDIDATES, maximumRecommendations: MAX_STAGE_INFERENCE_RECOMMENDATIONS,
      evaluatedCandidateCount: null }, interpretation: 'Recommendation generation abstained; unknown and suppressed evidence is not zero.' };

  const groups = new Map<string, StageInferenceCandidate[]>();
  for (const candidate of input.candidates) groups.set(candidate.signalKey, [...(groups.get(candidate.signalKey) || []), candidate]);
  const recommendations: StageInferenceRecommendation[] = [];
  let ambiguousSignalCount = 0; let belowThresholdSignalCount = 0;
  for (const [signalKey, candidates] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...candidates].sort((a, b) => b.occurrenceCount! - a.occurrenceCount!
      || a.proposedStageId.localeCompare(b.proposedStageId));
    const winner = ranked[0]!;
    if (winner.eligibleObservationCount! <= 0 || winner.occurrenceCount! > winner.eligibleObservationCount!
      || winner.supportingInstanceCount! > winner.occurrenceCount!) { belowThresholdSignalCount += 1; continue; }
    const coverage = winner.occurrenceCount! / winner.eligibleObservationCount!;
    const runnerCoverage = ranked[1] ? ranked[1]!.occurrenceCount! / ranked[1]!.eligibleObservationCount! : 0;
    const winningMargin = coverage - runnerCoverage;
    if (ranked[1] && winningMargin < input.minimumWinningMargin) { ambiguousSignalCount += 1; continue; }
    if (winner.occurrenceCount! < input.minimumRecurrence || winner.supportingInstanceCount! < input.minimumRecurrence
      || coverage < input.minimumCoverage) { belowThresholdSignalCount += 1; continue; }
    const lineage = { journeyDefinitionId: input.journeyDefinitionId, subjectScope: input.subjectScope,
      designVersionId: input.current.designVersionId, ruleSetVersion: input.current.ruleSetVersion,
      projectionVersion: input.current.projectionVersion,
      baseline: { start: input.baseline.start, end: input.baseline.end, asOf: input.baseline.asOf,
        analyticsContentSha256: input.baseline.analyticsContentSha256, correction: input.baseline.correction },
      current: { start: input.current.start, end: input.current.end, asOf: input.current.asOf,
        analyticsContentSha256: input.current.analyticsContentSha256, correction: input.current.correction } };
    const ruleSeed = { journeyDefinitionId: input.journeyDefinitionId, designVersionId: input.current.designVersionId,
      ruleSetVersion: input.current.ruleSetVersion, projectionVersion: input.current.projectionVersion,
      signalKey, proposedStageId: winner.proposedStageId };
    const deterministicRuleId = `stage-rule-${digest(ruleSeed).slice(0, 32)}`;
    const recommendationId = `stage-inference-${digest({ ...ruleSeed, lineage }).slice(0, 32)}`;
    const base = { recommendationId, deterministicRuleId, state: 'draft' as const, revision: 1 as const,
      signalKey, proposedStageId: winner.proposedStageId,
      evidence: { occurrenceCount: winner.occurrenceCount!, eligibleObservationCount: winner.eligibleObservationCount!,
        supportingInstanceCount: winner.supportingInstanceCount!, coverage, winningMargin,
        evidenceContentSha256: winner.evidenceContentSha256 }, lineage,
      confidence: { method: 'measured_coverage_and_recurrence' as const, coverage,
        recurrence: winner.occurrenceCount!, winningMargin },
      explanation: `The reviewed taxonomy signal recurred in ${winner.occurrenceCount} of ${winner.eligibleObservationCount} eligible observations across ${winner.supportingInstanceCount} journey instances.`,
      limitations: ['Measured recurrence is descriptive evidence, not proof that the proposed stage is correct.',
        'Approval records a recommendation only and never changes a stage assignment or published rule.'],
      review: { state: 'draft' as const, applyMode: 'never_automatic' as const,
        requiredCapabilities: ['journey_stage_inference_review', 'journey_stage_inference_approve'] as const,
        minimumDistinctReviewers: 2 as const, proposerMayApprove: false as const, proposerRefSha256: digest(input.proposerRef) } };
    recommendations.push({ ...base, contentSha256: digest(base) });
    if (recommendations.length === MAX_STAGE_INFERENCE_RECOMMENDATIONS) break;
  }
  if (ambiguousSignalCount) return { version: JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION,
    status: 'abstained' as const, abstentionReasons: ['AMBIGUOUS_COMPETING_CANDIDATE'],
    recommendations: [] as StageInferenceRecommendation[],
    bounds: { maximumCandidates: MAX_STAGE_INFERENCE_CANDIDATES, maximumRecommendations: MAX_STAGE_INFERENCE_RECOMMENDATIONS,
      evaluatedCandidateCount: input.candidates.length, ambiguousSignalCount },
    interpretation: 'Ambiguous competing stage evidence requires investigation; no recommendation was produced.' };
  return { version: JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION,
    status: recommendations.length ? 'recommended' as const : 'no_recommendation' as const,
    abstentionReasons: [] as string[], recommendations,
    bounds: { maximumCandidates: MAX_STAGE_INFERENCE_CANDIDATES, maximumRecommendations: MAX_STAGE_INFERENCE_RECOMMENDATIONS,
      evaluatedCandidateCount: input.candidates.length, ambiguousSignalCount, belowThresholdSignalCount,
      truncated: recommendations.length === MAX_STAGE_INFERENCE_RECOMMENDATIONS && groups.size > recommendations.length },
    interpretation: 'Deterministic recommendations require independent human review and never mutate stage assignments.' };
}

export function transitionStageInferenceReview(input: { record: StageInferenceReviewRecord; expectedRevision: number;
  action: 'submit_for_review' | 'approve' | 'reject' | 'retire'; actorRef: string; capabilities: string[]; reason: string }) {
  if (input.record.revision !== input.expectedRevision) throw new Error('Recommendation review revision conflict.');
  const actor = digest(input.actorRef); const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 2_000) throw new Error('A bounded review reason is required.');
  if (input.action === 'submit_for_review') {
    if (input.record.state !== 'draft' || !input.capabilities.includes('journey_stage_inference_review')) throw new Error('Review submission is not authorised.');
    if (actor === input.record.proposerRefSha256) throw new Error('The proposer cannot serve as the first independent reviewer.');
    return { ...input.record, state: 'in_review' as const, revision: input.record.revision + 1,
      submittedByRefSha256: actor, decisionReasonSha256: digest(reason), decisionReasonLength: reason.length };
  }
  if (input.action === 'retire') {
    if (!input.capabilities.includes('journey_stage_inference_review') || input.record.state === 'retired') throw new Error('Retirement is not authorised.');
    return { ...input.record, state: 'retired' as const, revision: input.record.revision + 1,
      decidedByRefSha256: actor, decisionReasonSha256: digest(reason), decisionReasonLength: reason.length };
  }
  if (input.record.state !== 'in_review' || !input.capabilities.includes('journey_stage_inference_approve'))
    throw new Error('Recommendation decision is not authorised.');
  if (actor === input.record.proposerRefSha256 || actor === input.record.submittedByRefSha256)
    throw new Error('Approval or rejection requires a distinct second reviewer who is not the proposer.');
  return { ...input.record, state: input.action === 'approve' ? 'approved' as const : 'rejected' as const,
    revision: input.record.revision + 1, decidedByRefSha256: actor,
    decisionReasonSha256: digest(reason), decisionReasonLength: reason.length };
}
