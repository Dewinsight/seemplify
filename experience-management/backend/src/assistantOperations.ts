import crypto from 'node:crypto';
import { db } from './database.js';
import { redactProviderSecrets } from './nylasClient.js';

export class AssistantOperationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'ASSISTANT_OPERATION_ERROR') {
    super(message);
    this.name = 'AssistantOperationError';
    this.status = status;
    this.code = code;
  }
}

if (db.provider === 'sqlite') {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_actions (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_run_id TEXT REFERENCES assistant_runs(id) ON DELETE SET NULL,
      source_item_index INTEGER,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      due_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_actions_owner_history
      ON assistant_actions(space_id,created_by,status,created_at DESC,id);
    CREATE UNIQUE INDEX IF NOT EXISTS assistant_actions_source_item
      ON assistant_actions(space_id,created_by,source_run_id,source_item_index)
      WHERE source_run_id IS NOT NULL AND source_item_index IS NOT NULL;

    CREATE TABLE IF NOT EXISTS assistant_reminders (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL REFERENCES assistant_actions(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      remind_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','dismissed','completed')),
      revision INTEGER NOT NULL DEFAULT 1,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_reminders_owner_schedule
      ON assistant_reminders(space_id,created_by,state,remind_at,id);

    CREATE TABLE IF NOT EXISTS assistant_audit_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_audit_events_owner_history
      ON assistant_audit_events(space_id,actor_user_id,created_at DESC,id);
  `);
}

type ActionStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
type ActionPriority = 'low' | 'normal' | 'high' | 'urgent';
type ReminderState = 'scheduled' | 'dismissed' | 'completed';

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

function cleanText(value: unknown, maximum: number) {
  return redactProviderSecrets(String(value || '')).replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function optionalIso(value: unknown, field: string) {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new AssistantOperationError(`${field} must be a valid date and time.`, 400, 'ASSISTANT_DATE_INVALID');
  }
  return parsed.toISOString();
}

function safeAuditDetail(value: Record<string, unknown>) {
  const serialized = redactProviderSecrets(JSON.stringify(value));
  if (Buffer.byteLength(serialized, 'utf8') <= 16 * 1024) return serialized;
  return JSON.stringify({
    truncated: true,
    sha256: crypto.createHash('sha256').update(serialized).digest('hex')
  });
}

export function recordAssistantAudit(input: {
  spaceId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}) {
  const event = {
    id: crypto.randomUUID(),
    spaceId: input.spaceId,
    actorUserId: input.actorUserId,
    action: cleanText(input.action, 160),
    targetType: cleanText(input.targetType, 80),
    targetId: input.targetId ? cleanText(input.targetId, 300) : null,
    detail: input.detail || {},
    createdAt: new Date().toISOString()
  };
  if (!event.action || !event.targetType) {
    throw new AssistantOperationError('Assistant audit metadata is invalid.', 500, 'ASSISTANT_AUDIT_INVALID');
  }
  db.prepare(`INSERT INTO assistant_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    event.id, event.spaceId, event.actorUserId, event.action, event.targetType, event.targetId,
    safeAuditDetail(event.detail), event.createdAt
  );
  return event;
}

function publicAudit(row: any) {
  return {
    id: String(row.id),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: row.target_id ? String(row.target_id) : null,
    detail: parseJson<Record<string, unknown>>(row.detail_json, {}),
    createdAt: String(row.created_at)
  };
}

export function listAssistantAudit(spaceId: string, userId: string, limit = 100) {
  return (db.prepare(`SELECT * FROM assistant_audit_events
    WHERE space_id=? AND actor_user_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
    .all(spaceId, userId, Math.max(1, Math.min(500, limit))) as any[]).map(publicAudit);
}

function publicAction(row: any) {
  return {
    id: String(row.id),
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    sourceItemIndex: row.source_item_index == null ? null : Number(row.source_item_index),
    title: String(row.title),
    description: String(row.description || ''),
    owner: String(row.owner || ''),
    status: String(row.status) as ActionStatus,
    priority: String(row.priority) as ActionPriority,
    dueAt: row.due_at ? String(row.due_at) : null,
    revision: Number(row.revision),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function ownedAction(id: string, spaceId: string, userId: string) {
  const row = db.prepare('SELECT * FROM assistant_actions WHERE id=? AND space_id=? AND created_by=?')
    .get(id, spaceId, userId) as any;
  if (!row) throw new AssistantOperationError('Assistant action not found.', 404, 'ASSISTANT_ACTION_NOT_FOUND');
  return row;
}

export function listAssistantActions(spaceId: string, userId: string, input: {
  status?: ActionStatus;
  limit?: number;
} = {}) {
  const limit = Math.max(1, Math.min(500, input.limit || 100));
  const rows = input.status
    ? db.prepare(`SELECT * FROM assistant_actions WHERE space_id=? AND created_by=? AND status=?
        ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,created_at DESC,id DESC LIMIT ?`)
      .all(spaceId, userId, input.status, limit)
    : db.prepare(`SELECT * FROM assistant_actions WHERE space_id=? AND created_by=?
        ORDER BY CASE WHEN status IN ('open','in_progress') THEN 0 ELSE 1 END,
          CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,created_at DESC,id DESC LIMIT ?`)
      .all(spaceId, userId, limit);
  return (rows as any[]).map(publicAction);
}

export function createAssistantAction(input: {
  spaceId: string;
  userId: string;
  title: string;
  description?: string;
  owner?: string;
  status?: ActionStatus;
  priority?: ActionPriority;
  dueAt?: string | null;
}) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const title = cleanText(input.title, 700);
  if (!title) throw new AssistantOperationError('Action title is required.', 400, 'ASSISTANT_ACTION_INVALID');
  const status = input.status || 'open';
  const completedAt = status === 'completed' ? timestamp : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO assistant_actions
      (id,space_id,created_by,source_run_id,source_item_index,title,description,owner,status,priority,due_at,revision,completed_at,created_at,updated_at)
      VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,1,?,?,?)`).run(
      id, input.spaceId, input.userId, title, cleanText(input.description, 4_000), cleanText(input.owner, 200),
      status, input.priority || 'normal', optionalIso(input.dueAt, 'dueAt'), completedAt, timestamp, timestamp
    );
    recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.action.created',
      targetType: 'action',
      targetId: id,
      detail: { source: 'manual', status, priority: input.priority || 'normal' }
    });
  })();
  return publicAction(ownedAction(id, input.spaceId, input.userId));
}

