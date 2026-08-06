import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';
import { publishEvent } from './events.js';
import { type evaluateJourneyStageRules, type JourneyRuleEvent } from './journeyStageRules.js';
import { publishedJourneyStageRules, type PublishedJourneyStageRule } from './journeyStageRuleRepository.js';
import {
  buildJourneyStageRuleHistory,
  deriveAnonymousVisitApplication,
  evaluatePublishedJourneyStageRuleGroup,
  groupPublishedJourneyStageRules,
  stageInstanceState
} from './journeyStageProjectionCore.js';

export const journeyStageProcessor = 'connected_journey_v1';
export const journeyStageProcessorVersion = 'stage-rules-v1';
export const journeyStageMaxAttempts = 5;

export class JourneyStageProcessingError extends Error {
  constructor(message: string, public code: string, public retryable = false, public status = 500) {
    super(message);
    this.name = 'JourneyStageProcessingError';
  }
}

type InboxRow = {
  raw_received_at: string; raw_event_id: string; space_id: string; source_id: string; environment: JourneyRuleEvent['environment'];
  event_id: string; processor: string; state: 'pending' | 'leased' | 'retry_wait' | 'dead_lettered' | 'completed';
  available_at: string; lease_owner: string | null; lease_token: string | null; lease_generation: number | string;
  lease_expires_at: string | null; attempt_count: number | string; last_error_code: string | null; updated_at: string;
  retention_expires_at?: string;
};

type RawRow = {
  received_at: string; id: string; space_id: string; source_id: string; environment: JourneyRuleEvent['environment'];
  event_id: string; event_call: string; event_name: string | null; occurred_at: string; schema_version_id: string | null;
  anonymous_id_hash: string | null; ingest_state: 'accepted' | 'quarantined'; payload_json: string | Record<string, unknown>;
  envelope_sha256: string; retention_expires_at: string;
};

export type JourneyStageEventClaim = {
  rawReceivedAt: string; rawEventId: string; spaceId: string; sourceId: string;
  environment: JourneyRuleEvent['environment']; eventId: string; leaseOwner: string; leaseToken: string;
  leaseGeneration: number; attemptNumber: number; claimedAt: string; leaseExpiresAt: string;
};

function iso(value?: unknown) {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : new Date();
  if (!Number.isFinite(date.getTime())) throw new JourneyStageProcessingError('Invalid processing timestamp.', 'EVENT_STAGE_TIME_INVALID');
  return date.toISOString();
}

function plusDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60_000).toISOString();
}

function parseObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function redactedErrorCode(error: unknown) {
  if (error instanceof JourneyStageProcessingError) return error.code;
  return 'EVENT_STAGE_PROCESSING_FAILED';
}

function appendProcessingReceipt(input: {
  inbox: InboxRow | JourneyStageEventClaim; attemptedAt: string; completedAt: string;
  status: 'succeeded' | 'retryable_failed' | 'terminal_failed' | 'lease_expired';
  leaseToken: string | null; leaseGeneration: number; attemptNumber: number;
  checkpoint: string; errorCode: string | null; retentionExpiresAt: string;
}) {
  const rawReceivedAt = iso('raw_received_at' in input.inbox ? input.inbox.raw_received_at : input.inbox.rawReceivedAt);
  const rawEventId = 'raw_event_id' in input.inbox ? input.inbox.raw_event_id : input.inbox.rawEventId;
  const spaceId = 'space_id' in input.inbox ? input.inbox.space_id : input.inbox.spaceId;
  const sourceId = 'source_id' in input.inbox ? input.inbox.source_id : input.inbox.sourceId;
  const environment = input.inbox.environment;
  const eventId = 'event_id' in input.inbox ? input.inbox.event_id : input.inbox.eventId;
  const processor = 'processor' in input.inbox ? input.inbox.processor : journeyStageProcessor;
  const receiptId = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_event_processing_receipts
    (attempted_at,id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,
      processor_version,attempt_number,status,lease_token,lease_generation,checkpoint,error_code,error_detail_json,
      completed_at,retention_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        iso(input.attemptedAt), receiptId, rawReceivedAt, rawEventId, spaceId, sourceId, environment, eventId,
        processor, journeyStageProcessorVersion, input.attemptNumber, input.status, input.leaseToken,
        input.leaseGeneration, input.checkpoint, input.errorCode,
        JSON.stringify(input.errorCode ? { category: 'stage_processing', code: input.errorCode } : {}),
        iso(input.completedAt), iso(input.retentionExpiresAt)
      );
  return receiptId;
}

