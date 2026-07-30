import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './database.js';
import './spaces.js';

export type KnowledgeBaseStatus = 'empty' | 'indexing' | 'ready' | 'degraded' | 'deleting' | 'deleted';
export type KnowledgeDocumentState = 'queued' | 'extracting' | 'indexing' | 'ready' | 'failed' | 'deleting' | 'deleted';
export type KnowledgeJobKind = 'document.index' | 'document.reindex' | 'document.delete' | 'base.delete';
export type KnowledgeJobState = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface KnowledgeBaseRecord {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  privacy: 'space' | 'private';
  status: KnowledgeBaseStatus;
  allowTerraContext: boolean;
  embeddingModel: string;
  embeddingDimension: number;
  chunkerVersion: string;
  currentVersion: number;
  documentCount: number;
  readyDocumentCount: number;
  chunkCount: number;
  entityCount: number;
  relationshipCount: number;
  storageBytes: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastIndexedAt: string | null;
  deletedAt: string | null;
}

export interface KnowledgeDocumentRecord {
  id: string;
  spaceId: string;
  knowledgeBaseId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  state: KnowledgeDocumentState;
  indexVersion: number;
  pageCount: number | null;
  chunkCount: number;
  entityCount: number;
  relationshipCount: number;
  language: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  indexedAt: string | null;
  deletedAt: string | null;
}

export interface KnowledgeJobRecord {
  id: string;
  spaceId: string;
  knowledgeBaseId: string;
  documentId: string | null;
  requestedBy: string | null;
  kind: KnowledgeJobKind;
  state: KnowledgeJobState;
  stage: string;
  progress: number;
  attempt: number;
  maxAttempts: number;
  targetVersion: number | null;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  retryAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface KnowledgeBaseRef {
  id: string;
  name: string;
  indexVersion: number;
  embeddingModel: string;
  embeddingDimension: number;
  chunkerVersion: string;
}

export interface KnowledgeCitation {
  sourceRef: string;
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  excerpt: string;
  page?: number | null;
  section?: string | null;
  score?: number | null;
  entityRefs?: string[];
}

export interface KnowledgeContextRecord {
  aiJobId: string;
  spaceId: string;
  query: string;
  knowledgeBases: KnowledgeBaseRef[];
  citations: KnowledgeCitation[];
  contextText: string;
  metrics: Record<string, unknown>;
  createdAt: string;
}

export class KnowledgeError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status = 400, code = 'KNOWLEDGE_ERROR', retryable = false) {
    super(message);
    this.name = 'KnowledgeError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
};

const applyKnowledgeSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(9);
  if (applied) return;
  db.exec(`
    CREATE TABLE knowledge_bases (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      privacy TEXT NOT NULL DEFAULT 'space',
      status TEXT NOT NULL DEFAULT 'empty',
      allow_terra_context INTEGER NOT NULL DEFAULT 0,
      embedding_model TEXT NOT NULL,
      embedding_dimension INTEGER NOT NULL,
      chunker_version TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_indexed_at TEXT,
      deleted_at TEXT,
      UNIQUE(id,space_id)
    );
    CREATE INDEX knowledge_bases_space_updated ON knowledge_bases(space_id,updated_at DESC);

    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      index_version INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      entity_count INTEGER NOT NULL DEFAULT 0,
      relationship_count INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT,
      deleted_at TEXT,
      FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE,
      UNIQUE(id,space_id),
      UNIQUE(knowledge_base_id,sha256,deleted_at)
    );
    CREATE INDEX knowledge_documents_base_created ON knowledge_documents(knowledge_base_id,created_at DESC);
    CREATE INDEX knowledge_documents_space_state ON knowledge_documents(space_id,state,updated_at DESC);

    CREATE TABLE knowledge_jobs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      document_id TEXT,
      requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      target_version INTEGER,
      idempotency_key TEXT,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      error TEXT,
      retry_at TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX knowledge_jobs_dispatch ON knowledge_jobs(state,retry_at,created_at);
    CREATE INDEX knowledge_jobs_space_history ON knowledge_jobs(space_id,created_at DESC);
    CREATE UNIQUE INDEX knowledge_jobs_idempotency ON knowledge_jobs(space_id,idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX knowledge_jobs_one_active_document ON knowledge_jobs(document_id)
      WHERE document_id IS NOT NULL AND state IN ('queued','processing');

    CREATE TABLE survey_knowledge_bases (
      survey_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      knowledge_base_id TEXT NOT NULL,
      activity_scope_json TEXT NOT NULL DEFAULT '["response.analyze","insights.generate","analyst.chat","report.generate"]',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(survey_id,knowledge_base_id),
      FOREIGN KEY(survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
      FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX survey_knowledge_bases_space ON survey_knowledge_bases(space_id,survey_id);

    CREATE TABLE ai_job_knowledge_contexts (
      ai_job_id TEXT PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      query_text TEXT NOT NULL,
      knowledge_refs_json TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      context_text TEXT NOT NULL,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      context_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX ai_job_knowledge_contexts_space ON ai_job_knowledge_contexts(space_id,created_at DESC);

    CREATE TABLE knowledge_audit_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      knowledge_base_id TEXT REFERENCES knowledge_bases(id) ON DELETE SET NULL,
      document_id TEXT REFERENCES knowledge_documents(id) ON DELETE SET NULL,
      job_id TEXT REFERENCES knowledge_jobs(id) ON DELETE SET NULL,
      ai_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX knowledge_audit_space_created ON knowledge_audit_events(space_id,created_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(9, 'knowledge_graph_rag_control_plane', new Date().toISOString());
});
applyKnowledgeSchema();

const knowledgeBaseColumns = new Set((db.prepare('PRAGMA table_info(knowledge_bases)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeBaseColumns.has('privacy')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN privacy TEXT NOT NULL DEFAULT 'space'");
const knowledgeDocumentColumns = new Set((db.prepare('PRAGMA table_info(knowledge_documents)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeDocumentColumns.has('relationship_count')) db.exec('ALTER TABLE knowledge_documents ADD COLUMN relationship_count INTEGER NOT NULL DEFAULT 0');
const knowledgeAuditColumns = new Set((db.prepare('PRAGMA table_info(knowledge_audit_events)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeAuditColumns.has('ai_job_id')) db.exec('ALTER TABLE knowledge_audit_events ADD COLUMN ai_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL');

// SQLite considers NULL values distinct inside a regular UNIQUE constraint.
// This partial index enforces one live copy of a document per knowledge base.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_live_sha
  ON knowledge_documents(knowledge_base_id,sha256) WHERE deleted_at IS NULL`);
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_query_snapshots (
    request_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    query_text TEXT NOT NULL,
    knowledge_refs_json TEXT NOT NULL,
    citations_json TEXT NOT NULL,
    context_text TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS knowledge_query_snapshots_space_created
    ON knowledge_query_snapshots(space_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS knowledge_file_cleanup (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    document_id TEXT,
    stored_filename TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    retry_at TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS knowledge_file_cleanup_pending
    ON knowledge_file_cleanup(state,updated_at);
  CREATE TABLE IF NOT EXISTS survey_generation_applications (
    ai_job_id TEXT PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    collector_id TEXT NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    runtime_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(survey_id),
    UNIQUE(collector_id)
  );
  CREATE INDEX IF NOT EXISTS survey_generation_applications_space
    ON survey_generation_applications(space_id,created_at DESC);
`);
const knowledgeCleanupColumns = new Set((db.prepare('PRAGMA table_info(knowledge_file_cleanup)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeCleanupColumns.has('retry_at')) db.exec('ALTER TABLE knowledge_file_cleanup ADD COLUMN retry_at TEXT');
db.prepare(`UPDATE knowledge_file_cleanup SET state='pending',retry_at=NULL,updated_at=? WHERE state='processing'`)
  .run(new Date().toISOString());

export function recoverKnowledgeJobs() {
  const recoveredAt = new Date().toISOString();
  const recovered = db.prepare(`UPDATE knowledge_jobs SET state='queued',stage='recovered_after_restart',progress=0,
    started_at=NULL,retry_at=NULL,updated_at=? WHERE state='processing'`).run(recoveredAt).changes;
  db.prepare(`UPDATE knowledge_documents SET state=CASE
      WHEN index_version>0 AND EXISTS (SELECT 1 FROM knowledge_jobs j
        WHERE j.document_id=knowledge_documents.id AND j.state='queued' AND j.kind='document.reindex') THEN 'ready'
      ELSE 'queued' END,updated_at=?
    WHERE state IN ('extracting','indexing') AND EXISTS (
      SELECT 1 FROM knowledge_jobs j WHERE j.document_id=knowledge_documents.id AND j.state='queued'
    )`).run(recoveredAt);
  return recovered;
}
recoverKnowledgeJobs();

function rowBase(row: any): KnowledgeBaseRecord {
  return {
    id: row.id, spaceId: row.space_id, name: row.name, description: row.description, privacy: row.privacy === 'private' ? 'private' : 'space',
    status: row.status, allowTerraContext: Boolean(row.allow_terra_context), embeddingModel: row.embedding_model,
    embeddingDimension: Number(row.embedding_dimension), chunkerVersion: row.chunker_version,
    currentVersion: Number(row.current_version), documentCount: Number(row.document_count || 0),
    readyDocumentCount: Number(row.ready_document_count || 0), chunkCount: Number(row.chunk_count || 0),
    entityCount: Number(row.entity_count || 0), relationshipCount: Number(row.relationship_count || 0),
    storageBytes: Number(row.storage_bytes || 0), createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, lastIndexedAt: row.last_indexed_at, deletedAt: row.deleted_at
  };
}

const baseSelect = `SELECT b.*,
  COUNT(DISTINCT CASE WHEN d.deleted_at IS NULL THEN d.id END) document_count,
  COUNT(DISTINCT CASE WHEN d.state='ready' AND d.deleted_at IS NULL THEN d.id END) ready_document_count,
  COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.chunk_count ELSE 0 END),0) chunk_count,
  COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.entity_count ELSE 0 END),0) entity_count
  ,COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.relationship_count ELSE 0 END),0) relationship_count
  ,COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.size_bytes ELSE 0 END),0) storage_bytes
  FROM knowledge_bases b LEFT JOIN knowledge_documents d ON d.knowledge_base_id=b.id`;

export function listKnowledgeBases(spaceId: string, includeDeleted = false, viewerUserId?: string) {
  return (db.prepare(`${baseSelect} WHERE b.space_id=? ${includeDeleted ? '' : 'AND b.deleted_at IS NULL'}
    ${viewerUserId ? "AND (b.privacy='space' OR b.created_by=?)" : ''}
    GROUP BY b.id ORDER BY b.updated_at DESC,b.id`).all(...(viewerUserId ? [spaceId, viewerUserId] : [spaceId])) as any[]).map(rowBase);
}

export function getKnowledgeBase(id: string, spaceId: string, includeDeleted = false, viewerUserId?: string): KnowledgeBaseRecord | null {
  const row = db.prepare(`${baseSelect} WHERE b.id=? AND b.space_id=? ${includeDeleted ? '' : 'AND b.deleted_at IS NULL'}
    ${viewerUserId ? "AND (b.privacy='space' OR b.created_by=?)" : ''} GROUP BY b.id`)
    .get(...(viewerUserId ? [id, spaceId, viewerUserId] : [id, spaceId])) as any;
  return row ? rowBase(row) : null;
}

export function auditKnowledge(input: {
  spaceId: string; knowledgeBaseId?: string | null; documentId?: string | null; jobId?: string | null;
  aiJobId?: string | null;
  actorUserId?: string | null; action: string; detail?: Record<string, unknown>;
}) {
  db.prepare(`INSERT INTO knowledge_audit_events
    (id,space_id,knowledge_base_id,document_id,job_id,ai_job_id,actor_user_id,action,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.knowledgeBaseId || null,
      input.documentId || null, input.jobId || null, input.aiJobId || null, input.actorUserId || null, input.action,
      JSON.stringify(input.detail || {}), new Date().toISOString());
}

