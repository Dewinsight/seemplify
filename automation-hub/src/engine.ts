import crypto from "node:crypto";
import { actionCatalog, eventCatalog } from "./catalog.js";
import { audit } from "./audit.js";
import { compileWorkflow } from "./compiler.js";
import { connectionAvailable } from "./connections.js";
import { db, json, now, stringify } from "./database.js";
import type { EventEnvelope, SessionActor, WorkflowDefinition, WorkflowStep } from "./domain.js";
import { invokeAction } from "./adapters.js";
import { authorizeAtRuntime } from "./runtimeAuthorization.js";
import { digest, resolveInput, type RuntimeValues } from "./values.js";
import { deliverSubscriptions } from "./subscriptions.js";

type RunContext = RuntimeValues & { publisher: SessionActor; pendingApprovalId?: string };

function actionFor(step: WorkflowStep) {
  return step.type === "action" ? actionCatalog.find((item) => item.id === step.actionId) : undefined;
}

function validateEnvelope(envelope: EventEnvelope) {
  const descriptor = eventCatalog.find((item) => item.id === envelope.name);
  if (!descriptor) throw Object.assign(new Error("The event is not registered in the catalogue."), { status: 400, code: "EVENT_UNKNOWN" });
  if (descriptor.schemaVersion !== envelope.schemaVersion || descriptor.subjectType !== envelope.subjectType) {
    throw Object.assign(new Error("The event schema version or subject type is incompatible."), { status: 400, code: "EVENT_SCHEMA_INVALID" });
  }
  if (!envelope.id || !envelope.organizationId || !envelope.actorId || !envelope.subjectId || !envelope.subjectRevision || !envelope.correlationId) {
    throw Object.assign(new Error("The canonical event envelope is incomplete."), { status: 400, code: "EVENT_ENVELOPE_INVALID" });
  }
  for (const [field, type] of Object.entries(descriptor.output)) {
    if (!(field in envelope.payload) || (type !== "object" && typeof envelope.payload[field] !== type)) {
      throw Object.assign(new Error(`Event payload field ${field} must be ${type}.`), { status: 400, code: "EVENT_PAYLOAD_INVALID" });
    }
  }
  if (envelope.dataClass !== descriptor.dataClass) throw Object.assign(new Error("Event data classification does not match its contract."), { status: 400, code: "EVENT_CLASSIFICATION_INVALID" });
  return descriptor;
}

function loadRun(runId: string) {
  const run = db.prepare("SELECT * FROM runs WHERE id=?").get(runId) as any;
  if (!run) throw Object.assign(new Error("Run not found."), { status: 404 });
  const version = db.prepare("SELECT * FROM workflow_versions WHERE id=?").get(run.workflow_version_id) as any;
  const definition = json<WorkflowDefinition>(version.definition_json, {} as WorkflowDefinition);
  const context = json<RunContext>(run.context_json, {} as RunContext);
  return { run, version, definition, context };
}

function updateRun(runId: string, values: { status?: string; cursor?: number; context?: RunContext; errorCode?: string | null; errorMessage?: string | null }) {
  const current = db.prepare("SELECT * FROM runs WHERE id=?").get(runId) as any;
  db.prepare("UPDATE runs SET status=?,cursor=?,context_json=?,error_code=?,error_message=?,updated_at=? WHERE id=?")
    .run(values.status ?? current.status, values.cursor ?? current.cursor, values.context ? stringify(values.context) : current.context_json,
      values.errorCode === undefined ? current.error_code : values.errorCode,
      values.errorMessage === undefined ? current.error_message : values.errorMessage, now(), runId);
}

