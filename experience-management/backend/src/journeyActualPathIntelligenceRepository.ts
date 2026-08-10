import crypto from 'node:crypto';
import { db } from './database.js';
import { readJourneyActualPathAnalytics } from './journeyActualPathAnalytics.js';
import {
  detectJourneyPathIntelligence, journeyPathIntelligenceSha256, stableJourneyPathIntelligenceJson,
  type JourneyPathIntelligenceResult
} from './journeyActualPathIntelligence.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';
import {
  compareJourneyActualPaths, type ActualPathCorrectionLineage
} from './journeyActualPathComparison.js';

export class JourneyPathIntelligenceRepositoryError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_PATH_INTELLIGENCE_INVALID',
    public details: Record<string, unknown> = {}) {
    super(message); this.name = 'JourneyPathIntelligenceRepositoryError';
  }
}

if (db.provider === 'sqlite') db.exec(`
  CREATE TABLE IF NOT EXISTS journey_path_intelligence_runs (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    journey_definition_id TEXT NOT NULL, journey_map_version_id TEXT NOT NULL,
    subject_scope TEXT NOT NULL CHECK(subject_scope IN ('anonymous_only','known_profiles')),
    period_start TEXT NOT NULL, period_end TEXT NOT NULL, as_of TEXT NOT NULL,
    minimum_sample_size INTEGER NOT NULL CHECK(minimum_sample_size>0),
    secondary_suppression_threshold INTEGER NOT NULL CHECK(secondary_suppression_threshold>0),
    detector_version TEXT NOT NULL, content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
    result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(space_id,journey_definition_id,journey_map_version_id,subject_scope,
      period_start,period_end,as_of,minimum_sample_size,secondary_suppression_threshold,detector_version,content_sha256),
    FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(journey_map_version_id,journey_definition_id,space_id)
      REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS journey_path_intelligence_runs_history
    ON journey_path_intelligence_runs(space_id,journey_definition_id,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS journey_stage_inference_recommendations (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    journey_definition_id TEXT NOT NULL, journey_map_version_id TEXT NOT NULL, recommendation_key TEXT NOT NULL,
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
    state TEXT NOT NULL CHECK(state IN ('draft','in_review','accepted','rejected','retired')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    review_reason TEXT, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(run_id,recommendation_key), UNIQUE(id,run_id,space_id),
    FOREIGN KEY(run_id,space_id) REFERENCES journey_path_intelligence_runs(id,space_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS journey_stage_inference_recommendations_history
    ON journey_stage_inference_recommendations(space_id,journey_definition_id,state,created_at DESC,id);
  CREATE TABLE IF NOT EXISTS journey_path_intelligence_audit (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL, recommendation_id TEXT, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, from_state TEXT, to_state TEXT, revision INTEGER, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
    created_at TEXT NOT NULL, FOREIGN KEY(run_id,space_id) REFERENCES journey_path_intelligence_runs(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(recommendation_id,run_id,space_id) REFERENCES journey_stage_inference_recommendations(id,run_id,space_id) ON DELETE CASCADE
  );
  CREATE TRIGGER IF NOT EXISTS journey_path_intelligence_runs_update_guard BEFORE UPDATE ON journey_path_intelligence_runs
    BEGIN SELECT RAISE(ABORT,'journey path intelligence runs are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_path_intelligence_runs_delete_guard BEFORE DELETE ON journey_path_intelligence_runs
    BEGIN SELECT RAISE(ABORT,'journey path intelligence runs are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_path_intelligence_audit_update_guard BEFORE UPDATE ON journey_path_intelligence_audit
    BEGIN SELECT RAISE(ABORT,'journey path intelligence audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_path_intelligence_audit_delete_guard BEFORE DELETE ON journey_path_intelligence_audit
    BEGIN SELECT RAISE(ABORT,'journey path intelligence audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS journey_stage_inference_content_guard BEFORE UPDATE ON journey_stage_inference_recommendations
    WHEN NEW.run_id<>OLD.run_id OR NEW.space_id<>OLD.space_id OR NEW.journey_definition_id<>OLD.journey_definition_id
      OR NEW.journey_map_version_id<>OLD.journey_map_version_id OR NEW.recommendation_key<>OLD.recommendation_key
      OR NEW.content_json<>OLD.content_json OR NEW.content_sha256<>OLD.content_sha256 OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'stage inference recommendation content is immutable'); END;
`);

