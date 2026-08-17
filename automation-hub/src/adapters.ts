import crypto from "node:crypto";
import { config, secret } from "./config.js";
import { db, now } from "./database.js";
import { readConnection, nangoProxy } from "./connections.js";
import type { ActionDescriptor } from "./domain.js";

export interface ActionInvocation {
  organizationId: string;
  actorId: string;
  eventId: string;
  subjectId: string;
  idempotencyKey: string;
  connectionId?: string;
  input: Record<string, unknown>;
  authorizationContext?: { role?: string; organizationRevision?: string };
}

function serviceFor(product: string) {
  if (["Workspace", "Boards", "Pages"].includes(product)) return config.products.workspace;
  if (product === "Payroll") return config.products.payroll;
  if (product === "Leave") return config.products.leave;
  if (product === "Time & Attendance") return config.products.time;
  if (product === "Identity") return config.products.identity;
  if (product === "Learning") return config.products.learning;
  return null;
}

async function invokeInternal(action: ActionDescriptor, invocation: ActionInvocation) {
  const service = serviceFor(action.product);
  if (!service?.url) throw Object.assign(new Error(`${action.product} adapter is not configured.`), { code: "ADAPTER_NOT_CONFIGURED" });
  const endpoint = `/api/automation/actions/${action.id.replace(/\.v\d+$/u, "")}`;
  const body = JSON.stringify({
    actionId: action.id,
    organizationId: invocation.organizationId,
    actorId: invocation.actorId,
    eventId: invocation.eventId,
    subjectId: invocation.subjectId,
    input: invocation.input,
    authorizationContext: invocation.authorizationContext,
  });
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(18).toString("base64url");
  const signingSecret = secret(service.secretName, true);
  const signature = crypto.createHmac("sha256", signingSecret).update(`${timestamp}.${nonce}.POST.${endpoint}.${body}`).digest("hex");
  const response = await fetch(`${service.url.replace(/\/$/u, "")}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": invocation.idempotencyKey,
      "X-Seemplify-Organization": invocation.organizationId,
      "X-Seemplify-Automation-Timestamp": timestamp,
      "X-Seemplify-Automation-Nonce": nonce,
      "X-Seemplify-Automation-Signature": `sha256=${signature}`,
    },
    body,
  });
  const text = await response.text();
  const parsed = (() => { try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; } })() as Record<string, unknown>;
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 429;
    throw Object.assign(new Error(String(parsed.error || parsed.message || `${action.product} returned ${response.status}.`)), {
      code: uncertain ? "PRODUCT_OUTCOME_UNKNOWN" : "PRODUCT_REJECTED", status: response.status, uncertain,
    });
  }
  if (!parsed.outcomeId) throw Object.assign(new Error(`${action.product} did not return an authoritative outcome ID.`), { code: "AUTHORITATIVE_OUTCOME_MISSING", uncertain: true });
  return parsed;
}

function encodeMime(input: Record<string, unknown>) {
  const to = String(input.to || "").replace(/[\r\n]/gu, "");
  const subject = String(input.subject || "").replace(/[\r\n]/gu, "");
  const text = String(input.text || "");
  return Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`, "utf8").toString("base64url");
}

async function invokeExternal(action: ActionDescriptor, invocation: ActionInvocation) {
  if (!action.provider || !invocation.connectionId) throw Object.assign(new Error("Select an installed external connection."), { code: "CONNECTION_REQUIRED" });
  const connection = readConnection(invocation.organizationId, invocation.connectionId, action.provider);
  if (!connection) throw Object.assign(new Error("The external connection is unavailable or revoked."), { code: "CONNECTION_UNAVAILABLE" });
  if (action.id === "gmail.send_message.v1") {
    const response = await nangoProxy(connection, "/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": invocation.idempotencyKey },
      body: JSON.stringify({ raw: encodeMime(invocation.input) }),
    });
    return { outcomeId: String(response.id || response.messageId || ""), provider: action.provider, response };
  }
  if (action.id === "google-drive.upsert_page.v1") {
    const sourceId = String(invocation.input.pageId || invocation.subjectId);
    const mapping = db.prepare("SELECT * FROM external_mappings WHERE organization_id=? AND connection_id=? AND action_id=? AND source_id=?")
      .get(invocation.organizationId, invocation.connectionId, action.id, sourceId) as any;
    if (mapping) {
      await nangoProxy(connection, `/upload/drive/v3/files/${encodeURIComponent(mapping.provider_resource_id)}?uploadType=media`, {
        method: "PATCH", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: String(invocation.input.content || ""),
      });
      return { outcomeId: mapping.provider_resource_id, url: mapping.provider_url, provider: action.provider, updated: true };
    }
    const boundary = `seemplify-${crypto.randomBytes(12).toString("hex")}`;
    const metadata = JSON.stringify({ name: String(invocation.input.title || "Untitled Page"), parents: invocation.input.folderId ? [String(invocation.input.folderId)] : undefined });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${String(invocation.input.content || "")}\r\n--${boundary}--`;
    const response = await nangoProxy(connection, "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Idempotency-Key": invocation.idempotencyKey }, body,
    });
    const resourceId = String(response.id || "");
    if (!resourceId) throw Object.assign(new Error("Google Drive did not return a file ID."), { code: "AUTHORITATIVE_OUTCOME_MISSING", uncertain: true });
    const at = now();
    db.prepare("INSERT INTO external_mappings (id,organization_id,connection_id,action_id,source_id,provider_resource_id,provider_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), invocation.organizationId, invocation.connectionId, action.id, sourceId, resourceId, String(response.webViewLink || ""), at, at);
    return { outcomeId: resourceId, url: response.webViewLink, provider: action.provider, created: true };
  }
  throw Object.assign(new Error(`No reviewed adapter exists for ${action.id}.`), { code: "ADAPTER_NOT_REVIEWED" });
}

export function invokeAction(action: ActionDescriptor, invocation: ActionInvocation) {
  return action.external ? invokeExternal(action, invocation) : invokeInternal(action, invocation);
}