function runActionItems(run: any) {
  const output = parseJson<Record<string, any>>(run.output_json, {});
  return Array.isArray(output.actionItems) ? output.actionItems : [];
}

export function promoteAssistantAction(input: {
  spaceId: string;
  userId: string;
  runId: string;
  actionIndex: number;
  owner?: string;
  priority?: ActionPriority;
  dueAt?: string | null;
}) {
  const run = db.prepare(`SELECT * FROM assistant_runs
    WHERE id=? AND space_id=? AND requested_by=? AND state='completed'`).get(input.runId, input.spaceId, input.userId) as any;
  if (!run) throw new AssistantOperationError('Completed assistant run not found.', 404, 'ASSISTANT_RUN_NOT_FOUND');
  const items = runActionItems(run);
  const item = items[input.actionIndex];
  if (!item || typeof item !== 'object') {
    throw new AssistantOperationError('The selected assistant action item does not exist.', 404, 'ASSISTANT_ACTION_ITEM_NOT_FOUND');
  }
  const existing = db.prepare(`SELECT * FROM assistant_actions
    WHERE space_id=? AND created_by=? AND source_run_id=? AND source_item_index=?`)
    .get(input.spaceId, input.userId, input.runId, input.actionIndex) as any;
  if (existing) return { action: publicAction(existing), created: false };
  const title = cleanText(item.action || item.title, 700);
  if (!title) throw new AssistantOperationError('The selected assistant action item is invalid.', 409, 'ASSISTANT_ACTION_ITEM_INVALID');
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sourceRef = cleanText(item.sourceMessageId || item.sourceRef, 300);
  const dueAt = optionalIso(input.dueAt, 'dueAt')
    || (item.dueDate && !Number.isNaN(new Date(String(item.dueDate)).getTime()) ? new Date(String(item.dueDate)).toISOString() : null);
  return db.transaction(() => {
    db.prepare(`INSERT INTO assistant_actions
      (id,space_id,created_by,source_run_id,source_item_index,title,description,owner,status,priority,due_at,revision,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,?)`).run(
      id, input.spaceId, input.userId, input.runId, input.actionIndex, title,
      sourceRef ? `Promoted from cited assistant evidence ${sourceRef}.` : '',
      cleanText(input.owner ?? item.owner, 200), 'open', input.priority || 'normal', dueAt, timestamp, timestamp
    );
    recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.action.promoted',
      targetType: 'action',
      targetId: id,
      detail: { runId: input.runId, actionIndex: input.actionIndex, sourceRef: sourceRef || null }
    });
    return { action: publicAction(ownedAction(id, input.spaceId, input.userId)), created: true };
  })();
}