export function createKnowledgeBase(spaceId: string, userId: string, input: {
  name: string; description?: string; privacy?: 'space' | 'private'; allowTerraContext?: boolean;
}) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO knowledge_bases
    (id,space_id,name,description,privacy,status,allow_terra_context,embedding_model,embedding_dimension,chunker_version,current_version,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,'empty',?,?,?,?,0,?,?,?)`).run(id, spaceId, input.name.trim(), input.description?.trim() || '', input.privacy || 'space',
      input.allowTerraContext ? 1 : 0, config.knowledgeEmbeddingModel, config.knowledgeEmbeddingDimension,
      config.knowledgeChunkerVersion, userId, now, now);
  auditKnowledge({ spaceId, knowledgeBaseId: id, actorUserId: userId, action: 'knowledge_base.created',
    detail: { allowTerraContext: Boolean(input.allowTerraContext) } });
  return getKnowledgeBase(id, spaceId)!;
}

export function updateKnowledgeBase(id: string, spaceId: string, userId: string, input: {
  name?: string; description?: string; privacy?: 'space' | 'private'; allowTerraContext?: boolean;
}) {
  const current = getKnowledgeBase(id, spaceId, false, userId);
  if (!current) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  if (current.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const now = new Date().toISOString();
  db.prepare(`UPDATE knowledge_bases SET name=?,description=?,privacy=?,allow_terra_context=?,updated_at=?
    WHERE id=? AND space_id=? AND deleted_at IS NULL`).run(input.name?.trim() ?? current.name,
      input.description?.trim() ?? current.description,
      input.privacy ?? current.privacy,
      input.allowTerraContext === undefined ? (current.allowTerraContext ? 1 : 0) : (input.allowTerraContext ? 1 : 0),
      now, id, spaceId);
  auditKnowledge({ spaceId, knowledgeBaseId: id, actorUserId: userId, action: 'knowledge_base.updated',
    detail: { allowTerraContext: input.allowTerraContext } });
  return getKnowledgeBase(id, spaceId, false, userId)!;
}

function rowDocument(row: any): KnowledgeDocumentRecord {
  return {
    id: row.id, spaceId: row.space_id, knowledgeBaseId: row.knowledge_base_id,
    originalName: row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), sha256: row.sha256,
    state: row.state, indexVersion: Number(row.index_version), pageCount: row.page_count == null ? null : Number(row.page_count),
    chunkCount: Number(row.chunk_count), entityCount: Number(row.entity_count), relationshipCount: Number(row.relationship_count || 0), language: row.language,
    error: row.error, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    indexedAt: row.indexed_at, deletedAt: row.deleted_at
  };
}

export function listKnowledgeDocuments(knowledgeBaseId: string, spaceId: string, includeDeleted = false) {
  return (db.prepare(`SELECT * FROM knowledge_documents WHERE knowledge_base_id=? AND space_id=?
    ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY created_at DESC,id`).all(knowledgeBaseId, spaceId) as any[]).map(rowDocument);
}

export function getKnowledgeDocument(id: string, knowledgeBaseId: string, spaceId: string, includeDeleted = false): KnowledgeDocumentRecord | null {
  const row = db.prepare(`SELECT * FROM knowledge_documents WHERE id=? AND knowledge_base_id=? AND space_id=?
    ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id, knowledgeBaseId, spaceId) as any;
  return row ? rowDocument(row) : null;
}

function rowJob(row: any): KnowledgeJobRecord {
  return {
    id: row.id, spaceId: row.space_id, knowledgeBaseId: row.knowledge_base_id, documentId: row.document_id,
    requestedBy: row.requested_by, kind: row.kind, state: row.state, stage: row.stage,
    progress: Number(row.progress), attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts),
    targetVersion: row.target_version == null ? null : Number(row.target_version), input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, null), error: row.error, retryAt: row.retry_at, createdAt: row.created_at,
    startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}

function idempotentKnowledgeJob(input: {
  spaceId: string; knowledgeBaseId: string; documentId?: string | null; requestedBy?: string | null;
  kind: KnowledgeJobKind; idempotencyKey?: string | null; values?: Record<string, unknown>; acceptAnyDocument?: boolean;
}) {
  if (!input.idempotencyKey) return null;
  const row = db.prepare('SELECT * FROM knowledge_jobs WHERE space_id=? AND idempotency_key=?')
    .get(input.spaceId, input.idempotencyKey) as any;
  if (!row) return null;
  const sameDocument = input.acceptAnyDocument ? Boolean(row.document_id) : (row.document_id || null) === (input.documentId || null);
  const sameIntent = row.knowledge_base_id === input.knowledgeBaseId && sameDocument
    && (row.requested_by || null) === (input.requestedBy || null) && row.kind === input.kind
    && JSON.stringify(canonicalValue(parseJson(row.input_json, {}))) === JSON.stringify(canonicalValue(input.values || {}));
  if (!sameIntent) {
    throw new KnowledgeError('This idempotency key was already used for different knowledge work.', 409, 'KNOWLEDGE_IDEMPOTENCY_CONFLICT');
  }
  return rowJob(row);
}

export function getKnowledgeJob(id: string, spaceId?: string): KnowledgeJobRecord | null {
  const row = spaceId
    ? db.prepare('SELECT * FROM knowledge_jobs WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM knowledge_jobs WHERE id=?').get(id) as any;
  return row ? rowJob(row) : null;
}

export function listKnowledgeJobs(spaceId: string, knowledgeBaseId?: string, limit = 200) {
  const rows = knowledgeBaseId
    ? db.prepare(`SELECT * FROM knowledge_jobs WHERE space_id=? AND knowledge_base_id=? ORDER BY created_at DESC LIMIT ?`).all(spaceId, knowledgeBaseId, limit)
    : db.prepare(`SELECT * FROM knowledge_jobs WHERE space_id=? ORDER BY created_at DESC LIMIT ?`).all(spaceId, limit);
  return (rows as any[]).map(rowJob);
}

export function knowledgeSpaceBytes(spaceId: string) {
  return Number((db.prepare(`SELECT COALESCE(SUM(size_bytes),0) bytes FROM knowledge_documents
    WHERE space_id=? AND deleted_at IS NULL`).get(spaceId) as { bytes?: number } | undefined)?.bytes || 0);
}

