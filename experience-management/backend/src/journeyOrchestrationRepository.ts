import crypto from 'node:crypto';
import { db } from './database.js';
import { effectiveJourneyRole } from './journeyCollaboration.js';
import {
  createContentSafeSimulationAudit, evaluateWorkflow, JourneyOrchestrationDomainError,
  publishWorkflowDraft, reviseWorkflowDraft, retireWorkflowDefinition, validateWorkflowDraft,
  type GateDecision, type SafetyGate, type WorkflowAutomationPolicy, type WorkflowCondition,
  type WorkflowDraft, type WorkflowTrigger, type WorkflowAction, type WorkflowVersion
} from './journeyOrchestrationDomain.js';
import { assertSubscriptionFeature, assertSubscriptionQuota } from './subscriptionEntitlements.js';
import { enqueueApprovedActionInTransaction } from './journeyActionRuntimeRepository.js';

export class JourneyOrchestrationRepositoryError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_ORCHESTRATION_INVALID',
    public details: Record<string, unknown> = {}) { super(message); this.name = 'JourneyOrchestrationRepositoryError'; }
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const now = (value?: string) => value || new Date().toISOString();

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_orchestration_settings (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE, paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 1, updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journey_workflow_definitions (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('draft','published','retired')), revision INTEGER NOT NULL DEFAULT 1,
      draft_json TEXT NOT NULL CHECK(json_valid(draft_json)), current_version_id TEXT, current_version_number INTEGER,
      paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)), created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      retired_at TEXT, retired_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, UNIQUE(id,space_id),
      FOREIGN KEY(current_version_id,id,space_id) REFERENCES journey_workflow_versions(id,workflow_id,space_id)
        DEFERRABLE INITIALLY DEFERRED);
    CREATE INDEX IF NOT EXISTS journey_workflow_definitions_list ON journey_workflow_definitions(space_id,state,updated_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_workflow_versions (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, space_id TEXT NOT NULL, version_number INTEGER NOT NULL,
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      published_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, published_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,workflow_id,space_id), UNIQUE(workflow_id,space_id,version_number),
      FOREIGN KEY(workflow_id,space_id) REFERENCES journey_workflow_definitions(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_workflow_runs (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version_id TEXT NOT NULL, space_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('dry_run','historical','execution')), trigger_fingerprint_sha256 TEXT NOT NULL,
      subject_ref_sha256 TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), result_sha256 TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, UNIQUE(id,space_id),
      FOREIGN KEY(workflow_version_id,workflow_id,space_id) REFERENCES journey_workflow_versions(id,workflow_id,space_id) ON DELETE NO ACTION);
    CREATE INDEX IF NOT EXISTS journey_workflow_runs_history ON journey_workflow_runs(space_id,workflow_id,created_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_workflow_actions (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, space_id TEXT NOT NULL, action_key TEXT NOT NULL, adapter TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('suppressed','pending_approval','approved_held')),
      approval_required INTEGER NOT NULL CHECK(approval_required IN (0,1)), trace_json TEXT NOT NULL CHECK(json_valid(trace_json)),
      trace_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(space_id,idempotency_key), UNIQUE(run_id,action_key),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_workflow_runs(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_workflow_approvals (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, space_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
      reason TEXT NOT NULL, reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(action_id), FOREIGN KEY(action_id,space_id) REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_workflow_outbox (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, space_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'held' CHECK(state='held'), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      payload_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(id,space_id), UNIQUE(action_id), UNIQUE(space_id,idempotency_key),
      FOREIGN KEY(action_id,space_id) REFERENCES journey_workflow_actions(id,space_id) ON DELETE NO ACTION);
    CREATE TABLE IF NOT EXISTS journey_workflow_audit (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE NO ACTION,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), detail_sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS journey_workflow_audit_history ON journey_workflow_audit(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_workflow_versions_append_only BEFORE UPDATE ON journey_workflow_versions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_versions_delete_guard BEFORE DELETE ON journey_workflow_versions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_runs_append_only BEFORE UPDATE ON journey_workflow_runs BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_runs_delete_guard BEFORE DELETE ON journey_workflow_runs BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_actions_append_only BEFORE UPDATE ON journey_workflow_actions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_actions_delete_guard BEFORE DELETE ON journey_workflow_actions BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_approvals_append_only BEFORE UPDATE ON journey_workflow_approvals BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_approvals_delete_guard BEFORE DELETE ON journey_workflow_approvals BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_outbox_append_only BEFORE UPDATE ON journey_workflow_outbox BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_outbox_delete_guard BEFORE DELETE ON journey_workflow_outbox BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_audit_append_only BEFORE UPDATE ON journey_workflow_audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workflow_audit_delete_guard BEFORE DELETE ON journey_workflow_audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
  `);
}
ensureSqliteSchema();

function role(spaceId: string, userId: string) {
  assertSubscriptionFeature(spaceId, 'journeyOrchestration');
  const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId) as { role?: string } | undefined;
  if (!row) throw new JourneyOrchestrationRepositoryError('Space membership is required.', 403, 'JOURNEY_ORCHESTRATION_FORBIDDEN');
  return String(row.role);
}
function manage(spaceId: string, userId: string) {
  if (role(spaceId, userId) === 'member') throw new JourneyOrchestrationRepositoryError(
    'Manager access is required.', 403, 'JOURNEY_ORCHESTRATION_MANAGER_REQUIRED');
}
function publishingCapabilities(spaceId: string, userId: string, boundedAutomatic: boolean) {
  manage(spaceId, userId);
  const effective = effectiveJourneyRole(spaceId, userId);
  if (!effective.capabilities.has('journeys.publish')) throw new JourneyOrchestrationRepositoryError(
    'Journey publishing capability is required.', 403, 'JOURNEY_ORCHESTRATION_PUBLISH_REQUIRED');
  const capabilities: Array<'orchestration.publish' | 'orchestration.authorise_bounded_automation'> = [
    'orchestration.publish'
  ];
  // Bounded automation is deliberately narrower than ordinary workflow
  // publishing. The collaboration role model has no automation capability yet,
  // so only the space-derived Journey administrator may grant it; inventing the
  // domain capability for every manager would make its separate check cosmetic.
  if (boundedAutomatic) {
    if (effective.role !== 'administrator') throw new JourneyOrchestrationRepositoryError(
      'Journey administrator access is required to authorise bounded automation.', 403,
      'JOURNEY_ORCHESTRATION_AUTOMATION_AUTHORISATION_REQUIRED');
    capabilities.push('orchestration.authorise_bounded_automation');
  }
  return capabilities;
}
function approve(spaceId: string, userId: string) {
  role(spaceId, userId);
  if (!effectiveJourneyRole(spaceId, userId).capabilities.has('journeys.review')) throw new JourneyOrchestrationRepositoryError(
    'Journey approval capability is required.', 403, 'JOURNEY_ORCHESTRATION_APPROVAL_REQUIRED');
}
export function readJourneyOrchestrationAccess(input: { spaceId: string; actorUserId: string }) {
  const membershipRole = role(input.spaceId, input.actorUserId);
  const effective = effectiveJourneyRole(input.spaceId, input.actorUserId);
  return {
    canManage: membershipRole !== 'member',
    canReview: effective.capabilities.has('journeys.review')
  };
}
function mapError(error: unknown): never {
  if (!(error instanceof JourneyOrchestrationDomainError)) throw error;
  const status = error.code.includes('CONFLICT') ? 409 : error.code.includes('FORBIDDEN') || error.code.includes('REQUIRED') ? 403 : 422;
  throw new JourneyOrchestrationRepositoryError(error.message, status, error.code, error.details);
}
function audit(spaceId: string, actorUserId: string, action: string, targetType: string, targetId: string,
  detail: Record<string, unknown>, at: string) {
  const serialized = json(detail);
  db.prepare(`INSERT INTO journey_workflow_audit
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,detail_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, targetId,
      serialized, hash(serialized), at);
}
function draftFromRow(row: any): WorkflowDraft { return parse<WorkflowDraft>(row.draft_json); }
function versionFromRow(row: any): WorkflowVersion {
  const content = parse<any>(row.content_json);
  return Object.freeze({ id: String(row.id), workflowId: String(row.workflow_id), spaceId: String(row.space_id),
    versionNumber: Number(row.version_number), ...content, contentSha256: String(row.content_sha256),
    publishedByUserId: String(row.published_by_user_id || ''), publishedAt: String(row.published_at) });
}
function definitionRecord(row: any) { return { id: String(row.id), spaceId: String(row.space_id), name: String(row.name),
  state: row.state, revision: Number(row.revision), paused: Boolean(row.paused), currentVersionId: row.current_version_id || null,
  currentVersionNumber: row.current_version_number === null ? null : Number(row.current_version_number),
  retiredAt: row.retired_at || null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }

export function createWorkflowDraft(input: { spaceId: string; actorUserId: string; name: string; trigger: WorkflowTrigger;
  conditions: WorkflowCondition[]; actions: WorkflowAction[]; automationPolicy: WorkflowAutomationPolicy; at?: string }) {
  manage(input.spaceId, input.actorUserId); const timestamp = now(input.at); const id = crypto.randomUUID();
  const draft: WorkflowDraft = { id, spaceId: input.spaceId, name: input.name, state: 'draft', revision: 1,
    trigger: input.trigger, conditions: input.conditions, actions: input.actions, automationPolicy: input.automationPolicy,
    createdAt: timestamp, updatedAt: timestamp };
  const issues = validateWorkflowDraft(draft); if (issues.length) throw new JourneyOrchestrationRepositoryError(
    'Workflow draft is invalid.', 422, 'WORKFLOW_INVALID', { issues });
  db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
      .get(`journey-orchestration-quota:${input.spaceId}`);
    const current = Number((db.prepare(`SELECT COUNT(*) count FROM journey_workflow_definitions
      WHERE space_id=? AND state<>'retired'`).get(input.spaceId) as any).count);
    assertSubscriptionQuota(input.spaceId, 'activeJourneyOrchestrations', current, 1);
    db.prepare(`INSERT INTO journey_workflow_definitions
    (id,space_id,name,state,revision,draft_json,paused,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'draft',1,?,0,?,?,?,?)`).run(id, input.spaceId, input.name, json(draft), input.actorUserId,
      input.actorUserId, timestamp, timestamp); audit(input.spaceId, input.actorUserId, 'workflow.created', 'workflow', id,
      { revision: 1 }, timestamp); db.prepare(`INSERT INTO journey_orchestration_settings
        (space_id,paused,revision,updated_by_user_id,created_at,updated_at) VALUES (?,0,1,?,?,?) ON CONFLICT DO NOTHING`)
        .run(input.spaceId, input.actorUserId, timestamp, timestamp); })();
  return { ...definitionRecord(db.prepare('SELECT * FROM journey_workflow_definitions WHERE id=? AND space_id=?').get(id, input.spaceId)), draft };
}

export function listWorkflows(input: { spaceId: string; actorUserId: string }) {
  role(input.spaceId, input.actorUserId); return (db.prepare(`SELECT * FROM journey_workflow_definitions
    WHERE space_id=? ORDER BY updated_at DESC,id`).all(input.spaceId) as any[]).map(definitionRecord);
}
export function getWorkflow(input: { spaceId: string; actorUserId: string; workflowId: string }) {
  role(input.spaceId, input.actorUserId); const row = db.prepare('SELECT * FROM journey_workflow_definitions WHERE id=? AND space_id=?')
    .get(input.workflowId, input.spaceId) as any;
  if (!row) throw new JourneyOrchestrationRepositoryError('Workflow not found.', 404, 'WORKFLOW_NOT_FOUND');
  return { ...definitionRecord(row), draft: draftFromRow(row) };
}
export function updateWorkflowDraft(input: { spaceId: string; actorUserId: string; workflowId: string; expectedRevision: number;
  patch: Partial<Pick<WorkflowDraft, 'name' | 'trigger' | 'conditions' | 'actions' | 'automationPolicy'>>; at?: string }) {
  manage(input.spaceId, input.actorUserId); const row = db.prepare('SELECT * FROM journey_workflow_definitions WHERE id=? AND space_id=?')
    .get(input.workflowId, input.spaceId) as any;
  if (!row) throw new JourneyOrchestrationRepositoryError('Workflow not found.', 404, 'WORKFLOW_NOT_FOUND');
  if (row.state === 'retired') throw new JourneyOrchestrationRepositoryError(
    'Retired workflows cannot be revised.', 409, 'WORKFLOW_ALREADY_RETIRED');
  let revised: WorkflowDraft; try { revised = reviseWorkflowDraft(draftFromRow(row), input.expectedRevision, input.patch, now(input.at)); }
  catch (error) { mapError(error); }
  const changed = db.prepare(`UPDATE journey_workflow_definitions SET name=?,draft_json=?,revision=?,updated_by_user_id=?,updated_at=?
    WHERE id=? AND space_id=? AND state<>'retired' AND revision=?`).run(revised.name, json(revised), revised.revision,
      input.actorUserId, revised.updatedAt, input.workflowId, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyOrchestrationRepositoryError('Workflow revision conflict.', 409, 'WORKFLOW_REVISION_CONFLICT');
  audit(input.spaceId, input.actorUserId, 'workflow.revised', 'workflow', input.workflowId, { revision: revised.revision }, revised.updatedAt);
  return getWorkflow(input);
}

export function publishWorkflow(input: { spaceId: string; actorUserId: string; workflowId: string; expectedRevision: number; at?: string }) {
  manage(input.spaceId, input.actorUserId); const row = db.prepare('SELECT * FROM journey_workflow_definitions WHERE id=? AND space_id=?')
    .get(input.workflowId, input.spaceId) as any;
  if (!row) throw new JourneyOrchestrationRepositoryError('Workflow not found.', 404, 'WORKFLOW_NOT_FOUND');
  if (row.state === 'retired') throw new JourneyOrchestrationRepositoryError(
    'Retired workflows cannot be published.', 409, 'WORKFLOW_ALREADY_RETIRED');
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyOrchestrationRepositoryError(
    'Workflow revision conflict.', 409, 'WORKFLOW_REVISION_CONFLICT');
  const draft = draftFromRow(row); const timestamp = now(input.at); const automatic = draft.automationPolicy.mode === 'bounded_automatic';
  const versionNumber = Number(row.current_version_number || 0) + 1;
  const capabilities = publishingCapabilities(input.spaceId, input.actorUserId, automatic);
  let published; try { published = publishWorkflowDraft(draft, { actorUserId: input.actorUserId,
    capabilities,
    versionId: crypto.randomUUID(), versionNumber, publishedAt: timestamp }); } catch (error) { mapError(error); }
  db.transaction(() => {
    const content = { name: published.version.name, trigger: published.version.trigger, conditions: published.version.conditions,
      actions: published.version.actions, automationPolicy: published.version.automationPolicy };
    db.prepare(`INSERT INTO journey_workflow_versions
      (id,workflow_id,space_id,version_number,content_json,content_sha256,published_by_user_id,published_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(published.version.id, input.workflowId, input.spaceId, versionNumber, json(content),
      published.version.contentSha256, input.actorUserId, timestamp);
    const nextDraft = { ...draft, revision: draft.revision + 1, updatedAt: timestamp };
    db.prepare(`UPDATE journey_workflow_definitions SET state='published',revision=revision+1,draft_json=?,current_version_id=?,
      current_version_number=?,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`)
      .run(json(nextDraft), published.version.id, versionNumber, input.actorUserId, timestamp,
        input.workflowId, input.spaceId, input.expectedRevision);
    audit(input.spaceId, input.actorUserId, 'workflow.published', 'workflow_version', published.version.id,
      { workflowId: input.workflowId, versionNumber, contentSha256: published.version.contentSha256 }, timestamp);
  })();
  return { workflow: getWorkflow(input), version: published.version };
}

export function retireWorkflow(input: { spaceId: string; actorUserId: string; workflowId: string; expectedRevision: number; at?: string }) {
  const capabilities = publishingCapabilities(input.spaceId, input.actorUserId, false);
  const row = db.prepare('SELECT * FROM journey_workflow_definitions WHERE id=? AND space_id=?')
    .get(input.workflowId, input.spaceId) as any;
  if (!row) throw new JourneyOrchestrationRepositoryError('Workflow not found.', 404, 'WORKFLOW_NOT_FOUND');
  let retired; try { retired = retireWorkflowDefinition({ id: row.id, spaceId: row.space_id, state: row.state,
    revision: Number(row.revision), currentVersionId: row.current_version_id, currentVersionNumber: Number(row.current_version_number),
    retiredAt: row.retired_at || null, retiredByUserId: row.retired_by_user_id || null }, { actorUserId: input.actorUserId,
    capabilities, expectedRevision: input.expectedRevision, retiredAt: now(input.at) }); }
  catch (error) { mapError(error); }
  db.transaction(() => {
    const changed = db.prepare(`UPDATE journey_workflow_definitions SET state='retired',revision=?,retired_at=?,retired_by_user_id=?,
      updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=? AND state<>'retired'`).run(retired.revision,
        retired.retiredAt, input.actorUserId, input.actorUserId, retired.retiredAt, input.workflowId, input.spaceId,
        input.expectedRevision).changes;
    if (!changed) throw new JourneyOrchestrationRepositoryError(
      'Workflow revision conflict.', 409, 'WORKFLOW_REVISION_CONFLICT');
    audit(input.spaceId, input.actorUserId, 'workflow.retired', 'workflow', input.workflowId,
      { revision: retired.revision }, retired.retiredAt!);
  })();
  return getWorkflow(input);
}

export function simulatePersistedWorkflow(input: { spaceId: string; actorUserId: string; workflowId: string;
  mode: 'dry_run' | 'historical'; triggerFingerprint: string; triggerMatched: boolean; subjectId: string;
  facts: Record<string, string | number | boolean | null>; gates: Record<SafetyGate, GateDecision>; approvedActionKeys?: string[]; at?: string }) {
  manage(input.spaceId, input.actorUserId); const workflow = getWorkflow(input);
  if (!workflow.currentVersionId || workflow.state === 'retired' || workflow.paused) throw new JourneyOrchestrationRepositoryError(
    'Workflow is not eligible for simulation.', 409, 'WORKFLOW_NOT_ACTIVE');
  const settings = db.prepare('SELECT paused FROM journey_orchestration_settings WHERE space_id=?').get(input.spaceId) as any;
  if (!settings || Boolean(settings.paused)) throw new JourneyOrchestrationRepositoryError(
    'Orchestration is paused or not configured.', 409, 'JOURNEY_ORCHESTRATION_PAUSED');
  const version = versionFromRow(db.prepare('SELECT * FROM journey_workflow_versions WHERE id=? AND space_id=?')
    .get(workflow.currentVersionId, input.spaceId));
  const evaluated = evaluateWorkflow({ mode: input.mode, workflowVersion: version, triggerFingerprint: input.triggerFingerprint,
    triggerMatched: input.triggerMatched, subjectId: input.subjectId, facts: input.facts, gates: input.gates,
    approvedActionKeys: input.approvedActionKeys });
  const replay = evaluated.actions.length ? db.prepare(`SELECT run_id FROM journey_workflow_actions
    WHERE space_id=? AND idempotency_key=?`).get(input.spaceId, evaluated.actions[0]!.idempotencyKey) as { run_id?: string } | undefined : undefined;
  if (replay?.run_id) return getSimulationRun({ spaceId: input.spaceId, actorUserId: input.actorUserId, runId: replay.run_id });
  const timestamp = now(input.at); const runId = crypto.randomUUID();
  const safe = { mode: evaluated.mode, workflowVersionId: evaluated.workflowVersionId,
    workflowContentSha256: evaluated.workflowContentSha256, actions: evaluated.actions.map((action) => ({
      actionKey: action.actionKey, adapter: action.adapter, allowed: action.allowed, approvalRequired: action.approvalRequired,
      idempotencyKey: action.idempotencyKey, trace: action.trace })) };
  const safeJson = json(safe);
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_workflow_runs
      (id,workflow_id,workflow_version_id,space_id,mode,trigger_fingerprint_sha256,subject_ref_sha256,result_json,result_sha256,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(runId, input.workflowId, version.id, input.spaceId, input.mode,
      hash(input.triggerFingerprint), hash(input.subjectId), safeJson, hash(safeJson), input.actorUserId, timestamp);
    for (const action of evaluated.actions) {
      const trace = json(action.trace); const pendingApproval = action.approvalRequired
        && action.trace.filter((step) => step.kind !== 'approval' && step.kind !== 'decision')
          .every((step) => step.decision === 'allow');
      const decision = pendingApproval ? 'pending_approval' : action.allowed ? 'approved_held' : 'suppressed';
      db.prepare(`INSERT INTO journey_workflow_actions
        (id,run_id,space_id,action_key,adapter,idempotency_key,decision,approval_required,trace_json,trace_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), runId, input.spaceId, action.actionKey, action.adapter,
        action.idempotencyKey, decision, action.approvalRequired ? 1 : 0, trace, hash(trace), timestamp);
    }
    const safeAudit = createContentSafeSimulationAudit(evaluated, { auditId: crypto.randomUUID(), spaceId: input.spaceId,
      actorUserId: input.actorUserId, createdAt: timestamp });
    audit(input.spaceId, input.actorUserId, 'workflow.simulated', 'workflow_run', runId,
      safeAudit as unknown as Record<string, unknown>, timestamp);
  })();
  return getSimulationRun({ spaceId: input.spaceId, actorUserId: input.actorUserId, runId });
}

export function getSimulationRun(input: { spaceId: string; actorUserId: string; runId: string }) {
  role(input.spaceId, input.actorUserId); const row = db.prepare('SELECT * FROM journey_workflow_runs WHERE id=? AND space_id=?')
    .get(input.runId, input.spaceId) as any;
  if (!row) throw new JourneyOrchestrationRepositoryError('Simulation not found.', 404, 'WORKFLOW_RUN_NOT_FOUND');
  const actions = db.prepare('SELECT id,action_key,adapter,idempotency_key,decision,approval_required,trace_json,created_at FROM journey_workflow_actions WHERE run_id=? AND space_id=? ORDER BY action_key')
    .all(input.runId, input.spaceId) as any[];
  return { id: row.id, workflowId: row.workflow_id, workflowVersionId: row.workflow_version_id, mode: row.mode,
    requestedByUserId: row.actor_user_id || null,
    triggerFingerprintSha256: row.trigger_fingerprint_sha256, subjectRefSha256: row.subject_ref_sha256,
    result: parse(row.result_json), createdAt: row.created_at, actions: actions.map((action) => ({ id: action.id,
      actionKey: action.action_key, adapter: action.adapter, idempotencyKey: action.idempotency_key,
      decision: action.decision, approvalRequired: Boolean(action.approval_required), trace: parse(action.trace_json),
      createdAt: action.created_at })) };
}
export function listSimulationRuns(input: { spaceId: string; actorUserId: string; workflowId?: string }) {
  role(input.spaceId, input.actorUserId); const rows = input.workflowId
    ? db.prepare('SELECT id FROM journey_workflow_runs WHERE space_id=? AND workflow_id=? ORDER BY created_at DESC,id').all(input.spaceId,input.workflowId)
    : db.prepare('SELECT id FROM journey_workflow_runs WHERE space_id=? ORDER BY created_at DESC,id').all(input.spaceId);
  return (rows as any[]).map((row) => getSimulationRun({ ...input, runId: row.id }));
}
export function decideWorkflowAction(input: { spaceId: string; actorUserId: string; actionId: string;
  decision: 'approved' | 'rejected'; reason: string; at?: string }) {
  approve(input.spaceId, input.actorUserId); const action = db.prepare(`SELECT action.*,run.actor_user_id requester_user_id
    FROM journey_workflow_actions action JOIN journey_workflow_runs run
      ON run.id=action.run_id AND run.space_id=action.space_id
    WHERE action.id=? AND action.space_id=?`)
    .get(input.actionId, input.spaceId) as any;
  if (!action) throw new JourneyOrchestrationRepositoryError('Workflow action not found.', 404, 'WORKFLOW_ACTION_NOT_FOUND');
  if (!Boolean(action.approval_required) || action.decision !== 'pending_approval') throw new JourneyOrchestrationRepositoryError(
    'This action is not awaiting approval.', 409, 'WORKFLOW_ACTION_NOT_APPROVABLE');
  if (!action.requester_user_id || action.requester_user_id === input.actorUserId) {
    throw new JourneyOrchestrationRepositoryError(
      'A different reviewer must decide this workflow action.', 403,
      'WORKFLOW_APPROVAL_INDEPENDENT_REVIEW_REQUIRED',
      { reason: action.requester_user_id ? 'requester_is_reviewer' : 'requester_identity_unavailable' });
  }
  const timestamp = now(input.at); const id = crypto.randomUUID(); let queueId: string | null = null;
  try { db.transaction(() => { db.prepare(`INSERT INTO journey_workflow_approvals
      (id,action_id,space_id,decision,reason,reviewer_user_id,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, input.actionId, input.spaceId, input.decision, input.reason, input.actorUserId, timestamp);
    if (input.decision === 'approved') queueId = enqueueApprovedActionInTransaction({
      spaceId: input.spaceId, actorUserId: input.actorUserId, actionId: input.actionId, at: timestamp });
    audit(input.spaceId, input.actorUserId, `workflow.action.${input.decision}`, 'workflow_action', input.actionId,
      { approvalId: id, decision: input.decision }, timestamp); })(); }
  catch (error: any) { if (String(error?.message).includes('UNIQUE')) throw new JourneyOrchestrationRepositoryError(
    'The action already has an approval decision.', 409, 'WORKFLOW_APPROVAL_CONFLICT'); throw error; }
  return { id, actionId: input.actionId, decision: input.decision, reason: input.reason,
    requesterUserId: String(action.requester_user_id), reviewerUserId: input.actorUserId, queueId, createdAt: timestamp };
}

export function ensureJourneyOrchestrationSettings(spaceId: string, actorUserId: string) {
  manage(spaceId, actorUserId); const timestamp = now(); db.prepare(`INSERT INTO journey_orchestration_settings
    (space_id,paused,revision,updated_by_user_id,created_at,updated_at) VALUES (?,0,1,?,?,?) ON CONFLICT DO NOTHING`)
    .run(spaceId, actorUserId, timestamp, timestamp);
}
