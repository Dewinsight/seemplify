import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from './database.js';
import { config } from './config.js';
import { ensureJourneyMetricSchema } from './journeyMetricSchema.js';
import {
  calculateJourneyMetric, type JourneyMetricDefinition, type JourneyMetricSample,
  type JourneyMetricType
} from './journeyMetricCalculations.js';
import {
  calculateJourneyOperationalMeasure, type JourneyOperationalMeasureDefinition,
  type JourneyOperationalObservation, type JourneyOperationalPeriod,
  type JourneyOperationalSourceLineage
} from './journeyOperationalMeasures.js';
import {
  validateJourneyEventProperties, type JourneyEventPropertyDefinition,
  type JourneyEventSchemaVersion
} from './journeyEventControlPlane.js';
import type { JourneyIngestPrincipal } from './journeyEventIngestion.js';
import {
  assertSubscriptionFeature, assertSubscriptionQuota, consumeSubscriptionUsage,
  effectiveSubscriptionForSpace, type SubscriptionFeature
} from './subscriptionEntitlements.js';
import {
  journeyMetricPrivacyDecision, journeyMetricSafeLineage, journeyMetricSafeResult, journeyMetricSentimentLane
} from './journeyMetricPrivacy.js';
import {
  buildJourneyMetricAnalyticsExport, type JourneyMetricAnalyticsExportFormat
} from './journeyMetricAnalyticsExport.js';
import {
  assertJourneyNativeMeasureSupported, completeJourneyNativeMeasureConfiguration, journeyNativeMetricFeature,
  journeyNativeMetricPublic, journeyNativeMetricPublicSourceType, parseJourneyNativeMetricSource,
  type JourneyNativeMetricSource
} from './journeyNativeMetricSources.js';
import {
  authoriseJourneyNativeMetricSource, listJourneyNativeMetricSourceChoices
} from './journeyNativeMetricAdapters.js';

ensureJourneyMetricSchema();

export type JourneyMetricTargetType = 'journey' | 'stage' | 'touchpoint' | 'persona' | 'segment';
export type JourneyMetricSourceKind = 'survey' | 'operational_import';
export type JourneyMetricCalculatorKind = JourneyMetricType | 'operational';

export class JourneyMetricsError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_METRICS_INVALID') {
    super(message);
    this.name = 'JourneyMetricsError';
  }
}

type DefinitionRow = {
  id: string; space_id: string; journey_definition_id: string; target_type: JourneyMetricTargetType;
  target_id: string; name: string; state: 'active' | 'retired'; current_version_id: string | null;
  revision: number | string; idempotency_key: string | null; intent_sha256: string;
  created_by_user_id: string | null; created_at: unknown; updated_at: unknown;
};

type VersionRow = {
  id: string; definition_id: string; space_id: string; version_number: number | string;
  source_kind: JourneyMetricSourceKind; binding_id: string | null; calculator_kind: JourneyMetricCalculatorKind;
  aggregation: string; direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
  window_seconds: number | string; timezone: string; minimum_sample_size: number | string;
  freshness_max_age_seconds: number | string; baseline_value: number | string | null; target_value: number | string | null;
  population_json: unknown; filters_json: unknown; formula_json: unknown; configuration_json: unknown;
  content_sha256: string; idempotency_key: string | null; intent_sha256: string;
  created_by_user_id: string | null; created_at: unknown;
};

type BindingRow = {
  id: string; space_id: string; journey_definition_id: string; target_type: JourneyMetricTargetType;
  target_id: string; stage_id: string | null; touchpoint_id: string | null; persona_id: string | null;
  segment_id: string | null; survey_id: string | null; survey_space_id: string | null;
  collector_id: string | null; collector_survey_id: string | null; question_id: string | null;
  question_survey_id: string | null; source_ref: string; state: 'active' | 'retired';
  revision: number | string; idempotency_key: string | null; intent_sha256: string;
  created_by_user_id: string | null; created_at: unknown; updated_at: unknown;
};

type RunRow = {
  id: string; space_id: string; definition_id: string; definition_version_id: string;
  reason: 'manual' | 'source_created' | 'source_corrected' | 'source_deleted' | 'reconcile' | 'scheduled';
  as_of: unknown; state: 'pending' | 'leased' | 'retryable' | 'completed' | 'failed'; available_at: unknown;
  lease_owner: string | null; lease_token: string | null; lease_generation: number | string;
  lease_expires_at: unknown; attempt_count: number | string; max_attempts: number | string;
  observation_id: string | null; error_code: string | null; idempotency_key: string; intent_sha256: string;
  requested_by_user_id: string | null; created_at: unknown; updated_at: unknown; completed_at: unknown;
};

function nowIso(value?: Date | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new JourneyMetricsError('A valid timestamp is required.', 400, 'JOURNEY_METRIC_TIME_INVALID');
  return date.toISOString();
}

function iso(value: unknown) { return value === null || value === undefined ? null : new Date(String(value)).toISOString(); }
function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value || '')) as T; } catch { return fallback; }
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function stableJson(value: unknown) { return JSON.stringify(stable(value)); }
function sha(value: unknown) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function token(value: string, label: string, maximum = 200) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new JourneyMetricsError(`A valid ${label} is required.`, 400, 'JOURNEY_METRIC_INPUT_INVALID');
  }
  return normalized;
}

function assertMetrics(spaceId: string) { return assertSubscriptionFeature(spaceId, 'journeyMetrics'); }
function hasFeature(spaceId: string, feature: SubscriptionFeature) {
  return Boolean(effectiveSubscriptionForSpace(spaceId).plan.features[feature]);
}
function countActive(spaceId: string, table: string) {
  return Number((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE space_id=? AND state='active'`)
    .get(spaceId) as { count?: number } | undefined)?.count || 0);
}
function audit(spaceId: string, actorUserId: string | null, action: string, targetType: string, targetId: string,
  detail: Record<string, unknown>, at = nowIso()) {
  db.prepare(`INSERT INTO journey_metric_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, targetId, stableJson(detail), at);
}

function idempotentRow<T extends { intent_sha256: string }>(table: string, spaceId: string, key: string, intent: unknown) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE space_id=? AND idempotency_key=?`).get(spaceId, key) as T | undefined;
  if (row && row.intent_sha256 !== sha(intent)) throw new JourneyMetricsError(
    'This idempotency key was already used for a different request.', 409, 'JOURNEY_METRIC_IDEMPOTENCY_CONFLICT');
  return row;
}

function assertJourney(spaceId: string, journeyDefinitionId: string) {
  const row = db.prepare('SELECT id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(journeyDefinitionId, spaceId) as { id?: string } | undefined;
  if (!row?.id) throw new JourneyMetricsError('The journey does not exist in this space.', 404, 'JOURNEY_METRIC_JOURNEY_NOT_FOUND');
}

function validateTarget(spaceId: string, journeyDefinitionId: string, targetType: JourneyMetricTargetType, targetId: string) {
  assertJourney(spaceId, journeyDefinitionId);
  let row: unknown;
  if (targetType === 'journey') row = targetId === journeyDefinitionId ? { id: targetId } : undefined;
  if (targetType === 'stage') row = db.prepare(`SELECT stage.id FROM journey_map_stages stage
    JOIN journey_map_versions version ON version.id=stage.version_id AND version.space_id=stage.space_id
    WHERE stage.id=? AND stage.space_id=? AND version.definition_id=?`).get(targetId, spaceId, journeyDefinitionId);
  if (targetType === 'touchpoint') row = db.prepare(`SELECT card.id FROM journey_map_cards card
    JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
    WHERE card.id=? AND card.space_id=? AND version.definition_id=? AND card.kind='touchpoint'`)
    .get(targetId, spaceId, journeyDefinitionId);
  if (targetType === 'persona') row = db.prepare(`SELECT persona.id FROM journey_personas persona
    JOIN journey_definition_personas link ON link.persona_id=persona.id AND link.space_id=persona.space_id
    WHERE persona.id=? AND persona.space_id=? AND link.definition_id=?`).get(targetId, spaceId, journeyDefinitionId);
  if (targetType === 'segment') row = db.prepare(`SELECT id FROM journey_metric_segments
    WHERE id=? AND space_id=? AND journey_definition_id=? AND state='active'`).get(targetId, spaceId, journeyDefinitionId);
  if (!row) throw new JourneyMetricsError('The metric target is unavailable or belongs to another journey.', 404,
    'JOURNEY_METRIC_TARGET_NOT_FOUND');
}

function targetColumns(type: JourneyMetricTargetType, id: string) {
  return {
    stageId: type === 'stage' ? id : null, touchpointId: type === 'touchpoint' ? id : null,
    personaId: type === 'persona' ? id : null, segmentId: type === 'segment' ? id : null
  };
}

function publicSegment(row: any) {
  return { id: row.id, journeyDefinitionId: row.journey_definition_id, name: row.name, description: row.description,
    rule: parseJson(row.rule_json, {}), state: row.state, revision: Number(row.revision),
    createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export function createJourneyMetricSegment(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string;
  name: string; description?: string; rule?: Record<string, unknown>; idempotencyKey: string; now?: Date | string }) {
  assertMetrics(input.spaceId); assertJourney(input.spaceId, input.journeyDefinitionId);
  const key = token(input.idempotencyKey, 'idempotency key');
  const intent = { journeyDefinitionId: input.journeyDefinitionId, name: token(input.name, 'segment name', 160),
    description: String(input.description || '').trim(), rule: input.rule || {} };
  if (Buffer.byteLength(stableJson(intent.rule)) > 32_768) throw new JourneyMetricsError('Segment rule is too large.', 413, 'JOURNEY_METRIC_SEGMENT_RULE_TOO_LARGE');
  const replay = idempotentRow<any>('journey_metric_segments', input.spaceId, key, intent);
  if (replay) return { segment: publicSegment(replay), replayed: true };
  assertSubscriptionQuota(input.spaceId, 'journeyMetricSegments', countActive(input.spaceId, 'journey_metric_segments'), 1);
  const at = nowIso(input.now); const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_segments
      (id,space_id,journey_definition_id,name,description,rule_json,state,revision,idempotency_key,intent_sha256,
       created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?,?,?,?)`)
      .run(id, input.spaceId, input.journeyDefinitionId, intent.name, intent.description, stableJson(intent.rule), key, sha(intent),
        input.actorUserId, at, at);
    audit(input.spaceId, input.actorUserId, 'segment.created', 'segment', id,
      { journeyDefinitionId: input.journeyDefinitionId }, at);
  })();
  return { segment: publicSegment(db.prepare('SELECT * FROM journey_metric_segments WHERE id=? AND space_id=?')
    .get(id, input.spaceId)), replayed: false };
}