function insertKnowledgeJob(input: {
  spaceId: string; knowledgeBaseId: string; documentId?: string | null; requestedBy?: string | null;
  kind: KnowledgeJobKind; idempotencyKey?: string | null; values?: Record<string, unknown>;
}) {
  const replay = idempotentKnowledgeJob(input);
  if (replay) return replay;
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO knowledge_jobs
    (id,space_id,knowledge_base_id,document_id,requested_by,kind,state,stage,progress,attempt,max_attempts,idempotency_key,input_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'queued','queued',0,0,3,?,?,?,?)`).run(id, input.spaceId, input.knowledgeBaseId,
      input.documentId || null, input.requestedBy || null, input.kind, input.idempotencyKey || null,
      JSON.stringify(input.values || {}), now, now);
  auditKnowledge({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: input.documentId,
    jobId: id, actorUserId: input.requestedBy, action: 'knowledge_job.queued', detail: { kind: input.kind } });
  return getKnowledgeJob(id)!;
}

export function createKnowledgeDocument(input: {
  spaceId: string; knowledgeBaseId: string; userId: string; storedFilename: string; originalName: string;
  mimeType: string; sizeBytes: number; sha256: string; metadata?: Record<string, unknown>; idempotencyKey?: string;
}) {
  const jobValues = { metadata: input.metadata || {}, sha256: input.sha256, mimeType: input.mimeType, sizeBytes: input.sizeBytes };
  const replay = idempotentKnowledgeJob({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId,
    requestedBy: input.userId, kind: 'document.index', idempotencyKey: input.idempotencyKey,
    values: jobValues, acceptAnyDocument: true });
  if (replay?.documentId) {
    const document = getKnowledgeDocument(replay.documentId, input.knowledgeBaseId, input.spaceId, true);
    if (!document) throw new KnowledgeError('The original idempotent upload is no longer available.', 409, 'KNOWLEDGE_IDEMPOTENCY_ORPHANED');
    return { document, job: replay, deduplicated: true };
  }
  const base = getKnowledgeBase(input.knowledgeBaseId, input.spaceId);
  if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  if (base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const existing = db.prepare(`SELECT * FROM knowledge_documents WHERE knowledge_base_id=? AND space_id=?
    AND sha256=? AND deleted_at IS NULL`).get(input.knowledgeBaseId, input.spaceId, input.sha256) as any;
  if (existing) {
    const active = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`)
      .get(existing.id) as any;
    return { document: rowDocument(existing), job: active ? rowJob(active) : null, deduplicated: true };
  }
  return db.transaction(() => {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO knowledge_documents
      (id,space_id,knowledge_base_id,created_by,stored_filename,original_name,mime_type,size_bytes,sha256,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(id, input.spaceId, input.knowledgeBaseId, input.userId,
        input.storedFilename, input.originalName, input.mimeType, input.sizeBytes, input.sha256, now, now);
    db.prepare(`UPDATE knowledge_bases SET status='indexing',updated_at=? WHERE id=? AND space_id=?`).run(now, input.knowledgeBaseId, input.spaceId);
    const job = insertKnowledgeJob({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: id,
      requestedBy: input.userId, kind: 'document.index', idempotencyKey: input.idempotencyKey,
      values: jobValues });
    auditKnowledge({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: id,
      actorUserId: input.userId, action: 'knowledge_document.uploaded', detail: { sha256: input.sha256, sizeBytes: input.sizeBytes } });
    return { document: getKnowledgeDocument(id, input.knowledgeBaseId, input.spaceId)!, job, deduplicated: false };
  })();
}

export const createKnowledgeDocuments = db.transaction((inputs: Parameters<typeof createKnowledgeDocument>[0][]) =>
  inputs.map((input) => createKnowledgeDocument(input)));

export function queueKnowledgeDocumentReindex(documentId: string, knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
    kind: 'document.reindex', idempotencyKey });
  if (replay) return { job: replay, deduplicated: true };
  const document = getKnowledgeDocument(documentId, knowledgeBaseId, spaceId);
  if (!document) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base || base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const existing = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`).get(documentId) as any;
  if (existing) return { job: rowJob(existing), deduplicated: true };
  return db.transaction(() => {
    const now = new Date().toISOString();
    // Keep a previously indexed document readable while a replacement version
    // is prepared. The durable job owns reindex progress; the document row
    // continues to represent the last committed Arango watermark.
    db.prepare(`UPDATE knowledge_documents SET state=CASE WHEN index_version>0 THEN 'ready' ELSE 'queued' END,error=NULL,updated_at=? WHERE id=? AND space_id=?`)
      .run(now, documentId, spaceId);
    db.prepare(`UPDATE knowledge_bases SET status='indexing',updated_at=? WHERE id=? AND space_id=? AND status<>'deleting'`)
      .run(now, knowledgeBaseId, spaceId);
    return { job: insertKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
      kind: 'document.reindex', idempotencyKey }), deduplicated: false };
  })();
}

export function queueKnowledgeDocumentDelete(documentId: string, knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
    kind: 'document.delete', idempotencyKey });
  if (replay) return replay;
  const document = getKnowledgeDocument(documentId, knowledgeBaseId, spaceId);
  if (!document) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base || base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const existing = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`).get(documentId) as any;
  if (existing) throw new KnowledgeError('This document already has active indexing work.', 409, 'KNOWLEDGE_DOCUMENT_BUSY');
  return db.transaction(() => {
    db.prepare(`UPDATE knowledge_documents SET state='deleting',updated_at=? WHERE id=? AND space_id=?`)
      .run(new Date().toISOString(), documentId, spaceId);
    return insertKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
      kind: 'document.delete', idempotencyKey });
  })();
}

