import crypto from 'node:crypto';
import { db } from './database.js';
import { publishedJourneyStageRules, type PublishedJourneyStageRule } from './journeyStageRuleRepository.js';
import {
  buildJourneyStageRuleHistory,
  deriveAnonymousVisitApplication,
  evaluatePublishedJourneyStageRuleGroup,
  groupPublishedJourneyStageRules
} from './journeyStageProjectionCore.js';

type ReprojectionReason = 'manual' | 'rule_published' | 'rule_corrected' | 'reconcile' | 'incident_recovery';
type ReprojectionState = 'pending' | 'leased' | 'retryable' | 'completed' | 'failed' | 'cancelled';
type ReprojectionAttemptStatus = 'succeeded' | 'retryable_failed' | 'terminal_failed' | 'lease_expired' | 'cancelled';
type JourneyEnvironment = 'development' | 'staging' | 'production';

type RunRow = {
  id: string;
  space_id: string;
  reason: ReprojectionReason;
  journey_definition_id: string;
  journey_map_version_id: string;
  rule_definition_id: string | null;
  rule_version_id: string | null;
  source_id: string | null;
  environment: JourneyEnvironment | null;
  window_start: string | null;
  window_end: string | null;
  state: ReprojectionState;
  available_at: string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_generation: number | string;
  lease_expires_at: string | null;
  attempt_count: number | string;
  max_attempts: number | string;
  summary_json: string;
  error_code: string | null;
  idempotency_key: string;
  intent_sha256: string;
  requested_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ClaimedRun = RunRow & { lease_owner: string; lease_token: string };

type RawRow = {
  received_at: string;
  id: string;
  space_id: string;
  source_id: string;
  environment: JourneyEnvironment;
  event_id: string;
  event_name: string | null;
  occurred_at: string;
  schema_version_id: string | null;
  anonymous_id_hash: string | null;
  payload_json: string | Record<string, unknown>;
  envelope_sha256: string;
  retention_expires_at: string;
};

type CheckpointRow = {
  run_id: string;
  space_id: string;
  last_event_occurred_at: string | null;
  last_raw_received_at: string | null;
  last_raw_event_id: string | null;
  processed_count: number | string;
  matched_count: number | string;
  no_match_count: number | string;
  skipped_no_anonymous_subject_count: number | string;
  late_count: number | string;
  out_of_order_count: number | string;
  changed_current_stage_count: number | string;
  changed_terminal_state_count: number | string;
  no_change_count: number | string;
  revision: number | string;
  updated_at: string;
};

type Summary = {
  sourceScope: {
    journeyDefinitionId: string;
    journeyMapVersionId: string;
    ruleDefinitionId: string | null;
    ruleVersionId: string | null;
    sourceId: string | null;
    environment: JourneyEnvironment | null;
    windowStart: string | null;
    windowEnd: string | null;
  };
  before: {
    decisions: number;
    visits: number;
    instances: number;
  };
  projected: {
    processed: number;
    matched: number;
    noMatch: number;
    skippedNoAnonymousSubject: number;
    late: number;
    outOfOrder: number;
    changedCurrentStage: number;
    changedTerminalState: number;
    noChange: number;
  };
};

export class JourneyStageReprojectionError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_STAGE_REPROJECTION_INVALID') {
    super(message);
    this.name = 'JourneyStageReprojectionError';
  }
}

function nowIso(value?: Date | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new JourneyStageReprojectionError('A valid timestamp is required.', 400, 'JOURNEY_STAGE_REPROJECTION_TIME_INVALID');
  }
  return date.toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value || '')) as T; } catch { return fallback; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])
  );
  return value;
}

function stableJson(value: unknown) { return JSON.stringify(stable(value)); }
function sha(value: unknown) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function plusMs(value: string, milliseconds: number) { return new Date(Date.parse(value) + milliseconds).toISOString(); }

