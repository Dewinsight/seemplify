import crypto from 'node:crypto';
import { db } from './database.js';
import { assertJourneyCapability, effectiveJourneyRole } from './journeyCollaboration.js';
import { readJourneyActualPathAnalytics } from './journeyActualPathAnalytics.js';
import {
  generateStageInferenceRecommendations, JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION,
  transitionStageInferenceReview, type StageInferenceRecommendationInput, type StageInferenceReviewRecord
} from './journeyStageInferenceRecommendations.js';

export class JourneyStageInferenceGovernanceError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_STAGE_INFERENCE_GOVERNANCE_INVALID',
    public details: Record<string, unknown> = {}) { super(message); this.name = 'JourneyStageInferenceGovernanceError'; }
}

export type JourneyStageInferenceGovernanceScope = {
  journeyDefinitionId: string; subjectScope?: 'anonymous_only' | 'known_profiles';
  baselineFrom: string; baselineTo: string; currentFrom: string; currentTo: string;
  baselineAsOf?: string; currentAsOf?: string; minimumSampleSize: number; minimumRecurrence: number;
  minimumCoverage: number; minimumWinningMargin: number;
};

function canonical(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)])) : item;
  return JSON.stringify(stable(value));
}
const hash = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

function correctionLineage(input: { spaceId: string; journeyDefinitionId: string; journeyMapVersionId: string;
  start: string; end: string }) {
  const row = db.prepare(`SELECT id,reason,source_id,window_start,window_end,completed_at,intent_sha256
    FROM journey_stage_reprojection_runs WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=?
      AND state='completed' AND (window_end IS NULL OR window_end>?) AND (window_start IS NULL OR window_start<?)
    ORDER BY completed_at DESC,id DESC LIMIT 1`).get(input.spaceId, input.journeyDefinitionId,
      input.journeyMapVersionId, input.start, input.end) as any;
  if (!row) return { latestCompletedAt: null, correctionRunContentSha256: null };
  const proof = { id: String(row.id), reason: String(row.reason), sourceScopeSha256: hash(row.source_id ? String(row.source_id) : 'all_sources'),
    windowStart: row.window_start ? timestamp(row.window_start) : null, windowEnd: row.window_end ? timestamp(row.window_end) : null,
    completedAt: timestamp(row.completed_at), intentSha256: String(row.intent_sha256) };
  return { latestCompletedAt: proof.completedAt, correctionRunContentSha256: hash(proof) };
}

function buildInput(spaceId: string, actorUserId: string, scope: JourneyStageInferenceGovernanceScope): StageInferenceRecommendationInput {
  assertJourneyCapability(spaceId, actorUserId, 'journeys.read', { journeyDefinitionId: scope.journeyDefinitionId });
  const subjectScope = scope.subjectScope || 'anonymous_only';
  const baselineAsOf = scope.baselineAsOf || scope.baselineTo; const currentAsOf = scope.currentAsOf || scope.currentTo;
  const baseline = readJourneyActualPathAnalytics({ spaceId, journeyDefinitionId: scope.journeyDefinitionId,
    from: scope.baselineFrom, to: scope.baselineTo, asOf: baselineAsOf, subjectKind: subjectScope,
    minimumCohortSize: scope.minimumSampleSize });
  const current = readJourneyActualPathAnalytics({ spaceId, journeyDefinitionId: scope.journeyDefinitionId,
    from: scope.currentFrom, to: scope.currentTo, asOf: currentAsOf, subjectKind: subjectScope,
    minimumCohortSize: scope.minimumSampleSize });
  const lineage = (envelope: typeof current, start: string, end: string, asOf: string) => ({
    start, end, asOf, designVersionId: envelope.scope.designVersionId,
    ruleSetVersion: envelope.analytics.lineage.ruleSetVersion, projectionVersion: envelope.analytics.lineage.projectionVersion,
    analyticsContentSha256: hash(envelope), correction: correctionLineage({ spaceId,
      journeyDefinitionId: scope.journeyDefinitionId, journeyMapVersionId: envelope.scope.designVersionId, start, end })
  });
  const candidates = current.analytics.tables.unexpectedTransitions.rows.map((row) => ({
    signalKey: `transition.${hash(`${row.fromStageId}->${row.toStageId}`).slice(0, 24)}`,
    proposedStageId: row.toStageId,
    occurrenceCount: row.measure.suppressed ? null : row.occurrenceCount,
    eligibleObservationCount: row.measure.suppressed ? null : row.measure.denominator,
    supportingInstanceCount: row.measure.suppressed ? null : row.measure.sampleSize,
    suppressed: row.measure.suppressed,
    evidenceContentSha256: hash({ fromStageId: row.fromStageId, toStageId: row.toStageId,
      classification: row.classification, occurrenceCount: row.occurrenceCount, measure: row.measure,
      analyticsContentSha256: hash(current) })
  }));
  return { journeyDefinitionId: scope.journeyDefinitionId, subjectScope,
    baseline: { ...lineage(baseline, scope.baselineFrom, scope.baselineTo, baselineAsOf),
      acceptedInstanceCount: baseline.analytics.sample.acceptedInstanceCount, suppressed: baseline.analytics.sample.suppressed },
    current: { ...lineage(current, scope.currentFrom, scope.currentTo, currentAsOf),
      acceptedInstanceCount: current.analytics.sample.acceptedInstanceCount, suppressed: current.analytics.sample.suppressed },
    designedStageIds: current.analytics.lineage.designedStageOrder,
    candidates, candidateEvidenceSuppressed: current.analytics.tables.unexpectedTransitions.suppression.applied,
    minimumSampleSize: scope.minimumSampleSize, minimumRecurrence: scope.minimumRecurrence,
    minimumCoverage: scope.minimumCoverage, minimumWinningMargin: scope.minimumWinningMargin,
    proposerRef: actorUserId };
}