export function queueKnowledgeBaseDelete(knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId: null, requestedBy: userId,
    kind: 'base.delete', idempotencyKey });
  if (replay) return { job: replay, deduplicated: true };
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  const existing = db.prepare(`SELECT * FROM knowledge_jobs WHERE knowledge_base_id=? AND kind='base.delete'
    AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`).get(knowledgeBaseId) as any;
  if (existing) return { job: rowJob(existing), deduplicated: true };
  return db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE knowledge_jobs SET state='cancelled',stage='cancelled_by_base_delete',progress=100,error='Knowledge base deletion superseded this job.',completed_at=?,updated_at=?
      WHERE knowledge_base_id=? AND state='queued'`).run(now, now, knowledgeBaseId);
    db.prepare(`UPDATE knowledge_bases SET status='deleting',updated_at=? WHERE id=? AND space_id=?`).run(now, knowledgeBaseId, spaceId);
    const job = insertKnowledgeJob({ spaceId, knowledgeBaseId, requestedBy: userId, kind: 'base.delete', idempotencyKey });
    return { job, deduplicated: false };
  })();
}

export const claimNextKnowledgeJob = db.transaction((): KnowledgeJobRecord | null => {
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT candidate.* FROM knowledge_jobs candidate
    WHERE candidate.state='queued' AND (candidate.retry_at IS NULL OR candidate.retry_at<=?)
      AND NOT EXISTS (SELECT 1 FROM knowledge_jobs active WHERE active.knowledge_base_id=candidate.knowledge_base_id AND active.state='processing')
      AND candidate.id=(SELECT queued.id FROM knowledge_jobs queued
        WHERE queued.space_id=candidate.space_id AND queued.state='queued' AND (queued.retry_at IS NULL OR queued.retry_at<=?)
          AND NOT EXISTS (SELECT 1 FROM knowledge_jobs active
            WHERE active.knowledge_base_id=queued.knowledge_base_id AND active.state='processing')
        ORDER BY queued.created_at,queued.rowid LIMIT 1)
    ORDER BY (SELECT COUNT(*) FROM knowledge_jobs active WHERE active.space_id=candidate.space_id AND active.state='processing'),
      COALESCE((SELECT MAX(started_at) FROM knowledge_jobs served WHERE served.space_id=candidate.space_id AND served.started_at IS NOT NULL),''),
      candidate.created_at,candidate.rowid LIMIT 1`).get(now, now) as any;
  if (!row) return null;
  const targetVersion = Number((db.prepare('SELECT current_version FROM knowledge_bases WHERE id=? AND space_id=?')
    .get(row.knowledge_base_id, row.space_id) as any)?.current_version || 0) + 1;
  const changed = db.prepare(`UPDATE knowledge_jobs SET state='processing',stage='dispatching',progress=5,
    attempt=attempt+1,target_version=?,started_at=?,updated_at=? WHERE id=? AND state='queued'`)
    .run(targetVersion, now, now, row.id).changes;
  return changed ? getKnowledgeJob(row.id) : null;
});

export function updateKnowledgeJob(id: string, values: {
  state?: KnowledgeJobState; stage?: string; progress?: number; result?: unknown; error?: string | null;
  retryAt?: string | null; completedAt?: string | null;
}) {
  const current = getKnowledgeJob(id);
  if (!current) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE knowledge_jobs SET state=?,stage=?,progress=?,result_json=?,error=?,retry_at=?,completed_at=?,updated_at=? WHERE id=?`).run(
    values.state || current.state, values.stage || current.stage, values.progress ?? current.progress,
    values.result === undefined ? (current.result == null ? null : JSON.stringify(current.result)) : JSON.stringify(values.result),
    values.error === undefined ? current.error : values.error, values.retryAt === undefined ? current.retryAt : values.retryAt,
    values.completedAt === undefined ? current.completedAt : values.completedAt, now, id
  );
  return getKnowledgeJob(id);
}

export function markKnowledgeJobStage(job: KnowledgeJobRecord, stage: string, progress: number) {
  if (job.documentId) {
    const prior = getKnowledgeDocument(job.documentId, job.knowledgeBaseId, job.spaceId, true);
    const documentState: KnowledgeDocumentState = job.kind === 'document.delete' || stage === 'deleting_index'
      ? 'deleting'
      : job.kind === 'document.reindex' && Number(prior?.indexVersion || 0) > 0
        ? 'ready'
        : stage === 'extracting' ? 'extracting' : stage === 'indexing' ? 'indexing' : 'queued';
    db.prepare(`UPDATE knowledge_documents SET state=?,error=NULL,updated_at=? WHERE id=? AND space_id=?`)
      .run(documentState, new Date().toISOString(), job.documentId, job.spaceId);
  }
  return updateKnowledgeJob(job.id, { stage, progress });
}

export function completeKnowledgeIndex(job: KnowledgeJobRecord, output: {
  document?: { pageCount?: number | null; chunkCount?: number; entityCount?: number; relationshipCount?: number; language?: string | null };
  metrics?: Record<string, unknown>;
}) {
  if (!job.documentId || !job.targetVersion) throw new KnowledgeError('The indexing job is missing its document or version.', 500, 'KNOWLEDGE_JOB_INVALID');
  return db.transaction(() => {
    const now = new Date().toISOString(); const stats = output.document || {};
    db.prepare(`UPDATE knowledge_documents SET state='ready',index_version=?,page_count=?,chunk_count=?,entity_count=?,relationship_count=?,language=?,error=NULL,indexed_at=?,updated_at=?
      WHERE id=? AND space_id=?`).run(job.targetVersion, stats.pageCount ?? null, Math.max(0, Number(stats.chunkCount || 0)),
        Math.max(0, Number(stats.entityCount || 0)), Math.max(0, Number(stats.relationshipCount || 0)), stats.language || null, now, now, job.documentId, job.spaceId);
    db.prepare(`UPDATE knowledge_bases SET status=CASE WHEN status='deleting' THEN 'deleting' ELSE 'ready' END,
      current_version=MAX(current_version,?),last_indexed_at=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(job.targetVersion, now, now, job.knowledgeBaseId, job.spaceId);
    const completed = updateKnowledgeJob(job.id, { state: 'completed', stage: 'completed', progress: 100,
      result: output, error: null, retryAt: null, completedAt: now });
    auditKnowledge({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId, documentId: job.documentId,
      jobId: job.id, actorUserId: job.requestedBy, action: 'knowledge_document.indexed',
      detail: { indexVersion: job.targetVersion, ...stats } });
    return completed;
  })();
}

function safeStoredPath(storedFilename: string) {
  const root = `${path.resolve(config.knowledgeStorageDir)}${path.sep}`.toLowerCase();
  const resolved = path.resolve(config.knowledgeStorageDir, storedFilename);
  if (!resolved.toLowerCase().startsWith(root)) throw new KnowledgeError('Invalid knowledge document path.', 500, 'KNOWLEDGE_STORAGE_PATH_INVALID');
  return resolved;
}

function enqueueKnowledgeFileCleanup(input: {
  spaceId: string; knowledgeBaseId: string; documentId?: string | null; storedFilename: string;
}) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO knowledge_file_cleanup
    (id,space_id,knowledge_base_id,document_id,stored_filename,state,attempt,error,retry_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',0,NULL,NULL,?,?) ON CONFLICT(stored_filename) DO NOTHING`)
    .run(crypto.randomUUID(), input.spaceId, input.knowledgeBaseId, input.documentId || null,
      input.storedFilename, now, now);
}

/**
 * Removes staged source files only after their database deletion transaction has
 * committed. A crash after unlinking but before acknowledgement is harmless:
 * force removal of the already-absent file succeeds on the next pass.
 */
