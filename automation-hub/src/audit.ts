import crypto from "node:crypto";
import { db, now, stringify } from "./database.js";

const secretKeys = /token|secret|password|authorization|credential|content|excerpt|text/iu;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, secretKeys.test(key) ? "[redacted]" : redact(item)]));
}

export function audit(input: {
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  db.prepare(`INSERT INTO audit_events
    (id,organization_id,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.organizationId, input.actorId, input.action,
      input.targetType, input.targetId, stringify(redact(input.metadata || {})), now(),
    );
}
