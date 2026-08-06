import crypto from 'node:crypto';
import { db } from './database.js';
import {
  calculateJourneyMetric, type JourneyMetricDefinition, type JourneyMetricSample
} from './journeyMetricCalculations.js';
import {
  calculateJourneyOperationalMeasure, type JourneyOperationalMeasureDefinition,
  type JourneyOperationalObservation, type JourneyOperationalPeriod, type JourneyOperationalSourceLineage
} from './journeyOperationalMeasures.js';
import {
  JourneyMetricsError, journeyMetricInternals, journeyMetricVersionNativeSource,
  type BindingRow, type DefinitionRow, type RunRow, type VersionRow
} from './journeyMetrics.js';
import { journeyMetricPrivacyDecision } from './journeyMetricPrivacy.js';
import { projectJourneyNativeObservations } from './journeyNativeMetricAdapters.js';
import type { JourneyNativeMetricSource } from './journeyNativeMetricSources.js';

type ClaimedRun = RunRow & { lease_token: string; lease_owner: string };
type SourceProjection = {
  sourceType: 'survey_response' | 'operational_import'; sourceRecordId: string;
  sourceRevisionSha256: string; occurredAt: string; included: boolean; exclusionCode: string | null;
};
type Projection = {
  status: 'available' | 'unavailable' | 'retracted'; value: number | null; unit: string;
  numerator: number | null; denominator: number; sampleSize: number;
  freshnessStatus: 'fresh' | 'stale' | 'unavailable'; latestObservedAt: string | null;
  minimumSampleWarning: boolean; result: Record<string, unknown>; sources: SourceProjection[];
};

const { sha, stableJson, nowIso, audit, subjectHmac } = journeyMetricInternals;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value || '')) as T; } catch { return fallback; }
}
function iso(value: unknown) { return new Date(String(value)).toISOString(); }
function plusMs(value: string, milliseconds: number) { return new Date(Date.parse(value) + milliseconds).toISOString(); }
function periodFor(version: VersionRow, asOf: string): JourneyOperationalPeriod {
  return { start: plusMs(asOf, -Number(version.window_seconds) * 1000), end: asOf, timezone: version.timezone };
}

function recoverExpired(at: string) {
  const rows = db.prepare(`SELECT * FROM journey_metric_rebuild_runs WHERE state='leased' AND lease_expires_at<=?
    ORDER BY lease_expires_at,id LIMIT 100`).all(at) as RunRow[];
  for (const row of rows) {
    const terminal = Number(row.attempt_count) >= Number(row.max_attempts);
    const changed = db.prepare(`UPDATE journey_metric_rebuild_runs SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,error_code='JOURNEY_METRIC_LEASE_EXPIRED',updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_generation=? AND lease_expires_at<=?`)
      .run(terminal ? 'failed' : 'retryable', at, at, terminal ? at : null, row.id, row.space_id,
        Number(row.lease_generation), at).changes;
    if (!changed) continue;
    db.prepare(`INSERT INTO journey_metric_rebuild_attempts
      (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
      VALUES (?,?,?,?,?,'lease_expired','JOURNEY_METRIC_LEASE_EXPIRED',?,?)`)
      .run(crypto.randomUUID(), row.id, row.space_id, Number(row.attempt_count), Number(row.lease_generation),
        iso(row.updated_at), at);
  }
}