export function updateJourneyMetricSegment(input: { spaceId: string; actorUserId: string; segmentId: string;
  expectedRevision: number; name?: string; description?: string; rule?: Record<string, unknown>;
  state?: 'active' | 'retired'; now?: Date | string }) {
  assertMetrics(input.spaceId);
  const row = db.prepare('SELECT * FROM journey_metric_segments WHERE id=? AND space_id=?')
    .get(input.segmentId, input.spaceId) as any;
  if (!row) throw new JourneyMetricsError('Segment not found.', 404, 'JOURNEY_METRIC_SEGMENT_NOT_FOUND');
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyMetricsError('Segment revision conflict.', 409,
    'JOURNEY_METRIC_REVISION_CONFLICT');
  if (row.state === 'retired' && input.state !== 'retired') assertSubscriptionQuota(input.spaceId, 'journeyMetricSegments',
    countActive(input.spaceId, 'journey_metric_segments'), 1);
  const rule = input.rule === undefined ? parseJson(row.rule_json, {}) : input.rule;
  if (Buffer.byteLength(stableJson(rule)) > 32_768) throw new JourneyMetricsError('Segment rule is too large.', 413,
    'JOURNEY_METRIC_SEGMENT_RULE_TOO_LARGE');
  const at = nowIso(input.now);
  const changed = db.prepare(`UPDATE journey_metric_segments SET name=?,description=?,rule_json=?,state=?,revision=revision+1,updated_at=?
    WHERE id=? AND space_id=? AND revision=?`).run(input.name === undefined ? row.name : token(input.name, 'segment name', 160),
      input.description === undefined ? row.description : String(input.description).trim(), stableJson(rule), input.state || row.state,
      at, input.segmentId, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyMetricsError('Segment revision conflict.', 409, 'JOURNEY_METRIC_REVISION_CONFLICT');
  audit(input.spaceId, input.actorUserId, 'segment.updated', 'segment', input.segmentId,
    { previousRevision: input.expectedRevision }, at);
  return publicSegment(db.prepare('SELECT * FROM journey_metric_segments WHERE id=? AND space_id=?')
    .get(input.segmentId, input.spaceId));
}

export function listJourneyMetricSegments(input: { spaceId: string; journeyDefinitionId?: string; limit?: number; offset?: number }) {
  assertMetrics(input.spaceId);
  const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  const rows = input.journeyDefinitionId
    ? db.prepare(`SELECT * FROM journey_metric_segments WHERE space_id=? AND journey_definition_id=?
      ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(input.spaceId, input.journeyDefinitionId, limit, offset)
    : db.prepare('SELECT * FROM journey_metric_segments WHERE space_id=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?')
      .all(input.spaceId, limit, offset);
  return (rows as any[]).map(publicSegment);
}

function publicBinding(row: BindingRow) {
  const sourceState = row.survey_id ? 'available' : 'deleted';
  return { id: row.id, journeyDefinitionId: row.journey_definition_id, targetType: row.target_type, targetId: row.target_id,
    surveyId: row.survey_id, collectorId: row.collector_id, questionId: row.question_id,
    sourceRef: row.source_ref, sourceState, state: row.state, revision: Number(row.revision),
    createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function validateSurveySource(spaceId: string, surveyId: string, collectorId?: string | null, questionId?: string | null) {
  const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND space_id=?').get(surveyId, spaceId);
  if (!survey) throw new JourneyMetricsError('Survey not found in this space.', 404, 'JOURNEY_METRIC_SURVEY_NOT_FOUND');
  if (collectorId && !db.prepare('SELECT id FROM collectors WHERE id=? AND survey_id=?').get(collectorId, surveyId)) {
    throw new JourneyMetricsError('Collector does not belong to the survey.', 404, 'JOURNEY_METRIC_COLLECTOR_NOT_FOUND');
  }
  if (questionId && !db.prepare('SELECT id FROM questions WHERE id=? AND survey_id=?').get(questionId, surveyId)) {
    throw new JourneyMetricsError('Question does not belong to the survey.', 404, 'JOURNEY_METRIC_QUESTION_NOT_FOUND');
  }
}

export function createJourneyMetricBinding(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string;
  targetType: JourneyMetricTargetType; targetId: string; surveyId: string; collectorId?: string | null;
  questionId?: string | null; idempotencyKey: string; now?: Date | string }) {
  assertMetrics(input.spaceId); validateTarget(input.spaceId, input.journeyDefinitionId, input.targetType, input.targetId);
  validateSurveySource(input.spaceId, input.surveyId, input.collectorId, input.questionId);
  const key = token(input.idempotencyKey, 'idempotency key');
  const intent = { journeyDefinitionId: input.journeyDefinitionId, targetType: input.targetType, targetId: input.targetId,
    surveyId: input.surveyId, collectorId: input.collectorId || null, questionId: input.questionId || null };
  const replay = idempotentRow<BindingRow>('journey_metric_bindings', input.spaceId, key, intent);
  if (replay) return { binding: publicBinding(replay), replayed: true };
  assertSubscriptionQuota(input.spaceId, 'journeyMetricBindings', countActive(input.spaceId, 'journey_metric_bindings'), 1);
  const sourceRef = `survey:${input.surveyId}${input.collectorId ? `/collector:${input.collectorId}` : ''}${input.questionId ? `/question:${input.questionId}` : ''}`;
  const at = nowIso(input.now); const id = crypto.randomUUID(); const target = targetColumns(input.targetType, input.targetId);
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_bindings
      (id,space_id,journey_definition_id,target_type,target_id,stage_id,touchpoint_id,persona_id,segment_id,
       survey_id,survey_space_id,collector_id,collector_survey_id,question_id,question_survey_id,source_ref,state,revision,
       idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?)`).run(id, input.spaceId, input.journeyDefinitionId,
        input.targetType, input.targetId, target.stageId, target.touchpointId, target.personaId, target.segmentId,
        input.surveyId, input.spaceId, input.collectorId || null, input.collectorId ? input.surveyId : null,
        input.questionId || null, input.questionId ? input.surveyId : null, sourceRef, key, sha(intent), input.actorUserId, at, at);
    audit(input.spaceId, input.actorUserId, 'binding.created', 'binding', id,
      { journeyDefinitionId: input.journeyDefinitionId, targetType: input.targetType }, at);
  })();
  return { binding: publicBinding(db.prepare('SELECT * FROM journey_metric_bindings WHERE id=? AND space_id=?')
    .get(id, input.spaceId) as BindingRow), replayed: false };
}