function audit(spaceId: string, actorUserId: string | null, action: string, targetType: string, targetId: string,
  detail: Record<string, unknown>, at = nowIso()) {
  db.prepare(`INSERT INTO journey_stage_reprojection_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, targetId, stableJson(detail), at);
}

function token(value: string, label: string, maximum = 200) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new JourneyStageReprojectionError(`A valid ${label} is required.`, 400, 'JOURNEY_STAGE_REPROJECTION_INPUT_INVALID');
  }
  return normalized;
}

function assertJourneyVersion(spaceId: string, journeyDefinitionId: string, journeyMapVersionId: string) {
  const row = db.prepare(`SELECT definition.id,published_version_id
    FROM journey_definitions definition
    JOIN journey_map_versions version ON version.id=definition.published_version_id
      AND version.definition_id=definition.id AND version.space_id=definition.space_id
    WHERE definition.id=? AND definition.space_id=? AND version.id=?`)
    .get(journeyDefinitionId, spaceId, journeyMapVersionId) as { id?: string } | undefined;
  if (!row?.id) throw new JourneyStageReprojectionError(
    'The reprojection scope must pin the journey to its exact published map version.',
    409,
    'JOURNEY_STAGE_REPROJECTION_MAP_NOT_PUBLISHED'
  );
}

function idempotentRow(spaceId: string, key: string, intent: unknown) {
  const row = db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE space_id=? AND idempotency_key=?`)
    .get(spaceId, key) as RunRow | undefined;
  if (row && row.intent_sha256 !== sha(intent)) {
    throw new JourneyStageReprojectionError(
      'This idempotency key was already used for a different reprojection request.',
      409,
      'JOURNEY_STAGE_REPROJECTION_IDEMPOTENCY_CONFLICT'
    );
  }
  return row;
}

function checkpointPublic(row: CheckpointRow | undefined) {
  return row ? {
    lastEventOccurredAt: row.last_event_occurred_at,
    lastRawReceivedAt: row.last_raw_received_at,
    lastRawEventId: row.last_raw_event_id,
    processedCount: Number(row.processed_count),
    matchedCount: Number(row.matched_count),
    noMatchCount: Number(row.no_match_count),
    skippedNoAnonymousSubjectCount: Number(row.skipped_no_anonymous_subject_count),
    lateCount: Number(row.late_count),
    outOfOrderCount: Number(row.out_of_order_count),
    changedCurrentStageCount: Number(row.changed_current_stage_count),
    changedTerminalStateCount: Number(row.changed_terminal_state_count),
    noChangeCount: Number(row.no_change_count),
    revision: Number(row.revision),
    updatedAt: row.updated_at
  } : null;
}