export function updateAssistantAction(input: {
  id: string;
  spaceId: string;
  userId: string;
  revision: number;
  title?: string;
  description?: string;
  owner?: string;
  status?: ActionStatus;
  priority?: ActionPriority;
  dueAt?: string | null;
}) {
  const current = ownedAction(input.id, input.spaceId, input.userId);
  if (Number(current.revision) !== input.revision) {
    throw new AssistantOperationError('This action changed in another session. Refresh and try again.', 409, 'ASSISTANT_ACTION_REVISION_CONFLICT');
  }
  const title = input.title === undefined ? String(current.title) : cleanText(input.title, 700);
  if (!title) throw new AssistantOperationError('Action title is required.', 400, 'ASSISTANT_ACTION_INVALID');
  const status = input.status || String(current.status) as ActionStatus;
  const timestamp = new Date().toISOString();
  const changed = db.transaction(() => {
    const changed = db.prepare(`UPDATE assistant_actions SET title=?,description=?,owner=?,status=?,priority=?,due_at=?,
      revision=revision+1,completed_at=?,updated_at=? WHERE id=? AND space_id=? AND created_by=? AND revision=?`).run(
      title,
      input.description === undefined ? current.description : cleanText(input.description, 4_000),
      input.owner === undefined ? current.owner : cleanText(input.owner, 200),
      status,
      input.priority || current.priority,
      input.dueAt === undefined ? current.due_at : optionalIso(input.dueAt, 'dueAt'),
      status === 'completed' ? (current.completed_at || timestamp) : null,
      timestamp, input.id, input.spaceId, input.userId, input.revision
    ).changes;
    if (changed) recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.action.updated',
      targetType: 'action',
      targetId: input.id,
      detail: {
        revision: input.revision + 1,
        previousStatus: current.status,
        status,
        changedFields: Object.keys(input).filter((key) => !['id', 'spaceId', 'userId', 'revision'].includes(key))
      }
    });
    return changed;
  })();
  if (!changed) throw new AssistantOperationError('This action changed in another session. Refresh and try again.', 409, 'ASSISTANT_ACTION_REVISION_CONFLICT');
  return publicAction(ownedAction(input.id, input.spaceId, input.userId));
}

function publicReminder(row: any) {
  return {
    id: String(row.id),
    actionId: String(row.action_id),
    remindAt: String(row.remind_at),
    note: String(row.note || ''),
    state: String(row.state) as ReminderState,
    revision: Number(row.revision),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function ownedReminder(id: string, actionId: string, spaceId: string, userId: string) {
  const row = db.prepare(`SELECT reminder.* FROM assistant_reminders reminder
    JOIN assistant_actions action ON action.id=reminder.action_id
    WHERE reminder.id=? AND reminder.action_id=? AND reminder.space_id=? AND reminder.created_by=?
      AND action.space_id=? AND action.created_by=?`).get(id, actionId, spaceId, userId, spaceId, userId) as any;
  if (!row) throw new AssistantOperationError('Assistant reminder not found.', 404, 'ASSISTANT_REMINDER_NOT_FOUND');
  return row;
}

export function listAssistantReminders(actionId: string, spaceId: string, userId: string) {
  ownedAction(actionId, spaceId, userId);
  return (db.prepare(`SELECT * FROM assistant_reminders
    WHERE action_id=? AND space_id=? AND created_by=? ORDER BY remind_at,id`)
    .all(actionId, spaceId, userId) as any[]).map(publicReminder);
}

export function createAssistantReminder(input: {
  actionId: string;
  spaceId: string;
  userId: string;
  remindAt: string;
  note?: string;
}) {
  ownedAction(input.actionId, input.spaceId, input.userId);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const remindAt = optionalIso(input.remindAt, 'remindAt');
  if (!remindAt) throw new AssistantOperationError('Reminder time is required.', 400, 'ASSISTANT_REMINDER_INVALID');
  db.transaction(() => {
    db.prepare(`INSERT INTO assistant_reminders
      (id,space_id,action_id,created_by,remind_at,note,state,revision,delivered_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'scheduled',1,NULL,?,?)`).run(
      id, input.spaceId, input.actionId, input.userId, remindAt, cleanText(input.note, 1_000), timestamp, timestamp
    );
    recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.reminder.created',
      targetType: 'reminder',
      targetId: id,
      detail: { actionId: input.actionId, remindAt }
    });
  })();
  return publicReminder(ownedReminder(id, input.actionId, input.spaceId, input.userId));
}

export function updateAssistantReminder(input: {
  id: string;
  actionId: string;
  spaceId: string;
  userId: string;
  revision: number;
  remindAt?: string;
  note?: string;
  state?: ReminderState;
}) {
  const current = ownedReminder(input.id, input.actionId, input.spaceId, input.userId);
  if (Number(current.revision) !== input.revision) {
    throw new AssistantOperationError('This reminder changed in another session. Refresh and try again.', 409, 'ASSISTANT_REMINDER_REVISION_CONFLICT');
  }
  const timestamp = new Date().toISOString();
  const state = input.state || current.state as ReminderState;
  const changed = db.transaction(() => {
    const changed = db.prepare(`UPDATE assistant_reminders SET remind_at=?,note=?,state=?,revision=revision+1,
      delivered_at=?,updated_at=? WHERE id=? AND action_id=? AND space_id=? AND created_by=? AND revision=?`).run(
      input.remindAt === undefined ? current.remind_at : optionalIso(input.remindAt, 'remindAt'),
      input.note === undefined ? current.note : cleanText(input.note, 1_000),
      state,
      current.delivered_at,
      timestamp, input.id, input.actionId, input.spaceId, input.userId, input.revision
    ).changes;
    if (changed) recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.reminder.updated',
      targetType: 'reminder',
      targetId: input.id,
      detail: { actionId: input.actionId, previousState: current.state, state, revision: input.revision + 1 }
    });
    return changed;
  })();
  if (!changed) throw new AssistantOperationError('This reminder changed in another session. Refresh and try again.', 409, 'ASSISTANT_REMINDER_REVISION_CONFLICT');
  return publicReminder(ownedReminder(input.id, input.actionId, input.spaceId, input.userId));
}