export function updateJourneyMetricBinding(input: { spaceId: string; actorUserId: string; bindingId: string;
  expectedRevision: number; state: 'active' | 'retired'; now?: Date | string }) {
  assertMetrics(input.spaceId);
  const row = db.prepare('SELECT * FROM journey_metric_bindings WHERE id=? AND space_id=?').get(input.bindingId, input.spaceId) as BindingRow | undefined;
  if (!row) throw new JourneyMetricsError('Binding not found.', 404, 'JOURNEY_METRIC_BINDING_NOT_FOUND');
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyMetricsError('Binding revision conflict.', 409, 'JOURNEY_METRIC_REVISION_CONFLICT');
  if (row.state === 'retired' && input.state === 'active') {
    if (!row.survey_id) throw new JourneyMetricsError('A deleted source cannot be reactivated.', 409, 'JOURNEY_METRIC_SOURCE_DELETED');
    assertSubscriptionQuota(input.spaceId, 'journeyMetricBindings', countActive(input.spaceId, 'journey_metric_bindings'), 1);
  }
  const at = nowIso(input.now);
  const changed = db.prepare(`UPDATE journey_metric_bindings SET state=?,revision=revision+1,updated_at=?
    WHERE id=? AND space_id=? AND revision=?`).run(input.state, at, input.bindingId, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyMetricsError('Binding revision conflict.', 409, 'JOURNEY_METRIC_REVISION_CONFLICT');
  audit(input.spaceId, input.actorUserId, 'binding.updated', 'binding', input.bindingId,
    { previousRevision: input.expectedRevision, state: input.state }, at);
  return publicBinding(db.prepare('SELECT * FROM journey_metric_bindings WHERE id=? AND space_id=?')
    .get(input.bindingId, input.spaceId) as BindingRow);
}

export function listJourneyMetricBindings(input: { spaceId: string; journeyDefinitionId?: string; limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  const rows = input.journeyDefinitionId
    ? db.prepare(`SELECT * FROM journey_metric_bindings WHERE space_id=? AND journey_definition_id=?
      ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(input.spaceId, input.journeyDefinitionId, limit, offset)
    : db.prepare('SELECT * FROM journey_metric_bindings WHERE space_id=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?')
      .all(input.spaceId, limit, offset);
  return (rows as BindingRow[]).map(publicBinding);
}

/** Reads the native discriminator out of a stored version without throwing.
 * A read projection must never fail because a historic configuration cannot be
 * re-parsed; it simply reports the version as a plain operational import, which
 * is exactly what the row says. */
export function journeyMetricVersionNativeSource(configurationJson: unknown): JourneyNativeMetricSource | null {
  try {
    return parseJourneyNativeMetricSource(
      parseJson<Record<string, unknown>>(configurationJson, {}).nativeSource);
  } catch { return null; }
}

function publicVersion(row: VersionRow) {
  const native = journeyMetricVersionNativeSource(row.configuration_json);
  return { id: row.id, definitionId: row.definition_id, versionNumber: Number(row.version_number), sourceKind: row.source_kind,
    nativeSource: native ? journeyNativeMetricPublic(native) : null,
    bindingId: row.binding_id, calculatorKind: row.calculator_kind, aggregation: row.aggregation, direction: row.direction,
    windowSeconds: Number(row.window_seconds), timezone: row.timezone, minimumSampleSize: Number(row.minimum_sample_size),
    freshnessMaxAgeSeconds: Number(row.freshness_max_age_seconds),
    baselineValue: row.baseline_value === null ? null : Number(row.baseline_value),
    targetValue: row.target_value === null ? null : Number(row.target_value), population: parseJson(row.population_json, {}),
    filters: parseJson(row.filters_json, {}), formula: parseJson(row.formula_json, {}),
    configuration: parseJson(row.configuration_json, {}), contentSha256: row.content_sha256,
    createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at) };
}
function publicDefinition(row: DefinitionRow, version?: VersionRow | null) {
  return { id: row.id, journeyDefinitionId: row.journey_definition_id, targetType: row.target_type, targetId: row.target_id,
    name: row.name, state: row.state, currentVersionId: row.current_version_id, revision: Number(row.revision),
    currentVersion: version ? publicVersion(version) : null, createdByUserId: row.created_by_user_id,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export type JourneyMetricVersionInput = {
  sourceKind: JourneyMetricSourceKind; bindingId?: string | null; calculatorKind: JourneyMetricCalculatorKind;
  aggregation: string; direction: 'higher_is_better' | 'lower_is_better' | 'neutral'; windowSeconds: number;
  timezone: string; minimumSampleSize: number; freshnessMaxAgeSeconds: number; baselineValue?: number | null;
  targetValue?: number | null; population?: Record<string, unknown>; filters?: Record<string, unknown>;
  formula?: Record<string, unknown>; configuration: Record<string, unknown>;
};

function normalizedVersion(input: JourneyMetricVersionInput, definitionId: string, versionNumber: number) {
  const base = {
    sourceKind: input.sourceKind, bindingId: input.bindingId || null, calculatorKind: input.calculatorKind,
    aggregation: token(input.aggregation, 'aggregation', 80), direction: input.direction,
    windowSeconds: input.windowSeconds, timezone: token(input.timezone, 'timezone', 80),
    minimumSampleSize: input.minimumSampleSize, freshnessMaxAgeSeconds: input.freshnessMaxAgeSeconds,
    baselineValue: input.baselineValue ?? null, targetValue: input.targetValue ?? null,
    population: input.population || {}, filters: input.filters || {}, formula: input.formula || {},
    configuration: input.configuration || {}
  };
  if (!Number.isSafeInteger(base.windowSeconds) || base.windowSeconds < 60 || base.windowSeconds > 315_360_000
    || !Number.isSafeInteger(base.minimumSampleSize) || base.minimumSampleSize < 1
    || !Number.isSafeInteger(base.freshnessMaxAgeSeconds) || base.freshnessMaxAgeSeconds < 1) {
    throw new JourneyMetricsError('Metric window, minimum sample and freshness values are invalid.', 400,
      'JOURNEY_METRIC_DEFINITION_INVALID');
  }
  if (base.sourceKind === 'survey' && (!base.bindingId || !['nps', 'csat', 'ces'].includes(base.calculatorKind))) {
    throw new JourneyMetricsError('Survey metrics require a binding and NPS, CSAT or CES calculator.', 400,
      'JOURNEY_METRIC_DEFINITION_INVALID');
  }
  if (base.sourceKind === 'operational_import' && (base.bindingId || base.calculatorKind !== 'operational')) {
    throw new JourneyMetricsError('Operational metrics cannot use a survey binding.', 400, 'JOURNEY_METRIC_DEFINITION_INVALID');
  }
  const periodEnd = new Date('2026-01-02T00:00:00.000Z');
  const period = { start: new Date(periodEnd.getTime() - base.windowSeconds * 1000).toISOString(),
    end: periodEnd.toISOString(), timezone: base.timezone };
  if (base.sourceKind === 'survey') {
    const raw = base.configuration as Partial<JourneyMetricDefinition>;
    const definition = { ...raw, metricId: definitionId, metricDefinitionVersion: String(versionNumber),
      metricType: base.calculatorKind, label: String(raw.label || definitionId), sourceRefs: ['validated-source'],
      minimumSampleSize: base.minimumSampleSize, freshnessMaxAgeSeconds: base.freshnessMaxAgeSeconds,
      direction: base.direction } as JourneyMetricDefinition;
    calculateJourneyMetric({ definition, period, asOf: period.end, samples: [] });
    base.configuration = definition as unknown as Record<string, unknown>;
  } else {
    const supplied = base.configuration as Record<string, unknown>;
    // A native definition carries a version-pinned discriminator inside this
    // already content-hashed document. Absent means an ordinary governed
    // operational import and nothing below changes; present but malformed
    // throws rather than falling through to the ordinary path, which asserts a
    // different entitlement.
    const native = parseJourneyNativeMetricSource(supplied.nativeSource);
    const raw = (native ? completeJourneyNativeMeasureConfiguration(native, supplied)
      : supplied) as unknown as JourneyOperationalMeasureDefinition;
    const sourceLineages = Array.isArray(raw.sourceLineages) ? raw.sourceLineages : [];
    let definition = { ...raw, measureId: definitionId, definitionVersion: String(versionNumber),
      minimumSampleSize: base.minimumSampleSize, freshnessMaxAgeSeconds: base.freshnessMaxAgeSeconds,
      sourceLineages } as JourneyOperationalMeasureDefinition;
    if (definition.kind === 'sentiment_trend') definition = { ...definition, comparisonPeriod: {
      start: new Date(Date.parse(period.start) - base.windowSeconds * 1000).toISOString(), end: period.start,
      timezone: base.timezone } };
    calculateJourneyOperationalMeasure({ definition, period, asOf: period.end, observations: [] });
    // Final gate: the stored configuration is exactly what the adapter contract
    // allows, and the same assertion runs again at rebuild time.
    if (native) assertJourneyNativeMeasureSupported(native, definition);
    base.configuration = definition as unknown as Record<string, unknown>;
  }
  for (const value of [base.population, base.filters, base.formula, base.configuration]) {
    if (Buffer.byteLength(stableJson(value)) > 131_072) throw new JourneyMetricsError('Metric definition content is too large.', 413,
      'JOURNEY_METRIC_DEFINITION_TOO_LARGE');
  }
  return base;
}

function requireBinding(spaceId: string, bindingId: string, definition: DefinitionRow,
  calculatorKind: Exclude<JourneyMetricCalculatorKind, 'operational'>) {
  const row = db.prepare('SELECT * FROM journey_metric_bindings WHERE id=? AND space_id=?')
    .get(bindingId, spaceId) as BindingRow | undefined;
  if (!row || row.state !== 'active' || row.journey_definition_id !== definition.journey_definition_id
    || row.target_type !== definition.target_type || row.target_id !== definition.target_id) {
    throw new JourneyMetricsError('The survey binding is unavailable or does not match this metric target.', 409,
      'JOURNEY_METRIC_BINDING_MISMATCH');
  }
  if (!row.question_id) throw new JourneyMetricsError('NPS, CSAT and CES definitions require a bound question.', 409,
    'JOURNEY_METRIC_QUESTION_REQUIRED');
  const question = db.prepare('SELECT type FROM questions WHERE id=? AND survey_id=?')
    .get(row.question_id, row.survey_id) as { type?: string } | undefined;
  if (question?.type !== calculatorKind) {
    throw new JourneyMetricsError(`The bound question type must be ${calculatorKind.toUpperCase()} for this calculator.`, 409,
      'JOURNEY_METRIC_QUESTION_TYPE_MISMATCH');
  }
  return row;
}

function insertVersion(input: { spaceId: string; actorUserId: string; definition: DefinitionRow;
  version: JourneyMetricVersionInput; idempotencyKey: string; now?: Date | string }) {
  const latest = db.prepare('SELECT COALESCE(MAX(version_number),0) value FROM journey_metric_definition_versions WHERE definition_id=?')
    .get(input.definition.id) as { value?: number | string } | undefined;
  const versionNumber = Number(latest?.value || 0) + 1;
  const normalized = normalizedVersion(input.version, input.definition.id, versionNumber);
  if (normalized.sourceKind === 'survey') requireBinding(input.spaceId, normalized.bindingId!, input.definition,
    normalized.calculatorKind as Exclude<JourneyMetricCalculatorKind, 'operational'>);
  // Native adapters read this space's own service-recovery and social systems
  // of record and never touch the external event ingest plane, so gating them
  // on `journeyConnected` would make the feature unreachable on the Team plan
  // that already entitles both source systems. The discriminator has already
  // failed closed above if it was present and malformed, so the looser branch
  // can only be reached by a fully validated native configuration.
  if (normalized.sourceKind === 'operational_import') {
    const native = parseJourneyNativeMetricSource((normalized.configuration as Record<string, unknown>).nativeSource);
    if (native) {
      assertSubscriptionFeature(input.spaceId, journeyNativeMetricFeature(native));
      authoriseJourneyNativeMetricSource({ spaceId: input.spaceId,
        journeyDefinitionId: input.definition.journey_definition_id, source: native });
    } else assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  }
  const key = token(input.idempotencyKey, 'idempotency key');
  const intent = { definitionId: input.definition.id, version: normalized };
  const replay = idempotentRow<VersionRow>('journey_metric_definition_versions', input.spaceId, key, intent);
  if (replay) return { version: replay, replayed: true };
  const at = nowIso(input.now); const id = crypto.randomUUID(); const contentSha = sha(normalized);
  db.prepare(`INSERT INTO journey_metric_definition_versions
    (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,window_seconds,
     timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,population_json,filters_json,
     formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.definition.id, input.spaceId, versionNumber,
      normalized.sourceKind, normalized.bindingId, normalized.calculatorKind, normalized.aggregation, normalized.direction,
      normalized.windowSeconds, normalized.timezone, normalized.minimumSampleSize, normalized.freshnessMaxAgeSeconds,
      normalized.baselineValue, normalized.targetValue, stableJson(normalized.population), stableJson(normalized.filters),
      stableJson(normalized.formula), stableJson(normalized.configuration), contentSha, key, sha(intent), input.actorUserId, at);
  db.prepare('UPDATE journey_metric_definitions SET current_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=?')
    .run(id, at, input.definition.id, input.spaceId);
  audit(input.spaceId, input.actorUserId, 'definition.version_created', 'definition_version', id,
    { definitionId: input.definition.id, versionNumber, sourceKind: normalized.sourceKind }, at);
  return { version: db.prepare('SELECT * FROM journey_metric_definition_versions WHERE id=?').get(id) as VersionRow,
    replayed: false };
}

export function createJourneyMetricDefinition(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string;
  targetType: JourneyMetricTargetType; targetId: string; name: string; version: JourneyMetricVersionInput;
  idempotencyKey: string; versionIdempotencyKey: string; now?: Date | string }) {
  assertMetrics(input.spaceId); validateTarget(input.spaceId, input.journeyDefinitionId, input.targetType, input.targetId);
  const key = token(input.idempotencyKey, 'idempotency key');
  const intent = { journeyDefinitionId: input.journeyDefinitionId, targetType: input.targetType,
    targetId: input.targetId, name: token(input.name, 'metric name', 160) };
  const existing = idempotentRow<DefinitionRow>('journey_metric_definitions', input.spaceId, key, intent);
  if (existing) {
    const version = existing.current_version_id ? db.prepare('SELECT * FROM journey_metric_definition_versions WHERE id=? AND space_id=?')
      .get(existing.current_version_id, input.spaceId) as VersionRow : null;
    return { definition: publicDefinition(existing, version), replayed: true };
  }
  assertSubscriptionQuota(input.spaceId, 'journeyMetricDefinitions', countActive(input.spaceId, 'journey_metric_definitions'), 1);
  const at = nowIso(input.now); const id = crypto.randomUUID();
  return db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,stage_id,touchpoint_id,persona_id,segment_id,name,state,
       current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',NULL,1,?,?,?,?,?)`)
      .run(id, input.spaceId, input.journeyDefinitionId, input.targetType, input.targetId,
        targetColumns(input.targetType, input.targetId).stageId, targetColumns(input.targetType, input.targetId).touchpointId,
        targetColumns(input.targetType, input.targetId).personaId, targetColumns(input.targetType, input.targetId).segmentId,
        intent.name, key, sha(intent), input.actorUserId, at, at);
    const row = db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?').get(id, input.spaceId) as DefinitionRow;
    const version = insertVersion({ spaceId: input.spaceId, actorUserId: input.actorUserId, definition: row,
      version: input.version, idempotencyKey: input.versionIdempotencyKey, now: at }).version;
    audit(input.spaceId, input.actorUserId, 'definition.created', 'definition', id,
      { journeyDefinitionId: input.journeyDefinitionId, targetType: input.targetType }, at);
    return { definition: publicDefinition(db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?')
      .get(id, input.spaceId) as DefinitionRow, version), replayed: false };
  })();
}