function claimRow(now: string) {
  const lock = db.provider === 'postgres' ? ' FOR UPDATE OF inbox SKIP LOCKED' : '';
  return db.prepare(`SELECT inbox.*,raw.retention_expires_at FROM journey_event_processing_inbox inbox
    JOIN journey_raw_events raw ON raw.received_at=inbox.raw_received_at AND raw.id=inbox.raw_event_id
      AND raw.space_id=inbox.space_id AND raw.source_id=inbox.source_id AND raw.environment=inbox.environment
      AND raw.event_id=inbox.event_id
    WHERE inbox.processor=? AND raw.ingest_state='accepted' AND (
      (inbox.state IN ('pending','retry_wait') AND inbox.available_at<=?)
      OR (inbox.state='leased' AND inbox.lease_expires_at<=?))
    ORDER BY CASE WHEN inbox.state='leased' THEN 0 ELSE 1 END,inbox.available_at,inbox.raw_received_at,inbox.raw_event_id
    LIMIT 1${lock}`).get(journeyStageProcessor, now, now) as InboxRow | undefined;
}

/** PostgreSQL uses row locks with SKIP LOCKED. SQLite's single-writer
 * transaction serialises the select-and-conditional-update safely. */
export function claimNextJourneyStageEvent(ownerId: string, now?: Date | string, leaseMs = config.journeyStageWorkerLeaseMs) {
  if (!ownerId || ownerId.length > 128) throw new JourneyStageProcessingError('Invalid worker owner.', 'EVENT_STAGE_WORKER_INVALID');
  const at = iso(now); const expiresAt = new Date(Date.parse(at) + leaseMs).toISOString();
  return db.transaction((): JourneyStageEventClaim | null => {
    const row = claimRow(at);
    if (!row) return null;
    const priorState = row.state; const priorToken = row.lease_token; const priorGeneration = Number(row.lease_generation);
    const priorAttempt = Number(row.attempt_count);
    if (priorState === 'leased') {
      appendProcessingReceipt({ inbox: row, attemptedAt: iso(row.updated_at), completedAt: at, status: 'lease_expired',
        leaseToken: priorToken, leaseGeneration: priorGeneration, attemptNumber: Math.max(1, priorAttempt),
        checkpoint: 'lease_recovery', errorCode: 'EVENT_PROCESSING_LEASE_EXPIRED',
        retentionExpiresAt: iso(row.retention_expires_at) });
    }
    const token = crypto.randomUUID(); const generation = priorGeneration + 1; const attempt = priorAttempt + 1;
    const changed = db.prepare(`UPDATE journey_event_processing_inbox SET state='leased',available_at=?,lease_owner=?,
      lease_token=?,lease_generation=?,lease_expires_at=?,attempt_count=?,last_error_code=NULL,updated_at=?
      WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND state=?
        AND lease_generation=? AND ((? IS NULL AND lease_token IS NULL) OR lease_token=?)`).run(
          at, ownerId, token, generation, expiresAt, attempt, at, row.raw_received_at, row.raw_event_id,
          journeyStageProcessor, priorState, priorGeneration, priorToken, priorToken
        ).changes;
    if (changed !== 1) return null;
    return { rawReceivedAt: iso(row.raw_received_at), rawEventId: row.raw_event_id, spaceId: row.space_id,
      sourceId: row.source_id, environment: row.environment, eventId: row.event_id, leaseOwner: ownerId,
      leaseToken: token, leaseGeneration: generation, attemptNumber: attempt, claimedAt: at, leaseExpiresAt: expiresAt };
  })();
}

