import crypto from "node:crypto";
import { config, secret } from "./config.js";
import type { ActionDescriptor, SessionActor } from "./domain.js";

export async function authorizeAtRuntime(input: {
  organizationId: string;
  publisher: SessionActor;
  action: ActionDescriptor;
  subjectId: string;
  eventId: string;
}) {
  const service = config.products.identity;
  if (!service.url) {
    if (config.nodeEnv === "production") throw Object.assign(new Error("Identity runtime authorization is unavailable."), { code: "IDENTITY_AUTHORIZATION_UNAVAILABLE" });
    return { role: input.publisher.role, organizationRevision: "development" };
  }
  const endpoint = "/api/internal/automation/authorize";
  const body = JSON.stringify({
    organizationId: input.organizationId,
    userId: input.publisher.id,
    actionId: input.action.id,
    requiredRoles: input.action.requiredRoles,
    requiredAppIds: input.action.requiredApps,
    subjectId: input.subjectId,
    eventId: input.eventId,
  });
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(18).toString("base64url");
  const signature = crypto.createHmac("sha256", secret(service.secretName, true))
    .update(`${timestamp}.${nonce}.POST.${endpoint}.${body}`).digest("hex");
  const response = await fetch(`${service.url.replace(/\/$/u, "")}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Seemplify-Automation-Timestamp": timestamp, "X-Seemplify-Automation-Nonce": nonce, "X-Seemplify-Automation-Signature": `sha256=${signature}` },
    body,
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.allowed !== true) {
    throw Object.assign(new Error(String(result.reason || "Identity denied this action at execution time.")), { code: String(result.code || "RUNTIME_AUTHORIZATION_DENIED"), status: response.status });
  }
  return { role: String(result.role || ""), organizationRevision: String(result.organizationRevision || "") };
}