export function previewGovernedStageInferenceRecommendations(input: { spaceId: string; actorUserId: string }
  & JourneyStageInferenceGovernanceScope) {
  return generateStageInferenceRecommendations(buildInput(input.spaceId, input.actorUserId, input));
}

function parse(value: unknown) { return typeof value === 'string' ? JSON.parse(value) : value; }
function runRow(row: any) {
  return { id: String(row.id), journeyDefinitionId: String(row.journey_definition_id),
    journeyMapVersionId: String(row.journey_map_version_id), subjectScope: row.subject_scope,
    period: { start: timestamp(row.period_start), end: timestamp(row.period_end) }, asOf: timestamp(row.as_of),
    detectorVersion: String(row.detector_version), contentSha256: String(row.content_sha256), result: parse(row.result_json),
    createdByRefSha256: row.created_by_user_id ? hash(String(row.created_by_user_id)) : null, createdAt: timestamp(row.created_at) };
}
function recommendationRow(row: any, actorUserId?: string) {
  const content = parse(row.content_json) as any; const proof = String(row.review_reason || '');
  const reason = /^sha256:([a-f0-9]{64});length:(\d+)$/u.exec(proof);
  const actorSha256 = actorUserId ? hash(actorUserId) : null;
  const firstReviewer = actorUserId ? db.prepare(`SELECT actor_user_id FROM journey_path_intelligence_audit
    WHERE space_id=? AND recommendation_id=? AND from_state='draft' AND to_state='in_review'
    ORDER BY created_at,id LIMIT 1`).get(row.space_id, row.id) as any : null;
  const isProposer = Boolean(actorSha256 && actorSha256 === content.review?.proposerRefSha256);
  const isFirstReviewer = Boolean(firstReviewer?.actor_user_id && String(firstReviewer.actor_user_id) === actorUserId);
  return { id: String(row.id), runId: String(row.run_id), journeyDefinitionId: String(row.journey_definition_id),
    journeyMapVersionId: String(row.journey_map_version_id), content, contentSha256: String(row.content_sha256),
    state: row.state === 'accepted' ? 'approved' : row.state, revision: Number(row.revision),
    reviewedByRefSha256: row.reviewed_by_user_id ? hash(String(row.reviewed_by_user_id)) : null,
    reviewReasonProof: reason ? { sha256: reason[1]!, length: Number(reason[2]) } : null,
    reviewEligibility: actorUserId ? { isProposer, isFirstReviewer,
      canSubmit: row.state === 'draft' && !isProposer,
      canDecide: row.state === 'in_review' && !isProposer && !isFirstReviewer,
      canRetire: row.state !== 'retired' } : null,
    reviewedAt: row.reviewed_at ? timestamp(row.reviewed_at) : null,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) };
}
function assertRead(spaceId: string, userId: string, journeyDefinitionId: string) {
  assertJourneyCapability(spaceId, userId, 'journeys.read', { journeyDefinitionId });
}
function assertReview(spaceId: string, userId: string, journeyDefinitionId: string) {
  assertJourneyCapability(spaceId, userId, 'journeys.review', { journeyDefinitionId });
}