export function claimJourneyMetricRebuild(input: { owner: string; now?: Date | string; leaseMs?: number }) {
  const owner = String(input.owner || '').trim();
  if (!owner || owner.length > 128) throw new JourneyMetricsError('A valid lease owner is required.', 400,
    'JOURNEY_METRIC_LEASE_OWNER_INVALID');
  const at = nowIso(input.now); const leaseMs = Math.max(5_000, Math.min(300_000, input.leaseMs || 30_000));
  return db.transaction(() => {
    recoverExpired(at);
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const row = db.prepare(`SELECT * FROM journey_metric_rebuild_runs
      WHERE state IN ('pending','retryable') AND available_at<=? ORDER BY available_at,created_at,id LIMIT 1${suffix}`)
      .get(at) as RunRow | undefined;
    if (!row) return null;
    const token = crypto.randomBytes(24).toString('hex'); const generation = Number(row.lease_generation) + 1;
    const changed = db.prepare(`UPDATE journey_metric_rebuild_runs SET state='leased',lease_owner=?,lease_token=?,
      lease_generation=?,lease_expires_at=?,attempt_count=attempt_count+1,error_code=NULL,updated_at=?
      WHERE id=? AND space_id=? AND state IN ('pending','retryable') AND lease_generation=?`).run(owner, token, generation,
        plusMs(at, leaseMs), at, row.id, row.space_id, Number(row.lease_generation)).changes;
    if (!changed) return null;
    return db.prepare('SELECT * FROM journey_metric_rebuild_runs WHERE id=? AND space_id=?')
      .get(row.id, row.space_id) as ClaimedRun;
  })();
}

function surveyProjection(run: ClaimedRun, version: VersionRow, definition: DefinitionRow,
  period: JourneyOperationalPeriod): Projection {
  const binding = db.prepare('SELECT * FROM journey_metric_bindings WHERE id=? AND space_id=?')
    .get(version.binding_id, run.space_id) as BindingRow | undefined;
  if (!binding || !binding.survey_id || !binding.question_id) return {
    status: 'retracted', value: null, unit: 'unavailable', numerator: null, denominator: 0, sampleSize: 0,
    freshnessStatus: 'unavailable', latestObservedAt: null, minimumSampleWarning: true,
    result: { definitionId: definition.id, definitionVersionId: version.id, sourceState: 'deleted',
      period, warning: 'The linked survey or question was deleted. Historical observations remain immutable.' }, sources: []
  };
  const question = db.prepare('SELECT id,type FROM questions WHERE id=? AND survey_id=?')
    .get(binding.question_id, binding.survey_id) as { id: string; type: string } | undefined;
  if (!question || question.type !== version.calculator_kind) return {
    status: 'unavailable', value: null, unit: 'unavailable', numerator: null, denominator: 0, sampleSize: 0,
    freshnessStatus: 'unavailable', latestObservedAt: null, minimumSampleWarning: true,
    result: { definitionId: definition.id, definitionVersionId: version.id, sourceState: 'mismatched', period,
      warning: 'The linked question is unavailable or no longer matches the metric type.' }, sources: []
  };
  const rows = db.prepare(`SELECT id,collector_id,status,answers_json,started_at,completed_at FROM responses
    WHERE survey_id=? AND started_at<?${binding.collector_id ? ' AND collector_id=?' : ''} ORDER BY id`)
    .all(binding.survey_id, period.end, ...(binding.collector_id ? [binding.collector_id] : [])) as Array<{
      id: string; collector_id: string; status: string; answers_json: unknown; started_at: unknown; completed_at: unknown;
    }>;
  const samples: JourneyMetricSample[] = []; const sources: SourceProjection[] = [];
  for (const row of rows) {
    const answers = parseJson<Record<string, unknown>>(row.answers_json, {});
    const occurredAt = iso(row.completed_at || row.started_at);
    const fingerprint = sha({ status: row.status, answer: answers[question.id], occurredAt, collectorId: row.collector_id });
    const valid = row.status === 'completed' && answers[question.id] !== undefined;
    sources.push({ sourceType: 'survey_response', sourceRecordId: row.id, sourceRevisionSha256: fingerprint,
      occurredAt, included: valid, exclusionCode: valid ? null : row.status !== 'completed' ? 'RESPONSE_NOT_COMPLETED' : 'ANSWER_MISSING' });
    if (valid) samples.push({ sampleId: row.id, revision: 1, sourceRef: binding.source_ref,
      value: answers[question.id], occurredAt });
  }
  const configured = parseJson<JourneyMetricDefinition>(version.configuration_json, {} as JourneyMetricDefinition);
  const metricDefinition = { ...configured, metricId: definition.id, metricDefinitionVersion: String(version.version_number),
    metricType: version.calculator_kind, sourceRefs: [binding.source_ref], minimumSampleSize: Number(version.minimum_sample_size),
    freshnessMaxAgeSeconds: Number(version.freshness_max_age_seconds), direction: version.direction } as JourneyMetricDefinition;
  const result = calculateJourneyMetric({ definition: metricDefinition, period, asOf: iso(run.as_of), samples });
  const invalidIds = new Set(result.exclusions.invalid.records.map((entry) => entry.sampleId));
  const outsideIds = new Set(result.exclusions.outsidePeriod.sampleIds);
  for (const source of sources) {
    if (invalidIds.has(source.sourceRecordId)) { source.included = false; source.exclusionCode = 'CALCULATOR_INVALID'; }
    if (outsideIds.has(source.sourceRecordId)) { source.included = false; source.exclusionCode = 'OUTSIDE_PERIOD'; }
  }
  return { status: 'available', value: result.value, unit: result.unit, numerator: result.numerator,
    denominator: result.denominator, sampleSize: result.sampleSize, freshnessStatus: result.freshness.status,
    latestObservedAt: result.freshness.latestObservedAt, minimumSampleWarning: result.minimumSampleWarning.active,
    result: result as unknown as Record<string, unknown>, sources };
}