export function createJourneyMetricDefinitionVersion(input: { spaceId: string; actorUserId: string; definitionId: string;
  expectedRevision: number; version: JourneyMetricVersionInput; idempotencyKey: string; now?: Date | string }) {
  assertMetrics(input.spaceId);
  return db.transaction(() => {
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const definition = db.prepare(`SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?${suffix}`)
      .get(input.definitionId, input.spaceId) as DefinitionRow | undefined;
    if (!definition) throw new JourneyMetricsError('Metric definition not found.', 404, 'JOURNEY_METRIC_DEFINITION_NOT_FOUND');
    if (definition.state !== 'active') throw new JourneyMetricsError('Retired definitions cannot receive new versions.', 409,
      'JOURNEY_METRIC_DEFINITION_RETIRED');
    if (Number(definition.revision) !== input.expectedRevision) throw new JourneyMetricsError('Metric definition revision conflict.', 409,
      'JOURNEY_METRIC_REVISION_CONFLICT');
    const result = insertVersion({ ...input, definition });
    return { version: publicVersion(result.version), replayed: result.replayed };
  })();
}

export function listJourneyMetricDefinitions(input: { spaceId: string; journeyDefinitionId?: string; limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  const sql = `SELECT definition.*,version.id version_id,version.definition_id version_definition_id,
    version.space_id version_space_id,version.version_number,version.source_kind,version.binding_id,version.calculator_kind,
    version.aggregation,version.direction,version.window_seconds,version.timezone,version.minimum_sample_size,
    version.freshness_max_age_seconds,version.baseline_value,version.target_value,version.population_json,version.filters_json,
    version.formula_json,version.configuration_json,version.content_sha256,version.created_at version_created_at,
    version.created_by_user_id version_created_by_user_id
    FROM journey_metric_definitions definition LEFT JOIN journey_metric_definition_versions version
      ON version.id=definition.current_version_id AND version.definition_id=definition.id AND version.space_id=definition.space_id`;
  const rows = input.journeyDefinitionId
    ? db.prepare(`${sql} WHERE definition.space_id=? AND definition.journey_definition_id=? ORDER BY definition.updated_at DESC,definition.id LIMIT ? OFFSET ?`)
      .all(input.spaceId, input.journeyDefinitionId, limit, offset)
    : db.prepare(`${sql} WHERE definition.space_id=? ORDER BY definition.updated_at DESC,definition.id LIMIT ? OFFSET ?`)
      .all(input.spaceId, limit, offset);
  return (rows as any[]).map((row) => publicDefinition(row, row.version_id ? {
    ...row, id: row.version_id, definition_id: row.version_definition_id, space_id: row.version_space_id,
    created_at: row.version_created_at, created_by_user_id: row.version_created_by_user_id
  } as VersionRow : null));
}

export function getJourneyMetricDefinition(input: { spaceId: string; definitionId: string }) {
  assertMetrics(input.spaceId);
  const definition = db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?')
    .get(input.definitionId, input.spaceId) as DefinitionRow | undefined;
  if (!definition) throw new JourneyMetricsError('Metric definition not found.', 404, 'JOURNEY_METRIC_DEFINITION_NOT_FOUND');
  const versions = db.prepare(`SELECT * FROM journey_metric_definition_versions WHERE definition_id=? AND space_id=?
    ORDER BY version_number DESC,id`).all(definition.id, input.spaceId) as VersionRow[];
  return { definition: publicDefinition(definition, versions.find((row) => row.id === definition.current_version_id)),
    versions: versions.map(publicVersion) };
}

function runPublic(row: RunRow) {
  return { id: row.id, definitionId: row.definition_id, definitionVersionId: row.definition_version_id,
    reason: row.reason, asOf: iso(row.as_of), state: row.state, availableAt: iso(row.available_at),
    attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), observationId: row.observation_id,
    errorCode: row.error_code, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: iso(row.completed_at) };
}

