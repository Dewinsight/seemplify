import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { actionCatalog, commandCatalog, connectorCatalog, eventCatalog, recipeTemplates } from "./catalog.js";
import { config, secret } from "./config.js";
import { actor, canManage, finishOidc, logout, requireActor, sessionResponse, startOidc, testLogin } from "./auth.js";
import { db, json, resetDatabaseForTests } from "./database.js";
import { createFromTemplate, createWorkflow, getWorkflow, listWorkflows, publishWorkflow, setWorkflowState, updateWorkflow } from "./workflows.js";
import { decideApproval, getRun, ingestEvent, listApprovals, listRuns, retryRun } from "./engine.js";
import { confirmConnection, createConnectSession, listConnectors, revokeConnection, setConnectorEnabled, verifyConnection } from "./connections.js";
import { createIncomingWebhook, listIncomingWebhooks, receiveIncomingWebhook, revokeIncomingWebhook } from "./webhooks.js";
import { createSubscription, listDeliveries, listSubscriptions, revokeSubscription } from "./subscriptions.js";
import { executeCommand, listCommands } from "./commands.js";
import type { DataClass, EventEnvelope } from "./domain.js";

type RawRequest = Request & { rawBody?: Buffer };

function requireManager(request: Request, response: Response, next: NextFunction) {
  if (!canManage(actor(request))) return response.status(403).json({ error: "An organization owner or automation administrator is required." });
  next();
}

function param(request: Request, name: string) { return String(request.params[name] || ""); }