function operationalProjection(run: ClaimedRun, version: VersionRow, definition: DefinitionRow,
  period: JourneyOperationalPeriod): Projection {
  let configured = parseJson<JourneyOperationalMeasureDefinition>(version.configuration_json, {} as JourneyOperationalMeasureDefinition);
  if (configured.kind === 'sentiment_trend') configured = { ...configured, comparisonPeriod: {
    start: plusMs(period.start, -Number(version.window_seconds) * 1000), end: period.start, timezone: period.timezone } };
  const earliest = configured.kind === 'sentiment_trend' ? configured.comparisonPeriod.start : period.start;
  const rows = db.prepare(`SELECT * FROM journey_metric_imports WHERE space_id=? AND definition_id=?
    AND definition_version_id=? AND occurred_at>=? AND occurred_at<? ORDER BY external_record_sha256,revision,id`)
    .all(run.space_id, definition.id, version.id, earliest, period.end) as any[];
  const observations: JourneyOperationalObservation[] = rows.map((row) => ({ observationId: row.external_record_sha256,
    revision: Number(row.revision), sourceLineage: parseJson<JourneyOperationalSourceLineage>(row.source_lineage_json,
      {} as JourneyOperationalSourceLineage), sourceRecordId: row.id,
    subjectId: row.subject_id_hmac, subjectType: row.subject_type, eventType: row.event_type, occurredAt: iso(row.occurred_at),
    stageId: row.stage_id, sentiment: row.sentiment, invalidReason: row.operation === 'delete' ? 'SOURCE_DELETED' : row.invalid_reason }));
  const result = calculateJourneyOperationalMeasure({ definition: configured, period, asOf: iso(run.as_of), observations });
  const summary = result.summary || result.rows[0]?.current || { value: null, unit: 'count', numerator: null, denominator: 0, sampleSize: 0 };
  const latestRevision = new Map<string, number>();
  rows.forEach((row) => latestRevision.set(row.external_record_sha256,
    Math.max(latestRevision.get(row.external_record_sha256) || 0, Number(row.revision))));
  const sources: SourceProjection[] = rows.map((row) => ({ sourceType: 'operational_import', sourceRecordId: row.id,
    sourceRevisionSha256: sha({ intent: row.intent_sha256, schema: row.schema_content_sha256 }), occurredAt: iso(row.occurred_at),
    included: Number(row.revision) === latestRevision.get(row.external_record_sha256) && row.operation !== 'delete',
    exclusionCode: row.operation === 'delete' ? 'SOURCE_DELETED'
      : Number(row.revision) === latestRevision.get(row.external_record_sha256) ? null : 'SUPERSEDED_REVISION' }));
  return { status: 'available', value: summary.value, unit: summary.unit, numerator: summary.numerator,
    denominator: summary.denominator, sampleSize: summary.sampleSize, freshnessStatus: result.freshness.status,
    latestObservedAt: result.freshness.latestObservedAt, minimumSampleWarning: result.minimumSampleWarning.active,
    result: result as unknown as Record<string, unknown>, sources };
}