export function processKnowledgeFileCleanup(limit = 100) {
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT * FROM knowledge_file_cleanup
    WHERE state='pending' AND (retry_at IS NULL OR retry_at<=?)
    ORDER BY created_at,rowid LIMIT ?`).all(now, Math.max(1, Math.min(500, limit))) as Array<{
      id: string; stored_filename: string; attempt: number;
    }>;
  let completed = 0; let failed = 0;
  for (const row of rows) {
    const claimed = db.prepare(`UPDATE knowledge_file_cleanup SET state='processing',attempt=attempt+1,updated_at=?
      WHERE id=? AND state='pending'`).run(new Date().toISOString(), row.id).changes;
    if (!claimed) continue;
    try {
      fs.rmSync(safeStoredPath(row.stored_filename), { force: true });
      const finishedAt = new Date().toISOString();
      db.prepare(`UPDATE knowledge_file_cleanup SET state='completed',error=NULL,retry_at=NULL,completed_at=?,updated_at=? WHERE id=?`)
        .run(finishedAt, finishedAt, row.id);
      completed += 1;
    } catch (error) {
      const attempt = Number(row.attempt || 0) + 1;
      const delayMs = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(8, Math.max(0, attempt - 1))));
      db.prepare(`UPDATE knowledge_file_cleanup SET state='pending',error=?,retry_at=?,updated_at=? WHERE id=?`)
        .run((error instanceof Error ? error.message : String(error)).slice(0, 1000),
          new Date(Date.now() + delayMs).toISOString(), new Date().toISOString(), row.id);
      failed += 1;
    }
  }
  return { inspected: rows.length, completed, failed };
}

export function knowledgeDocumentSourcePath(document: KnowledgeDocumentRecord) {
  const row = db.prepare('SELECT stored_filename FROM knowledge_documents WHERE id=? AND space_id=?')
    .get(document.id, document.spaceId) as { stored_filename: string } | undefined;
  if (!row) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const resolved = safeStoredPath(row.stored_filename);
  if (!fs.existsSync(resolved)) throw new KnowledgeError('The staged knowledge document is missing.', 409, 'KNOWLEDGE_DOCUMENT_FILE_MISSING');
  return resolved;
}

function purgeKnowledgeEvidence(spaceId: string, knowledgeBaseId: string, documentId?: string | null) {
  const aiRows = db.prepare(`SELECT ai_job_id,knowledge_refs_json,citations_json FROM ai_job_knowledge_contexts WHERE space_id=?`)
    .all(spaceId) as Array<{ ai_job_id: string; knowledge_refs_json: string; citations_json: string }>;
  const aiIds = aiRows.filter((row) => documentId
    ? parseJson<Array<{ documentId?: string }>>(row.citations_json, []).some((citation) => citation.documentId === documentId)
    : parseJson<Array<{ id?: string }>>(row.knowledge_refs_json, []).some((ref) => ref.id === knowledgeBaseId))
    .map((row) => row.ai_job_id);
  const deleteAi = db.prepare('DELETE FROM ai_job_knowledge_contexts WHERE ai_job_id=? AND space_id=?');
  for (const id of aiIds) deleteAi.run(id, spaceId);

  if (!documentId) {
    db.prepare('DELETE FROM knowledge_query_snapshots WHERE space_id=? AND knowledge_base_id=?')
      .run(spaceId, knowledgeBaseId);
  } else {
    const queryRows = db.prepare(`SELECT request_id,citations_json FROM knowledge_query_snapshots
      WHERE space_id=? AND knowledge_base_id=?`).all(spaceId, knowledgeBaseId) as Array<{ request_id: string; citations_json: string }>;
    const remove = db.prepare('DELETE FROM knowledge_query_snapshots WHERE request_id=? AND space_id=?');
    for (const row of queryRows) {
      if (parseJson<Array<{ documentId?: string }>>(row.citations_json, []).some((citation) => citation.documentId === documentId)) {
        remove.run(row.request_id, spaceId);
      }
    }
  }
}

export function completeKnowledgeDelete(job: KnowledgeJobRecord, output: Record<string, unknown>) {
  const completed = db.transaction(() => {
    const now = new Date().toISOString();
    if (job.kind === 'document.delete' && job.documentId) {
      const stored = db.prepare('SELECT stored_filename FROM knowledge_documents WHERE id=? AND space_id=?')
        .get(job.documentId, job.spaceId) as { stored_filename: string } | undefined;
      purgeKnowledgeEvidence(job.spaceId, job.knowledgeBaseId, job.documentId);
      db.prepare(`UPDATE knowledge_documents SET state='deleted',deleted_at=?,original_name='Deleted document',mime_type='application/octet-stream',
        size_bytes=0,sha256='deleted:'||id,page_count=NULL,chunk_count=0,entity_count=0,relationship_count=0,language=NULL,error=NULL,updated_at=?
        WHERE id=? AND space_id=?`).run(now, now, job.documentId, job.spaceId);
      db.prepare(`UPDATE knowledge_jobs SET input_json='{}',result_json=NULL,error=NULL,updated_at=?
        WHERE document_id=? AND space_id=? AND id<>?`).run(now, job.documentId, job.spaceId, job.id);
      db.prepare(`UPDATE knowledge_bases SET current_version=MAX(current_version,?),status=CASE
        WHEN status='deleting' THEN 'deleting'
        WHEN EXISTS(SELECT 1 FROM knowledge_documents WHERE knowledge_base_id=? AND state='ready' AND deleted_at IS NULL) THEN 'ready' ELSE 'empty' END,
        updated_at=? WHERE id=? AND space_id=?`).run(job.targetVersion || 0, job.knowledgeBaseId, now, job.knowledgeBaseId, job.spaceId);
      if (stored) enqueueKnowledgeFileCleanup({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId, storedFilename: stored.stored_filename });
    } else if (job.kind === 'base.delete') {
      const stored = db.prepare(`SELECT stored_filename FROM knowledge_documents WHERE knowledge_base_id=? AND space_id=? AND deleted_at IS NULL`)
        .all(job.knowledgeBaseId, job.spaceId) as Array<{ stored_filename: string }>;
      purgeKnowledgeEvidence(job.spaceId, job.knowledgeBaseId);
      db.prepare('DELETE FROM survey_knowledge_bases WHERE space_id=? AND knowledge_base_id=?')
        .run(job.spaceId, job.knowledgeBaseId);
      db.prepare(`UPDATE knowledge_documents SET state='deleted',deleted_at=COALESCE(deleted_at,?),original_name='Deleted document',
        mime_type='application/octet-stream',size_bytes=0,sha256='deleted:'||id,page_count=NULL,chunk_count=0,entity_count=0,
        relationship_count=0,language=NULL,error=NULL,updated_at=? WHERE knowledge_base_id=? AND space_id=?`)
        .run(now, now, job.knowledgeBaseId, job.spaceId);
      db.prepare(`UPDATE knowledge_jobs SET input_json='{}',result_json=NULL,error=NULL,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND id<>?`).run(now, job.knowledgeBaseId, job.spaceId, job.id);
      db.prepare(`UPDATE knowledge_bases SET status='deleted',deleted_at=?,name='Deleted knowledge base',description='',privacy='private',
        allow_terra_context=0,current_version=MAX(current_version,?),updated_at=? WHERE id=? AND space_id=?`)
        .run(now, job.targetVersion || 0, now, job.knowledgeBaseId, job.spaceId);
      for (const item of stored) enqueueKnowledgeFileCleanup({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId,
        storedFilename: item.stored_filename });
    }
    const completed = updateKnowledgeJob(job.id, { state: 'completed', stage: 'completed', progress: 100,
      result: output, error: null, retryAt: null, completedAt: now });
    auditKnowledge({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId, documentId: job.documentId,
      jobId: job.id, actorUserId: job.requestedBy, action: job.kind === 'base.delete' ? 'knowledge_base.deleted' : 'knowledge_document.deleted' });
    return completed;
  })();
  // Keep filesystem side effects outside the SQLite transaction. Any failure is
  // retained durably and retried by the worker without rolling back redaction.
  processKnowledgeFileCleanup();
  return completed;
}

export function failKnowledgeJob(job: KnowledgeJobRecord, message: string) {
  const now = new Date().toISOString();
  if (job.documentId) db.prepare(`UPDATE knowledge_documents SET state=CASE
      WHEN ?='document.reindex' AND index_version>0 THEN 'ready' ELSE 'failed' END,error=?,updated_at=? WHERE id=? AND space_id=?`)
    .run(job.kind, message.slice(0, 1000), now, job.documentId, job.spaceId);
  db.prepare(`UPDATE knowledge_bases SET status='degraded',updated_at=? WHERE id=? AND space_id=? AND status<>'deleting'`)
    .run(now, job.knowledgeBaseId, job.spaceId);
  const failed = updateKnowledgeJob(job.id, { state: 'failed', stage: 'failed', progress: 100,
    error: message.slice(0, 1000), retryAt: null, completedAt: now });
  auditKnowledge({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId, documentId: job.documentId,
    jobId: job.id, actorUserId: job.requestedBy, action: 'knowledge_job.failed', detail: { message: message.slice(0, 500) } });
  return failed;
}

export function requeueKnowledgeJob(job: KnowledgeJobRecord, stage: string, message: string, retryAt: string) {
  const now = new Date().toISOString();
  if (job.documentId) {
    db.prepare(`UPDATE knowledge_documents SET state=CASE
        WHEN ?='document.delete' THEN 'deleting'
        WHEN ?='document.reindex' AND index_version>0 THEN 'ready'
        ELSE 'queued' END,error=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(job.kind, job.kind, message.slice(0, 1000), now, job.documentId, job.spaceId);
  }
  db.prepare(`UPDATE knowledge_bases SET status=CASE WHEN status='deleting' THEN status ELSE 'indexing' END,updated_at=?
    WHERE id=? AND space_id=?`).run(now, job.knowledgeBaseId, job.spaceId);
  return updateKnowledgeJob(job.id, { state: 'queued', stage, progress: 0, error: message.slice(0, 1000), retryAt });
}