function runPublic(row: RunRow) {
  const checkpoint = db.prepare(`SELECT * FROM journey_stage_reprojection_checkpoints WHERE run_id=? AND space_id=?`)
    .get(row.id, row.space_id) as CheckpointRow | undefined;
  return {
    id: row.id,
    reason: row.reason,
    journeyDefinitionId: row.journey_definition_id,
    journeyMapVersionId: row.journey_map_version_id,
    ruleDefinitionId: row.rule_definition_id,
    ruleVersionId: row.rule_version_id,
    sourceId: row.source_id,
    environment: row.environment,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    state: row.state,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    summary: parseJson<Summary | null>(row.summary_json, null),
    errorCode: row.error_code,
    checkpoint: checkpointPublic(checkpoint),
    requestedByUserId: row.requested_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

export function queueJourneyStageReprojection(input: {
  spaceId: string;
  actorUserId?: string | null;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  reason: ReprojectionReason;
  ruleDefinitionId?: string | null;
  ruleVersionId?: string | null;
  sourceId?: string | null;
  environment?: JourneyEnvironment | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  idempotencyKey: string;
  now?: Date | string;
}) {
  assertJourneyVersion(input.spaceId, input.journeyDefinitionId, input.journeyMapVersionId);
  const at = nowIso(input.now);
  const key = token(input.idempotencyKey, 'idempotency key');
  const intent = {
    journeyDefinitionId: input.journeyDefinitionId,
    journeyMapVersionId: input.journeyMapVersionId,
    reason: input.reason,
    ruleDefinitionId: input.ruleDefinitionId || null,
    ruleVersionId: input.ruleVersionId || null,
    sourceId: input.sourceId || null,
    environment: input.environment || null,
    windowStart: input.windowStart || null,
    windowEnd: input.windowEnd || null
  };
  if (intent.windowStart && intent.windowEnd && intent.windowEnd <= intent.windowStart) {
    throw new JourneyStageReprojectionError(
      'The reprojection end time must be after the start time.',
      400,
      'JOURNEY_STAGE_REPROJECTION_WINDOW_INVALID'
    );
  }
  const replay = idempotentRow(input.spaceId, key, intent);
  if (replay) return { run: runPublic(replay), replayed: true };
  const id = crypto.randomUUID();
  const summary = {
    sourceScope: {
      journeyDefinitionId: input.journeyDefinitionId,
      journeyMapVersionId: input.journeyMapVersionId,
      ruleDefinitionId: input.ruleDefinitionId || null,
      ruleVersionId: input.ruleVersionId || null,
      sourceId: input.sourceId || null,
      environment: input.environment || null,
      windowStart: input.windowStart || null,
      windowEnd: input.windowEnd || null
    },
    before: { decisions: 0, visits: 0, instances: 0 },
    projected: {
      processed: 0, matched: 0, noMatch: 0, skippedNoAnonymousSubject: 0, late: 0, outOfOrder: 0,
      changedCurrentStage: 0, changedTerminalState: 0, noChange: 0
    }
  } satisfies Summary;
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_stage_reprojection_runs
      (id,space_id,reason,journey_definition_id,journey_map_version_id,rule_definition_id,rule_version_id,
        source_id,environment,window_start,window_end,state,available_at,lease_owner,lease_token,lease_generation,
        lease_expires_at,attempt_count,max_attempts,summary_json,error_code,idempotency_key,intent_sha256,
        requested_by_user_id,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,NULL,NULL,0,NULL,0,5,?,NULL,?,?,?, ?,?,NULL)`)
      .run(id, input.spaceId, input.reason, input.journeyDefinitionId, input.journeyMapVersionId,
        input.ruleDefinitionId || null, input.ruleVersionId || null, input.sourceId || null, input.environment || null,
        input.windowStart || null, input.windowEnd || null, at, stableJson(summary), key, sha(intent), input.actorUserId || null, at, at);
    db.prepare(`INSERT INTO journey_stage_reprojection_checkpoints
      (run_id,space_id,last_event_occurred_at,last_raw_received_at,last_raw_event_id,processed_count,matched_count,
        no_match_count,skipped_no_anonymous_subject_count,late_count,out_of_order_count,changed_current_stage_count,
        changed_terminal_state_count,no_change_count,revision,updated_at)
      VALUES (?,?,NULL,NULL,NULL,0,0,0,0,0,0,0,0,0,1,?)`)
      .run(id, input.spaceId, at);
    audit(input.spaceId, input.actorUserId || null, 'reprojection.requested', 'reprojection_run', id, summary.sourceScope, at);
  })();
  return { run: runPublic(db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`).get(id, input.spaceId) as RunRow), replayed: false };
}

function recoverExpired(at: string) {
  const rows = db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE state='leased' AND lease_expires_at<=?
    ORDER BY lease_expires_at,id LIMIT 100`).all(at) as RunRow[];
  for (const row of rows) {
    const terminal = Number(row.attempt_count) >= Number(row.max_attempts);
    const changed = db.prepare(`UPDATE journey_stage_reprojection_runs SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,error_code='JOURNEY_STAGE_REPROJECTION_LEASE_EXPIRED',updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_generation=? AND lease_expires_at<=?`)
      .run(terminal ? 'failed' : 'retryable', at, at, terminal ? at : null, row.id, row.space_id, Number(row.lease_generation), at).changes;
    if (!changed) continue;
    db.prepare(`INSERT INTO journey_stage_reprojection_attempts
      (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
      VALUES (?,?,?,?,?,'lease_expired','JOURNEY_STAGE_REPROJECTION_LEASE_EXPIRED',?,?)`)
      .run(crypto.randomUUID(), row.id, row.space_id, Number(row.attempt_count), Number(row.lease_generation), row.updated_at, at);
  }
}

export function claimJourneyStageReprojection(input: { owner: string; now?: Date | string; leaseMs?: number }) {
  const owner = token(input.owner, 'lease owner', 128);
  const at = nowIso(input.now);
  const leaseMs = Math.max(5_000, Math.min(300_000, input.leaseMs || 30_000));
  return db.transaction(() => {
    recoverExpired(at);
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const row = db.prepare(`SELECT * FROM journey_stage_reprojection_runs
      WHERE state IN ('pending','retryable') AND available_at<=? ORDER BY available_at,created_at,id LIMIT 1${suffix}`)
      .get(at) as RunRow | undefined;
    if (!row) return null;
    const tokenValue = crypto.randomBytes(24).toString('hex');
    const generation = Number(row.lease_generation) + 1;
    const changed = db.prepare(`UPDATE journey_stage_reprojection_runs SET state='leased',lease_owner=?,lease_token=?,
      lease_generation=?,lease_expires_at=?,attempt_count=attempt_count+1,error_code=NULL,updated_at=?
      WHERE id=? AND space_id=? AND state IN ('pending','retryable') AND lease_generation=?`)
      .run(owner, tokenValue, generation, plusMs(at, leaseMs), at, row.id, row.space_id, Number(row.lease_generation)).changes;
    if (!changed) return null;
    return db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`)
      .get(row.id, row.space_id) as ClaimedRun;
  })();
}