/** First-party native adapter branch.
 *
 * It reuses the whole existing pipeline — fencing, content-hash idempotency,
 * append-on-change revisions, checkpoints and the privacy stamp — and pulls
 * from the source of record at rebuild time rather than a second raw store.
 * That is what makes deletion and correction idempotent for free: when a
 * ticket, event or mention disappears the next rebuild simply projects fewer
 * records, the snapshot hash changes, a new observation revision is appended,
 * and every earlier observation stays immutable and readable. When a pinned
 * source is revoked or deleted outright the measure is retracted rather than
 * recomputed over the surviving subset, matching `surveyProjection`. */
function nativeProjection(run: ClaimedRun, version: VersionRow, definition: DefinitionRow,
  period: JourneyOperationalPeriod, native: JourneyNativeMetricSource): Projection {
  let configured = parseJson<JourneyOperationalMeasureDefinition>(version.configuration_json,
    {} as JourneyOperationalMeasureDefinition);
  if (configured.kind === 'sentiment_trend') configured = { ...configured, comparisonPeriod: {
    start: plusMs(period.start, -Number(version.window_seconds) * 1000), end: period.start, timezone: period.timezone } };
  const earliest = configured.kind === 'sentiment_trend' ? configured.comparisonPeriod.start : period.start;
  const projected = projectJourneyNativeObservations({ spaceId: run.space_id, source: native,
    definition: configured, earliest, end: period.end, identityHmac: subjectHmac });
  if (projected.state === 'retracted') return {
    status: 'retracted', value: null, unit: 'unavailable', numerator: null, denominator: 0, sampleSize: 0,
    freshnessStatus: 'unavailable', latestObservedAt: null, minimumSampleWarning: true,
    result: { definitionId: definition.id, definitionVersionId: version.id, sourceState: 'deleted', period,
      warning: projected.warning }, sources: []
  };
  const result = calculateJourneyOperationalMeasure({ definition: configured, period, asOf: iso(run.as_of),
    observations: projected.observations });
  const summary = result.summary || result.rows[0]?.current
    || { value: null, unit: 'count', numerator: null, denominator: 0, sampleSize: 0 };
  return { status: 'available', value: summary.value, unit: summary.unit, numerator: summary.numerator,
    denominator: summary.denominator, sampleSize: summary.sampleSize, freshnessStatus: result.freshness.status,
    latestObservedAt: result.freshness.latestObservedAt, minimumSampleWarning: result.minimumSampleWarning.active,
    result: result as unknown as Record<string, unknown>, sources: projected.sources };
}

/** The alert evaluator has always read a `privacySuppressed` flag out of the
 * stored result, but nothing ever wrote one, so that branch could only fire for
 * externally asserted operational results. Stamping the decision at write time
 * gives the existing consumer a producer; read projections still recompute it,
 * because append-only rows cannot be corrected if a threshold later changes. */
function withPrivacyDecision(projection: Projection, version: VersionRow) {
  const decision = journeyMetricPrivacyDecision({ sample_size: projection.sampleSize,
    minimum_sample_warning: projection.minimumSampleWarning ? 1 : 0, result_json: projection.result }, version);
  if (!decision.suppressed) return projection;
  return { ...projection, result: { ...projection.result, privacySuppressed: true,
    privacy: { suppressed: true, reasonCode: decision.reasonCode, minimumSampleSize: decision.minimumSampleSize,
      privacyVersion: decision.privacyVersion } } };
}

