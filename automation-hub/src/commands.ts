import crypto from "node:crypto";
import { invokeAction } from "./adapters.js";
import { audit } from "./audit.js";
import { actionCatalog, commandCatalog } from "./catalog.js";
import { connectionAvailable, readConnection } from "./connections.js";
import { config } from "./config.js";
import type { SessionActor } from "./domain.js";

export function listCommands(actor: SessionActor) {
  return commandCatalog.filter((item) => item.internal || (item.provider && connectionAvailable(actor.organizationId, item.provider)));
}

export async function executeCommand(actor: SessionActor, input: { command: string; context?: Record<string, unknown>; connectionId?: string }) {
  const command = commandCatalog.find((item) => item.command === input.command);
  if (!command) throw Object.assign(new Error("Command is unavailable or not installed."), { status: 404 });
  if (command.requiredRole === "admin" && !["admin", "owner"].includes(actor.role)) throw Object.assign(new Error("An administrator role is required."), { status: 403 });
  if (!command.internal && (!command.provider || !connectionAvailable(actor.organizationId, command.provider, input.connectionId))) {
    throw Object.assign(new Error("This external command must be enabled and connected first."), { status: 409, code: "EXTERNAL_COMMAND_DISABLED" });
  }
  const context = input.context || {};
  let result: Record<string, unknown>;
  if (command.command === "/automations") result = { type: "link", url: config.publicUrl, label: "Open Automation Hub" };
  else if (command.command === "/request-leave") result = { type: "link", url: String(process.env.LEAVE_MANAGEMENT_URL || "https://leave.seemplifyai.com/new"), label: "Open Leave request" };
  else if (command.command === "/review-payroll") result = { type: "link", url: String(process.env.PAYROLL_MANAGEMENT_URL || "https://payroll.seemplifyai.com/runs"), label: "Open Payroll review" };
  else if (command.command === "/create-task") {
    const action = actionCatalog.find((item) => item.id === "boards.create_card.v1")!;
    result = await invokeAction(action, {
      organizationId: actor.organizationId, actorId: actor.id, eventId: crypto.randomUUID(), subjectId: String(context.messageId || "command"),
      idempotencyKey: crypto.createHash("sha256").update(`${actor.organizationId}:${context.messageId}:${context.boardId}`).digest("hex"),
      input: { boardId: String(context.boardId || "inbox"), title: String(context.text || "Workspace task"), description: "Created with /create-task", sourceUrl: String(context.permalink || "") },
    });
  } else if (command.command === "/gmail-send") {
    if (input.connectionId) readConnection(actor.organizationId, input.connectionId, "google-mail");
    const action = actionCatalog.find((item) => item.id === "gmail.send_message.v1")!;
    result = await invokeAction(action, {
      organizationId: actor.organizationId, actorId: actor.id, eventId: crypto.randomUUID(), subjectId: "slash-command",
      idempotencyKey: crypto.randomUUID(), connectionId: input.connectionId,
      input: { to: String(context.to || ""), subject: String(context.subject || ""), text: String(context.text || "") },
    });
  } else throw Object.assign(new Error("No reviewed command handler exists."), { status: 409 });
  audit({ organizationId: actor.organizationId, actorId: actor.id, action: "command.executed", targetType: "command", targetId: command.command, metadata: { internal: command.internal } });
  return result;
}