export function queueJourneyMetricRebuild(input: { spaceId: string; actorUserId?: string | null; definitionId: string;
  reason: RunRow['reason']; asOf?: Date | string; idempotencyKey: string; now?: Date | string; internal?: boolean }) {
  if (!input.internal) assertMetrics(input.spaceId); const key = token(input.idempotencyKey, 'idempotency key');
  const definition = db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?')
    .get(input.definitionId, input.spaceId) as DefinitionRow | undefined;
  if (!definition?.current_version_id) throw new JourneyMetricsError('Metric definition is unavailable.', 404,
    'JOURNEY_METRIC_DEFINITION_NOT_FOUND');
  const asOf = nowIso(input.asOf); const intent = { definitionId: definition.id, definitionVersionId: definition.current_version_id,
    reason: input.reason, asOf };
  const replay = idempotentRow<RunRow>('journey_metric_rebuild_runs', input.spaceId, key, intent);
  if (replay) return { run: runPublic(replay), replayed: true };
  const at = nowIso(input.now); const id = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_metric_rebuild_runs
    (id,space_id,definition_id,definition_version_id,reason,as_of,state,available_at,lease_owner,lease_token,lease_generation,
     lease_expires_at,attempt_count,max_attempts,observation_id,error_code,idempotency_key,intent_sha256,requested_by_user_id,
     created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,'pending',?,NULL,NULL,0,NULL,0,3,NULL,NULL,?,?,?,?,?,NULL)`)
    .run(id, input.spaceId, definition.id, definition.current_version_id, input.reason, asOf, at, key, sha(intent),
      input.actorUserId || null, at, at);
  audit(input.spaceId, input.actorUserId || null, 'rebuild.queued', 'rebuild_run', id,
    { definitionId: definition.id, reason: input.reason }, at);
  return { run: runPublic(db.prepare('SELECT * FROM journey_metric_rebuild_runs WHERE id=? AND space_id=?')
    .get(id, input.spaceId) as RunRow), replayed: false };
}

/** Native ticket definitions carry no binding row, so the survey-hook join
 * above cannot see them. They are matched by their pinned survey scope instead:
 * the LIKE narrows the scan and the parsed configuration is authoritative, so a
 * coincidental substring can never queue the wrong definition. This is what
 * gives native ticket measures their correction- and deletion-driven rebuilds
 * without touching the survey routes. The column is TEXT on SQLite but JSONB on
 * PostgreSQL, which has no `jsonb LIKE text` operator, so the scan narrowing is
 * cast to text explicitly: `CAST(x AS TEXT)` is valid in both dialects, and the
 * canonical JSONB rendering still contains the survey id verbatim. */
function nativeTicketDefinitionsForSurvey(spaceId: string, surveyId: string) {
  const rows = db.prepare(`SELECT definition.id,version.configuration_json FROM journey_metric_definitions definition
    JOIN journey_metric_definition_versions version ON version.id=definition.current_version_id
      AND version.definition_id=definition.id AND version.space_id=definition.space_id
    WHERE definition.space_id=? AND definition.state='active' AND version.source_kind='operational_import'
      AND version.binding_id IS NULL AND CAST(version.configuration_json AS TEXT) LIKE ?`)
    .all(spaceId, `%${surveyId}%`) as Array<{ id: string; configuration_json: unknown }>;
  return rows.filter((row) => {
    const native = journeyMetricVersionNativeSource(row.configuration_json);
    return native?.adapter === 'service_recovery_tickets' && native.sourceIds.includes(surveyId);
  }).map((row) => ({ id: String(row.id) }));
}

export function queueJourneyMetricRebuildsForSurvey(input: { spaceId: string; surveyId: string; reason: RunRow['reason'];
  idempotencyPrefix: string; actorUserId?: string | null; asOf?: Date | string }) {
  const bound = db.prepare(`SELECT DISTINCT definition.id FROM journey_metric_definitions definition
    JOIN journey_metric_definition_versions version ON version.id=definition.current_version_id
    JOIN journey_metric_bindings binding ON binding.id=version.binding_id AND binding.space_id=definition.space_id
    WHERE definition.space_id=? AND binding.survey_id=? AND definition.state='active'`)
    .all(input.spaceId, input.surveyId) as Array<{ id: string }>;
  const native = nativeTicketDefinitionsForSurvey(input.spaceId, input.surveyId);
  const definitions = [...new Map([...bound, ...native].map((row) => [String(row.id), row])).values()];
  return definitions.map((definition) => queueJourneyMetricRebuild({ spaceId: input.spaceId,
    actorUserId: input.actorUserId, definitionId: definition.id, reason: input.reason, asOf: input.asOf,
    idempotencyKey: `${input.idempotencyPrefix}:${definition.id}`, internal: true }));
}

/** Exact authorised native source choices for the owner/admin configuration UI.
 * Reads only identities and display names; no ticket or mention content. */
export function listJourneyMetricNativeSources(input: { spaceId: string }) {
  assertMetrics(input.spaceId);
  const choices = listJourneyNativeMetricSourceChoices(input.spaceId);
  return {
    tickets: hasFeature(input.spaceId, 'serviceRecovery') ? choices.tickets : [],
    social: hasFeature(input.spaceId, 'socialListening') ? choices.social : [],
    ticketsEntitled: hasFeature(input.spaceId, 'serviceRecovery'),
    socialEntitled: hasFeature(input.spaceId, 'socialListening')
  };
}

export function listJourneyMetricRebuilds(input: { spaceId: string; definitionId?: string; journeyDefinitionId?: string;
  limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  const clauses = ['run.space_id=?']; const values: unknown[] = [input.spaceId];
  if (input.definitionId) { clauses.push('run.definition_id=?'); values.push(input.definitionId); }
  if (input.journeyDefinitionId) { clauses.push('definition.journey_definition_id=?'); values.push(input.journeyDefinitionId); }
  values.push(limit, offset);
  const join = input.journeyDefinitionId ? `JOIN journey_metric_definitions definition
    ON definition.id=run.definition_id AND definition.space_id=run.space_id` : '';
  const rows = db.prepare(`SELECT run.* FROM journey_metric_rebuild_runs run ${join}
    WHERE ${clauses.join(' AND ')} ORDER BY run.created_at DESC,run.id LIMIT ? OFFSET ?`).all(...values);
  return (rows as RunRow[]).map(runPublic);
}

function credentialStillActive(principal: JourneyIngestPrincipal, at: string) {
  return Boolean(db.prepare(`SELECT credential.id FROM journey_event_credentials credential
    JOIN journey_event_sources source ON source.id=credential.source_id AND source.space_id=credential.space_id
    WHERE credential.id=? AND credential.space_id=? AND credential.source_id=? AND credential.environment=?
      AND credential.kind='server_secret' AND credential.scope='events:write'
      AND credential.status IN ('active','overlap') AND source.status='active'
      AND (credential.expires_at IS NULL OR credential.expires_at>?)`).get(principal.credentialId, principal.spaceId,
        principal.sourceId, principal.environment, at));
}
function subjectHmac(value: string) {
  let key: Buffer;
  try { key = fs.readFileSync(config.journeyIdentityHashKeyFile); } catch {
    throw new JourneyMetricsError('Journey identity hashing is unavailable.', 503, 'JOURNEY_METRIC_IDENTITY_HASH_UNAVAILABLE');
  }
  if (key.length < 32) throw new JourneyMetricsError('Journey identity hashing is unavailable.', 503,
    'JOURNEY_METRIC_IDENTITY_HASH_UNAVAILABLE');
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export type JourneyOperationalImportInput = {
  definitionId: string; schemaVersionId: string; externalRecordId: string; revision: number;
  operation: 'upsert' | 'delete'; subjectId: string;
  subjectType: 'journey_instance' | 'profile' | 'ticket' | 'social_post' | 'custom'; eventType: string;
  occurredAt: string; stageId?: string | null; sentiment?: 'positive' | 'neutral' | 'negative' | 'unknown' | null;
  sourceLineage: JourneyOperationalSourceLineage; properties: Record<string, unknown>; idempotencyKey: string;
};

export function importJourneyOperationalObservation(input: { principal: JourneyIngestPrincipal; payload: JourneyOperationalImportInput;
  now?: Date | string }) {
  if (input.principal.kind !== 'server_secret') throw new JourneyMetricsError('A server credential is required.', 403,
    'JOURNEY_METRIC_SERVER_CREDENTIAL_REQUIRED');
  const spaceId = input.principal.spaceId; assertMetrics(spaceId); assertSubscriptionFeature(spaceId, 'journeyConnected');
  const at = nowIso(input.now); const payload = input.payload;
  const key = token(payload.idempotencyKey, 'idempotency key');
  const intent = { ...payload, subjectId: sha(payload.subjectId) };
  const replay = idempotentRow<any>('journey_metric_imports', spaceId, key, intent);
  if (replay) return { importId: replay.id, replayed: true,
    rebuild: queueJourneyMetricRebuild({ spaceId, definitionId: replay.definition_id,
      reason: payload.operation === 'delete' ? 'source_deleted' : replay.supersedes_import_id ? 'source_corrected' : 'source_created',
      asOf: iso(replay.created_at)!, idempotencyKey: `metric-import:${replay.id}`, internal: true }) };
  const definition = db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=? AND state=\'active\'')
    .get(payload.definitionId, spaceId) as DefinitionRow | undefined;
  if (!definition?.current_version_id) throw new JourneyMetricsError('Operational metric definition not found.', 404,
    'JOURNEY_METRIC_DEFINITION_NOT_FOUND');
  const version = db.prepare(`SELECT * FROM journey_metric_definition_versions WHERE id=? AND definition_id=? AND space_id=?
    AND source_kind='operational_import' AND calculator_kind='operational'`).get(definition.current_version_id, definition.id, spaceId) as VersionRow | undefined;
  if (!version) throw new JourneyMetricsError('The current metric version does not accept operational imports.', 409,
    'JOURNEY_METRIC_IMPORT_NOT_SUPPORTED');
  // A native definition is fed by the first-party adapter at rebuild time and
  // has no `journey_metric_imports` rows at all. The lineage check below would
  // already reject this, but an explicit code keeps an arbitrary operational
  // import from being reported as though it had been treated as native.
  if (journeyMetricVersionNativeSource(version.configuration_json)) {
    throw new JourneyMetricsError('This metric is fed by a first-party native source adapter and does not accept imports.',
      409, 'JOURNEY_METRIC_NATIVE_IMPORT_NOT_SUPPORTED');
  }
  const schemaRow = db.prepare(`SELECT version.id,version.version,version.properties_json,version.content_sha256,definition.event_name
    FROM journey_event_schema_versions version JOIN journey_event_schemas definition
      ON definition.id=version.schema_id AND definition.space_id=version.space_id AND definition.source_id=version.source_id
    WHERE version.id=? AND version.space_id=? AND version.source_id=? AND version.state='published'`)
    .get(payload.schemaVersionId, spaceId, input.principal.sourceId) as {
      id: string; version: string; properties_json: unknown; content_sha256: string; event_name: string;
    } | undefined;
  if (!schemaRow) throw new JourneyMetricsError('A published schema for this source is required.', 409,
    'JOURNEY_METRIC_SCHEMA_NOT_PUBLISHED');
  const schema: JourneyEventSchemaVersion = { schemaId: schemaRow.id, eventName: schemaRow.event_name,
    version: schemaRow.version, state: 'published',
    properties: parseJson<JourneyEventPropertyDefinition[]>(schemaRow.properties_json, []) };
  const schemaValues = { ...payload.properties, subject_id: payload.subjectId, subject_type: payload.subjectType,
    event_type: payload.eventType, occurred_at: payload.occurredAt, operation: payload.operation, revision: payload.revision,
    ...(payload.stageId ? { stage_id: payload.stageId } : {}), ...(payload.sentiment ? { sentiment: payload.sentiment } : {}) };
  const validation = validateJourneyEventProperties({ schema, properties: schemaValues, mode: 'enforce' });
  if (!validation.accepted) throw new JourneyMetricsError('Operational import does not match the published schema.', 422,
    'JOURNEY_METRIC_SCHEMA_REJECTED');
  const configured = parseJson<JourneyOperationalMeasureDefinition>(version.configuration_json, {} as JourneyOperationalMeasureDefinition);
  const expectedRef = `journey-event:${input.principal.sourceId}:${input.principal.environment}`;
  const authoritativeLineage = configured.sourceLineages?.find((lineage) => lineage.sourceRef === expectedRef
    && lineage.schemaVersion === schemaRow.version);
  if (!authoritativeLineage) {
    throw new JourneyMetricsError('This source and schema are not authorised by the metric definition.', 403,
      'JOURNEY_METRIC_SOURCE_NOT_AUTHORISED');
  }
  if (stableJson(payload.sourceLineage) !== stableJson(authoritativeLineage)) {
    throw new JourneyMetricsError('Import lineage must match the source, schema and projection authorised by the metric definition.',
      422, 'JOURNEY_METRIC_LINEAGE_MISMATCH');
  }
  const occurredAt = nowIso(payload.occurredAt);
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 1) throw new JourneyMetricsError('Import revision must be positive.', 400,
    'JOURNEY_METRIC_IMPORT_REVISION_INVALID');
  const externalHash = sha(token(payload.externalRecordId, 'external record ID', 500));
  const id = crypto.randomUUID();
  const result = db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(spaceId);
    if (!credentialStillActive(input.principal, at)) throw new JourneyMetricsError('The server credential is no longer active.', 401,
      'JOURNEY_METRIC_CREDENTIAL_INVALID');
    // The per-space row lock is the admission mutex for revision ordering as
    // well as metering. Re-read after acquiring it so two application
    // processes cannot both accept the same external revision.
    const prior = db.prepare(`SELECT * FROM journey_metric_imports
      WHERE space_id=? AND definition_id=? AND source_id=? AND external_record_sha256=?
      ORDER BY revision DESC,id LIMIT 1`).get(spaceId, definition.id, input.principal.sourceId, externalHash) as any;
    if ((prior && payload.revision !== Number(prior.revision) + 1) || (!prior && payload.revision !== 1)) {
      throw new JourneyMetricsError('Import revisions must be consecutive.', 409, 'JOURNEY_METRIC_IMPORT_REVISION_CONFLICT');
    }
    consumeSubscriptionUsage({ spaceId, quota: 'monthlyJourneyMetricImports', idempotencyKey: `metric-import:${key}`,
      intent, sourceType: 'journey_metric_import', sourceId: id, now: at });
    db.prepare(`INSERT INTO journey_metric_imports
      (id,space_id,definition_id,definition_version_id,source_id,environment,schema_version_id,external_record_sha256,
       revision,operation,subject_id_hmac,subject_type,event_type,occurred_at,stage_id,sentiment,invalid_reason,
       source_lineage_json,schema_content_sha256,supersedes_import_id,idempotency_key,intent_sha256,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, spaceId, definition.id, version.id,
        input.principal.sourceId, input.principal.environment, schemaRow.id, externalHash, payload.revision, payload.operation,
        subjectHmac(token(payload.subjectId, 'subject ID', 500)), payload.subjectType, token(payload.eventType, 'event type', 128),
        occurredAt, payload.stageId || null, payload.sentiment || null, payload.operation === 'delete' ? 'SOURCE_DELETED' : null,
         stableJson(authoritativeLineage), schemaRow.content_sha256, prior?.id || null, key, sha(intent), at);
    audit(spaceId, null, payload.operation === 'delete' ? 'import.deleted' : 'import.accepted', 'metric_import', id,
      { definitionId: definition.id, schemaVersionId: schemaRow.id, revision: payload.revision }, at);
    return queueJourneyMetricRebuild({ spaceId, definitionId: definition.id,
      reason: payload.operation === 'delete' ? 'source_deleted' : prior ? 'source_corrected' : 'source_created',
      asOf: at, idempotencyKey: `metric-import:${id}` });
  })();
  return { importId: id, replayed: false, rebuild: result };
}

