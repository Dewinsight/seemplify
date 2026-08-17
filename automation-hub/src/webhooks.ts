import crypto from "node:crypto";
import type { Request } from "express";
import { audit } from "./audit.js";
import { db, now } from "./database.js";
import type { EventEnvelope, SessionActor } from "./domain.js";
import { ingestEvent } from "./engine.js";

function tokenHash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

export function listIncomingWebhooks(actor: SessionActor) {
  return db.prepare("SELECT id,name,allowed_event_type,created_by,created_at,revoked_at FROM incoming_webhooks WHERE organization_id=? ORDER BY created_at DESC")
    .all(actor.organizationId);
}

export function createIncomingWebhook(actor: SessionActor, input: { name: string; allowedEventType: string }, baseUrl: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO incoming_webhooks
    (id,organization_id,name,token_hash,allowed_event_type,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, actor.organizationId, input.name.trim().slice(0, 120), tokenHash(token), input.allowedEventType.trim(), actor.id, now());
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "incoming_webhook.created", targetType: "incoming_webhook", targetId: id, metadata: { allowedEventType: input.allowedEventType } });
  return { id, url: `${baseUrl.replace(/\/$/u, "")}/hooks/incoming/${id}/${token}` };
}

export function revokeIncomingWebhook(actor: SessionActor, id: string) {
  const result = db.prepare("UPDATE incoming_webhooks SET revoked_at=? WHERE id=? AND organization_id=? AND revoked_at IS NULL").run(now(), id, actor.organizationId);
  if (!result.changes) throw Object.assign(new Error("Incoming webhook not found or already revoked."), { status: 404 });
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "incoming_webhook.revoked", targetType: "incoming_webhook", targetId: id });
}

export async function receiveIncomingWebhook(request: Request, id: string, token: string) {
  const hook = db.prepare("SELECT * FROM incoming_webhooks WHERE id=? AND token_hash=? AND revoked_at IS NULL")
    .get(id, tokenHash(token)) as any;
  if (!hook) throw Object.assign(new Error("Incoming webhook not found or revoked."), { status: 404 });
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const eventType = String(body.type || "");
  if (hook.allowed_event_type !== "*" && hook.allowed_event_type !== eventType) throw Object.assign(new Error("This webhook is not allowed to emit that event type."), { status: 403, code: "WEBHOOK_EVENT_DENIED" });
  const envelope: EventEnvelope = {
    id: String(body.id || crypto.randomUUID()), name: "external.webhook_received.v1", schemaVersion: 1,
    organizationId: hook.organization_id, actorId: `incoming-webhook:${id}`, subjectType: "external_event",
    subjectId: String(body.subjectId || body.id || crypto.randomUUID()), subjectRevision: String(body.subjectRevision || "1"),
    occurredAt: String(body.occurredAt || now()), correlationId: String(body.correlationId || body.id || crypto.randomUUID()),
    dataClass: "internal", payload: { source: hook.name, type: eventType, data: body.data && typeof body.data === "object" ? body.data : {} },
  };
  const result = await ingestEvent(envelope, hook.organization_id);
  audit({ organizationId: hook.organization_id, actorId: `incoming-webhook:${id}`, action: "incoming_webhook.received", targetType: "incoming_webhook", targetId: id, metadata: { eventType, duplicate: result.duplicate } });
  return { accepted: true, eventId: envelope.id, ...result };
}