function complete(run: ClaimedRun, incoming: Projection, version: VersionRow, period: JourneyOperationalPeriod,
  startedAt: string, completedAt: string) {
  const projection = withPrivacyDecision(incoming, version);
  const sourceSnapshotSha = sha(projection.sources.map((source) => [source.sourceType, source.sourceRecordId,
    source.sourceRevisionSha256, source.included, source.exclusionCode]));
  const resultSha = sha(projection.result);
  return db.transaction(() => {
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const current = db.prepare(`SELECT * FROM journey_metric_rebuild_runs WHERE id=? AND space_id=?${suffix}`)
      .get(run.id, run.space_id) as RunRow | undefined;
    if (!current || current.state !== 'leased' || current.lease_token !== run.lease_token
      || Number(current.lease_generation) !== Number(run.lease_generation)) {
      throw new JourneyMetricsError('The rebuild lease is no longer current.', 409, 'JOURNEY_METRIC_LEASE_LOST');
    }
    const previous = db.prepare(`SELECT * FROM journey_metric_observations WHERE definition_id=? AND definition_version_id=?
      AND period_start=? AND period_end=? ORDER BY revision DESC,id LIMIT 1`)
      .get(run.definition_id, run.definition_version_id, period.start, period.end) as any;
    let observationId = previous?.id || null;
    if (!previous || previous.source_snapshot_sha256 !== sourceSnapshotSha || previous.result_sha256 !== resultSha
      || previous.status !== projection.status) {
      observationId = crypto.randomUUID(); const revision = Number(previous?.revision || 0) + 1;
      db.prepare(`INSERT INTO journey_metric_observations
        (id,space_id,definition_id,definition_version_id,revision,supersedes_observation_id,status,value,unit,numerator,
         denominator,sample_size,period_start,period_end,timezone,as_of,calculated_at,freshness_status,latest_observed_at,
         minimum_sample_warning,source_count,source_snapshot_sha256,result_sha256,result_json,rebuild_run_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(observationId, run.space_id, run.definition_id,
          run.definition_version_id, revision, previous?.id || null, projection.status, projection.value, projection.unit,
          projection.numerator, projection.denominator, projection.sampleSize, period.start, period.end, period.timezone,
          iso(run.as_of), completedAt, projection.freshnessStatus, projection.latestObservedAt,
          projection.minimumSampleWarning ? 1 : 0, projection.sources.length, sourceSnapshotSha, resultSha,
          stableJson(projection.result), run.id, completedAt);
      const insertSource = db.prepare(`INSERT INTO journey_metric_observation_sources
        (id,observation_id,space_id,source_type,source_record_id,source_revision_sha256,occurred_at,included,exclusion_code,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const source of projection.sources) insertSource.run(crypto.randomUUID(), observationId, run.space_id,
        source.sourceType, source.sourceRecordId, source.sourceRevisionSha256, source.occurredAt,
        source.included ? 1 : 0, source.exclusionCode, completedAt);
    }
    db.prepare(`INSERT INTO journey_metric_checkpoints
      (definition_version_id,space_id,last_observation_id,source_snapshot_sha256,source_record_count,reconciled_at,revision)
      VALUES (?,?,?,?,?,?,1) ON CONFLICT(definition_version_id,space_id) DO UPDATE SET
        last_observation_id=excluded.last_observation_id,source_snapshot_sha256=excluded.source_snapshot_sha256,
        source_record_count=excluded.source_record_count,reconciled_at=excluded.reconciled_at,
        revision=journey_metric_checkpoints.revision+1`).run(version.id, run.space_id, observationId,
          sourceSnapshotSha, projection.sources.length, completedAt);
    const changed = db.prepare(`UPDATE journey_metric_rebuild_runs SET state='completed',observation_id=?,error_code=NULL,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
      .run(observationId, completedAt, completedAt, run.id, run.space_id, run.lease_token,
        Number(run.lease_generation)).changes;
    if (!changed) throw new JourneyMetricsError('The rebuild lease is no longer current.', 409, 'JOURNEY_METRIC_LEASE_LOST');
    db.prepare(`INSERT INTO journey_metric_rebuild_attempts
      (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
      VALUES (?,?,?,?,?,'succeeded',NULL,?,?)`).run(crypto.randomUUID(), run.id, run.space_id,
        Number(run.attempt_count), Number(run.lease_generation), startedAt, completedAt);
    audit(run.space_id, run.requested_by_user_id, 'rebuild.completed', 'rebuild_run', run.id,
      { definitionId: run.definition_id, observationId, appended: !previous || previous.id !== observationId }, completedAt);
    return observationId;
  })();
}

export function processJourneyMetricRebuild(run: ClaimedRun, now?: Date | string) {
  const startedAt = nowIso(now);
  const definition = db.prepare('SELECT * FROM journey_metric_definitions WHERE id=? AND space_id=?')
    .get(run.definition_id, run.space_id) as DefinitionRow | undefined;
  const version = db.prepare(`SELECT * FROM journey_metric_definition_versions
    WHERE id=? AND definition_id=? AND space_id=?`).get(run.definition_version_id, run.definition_id, run.space_id) as VersionRow | undefined;
  if (!definition || !version) throw new JourneyMetricsError('Metric rebuild configuration is unavailable.', 409,
    'JOURNEY_METRIC_REBUILD_CONFIGURATION_MISSING');
  const period = periodFor(version, iso(run.as_of));
  const native = version.source_kind === 'survey' ? null : journeyMetricVersionNativeSource(version.configuration_json);
  const projection = version.source_kind === 'survey'
    ? surveyProjection(run, version, definition, period)
    : native
      ? nativeProjection(run, version, definition, period, native)
      : operationalProjection(run, version, definition, period);
  return complete(run, projection, version, period, startedAt, nowIso(now));
}

export function failJourneyMetricRebuild(run: ClaimedRun, value: unknown, now?: Date | string) {
  const at = nowIso(now); const errorCode = value instanceof JourneyMetricsError ? value.code : 'JOURNEY_METRIC_REBUILD_FAILED';
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM journey_metric_rebuild_runs WHERE id=? AND space_id=?')
      .get(run.id, run.space_id) as RunRow | undefined;
    if (!current || current.state !== 'leased' || current.lease_token !== run.lease_token
      || Number(current.lease_generation) !== Number(run.lease_generation)) return false;
    const terminal = Number(current.attempt_count) >= Number(current.max_attempts)
      || (value instanceof JourneyMetricsError && value.status < 500 && value.code !== 'JOURNEY_METRIC_LEASE_LOST');
    const availableAt = terminal ? at : plusMs(at, Math.min(60_000, 2 ** Number(current.attempt_count) * 1_000));
    db.prepare(`UPDATE journey_metric_rebuild_runs SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,error_code=?,updated_at=?,completed_at=? WHERE id=? AND space_id=? AND state='leased'
      AND lease_token=? AND lease_generation=?`).run(terminal ? 'failed' : 'retryable', availableAt, errorCode, at,
        terminal ? at : null, run.id, run.space_id, run.lease_token, Number(run.lease_generation));
    db.prepare(`INSERT INTO journey_metric_rebuild_attempts
      (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), run.id, run.space_id, Number(current.attempt_count),
        Number(current.lease_generation), terminal ? 'terminal_failed' : 'retryable_failed', errorCode, iso(current.updated_at), at);
    audit(run.space_id, run.requested_by_user_id, 'rebuild.failed', 'rebuild_run', run.id,
      { definitionId: run.definition_id, errorCode, retryable: !terminal }, at);
    return true;
  })();
}

export async function runOneJourneyMetricRebuild(owner = `journey-metric-${process.pid}`, now?: Date | string) {
  const run = claimJourneyMetricRebuild({ owner, now });
  if (!run) return false;
  try { processJourneyMetricRebuild(run, now); } catch (value) { failJourneyMetricRebuild(run, value, now); }
  return true;
}

export class JourneyMetricRebuildRunner {
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private stopped = true;
  constructor(private owner = `journey-metric-${process.pid}-${crypto.randomUUID()}`) {}
  start() {
    if (!this.stopped) return; this.stopped = false;
    const tick = async () => {
      if (this.stopped || this.active) return;
      this.active += 1;
      try { while (!this.stopped && await runOneJourneyMetricRebuild(this.owner)) { /* bounded by queue */ } }
      finally { this.active -= 1; }
    };
    this.timer = setInterval(() => { void tick(); }, 1_000); this.timer.unref(); void tick();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
  async drain(timeoutMs = 8_000) {
    const until = Date.now() + timeoutMs;
    while (this.active && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
    return this.active === 0;
  }
}

export const journeyMetricRebuildRunner = new JourneyMetricRebuildRunner();
