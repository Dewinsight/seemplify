import crypto from 'node:crypto';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import { ensureJourneyMetricAlertSchema } from './journeyMetricAlertSchema.js';
import { JourneyMetricsError, journeyMetricVersionNativeSource } from './journeyMetrics.js';
import { journeyMetricPrivacyFlagged } from './journeyMetricPrivacy.js';
import { assertSubscriptionFeature, assertSubscriptionQuota } from './subscriptionEntitlements.js';

ensureJourneyMetricAlertSchema();

export type JourneyMetricAlertRuleKind = 'falling_metric' | 'stale_source' | 'small_sample' | 'contradictory_evidence';
export type JourneyMetricAlertDirection = 'decrease' | 'increase' | 'any';
export type JourneyMetricAlertState = 'open' | 'acknowledged' | 'snoozed' | 'resolved';

export type JourneyMetricAlertVersionInput = {
  ruleKind: JourneyMetricAlertRuleKind;
  direction: JourneyMetricAlertDirection;
  thresholdValue: number;
  windowSeconds: number;
  cooldownSeconds: number;
  minimumSampleSize: number;
  staleAfterSeconds: number;
  contradictionMinRatio: number;
};

type AlertDefinitionRow = {
  id: string; space_id: string; journey_definition_id: string; metric_definition_id: string; name: string;
  state: 'active' | 'disabled' | 'retired'; current_version_id: string | null; revision: number | string;
  idempotency_key: string | null; intent_sha256: string; created_by_user_id: string | null;
  created_at: unknown; updated_at: unknown;
};
type AlertVersionRow = {
  id: string; definition_id: string; space_id: string; metric_definition_id: string; version_number: number | string;
  rule_kind: JourneyMetricAlertRuleKind; direction: JourneyMetricAlertDirection; threshold_value: number | string;
  window_seconds: number | string; cooldown_seconds: number | string; minimum_sample_size: number | string;
  stale_after_seconds: number | string; contradiction_min_ratio: number | string; content_sha256: string;
  idempotency_key: string | null; intent_sha256: string; created_by_user_id: string | null; created_at: unknown;
};