export function createGovernedStageInferenceRun(input: { spaceId: string; actorUserId: string }
  & JourneyStageInferenceGovernanceScope) {
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.request_review',
    { journeyDefinitionId: input.journeyDefinitionId });
  const result = previewGovernedStageInferenceRecommendations(input); const resultJson = canonical(result); const resultSha256 = hash(resultJson);
  const current = result.recommendations[0]?.lineage.current || null;
  const journeyMapVersionId = result.recommendations[0]?.lineage.designVersionId
    || (db.prepare('SELECT COALESCE(published_version_id,current_version_id) id FROM journey_definitions WHERE id=? AND space_id=?')
      .get(input.journeyDefinitionId, input.spaceId) as any)?.id;
  if (!journeyMapVersionId) throw new JourneyStageInferenceGovernanceError('Journey version not found.', 404, 'JOURNEY_VERSION_NOT_FOUND');
  const subjectScope = input.subjectScope || 'anonymous_only'; const currentAsOf = input.currentAsOf || input.currentTo;
  const existing = db.prepare(`SELECT * FROM journey_path_intelligence_runs WHERE space_id=? AND journey_definition_id=?
    AND journey_map_version_id=? AND subject_scope=? AND period_start=? AND period_end=? AND as_of=?
    AND minimum_sample_size=? AND secondary_suppression_threshold=? AND detector_version=? AND content_sha256=?`).get(
      input.spaceId, input.journeyDefinitionId, journeyMapVersionId, subjectScope, input.currentFrom, input.currentTo,
      currentAsOf, input.minimumSampleSize, input.minimumRecurrence, JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION,
      resultSha256) as any;
  if (existing) return { run: runRow(existing), recommendations: listRecommendationsUnchecked(input.spaceId, existing.id), replayed: true };
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_path_intelligence_runs
      (id,space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,as_of,
       minimum_sample_size,secondary_suppression_threshold,detector_version,content_sha256,result_json,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.spaceId, input.journeyDefinitionId, journeyMapVersionId,
        subjectScope, input.currentFrom, input.currentTo, currentAsOf, input.minimumSampleSize, input.minimumRecurrence,
        JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION, resultSha256, resultJson, input.actorUserId, now);
    for (const recommendation of result.recommendations) {
      db.prepare(`INSERT INTO journey_stage_inference_recommendations
        (id,run_id,space_id,journey_definition_id,journey_map_version_id,recommendation_key,content_json,content_sha256,
         state,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft',1,?,?)`).run(recommendation.recommendationId,
          id, input.spaceId, input.journeyDefinitionId, journeyMapVersionId, recommendation.deterministicRuleId,
          canonical(recommendation), recommendation.contentSha256, now, now);
      db.prepare(`INSERT INTO journey_path_intelligence_audit
        (id,space_id,run_id,recommendation_id,actor_user_id,action,to_state,revision,detail_json,created_at)
        VALUES (?,?,?,?,?,'recommendation.created','draft',1,?,?)`).run(crypto.randomUUID(), input.spaceId, id,
          recommendation.recommendationId, input.actorUserId,
          canonical({ contentSha256: recommendation.contentSha256, generatorVersion: result.version }), now);
    }
  })();
  const stored = db.prepare('SELECT * FROM journey_path_intelligence_runs WHERE id=? AND space_id=?').get(id, input.spaceId);
  return { run: runRow(stored), recommendations: listRecommendationsUnchecked(input.spaceId, id), replayed: false };
}

function listRecommendationsUnchecked(spaceId: string, runId?: string) {
  return (db.prepare(`SELECT * FROM journey_stage_inference_recommendations WHERE space_id=? ${runId ? 'AND run_id=?' : ''}
    ORDER BY created_at DESC,id`).all(...(runId ? [spaceId, runId] : [spaceId])) as any[])
    .map((row) => recommendationRow(row));
}
export function listGovernedStageInferenceRuns(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string }) {
  assertRead(input.spaceId, input.actorUserId, input.journeyDefinitionId);
  return (db.prepare(`SELECT * FROM journey_path_intelligence_runs WHERE space_id=? AND journey_definition_id=?
    AND detector_version=? ORDER BY created_at DESC,id`).all(input.spaceId, input.journeyDefinitionId,
      JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION) as any[]).map(runRow);
}
export function listGovernedStageInferenceRecommendations(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string }) {
  assertRead(input.spaceId, input.actorUserId, input.journeyDefinitionId);
  return (db.prepare(`SELECT * FROM journey_stage_inference_recommendations WHERE space_id=? AND journey_definition_id=?
    AND run_id IN (SELECT id FROM journey_path_intelligence_runs WHERE space_id=? AND detector_version=?)
    ORDER BY created_at DESC,id`).all(input.spaceId, input.journeyDefinitionId, input.spaceId,
      JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION) as any[]).map((row) => recommendationRow(row, input.actorUserId));
}
export function governedStageInferencePermissions(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string }) {
  assertRead(input.spaceId, input.actorUserId, input.journeyDefinitionId);
  const effective = effectiveJourneyRole(input.spaceId, input.actorUserId, input.journeyDefinitionId);
  return { canRequestReview: !effective.readOnly && effective.capabilities.has('journeys.request_review'),
    canReview: !effective.readOnly && effective.capabilities.has('journeys.review') };
}

