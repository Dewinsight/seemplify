import crypto from 'node:crypto';
import type { Request } from 'express';
import { db } from './database.js';

function requestId(request?: Request | null) {
  const supplied = String(request?.get?.('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{8,120}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function recordPlatformAuditEvent(input: {
  action: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  targetType: string;
  targetId: string;
  spaceId?: string | null;
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  request?: Request | null;
}) {
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,request_id,ip_address,user_agent,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(),
      input.actorUserId || null,
      input.actorRole || 'workspace_user',
      input.action,
      input.targetType,
      input.targetId,
      input.spaceId || null,
      input.reason,
      JSON.stringify(input.before || {}),
      JSON.stringify(input.after || {}),
      requestId(input.request),
      String(input.request?.ip || '').slice(0, 100),
      String(input.request?.get?.('user-agent') || '').slice(0, 500),
      new Date().toISOString()
    );
}