function loadCheckpoint(run: ClaimedRun) {
  return db.prepare(`SELECT * FROM journey_stage_reprojection_checkpoints WHERE run_id=? AND space_id=?`)
    .get(run.id, run.space_id) as CheckpointRow;
}

function assertLease(run: ClaimedRun) {
  const current = db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`)
    .get(run.id, run.space_id) as RunRow | undefined;
  if (!current || current.state !== 'leased' || current.lease_token !== run.lease_token
    || current.lease_owner !== run.lease_owner || Number(current.lease_generation) !== Number(run.lease_generation)) {
    throw new JourneyStageReprojectionError('The reprojection lease is no longer current.', 409, 'JOURNEY_STAGE_REPROJECTION_LEASE_LOST');
  }
  return current;
}

function rulesForRun(run: ClaimedRun, eventName: string) {
  const scoped = publishedJourneyStageRules(run.space_id, eventName).filter((rule) =>
    rule.journeyDefinitionId === run.journey_definition_id
    && rule.journeyMapVersionId === run.journey_map_version_id
    && (!run.rule_definition_id || rule.ruleDefinitionId === run.rule_definition_id)
    && (!run.rule_version_id || rule.id === run.rule_version_id));
  return groupPublishedJourneyStageRules(scoped).get(run.journey_definition_id) || [];
}

function historyForRaw(run: ClaimedRun, raw: RawRow) {
  if (!raw.anonymous_id_hash) return [];
  const rows = db.prepare(`SELECT event_id,event_name,occurred_at,source_id,environment,payload_json,anonymous_id_hash
    FROM journey_raw_events
    WHERE space_id=? AND source_id=? AND environment=? AND ingest_state='accepted'
      AND anonymous_id_hash=? AND event_name IS NOT NULL AND occurred_at<=?
      AND NOT (received_at=? AND id=?)
    ORDER BY occurred_at DESC,event_id DESC LIMIT 100`)
    .all(run.space_id, raw.source_id, raw.environment, raw.anonymous_id_hash, raw.occurred_at, raw.received_at, raw.id) as Array<Record<string, unknown>>;
  return buildJourneyStageRuleHistory(rows);
}

function currentInstanceForRaw(run: ClaimedRun, raw: RawRow) {
  if (!raw.anonymous_id_hash) return null;
  return db.prepare(`SELECT state,current_stage_key,latest_event_at,latest_event_id
    FROM journey_anonymous_instances
    WHERE space_id=? AND source_id=? AND environment=? AND journey_definition_id=? AND anonymous_id_hash=?`)
    .get(run.space_id, raw.source_id, raw.environment, run.journey_definition_id, raw.anonymous_id_hash) as {
      state: string;
      current_stage_key: string | null;
      latest_event_at: string;
      latest_event_id: string;
    } | undefined;
}

function selectRawBatch(run: ClaimedRun, checkpoint: CheckpointRow, limit: number) {
  const clauses = [`space_id=?`, `ingest_state='accepted'`, `event_name IS NOT NULL`];
  const values: unknown[] = [run.space_id];
  const cursorOccurredAt = checkpoint.last_event_occurred_at || '0001-01-01T00:00:00.000Z';
  const cursorReceivedAt = checkpoint.last_raw_received_at || '0001-01-01T00:00:00.000Z';
  const cursorRawEventId = checkpoint.last_raw_event_id || '';
  if (run.source_id) { clauses.push(`source_id=?`); values.push(run.source_id); }
  if (run.environment) { clauses.push(`environment=?`); values.push(run.environment); }
  if (run.window_start) { clauses.push(`occurred_at>=?`); values.push(run.window_start); }
  if (run.window_end) { clauses.push(`occurred_at<?`); values.push(run.window_end); }
  clauses.push(`((occurred_at>? ) OR (occurred_at=? AND (received_at>? OR (received_at=? AND id>?))))`);
  values.push(cursorOccurredAt, cursorOccurredAt, cursorReceivedAt, cursorReceivedAt, cursorRawEventId);
  values.push(limit);
  return db.prepare(`SELECT received_at,id,space_id,source_id,environment,event_id,event_name,occurred_at,
    schema_version_id,anonymous_id_hash,payload_json,envelope_sha256,retention_expires_at
    FROM journey_raw_events WHERE ${clauses.join(' AND ')}
    ORDER BY occurred_at,received_at,id LIMIT ?`).all(...values) as RawRow[];
}

function countBefore(run: ClaimedRun) {
  const base = [run.space_id, run.journey_definition_id];
  const decisions = Number((db.prepare(`SELECT COUNT(*) count FROM journey_stage_rule_decisions
    WHERE space_id=? AND journey_definition_id=?${run.source_id ? ' AND source_id=?' : ''}`)
    .get(...base, ...(run.source_id ? [run.source_id] : [])) as any)?.count || 0);
  const visits = Number((db.prepare(`SELECT COUNT(*) count FROM journey_anonymous_stage_visits
    WHERE space_id=? AND journey_definition_id=?${run.source_id ? ' AND source_id=?' : ''}`)
    .get(...base, ...(run.source_id ? [run.source_id] : [])) as any)?.count || 0);
  const instances = Number((db.prepare(`SELECT COUNT(*) count FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=?${run.source_id ? ' AND source_id=?' : ''}`)
    .get(...base, ...(run.source_id ? [run.source_id] : [])) as any)?.count || 0);
  return { decisions, visits, instances };
}

function saveCheckpoint(run: ClaimedRun, checkpoint: CheckpointRow, summary: Summary, at: string, complete = false) {
  db.prepare(`UPDATE journey_stage_reprojection_checkpoints SET last_event_occurred_at=?,last_raw_received_at=?,last_raw_event_id=?,
    processed_count=?,matched_count=?,no_match_count=?,skipped_no_anonymous_subject_count=?,late_count=?,out_of_order_count=?,
    changed_current_stage_count=?,changed_terminal_state_count=?,no_change_count=?,revision=revision+1,updated_at=?
    WHERE run_id=? AND space_id=?`)
    .run(checkpoint.last_event_occurred_at, checkpoint.last_raw_received_at, checkpoint.last_raw_event_id,
      checkpoint.processed_count, checkpoint.matched_count, checkpoint.no_match_count, checkpoint.skipped_no_anonymous_subject_count,
      checkpoint.late_count, checkpoint.out_of_order_count, checkpoint.changed_current_stage_count,
      checkpoint.changed_terminal_state_count, checkpoint.no_change_count, at, run.id, run.space_id);
  db.prepare(`UPDATE journey_stage_reprojection_runs SET summary_json=?,updated_at=?,completed_at=?,state=?,
    lease_owner=?,lease_token=?,lease_expires_at=?,error_code=NULL
    WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
    .run(stableJson(summary), at, complete ? at : null, complete ? 'completed' : 'leased',
      complete ? null : run.lease_owner, complete ? null : run.lease_token, complete ? null : run.lease_expires_at,
      run.id, run.space_id, run.lease_token, Number(run.lease_generation));
}