function lockClaim(claim: JourneyStageEventClaim) {
  const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM journey_event_processing_inbox WHERE raw_received_at=? AND raw_event_id=?
    AND processor=? AND space_id=?${lock}`).get(
      claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor, claim.spaceId
    ) as InboxRow | undefined;
  if (!row || row.state !== 'leased' || row.lease_owner !== claim.leaseOwner || row.lease_token !== claim.leaseToken
      || Number(row.lease_generation) !== claim.leaseGeneration || Number(row.attempt_count) !== claim.attemptNumber) {
    throw new JourneyStageProcessingError('The stage-processing lease is no longer owned by this worker.',
      'EVENT_STAGE_PROCESSING_LEASE_LOST');
  }
  return row;
}

export function heartbeatJourneyStageEvent(claim: JourneyStageEventClaim, now?: Date | string,
  leaseMs = config.journeyStageWorkerLeaseMs) {
  const at = iso(now); const expiresAt = new Date(Date.parse(at) + leaseMs).toISOString();
  const changed = db.prepare(`UPDATE journey_event_processing_inbox SET lease_expires_at=?,updated_at=?
    WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND space_id=? AND state='leased'
      AND lease_owner=? AND lease_token=? AND lease_generation=?`).run(
        expiresAt, at, claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor, claim.spaceId,
        claim.leaseOwner, claim.leaseToken, claim.leaseGeneration
      ).changes;
  return changed === 1;
}

function rawForClaim(claim: JourneyStageEventClaim) {
  const row = db.prepare(`SELECT received_at,id,space_id,source_id,environment,event_id,event_call,event_name,
    occurred_at,schema_version_id,anonymous_id_hash,ingest_state,payload_json,envelope_sha256,retention_expires_at
    FROM journey_raw_events WHERE received_at=? AND id=? AND space_id=? AND source_id=? AND environment=? AND event_id=?`)
    .get(claim.rawReceivedAt, claim.rawEventId, claim.spaceId, claim.sourceId, claim.environment, claim.eventId) as RawRow | undefined;
  if (!row) throw new JourneyStageProcessingError('The claimed raw event no longer exists.', 'EVENT_STAGE_RAW_EVENT_MISSING');
  if (row.ingest_state !== 'accepted') throw new JourneyStageProcessingError(
    'Quarantined events cannot enter stage processing.', 'EVENT_STAGE_QUARANTINED_FORBIDDEN'
  );
  return { ...row, received_at: iso(row.received_at), occurred_at: iso(row.occurred_at),
    retention_expires_at: iso(row.retention_expires_at) };
}

function priorHistory(raw: RawRow) {
  if (!raw.anonymous_id_hash) return [];
  const rows = db.prepare(`SELECT id,event_id,event_name,occurred_at,source_id,environment,payload_json,anonymous_id_hash
    FROM journey_raw_events WHERE space_id=? AND source_id=? AND environment=? AND ingest_state='accepted'
      AND anonymous_id_hash=? AND event_name IS NOT NULL AND occurred_at<=?
      AND NOT (received_at=? AND id=?)
    ORDER BY occurred_at DESC,event_id DESC LIMIT ?`).all(
      raw.space_id, raw.source_id, raw.environment, raw.anonymous_id_hash, raw.occurred_at, raw.received_at, raw.id, 100
    ) as Array<Record<string, unknown>>;
  return buildJourneyStageRuleHistory(rows);
}

function sqlBoolean(value: boolean) { return db.provider === 'postgres' ? value : value ? 1 : 0; }

function applyRuleGroup(input: {
  raw: RawRow; claim: JourneyStageEventClaim; rules: PublishedJourneyStageRule[]; history: JourneyRuleEvent[]; evaluatedAt: string;
  evaluator?: typeof evaluateJourneyStageRules;
}) {
  const {
    mapVersionId, journeyDefinitionId, evaluation, matched, matchedVersion, ruleSetSha256, decisionKey,
    isLate, outcome, provenance
  } = evaluatePublishedJourneyStageRuleGroup({
    raw: input.raw,
    claim: input.claim,
    rules: input.rules,
    history: input.history,
    evaluatedAt: input.evaluatedAt,
    journeyStageProcessor,
    journeyStageProcessorVersion,
    errorFactory: (message, code) => new JourneyStageProcessingError(message, code),
    evaluator: input.evaluator
  });
  let instance: Record<string, unknown> | undefined;
  let outOfOrder = false;
  if (matched && input.raw.anonymous_id_hash) {
    const instanceId = crypto.createHash('sha256').update(
      [input.raw.space_id, input.raw.source_id, input.raw.environment, journeyDefinitionId, 'anonymous', input.raw.anonymous_id_hash].join('\u0000')
    ).digest('hex');
    db.prepare(`INSERT INTO journey_anonymous_instances
      (id,space_id,source_id,environment,journey_definition_id,subject_kind,anonymous_id_hash,state,current_stage_key,
        first_event_at,latest_event_at,latest_event_id,latest_visit_id,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,'anonymous',?,'active',NULL,?,?,?,NULL,1,?,?)
      ON CONFLICT(space_id,source_id,environment,journey_definition_id,anonymous_id_hash) DO NOTHING`).run(
        instanceId, input.raw.space_id, input.raw.source_id, input.raw.environment, journeyDefinitionId,
        input.raw.anonymous_id_hash, input.raw.occurred_at, input.raw.occurred_at, input.raw.event_id,
        input.evaluatedAt, input.evaluatedAt
      );
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    instance = db.prepare(`SELECT * FROM journey_anonymous_instances WHERE space_id=? AND source_id=?
      AND environment=? AND journey_definition_id=? AND anonymous_id_hash=?${lock}`).get(
        input.raw.space_id, input.raw.source_id, input.raw.environment, journeyDefinitionId, input.raw.anonymous_id_hash
      ) as Record<string, unknown>;
    outOfOrder = deriveAnonymousVisitApplication({
      instance: {
        state: String(instance.state),
        currentStageKey: instance.current_stage_key ? String(instance.current_stage_key) : null,
        latestEventAt: iso(instance.latest_event_at),
        latestEventId: String(instance.latest_event_id)
      },
      eventOccurredAt: input.raw.occurred_at,
      eventId: input.raw.event_id
    }).outOfOrder;
  }
  const decisionId = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_stage_rule_decisions
    (id,decision_key,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,journey_definition_id,
      journey_map_version_id,subject_kind,anonymous_id_hash,outcome,matched_rule_definition_id,matched_rule_version_id,
      matched_rule_version_number,stage_key,role,event_occurred_at,evaluated_at,is_late,is_out_of_order,
      rule_set_sha256,trace_json,provenance_json,processor,processor_version,lease_generation,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(raw_received_at,raw_event_id,journey_definition_id) DO NOTHING`).run(
      decisionId, decisionKey, input.raw.received_at, input.raw.id, input.raw.space_id, input.raw.source_id,
      input.raw.environment, input.raw.event_id, journeyDefinitionId, mapVersionId,
      input.raw.anonymous_id_hash ? 'anonymous' : null, input.raw.anonymous_id_hash, outcome,
      matched?.ruleId || null, matchedVersion?.id || null, matched?.ruleVersion || null, matched?.stageKey || null,
      matched?.role || null, input.raw.occurred_at, input.evaluatedAt, sqlBoolean(isLate), sqlBoolean(outOfOrder), ruleSetSha256,
      JSON.stringify({ eventMessageId: evaluation.eventMessageId, matches: evaluation.matches, traces: evaluation.traces }),
      JSON.stringify(provenance), journeyStageProcessor, journeyStageProcessorVersion, input.claim.leaseGeneration,
      input.evaluatedAt, input.raw.retention_expires_at
    );
  const durableDecision = db.prepare(`SELECT id FROM journey_stage_rule_decisions
    WHERE raw_received_at=? AND raw_event_id=? AND journey_definition_id=?`).get(
      input.raw.received_at, input.raw.id, journeyDefinitionId
    ) as { id: string };
  if (matched && matchedVersion && instance && input.raw.anonymous_id_hash) {
    const assignmentKey = matched.assignmentKey!;
    const visitId = crypto.createHash('sha256').update([assignmentKey, input.raw.source_id, input.raw.environment].join('\u0000')).digest('hex');
    const priorStage = instance.current_stage_key ? String(instance.current_stage_key) : null;
    const { applies, nonApplicationReason } = deriveAnonymousVisitApplication({
      instance: {
        state: String(instance.state),
        currentStageKey: priorStage,
        latestEventAt: iso(instance.latest_event_at),
        latestEventId: String(instance.latest_event_id)
      },
      eventOccurredAt: input.raw.occurred_at,
      eventId: input.raw.event_id
    });
    db.prepare(`INSERT INTO journey_anonymous_stage_visits
      (id,assignment_key,instance_id,decision_id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
        journey_definition_id,journey_map_version_id,subject_kind,stage_key,role,rule_definition_id,rule_version_id,
        rule_version_number,event_occurred_at,visited_at,is_late,is_out_of_order,applied_to_current,prior_stage_key,
        non_application_reason,provenance_json,created_at,retention_expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'anonymous',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(assignment_key) DO NOTHING`).run(
        visitId, assignmentKey, String(instance.id), durableDecision.id, input.raw.received_at, input.raw.id,
        input.raw.space_id, input.raw.source_id, input.raw.environment, input.raw.event_id, journeyDefinitionId,
        mapVersionId, matched.stageKey, matched.role, matched.ruleId, matchedVersion.id, matched.ruleVersion,
        input.raw.occurred_at, input.evaluatedAt, sqlBoolean(isLate), sqlBoolean(outOfOrder), sqlBoolean(applies), priorStage,
        nonApplicationReason,
        JSON.stringify({ decisionId: durableDecision.id, decisionKey, assignmentKey, ...provenance }),
        input.evaluatedAt, input.raw.retention_expires_at
      );
    if (applies) {
      // State is a pure function of the current applied visit role. A late but
      // still newest event may apply; an out-of-order visit is retained but can
      // never regress the instance watermark, stage or terminal state.
      db.prepare(`UPDATE journey_anonymous_instances SET state=?,current_stage_key=?,latest_event_at=?,
        latest_event_id=?,latest_visit_id=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=?`).run(
          stageInstanceState(matched.role), matched.stageKey, input.raw.occurred_at, input.raw.event_id, visitId,
          input.evaluatedAt, instance.id, input.raw.space_id
        );
    }
  }
  return { decisionId: durableDecision.id, journeyDefinitionId, outcome, matched: Boolean(matched), outOfOrder, isLate };
}

