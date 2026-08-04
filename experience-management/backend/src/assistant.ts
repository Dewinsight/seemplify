import crypto from 'node:crypto';
import { emailDraftPlainText, normalizeEmailDraftHtml } from './emailDraftHtml.js';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { createJob, db, getJob } from './database.js';
import { publishEvent } from './events.js';
import { IntelligenceError, resolveIntelligenceSourceSnapshots } from './intelligence.js';
import { decryptNylasSecret, encryptNylasSecret, fingerprintNylasGrant } from './nylasSecrets.js';
import {
  providerHtmlToText, redactProviderSecrets, type AssistantThreadSnapshot,
  type NylasProvider, type NylasReplyRecipient
} from './nylasClient.js';
import { recordAssistantAudit } from './assistantOperations.js';
import { assertCanQueueAiAction } from './subscriptionEntitlements.js';
import type { AssistantDocumentType } from './assistantSchemas.js';
import './spaces.js';
import type { AiJob, AiJobKind } from './types.js';

export type AssistantRunKind = 'email_summary' | 'email_draft' | 'knowledge_answer' | 'work_product';

export class AssistantError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'ASSISTANT_ERROR') {
    super(message);
    this.name = 'AssistantError';
    this.status = status;
    this.code = code;
  }
}

export function publishAssistantChanged(spaceId: string) {
  publishEvent('data-changed', { reason: 'assistant-data-changed' }, spaceId);
}