function createApproval(runId: string, cursor: number, step: Extract<WorkflowStep, { type: "approval" }>, next: Extract<WorkflowStep, { type: "action" }>, context: RunContext) {
  const action = actionFor(next)!;
  const approvalId = crypto.randomUUID();
  const runtime = { ...context, approval: { id: approvalId } };
  const payload = resolveInput(next.input, runtime);
  const envelope = context.event as unknown as EventEnvelope;
  const payloadHash = digest({ actionId: action.id, payload, subjectRevision: envelope.subjectRevision });
  const rejectionAction = step.onReject ? actionFor(step.onReject) : undefined;
  const rejectionRuntime = { ...context, approval: { id: approvalId, decision: "rejected" as const, rationale: "$decision.rationale" } };
  const rejectionPayload = step.onReject ? resolveInput(step.onReject.input, rejectionRuntime) : null;
  const rejectionPayloadHash = rejectionAction && rejectionPayload
    ? digest({ actionId: rejectionAction.id, payload: rejectionPayload, subjectRevision: envelope.subjectRevision })
    : null;
  const at = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO approvals
      (id,organization_id,run_id,step_id,purpose,risk_class,subject_type,subject_id,subject_revision,action_id,payload_json,payload_hash,rejection_action_id,rejection_payload_json,rejection_payload_hash,
       requester_id,runtime_identity,approver_roles_json,maker_checker,status,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(approvalId, envelope.organizationId, runId, step.id, step.purpose, action.risk, envelope.subjectType, envelope.subjectId,
        envelope.subjectRevision, action.id, stringify(payload), payloadHash, rejectionAction?.id || null, rejectionPayload ? stringify(rejectionPayload) : null,
        rejectionPayloadHash, envelope.actorId, "automation-hub", stringify(step.approverRoles),
        action.makerChecker ? 1 : 0, "pending", at, new Date(Date.now() + step.expiresInHours * 3_600_000).toISOString());
    updateRun(runId, { status: "waiting_approval", cursor, context: { ...runtime, pendingApprovalId: approvalId } });
  })();
  audit({ organizationId: envelope.organizationId, actorId: "automation-hub", action: "approval.requested", targetType: "approval", targetId: approvalId, metadata: { actionId: action.id, runId, subjectRevision: envelope.subjectRevision } });
}