export function processJourneyStageEvent(claim: JourneyStageEventClaim, options: {
  now?: Date | string; evaluator?: typeof evaluateJourneyStageRules; beforeCommit?: () => void;
} = {}) {
  const evaluatedAt = iso(options.now);
  return db.transaction(() => {
    lockClaim(claim);
    const raw = rawForClaim(claim);
    const results: Array<Record<string, unknown>> = [];
    if (raw.event_name) {
      const rules = publishedJourneyStageRules(raw.space_id, raw.event_name);
      const history = priorHistory(raw);
      for (const group of groupPublishedJourneyStageRules(rules).values()) {
        results.push(applyRuleGroup({ raw, claim, rules: group, history, evaluatedAt, evaluator: options.evaluator }));
      }
    }
    options.beforeCommit?.();
    appendProcessingReceipt({ inbox: claim, attemptedAt: claim.claimedAt, completedAt: evaluatedAt,
      status: 'succeeded', leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration,
      attemptNumber: claim.attemptNumber, checkpoint: results.length ? 'stage_projection_committed' : 'no_published_rules',
      errorCode: null, retentionExpiresAt: raw.retention_expires_at });
    const changed = db.prepare(`UPDATE journey_event_processing_inbox SET state='completed',available_at=?,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=?
      WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND state='leased' AND lease_owner=?
        AND lease_token=? AND lease_generation=?`).run(
          evaluatedAt, evaluatedAt, claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor,
          claim.leaseOwner, claim.leaseToken, claim.leaseGeneration
        ).changes;
    if (changed !== 1) throw new JourneyStageProcessingError('The processing lease was lost before commit.',
      'EVENT_STAGE_PROCESSING_LEASE_LOST');
    db.prepare(`UPDATE journey_event_dead_letters SET state='resolved',replay_eligible=FALSE,replay_after=NULL,
      resolved_at=?,resolution_code='EVENT_REPLAY_SUCCEEDED',updated_at=?
      WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND state='replay_scheduled'`).run(
        evaluatedAt, evaluatedAt, claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor
      );
    return { claim, decisions: results, completedAt: evaluatedAt };
  })();
}