export function resolveKnowledgeBaseRefs(spaceId: string, ids: unknown, options: {
  requireTerra?: boolean; allowEmpty?: boolean; viewerUserId?: string; allowPrivate?: boolean;
} = {}) {
  const unique = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  if (unique.length > 5) throw new KnowledgeError('Choose no more than five knowledge bases.', 400, 'KNOWLEDGE_BASE_LIMIT');
  if (!unique.length) return [];
  const refs: KnowledgeBaseRef[] = [];
  for (const id of unique) {
    const base = getKnowledgeBase(id, spaceId, false, options.viewerUserId);
    if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
    if (base.privacy === 'private' && options.allowPrivate === false) {
      throw new KnowledgeError(`Private knowledge base "${base.name}" cannot be attached to shared workspace artifacts.`,
        409, 'KNOWLEDGE_PRIVATE_CONTEXT_NOT_SHAREABLE');
    }
    if (options.requireTerra && !base.allowTerraContext) {
      throw new KnowledgeError(`Terra context is not enabled for "${base.name}".`, 409, 'KNOWLEDGE_TERRA_CONTEXT_DISABLED');
    }
    const readableStatus = ['ready', 'indexing', 'degraded'].includes(base.status);
    if (!options.allowEmpty && (!readableStatus || base.currentVersion < 1 || base.readyDocumentCount < 1)) {
      throw new KnowledgeError(`"${base.name}" is not ready for retrieval.`, 409, 'KNOWLEDGE_BASE_NOT_READY');
    }
    refs.push({ id: base.id, name: base.name, indexVersion: base.currentVersion,
      embeddingModel: base.embeddingModel, embeddingDimension: base.embeddingDimension, chunkerVersion: base.chunkerVersion });
  }
  return refs;
}