export function processJourneyStageReprojection(run: ClaimedRun, input: { now?: Date | string; batchSize?: number } = {}) {
  const at = nowIso(input.now);
  const batchSize = Math.max(1, Math.min(500, input.batchSize || 100));
  return db.transaction(() => {
    const currentRun = assertLease(run);
    const checkpoint = loadCheckpoint(run);
    const summary = parseJson<Summary>(currentRun.summary_json, {
      sourceScope: {
        journeyDefinitionId: run.journey_definition_id,
        journeyMapVersionId: run.journey_map_version_id,
        ruleDefinitionId: run.rule_definition_id,
        ruleVersionId: run.rule_version_id,
        sourceId: run.source_id,
        environment: run.environment,
        windowStart: run.window_start,
        windowEnd: run.window_end
      },
      before: countBefore(run),
      projected: {
        processed: 0, matched: 0, noMatch: 0, skippedNoAnonymousSubject: 0, late: 0, outOfOrder: 0,
        changedCurrentStage: 0, changedTerminalState: 0, noChange: 0
      }
    });
    if (!summary.before.decisions && !summary.before.visits && !summary.before.instances) summary.before = countBefore(run);
    const rows = selectRawBatch(run, checkpoint, batchSize);
    for (const raw of rows) {
      checkpoint.last_event_occurred_at = raw.occurred_at;
      checkpoint.last_raw_received_at = raw.received_at;
      checkpoint.last_raw_event_id = raw.id;
      checkpoint.processed_count = Number(checkpoint.processed_count) + 1;
      summary.projected.processed += 1;
      if (!raw.event_name) {
        checkpoint.no_change_count = Number(checkpoint.no_change_count) + 1;
        summary.projected.noChange += 1;
        continue;
      }
      const rules = rulesForRun(run, raw.event_name);
      if (!rules.length) {
        checkpoint.no_match_count = Number(checkpoint.no_match_count) + 1;
        checkpoint.no_change_count = Number(checkpoint.no_change_count) + 1;
        summary.projected.noMatch += 1;
        summary.projected.noChange += 1;
        continue;
      }
      const history = historyForRaw(run, raw);
      const evaluation = evaluatePublishedJourneyStageRuleGroup({
        raw,
        claim: { leaseGeneration: Number(run.lease_generation) },
        rules,
        history,
        evaluatedAt: at,
        journeyStageProcessor: 'connected_journey_reprojection_v1',
        journeyStageProcessorVersion: 'stage-reprojection-v1',
        errorFactory: (message, code) => new JourneyStageReprojectionError(message, 409, code)
      });
      if (evaluation.outcome === 'matched') {
        checkpoint.matched_count = Number(checkpoint.matched_count) + 1;
        summary.projected.matched += 1;
      } else if (evaluation.outcome === 'skipped_no_anonymous_subject') {
        checkpoint.skipped_no_anonymous_subject_count = Number(checkpoint.skipped_no_anonymous_subject_count) + 1;
        summary.projected.skippedNoAnonymousSubject += 1;
      } else {
        checkpoint.no_match_count = Number(checkpoint.no_match_count) + 1;
        summary.projected.noMatch += 1;
      }
      if (evaluation.isLate) {
        checkpoint.late_count = Number(checkpoint.late_count) + 1;
        summary.projected.late += 1;
      }
      if (evaluation.matched && raw.anonymous_id_hash) {
        const instance = currentInstanceForRaw(run, raw);
        if (!instance) {
          checkpoint.changed_current_stage_count = Number(checkpoint.changed_current_stage_count) + 1;
          summary.projected.changedCurrentStage += 1;
        } else {
          const apply = deriveAnonymousVisitApplication({
            instance: {
              state: String(instance.state),
              currentStageKey: instance.current_stage_key ? String(instance.current_stage_key) : null,
              latestEventAt: new Date(String(instance.latest_event_at)).toISOString(),
              latestEventId: String(instance.latest_event_id)
            },
            eventOccurredAt: raw.occurred_at,
            eventId: raw.event_id
          });
          if (apply.outOfOrder) {
            checkpoint.out_of_order_count = Number(checkpoint.out_of_order_count) + 1;
            summary.projected.outOfOrder += 1;
          }
          const terminalBefore = ['succeeded', 'failed', 'exited'].includes(String(instance.state));
          const terminalAfter = ['success', 'failure', 'exit'].includes(String(evaluation.matched.role));
          if (apply.applies && instance.current_stage_key !== evaluation.matched.stageKey) {
            checkpoint.changed_current_stage_count = Number(checkpoint.changed_current_stage_count) + 1;
            summary.projected.changedCurrentStage += 1;
          } else {
            checkpoint.no_change_count = Number(checkpoint.no_change_count) + 1;
            summary.projected.noChange += 1;
          }
          if (!terminalBefore && terminalAfter && apply.applies) {
            checkpoint.changed_terminal_state_count = Number(checkpoint.changed_terminal_state_count) + 1;
            summary.projected.changedTerminalState += 1;
          }
        }
      } else {
        checkpoint.no_change_count = Number(checkpoint.no_change_count) + 1;
        summary.projected.noChange += 1;
      }
    }
    if (!rows.length || rows.length < batchSize) {
      saveCheckpoint(run, checkpoint, summary, at, true);
      db.prepare(`INSERT INTO journey_stage_reprojection_attempts
        (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
        VALUES (?,?,?,?,?,'succeeded',NULL,?,?)`)
        .run(crypto.randomUUID(), run.id, run.space_id, Number(run.attempt_count), Number(run.lease_generation), run.updated_at, at);
      audit(run.space_id, run.requested_by_user_id, 'reprojection.completed', 'reprojection_run', run.id, summary, at);
      return runPublic(db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`).get(run.id, run.space_id) as RunRow);
    }
    saveCheckpoint(run, checkpoint, summary, at, false);
    return runPublic(db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`).get(run.id, run.space_id) as RunRow);
  })();
}