export function failJourneyStageEvent(claim: JourneyStageEventClaim, error: unknown, now?: Date | string) {
  const at = iso(now); const code = redactedErrorCode(error);
  const retryable = error instanceof JourneyStageProcessingError ? error.retryable : true;
  return db.transaction(() => {
    lockClaim(claim);
    const raw = rawForClaim(claim);
    const shouldRetry = retryable && claim.attemptNumber < journeyStageMaxAttempts;
    const status = shouldRetry ? 'retryable_failed' : 'terminal_failed';
    const receiptId = appendProcessingReceipt({ inbox: claim, attemptedAt: claim.claimedAt, completedAt: at,
      status, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration, attemptNumber: claim.attemptNumber,
      checkpoint: shouldRetry ? 'retry_scheduled' : 'dead_lettered', errorCode: code,
      retentionExpiresAt: raw.retention_expires_at });
    if (shouldRetry) {
      const delay = Math.min(10 * 60_000, 5_000 * (2 ** Math.max(0, claim.attemptNumber - 1)));
      const available = new Date(Date.parse(at) + delay).toISOString();
      const changed = db.prepare(`UPDATE journey_event_processing_inbox SET state='retry_wait',available_at=?,lease_owner=NULL,
        lease_token=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=?
        WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND state='leased' AND lease_token=?
          AND lease_generation=?`).run(
            available, code, at, claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor,
            claim.leaseToken, claim.leaseGeneration
          ).changes;
      if (changed !== 1) throw new JourneyStageProcessingError(
        'The processing lease was lost before retry scheduling.', 'EVENT_STAGE_PROCESSING_LEASE_LOST'
      );
      return { state: 'retry_wait' as const, availableAt: available, code };
    }
    const replayEligible = retryable;
    const state = replayEligible ? 'pending' : 'terminal';
    const resolvedAt = replayEligible ? null : at;
    const resolutionCode = replayEligible ? null : 'EVENT_NON_RETRYABLE_FAILURE';
    db.prepare(`INSERT INTO journey_event_dead_letters
      (id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,failure_code,
        redacted_detail_json,attempt_count,replay_eligible,replay_after,last_processing_receipt_id,
        last_processing_attempted_at,resolved_at,resolution_code,updated_at,retention_expires_at)
      VALUES (?,?,?,?,?,?,?,? ,?,?,?, ?,?,?,?, ?,?,?,?,?)
      ON CONFLICT(raw_received_at,raw_event_id,processor) DO UPDATE SET state=excluded.state,
        failure_code=excluded.failure_code,redacted_detail_json=excluded.redacted_detail_json,
        attempt_count=excluded.attempt_count,replay_eligible=excluded.replay_eligible,
        replay_after=excluded.replay_after,last_processing_receipt_id=excluded.last_processing_receipt_id,
        last_processing_attempted_at=excluded.last_processing_attempted_at,resolved_at=excluded.resolved_at,
        resolution_code=excluded.resolution_code,updated_at=excluded.updated_at`).run(
          crypto.randomUUID(), raw.received_at, raw.id, raw.space_id, raw.source_id, raw.environment, raw.event_id,
          journeyStageProcessor, state, code, JSON.stringify({ category: 'stage_processing', code }),
          claim.attemptNumber, sqlBoolean(replayEligible), replayEligible ? at : null, receiptId, claim.claimedAt,
          resolvedAt, resolutionCode, at, raw.retention_expires_at
        );
    const changed = db.prepare(`UPDATE journey_event_processing_inbox SET state='dead_lettered',available_at=?,lease_owner=NULL,
      lease_token=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=?
      WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND state='leased' AND lease_token=?
        AND lease_generation=?`).run(
          at, code, at, claim.rawReceivedAt, claim.rawEventId, journeyStageProcessor,
          claim.leaseToken, claim.leaseGeneration
        ).changes;
    if (changed !== 1) throw new JourneyStageProcessingError(
      'The processing lease was lost before dead-lettering.', 'EVENT_STAGE_PROCESSING_LEASE_LOST'
    );
    return { state: 'dead_lettered' as const, code, replayEligible };
  })();
}

