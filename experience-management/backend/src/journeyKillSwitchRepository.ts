import crypto from 'node:crypto';
import { db } from './database.js';
import { isPlatformAdmin } from './auth.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';
import {
  assertKillSwitchReasonCode, assertKillSwitchScope, buildKillSwitchAuditDetail, JourneyKillSwitchDomainError,
  KILL_SWITCH_GATE_KEYS, KILL_SWITCH_LEVELS, planKillSwitchPause, resolveEffectiveKillSwitch,
  resolveKillSwitchForWork, type KillSwitchLevel, type KillSwitchRecord, type KillSwitchState
} from './journeyKillSwitchDomain.js';

export class JourneyKillSwitchRepositoryError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_KILL_SWITCH_INVALID',
    public details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'JourneyKillSwitchRepositoryError';
  }
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/**
 * SQLite parity for runtime-40. PostgreSQL gets the same shape from the staged
 * migration; this keeps the single-file runtime honest rather than letting the
 * two engines drift into different guarantees.
 */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_kill_switch_states (
      id TEXT PRIMARY KEY,
      scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
      space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
      scope_key TEXT NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 128),
      state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
      reason_code TEXT NOT NULL CHECK(reason_code IN ('operational_incident','safety_incident','compliance_hold',
        'maintenance','cost_control','governance_review','recovery_verified')),
      revision INTEGER NOT NULL CHECK(revision>0),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK((scope_level='platform' AND space_id IS NULL AND scope_key='platform')
        OR (scope_level<>'platform' AND space_id IS NOT NULL)),
      CHECK(scope_level<>'space' OR scope_key=space_id),
      CHECK(scope_level<>'profile' OR (length(scope_key)=64 AND scope_key NOT GLOB '*[^a-f0-9]*')),
      CHECK(updated_at>=created_at));
    CREATE UNIQUE INDEX IF NOT EXISTS journey_kill_switch_platform_singleton
      ON journey_kill_switch_states(scope_level) WHERE scope_level='platform';
    CREATE UNIQUE INDEX IF NOT EXISTS journey_kill_switch_tenant_scope
      ON journey_kill_switch_states(scope_level,space_id,scope_key) WHERE space_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS journey_kill_switch_mutations (
      id TEXT PRIMARY KEY,
      state_id TEXT NOT NULL REFERENCES journey_kill_switch_states(id) ON DELETE NO ACTION,
      scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
      space_id TEXT REFERENCES spaces(id) ON DELETE NO ACTION, scope_key TEXT NOT NULL,
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
      requested_state TEXT NOT NULL CHECK(requested_state IN ('enabled','disabled')),
      resulting_revision INTEGER NOT NULL CHECK(resulting_revision>0),
      paused_count INTEGER NOT NULL CHECK(paused_count>=0),
      released_lease_count INTEGER NOT NULL CHECK(released_lease_count>=0),
      resumed_count INTEGER NOT NULL CHECK(resumed_count>=0),
      still_disabled_count INTEGER NOT NULL CHECK(still_disabled_count>=0),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(state_id,idempotency_key));
    CREATE INDEX IF NOT EXISTS journey_kill_switch_mutation_list
      ON journey_kill_switch_mutations(state_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_kill_switch_pauses (
      id TEXT PRIMARY KEY,
      state_id TEXT NOT NULL REFERENCES journey_kill_switch_states(id) ON DELETE NO ACTION,
      mutation_id TEXT NOT NULL REFERENCES journey_kill_switch_mutations(id) ON DELETE NO ACTION,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION, queue_id TEXT NOT NULL,
      previous_state TEXT NOT NULL CHECK(previous_state IN ('ready','retry_scheduled','leased')),
      lease_released INTEGER NOT NULL CHECK(lease_released IN (0,1)),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=0),
      reason_code TEXT NOT NULL CHECK(reason_code IN ('platform_kill_switch','space_kill_switch',
        'workflow_kill_switch','adapter_kill_switch','profile_kill_switch')),
      created_at TEXT NOT NULL, UNIQUE(mutation_id,queue_id),
      FOREIGN KEY(queue_id,space_id) REFERENCES journey_action_queue(id,space_id) ON DELETE NO ACTION,
      CHECK((previous_state='leased' AND lease_released=1) OR (previous_state<>'leased' AND lease_released=0)));
    CREATE INDEX IF NOT EXISTS journey_kill_switch_pause_open
      ON journey_kill_switch_pauses(state_id,space_id,queue_id,id);
    CREATE TABLE IF NOT EXISTS journey_kill_switch_resumptions (
      id TEXT PRIMARY KEY,
      pause_id TEXT NOT NULL REFERENCES journey_kill_switch_pauses(id) ON DELETE NO ACTION,
      mutation_id TEXT NOT NULL REFERENCES journey_kill_switch_mutations(id) ON DELETE NO ACTION,
      space_id TEXT NOT NULL, queue_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('requeued','skipped_state_changed','skipped_terminal','skipped_missing')),
      created_at TEXT NOT NULL, UNIQUE(pause_id));
    CREATE INDEX IF NOT EXISTS journey_kill_switch_resumption_list
      ON journey_kill_switch_resumptions(mutation_id,queue_id,id);
    CREATE TABLE IF NOT EXISTS journey_kill_switch_audit (
      id TEXT PRIMARY KEY, space_id TEXT REFERENCES spaces(id) ON DELETE NO ACTION,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      authority TEXT NOT NULL CHECK(authority IN ('platform_admin','space_manager')),
      action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
      scope_level TEXT NOT NULL CHECK(scope_level IN ('platform','space','workflow','adapter','profile')),
      scope_key TEXT NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 128),
      detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
        CHECK(json_type(detail_json,'$.payload') IS NULL AND json_type(detail_json,'$.payloadJson') IS NULL
          AND json_type(detail_json,'$.payload_json') IS NULL AND json_type(detail_json,'$.content') IS NULL
          AND json_type(detail_json,'$.body') IS NULL AND json_type(detail_json,'$.message') IS NULL
          AND json_type(detail_json,'$.subject') IS NULL AND json_type(detail_json,'$.subjectId') IS NULL
          AND json_type(detail_json,'$.recipient') IS NULL AND json_type(detail_json,'$.email') IS NULL
          AND json_type(detail_json,'$.identifier') IS NULL AND json_type(detail_json,'$.identifiers') IS NULL
          AND json_type(detail_json,'$.secret') IS NULL AND json_type(detail_json,'$.token') IS NULL
          AND json_type(detail_json,'$.credential') IS NULL AND json_type(detail_json,'$.apiKey') IS NULL
          AND json_type(detail_json,'$.api_key') IS NULL),
      detail_sha256 TEXT NOT NULL CHECK(length(detail_sha256)=64),
      created_at TEXT NOT NULL,
      CHECK(scope_level<>'platform' OR space_id IS NULL));
    CREATE INDEX IF NOT EXISTS journey_kill_switch_audit_list
      ON journey_kill_switch_audit(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_mutations_append_only
      BEFORE UPDATE ON journey_kill_switch_mutations BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_mutations_delete_guard
      BEFORE DELETE ON journey_kill_switch_mutations BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_pauses_append_only
      BEFORE UPDATE ON journey_kill_switch_pauses BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_pauses_delete_guard
      BEFORE DELETE ON journey_kill_switch_pauses BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_resumptions_append_only
      BEFORE UPDATE ON journey_kill_switch_resumptions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_resumptions_delete_guard
      BEFORE DELETE ON journey_kill_switch_resumptions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_audit_append_only
      BEFORE UPDATE ON journey_kill_switch_audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_kill_switch_audit_delete_guard
      BEFORE DELETE ON journey_kill_switch_audit BEGIN SELECT RAISE(ABORT,'append-only'); END;`);
}
ensureSqliteSchema();

/** The action queue belongs to runtime-36; treat it as optional so this foundation stands alone. */
function actionQueueAvailable() {
  try {
    if (db.provider === 'sqlite') {
      return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journey_action_queue'").get());
    }
    return Boolean(db.prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='journey_action_queue'").get());
  } catch { return false; }
}

type Authority = 'platform_admin' | 'space_manager';

function membershipRole(spaceId: string, userId: string) {
  const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId) as
    { role?: string } | undefined;
  if (!row) {
    throw new JourneyKillSwitchRepositoryError(
      'Space membership is required.', 403, 'JOURNEY_KILL_SWITCH_MEMBERSHIP_REQUIRED');
  }
  return String(row.role);
}

/**
 * Authority is split on purpose. Only a platform admin can stop or restart the
 * whole platform; a space manager governs their own tenant and nothing above
 * it. A plain member may read, because knowing why work is paused is not a
 * privileged act, but may not operate the switch.
 */
function assertAuthority(level: KillSwitchLevel, spaceId: string | null, actorUserId: string): Authority {
  if (level === 'platform') {
    if (!isPlatformAdmin(actorUserId)) {
      throw new JourneyKillSwitchRepositoryError(
        'Platform administrator access is required for the platform kill switch.',
        403, 'JOURNEY_KILL_SWITCH_PLATFORM_ADMIN_REQUIRED');
    }
    return 'platform_admin';
  }
  if (!spaceId) {
    throw new JourneyKillSwitchRepositoryError(
      'A tenant is required for this kill switch level.', 400, 'JOURNEY_KILL_SWITCH_TENANT_REQUIRED');
  }
  assertSubscriptionFeature(spaceId, 'journeyOrchestration');
  membershipRole(spaceId, actorUserId);
  if (!effectiveJourneyRole(spaceId, actorUserId).capabilities.has('journeys.review')) {
    throw new JourneyKillSwitchRepositoryError(
      'Journey review capability is required to operate this kill switch.',
      403, 'JOURNEY_KILL_SWITCH_REVIEW_REQUIRED');
  }
  return 'space_manager';
}

function assertReadAccess(spaceId: string, actorUserId: string) {
  if (isPlatformAdmin(actorUserId)) return;
  assertSubscriptionFeature(spaceId, 'journeyOrchestration');
  membershipRole(spaceId, actorUserId);
  if (!effectiveJourneyRole(spaceId, actorUserId).capabilities.has('journeys.read')) {
    throw new JourneyKillSwitchRepositoryError(
      'Journey read capability is required.', 403, 'JOURNEY_KILL_SWITCH_READ_REQUIRED');
  }
}

function stateRow(level: KillSwitchLevel, spaceId: string | null, scopeKey: string) {
  return level === 'platform'
    ? db.prepare("SELECT * FROM journey_kill_switch_states WHERE scope_level='platform' AND space_id IS NULL").get()
    : db.prepare('SELECT * FROM journey_kill_switch_states WHERE scope_level=? AND space_id=? AND scope_key=?')
      .get(level, spaceId, scopeKey);
}

function publicState(row: any) {
  return {
    scopeLevel: String(row.scope_level) as KillSwitchLevel, spaceId: row.space_id ? String(row.space_id) : null,
    scopeKey: String(row.scope_key), state: String(row.state) as KillSwitchState,
    reasonCode: String(row.reason_code), revision: Number(row.revision),
    gateKey: KILL_SWITCH_GATE_KEYS[String(row.scope_level) as KillSwitchLevel],
    updatedAt: String(row.updated_at)
  };
}

const asRecord = (row: any): KillSwitchRecord | null =>
  row ? { scopeKey: String(row.scope_key), state: row.state, revision: Number(row.revision) } : null;

function recordsForWork(input: {
  spaceId: string; workflowId?: string | null; adapter?: string | null; profileRefSha256?: string | null;
}) {
  return {
    platform: asRecord(stateRow('platform', null, 'platform')),
    space: asRecord(stateRow('space', input.spaceId, input.spaceId)),
    workflow: input.workflowId ? asRecord(stateRow('workflow', input.spaceId, input.workflowId)) : null,
    adapter: input.adapter ? asRecord(stateRow('adapter', input.spaceId, input.adapter)) : null,
    profile: input.profileRefSha256 ? asRecord(stateRow('profile', input.spaceId, input.profileRefSha256)) : null
  };
}

/**
 * Server-derived resolution. The caller says which work it is asking about; it
 * never says what the answer should be.
 */
export function resolveKillSwitch(input: {
  actorUserId: string; spaceId: string; workflowId?: string | null; adapter?: string | null;
  profileRefSha256?: string | null;
}) {
  assertReadAccess(input.spaceId, input.actorUserId);
  const resolution = resolveKillSwitchForWork({ ...input, records: recordsForWork(input) });
  return { spaceId: input.spaceId, workflowId: input.workflowId ?? null, adapter: input.adapter ?? null,
    profileRefSha256: input.profileRefSha256 ?? null, resolution };
}

export function listKillSwitches(input: { actorUserId: string; spaceId: string }) {
  assertReadAccess(input.spaceId, input.actorUserId);
  const platform = stateRow('platform', null, 'platform');
  const scoped = db.prepare(
    'SELECT * FROM journey_kill_switch_states WHERE space_id=? ORDER BY scope_level,scope_key').all(input.spaceId) as any[];
  return {
    platform: platform ? publicState(platform) : null,
    scopes: scoped.map(publicState),
    effective: resolveEffectiveKillSwitch({
      platform: asRecord(platform), space: asRecord(stateRow('space', input.spaceId, input.spaceId))
    })
  };
}

export function readPlatformKillSwitch(input: { actorUserId: string }) {
  if (!isPlatformAdmin(input.actorUserId)) throw new JourneyKillSwitchRepositoryError(
    'Platform administrator access is required.', 403, 'JOURNEY_KILL_SWITCH_PLATFORM_ADMIN_REQUIRED');
  const row = stateRow('platform', null, 'platform');
  return { switch: row ? publicState(row) : null,
    effective: resolveEffectiveKillSwitch({ platform: asRecord(row) }) };
}

export function listKillSwitchAudit(input: { actorUserId: string; spaceId: string; limit?: number }) {
  assertReadAccess(input.spaceId, input.actorUserId);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
  const rows = db.prepare(`SELECT id,space_id,authority,action,scope_level,scope_key,detail_json,detail_sha256,created_at
    FROM journey_kill_switch_audit WHERE space_id=? ORDER BY created_at DESC,id LIMIT ?`).all(input.spaceId, limit) as any[];
  return rows.map((row) => ({
    id: String(row.id), authority: String(row.authority), action: String(row.action),
    scopeLevel: String(row.scope_level), scopeKey: String(row.scope_key),
    detail: JSON.parse(String(row.detail_json)), detailSha256: String(row.detail_sha256),
    createdAt: String(row.created_at)
  }));
}

type PauseOutcome = { paused: number; releasedLeases: number; plans: Array<{
  queueId: string; spaceId: string; previousState: 'ready' | 'retry_scheduled' | 'leased';
  leaseReleased: boolean; fencingToken: number; }>; };

function pauseWorkInScope(level: KillSwitchLevel, spaceId: string | null, scopeKey: string, at: string): PauseOutcome {
  const empty: PauseOutcome = { paused: 0, releasedLeases: 0, plans: [] };
  if (!actionQueueAvailable()) return empty;
  const reasonCode = KILL_SWITCH_GATE_KEYS[level];
  const active = "q.state IN ('ready','retry_scheduled','leased')";
  const select = 'SELECT q.id,q.state,q.fencing_token,q.space_id FROM journey_action_queue q';
  let rows: any[] = [];
  if (level === 'platform') rows = db.prepare(`${select} WHERE ${active}`).all() as any[];
  else if (level === 'space') rows = db.prepare(`${select} WHERE q.space_id=? AND ${active}`).all(spaceId) as any[];
  else if (level === 'workflow') {
    rows = db.prepare(`${select} WHERE q.space_id=? AND q.workflow_id=? AND ${active}`).all(spaceId, scopeKey) as any[];
  } else if (level === 'adapter') {
    rows = db.prepare(`${select} WHERE q.space_id=? AND q.adapter=? AND ${active}`).all(spaceId, scopeKey) as any[];
  } else {
    rows = db.prepare(`${select}
      JOIN journey_workflow_actions a ON a.id=q.action_id AND a.space_id=q.space_id
      JOIN journey_workflow_runs r ON r.id=a.run_id AND r.space_id=a.space_id
      WHERE q.space_id=? AND r.subject_ref_sha256=? AND ${active}`).all(spaceId, scopeKey) as any[];
  }

  const outcome: PauseOutcome = { paused: 0, releasedLeases: 0, plans: [] };
  for (const row of rows) {
    const plan = planKillSwitchPause({ id: String(row.id), state: row.state, fencingToken: Number(row.fencing_token) });
    if (plan.action === 'ignore' || !plan.previousState) continue;
    const changed = plan.action === 'release_and_pause'
      ? db.prepare(`UPDATE journey_action_queue SET state='held',hold_reason_code=?,lease_owner_sha256=NULL,
          lease_token=NULL,lease_expires_at=NULL,fencing_token=fencing_token+1,revision=revision+1,updated_at=?
          WHERE id=? AND space_id=? AND state='leased'`).run(reasonCode, at, plan.queueId, String(row.space_id))
      : db.prepare(`UPDATE journey_action_queue SET state='held',hold_reason_code=?,revision=revision+1,updated_at=?
          WHERE id=? AND space_id=? AND state=?`).run(reasonCode, at, plan.queueId, String(row.space_id), plan.previousState);
    if (!changed.changes) continue;
    outcome.paused += 1;
    if (plan.leaseReleased) outcome.releasedLeases += 1;
    outcome.plans.push({ queueId: plan.queueId, spaceId: String(row.space_id), previousState: plan.previousState,
      leaseReleased: plan.leaseReleased, fencingToken: plan.nextFencingToken });
  }
  return outcome;
}

type ResumeOutcome = { resumed: number; stillDisabled: number; records: Array<{
  pauseId: string; spaceId: string; queueId: string;
  outcome: 'requeued' | 'skipped_state_changed' | 'skipped_terminal' | 'skipped_missing'; }>; };

/**
 * Recovery re-evaluates rather than blindly restoring. A row paused by this
 * scope is only requeued when the full five-level resolution now allows it, so
 * lifting a space switch cannot resurrect work that the platform switch, or a
 * narrower switch, still stops. A row that is still stopped keeps its open
 * pause record, so whichever scope lifts last is the one that requeues it.
 */
function resumeWorkInScope(level: KillSwitchLevel, scopeSpaceId: string | null, scopeKey: string,
  at: string): ResumeOutcome {
  const outcome: ResumeOutcome = { resumed: 0, stillDisabled: 0, records: [] };
  if (!actionQueueAvailable()) return outcome;
  const select = `SELECT p.id,p.space_id,p.queue_id,p.previous_state,q.state,q.hold_reason_code,q.workflow_id,
    q.adapter,w.state workflow_state,w.paused workflow_paused,run.subject_ref_sha256
    FROM journey_kill_switch_pauses p
    JOIN journey_action_queue q ON q.id=p.queue_id AND q.space_id=p.space_id
    LEFT JOIN journey_workflow_definitions w ON w.id=q.workflow_id AND w.space_id=q.space_id
    LEFT JOIN journey_workflow_actions a ON a.id=q.action_id AND a.space_id=q.space_id
    LEFT JOIN journey_workflow_runs run ON run.id=a.run_id AND run.space_id=a.space_id
    WHERE NOT EXISTS (SELECT 1 FROM journey_kill_switch_resumptions resumed WHERE resumed.pause_id=p.id)`;
  let open: any[];
  if (level === 'platform') open = db.prepare(`${select} ORDER BY p.created_at,p.id`).all() as any[];
  else if (level === 'space') open = db.prepare(`${select} AND q.space_id=? ORDER BY p.created_at,p.id`)
    .all(scopeSpaceId) as any[];
  else if (level === 'workflow') open = db.prepare(
    `${select} AND q.space_id=? AND q.workflow_id=? ORDER BY p.created_at,p.id`).all(scopeSpaceId, scopeKey) as any[];
  else if (level === 'adapter') open = db.prepare(
    `${select} AND q.space_id=? AND q.adapter=? ORDER BY p.created_at,p.id`).all(scopeSpaceId, scopeKey) as any[];
  else open = db.prepare(
    `${select} AND q.space_id=? AND run.subject_ref_sha256=? ORDER BY p.created_at,p.id`)
    .all(scopeSpaceId, scopeKey) as any[];

  const killReasons = new Set<string>(Object.values(KILL_SWITCH_GATE_KEYS));
  const requiredSafetyGates = ['consent', 'suppression', 'entitlement', 'quota', 'quiet_hours',
    'frequency_cap', 'source_state'];

  for (const pause of open) {
    const queueId = String(pause.queue_id);
    const spaceId = String(pause.space_id);
    if (['succeeded', 'dead_letter', 'cancelled'].includes(String(pause.state))) {
      outcome.records.push({ pauseId: String(pause.id), spaceId, queueId, outcome: 'skipped_terminal' });
      continue;
    }
    if (String(pause.state) !== 'held' || !killReasons.has(String(pause.hold_reason_code || ''))) {
      outcome.records.push({ pauseId: String(pause.id), spaceId, queueId, outcome: 'skipped_state_changed' });
      continue;
    }
    const resolution = resolveKillSwitchForWork({
      spaceId, workflowId: pause.workflow_id ? String(pause.workflow_id) : null,
      adapter: pause.adapter ? String(pause.adapter) : null,
      profileRefSha256: pause.subject_ref_sha256 ? String(pause.subject_ref_sha256) : null,
      records: recordsForWork({
        spaceId, workflowId: pause.workflow_id ? String(pause.workflow_id) : null,
        adapter: pause.adapter ? String(pause.adapter) : null,
        profileRefSha256: pause.subject_ref_sha256 ? String(pause.subject_ref_sha256) : null
      })
    });
    if (resolution.decision === 'deny') {
      const blockedReason = resolution.blockedLevel ? KILL_SWITCH_GATE_KEYS[resolution.blockedLevel]
        : KILL_SWITCH_GATE_KEYS.platform;
      db.prepare(`UPDATE journey_action_queue SET hold_reason_code=?,revision=revision+1,updated_at=?
        WHERE id=? AND space_id=? AND state='held' AND hold_reason_code<>?`)
        .run(blockedReason, at, queueId, spaceId, blockedReason);
      outcome.stillDisabled += 1;
      continue;
    }
    const gates = db.prepare(`SELECT gate_key,decision FROM journey_action_gate_resolutions
      WHERE queue_id=? AND space_id=? AND gate_key IN ('consent','suppression','entitlement','quota','quiet_hours',
      'frequency_cap','source_state')`).all(queueId, spaceId) as Array<{ gate_key: string; decision: string }>;
    const gateDecisions = new Map(gates.map((gate) => [String(gate.gate_key), String(gate.decision)]));
    const gatesAllowed = requiredSafetyGates.every((gate) => gateDecisions.get(gate) === 'allow');
    const workflowRunnable = String(pause.workflow_state) === 'published' && Number(pause.workflow_paused) === 0;
    if (!gatesAllowed || !workflowRunnable) { outcome.stillDisabled += 1; continue; }
    const nextState = String(pause.previous_state) === 'retry_scheduled' ? 'retry_scheduled' : 'ready';
    const changed = db.prepare(`UPDATE journey_action_queue SET state=?,hold_reason_code=NULL,available_at=?,
      revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND state='held'`)
      .run(nextState, at, at, queueId, spaceId);
    if (!changed.changes) {
      outcome.records.push({ pauseId: String(pause.id), spaceId, queueId, outcome: 'skipped_state_changed' });
      continue;
    }
    outcome.resumed += 1;
    outcome.records.push({ pauseId: String(pause.id), spaceId, queueId, outcome: 'requeued' });
  }
  return outcome;
}

function mutationReplay(stateId: string, idempotencyKey: string) {
  return db.prepare('SELECT * FROM journey_kill_switch_mutations WHERE state_id=? AND idempotency_key=?')
    .get(stateId, idempotencyKey) as any;
}

function mutationResult(row: any, state: any, replayed: boolean, changed: boolean) {
  return {
    switch: publicState(state), replayed, changed,
    mutationId: String(row.id), idempotencyKey: String(row.idempotency_key),
    pausedCount: Number(row.paused_count), releasedLeaseCount: Number(row.released_lease_count),
    resumedCount: Number(row.resumed_count), stillDisabledCount: Number(row.still_disabled_count),
    createdAt: String(row.created_at)
  };
}

/**
 * Set one scope's state.
 *
 * Optimistic: expectedRevision is the revision the caller believes it is
 * editing, 0 for a scope that has never been set. Idempotent: a repeated call
 * carrying the same idempotency key replays the recorded outcome instead of
 * pausing or resuming a second time.
 */
export function setKillSwitch(input: {
  actorUserId: string; level: KillSwitchLevel; spaceId: string | null; scopeKey: string;
  state: KillSwitchState; reasonCode: string; expectedRevision: number; idempotencyKey: string;
}) {
  let scope;
  try {
    scope = assertKillSwitchScope(input.level, input.scopeKey, input.spaceId);
    assertKillSwitchReasonCode(input.reasonCode);
  } catch (error) {
    if (error instanceof JourneyKillSwitchDomainError) {
      throw new JourneyKillSwitchRepositoryError(error.message, 422, error.code);
    }
    throw error;
  }
  if (input.state !== 'enabled' && input.state !== 'disabled') {
    throw new JourneyKillSwitchRepositoryError(
      'A kill switch state must be enabled or disabled.', 422, 'JOURNEY_KILL_SWITCH_STATE_UNKNOWN');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)) {
    throw new JourneyKillSwitchRepositoryError(
      'An idempotency key of at least 8 characters is required.', 422, 'JOURNEY_KILL_SWITCH_IDEMPOTENCY_INVALID');
  }
  const authority = assertAuthority(input.level, input.spaceId, input.actorUserId);

  return db.transaction(() => {
    const at = now();
    const existing = stateRow(input.level, input.spaceId, input.scopeKey) as any;

    if (existing) {
      const replay = mutationReplay(String(existing.id), input.idempotencyKey);
      if (replay) {
        if (String(replay.requested_state) !== input.state) throw new JourneyKillSwitchRepositoryError(
          'The idempotency key was already used for a different state.', 409,
          'JOURNEY_KILL_SWITCH_IDEMPOTENCY_CONFLICT');
        return mutationResult(replay, existing, true, false);
      }
    }
    const currentRevision = existing ? Number(existing.revision) : 0;
    if (currentRevision !== input.expectedRevision) {
      throw new JourneyKillSwitchRepositoryError(
        'The kill switch was changed by someone else.', 409, 'JOURNEY_KILL_SWITCH_REVISION_CONFLICT',
        { currentRevision });
    }

    const unchanged = existing && String(existing.state) === input.state;
    const revision = unchanged ? currentRevision : currentRevision + 1;
    const stateId = existing ? String(existing.id) : uuid();

    let paused = 0; let releasedLeases = 0; let resumed = 0; let stillDisabled = 0;
    let pausePlans: PauseOutcome['plans'] = [];
    let resumeRecords: ResumeOutcome['records'] = [];

    if (!existing) {
      db.prepare(`INSERT INTO journey_kill_switch_states
        (id,scope_level,space_id,scope_key,state,reason_code,revision,updated_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(stateId, input.level, input.spaceId, input.scopeKey, input.state, input.reasonCode, revision,
          input.actorUserId, at, at);
    } else if (!unchanged) {
      const applied = db.prepare(`UPDATE journey_kill_switch_states
        SET state=?,reason_code=?,revision=?,updated_by_user_id=?,updated_at=? WHERE id=? AND revision=?`)
        .run(input.state, input.reasonCode, revision, input.actorUserId, at, stateId, currentRevision);
      if (!applied.changes) {
        throw new JourneyKillSwitchRepositoryError(
          'The kill switch was changed by someone else.', 409, 'JOURNEY_KILL_SWITCH_REVISION_CONFLICT',
          { currentRevision });
      }
    }

    if (!unchanged && input.state === 'disabled') {
      const outcome = pauseWorkInScope(input.level, input.spaceId, input.scopeKey, at);
      paused = outcome.paused; releasedLeases = outcome.releasedLeases; pausePlans = outcome.plans;
    }
    if (!unchanged && input.state === 'enabled') {
      const outcome = resumeWorkInScope(input.level, input.spaceId, input.scopeKey, at);
      resumed = outcome.resumed; stillDisabled = outcome.stillDisabled; resumeRecords = outcome.records;
    }

    const mutationId = uuid();
    db.prepare(`INSERT INTO journey_kill_switch_mutations
      (id,state_id,scope_level,space_id,scope_key,idempotency_key,requested_state,resulting_revision,
       paused_count,released_lease_count,resumed_count,still_disabled_count,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(mutationId, stateId, input.level, input.spaceId, input.scopeKey, input.idempotencyKey, input.state,
        revision, paused, releasedLeases, resumed, stillDisabled, input.actorUserId, at);

    for (const plan of pausePlans) {
      db.prepare(`INSERT INTO journey_kill_switch_pauses
        (id,state_id,mutation_id,space_id,queue_id,previous_state,lease_released,fencing_token,reason_code,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(uuid(), stateId, mutationId, plan.spaceId, plan.queueId, plan.previousState,
          plan.leaseReleased ? 1 : 0, plan.fencingToken, scope.gateKey, at);
    }
    for (const record of resumeRecords) {
      db.prepare(`INSERT INTO journey_kill_switch_resumptions
        (id,pause_id,mutation_id,space_id,queue_id,outcome,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(uuid(), record.pauseId, mutationId, record.spaceId, record.queueId, record.outcome, at);
    }

    if (!unchanged) {
      const audit = buildKillSwitchAuditDetail({
        level: input.level, scopeKey: input.scopeKey, state: input.state, reasonCode: input.reasonCode,
        revision, pausedCount: paused, releasedLeaseCount: releasedLeases, resumedCount: resumed,
        stillDisabledCount: stillDisabled
      });
      db.prepare(`INSERT INTO journey_kill_switch_audit
        (id,space_id,actor_user_id,authority,action,scope_level,scope_key,detail_json,detail_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(uuid(), input.spaceId, input.actorUserId, authority,
          input.state === 'disabled' ? 'kill_switch.disabled' : 'kill_switch.enabled',
          input.level, input.scopeKey, audit.serialized, audit.detailSha256, at);
    }

    const mutation = db.prepare('SELECT * FROM journey_kill_switch_mutations WHERE id=?').get(mutationId) as any;
    const refreshed = stateRow(input.level, input.spaceId, input.scopeKey) as any;
    return mutationResult(mutation, refreshed, false, !unchanged);
  })();
}

export function listKillSwitchPauses(input: {
  actorUserId: string; spaceId: string; limit?: number;
}) {
  assertReadAccess(input.spaceId, input.actorUserId);
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
  const rows = db.prepare(`SELECT p.id,p.queue_id,p.previous_state,p.lease_released,p.fencing_token,p.reason_code,
    p.created_at,r.outcome resumption_outcome FROM journey_kill_switch_pauses p
    LEFT JOIN journey_kill_switch_resumptions r ON r.pause_id=p.id
    WHERE p.space_id=? ORDER BY p.created_at DESC,p.id LIMIT ?`).all(input.spaceId, limit) as any[];
  return rows.map((row) => ({
    id: String(row.id), queueId: String(row.queue_id), previousState: String(row.previous_state),
    leaseReleased: Number(row.lease_released) === 1, fencingToken: Number(row.fencing_token),
    reasonCode: String(row.reason_code), createdAt: String(row.created_at),
    resumption: row.resumption_outcome ? String(row.resumption_outcome) : null
  }));
}

export const KILL_SWITCH_LEVEL_VALUES = KILL_SWITCH_LEVELS;