export function replaceSurveyKnowledgeBases(surveyId: string, spaceId: string, userId: string, ids: unknown,
  scopes: string[] = ['response.analyze', 'insights.generate', 'analyst.chat', 'report.generate']) {
  if (!db.prepare('SELECT 1 FROM surveys WHERE id=? AND space_id=?').get(surveyId, spaceId)) {
    throw new KnowledgeError('Survey not found.', 404, 'SURVEY_NOT_FOUND');
  }
  const refs = resolveKnowledgeBaseRefs(spaceId, ids, { requireTerra: true, viewerUserId: userId, allowPrivate: false });
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM survey_knowledge_bases WHERE survey_id=? AND space_id=?').run(surveyId, spaceId);
    const insert = db.prepare(`INSERT INTO survey_knowledge_bases
      (survey_id,space_id,knowledge_base_id,activity_scope_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
    for (const ref of refs) insert.run(surveyId, spaceId, ref.id, JSON.stringify(scopes), userId, now, now);
  })();
  auditKnowledge({ spaceId, actorUserId: userId, action: 'survey.knowledge_bases_replaced', detail: { surveyId, knowledgeBaseIds: refs.map((ref) => ref.id) } });
  return refs;
}

export function surveyKnowledgeBaseIds(surveyId: string, spaceId: string, activity: string) {
  return (db.prepare(`SELECT knowledge_base_id,activity_scope_json FROM survey_knowledge_bases
    WHERE survey_id=? AND space_id=? ORDER BY created_at,knowledge_base_id`).all(surveyId, spaceId) as any[])
    .filter((row) => parseJson<string[]>(row.activity_scope_json, []).includes(activity))
    .map((row) => String(row.knowledge_base_id));
}

export function getKnowledgeContext(aiJobId: string, spaceId: string): KnowledgeContextRecord | null {
  const row = db.prepare('SELECT * FROM ai_job_knowledge_contexts WHERE ai_job_id=? AND space_id=?').get(aiJobId, spaceId) as any;
  return row ? {
    aiJobId: row.ai_job_id, spaceId: row.space_id, query: row.query_text,
    knowledgeBases: parseJson(row.knowledge_refs_json, []), citations: parseJson(row.citations_json, []),
    contextText: row.context_text, metrics: parseJson(row.metrics_json, {}), createdAt: row.created_at
  } : null;
}

export function saveKnowledgeContext(input: Omit<KnowledgeContextRecord, 'createdAt'>) {
  const contextBytes = Buffer.byteLength(input.contextText, 'utf8');
  if (contextBytes > config.knowledgeContextMaxBytes) throw new KnowledgeError('Retrieved knowledge context exceeded the safe request limit.', 413, 'KNOWLEDGE_CONTEXT_TOO_LARGE');
  db.prepare(`INSERT OR IGNORE INTO ai_job_knowledge_contexts
    (ai_job_id,space_id,query_text,knowledge_refs_json,citations_json,context_text,metrics_json,context_bytes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(input.aiJobId, input.spaceId, input.query,
      JSON.stringify(input.knowledgeBases), JSON.stringify(input.citations), input.contextText,
      JSON.stringify(input.metrics), contextBytes, new Date().toISOString());
  return getKnowledgeContext(input.aiJobId, input.spaceId)!;
}

export function saveKnowledgeQuerySnapshot(input: {
  requestId: string; spaceId: string; knowledgeBaseId: string; requestedBy: string; query: string;
  knowledgeBases: KnowledgeBaseRef[]; citations: KnowledgeCitation[]; contextText: string; metrics: Record<string, unknown>;
}) {
  const contextBytes = Buffer.byteLength(input.contextText, 'utf8');
  if (contextBytes > config.knowledgeContextMaxBytes) {
    throw new KnowledgeError('Retrieved knowledge context exceeded the safe request limit.', 413, 'KNOWLEDGE_CONTEXT_TOO_LARGE');
  }
  db.prepare(`INSERT INTO knowledge_query_snapshots
    (request_id,space_id,knowledge_base_id,requested_by,query_text,knowledge_refs_json,citations_json,context_text,metrics_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.requestId, input.spaceId, input.knowledgeBaseId, input.requestedBy,
      input.query, JSON.stringify(input.knowledgeBases), JSON.stringify(input.citations), input.contextText,
      JSON.stringify(input.metrics), new Date().toISOString());
  return input.requestId;
}

export function getKnowledgeQuerySnapshot(requestId: string, spaceId: string) {
  const row = db.prepare(`SELECT * FROM knowledge_query_snapshots WHERE request_id=? AND space_id=?`).get(requestId, spaceId) as any;
  return row ? {
    requestId: row.request_id, spaceId: row.space_id, knowledgeBaseId: row.knowledge_base_id,
    requestedBy: row.requested_by, query: row.query_text, knowledgeBases: parseJson(row.knowledge_refs_json, []),
    citations: parseJson(row.citations_json, []), contextText: row.context_text, metrics: parseJson(row.metrics_json, {}),
    createdAt: row.created_at
  } : null;
}

export function listKnowledgeAudit(spaceId: string, knowledgeBaseId?: string, limit = 200) {
  const rows = knowledgeBaseId
    ? db.prepare(`SELECT id,knowledge_base_id knowledgeBaseId,document_id documentId,job_id jobId,actor_user_id actorUserId,
        ai_job_id aiJobId,
        action,detail_json detail,created_at createdAt FROM knowledge_audit_events
        WHERE space_id=? AND knowledge_base_id=? ORDER BY created_at DESC LIMIT ?`).all(spaceId, knowledgeBaseId, limit)
    : db.prepare(`SELECT id,knowledge_base_id knowledgeBaseId,document_id documentId,job_id jobId,actor_user_id actorUserId,
        ai_job_id aiJobId,
        action,detail_json detail,created_at createdAt FROM knowledge_audit_events
        WHERE space_id=? ORDER BY created_at DESC LIMIT ?`).all(spaceId, limit);
  return (rows as Array<Record<string, unknown>>).map((row) => ({ ...row, detail: parseJson(row.detail, {}) }));
}

export function knowledgeQueueStatus(spaceId: string) {
  const rows = db.prepare(`SELECT state,COUNT(*) count FROM knowledge_jobs WHERE space_id=? GROUP BY state`).all(spaceId) as Array<{ state: string; count: number }>;
  const counts = Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  const cleanup = db.prepare(`SELECT
    SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN state='processing' THEN 1 ELSE 0 END) processing,
    SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) completed
    FROM knowledge_file_cleanup WHERE space_id=?`).get(spaceId) as any;
  return {
    queued: Number(counts.queued || 0), processing: Number(counts.processing || 0),
    completed: Number(counts.completed || 0), failed: Number(counts.failed || 0),
    fileCleanup: { pending: Number(cleanup?.pending || 0), processing: Number(cleanup?.processing || 0),
      completed: Number(cleanup?.completed || 0) }
  };
}

export function knowledgeJobAudienceUserId(job: KnowledgeJobRecord) {
  const base = getKnowledgeBase(job.knowledgeBaseId, job.spaceId, true);
  return base?.privacy === 'private' ? (job.requestedBy || base.createdBy || '__private-knowledge-owner__') : null;
}