export function journeyStageProcessingStatus(spaceId: string) {
  const rows = db.prepare(`SELECT state,COUNT(*) count FROM journey_event_processing_inbox
    WHERE space_id=? AND processor=? GROUP BY state`).all(spaceId, journeyStageProcessor) as Array<{ state: string; count: number | string }>;
  const counts = Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  return { processor: journeyStageProcessor, processorVersion: journeyStageProcessorVersion, ...counts };
}

export function journeyAnonymousInstanceAggregates(spaceId: string, journeyDefinitionId: string) {
  const total = Number((db.prepare(`SELECT COUNT(*) count FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=?`).get(spaceId, journeyDefinitionId) as any)?.count || 0);
  const stateRows = db.prepare(`SELECT state,COUNT(*) count FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=? GROUP BY state`).all(spaceId, journeyDefinitionId) as Array<{ state: string; count: number | string }>;
  const stageRows = db.prepare(`SELECT current_stage_key,COUNT(*) count FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=? AND current_stage_key IS NOT NULL GROUP BY current_stage_key`)
    .all(spaceId, journeyDefinitionId) as Array<{ current_stage_key: string; count: number | string }>;
  return { total, byState: Object.fromEntries(stateRows.map((row) => [row.state, Number(row.count)])),
    byStage: Object.fromEntries(stageRows.map((row) => [row.current_stage_key, Number(row.count)])) };
}