if (db.provider === 'sqlite') {
db.exec(`
  CREATE TABLE IF NOT EXISTS assistant_nylas_connections (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
    grant_id_enc TEXT NOT NULL,
    grant_fingerprint TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    scopes_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','revoked','error')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS assistant_nylas_connections_owner
    ON assistant_nylas_connections(space_id,user_id,status,updated_at DESC);

  CREATE TABLE IF NOT EXISTS assistant_nylas_oauth_states (
    state_hash TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_nylas_oauth_states_expiry
    ON assistant_nylas_oauth_states(expires_at,consumed_at);

  CREATE TABLE IF NOT EXISTS assistant_runs (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    ai_job_id TEXT UNIQUE REFERENCES ai_jobs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK(kind IN ('email_summary','email_draft','knowledge_answer','work_product')),
    connection_id TEXT REFERENCES assistant_nylas_connections(id) ON DELETE SET NULL,
    subject_ref TEXT,
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]',
    document_type TEXT,
    title TEXT,
    input_snapshot_json TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','completed','failed')),
    output_json TEXT,
    runtime_json TEXT,
    generated_subject TEXT,
    generated_body TEXT,
    draft_subject TEXT,
    draft_body TEXT,
    draft_revision INTEGER NOT NULL DEFAULT 0,
    draft_updated_at TEXT,
    error TEXT,
    advisory_only INTEGER NOT NULL DEFAULT 1 CHECK(advisory_only=1),
    external_dispatched INTEGER NOT NULL DEFAULT 0 CHECK(external_dispatched=0),
    idempotency_key TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_runs_owner_history
    ON assistant_runs(space_id,requested_by,created_at DESC,id);
  CREATE INDEX IF NOT EXISTS assistant_runs_job ON assistant_runs(ai_job_id);
  CREATE UNIQUE INDEX IF NOT EXISTS assistant_runs_idempotency
    ON assistant_runs(space_id,requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS assistant_outbound_messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES assistant_runs(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    connection_id TEXT NOT NULL REFERENCES assistant_nylas_connections(id) ON DELETE RESTRICT,
    thread_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('reply','reply_all')),
    status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
    provider_idempotency_key TEXT NOT NULL UNIQUE,
    provider_reply_to_message_id TEXT NOT NULL,
    provider_message_id TEXT,
    recipients_json TEXT NOT NULL DEFAULT '[]',
    subject_sha256 TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assistant_outbound_messages_owner
    ON assistant_outbound_messages(space_id,user_id,created_at DESC,id);
`);

const assistantRunColumns = new Set((db.pragma('table_info(assistant_runs)') as Array<{ name: string }>).map((column) => column.name));
if (!assistantRunColumns.has('generated_subject')) db.exec('ALTER TABLE assistant_runs ADD COLUMN generated_subject TEXT');
if (!assistantRunColumns.has('generated_body')) db.exec('ALTER TABLE assistant_runs ADD COLUMN generated_body TEXT');
if (!assistantRunColumns.has('advisory_only')) db.exec('ALTER TABLE assistant_runs ADD COLUMN advisory_only INTEGER NOT NULL DEFAULT 1');
if (!assistantRunColumns.has('external_dispatched')) db.exec('ALTER TABLE assistant_runs ADD COLUMN external_dispatched INTEGER NOT NULL DEFAULT 0');
if (!assistantRunColumns.has('request_fingerprint')) db.exec('ALTER TABLE assistant_runs ADD COLUMN request_fingerprint TEXT');
if (!assistantRunColumns.has('knowledge_base_ids_json')) db.exec("ALTER TABLE assistant_runs ADD COLUMN knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]'");
if (!assistantRunColumns.has('document_type')) db.exec('ALTER TABLE assistant_runs ADD COLUMN document_type TEXT');
if (!assistantRunColumns.has('title')) db.exec('ALTER TABLE assistant_runs ADD COLUMN title TEXT');
const assistantRunsSql = String((db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='assistant_runs'"
).get() as any)?.sql || '');
if (assistantRunsSql && !assistantRunsSql.includes("'work_product'")) {
  db.prepare(`UPDATE assistant_runs SET request_fingerprint=lower(hex(randomblob(32)))
    WHERE request_fingerprint IS NULL OR trim(request_fingerprint)=''`).run();
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS assistant_runs_work_product_next;
        CREATE TABLE assistant_runs_work_product_next (
          id TEXT PRIMARY KEY,
          space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          ai_job_id TEXT UNIQUE REFERENCES ai_jobs(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK(kind IN ('email_summary','email_draft','knowledge_answer','work_product')),
          connection_id TEXT REFERENCES assistant_nylas_connections(id) ON DELETE SET NULL,
          subject_ref TEXT,
          source_refs_json TEXT NOT NULL DEFAULT '[]',
          knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]',
          document_type TEXT,
          title TEXT,
          input_snapshot_json TEXT NOT NULL,
          input_sha256 TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','completed','failed')),
          output_json TEXT,
          runtime_json TEXT,
          generated_subject TEXT,
          generated_body TEXT,
          draft_subject TEXT,
          draft_body TEXT,
          draft_revision INTEGER NOT NULL DEFAULT 0,
          draft_updated_at TEXT,
          error TEXT,
          advisory_only INTEGER NOT NULL DEFAULT 1 CHECK(advisory_only=1),
          external_dispatched INTEGER NOT NULL DEFAULT 0 CHECK(external_dispatched=0),
          idempotency_key TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO assistant_runs_work_product_next (
          id,space_id,requested_by,ai_job_id,kind,connection_id,subject_ref,source_refs_json,
          knowledge_base_ids_json,document_type,title,input_snapshot_json,input_sha256,request_fingerprint,
          state,output_json,runtime_json,generated_subject,generated_body,draft_subject,draft_body,
          draft_revision,draft_updated_at,error,advisory_only,external_dispatched,idempotency_key,
          created_at,started_at,completed_at,updated_at
        ) SELECT
          id,space_id,requested_by,ai_job_id,kind,connection_id,subject_ref,source_refs_json,
          knowledge_base_ids_json,document_type,title,input_snapshot_json,input_sha256,request_fingerprint,
          state,output_json,runtime_json,generated_subject,generated_body,draft_subject,draft_body,
          draft_revision,draft_updated_at,error,advisory_only,external_dispatched,idempotency_key,
          created_at,started_at,completed_at,updated_at
        FROM assistant_runs;
        DROP TABLE assistant_runs;
        ALTER TABLE assistant_runs_work_product_next RENAME TO assistant_runs;
        CREATE INDEX assistant_runs_owner_history
          ON assistant_runs(space_id,requested_by,created_at DESC,id);
        CREATE INDEX assistant_runs_job ON assistant_runs(ai_job_id);
        CREATE UNIQUE INDEX assistant_runs_idempotency
          ON assistant_runs(space_id,requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL;
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const assistantForeignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as any[])
    .filter((violation) => ['assistant_runs', 'assistant_actions', 'assistant_reminders'].includes(String(violation.table)));
  if (assistantForeignKeyViolations.length) {
    throw new Error('The assistant SQLite compatibility upgrade violated referential integrity.');
  }
}
const assistantConnectionColumns = new Set((db.pragma('table_info(assistant_nylas_connections)') as Array<{ name: string }>).map((column) => column.name));
if (!assistantConnectionColumns.has('grant_fingerprint')) db.exec('ALTER TABLE assistant_nylas_connections ADD COLUMN grant_fingerprint TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS assistant_nylas_connections_grant
  ON assistant_nylas_connections(space_id,user_id,grant_fingerprint) WHERE grant_fingerprint IS NOT NULL`);
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

function cleanText(value: unknown, maximum: number) {
  return redactProviderSecrets(String(value || '')).replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function connectionContext(id: string, spaceId: string, userId: string) {
  return `experience-nylas-grant:${id}:${spaceId}:${userId}`;
}

function snapshotContext(id: string, spaceId: string, userId: string) {
  return `experience-assistant-snapshot:${id}:${spaceId}:${userId}`;
}

function publicConnection(row: any) {
  return {
    id: String(row.id), provider: String(row.provider) as NylasProvider,
    email: String(row.email || ''), scopes: parseJson<string[]>(row.scopes_json, []),
    status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

export function createNylasOAuthState(userId: string, spaceId: string, provider: NylasProvider) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + config.nylasOAuthStateMinutes * 60_000);
  db.transaction(() => {
    db.prepare('DELETE FROM assistant_nylas_oauth_states WHERE expires_at<=? OR consumed_at IS NOT NULL AND consumed_at<=?')
      .run(createdAt.toISOString(), new Date(createdAt.getTime() - 24 * 60 * 60_000).toISOString());
    db.prepare(`INSERT INTO assistant_nylas_oauth_states
      (state_hash,space_id,user_id,provider,expires_at,consumed_at,created_at) VALUES (?,?,?,?,?,NULL,?)`)
      .run(hash, spaceId, userId, provider, expiresAt.toISOString(), createdAt.toISOString());
  })();
  return token;
}

export function consumeNylasOAuthState(token: string) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const timestamp = new Date().toISOString();
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM assistant_nylas_oauth_states
      WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?`).get(hash, timestamp) as any;
    if (!row) throw new AssistantError('This Nylas connection request is invalid or expired.', 400, 'NYLAS_OAUTH_STATE_INVALID');
    const changed = db.prepare(`UPDATE assistant_nylas_oauth_states SET consumed_at=?
      WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?`).run(timestamp, hash, timestamp).changes;
    if (!changed) throw new AssistantError('This Nylas connection request was already used.', 409, 'NYLAS_OAUTH_STATE_REPLAY');
    return { spaceId: String(row.space_id), userId: String(row.user_id), provider: String(row.provider) as NylasProvider };
  })();
}