export async function advanceRun(runId: string) {
  let loaded = loadRun(runId);
  if (!["running", "failed"].includes(loaded.run.status)) return;
  updateRun(runId, { status: "running", errorCode: null, errorMessage: null });
  for (let cursor = Number(loaded.run.cursor); cursor < loaded.definition.steps.length; cursor += 1) {
    loaded = loadRun(runId);
    const step = loaded.definition.steps[cursor];
    const envelope = loaded.context.event as unknown as EventEnvelope;
    const compiled = compileWorkflow(loaded.definition, { connectionAvailable: (provider, id) => connectionAvailable(envelope.organizationId, provider, id) });
    if (!compiled.valid) {
      updateRun(runId, { status: "failed", cursor, errorCode: "WORKFLOW_NO_LONGER_VALID", errorMessage: compiled.issues[0]?.message || "Workflow is no longer valid." });
      return;
    }
    if (step.type === "approval") {
      const existing = db.prepare("SELECT status FROM approvals WHERE run_id=? AND step_id=?").get(runId, step.id) as { status: string } | undefined;
      if (existing?.status === "approved") { updateRun(runId, { cursor: cursor + 1 }); continue; }
      const next = loaded.definition.steps[cursor + 1];
      if (!next || next.type !== "action") {
        updateRun(runId, { status: "failed", cursor, errorCode: "APPROVAL_TARGET_MISSING", errorMessage: "The approval has no exact action target." });
        return;
      }
      if (!existing) createApproval(runId, cursor, step, next, loaded.context);
      return;
    }
    const action = actionFor(step);
    if (!action) {
      updateRun(runId, { status: "failed", cursor, errorCode: "ACTION_UNKNOWN", errorMessage: "The action contract is unavailable." });
      return;
    }
    const input = resolveInput(step.input, loaded.context);
    const idempotencyKey = digest({ runId, stepId: step.id, actionId: action.id, subjectRevision: envelope.subjectRevision });
    const prior = db.prepare("SELECT response_json FROM attempts WHERE idempotency_key=? AND status='succeeded'").get(idempotencyKey) as { response_json: string } | undefined;
    if (prior) {
      loaded.context.steps[step.id] = { output: json(prior.response_json, {}) };
      updateRun(runId, { cursor: cursor + 1, context: loaded.context });
      continue;
    }
    if (action.approvalRequired) {
      const approval = db.prepare("SELECT * FROM approvals WHERE id=? AND run_id=?").get(loaded.context.approval?.id, runId) as any;
      const currentHash = digest({ actionId: action.id, payload: input, subjectRevision: envelope.subjectRevision });
      if (!approval || approval.status !== "approved" || approval.action_id !== action.id || approval.payload_hash !== currentHash || approval.subject_revision !== envelope.subjectRevision || Date.parse(approval.expires_at) <= Date.now()) {
        updateRun(runId, { status: "failed", cursor, errorCode: "APPROVAL_STALE_OR_INVALID", errorMessage: "The exact approval is missing, expired, or no longer matches the action." });
        return;
      }
    }
    const attemptNumber = Number((db.prepare("SELECT MAX(attempt_number) value FROM attempts WHERE run_id=? AND step_id=?").get(runId, step.id) as any)?.value || 0) + 1;
    const attemptId = crypto.randomUUID();
    db.prepare(`INSERT INTO attempts
      (id,run_id,step_id,attempt_number,idempotency_key,status,request_json,started_at)
      VALUES (?,?,?,?,?,'running',?,?)`).run(attemptId, runId, step.id, attemptNumber, idempotencyKey, stringify(input), now());
    try {
      const authorizationContext = await authorizeAtRuntime({ organizationId: envelope.organizationId, publisher: loaded.context.publisher, action, subjectId: envelope.subjectId, eventId: envelope.id });
      const output = await invokeAction(action, {
        organizationId: envelope.organizationId,
        actorId: loaded.context.approval?.id
          ? String((db.prepare("SELECT decision_actor_id FROM approvals WHERE id=?").get(loaded.context.approval.id) as any)?.decision_actor_id || loaded.context.publisher.id)
          : loaded.context.publisher.id,
        eventId: envelope.id, subjectId: envelope.subjectId, idempotencyKey, connectionId: step.connectionId, input, authorizationContext,
      });
      db.prepare("UPDATE attempts SET status='succeeded',response_json=?,completed_at=? WHERE id=?").run(stringify(output), now(), attemptId);
      loaded.context.steps[step.id] = { output };
      updateRun(runId, { cursor: cursor + 1, context: loaded.context });
      audit({ organizationId: envelope.organizationId, actorId: "automation-hub", action: "automation.action_succeeded", targetType: "run", targetId: runId, metadata: { stepId: step.id, actionId: action.id, outcomeId: output.outcomeId } });
    } catch (error) {
      const typed = error as Error & { code?: string; uncertain?: boolean };
      const status = typed.uncertain ? "unknown" : "failed";
      db.prepare("UPDATE attempts SET status=?,error_code=?,error_message=?,completed_at=? WHERE id=?")
        .run(status, typed.code || "ACTION_FAILED", typed.message, now(), attemptId);
      updateRun(runId, { status: typed.uncertain ? "reconcile" : "failed", cursor, errorCode: typed.code || "ACTION_FAILED", errorMessage: typed.message });
      audit({ organizationId: envelope.organizationId, actorId: "automation-hub", action: typed.uncertain ? "automation.action_unknown" : "automation.action_failed", targetType: "run", targetId: runId, metadata: { stepId: step.id, actionId: action.id, errorCode: typed.code || "ACTION_FAILED" } });
      return;
    }
  }
  const completed = loadRun(runId);
  updateRun(runId, { status: "succeeded", cursor: completed.definition.steps.length, context: completed.context });
  const envelope = completed.context.event as unknown as EventEnvelope;
  audit({ organizationId: envelope.organizationId, actorId: "automation-hub", action: "automation.run_succeeded", targetType: "run", targetId: runId });
}

