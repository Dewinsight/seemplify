import crypto from "node:crypto";
import { audit } from "./audit.js";
import { actionCatalog, recipeTemplates } from "./catalog.js";
import { compileWorkflow } from "./compiler.js";
import { connectionAvailable } from "./connections.js";
import { db, json, now, stringify } from "./database.js";
import type { SessionActor, WorkflowDefinition } from "./domain.js";

function definition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Workflow definition is required."), { status: 400 });
  return value as WorkflowDefinition;
}

function compile(organizationId: string, item: WorkflowDefinition) {
  return compileWorkflow(item, { connectionAvailable: (provider, id) => connectionAvailable(organizationId, provider, id) });
}

function serializeWorkflow(row: any) {
  const draft = json<WorkflowDefinition>(row.draft_json, {} as WorkflowDefinition);
  return {
    id: row.id, organizationId: row.organization_id, name: row.name, description: row.description,
    status: row.status, draft, compile: compile(row.organization_id, draft), currentVersionId: row.current_version_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function validatePublisher(actor: SessionActor, item: WorkflowDefinition) {
  const issues: Array<{ code: string; message: string; stepId?: string }> = [];
  const actions = item.steps.flatMap((step) => step.type === "action" ? [step] : step.onReject ? [step.onReject] : []);
  for (const step of actions) {
    const action = actionCatalog.find((candidate) => candidate.id === step.actionId);
    if (!action) continue;
    if (action.requiredRoles.length && !action.requiredRoles.includes(actor.role)) {
      issues.push({ code: "PUBLISHER_ROLE_DENIED", message: `${actor.role} cannot publish ${action.label}.`, stepId: step.id });
    }
    for (const appId of action.requiredApps) {
      if (actor.appIds.length && !actor.appIds.includes(appId)) issues.push({ code: "PUBLISHER_APP_ACCESS_DENIED", message: `The publisher does not have ${appId} access.`, stepId: step.id });
    }
  }
  return issues;
}

export function listWorkflows(actor: SessionActor) {
  return (db.prepare("SELECT * FROM workflows WHERE organization_id=? ORDER BY updated_at DESC").all(actor.organizationId) as any[]).map(serializeWorkflow);
}

export function getWorkflow(actor: SessionActor, id: string) {
  const row = db.prepare("SELECT * FROM workflows WHERE id=? AND organization_id=?").get(id, actor.organizationId) as any;
  if (!row) throw Object.assign(new Error("Workflow not found."), { status: 404 });
  const item = serializeWorkflow(row);
  const versions = db.prepare("SELECT id,version,compile_json,published_by,published_at FROM workflow_versions WHERE workflow_id=? ORDER BY version DESC")
    .all(id).map((version: any) => ({ ...version, compile: json(version.compile_json, {}), compile_json: undefined }));
  return { ...item, versions };
}

export function createWorkflow(actor: SessionActor, raw: unknown) {
  const item = definition(raw);
  const id = crypto.randomUUID();
  const at = now();
  db.prepare(`INSERT INTO workflows
    (id,organization_id,name,description,status,draft_json,current_version_id,created_by,created_at,updated_at)
    VALUES (?,?,?,?,? ,?,NULL,?,?,?)`)
    .run(id, actor.organizationId, String(item.name || "Untitled workflow").slice(0, 160), String(item.description || "").slice(0, 600), "draft", stringify(item), actor.id, at, at);
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "workflow.created", targetType: "workflow", targetId: id });
  return getWorkflow(actor, id);
}

export function createFromTemplate(actor: SessionActor, templateId: string) {
  const template = recipeTemplates.find((item) => item.id === templateId);
  if (!template) throw Object.assign(new Error("Template not found."), { status: 404 });
  return createWorkflow(actor, structuredClone(template.definition));
}

export function updateWorkflow(actor: SessionActor, id: string, raw: unknown) {
  getWorkflow(actor, id);
  const item = definition(raw);
  const result = db.prepare("UPDATE workflows SET name=?,description=?,draft_json=?,updated_at=? WHERE id=? AND organization_id=? AND status!='retired'")
    .run(String(item.name || "Untitled workflow").slice(0, 160), String(item.description || "").slice(0, 600), stringify(item), now(), id, actor.organizationId);
  if (!result.changes) throw Object.assign(new Error("Retired workflows cannot be edited."), { status: 409 });
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "workflow.updated", targetType: "workflow", targetId: id });
  return getWorkflow(actor, id);
}

export function publishWorkflow(actor: SessionActor, id: string) {
  const workflow = getWorkflow(actor, id);
  const compiled = compile(actor.organizationId, workflow.draft);
  compiled.issues.push(...validatePublisher(actor, workflow.draft));
  compiled.valid = compiled.issues.length === 0;
  if (!compiled.valid) throw Object.assign(new Error("Resolve the workflow validation issues before publishing."), { status: 409, code: "WORKFLOW_INVALID", details: compiled });
  const versionNumber = Number((db.prepare("SELECT MAX(version) value FROM workflow_versions WHERE workflow_id=?").get(id) as any)?.value || 0) + 1;
  const versionId = crypto.randomUUID();
  const at = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO workflow_versions
      (id,workflow_id,organization_id,version,definition_json,compile_json,published_by,publisher_actor_json,published_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(versionId, id, actor.organizationId, versionNumber, stringify(workflow.draft), stringify(compiled), actor.id, stringify(actor), at);
    db.prepare("UPDATE workflows SET status='published',current_version_id=?,updated_at=? WHERE id=?").run(versionId, at, id);
  })();
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "workflow.published", targetType: "workflow", targetId: id, metadata: { version: versionNumber, risk: compiled.risk } });
  return getWorkflow(actor, id);
}

export function setWorkflowState(actor: SessionActor, id: string, status: "published" | "paused" | "retired") {
  const workflow = getWorkflow(actor, id);
  if (status === "published" && !workflow.currentVersionId) throw Object.assign(new Error("Publish a valid version first."), { status: 409 });
  if (workflow.status === "retired") throw Object.assign(new Error("A retired workflow cannot be reactivated."), { status: 409 });
  db.prepare("UPDATE workflows SET status=?,updated_at=? WHERE id=? AND organization_id=?").run(status, now(), id, actor.organizationId);
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: `workflow.${status}`, targetType: "workflow", targetId: id });
  return getWorkflow(actor, id);
}