export function saveNylasConnection(input: {
  spaceId: string; userId: string; provider: NylasProvider; grantId: string; email: string; scopes: string[];
}) {
  const timestamp = new Date().toISOString(); const fingerprint = fingerprintNylasGrant(input.grantId);
  const id = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM assistant_nylas_connections
      WHERE space_id=? AND user_id=? AND grant_fingerprint=?`).get(input.spaceId, input.userId, fingerprint) as { id: string } | undefined;
    const id = existing?.id || crypto.randomUUID();
    const encrypted = encryptNylasSecret(input.grantId, connectionContext(id, input.spaceId, input.userId));
    if (existing) {
      db.prepare(`UPDATE assistant_nylas_connections SET provider=?,grant_id_enc=?,email=?,scopes_json=?,status='connected',
        revoked_at=NULL,updated_at=? WHERE id=?`).run(
        input.provider, encrypted, cleanText(input.email, 254), JSON.stringify(input.scopes.slice(0, 30)), timestamp, id
      );
    } else {
      db.prepare(`INSERT INTO assistant_nylas_connections
        (id,space_id,user_id,provider,grant_id_enc,grant_fingerprint,email,scopes_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'connected',?,?)`).run(
        id, input.spaceId, input.userId, input.provider, encrypted, fingerprint, cleanText(input.email, 254),
        JSON.stringify(input.scopes.slice(0, 30)), timestamp, timestamp
      );
    }
    return id;
  })();
  publishAssistantChanged(input.spaceId);
  return publicConnection(db.prepare('SELECT * FROM assistant_nylas_connections WHERE id=?').get(id));
}

export function listNylasConnections(userId: string, spaceId: string) {
  return (db.prepare(`SELECT * FROM assistant_nylas_connections WHERE space_id=? AND user_id=?
    ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END,updated_at DESC,id`).all(spaceId, userId) as any[])
    .map(publicConnection);
}

export function ownedNylasConnection(userId: string, spaceId: string, id: string) {
  const row = db.prepare(`SELECT * FROM assistant_nylas_connections
    WHERE id=? AND space_id=? AND user_id=? AND status='connected'`).get(id, spaceId, userId) as any;
  if (!row) throw new AssistantError('Nylas connection not found.', 404, 'NYLAS_CONNECTION_NOT_FOUND');
  return {
    ...publicConnection(row),
    grantId: decryptNylasSecret(String(row.grant_id_enc), connectionContext(row.id, row.space_id, row.user_id))
  };
}

export function markNylasConnectionRevoked(userId: string, spaceId: string, id: string) {
  const timestamp = new Date().toISOString();
  const changed = db.prepare(`UPDATE assistant_nylas_connections SET status='revoked',revoked_at=?,updated_at=?
    WHERE id=? AND space_id=? AND user_id=? AND status='connected'`).run(timestamp, timestamp, id, spaceId, userId).changes;
  if (!changed) throw new AssistantError('Nylas connection not found.', 404, 'NYLAS_CONNECTION_NOT_FOUND');
  publishAssistantChanged(spaceId);
}

function jobKind(kind: AssistantRunKind): AiJobKind {
  if (kind === 'email_summary') return 'assistant.email_summary';
  if (kind === 'email_draft') return 'assistant.email_draft';
  if (kind === 'knowledge_answer') return 'assistant.knowledge_answer';
  return 'assistant.work_product';
}

function publicRunKind(kind: AssistantRunKind): AiJobKind { return jobKind(kind); }

function logicalFingerprint(value: Record<string, unknown>) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assistantEmailRequestFingerprint(input: {
  kind: 'email_summary' | 'email_draft'; connectionId: string; threadId: string;
  instructions?: string; tone?: string;
}) {
  return logicalFingerprint({
    kind: input.kind, connectionId: input.connectionId, threadId: cleanText(input.threadId, 300),
    ...(input.kind === 'email_draft' ? {
      instructions: cleanText(input.instructions, 2_000), tone: cleanText(input.tone || 'professional', 80)
    } : {})
  });
}

export function assistantKnowledgeRequestFingerprint(
  question: string,
  sourceRefs: string[],
  knowledgeBaseIds: string[] = []
) {
  return logicalFingerprint({
    kind: 'knowledge_answer', question: cleanText(question, 4_000),
    sourceRefs: [...new Set(sourceRefs)].sort((left, right) => left.localeCompare(right)),
    knowledgeBaseIds: [...new Set(knowledgeBaseIds)].sort((left, right) => left.localeCompare(right))
  });
}

export function assistantWorkProductRequestFingerprint(input: {
  documentType: AssistantDocumentType;
  title: string;
  objective: string;
  sourceRefs: string[];
  knowledgeBaseIds: string[];
  connectionId?: string;
  threadConnectionId?: string;
  calendarConnectionId?: string;
  threadId?: string;
  calendarEventId?: string;
  calendarId?: string;
}) {
  return logicalFingerprint({
    kind: 'work_product',
    documentType: input.documentType,
    title: cleanText(input.title, 500),
    objective: cleanText(input.objective, 6_000),
    sourceRefs: [...new Set(input.sourceRefs)].sort((left, right) => left.localeCompare(right)),
    knowledgeBaseIds: [...new Set(input.knowledgeBaseIds)].sort((left, right) => left.localeCompare(right)),
    connectionId: cleanText(input.connectionId, 300),
    threadConnectionId: cleanText(input.threadConnectionId, 300),
    calendarConnectionId: cleanText(input.calendarConnectionId, 300),
    threadId: cleanText(input.threadId, 300),
    calendarEventId: cleanText(input.calendarEventId, 300),
    calendarId: cleanText(input.calendarId, 300)
  });
}

function assistantRunRow(id: string, spaceId?: string, userId?: string) {
  const filters = ['r.id=?']; const values: unknown[] = [id];
  if (spaceId) { filters.push('r.space_id=?'); values.push(spaceId); }
  if (userId) { filters.push('r.requested_by=?'); values.push(userId); }
  return db.prepare(`SELECT r.*,j.state job_state,j.stage job_stage,j.progress job_progress,j.error job_error,
      j.attempt job_attempt,j.retry_at job_retry_at,
      o.sent_at delivery_sent_at,o.provider_message_id delivery_message_id,o.recipients_json delivery_recipients_json,
      o.mode delivery_mode
    FROM assistant_runs r
    LEFT JOIN ai_jobs j ON j.id=r.ai_job_id
    LEFT JOIN assistant_outbound_messages o ON o.run_id=r.id AND o.status='sent'
    WHERE ${filters.join(' AND ')}`).get(...values) as any;
}

function runResponse(row: any) {
  const state = String(row.job_state || row.state);
  const output = parseJson<any>(row.output_json, null);
  const draftCapable = row.kind === 'email_draft' || row.kind === 'work_product';
  const hasDraft = draftCapable && row.draft_revision > 0;
  return {
    id: String(row.id), jobId: row.ai_job_id ? String(row.ai_job_id) : null,
    kind: publicRunKind(String(row.kind) as AssistantRunKind), state, stage: row.job_stage || state,
    progress: Number(row.job_progress ?? (state === 'completed' || state === 'failed' ? 100 : 0)),
    attempt: Number(row.job_attempt || 0), connectionId: row.connection_id ? String(row.connection_id) : null,
    subjectRef: row.subject_ref ? String(row.subject_ref) : null,
    sourceRefs: parseJson<string[]>(row.source_refs_json, []),
    knowledgeBaseIds: parseJson<string[]>(row.knowledge_base_ids_json, []),
    documentType: row.document_type ? String(row.document_type) : null,
    title: row.title ? String(row.title) : null,
    output, runtime: parseJson(row.runtime_json, null),
    generatedDraft: draftCapable && row.generated_subject && row.generated_body ? {
      subject: String(row.generated_subject), body: String(row.generated_body)
    } : null,
    draft: hasDraft ? {
      subject: String(row.draft_subject || ''), body: String(row.draft_body || ''),
      revision: Number(row.draft_revision), updatedAt: row.draft_updated_at
    } : null,
    advisoryOnly: Number(row.advisory_only ?? 1) === 1,
    externalDispatched: Number(row.external_dispatched || 0) === 1 || Boolean(row.delivery_sent_at) || Boolean(output?.composeDelivery),
    delivery: row.delivery_sent_at ? {
      sentAt: String(row.delivery_sent_at),
      messageId: row.delivery_message_id ? String(row.delivery_message_id) : null,
      recipients: parseJson<string[]>(row.delivery_recipients_json, []),
      mode: row.delivery_mode === 'reply_all' ? 'reply_all' : 'reply'
    } : output?.composeDelivery ? { ...output.composeDelivery, mode: 'compose' } : null,
    error: row.job_error || row.error || null, retryAt: row.job_retry_at || null,
    createdAt: String(row.created_at), startedAt: row.started_at || null,
    completedAt: row.completed_at || null, updatedAt: String(row.updated_at)
  };
}

export function assistantComposeRequestFingerprint(input: {
  connectionId: string; to: NylasReplyRecipient[]; cc?: NylasReplyRecipient[]; bcc?: NylasReplyRecipient[];
  subject: string; body: string;
}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    connectionId: input.connectionId,
    to: input.to, cc: input.cc || [], bcc: input.bcc || [],
    subject: input.subject, body: input.body
  })).digest('hex');
}

export function createAssistantComposeRun(input: {
  user: SessionUser; spaceId: string; connectionId: string; to: NylasReplyRecipient[];
  cc?: NylasReplyRecipient[]; bcc?: NylasReplyRecipient[]; subject: string; body: string;
  idempotencyKey: string; requestFingerprint: string;
}) {
  const subject = providerHtmlToText(input.subject, 500);
  const body = normalizeEmailDraftHtml(input.body);
  const bodyText = emailDraftPlainText(body);
  if (!subject || !bodyText || bodyText.length > 12_000 || body.length > 48_000) {
    throw new AssistantError('Email subject and body are required and must stay within the editor limit.', 400, 'ASSISTANT_COMPOSE_INVALID');
  }
  return db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM assistant_runs
      WHERE space_id=? AND requested_by=? AND idempotency_key=?`).get(input.spaceId, input.user.id, input.idempotencyKey) as any;
    if (existing) {
      if (existing.kind !== 'email_draft' || existing.request_fingerprint !== input.requestFingerprint || existing.subject_ref) {
        throw new AssistantError('This idempotency key was already used for another assistant request.', 409, 'ASSISTANT_IDEMPOTENCY_CONFLICT');
      }
      return { run: runResponse(assistantRunRow(existing.id)), created: false };
    }
    const id = crypto.randomUUID(); const timestamp = new Date().toISOString();
    const snapshotJson = JSON.stringify({ kind: 'compose', to: input.to, cc: input.cc || [], bcc: input.bcc || [] });
    const snapshotHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    const encryptedSnapshot = encryptNylasSecret(snapshotJson, snapshotContext(id, input.spaceId, input.user.id));
    db.prepare(`INSERT INTO assistant_runs
      (id,space_id,requested_by,kind,connection_id,subject_ref,source_refs_json,knowledge_base_ids_json,
       input_snapshot_json,input_sha256,request_fingerprint,state,output_json,generated_subject,generated_body,
       draft_subject,draft_body,draft_revision,draft_updated_at,advisory_only,external_dispatched,idempotency_key,
       created_at,completed_at,updated_at)
      VALUES (?,?,?,?,?,NULL,'[]','[]',?,?,?,'completed',?,?,?,?,?,1,?,1,0,?,?,?,?)`).run(
      id, input.spaceId, input.user.id, 'email_draft', input.connectionId,
      encryptedSnapshot, snapshotHash, input.requestFingerprint, JSON.stringify({ compose: true, subject, body }),
      subject, body, subject, body, timestamp, input.idempotencyKey, timestamp, timestamp, timestamp
    );
    return { run: runResponse(assistantRunRow(id)), created: true };
  })();
}