export function failJourneyStageReprojection(run: ClaimedRun, value: unknown, now?: Date | string) {
  const at = nowIso(now);
  const errorCode = value instanceof JourneyStageReprojectionError ? value.code : 'JOURNEY_STAGE_REPROJECTION_FAILED';
  return db.transaction(() => {
    const current = db.prepare(`SELECT * FROM journey_stage_reprojection_runs WHERE id=? AND space_id=?`)
      .get(run.id, run.space_id) as RunRow | undefined;
    if (!current || current.state !== 'leased' || current.lease_token !== run.lease_token
      || Number(current.lease_generation) !== Number(run.lease_generation)) return false;
    const terminal = Number(current.attempt_count) >= Number(current.max_attempts)
      || (value instanceof JourneyStageReprojectionError && value.status < 500 && value.code !== 'JOURNEY_STAGE_REPROJECTION_LEASE_LOST');
    const nextState = terminal ? 'failed' : 'retryable';
    const availableAt = terminal ? at : plusMs(at, Math.min(60_000, 2 ** Number(current.attempt_count) * 1_000));
    db.prepare(`UPDATE journey_stage_reprojection_runs SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,error_code=?,updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
      .run(nextState, availableAt, errorCode, at, terminal ? at : null, run.id, run.space_id, run.lease_token, Number(run.lease_generation));
    db.prepare(`INSERT INTO journey_stage_reprojection_attempts
      (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), run.id, run.space_id, Number(current.attempt_count), Number(current.lease_generation),
        terminal ? 'terminal_failed' : 'retryable_failed', errorCode, current.updated_at, at);
    audit(run.space_id, run.requested_by_user_id, 'reprojection.failed', 'reprojection_run', run.id, { errorCode, retryable: !terminal }, at);
    return true;
  });
}

export async function runOneJourneyStageReprojection(owner = `journey-stage-reprojection-${process.pid}`, now?: Date | string) {
  const run = claimJourneyStageReprojection({ owner, now });
  if (!run) return false;
  try {
    let current: ReturnType<typeof runPublic> = runPublic(run);
    do {
      current = processJourneyStageReprojection(run, { now });
    } while (current.state === 'leased');
  } catch (value) {
    failJourneyStageReprojection(run, value, now);
  }
  return true;
}

export class JourneyStageReprojectionRunner {
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private stopped = true;
  constructor(private owner = `journey-stage-reprojection-${process.pid}-${crypto.randomUUID()}`) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped || this.active) return;
      this.active += 1;
      try { while (!this.stopped && await runOneJourneyStageReprojection(this.owner)) { /* drain queue */ } }
      finally { this.active -= 1; }
    };
    this.timer = setInterval(() => { void tick(); }, 1_000);
    this.timer.unref();
    void tick();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
  async drain(timeoutMs = 8_000) {
    const until = Date.now() + timeoutMs;
    while (this.active && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25));
    return this.active === 0;
  }
}

export const journeyStageReprojectionRunner = new JourneyStageReprojectionRunner();