export function listJourneyAnonymousInstances(spaceId: string, journeyDefinitionId: string, limit = 50) {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = db.prepare(`SELECT id,source_id,environment,state,current_stage_key,first_event_at,latest_event_at,
    latest_event_id,latest_visit_id,revision,created_at,updated_at FROM journey_anonymous_instances
    WHERE space_id=? AND journey_definition_id=? ORDER BY updated_at DESC,id LIMIT ?`)
    .all(spaceId, journeyDefinitionId, bounded) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ id: row.id, sourceId: row.source_id, environment: row.environment,
    subjectKind: 'anonymous', state: row.state, currentStageKey: row.current_stage_key,
    firstEventAt: row.first_event_at, latestEventAt: row.latest_event_at, latestEventId: row.latest_event_id,
    latestVisitId: row.latest_visit_id, revision: Number(row.revision), createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function getJourneyAnonymousInstance(spaceId: string, journeyDefinitionId: string, instanceId: string) {
  const instance = db.prepare(`SELECT id,source_id,environment,state,current_stage_key,first_event_at,latest_event_at,
    latest_event_id,latest_visit_id,revision,created_at,updated_at FROM journey_anonymous_instances
    WHERE id=? AND space_id=? AND journey_definition_id=?`).get(instanceId, spaceId, journeyDefinitionId) as Record<string, unknown> | undefined;
  if (!instance) throw new JourneyStageProcessingError(
    'Anonymous journey instance not found.', 'JOURNEY_INSTANCE_NOT_FOUND', false, 404
  );
  const visits = db.prepare(`SELECT id,decision_id,event_id,journey_map_version_id,stage_key,role,rule_definition_id,
    rule_version_id,rule_version_number,event_occurred_at,visited_at,is_late,is_out_of_order,applied_to_current,
    non_application_reason,prior_stage_key FROM journey_anonymous_stage_visits WHERE instance_id=? AND space_id=?
      AND journey_definition_id=? ORDER BY event_occurred_at,id LIMIT 1000`).all(
        instanceId, spaceId, journeyDefinitionId
      ) as Array<Record<string, unknown>>;
  return {
    instance: { id: instance.id, sourceId: instance.source_id, environment: instance.environment,
      subjectKind: 'anonymous', state: instance.state, currentStageKey: instance.current_stage_key,
      firstEventAt: instance.first_event_at, latestEventAt: instance.latest_event_at,
      latestEventId: instance.latest_event_id, latestVisitId: instance.latest_visit_id,
      revision: Number(instance.revision), createdAt: instance.created_at, updatedAt: instance.updated_at },
    visits: visits.map((row) => ({ id: row.id, decisionId: row.decision_id, eventId: row.event_id,
      journeyMapVersionId: row.journey_map_version_id, stageKey: row.stage_key, role: row.role,
      ruleDefinitionId: row.rule_definition_id, ruleVersionId: row.rule_version_id,
      ruleVersionNumber: Number(row.rule_version_number), eventOccurredAt: row.event_occurred_at,
      visitedAt: row.visited_at, isLate: Boolean(row.is_late), isOutOfOrder: Boolean(row.is_out_of_order),
      appliedToCurrent: Boolean(row.applied_to_current), nonApplicationReason: row.non_application_reason,
      priorStageKey: row.prior_stage_key }))
  };
}

export class JourneyStageProcessingRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  readonly ownerId: string;
  constructor(ownerId = `journey-stage-${process.pid}-${crypto.randomUUID()}`) { this.ownerId = ownerId; }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.pump(), config.journeyStageWorkerPollMs);
    this.timer.unref(); this.pump();
  }
  pump() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      for (let count = 0; count < config.journeyStageWorkerBatchSize; count += 1) {
        const claim = claimNextJourneyStageEvent(this.ownerId);
        if (!claim) break;
        try {
          const result = processJourneyStageEvent(claim);
          publishEvent('data-changed', { reason: 'journey-stage-processed', eventId: claim.eventId }, claim.spaceId);
          void result;
        } catch (error) {
          if (error instanceof JourneyStageProcessingError && error.code === 'EVENT_STAGE_PROCESSING_LEASE_LOST') continue;
          try { failJourneyStageEvent(claim, error); }
          catch (failure) {
            if (!(failure instanceof JourneyStageProcessingError)
                || failure.code !== 'EVENT_STAGE_PROCESSING_LEASE_LOST') throw failure;
          }
        }
      }
    } finally { this.running = false; }
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return !this.running;
  }
  status(spaceId: string) { return { running: !this.stopped, active: this.running ? 1 : 0, ...journeyStageProcessingStatus(spaceId) }; }
}

export const journeyStageProcessingRunner = new JourneyStageProcessingRunner();