export function completeAssistantComposeDelivery(id: string, spaceId: string, userId: string, delivery: {
  sentAt: string; messageId: string; recipients: string[];
}) {
  const current = assistantRunRow(id, spaceId, userId);
  if (!current || current.subject_ref) throw new AssistantError('Composed email not found.', 404, 'ASSISTANT_COMPOSE_NOT_FOUND');
  const output = { ...parseJson(current.output_json, {}), composeDelivery: { ...delivery, mode: 'compose' } };
  db.prepare(`UPDATE assistant_runs SET output_json=?,error=NULL,updated_at=?
    WHERE id=? AND space_id=? AND requested_by=?`).run(JSON.stringify(output), delivery.sentAt, id, spaceId, userId);
  publishAssistantChanged(spaceId);
  return runResponse(assistantRunRow(id, spaceId, userId));
}

export function failAssistantComposeDelivery(id: string, spaceId: string, userId: string, code: string) {
  db.prepare(`UPDATE assistant_runs SET error=?,updated_at=? WHERE id=? AND space_id=? AND requested_by=? AND external_dispatched=0`)
    .run(cleanText(code, 300), new Date().toISOString(), id, spaceId, userId);
}

export function getAssistantRun(id: string, spaceId: string, userId: string) {
  const row = assistantRunRow(id, spaceId, userId);
  return row ? runResponse(row) : null;
}