/** The single projection every observation read passes through. Suppression is
 * recomputed here rather than trusted from the stored row, because observations
 * are append-only and a historic row can never be corrected in place. */
function observationPublic(row: any, version: PrivacyVersionSource) {
  const decision = journeyMetricPrivacyDecision(row, version);
  const suppressed = decision.suppressed;
  return { id: row.id, definitionId: row.definition_id, definitionVersionId: row.definition_version_id,
    revision: Number(row.revision), supersedesObservationId: row.supersedes_observation_id, status: row.status,
    value: suppressed || row.value === null ? null : Number(row.value), unit: row.unit,
    numerator: suppressed || row.numerator === null ? null : Number(row.numerator),
    denominator: suppressed ? null : Number(row.denominator),
    sampleSize: suppressed ? null : Number(row.sample_size),
    period: { start: iso(row.period_start), end: iso(row.period_end), timezone: row.timezone },
    asOf: iso(row.as_of), calculatedAt: iso(row.calculated_at), freshnessStatus: row.freshness_status,
    latestObservedAt: iso(row.latest_observed_at), minimumSampleWarning: Boolean(Number(row.minimum_sample_warning)),
    sourceCount: suppressed ? null : Number(row.source_count),
    result: journeyMetricSafeResult(row.result_json, decision),
    sentiment: journeyMetricSentimentLane(row.result_json, decision),
    privacy: { suppressed, reasonCode: decision.reasonCode, minimumSampleSize: decision.minimumSampleSize,
      privacyVersion: decision.privacyVersion },
    rebuildRunId: row.rebuild_run_id };
}