export async function ingestEvent(envelope: EventEnvelope, trustedOrganizationId?: string) {
  const descriptor = validateEnvelope(envelope);
  if (trustedOrganizationId && envelope.organizationId !== trustedOrganizationId) throw Object.assign(new Error("Cross-organization event denied."), { status: 403, code: "ORGANIZATION_MISMATCH" });
  const inserted = db.prepare("INSERT OR IGNORE INTO event_inbox (id,organization_id,event_name,envelope_json,received_at) VALUES (?,?,?,?,?)")
    .run(envelope.id, envelope.organizationId, envelope.name, stringify(envelope), now());
  if (!inserted.changes) return { duplicate: true, runIds: [] as string[] };
  const workflows = db.prepare(`SELECT w.*,v.definition_json,v.publisher_actor_json,v.id version_id
    FROM workflows w JOIN workflow_versions v ON v.id=w.current_version_id
    WHERE w.organization_id=? AND w.status='published'`).all(envelope.organizationId) as any[];
  const runIds: string[] = [];
  for (const workflow of workflows) {
    const item = json<WorkflowDefinition>(workflow.definition_json, {} as WorkflowDefinition);
    if (item.trigger.eventId !== envelope.name) continue;
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const recent = Number((db.prepare("SELECT COUNT(*) count FROM runs WHERE workflow_id=? AND created_at>=?").get(workflow.id, since) as any)?.count || 0);
    if (recent >= item.maximumRunsPerHour) {
      audit({ organizationId: envelope.organizationId, actorId: "automation-hub", action: "automation.run_suppressed", targetType: "workflow", targetId: workflow.id, metadata: { reason: "hourly_cap", eventId: envelope.id } });
      continue;
    }
    const runId = crypto.randomUUID();
    const at = now();
    const context: RunContext = { event: envelope as unknown as Record<string, unknown>, steps: {}, publisher: json<SessionActor>(workflow.publisher_actor_json, {} as SessionActor) };
    db.prepare(`INSERT INTO runs
      (id,organization_id,workflow_id,workflow_version_id,event_id,status,cursor,context_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'running',0,?,?,?)`)
      .run(runId, envelope.organizationId, workflow.id, workflow.version_id, envelope.id, stringify(context), at, at);
    runIds.push(runId);
  }
  for (const runId of runIds) await advanceRun(runId);
  if (descriptor.externalEligible) await deliverSubscriptions(envelope);
  return { duplicate: false, runIds };
}