export function listAssistantRuns(spaceId: string, userId: string, limit = 100) {
  return (db.prepare(`SELECT r.*,j.state job_state,j.stage job_stage,j.progress job_progress,j.error job_error,
      j.attempt job_attempt,j.retry_at job_retry_at,
      o.sent_at delivery_sent_at,o.provider_message_id delivery_message_id,o.recipients_json delivery_recipients_json,
      o.mode delivery_mode
    FROM assistant_runs r
    LEFT JOIN ai_jobs j ON j.id=r.ai_job_id
    LEFT JOIN assistant_outbound_messages o ON o.run_id=r.id AND o.status='sent'
    WHERE r.space_id=? AND r.requested_by=? ORDER BY r.created_at DESC,r.id DESC LIMIT ?`)
    .all(spaceId, userId, Math.max(1, Math.min(500, limit))) as any[]).map(runResponse);
}

function createRun(input: {
  kind: AssistantRunKind; spaceId: string; userId: string; snapshot: Record<string, unknown>;
  connectionId?: string | null; subjectRef?: string | null; sourceRefs?: string[]; idempotencyKey?: string;
  knowledgeBaseIds?: string[]; documentType?: AssistantDocumentType | null; title?: string | null;
  requestFingerprint: string;
}) {
  const snapshotJson = JSON.stringify(input.snapshot);
  if (Buffer.byteLength(snapshotJson, 'utf8') > 160 * 1024) {
    throw new AssistantError('The assistant source snapshot is too large.', 413, 'ASSISTANT_SNAPSHOT_TOO_LARGE');
  }
  const snapshotHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
  const timestamp = new Date().toISOString(); const id = crypto.randomUUID();
  const encryptedSnapshot = encryptNylasSecret(snapshotJson, snapshotContext(id, input.spaceId, input.userId));
  return db.transaction(() => {
    if (input.idempotencyKey) {
      const existing = db.prepare(`SELECT * FROM assistant_runs
        WHERE space_id=? AND requested_by=? AND idempotency_key=?`).get(input.spaceId, input.userId, input.idempotencyKey) as any;
      if (existing) {
        if (existing.kind !== input.kind || existing.request_fingerprint !== input.requestFingerprint) {
          throw new AssistantError('This idempotency key was already used for another assistant request.', 409, 'ASSISTANT_IDEMPOTENCY_CONFLICT');
        }
        const job = existing.ai_job_id ? getJob(existing.ai_job_id) : null;
        if (!job) throw new AssistantError('The original assistant job is no longer available.', 409, 'ASSISTANT_JOB_MISSING');
        return { run: runResponse(assistantRunRow(existing.id)), job, created: false };
      }
    }
    assertCanQueueAiAction(input.spaceId);
    db.prepare(`INSERT INTO assistant_runs
      (id,space_id,requested_by,kind,connection_id,subject_ref,source_refs_json,knowledge_base_ids_json,document_type,title,
       input_snapshot_json,input_sha256,request_fingerprint,state,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(
      id, input.spaceId, input.userId, input.kind, input.connectionId || null, input.subjectRef || null,
      JSON.stringify(input.sourceRefs || []), JSON.stringify(input.knowledgeBaseIds || []), input.documentType || null,
      cleanText(input.title, 500) || null, encryptedSnapshot, snapshotHash, input.requestFingerprint,
      input.idempotencyKey || null, timestamp, timestamp
    );
    const job = createJob(jobKind(input.kind), { assistantRunId: id }, input.spaceId, null, null, input.userId);
    db.prepare('UPDATE assistant_runs SET ai_job_id=? WHERE id=?').run(job.id, id);
    recordAssistantAudit({
      spaceId: input.spaceId,
      actorUserId: input.userId,
      action: 'assistant.run.queued',
      targetType: 'run',
      targetId: id,
      detail: {
        kind: input.kind,
        documentType: input.documentType || null,
        sourceCount: input.sourceRefs?.length || 0,
        knowledgeBaseCount: input.knowledgeBaseIds?.length || 0,
        inputSha256: snapshotHash
      }
    });
    return { run: runResponse(assistantRunRow(id)), job, created: true };
  })();
}

export function replayAssistantIdempotency(input: {
  spaceId: string; userId: string; kind: AssistantRunKind; idempotencyKey?: string; requestFingerprint: string;
}) {
  if (!input.idempotencyKey) return null;
  const existing = db.prepare(`SELECT * FROM assistant_runs
    WHERE space_id=? AND requested_by=? AND idempotency_key=?`).get(input.spaceId, input.userId, input.idempotencyKey) as any;
  if (!existing) return null;
  if (existing.kind !== input.kind || existing.request_fingerprint !== input.requestFingerprint) {
    throw new AssistantError('This idempotency key was already used for another assistant request.', 409, 'ASSISTANT_IDEMPOTENCY_CONFLICT');
  }
  const job = existing.ai_job_id ? getJob(existing.ai_job_id) : null;
  if (!job) throw new AssistantError('The original assistant job is no longer available.', 409, 'ASSISTANT_JOB_MISSING');
  return { run: runResponse(assistantRunRow(existing.id)), job, created: false };
}

const assistantEmailSnapshotLimitBytes = 144 * 1024;

function truncateUtf8(value: string, maximumBytes: number) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maximumBytes) return { value, truncated: false };
  return {
    value: encoded.subarray(0, Math.max(0, maximumBytes)).toString('utf8').replace(/\uFFFD+$/gu, ''),
    truncated: true
  };
}

export function assistantEmailExecutionSnapshot(
  snapshot: AssistantThreadSnapshot,
  preferences?: { instructions?: string; tone?: string }
) {
  const compactMessage = (message: AssistantThreadSnapshot['messages'][number], bodyByteLimit: number, minimal: boolean) => {
    const boundedBody = truncateUtf8(message.body, bodyByteLimit);
    const participant = (value: Array<{ name?: string; email?: string }>) =>
      value.slice(0, 1).map((item) => cleanText(item.email || item.name || '', minimal ? 80 : 160)).filter(Boolean);
    return {
      id: cleanText(message.id, 300),
      subject: cleanText(message.subject, minimal ? 100 : 240),
      from: participant(message.from),
      to: participant(message.to),
      cc: minimal ? [] : participant(message.cc),
      sentAt: message.sentAt,
      body: boundedBody.value,
      bodyTruncated: Boolean(message.bodyTruncated || boundedBody.truncated),
      attachments: minimal ? [] : message.attachments.slice(0, 2).map((attachment) => ({
        filename: cleanText(attachment.filename, 120),
        contentType: cleanText(attachment.contentType, 80),
        size: attachment.size
      }))
    };
  };
  const build = (bodyByteLimit: number, minimal: boolean) => {
    const messages = snapshot.messages.map((message) => compactMessage(message, bodyByteLimit, minimal));
    return {
      thread: snapshot.thread,
      coverage: {
        providerLoadedMessageCount: snapshot.loadedMessageCount,
        providerTotalMessageCount: snapshot.totalMessageCount,
        providerMessagesTruncated: snapshot.messagesTruncated,
        providerBytesTruncated: snapshot.bytesTruncated,
        aiSourceMessageCount: snapshot.messages.length,
        aiIncludedMessageCount: messages.length,
        aiBodiesTruncated: messages.filter((message) => message.bodyTruncated).length,
        aiBodyByteLimit: bodyByteLimit,
        aiSnapshotByteLimit: assistantEmailSnapshotLimitBytes,
        aiMetadataReduced: minimal
      },
      messages,
      ...(preferences ? {
        instructions: cleanText(preferences.instructions, 2_000),
        tone: cleanText(preferences.tone || 'professional', 80)
      } : {})
    };
  };
  const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  let minimal = false;
  if (byteLength(build(0, false)) > assistantEmailSnapshotLimitBytes) minimal = true;
  if (byteLength(build(0, minimal)) > assistantEmailSnapshotLimitBytes) {
    throw new AssistantError('The assistant email metadata is too large to process safely.', 413, 'ASSISTANT_SNAPSHOT_TOO_LARGE');
  }
  let low = 0;
  let high = snapshot.messages.reduce(
    (maximum, message) => Math.max(maximum, Buffer.byteLength(message.body, 'utf8')),
    0
  );
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (byteLength(build(candidate, minimal)) <= assistantEmailSnapshotLimitBytes) low = candidate;
    else high = candidate - 1;
  }
  return build(low, minimal);
}

export function createAssistantEmailRun(input: {
  kind: 'email_summary' | 'email_draft'; user: SessionUser; spaceId: string; connectionId: string;
  snapshot: AssistantThreadSnapshot; instructions?: string; tone?: string; idempotencyKey?: string;
}) {
  return createRun({
    kind: input.kind, spaceId: input.spaceId, userId: input.user.id, connectionId: input.connectionId,
    subjectRef: input.snapshot.thread.id, idempotencyKey: input.idempotencyKey,
    requestFingerprint: assistantEmailRequestFingerprint({
      kind: input.kind, connectionId: input.connectionId, threadId: input.snapshot.thread.id,
      instructions: input.instructions, tone: input.tone
    }),
    snapshot: assistantEmailExecutionSnapshot(
      input.snapshot,
      input.kind === 'email_draft' || input.instructions
        ? { instructions: input.instructions, tone: input.tone }
        : undefined
    )
  });
}

export function assistantComposeDraftRequestFingerprint(input: {
  connectionId: string; to: NylasReplyRecipient[]; cc?: NylasReplyRecipient[]; bcc?: NylasReplyRecipient[];
  subject?: string; instructions: string; tone?: string;
}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    kind: 'compose_draft', connectionId: input.connectionId,
    to: input.to, cc: input.cc || [], bcc: input.bcc || [],
    subject: cleanText(input.subject, 500), instructions: cleanText(input.instructions, 2_000),
    tone: cleanText(input.tone || 'professional', 80)
  })).digest('hex');
}

export function createAssistantComposeDraftRun(input: {
  user: SessionUser; spaceId: string; connectionId: string; to: NylasReplyRecipient[];
  cc?: NylasReplyRecipient[]; bcc?: NylasReplyRecipient[]; subject?: string;
  instructions: string; tone?: string; idempotencyKey?: string;
}) {
  const requestFingerprint = assistantComposeDraftRequestFingerprint(input);
  return createRun({
    kind: 'email_draft', spaceId: input.spaceId, userId: input.user.id,
    connectionId: input.connectionId, subjectRef: null, idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    snapshot: {
      compose: true, to: input.to, cc: input.cc || [], bcc: input.bcc || [],
      subject: cleanText(input.subject, 500), instructions: cleanText(input.instructions, 2_000),
      tone: cleanText(input.tone || 'professional', 80)
    }
  });
}

export type AssistantEvidenceSnapshot = {
  sourceRef: string;
  type: 'survey' | 'social' | 'knowledge' | 'email' | 'calendar';
  title: string;
  createdAt: string;
  content: string;
};

type IntelligenceSourceSnapshot = {
  sourceRef: string; type: 'survey' | 'social'; title: string; createdAt: string; content: string;
};

export function assistantIntelligenceSnapshot(spaceId: string, sourceRefs: string[]): IntelligenceSourceSnapshot[] {
  const requested = [...new Set(sourceRefs)];
  if (!requested.length || requested.length > 12) {
    throw new AssistantError('Select between one and twelve saved intelligence sources.', 400, 'ASSISTANT_SOURCES_REQUIRED');
  }
  let selected;
  try { selected = resolveIntelligenceSourceSnapshots(spaceId, requested); }
  catch (error) {
    if (error instanceof IntelligenceError) throw new AssistantError(error.message, error.status, 'ASSISTANT_SOURCE_NOT_FOUND');
    throw error;
  }
  return selected.map((source) => {
    const content = redactProviderSecrets(JSON.stringify(source.payload ?? {})).replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 28 * 1024);
    return {
      sourceRef: source.ref,
      type: source.type,
      title: cleanText(source.title, 180),
      createdAt: source.createdAt,
      content
    };
  }).filter((source) => source.content.trim());
}

export function createAssistantKnowledgeRun(input: {
  user: SessionUser;
  spaceId: string;
  question: string;
  sources: AssistantEvidenceSnapshot[];
  sourceRefs: string[];
  knowledgeBaseIds: string[];
  idempotencyKey?: string;
  requestFingerprint: string;
}) {
  if (!input.sources.length) {
    throw new AssistantError('The selected intelligence and knowledge sources contain no usable evidence.',
      409, 'ASSISTANT_SOURCE_EMPTY');
  }
  return createRun({
    kind: 'knowledge_answer', spaceId: input.spaceId, userId: input.user.id,
    sourceRefs: [...new Set(input.sourceRefs)],
    knowledgeBaseIds: [...new Set(input.knowledgeBaseIds)],
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    snapshot: { question: cleanText(input.question, 4_000), sources: input.sources }
  });
}

export function createAssistantWorkProductRun(input: {
  user: SessionUser;
  spaceId: string;
  documentType: AssistantDocumentType;
  title: string;
  objective: string;
  sources: AssistantEvidenceSnapshot[];
  sourceRefs: string[];
  knowledgeBaseIds: string[];
  connectionId?: string | null;
  subjectRef?: string | null;
  idempotencyKey?: string;
  requestFingerprint: string;
}) {
  if (input.documentType !== 'scheduling_proposal' && !input.sources.length) {
    throw new AssistantError('Select at least one authorized source for this work product.', 400, 'ASSISTANT_SOURCES_REQUIRED');
  }
  return createRun({
    kind: 'work_product',
    spaceId: input.spaceId,
    userId: input.user.id,
    connectionId: input.connectionId,
    subjectRef: input.subjectRef,
    sourceRefs: [...new Set(input.sourceRefs)],
    knowledgeBaseIds: [...new Set(input.knowledgeBaseIds)],
    documentType: input.documentType,
    title: input.title,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    snapshot: {
      documentType: input.documentType,
      title: cleanText(input.title, 500),
      objective: cleanText(input.objective, 6_000),
      sources: input.sources
    }
  });
}

export function assistantRunExecutionInput(id: string, spaceId: string) {
  const row = assistantRunRow(id, spaceId);
  if (!row) throw new AssistantError('Assistant run not found.', 404, 'ASSISTANT_RUN_NOT_FOUND');
  if (row.state === 'completed' && row.output_json) {
    return { replay: { output: parseJson(row.output_json, null), runtime: parseJson(row.runtime_json, null) }, run: runResponse(row), snapshot: {} };
  }
  let snapshot: Record<string, unknown>;
  try {
    snapshot = parseJson<Record<string, unknown>>(
      decryptNylasSecret(String(row.input_snapshot_json), snapshotContext(String(row.id), String(row.space_id), String(row.requested_by))), {}
    );
  } catch {
    throw new AssistantError('The saved assistant snapshot could not be decrypted.', 409, 'ASSISTANT_SNAPSHOT_DECRYPT_FAILED');
  }
  const timestamp = new Date().toISOString();
  db.prepare(`UPDATE assistant_runs SET state='processing',started_at=COALESCE(started_at,?),updated_at=?
    WHERE id=? AND state IN ('queued','processing')`).run(timestamp, timestamp, id);
  return { replay: null, run: runResponse(assistantRunRow(id, spaceId)), snapshot };
}

export function completeAssistantRun(id: string, spaceId: string, output: unknown, runtime: unknown) {
  const existing = assistantRunRow(id, spaceId);
  if (!existing) throw new AssistantError('Assistant run not found.', 404, 'ASSISTANT_RUN_NOT_FOUND');
  if (existing.state === 'completed' && existing.output_json) {
    return { output: parseJson(existing.output_json, null), runtime: parseJson(existing.runtime_json, null) };
  }
  const timestamp = new Date().toISOString();
  const draftCapable = existing.kind === 'email_draft' || existing.kind === 'work_product';
  const draft = draftCapable ? output as any : null;
  const generatedTitle = existing.kind === 'work_product' ? draft?.title : draft?.subject;
  const generatedBody = existing.kind === 'work_product' ? draft?.body : draft?.body;
  const changed = db.prepare(`UPDATE assistant_runs SET state='completed',output_json=?,runtime_json=?,
      generated_subject=CASE WHEN kind IN ('email_draft','work_product') THEN ? ELSE generated_subject END,
      generated_body=CASE WHEN kind IN ('email_draft','work_product') THEN ? ELSE generated_body END,
      draft_subject=CASE WHEN kind IN ('email_draft','work_product') THEN ? ELSE draft_subject END,
      draft_body=CASE WHEN kind IN ('email_draft','work_product') THEN ? ELSE draft_body END,
      draft_revision=CASE WHEN kind IN ('email_draft','work_product') THEN 1 ELSE draft_revision END,
      draft_updated_at=CASE WHEN kind IN ('email_draft','work_product') THEN ? ELSE draft_updated_at END,
      error=NULL,completed_at=?,updated_at=?
    WHERE id=? AND space_id=? AND state IN ('queued','processing')`).run(
    JSON.stringify(output), JSON.stringify(runtime), generatedTitle || null, generatedBody || null,
    generatedTitle || null, generatedBody || null,
    timestamp, timestamp, timestamp, id, spaceId
  ).changes;
  if (!changed) throw new AssistantError('Assistant run changed while the result was being saved.', 409, 'ASSISTANT_RUN_CHANGED');
  recordAssistantAudit({
    spaceId,
    actorUserId: String(existing.requested_by),
    action: 'assistant.run.completed',
    targetType: 'run',
    targetId: id,
    detail: {
      kind: existing.kind,
      documentType: existing.document_type || null,
      outputSha256: crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex'),
      model: runtime && typeof runtime === 'object' ? (runtime as any).model || null : null
    }
  });
  publishAssistantChanged(spaceId);
  return { output, runtime };
}

export function markAssistantRunRetrying(id: string, spaceId: string, message: string) {
  db.prepare(`UPDATE assistant_runs SET state='queued',error=?,updated_at=?
    WHERE id=? AND space_id=? AND state<>'completed'`).run(cleanText(message, 1_000), new Date().toISOString(), id, spaceId);
}

export function failAssistantRun(id: string, spaceId: string, message: string) {
  const existing = assistantRunRow(id, spaceId);
  const timestamp = new Date().toISOString();
  db.prepare(`UPDATE assistant_runs SET state='failed',error=?,completed_at=?,updated_at=?
    WHERE id=? AND space_id=? AND state<>'completed'`).run(cleanText(message, 1_000), timestamp, timestamp, id, spaceId);
  if (existing) recordAssistantAudit({
    spaceId,
    actorUserId: String(existing.requested_by),
    action: 'assistant.run.failed',
    targetType: 'run',
    targetId: id,
    detail: { kind: existing.kind, errorCode: crypto.createHash('sha256').update(cleanText(message, 1_000)).digest('hex') }
  });
  publishAssistantChanged(spaceId);
}

export function updateAssistantDraft(id: string, spaceId: string, userId: string, input: { subject: string; body: string; revision: number }) {
  const current = assistantRunRow(id, spaceId, userId);
  if (!current) throw new AssistantError('Assistant run not found.', 404, 'ASSISTANT_RUN_NOT_FOUND');
  if (!['email_draft', 'work_product'].includes(String(current.kind))
    || String(current.job_state || current.state) !== 'completed' || Number(current.draft_revision) < 1) {
    throw new AssistantError('This assistant run does not have an editable draft.', 409, 'ASSISTANT_DRAFT_NOT_READY');
  }
  const subject = providerHtmlToText(input.subject, 500);
  const emailBodyInput = String(input.body || '');
  const boundedEmailBody = /<[a-z][\s\S]*>/iu.test(emailBodyInput) ? emailBodyInput : emailBodyInput.slice(0, 12_000);
  const body = current.kind === 'email_draft'
    ? normalizeEmailDraftHtml(boundedEmailBody)
    : providerHtmlToText(input.body, 24_000);
  const bodyText = current.kind === 'email_draft' ? emailDraftPlainText(body) : body;
  if (!subject || !bodyText || bodyText.length > (current.kind === 'work_product' ? 24_000 : 12_000) || body.length > 48_000) {
    throw new AssistantError('Draft subject and body are required and must stay within the editor limit.', 400, 'ASSISTANT_DRAFT_INVALID');
  }
  const timestamp = new Date().toISOString();
  const changed = db.prepare(`UPDATE assistant_runs SET draft_subject=?,draft_body=?,draft_revision=draft_revision+1,
      draft_updated_at=?,updated_at=? WHERE id=? AND space_id=? AND requested_by=? AND draft_revision=?`)
    .run(subject, body, timestamp, timestamp, id, spaceId, userId, input.revision).changes;
  if (!changed) throw new AssistantError('This draft changed in another session. Refresh and try again.', 409, 'ASSISTANT_DRAFT_REVISION_CONFLICT');
  recordAssistantAudit({
    spaceId,
    actorUserId: userId,
    action: 'assistant.draft.edited',
    targetType: 'run',
    targetId: id,
    detail: {
      revision: input.revision + 1,
      previousSha256: crypto.createHash('sha256').update(`${current.draft_subject || ''}\n${current.draft_body || ''}`).digest('hex'),
      updatedSha256: crypto.createHash('sha256').update(`${subject}\n${body}`).digest('hex')
    }
  });
  publishAssistantChanged(spaceId);
  return runResponse(assistantRunRow(id, spaceId, userId));
}

export function assistantRunId(job: AiJob) {
  return typeof job.input.assistantRunId === 'string' ? job.input.assistantRunId : '';
}