type PrivacyVersionSource = { minimum_sample_size?: number | string | null; population_json?: unknown;
  filters_json?: unknown } | null | undefined;

/** Observations select their own immutable version, never the definition's
 * current one, so an edited threshold cannot retroactively unsuppress history. */
function observationVersions(spaceId: string, rows: any[]) {
  const ids = [...new Set(rows.map((row) => String(row.definition_version_id)))].filter(Boolean);
  const versions = new Map<string, PrivacyVersionSource>();
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const found = db.prepare(`SELECT id,minimum_sample_size,population_json,filters_json
      FROM journey_metric_definition_versions WHERE space_id=? AND id IN (${batch.map(() => '?').join(',')})`)
      .all(spaceId, ...batch) as any[];
    for (const version of found) versions.set(String(version.id), version);
  }
  return versions;
}

export type JourneyMetricObservationFilters = {
  definitionId?: string; journeyDefinitionId?: string; from?: string; to?: string;
  targetTypes?: readonly JourneyMetricTargetType[]; personaIds?: readonly string[];
  segmentIds?: readonly string[]; channelIds?: readonly string[]; cohortIds?: readonly string[];
};

/** Every facet is resolved against tenant-scoped catalogue rows before it can
 * reach the observation query, so an unknown or foreign identifier fails loudly
 * instead of silently returning an empty result that reads as "no data". */