function assertRead(spaceId: string, userId: string) {
  assertSubscriptionFeature(spaceId, 'journeyActualPaths');
  assertSubscriptionFeature(spaceId, 'journeyConnected');
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId) as { role?: string } | undefined;
  if (!membership) throw new JourneyPathIntelligenceRepositoryError('Space membership is required.', 403, 'JOURNEY_PATH_INTELLIGENCE_FORBIDDEN');
  return membership.role;
}
function assertManage(spaceId: string, userId: string) {
  if (assertRead(spaceId, userId) === 'member') throw new JourneyPathIntelligenceRepositoryError(
    'Only space owners and administrators may manage path intelligence.', 403, 'JOURNEY_PATH_INTELLIGENCE_MANAGE_REQUIRED');
}
const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
function rowRecommendation(row: any) {
  return { id: String(row.id), runId: String(row.run_id), journeyDefinitionId: String(row.journey_definition_id),
    journeyMapVersionId: String(row.journey_map_version_id), recommendation: typeof row.content_json === 'string'
      ? JSON.parse(row.content_json) : row.content_json,
    contentSha256: String(row.content_sha256), state: row.state, revision: Number(row.revision),
    reviewedByUserId: row.reviewed_by_user_id || null, reviewReason: row.review_reason || null,
    reviewedAt: row.reviewed_at ? timestamp(row.reviewed_at) : null,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) };
}
const after = (left: unknown, right: unknown) => new Date(timestamp(left)).getTime() > new Date(timestamp(right)).getTime();
function rowRun(row: any) {
  const definition = db.prepare('SELECT published_version_id,current_version_id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(row.journey_definition_id, row.space_id) as { published_version_id?: string | null; current_version_id?: string | null } | undefined;
  const selectedVersionId = definition?.published_version_id || definition?.current_version_id || null;
  const latestObservedAt = (db.prepare(`SELECT MAX(event_occurred_at) latest FROM journey_anonymous_stage_visits
    WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=?`).get(row.space_id, row.journey_definition_id,
      row.journey_map_version_id) as { latest?: string | null } | undefined)?.latest || null;
  const latestCorrectionAt = (db.prepare(`SELECT MAX(completed_at) latest FROM journey_stage_reprojection_runs
    WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=? AND state='completed'`).get(row.space_id,
      row.journey_definition_id, row.journey_map_version_id) as { latest?: string | null } | undefined)?.latest || null;
  const staleReasons = [
    ...(selectedVersionId && selectedVersionId !== row.journey_map_version_id ? ['design_version_changed'] : []),
    ...(latestObservedAt && after(latestObservedAt, row.as_of) ? ['newer_observed_visit'] : []),
    ...(latestCorrectionAt && after(latestCorrectionAt, row.created_at) ? ['newer_completed_reprojection'] : [])
  ];
  return { id: String(row.id), journeyDefinitionId: String(row.journey_definition_id),
    journeyMapVersionId: String(row.journey_map_version_id), subjectScope: row.subject_scope,
    period: { start: timestamp(row.period_start), end: timestamp(row.period_end) }, asOf: timestamp(row.as_of),
    minimumSampleSize: Number(row.minimum_sample_size), secondarySuppressionThreshold: Number(row.secondary_suppression_threshold),
    detectorVersion: String(row.detector_version), contentSha256: String(row.content_sha256),
    result: (typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json) as JourneyPathIntelligenceResult,
    freshness: { status: staleReasons.length ? 'stale' : 'current', staleReasons, latestObservedAt, latestCorrectionAt,
      currentJourneyMapVersionId: selectedVersionId },
    createdByUserId: row.created_by_user_id || null, createdAt: timestamp(row.created_at) };
}
export function calculatePersistableJourneyPathIntelligence(input: {
  spaceId: string; actorUserId: string; journeyDefinitionId: string; subjectScope?: 'anonymous_only' | 'known_profiles';
  from?: string; to?: string; asOf?: string; minimumSampleSize: number; secondarySuppressionThreshold: number;
}) {
  assertRead(input.spaceId, input.actorUserId);
  const start = input.from || '1970-01-01T00:00:00.000Z';
  const end = input.to || '9999-12-31T23:59:59.999Z';
  const asOf = input.asOf || new Date().toISOString();
  const subjectScope = input.subjectScope || 'anonymous_only';
  const actualPaths = readJourneyActualPathAnalytics({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
    from: start, to: end, asOf, subjectKind: subjectScope, minimumCohortSize: input.minimumSampleSize });
  return detectJourneyPathIntelligence({ journeyDefinitionId: input.journeyDefinitionId, subjectScope,
    window: { start, end, asOf }, minimumSampleSize: input.minimumSampleSize,
    secondarySuppressionThreshold: input.secondarySuppressionThreshold, actualPaths });
}

function actualPathCorrectionLineage(input: { spaceId: string; journeyDefinitionId: string; journeyMapVersionId: string;
  windowStart: string; windowEnd: string; asOf: string }): ActualPathCorrectionLineage {
  const row = db.prepare(`SELECT id,source_id,window_start,window_end,completed_at
    FROM journey_stage_reprojection_runs
    WHERE space_id=? AND journey_definition_id=? AND journey_map_version_id=? AND state='completed'
      AND (window_end IS NULL OR window_end>?) AND (window_start IS NULL OR window_start<?)
    ORDER BY completed_at DESC,id DESC LIMIT 1`).get(input.spaceId, input.journeyDefinitionId,
      input.journeyMapVersionId, input.windowStart, input.windowEnd) as any;
  if (!row) return { latestCompletedReprojection: null, projectionFreshness: 'no_completed_reprojection' };
  const completedAt = timestamp(row.completed_at);
  return {
    latestCompletedReprojection: { id: String(row.id), completedAt,
      sourceScopeSha256: crypto.createHash('sha256').update(row.source_id ? String(row.source_id) : 'all_sources').digest('hex'),
      windowStart: row.window_start ? timestamp(row.window_start) : null, windowEnd: row.window_end ? timestamp(row.window_end) : null },
    projectionFreshness: after(completedAt, input.asOf) ? 'corrected_after_window' : 'current_as_of_window'
  };
}

export function readJourneyActualPathComparison(input: {
  spaceId: string; actorUserId: string; journeyDefinitionId: string; subjectScope?: 'anonymous_only' | 'known_profiles';
  baselineFrom: string; baselineTo: string; currentFrom: string; currentTo: string;
  baselineAsOf?: string; currentAsOf?: string; minimumSampleSize: number; secondarySuppressionThreshold: number; limit?: number;
}) {
  assertRead(input.spaceId, input.actorUserId);
  const subjectScope = input.subjectScope || 'anonymous_only';
  const baselineAsOf = input.baselineAsOf || input.baselineTo;
  const currentAsOf = input.currentAsOf || input.currentTo;
  const baseline = readJourneyActualPathAnalytics({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
    from: input.baselineFrom, to: input.baselineTo, asOf: baselineAsOf, subjectKind: subjectScope,
    minimumCohortSize: input.minimumSampleSize });
  const current = readJourneyActualPathAnalytics({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
    from: input.currentFrom, to: input.currentTo, asOf: currentAsOf, subjectKind: subjectScope,
    minimumCohortSize: input.minimumSampleSize });
  const correction = (envelope: typeof current, start: string, end: string, asOf: string) => actualPathCorrectionLineage({
    spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
    journeyMapVersionId: envelope.scope.designVersionId, windowStart: start, windowEnd: end, asOf
  });
  try {
    return compareJourneyActualPaths({ journeyDefinitionId: input.journeyDefinitionId, subjectScope, baseline, current,
      minimumSampleSize: input.minimumSampleSize, secondarySuppressionThreshold: input.secondarySuppressionThreshold,
      limit: input.limit, correctionLineage: {
        baseline: correction(baseline, input.baselineFrom, input.baselineTo, baselineAsOf),
        current: correction(current, input.currentFrom, input.currentTo, currentAsOf)
      } });
  } catch (error) {
    if (error instanceof Error) throw new JourneyPathIntelligenceRepositoryError(error.message, 400,
      'JOURNEY_ACTUAL_PATH_COMPARISON_INVALID');
    throw error;
  }
}
export function createJourneyPathIntelligenceRun(input: Parameters<typeof calculatePersistableJourneyPathIntelligence>[0]) {
  assertManage(input.spaceId, input.actorUserId);
  const result = calculatePersistableJourneyPathIntelligence(input);
  const contentSha256 = journeyPathIntelligenceSha256(result); const resultJson = stableJourneyPathIntelligenceJson(result);
  const existing = db.prepare(`SELECT * FROM journey_path_intelligence_runs WHERE space_id=? AND journey_definition_id=?
    AND journey_map_version_id=? AND subject_scope=? AND period_start=? AND period_end=? AND as_of=?
    AND minimum_sample_size=? AND secondary_suppression_threshold=? AND detector_version=? AND content_sha256=?`).get(
      input.spaceId, input.journeyDefinitionId, result.provenance.journeyMapVersionId, result.provenance.subjectScope,
      result.provenance.window.start, result.provenance.window.end, result.provenance.window.asOf,
      input.minimumSampleSize, input.secondarySuppressionThreshold, result.detectorVersion, contentSha256) as any;
  if (existing) return { run: rowRun(existing), recommendations: listRecommendationsUnchecked(input.spaceId, existing.id), replayed: true };
  const runId = crypto.randomUUID(); const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_path_intelligence_runs
      (id,space_id,journey_definition_id,journey_map_version_id,subject_scope,period_start,period_end,as_of,
       minimum_sample_size,secondary_suppression_threshold,detector_version,content_sha256,result_json,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, input.spaceId, input.journeyDefinitionId,
        result.provenance.journeyMapVersionId, result.provenance.subjectScope, result.provenance.window.start,
        result.provenance.window.end, result.provenance.window.asOf, input.minimumSampleSize,
        input.secondarySuppressionThreshold, result.detectorVersion, contentSha256, resultJson, input.actorUserId, now);
    for (const recommendation of result.recommendations) {
      const id = crypto.randomUUID(); const content = JSON.stringify(recommendation);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      db.prepare(`INSERT INTO journey_stage_inference_recommendations
        (id,run_id,space_id,journey_definition_id,journey_map_version_id,recommendation_key,content_json,content_sha256,state,
         revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft',1,?,?)`).run(id, runId, input.spaceId,
          input.journeyDefinitionId, result.provenance.journeyMapVersionId, recommendation.key, content, hash, now, now);
      db.prepare(`INSERT INTO journey_path_intelligence_audit
        (id,space_id,run_id,recommendation_id,actor_user_id,action,to_state,revision,detail_json,created_at)
        VALUES (?,?,?,?,?,'recommendation.created','draft',1,'{}',?)`).run(crypto.randomUUID(), input.spaceId, runId, id, input.actorUserId, now);
    }
  })();
  return { run: rowRun(db.prepare('SELECT * FROM journey_path_intelligence_runs WHERE id=? AND space_id=?').get(runId, input.spaceId)),
    recommendations: listRecommendationsUnchecked(input.spaceId, runId), replayed: false };
}
function listRecommendationsUnchecked(spaceId: string, runId?: string) {
  return (db.prepare(`SELECT * FROM journey_stage_inference_recommendations WHERE space_id=? ${runId ? 'AND run_id=?' : ''}
    ORDER BY created_at DESC,id`).all(...(runId ? [spaceId, runId] : [spaceId])) as any[]).map(rowRecommendation);
}
export function listJourneyPathIntelligenceRuns(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string }) {
  assertRead(input.spaceId, input.actorUserId);
  return (db.prepare(`SELECT * FROM journey_path_intelligence_runs WHERE space_id=? AND journey_definition_id=?
    ORDER BY created_at DESC,id`).all(input.spaceId, input.journeyDefinitionId) as any[]).map(rowRun);
}
export function listJourneyStageInferenceRecommendations(input: { spaceId: string; actorUserId: string; journeyDefinitionId?: string }) {
  assertRead(input.spaceId, input.actorUserId);
  const rows = db.prepare(`SELECT * FROM journey_stage_inference_recommendations WHERE space_id=?
    ${input.journeyDefinitionId ? 'AND journey_definition_id=?' : ''} ORDER BY created_at DESC,id`)
    .all(...(input.journeyDefinitionId ? [input.spaceId, input.journeyDefinitionId] : [input.spaceId])) as any[];
  return rows.map(rowRecommendation);
}
const transitions: Record<string, string[]> = { draft: ['in_review', 'retired'], in_review: ['accepted', 'rejected', 'retired'],
  accepted: ['retired'], rejected: ['retired'], retired: [] };