const ACTIVE_ALERT_STATES = ['open', 'acknowledged', 'snoozed'] as const;
function nowIso(value?: Date | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new JourneyMetricsError('A valid timestamp is required.', 400,
    'JOURNEY_METRIC_ALERT_TIME_INVALID');
  return date.toISOString();
}
function iso(value: unknown) { return value === null || value === undefined ? null : new Date(String(value)).toISOString(); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function stableJson(value: unknown) { return JSON.stringify(stable(value)); }
function sha(value: unknown) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value || '')) as T; } catch { return fallback; }
}
function token(value: string, label: string, maximum = 200) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new JourneyMetricsError(`A valid ${label} is required.`, 400, 'JOURNEY_METRIC_ALERT_INPUT_INVALID');
  }
  return normalized;
}
function assertAlerts(spaceId: string) {
  assertSubscriptionFeature(spaceId, 'journeyMetrics');
  if (/^(0|false|off|disabled)$/iu.test(String(process.env.JOURNEY_METRIC_ALERTS_ENABLED || 'true').trim())) {
    throw new JourneyMetricsError('Journey metric alerts are temporarily disabled.', 503,
      'JOURNEY_METRIC_ALERTS_DISABLED');
  }
}
function publicVersion(row: AlertVersionRow | null | undefined) {
  return row ? { id: row.id, definitionId: row.definition_id, metricDefinitionId: row.metric_definition_id,
    versionNumber: Number(row.version_number), ruleKind: row.rule_kind, direction: row.direction,
    thresholdValue: Number(row.threshold_value), windowSeconds: Number(row.window_seconds),
    cooldownSeconds: Number(row.cooldown_seconds), minimumSampleSize: Number(row.minimum_sample_size),
    staleAfterSeconds: Number(row.stale_after_seconds), contradictionMinRatio: Number(row.contradiction_min_ratio),
    contentSha256: row.content_sha256, createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at) } : null;
}
function publicDefinition(row: AlertDefinitionRow, version?: AlertVersionRow | null) {
  return { id: row.id, journeyDefinitionId: row.journey_definition_id, metricDefinitionId: row.metric_definition_id,
    name: row.name, state: row.state, revision: Number(row.revision), currentVersion: publicVersion(version),
    createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function normalizedVersion(input: JourneyMetricAlertVersionInput) {
  const number = (value: number, minimum: number, maximum: number, name: string) => {
    if (!Number.isFinite(value) || value < minimum || value > maximum) throw new JourneyMetricsError(
      `${name} is outside the supported bounds.`, 400, 'JOURNEY_METRIC_ALERT_INPUT_INVALID');
    return value;
  };
  const integer = (value: number, minimum: number, maximum: number, name: string) => {
    number(value, minimum, maximum, name);
    if (!Number.isSafeInteger(value)) throw new JourneyMetricsError(`${name} must be a whole number.`, 400,
      'JOURNEY_METRIC_ALERT_INPUT_INVALID');
    return value;
  };
  if (!['falling_metric', 'stale_source', 'small_sample', 'contradictory_evidence'].includes(input.ruleKind)) {
    throw new JourneyMetricsError('Alert rule kind is invalid.', 400, 'JOURNEY_METRIC_ALERT_INPUT_INVALID');
  }
  const falling = input.ruleKind === 'falling_metric';
  if ((falling && !['decrease', 'increase'].includes(input.direction)) || (!falling && input.direction !== 'any')) {
    throw new JourneyMetricsError('Alert direction does not match its rule.', 400, 'JOURNEY_METRIC_ALERT_INPUT_INVALID');
  }
  return { ruleKind: input.ruleKind, direction: input.direction,
    thresholdValue: number(input.thresholdValue, falling ? 0.000001 : 0, falling ? 1_000_000_000 : 0, 'Threshold'),
    windowSeconds: integer(input.windowSeconds, 60, 315_360_000, 'Window'),
    cooldownSeconds: integer(input.cooldownSeconds, 60, 315_360_000, 'Cooldown'),
    minimumSampleSize: integer(input.minimumSampleSize, 2, 100_000_000, 'Minimum sample size'),
    staleAfterSeconds: integer(input.staleAfterSeconds, 60, 315_360_000, 'Stale-source age'),
    contradictionMinRatio: number(input.contradictionMinRatio, 0.01, 0.5, 'Contradiction ratio') };
}
function definitionAndVersion(spaceId: string, definitionId: string) {
  const definition = db.prepare('SELECT * FROM journey_metric_alert_definitions WHERE id=? AND space_id=?')
    .get(definitionId, spaceId) as AlertDefinitionRow | undefined;
  if (!definition) throw new JourneyMetricsError('Alert definition not found.', 404,
    'JOURNEY_METRIC_ALERT_DEFINITION_NOT_FOUND');
  const version = definition.current_version_id ? db.prepare(`SELECT * FROM journey_metric_alert_definition_versions
    WHERE id=? AND definition_id=? AND space_id=?`).get(definition.current_version_id, definition.id, spaceId) as AlertVersionRow : null;
  return { definition, version };
}

function insertVersion(input: { spaceId: string; actorUserId: string; definition: AlertDefinitionRow;
  version: JourneyMetricAlertVersionInput; idempotencyKey: string; expectedRevision?: number; at: string;
  versionId?: string; initial?: boolean }) {
  const normalized = normalizedVersion(input.version); const intent = { definitionId: input.definition.id, ...normalized };
  const replay = db.prepare(`SELECT * FROM journey_metric_alert_definition_versions WHERE space_id=? AND idempotency_key=?`)
    .get(input.spaceId, input.idempotencyKey) as AlertVersionRow | undefined;
  if (replay) {
    if (replay.intent_sha256 !== sha(intent)) throw new JourneyMetricsError('This idempotency key has different intent.', 409,
      'JOURNEY_METRIC_ALERT_IDEMPOTENCY_CONFLICT');
    return { version: publicVersion(replay), replayed: true };
  }
  const current = db.prepare('SELECT * FROM journey_metric_alert_definitions WHERE id=? AND space_id=?')
    .get(input.definition.id, input.spaceId) as AlertDefinitionRow;
  if (input.expectedRevision !== undefined && Number(current.revision) !== input.expectedRevision) {
    throw new JourneyMetricsError('Alert definition changed. Refresh before saving.', 409,
      'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
  }
  const versionNumber = Number((db.prepare(`SELECT COALESCE(MAX(version_number),0) maximum
    FROM journey_metric_alert_definition_versions WHERE definition_id=? AND space_id=?`)
    .get(current.id, input.spaceId) as { maximum: number | string }).maximum) + 1;
  const id = input.versionId || crypto.randomUUID(); const contentSha = sha(normalized);
  db.prepare(`INSERT INTO journey_metric_alert_definition_versions
    (id,definition_id,space_id,metric_definition_id,version_number,rule_kind,direction,threshold_value,window_seconds,
     cooldown_seconds,minimum_sample_size,stale_after_seconds,contradiction_min_ratio,content_sha256,idempotency_key,
     intent_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, current.id, input.spaceId, current.metric_definition_id, versionNumber, normalized.ruleKind,
      normalized.direction, normalized.thresholdValue, normalized.windowSeconds, normalized.cooldownSeconds,
      normalized.minimumSampleSize, normalized.staleAfterSeconds, normalized.contradictionMinRatio, contentSha,
      input.idempotencyKey, sha(intent), input.actorUserId, input.at);
  if (!input.initial) db.prepare(`UPDATE journey_metric_alert_definitions SET current_version_id=?,revision=revision+1,updated_at=?
    WHERE id=? AND space_id=?`).run(id, input.at, current.id, input.spaceId);
  return { version: publicVersion(db.prepare('SELECT * FROM journey_metric_alert_definition_versions WHERE id=?')
    .get(id) as AlertVersionRow), replayed: false };
}

export function createJourneyMetricAlertDefinition(input: { spaceId: string; actorUserId: string;
  journeyDefinitionId: string; metricDefinitionId: string; name: string; version: JourneyMetricAlertVersionInput;
  idempotencyKey: string; versionIdempotencyKey: string; now?: Date | string }) {
  assertAlerts(input.spaceId); const key = token(input.idempotencyKey, 'idempotency key');
  const versionKey = token(input.versionIdempotencyKey, 'version idempotency key');
  const name = token(input.name, 'alert name', 160); const normalized = normalizedVersion(input.version);
  const intent = { journeyDefinitionId: input.journeyDefinitionId, metricDefinitionId: input.metricDefinitionId,
    name, version: normalized, versionIdempotencyKey: versionKey };
  const replay = db.prepare('SELECT * FROM journey_metric_alert_definitions WHERE space_id=? AND idempotency_key=?')
    .get(input.spaceId, key) as AlertDefinitionRow | undefined;
  if (replay) {
    if (replay.intent_sha256 !== sha(intent)) throw new JourneyMetricsError('This idempotency key has different intent.', 409,
      'JOURNEY_METRIC_ALERT_IDEMPOTENCY_CONFLICT');
    return { definition: publicDefinition(replay, definitionAndVersion(input.spaceId, replay.id).version), replayed: true };
  }
  const metric = db.prepare(`SELECT id,journey_definition_id FROM journey_metric_definitions
    WHERE id=? AND space_id=? AND state='active'`).get(input.metricDefinitionId, input.spaceId) as
    { id: string; journey_definition_id: string } | undefined;
  if (!metric || metric.journey_definition_id !== input.journeyDefinitionId) throw new JourneyMetricsError(
    'Metric definition is unavailable for this journey.', 404, 'JOURNEY_METRIC_ALERT_METRIC_NOT_FOUND');
  assertSubscriptionQuota(input.spaceId, 'journeyMetricAlertDefinitions', Number((db.prepare(`SELECT COUNT(*) count
    FROM journey_metric_alert_definitions WHERE space_id=? AND state<>'retired'`).get(input.spaceId) as { count: number }).count), 1);
  const at = nowIso(input.now); const id = crypto.randomUUID(); const versionId = crypto.randomUUID();
  return db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    db.prepare(`INSERT INTO journey_metric_alert_definitions
      (id,space_id,journey_definition_id,metric_definition_id,name,state,current_version_id,revision,idempotency_key,
       intent_sha256,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,1,?,?,?,?,?)`)
      .run(id, input.spaceId, input.journeyDefinitionId, input.metricDefinitionId, name, versionId, key, sha(intent),
        input.actorUserId, at, at);
    const row = db.prepare('SELECT * FROM journey_metric_alert_definitions WHERE id=? AND space_id=?')
      .get(id, input.spaceId) as AlertDefinitionRow;
    insertVersion({ spaceId: input.spaceId, actorUserId: input.actorUserId, definition: row,
      version: normalized, idempotencyKey: versionKey, versionId, initial: true, at });
    const current = definitionAndVersion(input.spaceId, id);
    return { definition: publicDefinition(current.definition, current.version), replayed: false };
  })();
}

export function createJourneyMetricAlertDefinitionVersion(input: { spaceId: string; actorUserId: string;
  definitionId: string; expectedRevision: number; version: JourneyMetricAlertVersionInput;
  idempotencyKey: string; now?: Date | string }) {
  assertAlerts(input.spaceId); const definition = definitionAndVersion(input.spaceId, input.definitionId).definition;
  if (definition.state === 'retired') throw new JourneyMetricsError('A retired alert definition cannot be edited.', 409,
    'JOURNEY_METRIC_ALERT_RETIRED');
  return db.transaction(() => insertVersion({ spaceId: input.spaceId, actorUserId: input.actorUserId, definition,
    expectedRevision: input.expectedRevision, version: input.version,
    idempotencyKey: token(input.idempotencyKey, 'idempotency key'), at: nowIso(input.now) }))();
}

export function updateJourneyMetricAlertDefinition(input: { spaceId: string; actorUserId: string; definitionId: string;
  expectedRevision: number; name?: string; state?: 'active' | 'disabled' | 'retired'; now?: Date | string }) {
  assertAlerts(input.spaceId); const { definition } = definitionAndVersion(input.spaceId, input.definitionId);
  if (Number(definition.revision) !== input.expectedRevision) throw new JourneyMetricsError(
    'Alert definition changed. Refresh before saving.', 409, 'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
  if (definition.state === 'retired' && input.state !== 'retired') assertSubscriptionQuota(input.spaceId,
    'journeyMetricAlertDefinitions', Number((db.prepare(`SELECT COUNT(*) count FROM journey_metric_alert_definitions
      WHERE space_id=? AND state<>'retired'`).get(input.spaceId) as { count: number }).count), 1);
  const at = nowIso(input.now); const name = input.name === undefined ? definition.name : token(input.name, 'alert name', 160);
  const state = input.state || definition.state;
  const changed = db.prepare(`UPDATE journey_metric_alert_definitions SET name=?,state=?,revision=revision+1,updated_at=?
    WHERE id=? AND space_id=? AND revision=?`).run(name, state, at, definition.id, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyMetricsError('Alert definition changed. Refresh before saving.', 409,
    'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
  const current = definitionAndVersion(input.spaceId, definition.id);
  return publicDefinition(current.definition, current.version);
}

export function listJourneyMetricAlertDefinitions(input: { spaceId: string; journeyDefinitionId?: string;
  limit?: number; offset?: number }) {
  assertAlerts(input.spaceId); const limit = Math.max(1, Math.min(100, input.limit || 50));
  const offset = Math.max(0, input.offset || 0); const values: unknown[] = [input.spaceId];
  const journey = input.journeyDefinitionId ? ' AND definition.journey_definition_id=?' : '';
  if (input.journeyDefinitionId) values.push(input.journeyDefinitionId); values.push(limit, offset);
  const rows = db.prepare(`SELECT definition.*,version.id version_id,version.definition_id version_definition_id,
    version.metric_definition_id version_metric_definition_id,version.version_number,version.rule_kind,version.direction,
    version.threshold_value,version.window_seconds,version.cooldown_seconds,version.minimum_sample_size,
    version.stale_after_seconds,version.contradiction_min_ratio,version.content_sha256,
    version.created_by_user_id version_created_by_user_id,version.created_at version_created_at
    FROM journey_metric_alert_definitions definition LEFT JOIN journey_metric_alert_definition_versions version
      ON version.id=definition.current_version_id AND version.definition_id=definition.id AND version.space_id=definition.space_id
    WHERE definition.space_id=?${journey} ORDER BY definition.updated_at DESC,definition.id LIMIT ? OFFSET ?`)
    .all(...values) as any[];
  return rows.map((row) => publicDefinition(row, row.version_id ? { ...row, id: row.version_id,
    definition_id: row.version_definition_id, metric_definition_id: row.version_metric_definition_id,
    created_by_user_id: row.version_created_by_user_id, created_at: row.version_created_at } : null));
}

type ObservationRow = any;
type EvaluationDecision = { outcome: 'triggered' | 'warning' | 'cleared' | 'insufficient_data';
  reasonCode: string; severity: 'none' | 'warning' | 'strong'; observedValue: number | null;
  baselineValue: number | null; deltaValue: number | null; sampleSize: number; observationId: string | null;
  metricDefinitionVersionId: string | null; lineage: Record<string, unknown>; };

function privacySuppressed(observation: ObservationRow | undefined) {
  return journeyMetricPrivacyFlagged(observation?.result_json);
}
function observationLineage(observations: ObservationRow[], extra: Record<string, unknown> = {}) {
  return { observationIds: observations.map((row) => row.id), metricDefinitionVersionIds:
    [...new Set(observations.map((row) => row.definition_version_id))], sourceSnapshotSha256:
    observations.map((row) => row.source_snapshot_sha256), sourceCounts: observations.map((row) => Number(row.source_count)), ...extra };
}
const LINEAGE_KEYS = ['observationIds', 'metricDefinitionVersionIds', 'sourceSnapshotSha256', 'sourceCounts',
  'metricSourceKind', 'metricNativeAdapter', 'metricBindingId', 'researchLinkIds', 'researchAssessmentIds',
  'researchSnapshotIds', 'researchSourceIds', 'researchSnapshotFingerprints'] as const;
function allowlistedLineage(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of LINEAGE_KEYS) {
    const item = value[key]; if (item === undefined) continue;
    if (Array.isArray(item)) {
      if (item.length > 100 || item.some((entry) => typeof entry !== 'string' && !Number.isSafeInteger(entry))) {
        throw new JourneyMetricsError('Alert lineage is invalid.', 500, 'JOURNEY_METRIC_ALERT_LINEAGE_INVALID');
      }
      result[key] = item;
    } else if (item === null || typeof item === 'string' || Number.isSafeInteger(item)) result[key] = item;
    else throw new JourneyMetricsError('Alert lineage is invalid.', 500, 'JOURNEY_METRIC_ALERT_LINEAGE_INVALID');
  }
  return result;
}
/** A warning may say that evidence is too thin to support a strong claim; it
 * may not carry the number it is protecting. Both branches below previously
 * published the suppressed observation's value and its exact sample size, so
 * the severity honoured the contract while the payload defeated it. */
function warningForSample(current: ObservationRow | undefined, minimum: number, lineage: Record<string, unknown>): EvaluationDecision | null {
  if (current && privacySuppressed(current)) return { outcome: 'warning', reasonCode: 'PRIVACY_SUPPRESSED_SAMPLE',
    severity: 'warning', observedValue: null, baselineValue: null, deltaValue: null,
    sampleSize: 0, observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage };
  if (!current || Number(current.sample_size || 0) < minimum || Boolean(Number(current.minimum_sample_warning))) {
    return { outcome: 'warning', reasonCode: current ? 'SMALL_SAMPLE_SUPPRESSED_STRONG' : 'SOURCE_OBSERVATION_MISSING',
      severity: 'warning', observedValue: null,
      baselineValue: null, deltaValue: null, sampleSize: 0,
      observationId: current?.id || null, metricDefinitionVersionId: current?.definition_version_id || null, lineage };
  }
  return null;
}
function latestObservations(spaceId: string, metricDefinitionId: string, asOf: string, windowSeconds: number) {
  const from = new Date(Date.parse(asOf) - windowSeconds * 1000).toISOString();
  const rows = db.prepare(`SELECT observation.* FROM journey_metric_observations observation
    JOIN journey_metric_definitions definition ON definition.id=observation.definition_id
      AND definition.space_id=observation.space_id AND definition.current_version_id=observation.definition_version_id
    WHERE observation.space_id=? AND observation.definition_id=? AND observation.status<>'retracted'
      AND observation.period_end>=? AND observation.period_end<=?
    ORDER BY observation.period_end DESC,observation.revision DESC,observation.id LIMIT 20`)
    .all(spaceId, metricDefinitionId, from, asOf) as ObservationRow[];
  const byPeriod = new Map<string, ObservationRow>();
  for (const row of rows) { const key = `${iso(row.period_start)}|${iso(row.period_end)}`; if (!byPeriod.has(key)) byPeriod.set(key, row); }
  return [...byPeriod.values()];
}
function latestObservationAtOrBefore(spaceId: string, metricDefinitionId: string, asOf: string) {
  return db.prepare(`SELECT observation.* FROM journey_metric_observations observation
    JOIN journey_metric_definitions definition ON definition.id=observation.definition_id
      AND definition.space_id=observation.space_id AND definition.current_version_id=observation.definition_version_id
    WHERE observation.space_id=? AND observation.definition_id=? AND observation.status<>'retracted'
      AND observation.period_end<=?
    ORDER BY observation.period_end DESC,observation.revision DESC,observation.id LIMIT 1`)
    .get(spaceId, metricDefinitionId, asOf) as ObservationRow | undefined;
}
function contradictionDecision(input: { spaceId: string; version: AlertVersionRow; current?: ObservationRow;
  observations: ObservationRow[]; asOf: string; metricVersion: any }): EvaluationDecision {
  const current = input.current;
  const from = new Date(Date.parse(input.asOf) - Number(input.version.window_seconds) * 1000).toISOString();
  const metric = db.prepare(`SELECT target_type,target_id FROM journey_metric_definitions
    WHERE id=? AND space_id=?`).get(input.version.metric_definition_id, input.spaceId) as any;
  const researchTarget = metric?.target_type === 'journey' ? 'definition'
    : metric?.target_type === 'touchpoint' ? 'card'
      : ['stage', 'persona'].includes(metric?.target_type) ? metric.target_type : null;
  if (!researchTarget) return { outcome: 'insufficient_data', reasonCode: 'QUALITATIVE_TARGET_UNSUPPORTED',
    severity: 'none', observedValue: null, baselineValue: null, deltaValue: null, sampleSize: 0,
    observationId: current?.id || null, metricDefinitionVersionId: current?.definition_version_id || input.metricVersion?.id || null,
    lineage: observationLineage(input.observations) };
  const assessments = db.prepare(`SELECT assessment.id assessment_id,assessment.relationship,
      link.id link_id,link.snapshot_id,source.id source_id,snapshot.fingerprint
    FROM journey_research_links link
    JOIN journey_research_sources source ON source.id=link.source_id AND source.space_id=link.space_id AND source.state='active'
    JOIN journey_research_snapshots snapshot ON snapshot.id=link.snapshot_id AND snapshot.source_id=link.source_id
      AND snapshot.space_id=link.space_id AND snapshot.access_state='available'
    JOIN journey_research_assessments assessment ON assessment.link_id=link.id AND assessment.space_id=link.space_id
      AND assessment.revision=(SELECT MAX(latest.revision) FROM journey_research_assessments latest
        WHERE latest.link_id=link.id AND latest.space_id=link.space_id)
    WHERE link.space_id=? AND link.target_type=? AND link.target_id=? AND link.state='active'
      AND assessment.created_at>=? AND assessment.created_at<=?
      AND assessment.classification NOT IN ('stale','invalidated')
      AND assessment.relationship IN ('supports','contradicts')
    ORDER BY link.id,assessment.id`).all(input.spaceId, researchTarget, metric.target_id, from, input.asOf) as any[];
  const supports = assessments.filter((row) => row.relationship === 'supports').length;
  const contradicts = assessments.filter((row) => row.relationship === 'contradicts').length;
  const total = supports + contradicts;
  const lineage = observationLineage(input.observations, {
    researchLinkIds: assessments.map((row) => row.link_id),
    researchAssessmentIds: assessments.map((row) => row.assessment_id),
    researchSnapshotIds: assessments.map((row) => row.snapshot_id),
    researchSourceIds: assessments.map((row) => row.source_id),
    researchSnapshotFingerprints: assessments.map((row) => row.fingerprint)
  });
  if (total < Number(input.version.minimum_sample_size)) return { outcome: 'warning',
    reasonCode: 'SMALL_SAMPLE_SUPPRESSED_STRONG', severity: 'warning', observedValue: null, baselineValue: null,
    deltaValue: null, sampleSize: total, observationId: current?.id || null,
    metricDefinitionVersionId: current?.definition_version_id || input.metricVersion?.id || null, lineage };
  const ratio = Math.min(supports, contradicts) / total;
  return supports > 0 && contradicts > 0 && ratio >= Number(input.version.contradiction_min_ratio)
    ? { outcome: 'triggered', reasonCode: 'CONTRADICTORY_RESEARCH_ASSESSMENTS', severity: 'strong',
      observedValue: ratio, baselineValue: Number(input.version.contradiction_min_ratio),
      deltaValue: ratio - Number(input.version.contradiction_min_ratio), sampleSize: total,
      observationId: current?.id || null,
      metricDefinitionVersionId: current?.definition_version_id || input.metricVersion?.id || null, lineage }
    : { outcome: 'cleared', reasonCode: 'CONTRADICTION_THRESHOLD_NOT_MET', severity: 'none',
      observedValue: ratio, baselineValue: Number(input.version.contradiction_min_ratio),
      deltaValue: ratio - Number(input.version.contradiction_min_ratio), sampleSize: total,
      observationId: current?.id || null,
      metricDefinitionVersionId: current?.definition_version_id || input.metricVersion?.id || null, lineage };
}
function evaluateOne(spaceId: string, version: AlertVersionRow, asOf: string): EvaluationDecision {
  let observations = latestObservations(spaceId, version.metric_definition_id, asOf,
    Number(version.window_seconds));
  if (version.rule_kind === 'stale_source' && !observations[0]) {
    const latest = latestObservationAtOrBefore(spaceId, version.metric_definition_id, asOf);
    if (latest) observations = [latest];
  }
  const current = observations[0];
  const metricVersion = db.prepare(`SELECT version.* FROM journey_metric_definitions definition
    LEFT JOIN journey_metric_definition_versions version ON version.id=definition.current_version_id
      AND version.definition_id=definition.id AND version.space_id=definition.space_id
    WHERE definition.id=? AND definition.space_id=?`).get(version.metric_definition_id, spaceId) as any;
  // `source_kind` stores `operational_import` for a native metric, so the
  // adapter is named alongside it and the alert lineage never implies an
  // import that does not exist.
  const lineage = observationLineage(observations.slice(0, 2), { metricSourceKind: metricVersion?.source_kind || null,
    metricNativeAdapter: journeyMetricVersionNativeSource(metricVersion?.configuration_json)?.adapter || null,
    metricBindingId: metricVersion?.binding_id || null });
  const minimum = Math.max(Number(version.minimum_sample_size), Number(metricVersion?.minimum_sample_size || 0));
  if (version.rule_kind === 'small_sample') {
    // `deltaValue` was `sampleSize - minimum`, which republishes the sample
    // exactly once the threshold is known. Suppressed branches carry neither.
    if (!current || privacySuppressed(current) || Number(current.sample_size || 0) < minimum
      || Boolean(Number(current.minimum_sample_warning))) return { outcome: 'warning',
      reasonCode: privacySuppressed(current) ? 'PRIVACY_SUPPRESSED_SAMPLE' : current ? 'SMALL_SAMPLE_WARNING' : 'SOURCE_OBSERVATION_MISSING',
      severity: 'warning', observedValue: null,
      baselineValue: minimum, deltaValue: null,
      sampleSize: 0, observationId: current?.id || null,
      metricDefinitionVersionId: current?.definition_version_id || metricVersion?.id || null, lineage };
    return { outcome: 'cleared', reasonCode: 'SAMPLE_SIZE_SUFFICIENT', severity: 'none',
      observedValue: current.value === null ? null : Number(current.value), baselineValue: minimum,
      deltaValue: Number(current.sample_size) - minimum, sampleSize: Number(current.sample_size), observationId: current.id,
      metricDefinitionVersionId: current.definition_version_id, lineage };
  }
  if (version.rule_kind === 'contradictory_evidence') return contradictionDecision({ spaceId, version, current,
    observations: observations.slice(0, 2), asOf, metricVersion });
  const sampleWarning = warningForSample(current, minimum, lineage); if (sampleWarning) return sampleWarning;
  if (version.rule_kind === 'stale_source') {
    const latest = Date.parse(String(current.latest_observed_at || current.calculated_at));
    const ageSeconds = Number.isFinite(latest) ? Math.max(0, Math.floor((Date.parse(asOf) - latest) / 1000)) : Number.POSITIVE_INFINITY;
    return ageSeconds > Number(version.stale_after_seconds)
      ? { outcome: 'triggered', reasonCode: 'SOURCE_OBSERVATION_STALE', severity: 'strong', observedValue: ageSeconds,
        baselineValue: Number(version.stale_after_seconds), deltaValue: ageSeconds - Number(version.stale_after_seconds),
        sampleSize: Number(current.sample_size), observationId: current.id,
        metricDefinitionVersionId: current.definition_version_id, lineage }
      : { outcome: 'cleared', reasonCode: 'SOURCE_OBSERVATION_FRESH', severity: 'none', observedValue: ageSeconds,
        baselineValue: Number(version.stale_after_seconds), deltaValue: ageSeconds - Number(version.stale_after_seconds),
        sampleSize: Number(current.sample_size), observationId: current.id,
        metricDefinitionVersionId: current.definition_version_id, lineage };
  }
  const harmfulDirection = metricVersion?.direction === 'higher_is_better' ? 'decrease'
    : metricVersion?.direction === 'lower_is_better' ? 'increase' : null;
  if (!harmfulDirection) return { outcome: 'insufficient_data', reasonCode: 'METRIC_DIRECTION_NOT_ACTIONABLE',
    severity: 'none', observedValue: current.value === null ? null : Number(current.value), baselineValue: null,
    deltaValue: null, sampleSize: Number(current.sample_size), observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage };
  if (version.direction !== harmfulDirection) return { outcome: 'insufficient_data',
    reasonCode: 'ALERT_DIRECTION_CONFLICT', severity: 'none',
    observedValue: current.value === null ? null : Number(current.value), baselineValue: null, deltaValue: null,
    sampleSize: Number(current.sample_size), observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage };
  const previous = observations[1];
  if (!previous) return { outcome: 'insufficient_data', reasonCode: 'BASELINE_OUTSIDE_ALERT_WINDOW', severity: 'none',
    observedValue: current.value === null ? null : Number(current.value), baselineValue: null, deltaValue: null,
    sampleSize: Number(current.sample_size), observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage };
  const previousWarning = warningForSample(previous, minimum, lineage); if (previousWarning) return {
    ...previousWarning, reasonCode: 'BASELINE_SAMPLE_TOO_SMALL' };
  if (current.value === null || previous.value === null) return { outcome: 'insufficient_data',
    reasonCode: 'METRIC_VALUE_UNAVAILABLE', severity: 'none', observedValue: null, baselineValue: null,
    deltaValue: null, sampleSize: Number(current.sample_size), observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage };
  const delta = Number(current.value) - Number(previous.value);
  const thresholdMet = version.direction === 'decrease' ? delta <= -Number(version.threshold_value)
    : delta >= Number(version.threshold_value);
  return thresholdMet ? { outcome: 'triggered', reasonCode: version.direction === 'decrease'
    ? 'METRIC_FELL_BEYOND_THRESHOLD' : 'METRIC_ROSE_BEYOND_THRESHOLD', severity: 'strong',
    observedValue: Number(current.value), baselineValue: Number(previous.value), deltaValue: delta,
    sampleSize: Number(current.sample_size), observationId: current.id,
    metricDefinitionVersionId: current.definition_version_id, lineage }
    : { outcome: 'cleared', reasonCode: 'METRIC_CHANGE_WITHIN_THRESHOLD', severity: 'none',
      observedValue: Number(current.value), baselineValue: Number(previous.value), deltaValue: delta,
      sampleSize: Number(current.sample_size), observationId: current.id,
      metricDefinitionVersionId: current.definition_version_id, lineage };
}

function insertEvent(input: { alertId: string; spaceId: string; runId?: string | null; actorUserId?: string | null;
  action: 'opened' | 'refreshed' | 'acknowledged' | 'snoozed' | 'resolved' | 'auto_resolved'; reasonCode: string;
  from: JourneyMetricAlertState | null; to: JourneyMetricAlertState; detail?: Record<string, unknown>; at: string }) {
  const id = crypto.randomUUID(); db.prepare(`INSERT INTO journey_metric_alert_events
    (id,alert_id,space_id,run_id,actor_user_id,action,reason_code,state_from,state_to,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.alertId, input.spaceId, input.runId || null, input.actorUserId || null,
      input.action, input.reasonCode, input.from, input.to, stableJson(input.detail || {}), input.at); return id;
}
function queueNotification(input: { spaceId: string; alertId: string; alertDefinitionId: string; eventId: string;
  reasonCode: string; cooldownSeconds: number; at: string }) {
  const earliest = new Date(Date.parse(input.at) - input.cooldownSeconds * 1000).toISOString();
  const recipients = db.prepare(`SELECT membership.user_id FROM space_memberships membership
    LEFT JOIN journey_metric_alert_notification_preferences preference
      ON preference.space_id=membership.space_id AND preference.user_id=membership.user_id
    WHERE membership.space_id=? AND membership.role IN ('owner','admin') AND COALESCE(preference.enabled,1)=1
    ORDER BY membership.user_id`).all(input.spaceId) as Array<{ user_id: string }>;
  for (const recipient of recipients) {
    const recent = db.prepare(`SELECT notification.id FROM journey_metric_alert_notifications notification
      JOIN journey_metric_alerts alert ON alert.id=notification.alert_id AND alert.space_id=notification.space_id
      WHERE notification.space_id=? AND notification.user_id=? AND alert.alert_definition_id=?
        AND notification.delivery_status='queued' AND notification.created_at>?
      ORDER BY notification.created_at DESC LIMIT 1`)
      .get(input.spaceId, recipient.user_id, input.alertDefinitionId, earliest);
    const dedupe = sha({ eventId: input.eventId, userId: recipient.user_id, channel: 'in_app' });
    const notificationId = crypto.randomUUID(); const delivery = recent ? 'suppressed' : 'queued';
    db.prepare(`INSERT INTO journey_metric_alert_notifications
      (id,alert_id,space_id,user_id,event_id,channel,delivery_status,reason_code,dedupe_sha256,created_at)
      VALUES (?,?,?,?,?,'in_app',?,?,?,?)`).run(notificationId, input.alertId, input.spaceId, recipient.user_id,
        input.eventId, delivery, recent ? 'ALERT_COOLDOWN_ACTIVE' : input.reasonCode, dedupe, input.at);
    db.prepare(`INSERT INTO journey_metric_alert_notification_states
      (notification_id,space_id,user_id,state,revision,read_at) VALUES (?,?,?,'unread',1,NULL)`)
      .run(notificationId, input.spaceId, recipient.user_id);
  }
}
function autoResolve(alert: any, runId: string, reasonCode: string, at: string) {
  if (alert.state === 'resolved') return false;
  db.prepare(`UPDATE journey_metric_alerts SET state='resolved',snoozed_until=NULL,resolved_at=?,resolved_reason=?,
    last_evaluated_at=?,updated_at=?,revision=revision+1 WHERE id=? AND space_id=? AND state<>'resolved'`)
    .run(at, reasonCode, at, at, alert.id, alert.space_id);
  insertEvent({ alertId: alert.id, spaceId: alert.space_id, runId, action: 'auto_resolved', reasonCode,
    from: alert.state, to: 'resolved', at }); return true;
}
function applyDecision(input: { spaceId: string; journeyDefinitionId: string; runId: string;
  definition: AlertDefinitionRow; version: AlertVersionRow; decision: EvaluationDecision; asOf: string }) {
  const lineage = allowlistedLineage(input.decision.lineage); const lineageSha = sha(lineage);
  const dedupe = sha({ alertDefinitionVersionId: input.version.id,
    metricDefinitionVersionId: input.decision.metricDefinitionVersionId, reasonCode: input.decision.reasonCode,
    lineageSha256: lineageSha });
  db.prepare(`INSERT INTO journey_metric_alert_evaluation_results
    (id,run_id,space_id,alert_definition_id,alert_definition_version_id,metric_definition_id,
     metric_definition_version_id,observation_id,outcome,reason_code,severity,observed_value,baseline_value,delta_value,
     sample_size,lineage_json,lineage_sha256,dedupe_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.runId, input.spaceId, input.definition.id, input.version.id,
      input.definition.metric_definition_id, input.decision.metricDefinitionVersionId, input.decision.observationId,
      input.decision.outcome, input.decision.reasonCode, input.decision.severity, input.decision.observedValue,
      input.decision.baselineValue, input.decision.deltaValue, input.decision.sampleSize,
      stableJson(lineage), lineageSha, dedupe, input.asOf);
  const active = db.prepare(`SELECT * FROM journey_metric_alerts WHERE space_id=? AND alert_definition_id=?
    AND state IN ('open','acknowledged','snoozed') ORDER BY opened_at,id`).all(input.spaceId, input.definition.id) as any[];
  if (!['triggered', 'warning'].includes(input.decision.outcome)) {
    return active.reduce((count, alert) => count + (autoResolve(alert, input.runId, 'CONDITION_CLEARED', input.asOf) ? 1 : 0), 0);
  }
  const existing = active.find((alert) => alert.dedupe_sha256 === dedupe);
  for (const alert of active) if (alert.id !== existing?.id) autoResolve(alert, input.runId, 'SOURCE_LINEAGE_CHANGED', input.asOf);
  if (existing) {
    let nextState = existing.state as JourneyMetricAlertState;
    let snoozedUntil = existing.snoozed_until;
    if (nextState === 'snoozed' && Date.parse(String(snoozedUntil)) <= Date.parse(input.asOf)) {
      nextState = 'open'; snoozedUntil = null;
    }
    db.prepare(`UPDATE journey_metric_alerts SET alert_definition_version_id=?,metric_definition_version_id=?,
      observation_id=?,severity=?,reason_code=?,lineage_json=?,lineage_sha256=?,observed_value=?,baseline_value=?,
      delta_value=?,sample_size=?,state=?,snoozed_until=?,last_evaluated_at=?,updated_at=?,revision=revision+1
      WHERE id=? AND space_id=?`).run(input.version.id, input.decision.metricDefinitionVersionId,
        input.decision.observationId, input.decision.severity, input.decision.reasonCode,
        stableJson(lineage), lineageSha, input.decision.observedValue, input.decision.baselineValue,
        input.decision.deltaValue, input.decision.sampleSize, nextState, snoozedUntil, input.asOf, input.asOf,
        existing.id, input.spaceId);
    insertEvent({ alertId: existing.id, spaceId: input.spaceId, runId: input.runId, action: 'refreshed',
      reasonCode: input.decision.reasonCode, from: existing.state, to: nextState, at: input.asOf }); return 0;
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_metric_alerts
    (id,space_id,journey_definition_id,alert_definition_id,alert_definition_version_id,metric_definition_id,
     metric_definition_version_id,observation_id,severity,reason_code,state,dedupe_sha256,lineage_json,lineage_sha256,
     observed_value,baseline_value,delta_value,sample_size,opened_at,last_evaluated_at,updated_at,
     acknowledged_at,acknowledged_by_user_id,snoozed_until,resolved_at,resolved_reason,revision)
     VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,1)`)
    .run(id, input.spaceId, input.journeyDefinitionId, input.definition.id, input.version.id,
      input.definition.metric_definition_id, input.decision.metricDefinitionVersionId, input.decision.observationId,
      input.decision.severity, input.decision.reasonCode, dedupe, stableJson(lineage), lineageSha,
      input.decision.observedValue, input.decision.baselineValue, input.decision.deltaValue, input.decision.sampleSize,
      input.asOf, input.asOf, input.asOf);
  const eventId = insertEvent({ alertId: id, spaceId: input.spaceId, runId: input.runId, action: 'opened',
    reasonCode: input.decision.reasonCode, from: null, to: 'open', at: input.asOf });
  queueNotification({ spaceId: input.spaceId, alertId: id, alertDefinitionId: input.definition.id, eventId,
    reasonCode: input.decision.reasonCode, cooldownSeconds: Number(input.version.cooldown_seconds), at: input.asOf });
  return 0;
}

function publicRun(row: any) { return { id: row.id, journeyDefinitionId: row.journey_definition_id,
  asOf: iso(row.as_of), state: row.state, evaluatedCount: Number(row.evaluated_count),
  triggeredCount: Number(row.triggered_count), warningCount: Number(row.warning_count),
  resolvedCount: Number(row.resolved_count), errorCode: row.error_code, createdAt: iso(row.created_at),
  completedAt: iso(row.completed_at) }; }
export function evaluateJourneyMetricAlerts(input: { spaceId: string; actorUserId: string; journeyDefinitionId: string;
  asOf?: Date | string; idempotencyKey: string }) {
  assertAlerts(input.spaceId); const key = token(input.idempotencyKey, 'idempotency key'); const asOf = nowIso(input.asOf);
  const intent = { journeyDefinitionId: input.journeyDefinitionId, asOf };
  const existing = db.prepare(`SELECT * FROM journey_metric_alert_evaluation_runs WHERE space_id=? AND idempotency_key=?`)
    .get(input.spaceId, key) as any;
  if (existing) {
    if (existing.intent_sha256 !== sha(intent)) throw new JourneyMetricsError('This idempotency key has different intent.', 409,
      'JOURNEY_METRIC_ALERT_IDEMPOTENCY_CONFLICT');
    return { run: publicRun(existing), replayed: true };
  }
  const execute = () => db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    const replay = db.prepare(`SELECT * FROM journey_metric_alert_evaluation_runs WHERE space_id=? AND idempotency_key=?`)
      .get(input.spaceId, key) as any;
    if (replay) {
      if (replay.intent_sha256 !== sha(intent)) throw new JourneyMetricsError('This idempotency key has different intent.', 409,
        'JOURNEY_METRIC_ALERT_IDEMPOTENCY_CONFLICT');
      return { run: publicRun(replay), replayed: true };
    }
    const journey = db.prepare('SELECT id FROM journey_definitions WHERE id=? AND space_id=?')
      .get(input.journeyDefinitionId, input.spaceId);
    if (!journey) throw new JourneyMetricsError('Journey not found.', 404, 'JOURNEY_METRIC_ALERT_JOURNEY_NOT_FOUND');
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO journey_metric_alert_evaluation_runs
      (id,space_id,journey_definition_id,as_of,state,evaluated_count,triggered_count,warning_count,resolved_count,
       error_code,idempotency_key,intent_sha256,requested_by_user_id,created_at,completed_at)
       VALUES (?,?,?,?,'evaluating',0,0,0,0,NULL,?,?,?,?,NULL)`)
      .run(id, input.spaceId, input.journeyDefinitionId, asOf, key, sha(intent), input.actorUserId, asOf);
    const definitions = db.prepare(`SELECT definition.*,version.id version_id,version.definition_id version_definition_id,
      version.space_id version_space_id,version.metric_definition_id version_metric_definition_id,version.version_number,
      version.rule_kind,version.direction,version.threshold_value,version.window_seconds,version.cooldown_seconds,
      version.minimum_sample_size,version.stale_after_seconds,version.contradiction_min_ratio,version.content_sha256,
      version.idempotency_key version_idempotency_key,version.intent_sha256 version_intent_sha256,
      version.created_by_user_id version_created_by_user_id,version.created_at version_created_at
      FROM journey_metric_alert_definitions definition JOIN journey_metric_alert_definition_versions version
        ON version.id=definition.current_version_id AND version.definition_id=definition.id AND version.space_id=definition.space_id
      WHERE definition.space_id=? AND definition.journey_definition_id=? AND definition.state='active'
      ORDER BY definition.id`).all(input.spaceId, input.journeyDefinitionId) as any[];
    let triggered = 0; let warnings = 0; let resolved = 0;
    for (const row of definitions) {
      const version = { ...row, id: row.version_id, definition_id: row.version_definition_id,
        space_id: row.version_space_id, metric_definition_id: row.version_metric_definition_id,
        idempotency_key: row.version_idempotency_key, intent_sha256: row.version_intent_sha256,
        created_by_user_id: row.version_created_by_user_id, created_at: row.version_created_at } as AlertVersionRow;
      const decision = evaluateOne(input.spaceId, version, asOf);
      if (decision.outcome === 'triggered') triggered += 1; if (decision.outcome === 'warning') warnings += 1;
      resolved += applyDecision({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
        runId: id, definition: row, version, decision, asOf });
    }
    db.prepare(`UPDATE journey_metric_alert_evaluation_runs SET state='completed',evaluated_count=?,triggered_count=?,
      warning_count=?,resolved_count=?,completed_at=? WHERE id=? AND space_id=?`)
      .run(definitions.length, triggered, warnings, resolved, asOf, id, input.spaceId);
    return { run: publicRun(db.prepare('SELECT * FROM journey_metric_alert_evaluation_runs WHERE id=?')
      .get(id)), replayed: false };
  })();
  try { return execute(); } catch (error) {
    if (!isDatabaseConstraintError(error)) throw error;
    const replay = db.prepare(`SELECT * FROM journey_metric_alert_evaluation_runs WHERE space_id=? AND idempotency_key=?`)
      .get(input.spaceId, key) as any;
    if (replay?.intent_sha256 === sha(intent)) return { run: publicRun(replay), replayed: true };
    throw error;
  }
}

/** Alert rows are durable and immutable, so rows written before suppression
 * existed still hold a value and a sample for a suppressed observation. The
 * projection re-applies the decision by reason code on read; the stored row is
 * left intact so the audit trail stays complete. */
const SUPPRESSED_ALERT_REASONS = new Set(['PRIVACY_SUPPRESSED_SAMPLE', 'SMALL_SAMPLE_SUPPRESSED_STRONG',
  'SMALL_SAMPLE_WARNING']);
function publicAlert(row: any) {
  const suppressed = SUPPRESSED_ALERT_REASONS.has(String(row.reason_code));
  return { id: row.id, journeyDefinitionId: row.journey_definition_id,
  alertDefinitionId: row.alert_definition_id, alertDefinitionVersionId: row.alert_definition_version_id,
  metricDefinitionId: row.metric_definition_id, metricDefinitionVersionId: row.metric_definition_version_id,
  observationId: row.observation_id, definitionName: row.definition_name || null, severity: row.severity,
  reasonCode: row.reason_code, state: row.state, lineage: parseJson(row.lineage_json, {}),
  observedValue: suppressed || row.observed_value === null ? null : Number(row.observed_value),
  baselineValue: row.baseline_value === null ? null : Number(row.baseline_value),
  deltaValue: suppressed || row.delta_value === null ? null : Number(row.delta_value),
  sampleSize: suppressed ? null : Number(row.sample_size),
  privacySuppressed: suppressed,
  openedAt: iso(row.opened_at), lastEvaluatedAt: iso(row.last_evaluated_at), updatedAt: iso(row.updated_at),
  acknowledgedAt: iso(row.acknowledged_at), snoozedUntil: iso(row.snoozed_until), resolvedAt: iso(row.resolved_at),
  resolvedReason: row.resolved_reason, revision: Number(row.revision) }; }
export function listJourneyMetricAlerts(input: { spaceId: string; journeyDefinitionId?: string; state?: JourneyMetricAlertState;
  limit?: number; offset?: number }) {
  assertAlerts(input.spaceId); const clauses = ['alert.space_id=?']; const values: unknown[] = [input.spaceId];
  if (input.journeyDefinitionId) { clauses.push('alert.journey_definition_id=?'); values.push(input.journeyDefinitionId); }
  if (input.state) { clauses.push('alert.state=?'); values.push(input.state); }
  values.push(Math.max(1, Math.min(100, input.limit || 50)), Math.max(0, input.offset || 0));
  return (db.prepare(`SELECT alert.*,definition.name definition_name FROM journey_metric_alerts alert
    JOIN journey_metric_alert_definitions definition ON definition.id=alert.alert_definition_id AND definition.space_id=alert.space_id
    WHERE ${clauses.join(' AND ')} ORDER BY alert.updated_at DESC,alert.id LIMIT ? OFFSET ?`).all(...values) as any[])
    .map(publicAlert);
}
export function listJourneyMetricAlertRuns(input: { spaceId: string; journeyDefinitionId?: string; limit?: number; offset?: number }) {
  assertAlerts(input.spaceId); const clauses = ['space_id=?']; const values: unknown[] = [input.spaceId];
  if (input.journeyDefinitionId) { clauses.push('journey_definition_id=?'); values.push(input.journeyDefinitionId); }
  values.push(Math.max(1, Math.min(100, input.limit || 50)), Math.max(0, input.offset || 0));
  return (db.prepare(`SELECT * FROM journey_metric_alert_evaluation_runs WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...values) as any[]).map(publicRun);
}
export function listJourneyMetricAlertHistory(input: { spaceId: string; alertId: string }) {
  assertAlerts(input.spaceId); const alert = db.prepare('SELECT id FROM journey_metric_alerts WHERE id=? AND space_id=?')
    .get(input.alertId, input.spaceId); if (!alert) throw new JourneyMetricsError('Alert not found.', 404,
    'JOURNEY_METRIC_ALERT_NOT_FOUND');
  const events = (db.prepare(`SELECT id,run_id,actor_user_id,action,reason_code,state_from,state_to,detail_json,created_at
    FROM journey_metric_alert_events WHERE alert_id=? AND space_id=? ORDER BY created_at DESC,id`)
    .all(input.alertId, input.spaceId) as any[]).map((row) => ({ id: row.id, runId: row.run_id,
      actorUserId: row.actor_user_id, action: row.action, reasonCode: row.reason_code, from: row.state_from,
      to: row.state_to, detail: parseJson(row.detail_json, {}), createdAt: iso(row.created_at) }));
  const notifications = (db.prepare(`SELECT id,event_id,channel,delivery_status,reason_code,created_at
    FROM journey_metric_alert_notifications WHERE alert_id=? AND space_id=? ORDER BY created_at DESC,id`)
    .all(input.alertId, input.spaceId) as any[]).map((row) => ({ id: row.id, eventId: row.event_id,
      channel: row.channel, status: row.delivery_status, reasonCode: row.reason_code, createdAt: iso(row.created_at) }));
  return { events, notifications };
}
function eligibleAlertRecipient(spaceId: string, userId: string) {
  return Boolean(db.prepare(`SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?
    AND role IN ('owner','admin')`).get(spaceId, userId));
}
export function journeyMetricAlertNotificationPreference(input: { spaceId: string; userId: string }) {
  assertAlerts(input.spaceId); const eligible = eligibleAlertRecipient(input.spaceId, input.userId);
  const row = db.prepare(`SELECT enabled,revision,updated_at FROM journey_metric_alert_notification_preferences
    WHERE space_id=? AND user_id=?`).get(input.spaceId, input.userId) as any;
  return { enabled: eligible && (row ? Boolean(Number(row.enabled)) : true), eligible,
    revision: Number(row?.revision || 0), updatedAt: iso(row?.updated_at) };
}
export function updateJourneyMetricAlertNotificationPreference(input: { spaceId: string; userId: string;
  enabled: boolean; expectedRevision: number; now?: Date | string }) {
  assertAlerts(input.spaceId); if (!eligibleAlertRecipient(input.spaceId, input.userId)) throw new JourneyMetricsError(
    'Only current space owners and administrators can receive metric alerts.', 403,
    'JOURNEY_METRIC_ALERT_NOTIFICATION_FORBIDDEN');
  const at = nowIso(input.now); const current = db.prepare(`SELECT revision FROM journey_metric_alert_notification_preferences
    WHERE space_id=? AND user_id=?`).get(input.spaceId, input.userId) as { revision: number | string } | undefined;
  if (Number(current?.revision || 0) !== input.expectedRevision) throw new JourneyMetricsError(
    'Notification preference changed. Refresh before saving.', 409, 'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
  db.prepare(`INSERT INTO journey_metric_alert_notification_preferences(space_id,user_id,enabled,revision,updated_at)
    VALUES (?,?,?,1,?) ON CONFLICT(space_id,user_id) DO UPDATE SET
      enabled=excluded.enabled,revision=journey_metric_alert_notification_preferences.revision+1,updated_at=excluded.updated_at`)
    .run(input.spaceId, input.userId, input.enabled ? 1 : 0, at);
  return journeyMetricAlertNotificationPreference(input);
}
function notificationPublic(row: any) {
  return { id: row.id, alertId: row.alert_id, definitionName: row.definition_name,
    severity: row.severity, reasonCode: row.reason_code, alertState: row.alert_state,
    state: row.state, revision: Number(row.revision), createdAt: iso(row.created_at), readAt: iso(row.read_at) };
}
export function listJourneyMetricAlertNotifications(input: { spaceId: string; userId: string;
  state?: 'unread' | 'read' | 'dismissed'; limit?: number; offset?: number }) {
  assertAlerts(input.spaceId); if (!eligibleAlertRecipient(input.spaceId, input.userId)) return [];
  const clauses = ["notification.space_id=?", 'notification.user_id=?', "notification.delivery_status='queued'"];
  const values: unknown[] = [input.spaceId, input.userId];
  if (input.state) { clauses.push('state.state=?'); values.push(input.state); }
  values.push(Math.max(1, Math.min(100, input.limit || 50)), Math.max(0, input.offset || 0));
  return (db.prepare(`SELECT notification.id,notification.alert_id,notification.reason_code,notification.created_at,
      state.state,state.revision,state.read_at,alert.severity,alert.state alert_state,definition.name definition_name
    FROM journey_metric_alert_notifications notification
    JOIN journey_metric_alert_notification_states state ON state.notification_id=notification.id
      AND state.space_id=notification.space_id AND state.user_id=notification.user_id
    JOIN journey_metric_alerts alert ON alert.id=notification.alert_id AND alert.space_id=notification.space_id
    JOIN journey_metric_alert_definitions definition ON definition.id=alert.alert_definition_id
      AND definition.space_id=alert.space_id
    WHERE ${clauses.join(' AND ')} ORDER BY notification.created_at DESC,notification.id LIMIT ? OFFSET ?`)
    .all(...values) as any[]).map(notificationPublic);
}
export function updateJourneyMetricAlertNotification(input: { spaceId: string; userId: string; notificationId: string;
  expectedRevision: number; state: 'read' | 'dismissed'; now?: Date | string }) {
  assertAlerts(input.spaceId); if (!eligibleAlertRecipient(input.spaceId, input.userId)) throw new JourneyMetricsError(
    'Alert notification not found.', 404, 'JOURNEY_METRIC_ALERT_NOTIFICATION_NOT_FOUND');
  const at = nowIso(input.now); return db.transaction(() => {
    const current = db.prepare(`SELECT state.* FROM journey_metric_alert_notification_states state
      JOIN journey_metric_alert_notifications notification ON notification.id=state.notification_id
        AND notification.space_id=state.space_id AND notification.user_id=state.user_id
      WHERE state.notification_id=? AND state.space_id=? AND state.user_id=? AND notification.delivery_status='queued'`)
      .get(input.notificationId, input.spaceId, input.userId) as any;
    if (!current) throw new JourneyMetricsError('Alert notification not found.', 404,
      'JOURNEY_METRIC_ALERT_NOTIFICATION_NOT_FOUND');
    if (Number(current.revision) !== input.expectedRevision || current.state !== 'unread') throw new JourneyMetricsError(
      'Alert notification changed. Refresh before updating it.', 409, 'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
    db.prepare(`UPDATE journey_metric_alert_notification_states SET state=?,revision=revision+1,read_at=?
      WHERE notification_id=? AND space_id=? AND user_id=? AND revision=? AND state='unread'`)
      .run(input.state, at, input.notificationId, input.spaceId, input.userId, input.expectedRevision);
    db.prepare(`INSERT INTO journey_metric_alert_notification_state_events
      (id,notification_id,space_id,user_id,state_from,state_to,created_at) VALUES (?,?,?,?,'unread',?,?)`)
      .run(crypto.randomUUID(), input.notificationId, input.spaceId, input.userId, input.state, at);
    const row = db.prepare(`SELECT notification.id,notification.alert_id,notification.reason_code,notification.created_at,
        state.state,state.revision,state.read_at,alert.severity,alert.state alert_state,definition.name definition_name
      FROM journey_metric_alert_notifications notification
      JOIN journey_metric_alert_notification_states state ON state.notification_id=notification.id
        AND state.space_id=notification.space_id AND state.user_id=notification.user_id
      JOIN journey_metric_alerts alert ON alert.id=notification.alert_id AND alert.space_id=notification.space_id
      JOIN journey_metric_alert_definitions definition ON definition.id=alert.alert_definition_id
        AND definition.space_id=alert.space_id
      WHERE notification.id=? AND notification.space_id=? AND notification.user_id=?`)
      .get(input.notificationId, input.spaceId, input.userId);
    return notificationPublic(row);
  })();
}
export function transitionJourneyMetricAlert(input: { spaceId: string; actorUserId: string; alertId: string;
  expectedRevision: number; action: 'acknowledge' | 'snooze' | 'resolve'; snoozedUntil?: string; now?: Date | string }) {
  assertAlerts(input.spaceId); const at = nowIso(input.now);
  return db.transaction(() => {
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const alert = db.prepare(`SELECT * FROM journey_metric_alerts WHERE id=? AND space_id=?${suffix}`)
      .get(input.alertId, input.spaceId) as any;
    if (!alert) throw new JourneyMetricsError('Alert not found.', 404, 'JOURNEY_METRIC_ALERT_NOT_FOUND');
    if (Number(alert.revision) !== input.expectedRevision) throw new JourneyMetricsError(
      'Alert changed. Refresh before updating it.', 409, 'JOURNEY_METRIC_ALERT_REVISION_CONFLICT');
    if (alert.state === 'resolved') throw new JourneyMetricsError('Resolved alerts cannot be changed.', 409,
      'JOURNEY_METRIC_ALERT_ALREADY_RESOLVED');
    let state: JourneyMetricAlertState; let action: 'acknowledged' | 'snoozed' | 'resolved'; let snoozedUntil: string | null = null;
    if (input.action === 'acknowledge') { state = 'acknowledged'; action = 'acknowledged'; }
    else if (input.action === 'resolve') { state = 'resolved'; action = 'resolved'; }
    else {
      state = 'snoozed'; action = 'snoozed'; snoozedUntil = nowIso(input.snoozedUntil);
      const maximum = Date.parse(at) + 315_360_000 * 1000;
      if (Date.parse(snoozedUntil) <= Date.parse(at) || Date.parse(snoozedUntil) > maximum) throw new JourneyMetricsError(
        'Snooze must end in the future and within ten years.', 400, 'JOURNEY_METRIC_ALERT_SNOOZE_INVALID');
    }
    db.prepare(`UPDATE journey_metric_alerts SET state=?,acknowledged_at=?,acknowledged_by_user_id=?,snoozed_until=?,
      resolved_at=?,resolved_reason=?,updated_at=?,revision=revision+1 WHERE id=? AND space_id=? AND revision=?`)
      .run(state, state === 'acknowledged' ? at : alert.acknowledged_at,
        state === 'acknowledged' ? input.actorUserId : alert.acknowledged_by_user_id, snoozedUntil,
        state === 'resolved' ? at : null, state === 'resolved' ? 'MANUALLY_RESOLVED' : null, at,
        input.alertId, input.spaceId, input.expectedRevision);
    insertEvent({ alertId: alert.id, spaceId: input.spaceId, actorUserId: input.actorUserId, action,
      reasonCode: state === 'resolved' ? 'MANUALLY_RESOLVED' : state === 'snoozed' ? 'MANUALLY_SNOOZED' : 'MANUALLY_ACKNOWLEDGED',
      from: alert.state, to: state, detail: snoozedUntil ? { snoozedUntil } : {}, at });
    return publicAlert(db.prepare(`SELECT alert.*,definition.name definition_name FROM journey_metric_alerts alert
      JOIN journey_metric_alert_definitions definition ON definition.id=alert.alert_definition_id AND definition.space_id=alert.space_id
      WHERE alert.id=? AND alert.space_id=?`).get(alert.id, input.spaceId));
  })();
}

export const journeyMetricAlertInternals = { normalizedVersion, evaluateOne, sha, stableJson };