function resolveFacet(spaceId: string, kind: string, ids: readonly string[], sql: string, extra: unknown[] = []) {
  const unique = [...new Set(ids.map((value) => token(value, `${kind} id`, 128)))].sort();
  if (!unique.length) return [] as Array<{ id: string; name: string }>;
  if (unique.length > 50) throw new JourneyMetricsError(`At most 50 ${kind} filters are supported.`, 400,
    'JOURNEY_METRIC_FILTER_TOO_LARGE');
  const rows = db.prepare(sql.replace('$IN', unique.map(() => '?').join(',')))
    .all(spaceId, ...extra, ...unique) as Array<{ id: string; name: string }>;
  const found = new Set(rows.map((row) => String(row.id)));
  const missing = unique.filter((value) => !found.has(value));
  if (missing.length) throw new JourneyMetricsError(`A selected ${kind} is unavailable in this space.`, 404,
    'JOURNEY_METRIC_FILTER_NOT_FOUND');
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function resolveObservationFilters(spaceId: string, input: JourneyMetricObservationFilters) {
  if (input.cohortIds?.length) {
    // Mirrors the governed saved-view boundary: the metric store has explicit
    // segment identities but no cohort catalogue or cohort-observation lineage,
    // so aliasing a segment to a cohort would assert semantics the data does
    // not carry.
    throw new JourneyMetricsError('Cohort filters require the governed cohort catalogue.', 422,
      'JOURNEY_METRIC_COHORT_UNSUPPORTED');
  }
  const personas = resolveFacet(spaceId, 'persona', input.personaIds || [],
    'SELECT id,name FROM journey_personas WHERE space_id=? AND id IN ($IN)');
  const segments = resolveFacet(spaceId, 'segment', input.segmentIds || [],
    "SELECT id,name FROM journey_metric_segments WHERE space_id=? AND state<>'retired' AND id IN ($IN)");
  const channels = input.channelIds?.length
    ? (assertSubscriptionFeature(spaceId, 'journeyRichCards'), resolveFacet(spaceId, 'channel', input.channelIds,
      "SELECT id,name FROM journey_channels WHERE space_id=? AND status='active' AND id IN ($IN)"))
    : [];
  const targetTypes = [...new Set(input.targetTypes || [])].sort();
  return { personas, segments, channels, targetTypes };
}

export function listJourneyMetricObservations(input: JourneyMetricObservationFilters & { spaceId: string;
  limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  const resolved = resolveObservationFilters(input.spaceId, input);
  const needsDefinition = Boolean(input.journeyDefinitionId) || resolved.targetTypes.length > 0
    || resolved.personas.length > 0 || resolved.segments.length > 0 || resolved.channels.length > 0;
  const clauses = ['observation.space_id=?']; const values: unknown[] = [input.spaceId];
  if (input.definitionId) { clauses.push('observation.definition_id=?'); values.push(input.definitionId); }
  if (input.journeyDefinitionId) { clauses.push('definition.journey_definition_id=?'); values.push(input.journeyDefinitionId); }
  if (input.from) { clauses.push('observation.period_end>=?'); values.push(nowIso(input.from)); }
  if (input.to) { clauses.push('observation.period_start<?'); values.push(nowIso(input.to)); }
  if (resolved.targetTypes.length) {
    clauses.push(`definition.target_type IN (${resolved.targetTypes.map(() => '?').join(',')})`);
    values.push(...resolved.targetTypes);
  }
  if (resolved.personas.length) {
    clauses.push(`definition.persona_id IN (${resolved.personas.map(() => '?').join(',')})`);
    values.push(...resolved.personas.map((row) => row.id));
  }
  if (resolved.segments.length) {
    clauses.push(`definition.segment_id IN (${resolved.segments.map(() => '?').join(',')})`);
    values.push(...resolved.segments.map((row) => row.id));
  }
  if (resolved.channels.length) {
    // A touchpoint card carries up to eight catalogue touchpoints, so a join
    // would fan one observation into several rows and inflate every count in
    // the comparison and its export. The semi-join keeps cardinality exact.
    clauses.push(`EXISTS (SELECT 1 FROM journey_card_touchpoints link
      JOIN journey_touchpoint_versions touchpoint ON touchpoint.id=link.touchpoint_version_id
        AND touchpoint.touchpoint_id=link.touchpoint_id AND touchpoint.space_id=link.space_id
      WHERE link.space_id=definition.space_id AND link.card_id=definition.touchpoint_id
        AND touchpoint.channel_id IN (${resolved.channels.map(() => '?').join(',')}))`);
    values.push(...resolved.channels.map((row) => row.id));
  }
  values.push(limit + 1, offset);
  const join = needsDefinition ? `JOIN journey_metric_definitions definition
    ON definition.id=observation.definition_id AND definition.space_id=observation.space_id` : '';
  const rows = db.prepare(`SELECT observation.* FROM journey_metric_observations observation ${join}
    WHERE ${clauses.join(' AND ')} ORDER BY observation.period_end DESC,observation.revision DESC,observation.id
    LIMIT ? OFFSET ?`).all(...values) as any[];
  const page = rows.slice(0, limit);
  const versions = observationVersions(input.spaceId, page);
  return {
    observations: page.map((row) => observationPublic(row, versions.get(String(row.definition_version_id)))),
    appliedFilters: {
      // The server echoes exactly what it applied. The client renders this,
      // never its own draft, so a filter can never be claimed but unapplied.
      journeyDefinitionId: input.journeyDefinitionId || null, definitionId: input.definitionId || null,
      window: { from: input.from ? nowIso(input.from) : null, to: input.to ? nowIso(input.to) : null },
      targetTypes: resolved.targetTypes, personas: resolved.personas, segments: resolved.segments,
      channels: resolved.channels, cohortsSupported: false,
      selection: 'materialised_authorised_observations' as const,
      limit, offset, truncated: rows.length > limit
    }
  };
}

export function getJourneyMetricObservation(input: { spaceId: string; observationId: string; actorUserId?: string | null;
  includeLineage?: boolean }) {
  assertMetrics(input.spaceId);
  const row = db.prepare('SELECT * FROM journey_metric_observations WHERE id=? AND space_id=?')
    .get(input.observationId, input.spaceId) as any;
  if (!row) throw new JourneyMetricsError('Metric observation not found.', 404, 'JOURNEY_METRIC_OBSERVATION_NOT_FOUND');
  const version = db.prepare(`SELECT id,minimum_sample_size,population_json,filters_json,configuration_json
    FROM journey_metric_definition_versions WHERE id=? AND space_id=?`)
    .get(row.definition_version_id, input.spaceId) as (PrivacyVersionSource & { configuration_json?: unknown });
  const decision = journeyMetricPrivacyDecision(row, version);
  // Storage pins `source_type` to the two values the runtime schema allows, so
  // the public type is derived from the observation's own immutable definition
  // version. Native and external can never mix inside one version, and no read
  // ever describes a native aggregate as an import a caller could go looking
  // for. The derivation runs before suppression, so a suppressed lineage still
  // collapses to distinct types.
  const nativeSourceType = (() => {
    const native = journeyMetricVersionNativeSource(version?.configuration_json);
    return native ? journeyNativeMetricPublicSourceType(native) : null;
  })();
  const lineage = input.includeLineage ? journeyMetricSafeLineage((db.prepare(`SELECT source_type,source_record_id,source_revision_sha256,occurred_at,included,exclusion_code
    FROM journey_metric_observation_sources WHERE observation_id=? AND space_id=? ORDER BY source_type,source_record_id`)
    .all(input.observationId, input.spaceId) as any[]).map((item) => ({
      sourceType: nativeSourceType && item.source_type === 'operational_import' ? nativeSourceType : item.source_type,
      sourceRecordId: item.source_record_id, sourceRevisionSha256: item.source_revision_sha256,
      occurredAt: iso(item.occurred_at), included: Boolean(Number(item.included)), exclusionCode: item.exclusion_code })),
    decision) : undefined;
  audit(input.spaceId, input.actorUserId || null, 'observation.read', 'metric_observation', input.observationId,
    { lineageIncluded: Boolean(input.includeLineage), privacySuppressed: decision.suppressed });
  return { ...observationPublic(row, version), ...(lineage ? { lineage } : {}) };
}

function targetDisplayName(spaceId: string, targetType: JourneyMetricTargetType, targetId: string) {
  const lookup: Record<JourneyMetricTargetType, string> = {
    journey: 'SELECT name value FROM journey_definitions WHERE id=? AND space_id=?',
    stage: 'SELECT name value FROM journey_map_stages WHERE id=? AND space_id=?',
    touchpoint: 'SELECT title value FROM journey_map_cards WHERE id=? AND space_id=?',
    persona: 'SELECT name value FROM journey_personas WHERE id=? AND space_id=?',
    segment: 'SELECT name value FROM journey_metric_segments WHERE id=? AND space_id=?'
  };
  const row = db.prepare(lookup[targetType]).get(targetId, spaceId) as { value?: string } | undefined;
  return row?.value || `${targetType} ${targetId.slice(0, 8)}`;
}

/** Assembles exactly the rows the caller is currently looking at. The filters,
 * window and suppression are applied by `listJourneyMetricObservations`, so the
 * export cannot drift from the projection or widen its scope. */
export function journeyMetricAnalyticsExportData(input: JourneyMetricObservationFilters & { spaceId: string;
  journeyDefinitionId: string; limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); assertJourney(input.spaceId, input.journeyDefinitionId);
  const listed = listJourneyMetricObservations(input);
  const journey = db.prepare('SELECT name FROM journey_definitions WHERE id=? AND space_id=?')
    .get(input.journeyDefinitionId, input.spaceId) as { name?: string } | undefined;
  const definitionIds = [...new Set(listed.observations.map((observation) => observation.definitionId))].sort();
  const definitions = definitionIds.length
    ? (db.prepare(`SELECT definition.id,definition.name,definition.target_type,definition.target_id,
        version.id version_id,version.version_number,version.calculator_kind,version.source_kind,
        version.window_seconds,version.timezone,version.minimum_sample_size,version.content_sha256,
        version.configuration_json
      FROM journey_metric_definitions definition
      LEFT JOIN journey_metric_definition_versions version ON version.id=definition.current_version_id
        AND version.definition_id=definition.id AND version.space_id=definition.space_id
      WHERE definition.space_id=? AND definition.id IN (${definitionIds.map(() => '?').join(',')})
      ORDER BY definition.id`).all(input.spaceId, ...definitionIds) as any[]).map((row) => ({
        id: String(row.id), name: String(row.name), targetType: String(row.target_type),
        targetId: String(row.target_id),
        targetName: targetDisplayName(input.spaceId, row.target_type as JourneyMetricTargetType, String(row.target_id)),
        calculatorKind: String(row.calculator_kind || ''),
        // The exported source kind names the adapter that produced the rows, so
        // a native aggregate is never filed under an import that does not exist.
        sourceKind: (() => {
          const native = journeyMetricVersionNativeSource(row.configuration_json);
          return native ? journeyNativeMetricPublicSourceType(native) : String(row.source_kind || '');
        })(),
        versionNumber: row.version_number === null || row.version_number === undefined ? null : Number(row.version_number),
        windowSeconds: row.window_seconds === null || row.window_seconds === undefined ? null : Number(row.window_seconds),
        timezone: row.timezone === null || row.timezone === undefined ? null : String(row.timezone),
        minimumSampleSize: row.minimum_sample_size === null || row.minimum_sample_size === undefined
          ? null : Number(row.minimum_sample_size),
        contentSha256: row.content_sha256 === null || row.content_sha256 === undefined ? null : String(row.content_sha256)
      }))
    : [];
  return { journeyName: journey?.name || input.journeyDefinitionId, definitions,
    observations: listed.observations, appliedFilters: listed.appliedFilters };
}

/** Rendering precedes accounting so a renderer failure never consumes quota,
 * matching the governed journey map export. Kept as an injectable boundary so
 * the no-charge-on-failure guarantee stays executable in tests. */
export function buildMeteredJourneyMetricAnalyticsExport(input: {
  spaceId: string; actorUserId: string; journeyDefinitionId: string; idempotencyKey: string;
  format: JourneyMetricAnalyticsExportFormat; filters: JourneyMetricObservationFilters;
  limit?: number; offset?: number; now?: Date | string;
}, renderer: typeof buildJourneyMetricAnalyticsExport = buildJourneyMetricAnalyticsExport) {
  assertMetrics(input.spaceId); assertSubscriptionFeature(input.spaceId, 'journeyExports');
  const at = nowIso(input.now);
  const data = journeyMetricAnalyticsExportData({ ...input.filters, spaceId: input.spaceId,
    journeyDefinitionId: input.journeyDefinitionId, limit: input.limit, offset: input.offset });
  const artifact = renderer({ journeyDefinitionId: input.journeyDefinitionId, journeyName: data.journeyName,
    definitions: data.definitions, observations: data.observations, appliedFilters: data.appliedFilters,
    format: input.format, generatedAt: at });
  const receipt = consumeSubscriptionUsage({ spaceId: input.spaceId, quota: 'monthlyJourneyExports',
    idempotencyKey: input.idempotencyKey,
    // The intent binds the exact filter scope and window, so reusing a key
    // after changing any facet is a 409 rather than a silently stale download.
    intent: { journeyDefinitionId: input.journeyDefinitionId, format: input.format,
      appliedFilters: data.appliedFilters },
    sourceType: 'journey_metric_analytics_export', sourceId: input.journeyDefinitionId,
    actorUserId: input.actorUserId, now: at });
  // `platform_usage_events` is the audit record for exports: it carries the
  // actor, the space, the distinct source type and the intent hash of the exact
  // filter scope. The journey metric audit table has a CHECK-constrained action
  // set that cannot gain a value inside the pinned runtime schema window, and a
  // second partial record would only invite drift.
  return { artifact, receipt, appliedFilters: data.appliedFilters };
}

export function listJourneyMetricAudit(input: { spaceId: string; limit?: number; offset?: number }) {
  assertMetrics(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50)); const offset = Math.max(0, input.offset || 0);
  return (db.prepare(`SELECT id,actor_user_id,action,target_type,target_id,detail_json,created_at
    FROM journey_metric_audit_events WHERE space_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?`)
    .all(input.spaceId, limit, offset) as any[]).map((row) => ({ id: row.id, actorUserId: row.actor_user_id,
      action: row.action, targetType: row.target_type, targetId: row.target_id,
      detail: parseJson(row.detail_json, {}), createdAt: iso(row.created_at) }));
}

export const journeyMetricInternals = { sha, stableJson, nowIso, publicVersion, runPublic, audit, subjectHmac };
export type { DefinitionRow, VersionRow, BindingRow, RunRow };