function requireRecommendation(spaceId: string, id: string) {
  const row = db.prepare(`SELECT recommendation.*,run.created_by_user_id proposer_user_id FROM journey_stage_inference_recommendations recommendation
    JOIN journey_path_intelligence_runs run ON run.id=recommendation.run_id AND run.space_id=recommendation.space_id
    WHERE recommendation.id=? AND recommendation.space_id=? AND run.detector_version=?`).get(id, spaceId,
      JOURNEY_STAGE_INFERENCE_RECOMMENDATION_VERSION) as any;
  if (!row) throw new JourneyStageInferenceGovernanceError('Stage-inference recommendation not found.', 404,
    'JOURNEY_STAGE_INFERENCE_RECOMMENDATION_NOT_FOUND');
  return row;
}
function reasonProof(reason: string) { const value = reason.trim(); if (value.length < 3 || value.length > 2_000)
  throw new JourneyStageInferenceGovernanceError('A review reason between 3 and 2000 characters is required.');
  return { value, stored: `sha256:${hash(value)};length:${value.length}` }; }

export function reviewGovernedStageInferenceRecommendation(input: { spaceId: string; actorUserId: string;
  recommendationId: string; expectedRevision: number; action: 'submit_for_review' | 'approve' | 'reject' | 'retire'; reason: string }) {
  const initial = requireRecommendation(input.spaceId, input.recommendationId);
  assertReview(input.spaceId, input.actorUserId, String(initial.journey_definition_id)); const proof = reasonProof(input.reason);
  return db.transaction(() => {
    const row = requireRecommendation(input.spaceId, input.recommendationId); const content = parse(row.content_json) as any;
    const submitted = db.prepare(`SELECT actor_user_id FROM journey_path_intelligence_audit WHERE space_id=? AND recommendation_id=?
      AND from_state='draft' AND to_state='in_review' ORDER BY created_at,id LIMIT 1`).get(input.spaceId, input.recommendationId) as any;
    const state = row.state === 'accepted' ? 'approved' : row.state;
    const record: StageInferenceReviewRecord = { recommendationId: String(row.id), state, revision: Number(row.revision),
      proposerRefSha256: String(content.review.proposerRefSha256),
      submittedByRefSha256: submitted?.actor_user_id ? hash(String(submitted.actor_user_id)) : null,
      decidedByRefSha256: ['accepted', 'rejected', 'retired'].includes(String(row.state)) && row.reviewed_by_user_id
        ? hash(String(row.reviewed_by_user_id)) : null,
      decisionReasonSha256: null, decisionReasonLength: null };
    let next;
    try { next = transitionStageInferenceReview({ record, expectedRevision: input.expectedRevision, action: input.action,
      actorRef: input.actorUserId, capabilities: input.action === 'submit_for_review' || input.action === 'retire'
        ? ['journey_stage_inference_review'] : ['journey_stage_inference_approve'], reason: proof.value }); }
    catch (error) { throw new JourneyStageInferenceGovernanceError(error instanceof Error ? error.message : 'Review transition failed.',
      /revision conflict/iu.test(String((error as Error)?.message)) ? 409 : 403, 'JOURNEY_STAGE_INFERENCE_REVIEW_INVALID'); }
    const databaseState = next.state === 'approved' ? 'accepted' : next.state;
    const now = new Date().toISOString();
    const changed = db.prepare(`UPDATE journey_stage_inference_recommendations SET state=?,revision=revision+1,
      reviewed_by_user_id=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=? AND space_id=? AND revision=? AND state=?`).run(
        databaseState, input.actorUserId, proof.stored, now, now, input.recommendationId, input.spaceId,
        input.expectedRevision, row.state).changes;
    if (changed !== 1) throw new JourneyStageInferenceGovernanceError('Recommendation review revision conflict.', 409,
      'JOURNEY_STAGE_INFERENCE_REVISION_CONFLICT');
    db.prepare(`INSERT INTO journey_path_intelligence_audit
      (id,space_id,run_id,recommendation_id,actor_user_id,action,from_state,to_state,revision,detail_json,created_at)
      VALUES (?,?,?,?,?,'recommendation.reviewed',?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, row.run_id,
        input.recommendationId, input.actorUserId, row.state, databaseState, input.expectedRevision + 1,
        canonical({ action: input.action, reasonSha256: hash(proof.value), reasonLength: proof.value.length,
          applyMode: 'never_automatic' }), now);
    return recommendationRow(requireRecommendation(input.spaceId, input.recommendationId));
  })();
}