function serviceForEvent(name: string) {
  const descriptor = eventCatalog.find((item) => item.id === name);
  if (!descriptor) return null;
  if (["Workspace", "Boards", "Pages"].includes(descriptor.product)) return config.products.workspace;
  if (descriptor.product === "Payroll") return config.products.payroll;
  if (descriptor.product === "Leave") return config.products.leave;
  if (descriptor.product === "Identity") return config.products.identity;
  return null;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type IdentityWebhook = {
  eventId?: string;
  event?: string;
  occurredAt?: string;
  timestamp?: string;
  data?: Record<string, any>;
};

function verifyIdentityWebhook(request: RawRequest, response: Response, next: NextFunction) {
  const deliveryTimestamp = String(request.headers["x-idp-delivery-timestamp"] || "");
  const supplied = String(request.headers["x-idp-signature-v2"] || "");
  const deliveredAt = Date.parse(deliveryTimestamp);
  if (!Number.isFinite(deliveredAt) || Math.abs(Date.now() - deliveredAt) > 5 * 60_000) {
    return response.status(401).json({ error: "The Identity webhook signature expired." });
  }
  let signingSecret: string;
  try { signingSecret = secret(config.products.identity.secretName, true); }
  catch { return response.status(503).json({ error: "The Identity webhook secret is not configured." }); }
  const raw = request.rawBody?.toString("utf8") || JSON.stringify(request.body);
  const expected = crypto.createHmac("sha256", signingSecret).update(`${deliveryTimestamp}\n${raw}`).digest("hex");
  if (!supplied || !safeEqual(supplied, expected)) return response.status(401).json({ error: "The Identity webhook signature is invalid." });
  next();
}

function identityMembershipEvent(payload: IdentityWebhook): EventEnvelope {
  const data = payload.data || {};
  const organization = data.organization || {};
  const member = organization.member || {};
  const occurredAt = String(payload.occurredAt || payload.timestamp || new Date().toISOString());
  const employeeId = String(member.employeeId || data.userId || "");
  return {
    id: String(payload.eventId || ""),
    name: "identity.employee_membership_activated.v1",
    schemaVersion: 1,
    organizationId: String(data.organizationId || organization.id || ""),
    actorId: String(data.userId || employeeId),
    subjectType: "membership",
    subjectId: String(data.userId || employeeId),
    subjectRevision: occurredAt,
    occurredAt,
    correlationId: String(payload.eventId || ""),
    dataClass: "confidential",
    payload: {
      employeeId,
      employeeName: String(member.name || member.email || employeeId),
      employeeEmail: String(member.email || ""),
      onboardingTemplateId: String(member.onboardingTemplateId || "standard"),
    },
  };
}

function verifyInternalEvent(request: RawRequest, response: Response, next: NextFunction) {
  const envelope = request.body as EventEnvelope;
  const service = serviceForEvent(String(envelope?.name || ""));
  if (!service) return response.status(400).json({ error: "The event source is not registered." });
  const timestamp = String(request.headers["x-seemplify-automation-timestamp"] || "");
  const supplied = String(request.headers["x-seemplify-automation-signature"] || "").replace(/^sha256=/u, "");
  if (!/^\d{13}$/u.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return response.status(401).json({ error: "The event signature expired." });
  let signingSecret: string;
  try { signingSecret = secret(service.secretName, true); } catch { return response.status(503).json({ error: "The event source secret is not configured." }); }
  const raw = request.rawBody?.toString("utf8") || JSON.stringify(request.body);
  const expected = crypto.createHmac("sha256", signingSecret).update(`${timestamp}.POST./api/internal/events.${raw}`).digest("hex");
  if (!supplied || !safeEqual(supplied, expected)) return response.status(401).json({ error: "The event signature is invalid." });
  const trustedOrganization = String(request.headers["x-seemplify-organization"] || "");
  if (!trustedOrganization) return response.status(400).json({ error: "Trusted organization header is required." });
  (request as Request & { trustedOrganization: string }).trustedOrganization = trustedOrganization;
  next();
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: config.nodeEnv === "production" ? undefined : false }));
  app.use(express.json({ limit: "1mb", verify: (request, _response, buffer) => { (request as RawRequest).rawBody = Buffer.from(buffer); } }));

  app.get("/api/health", (_request, response) => response.json({ ok: true, service: "automation-hub", auth: config.nodeEnv === "production" ? "seemplify-identity" : "development" }));
  app.get("/auth/login", startOidc);
  app.get("/auth/callback", finishOidc);
  app.post("/auth/test-login", testLogin);
  app.post("/auth/logout", logout);
  app.get("/api/session", sessionResponse);

  app.post("/hooks/incoming/:id/:token", async (request, response) => response.status(202).json(await receiveIncomingWebhook(request, param(request, "id"), param(request, "token"))));
  app.post("/hooks/identity", verifyIdentityWebhook, async (request, response) => {
    const payload = request.body as IdentityWebhook;
    if (!payload.eventId || !payload.event) return response.status(400).json({ error: "The Identity event envelope is incomplete." });
    const result = payload.event === "organization.member.added"
      ? await ingestEvent(identityMembershipEvent(payload), String(payload.data?.organizationId || payload.data?.organization?.id || ""))
      : { duplicate: false, runIds: [] };
    response.status(202).json({ received: true, event: payload.event, eventId: payload.eventId, ...result });
  });
  app.post("/api/internal/events", verifyInternalEvent, async (request, response) => {
    const organizationId = (request as Request & { trustedOrganization: string }).trustedOrganization;
    response.status(202).json(await ingestEvent(request.body as EventEnvelope, organizationId));
  });

  if (config.testAuthEnabled) {
    app.post("/api/test/reset", (_request, response) => { resetDatabaseForTests(); response.status(204).end(); });
  }

  app.use("/api", requireActor);

  app.get("/api/catalog", (request, response) => response.json({ events: eventCatalog, actions: actionCatalog, connectors: connectorCatalog, commands: listCommands(actor(request)) }));
  app.get("/api/templates", (_request, response) => response.json(recipeTemplates));

  app.get("/api/workflows", (request, response) => response.json(listWorkflows(actor(request))));
  app.get("/api/workflows/:id", (request, response) => response.json(getWorkflow(actor(request), param(request, "id"))));
  app.post("/api/workflows", requireManager, (request, response) => response.status(201).json(createWorkflow(actor(request), request.body)));
  app.post("/api/workflows/from-template/:templateId", requireManager, (request, response) => response.status(201).json(createFromTemplate(actor(request), param(request, "templateId"))));
  app.put("/api/workflows/:id", requireManager, (request, response) => response.json(updateWorkflow(actor(request), param(request, "id"), request.body)));
  app.post("/api/workflows/:id/publish", requireManager, (request, response) => response.json(publishWorkflow(actor(request), param(request, "id"))));
  app.post("/api/workflows/:id/state", requireManager, (request, response) => response.json(setWorkflowState(actor(request), param(request, "id"), request.body?.status)));

  app.get("/api/runs", (request, response) => response.json(listRuns(actor(request))));
  app.get("/api/runs/:id", (request, response) => response.json(getRun(actor(request), param(request, "id"))));
  app.post("/api/runs/:id/retry", requireManager, async (request, response) => response.json(await retryRun(actor(request), param(request, "id"))));
  app.get("/api/approvals", (request, response) => response.json(listApprovals(actor(request))));
  app.post("/api/approvals/:id/decision", async (request, response) => response.json(await decideApproval(actor(request), param(request, "id"), request.body?.decision, String(request.body?.rationale || ""))));

  app.post("/api/events/test", async (request, response) => {
    if (!config.testAuthEnabled) return response.status(404).end();
    const sessionActor = actor(request);
    const submitted = request.body as Partial<EventEnvelope>;
    const envelope = { ...submitted, organizationId: sessionActor.organizationId, actorId: sessionActor.id } as EventEnvelope;
    return response.status(202).json(await ingestEvent(envelope, sessionActor.organizationId));
  });

  app.get("/api/connectors", (request, response) => response.json(listConnectors(actor(request))));
  app.put("/api/connectors/:provider", requireManager, (request, response) => {
    setConnectorEnabled(actor(request), param(request, "provider"), Boolean(request.body?.enabled), (request.body?.allowedDataClasses || ["public", "internal"]) as DataClass[]);
    response.json(listConnectors(actor(request)));
  });
  app.post("/api/connectors/:provider/session", requireManager, async (request, response) => response.status(201).json(await createConnectSession(actor(request), param(request, "provider"), request.body?.ownerType === "user" ? "user" : "organization")));
  app.post("/api/connectors/:provider/confirm", requireManager, async (request, response) => response.status(201).json(await confirmConnection(actor(request), { provider: param(request, "provider"), nangoConnectionId: String(request.body?.nangoConnectionId || ""), ownerType: request.body?.ownerType === "user" ? "user" : "organization", displayName: request.body?.displayName })));
  app.post("/api/connections/:id/verify", requireManager, async (request, response) => response.json(await verifyConnection(actor(request), param(request, "id"))));
  app.delete("/api/connections/:id", requireManager, async (request, response) => { await revokeConnection(actor(request), param(request, "id")); response.status(204).end(); });

  app.get("/api/incoming-webhooks", (request, response) => response.json(listIncomingWebhooks(actor(request))));
  app.post("/api/incoming-webhooks", requireManager, (request, response) => response.status(201).json(createIncomingWebhook(actor(request), { name: String(request.body?.name || ""), allowedEventType: String(request.body?.allowedEventType || "*") }, config.publicUrl)));
  app.delete("/api/incoming-webhooks/:id", requireManager, (request, response) => { revokeIncomingWebhook(actor(request), param(request, "id")); response.status(204).end(); });
  app.get("/api/event-subscriptions", (request, response) => response.json(listSubscriptions(actor(request))));
  app.post("/api/event-subscriptions", requireManager, async (request, response) => response.status(201).json(await createSubscription(actor(request), { name: String(request.body?.name || ""), eventPattern: String(request.body?.eventPattern || ""), targetUrl: String(request.body?.targetUrl || "") })));
  app.delete("/api/event-subscriptions/:id", requireManager, (request, response) => { revokeSubscription(actor(request), param(request, "id")); response.status(204).end(); });
  app.get("/api/webhook-deliveries", (request, response) => response.json(listDeliveries(actor(request))));

  app.get("/api/commands", (request, response) => response.json(listCommands(actor(request))));
  app.post("/api/commands/execute", async (request, response) => response.json(await executeCommand(actor(request), { command: String(request.body?.command || ""), context: request.body?.context, connectionId: request.body?.connectionId })));

  app.get("/api/audit", (request, response) => {
    const rows = db.prepare("SELECT sequence,id,actor_id,action,target_type,target_id,metadata_json,created_at FROM audit_events WHERE organization_id=? ORDER BY sequence DESC LIMIT 300")
      .all(actor(request).organizationId).map((row: any) => ({ ...row, metadata: json(row.metadata_json, {}), metadata_json: undefined }));
    response.json(rows);
  });

  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  app.use(express.static(webRoot, { index: false, maxAge: config.nodeEnv === "production" ? "1h" : 0 }));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(webRoot, "index.html")));

  app.use((error: Error & { status?: number; code?: string; details?: unknown }, _request: Request, response: Response, _next: NextFunction) => {
    if (config.nodeEnv !== "test") console.error(error);
    response.status(error.status && error.status >= 400 && error.status < 600 ? error.status : 500)
      .json({ error: error.message || "Automation Hub request failed.", code: error.code, details: error.details });
  });
  return app;
}