export function listRuns(actor: SessionActor) {
  return (db.prepare(`SELECT r.*,w.name workflow_name FROM runs r JOIN workflows w ON w.id=r.workflow_id
    WHERE r.organization_id=? ORDER BY r.created_at DESC LIMIT 200`).all(actor.organizationId) as any[]).map((row) => ({
      id: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name, eventId: row.event_id, status: row.status,
      cursor: row.cursor, errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
}

export function getRun(actor: SessionActor, id: string) {
  const row = db.prepare(`SELECT r.*,w.name workflow_name FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.id=? AND r.organization_id=?`)
    .get(id, actor.organizationId) as any;
  if (!row) throw Object.assign(new Error("Run not found."), { status: 404 });
  const attempts = db.prepare("SELECT id,step_id,attempt_number,status,error_code,error_message,response_json,started_at,completed_at FROM attempts WHERE run_id=? ORDER BY started_at")
    .all(id).map((item: any) => ({ ...item, response: json(item.response_json, null), response_json: undefined }));
  const approvals = db.prepare("SELECT id,step_id,purpose,risk_class,subject_type,subject_id,subject_revision,action_id,payload_hash,requester_id,approver_roles_json,status,decision_actor_id,decision_actor_name,rationale,requested_at,expires_at,decided_at FROM approvals WHERE run_id=?")
    .all(id).map((item: any) => ({ ...item, approverRoles: json(item.approver_roles_json, []), approver_roles_json: undefined }));
  return { ...row, context: json(row.context_json, {}), context_json: undefined, attempts, approvals };
}

export function listApprovals(actor: SessionActor) {
  return (db.prepare(`SELECT a.*,w.name workflow_name FROM approvals a JOIN runs r ON r.id=a.run_id JOIN workflows w ON w.id=r.workflow_id
    WHERE a.organization_id=? ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC`).all(actor.organizationId) as any[])
    .map((item) => ({ ...item, payload_json: undefined, rejection_payload_json: undefined, approverRoles: json(item.approver_roles_json, []), approver_roles_json: undefined }));
}

export async function decideApproval(actor: SessionActor, id: string, decision: "approved" | "rejected", rationale: string) {
  if (!(["approved", "rejected"] as const).includes(decision)) throw Object.assign(new Error("Decision must be approved or rejected."), { status: 400, code: "DECISION_INVALID" });
  const approval = db.prepare("SELECT * FROM approvals WHERE id=? AND organization_id=?").get(id, actor.organizationId) as any;
  if (!approval) throw Object.assign(new Error("Approval not found."), { status: 404 });
  if (approval.status !== "pending") throw Object.assign(new Error(`This approval is already ${approval.status}.`), { status: 409, code: "APPROVAL_ALREADY_DECIDED" });
  if (Date.parse(approval.expires_at) <= Date.now()) {
    db.prepare("UPDATE approvals SET status='expired',decided_at=? WHERE id=?").run(now(), id);
    throw Object.assign(new Error("This approval expired."), { status: 409, code: "APPROVAL_EXPIRED" });
  }
  const roles = json<string[]>(approval.approver_roles_json, []);
  if (!roles.includes(actor.role) && !actor.permissions.includes("automation.approve")) throw Object.assign(new Error("You are not an eligible approver."), { status: 403, code: "APPROVER_INELIGIBLE" });
  if (approval.maker_checker && approval.requester_id === actor.id) throw Object.assign(new Error("Maker-checker policy prevents the requester from deciding this action."), { status: 403, code: "MAKER_CHECKER_REQUIRED" });
  if (decision === "rejected" && rationale.trim().length < 3) throw Object.assign(new Error("Give a reason for rejection."), { status: 400, code: "RATIONALE_REQUIRED" });
  const loaded = loadRun(approval.run_id);
  const envelope = loaded.context.event as unknown as EventEnvelope;
  const targetStep = loaded.definition.steps[Number(loaded.run.cursor) + 1];
  if (!targetStep || targetStep.type !== "action" || targetStep.actionId !== approval.action_id || envelope.subjectRevision !== approval.subject_revision) {
    db.prepare("UPDATE approvals SET status='superseded',decided_at=? WHERE id=?").run(now(), id);
    throw Object.assign(new Error("The subject or protected action changed; request a new approval."), { status: 409, code: "APPROVAL_SUPERSEDED" });
  }
  const proposed = resolveInput(targetStep.input, { ...loaded.context, approval: { id, decision: "approved", rationale: rationale.trim() } });
  if (digest({ actionId: targetStep.actionId, payload: proposed, subjectRevision: envelope.subjectRevision }) !== approval.payload_hash) {
    db.prepare("UPDATE approvals SET status='superseded',decided_at=? WHERE id=?").run(now(), id);
    throw Object.assign(new Error("The proposed payload changed; request a new approval."), { status: 409, code: "APPROVAL_PAYLOAD_CHANGED" });
  }
  if (decision === "rejected") {
    const approvalStep = loaded.definition.steps[Number(loaded.run.cursor)];
    if (approvalStep?.type === "approval" && approvalStep.onReject) {
      const rejectionAction = actionFor(approvalStep.onReject);
      const templatePayload = resolveInput(approvalStep.onReject.input, { ...loaded.context, approval: { id, decision, rationale: "$decision.rationale" } });
      const templateHash = rejectionAction ? digest({ actionId: rejectionAction.id, payload: templatePayload, subjectRevision: envelope.subjectRevision }) : "";
      if (!rejectionAction || approval.rejection_action_id !== rejectionAction.id || approval.rejection_payload_hash !== templateHash) {
        db.prepare("UPDATE approvals SET status='superseded',decided_at=? WHERE id=?").run(now(), id);
        throw Object.assign(new Error("The authoritative rejection action changed; request a new approval."), { status: 409, code: "APPROVAL_REJECTION_CHANGED" });
      }
      const rejectionInput = resolveInput(approvalStep.onReject.input, { ...loaded.context, approval: { id, decision, rationale: rationale.trim() } });
      const authorizationContext = await authorizeAtRuntime({ organizationId: envelope.organizationId, publisher: loaded.context.publisher, action: rejectionAction, subjectId: envelope.subjectId, eventId: envelope.id });
      const idempotencyKey = digest({ runId: approval.run_id, stepId: approvalStep.onReject.id, actionId: rejectionAction.id, subjectRevision: envelope.subjectRevision, decision });
      const attemptId = crypto.randomUUID();
      db.prepare(`INSERT INTO attempts (id,run_id,step_id,attempt_number,idempotency_key,status,request_json,started_at)
        VALUES (?,?,?,?,?,'running',?,?)`).run(attemptId, approval.run_id, approvalStep.onReject.id, 1, idempotencyKey, stringify(rejectionInput), now());
      try {
        const output = await invokeAction(rejectionAction, { organizationId: envelope.organizationId, actorId: actor.id, eventId: envelope.id, subjectId: envelope.subjectId, idempotencyKey, connectionId: approvalStep.onReject.connectionId, input: rejectionInput, authorizationContext });
        db.prepare("UPDATE attempts SET status='succeeded',response_json=?,completed_at=? WHERE id=?").run(stringify(output), now(), attemptId);
      } catch (error) {
        const typed = error as Error & { code?: string; uncertain?: boolean };
        db.prepare("UPDATE attempts SET status=?,error_code=?,error_message=?,completed_at=? WHERE id=?")
          .run(typed.uncertain ? "unknown" : "failed", typed.code || "ACTION_FAILED", typed.message, now(), attemptId);
        throw error;
      }
    }
    const at = now();
    db.prepare("UPDATE approvals SET status=?,decision_actor_id=?,decision_actor_name=?,rationale=?,decided_at=? WHERE id=?")
      .run(decision, actor.id, actor.name, rationale.trim(), at, id);
    audit({ organizationId: actor.organizationId, actorId: actor.id, action: `approval.${decision}`, targetType: "approval", targetId: id, metadata: { runId: approval.run_id, actionId: approval.action_id } });
    updateRun(approval.run_id, { status: "rejected", errorCode: "APPROVAL_REJECTED", errorMessage: rationale.trim() });
    return getRun(actor, approval.run_id);
  }
  const at = now();
  db.prepare("UPDATE approvals SET status=?,decision_actor_id=?,decision_actor_name=?,rationale=?,decided_at=? WHERE id=?")
    .run(decision, actor.id, actor.name, rationale.trim(), at, id);
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: `approval.${decision}`, targetType: "approval", targetId: id, metadata: { runId: approval.run_id, actionId: approval.action_id } });
  loaded.context.approval = { id, decision, rationale: rationale.trim() };
  updateRun(approval.run_id, { status: "running", cursor: Number(loaded.run.cursor) + 1, context: loaded.context, errorCode: null, errorMessage: null });
  await advanceRun(approval.run_id);
  return getRun(actor, approval.run_id);
}

export async function retryRun(actor: SessionActor, id: string) {
  const loaded = loadRun(id);
  if (loaded.run.organization_id !== actor.organizationId) throw Object.assign(new Error("Run not found."), { status: 404 });
  if (loaded.run.status !== "failed") throw Object.assign(new Error("Only a safely failed run can be retried. Unknown outcomes require reconciliation."), { status: 409, code: "RUN_NOT_RETRYABLE" });
  updateRun(id, { status: "running", errorCode: null, errorMessage: null });
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "automation.run_retried", targetType: "run", targetId: id });
  await advanceRun(id);
  return getRun(actor, id);
}