export function transitionJourneyStageInferenceRecommendation(input: { spaceId: string; actorUserId: string;
  recommendationId: string; expectedRevision: number; state: 'draft' | 'in_review' | 'accepted' | 'rejected' | 'retired'; reason: string }) {
  assertManage(input.spaceId, input.actorUserId);
  const current = db.prepare('SELECT * FROM journey_stage_inference_recommendations WHERE id=? AND space_id=?')
    .get(input.recommendationId, input.spaceId) as any;
  if (!current) throw new JourneyPathIntelligenceRepositoryError('Stage-inference recommendation not found.', 404,
    'JOURNEY_STAGE_INFERENCE_RECOMMENDATION_NOT_FOUND');
  if (Number(current.revision) !== input.expectedRevision) throw new JourneyPathIntelligenceRepositoryError(
    'The recommendation changed before this review.', 409, 'JOURNEY_STAGE_INFERENCE_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: Number(current.revision) });
  if (!transitions[String(current.state)]?.includes(input.state)) throw new JourneyPathIntelligenceRepositoryError(
    'The requested recommendation transition is not allowed.', 409, 'JOURNEY_STAGE_INFERENCE_TRANSITION_INVALID',
    { from: current.state, to: input.state });
  const now = new Date().toISOString();
  const reasonSha256 = crypto.createHash('sha256').update(input.reason).digest('hex');
  db.transaction(() => {
    const changed = db.prepare(`UPDATE journey_stage_inference_recommendations SET state=?,revision=revision+1,
      reviewed_by_user_id=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
        input.state, input.actorUserId, input.reason, now, now, input.recommendationId, input.spaceId, input.expectedRevision);
    if (!changed.changes) throw new JourneyPathIntelligenceRepositoryError('The recommendation changed before this review.', 409,
      'JOURNEY_STAGE_INFERENCE_REVISION_CONFLICT');
    // Audit stores proof of the supplied reason, not the reason text. The
    // review record remains available to authorised readers while the
    // append-only audit stays content-safe for operations and telemetry.
    db.prepare(`INSERT INTO journey_path_intelligence_audit
      (id,space_id,run_id,recommendation_id,actor_user_id,action,from_state,to_state,revision,detail_json,created_at)
      VALUES (?,?,?,?,?,'recommendation.reviewed',?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, current.run_id,
        input.recommendationId, input.actorUserId, current.state, input.state, input.expectedRevision + 1,
        JSON.stringify({ reasonSha256, reasonLength: input.reason.length }), now);
  })();
  return rowRecommendation(db.prepare('SELECT * FROM journey_stage_inference_recommendations WHERE id=? AND space_id=?')
    .get(input.recommendationId, input.spaceId));
}
