import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  config, gteKnowledgeEmbeddingProfile, qwenKnowledgeEmbeddingProfile,
  type KnowledgeEmbeddingProfile
} from './config.js';
import { db } from './database.js';
import { assertSubscriptionQuota, SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import './spaces.js';

export type KnowledgeBaseStatus = 'empty' | 'indexing' | 'ready' | 'degraded' | 'deleting' | 'deleted';
export type KnowledgeDocumentState = 'queued' | 'extracting' | 'indexing' | 'ready' | 'failed' | 'deleting' | 'deleted';
export type KnowledgeJobKind = 'document.index' | 'document.reindex' | 'document.delete' | 'base.delete';
export type KnowledgeJobState = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type KnowledgeEmbeddingProfileState = 'configured' | 'disabled' | 'retired';
export type KnowledgeBaseEmbeddingMode = 'primary' | 'dual_write' | 'shadow' | 'disabled';
export type KnowledgeEmbeddingIndexState = 'empty' | 'queued' | 'indexing' | 'ready' | 'degraded' | 'disabled';

export interface KnowledgeEmbeddingProfileRecord extends KnowledgeEmbeddingProfile {
  state: KnowledgeEmbeddingProfileState;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseEmbeddingProfileRecord {
  spaceId: string;
  knowledgeBaseId: string;
  mode: KnowledgeBaseEmbeddingMode;
  state: KnowledgeEmbeddingIndexState;
  currentVersion: number;
  error: string | null;
  lastIndexedAt: string | null;
  profileState: KnowledgeEmbeddingProfileState;
  embeddingProfile: KnowledgeEmbeddingProfile;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseRecord {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  privacy: 'space' | 'private';
  status: KnowledgeBaseStatus;
  allowTerraContext: boolean;
  embeddingProfile: KnowledgeEmbeddingProfile;
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
  embeddingProfileId: string | null;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  retryAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseGeneration: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
}

export interface KnowledgeBaseRef {
  id: string;
  name: string;
  indexVersion: number;
  embeddingModel: string;
  embeddingDimension: number;
  chunkerVersion: string;
  embeddingProfile: KnowledgeEmbeddingProfile;
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
      embedding_provider TEXT NOT NULL DEFAULT 'qwen-tei',
      embedding_model TEXT NOT NULL,
      embedding_revision TEXT NOT NULL DEFAULT '5cf2132abc99cad020ac570b19d031efec650f2b',
      embedding_dtype TEXT NOT NULL DEFAULT 'float16',
      embedding_dimension INTEGER NOT NULL,
      vector_index_version TEXT NOT NULL DEFAULT 'qwen-v1',
      chunker_version TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 0,
      last_allocated_version INTEGER NOT NULL DEFAULT 0,
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
      target_version_reserved INTEGER NOT NULL DEFAULT 0,
      embedding_profile_id TEXT REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
      idempotency_key TEXT,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      error TEXT,
      retry_at TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_token TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0,
      lease_acquired_at TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX knowledge_jobs_dispatch ON knowledge_jobs(state,retry_at,created_at);
    CREATE INDEX knowledge_jobs_space_history ON knowledge_jobs(space_id,created_at DESC);
    CREATE UNIQUE INDEX knowledge_jobs_idempotency ON knowledge_jobs(space_id,idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX knowledge_jobs_one_active_document ON knowledge_jobs(document_id)
      WHERE document_id IS NOT NULL AND state IN ('queued','processing');
    CREATE UNIQUE INDEX knowledge_jobs_one_processing_base ON knowledge_jobs(knowledge_base_id)
      WHERE state='processing';
    CREATE UNIQUE INDEX knowledge_jobs_unique_target_version ON knowledge_jobs(knowledge_base_id,target_version)
      WHERE target_version IS NOT NULL AND target_version_reserved=1;

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
if (db.provider === 'sqlite') applyKnowledgeSchema();

if (db.provider === 'sqlite') db.exec(`CREATE TABLE IF NOT EXISTS social_intelligence_publications (
    -- report_id deliberately remains a provenance tombstone rather than a
    -- cascading FK. Derived documents contain no retained raw-post snapshot.
    report_id TEXT NOT NULL,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    job_id TEXT,
    source_requested_by TEXT NOT NULL,
    published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK(review_status='reviewed'),
    source_snapshot_sha256 TEXT NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(report_id,knowledge_base_id),
    UNIQUE(document_id),
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(job_id) REFERENCES knowledge_jobs(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS social_intelligence_publications_space_created
    ON social_intelligence_publications(space_id,created_at DESC);`);

function assertKnowledgeEmbeddingProfileIdentity(profile: KnowledgeEmbeddingProfile) {
  const row = db.prepare(`SELECT provider,model,revision,dtype,dimensions FROM knowledge_embedding_profiles
    WHERE vector_index_version=?`).get(profile.vectorIndexVersion) as any;
  if (!row || row.provider !== profile.provider || row.model !== profile.model || row.revision !== profile.revision
      || row.dtype !== profile.dtype || Number(row.dimensions) !== profile.dimensions) {
    throw new Error(`Knowledge embedding profile ${profile.vectorIndexVersion} has an immutable identity mismatch.`);
  }
}

/**
 * Generated social intelligence must never become primary evidence for a later
 * social or cross-source generation. Publication metadata is the durable
 * trust boundary; filter by document identity rather than model-written tags.
 */
export function excludeDerivedSocialIntelligenceCitations(spaceId: string, citations: KnowledgeCitation[]) {
  const documentIds = [...new Set(citations.map((citation) => citation.documentId).filter(Boolean))];
  if (!documentIds.length) return citations;
  const placeholders = documentIds.map(() => '?').join(',');
  const derived = new Set((db.prepare(`SELECT document_id FROM social_intelligence_publications
    WHERE space_id=? AND document_id IN (${placeholders})`).all(spaceId, ...documentIds) as Array<{ document_id: string }>)
    .map((row) => row.document_id));
  // The origin marker is committed in the same transaction as the knowledge
  // document and index job. It closes the crash window before the higher-level
  // publication registry row is written and remains available for recovery.
  const originJobs = db.prepare(`SELECT document_id,input_json FROM knowledge_jobs
    WHERE space_id=? AND kind='document.index' AND document_id IN (${placeholders})`)
    .all(spaceId, ...documentIds) as Array<{ document_id: string; input_json: string }>;
  for (const job of originJobs) {
    const metadata = parseJson<Record<string, unknown>>(job.input_json, {}).metadata;
    if (metadata && typeof metadata === 'object'
        && (metadata as Record<string, unknown>).artifactType === 'derived_social_intelligence') {
      derived.add(job.document_id);
    }
  }
  return derived.size ? citations.filter((citation) => !derived.has(citation.documentId)) : citations;
}

if (db.provider === 'sqlite') {
const knowledgeBaseColumns = new Set((db.prepare('PRAGMA table_info(knowledge_bases)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeBaseColumns.has('privacy')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN privacy TEXT NOT NULL DEFAULT 'space'");
if (!knowledgeBaseColumns.has('embedding_provider')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN embedding_provider TEXT NOT NULL DEFAULT 'qwen-tei'");
if (!knowledgeBaseColumns.has('embedding_revision')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN embedding_revision TEXT NOT NULL DEFAULT '5cf2132abc99cad020ac570b19d031efec650f2b'");
if (!knowledgeBaseColumns.has('embedding_dtype')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN embedding_dtype TEXT NOT NULL DEFAULT 'float16'");
if (!knowledgeBaseColumns.has('vector_index_version')) db.exec("ALTER TABLE knowledge_bases ADD COLUMN vector_index_version TEXT NOT NULL DEFAULT 'qwen-v1'");
if (!knowledgeBaseColumns.has('last_allocated_version')) db.exec('ALTER TABLE knowledge_bases ADD COLUMN last_allocated_version INTEGER NOT NULL DEFAULT 0');
const knowledgeDocumentColumns = new Set((db.prepare('PRAGMA table_info(knowledge_documents)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeDocumentColumns.has('relationship_count')) db.exec('ALTER TABLE knowledge_documents ADD COLUMN relationship_count INTEGER NOT NULL DEFAULT 0');
const knowledgeJobColumns = new Set((db.prepare('PRAGMA table_info(knowledge_jobs)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeJobColumns.has('embedding_profile_id')) db.exec(`ALTER TABLE knowledge_jobs ADD COLUMN embedding_profile_id TEXT
  REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT`);
if (!knowledgeJobColumns.has('lease_owner')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN lease_owner TEXT');
if (!knowledgeJobColumns.has('lease_token')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN lease_token TEXT');
if (!knowledgeJobColumns.has('lease_generation')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0');
if (!knowledgeJobColumns.has('lease_acquired_at')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN lease_acquired_at TEXT');
if (!knowledgeJobColumns.has('lease_expires_at')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN lease_expires_at TEXT');
if (!knowledgeJobColumns.has('heartbeat_at')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN heartbeat_at TEXT');
if (!knowledgeJobColumns.has('target_version_reserved')) db.exec('ALTER TABLE knowledge_jobs ADD COLUMN target_version_reserved INTEGER NOT NULL DEFAULT 0');
db.prepare(`UPDATE knowledge_bases SET last_allocated_version=MAX(current_version,
  COALESCE((SELECT MAX(target_version) FROM knowledge_jobs WHERE knowledge_base_id=knowledge_bases.id),0),
  last_allocated_version)`).run();
// These indexes are the database-level last line of defence for multi-process
// workers. The claim transaction also locks the base row, but a unique partial
// index makes an accidental second active claim or target-version reuse fail
// closed even if a future dispatcher omits that lock.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_jobs_one_processing_base
  ON knowledge_jobs(knowledge_base_id) WHERE state='processing'`);
db.exec('DROP INDEX IF EXISTS knowledge_jobs_unique_target_version');
db.exec(`CREATE UNIQUE INDEX knowledge_jobs_unique_target_version
  ON knowledge_jobs(knowledge_base_id,target_version)
  WHERE target_version IS NOT NULL AND target_version_reserved=1`);
const knowledgeAuditColumns = new Set((db.prepare('PRAGMA table_info(knowledge_audit_events)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeAuditColumns.has('ai_job_id')) db.exec('ALTER TABLE knowledge_audit_events ADD COLUMN ai_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL');

// SQLite considers NULL values distinct inside a regular UNIQUE constraint.
// This partial index enforces one live copy of a document per knowledge base.
if (db.provider === 'sqlite') db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_live_sha
  ON knowledge_documents(knowledge_base_id,sha256) WHERE deleted_at IS NULL`);
if (db.provider === 'sqlite') db.exec(`
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

  CREATE TABLE IF NOT EXISTS knowledge_embedding_profiles (
    vector_index_version TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('qwen-tei','gte-node')),
    model TEXT NOT NULL,
    revision TEXT NOT NULL,
    dtype TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK(dimensions BETWEEN 128 AND 8192),
    state TEXT NOT NULL DEFAULT 'disabled' CHECK(state IN ('configured','disabled','retired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledge_base_embedding_profiles (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    mode TEXT NOT NULL CHECK(mode IN ('primary','dual_write','shadow','disabled')),
    state TEXT NOT NULL DEFAULT 'empty' CHECK(state IN ('empty','queued','indexing','ready','degraded','disabled')),
    current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0),
    error TEXT,
    last_indexed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(knowledge_base_id,vector_index_version),
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_embedding_one_primary
    ON knowledge_base_embedding_profiles(knowledge_base_id) WHERE mode='primary';
  CREATE INDEX IF NOT EXISTS knowledge_base_embedding_space_state
    ON knowledge_base_embedding_profiles(space_id,state,updated_at);
  CREATE TABLE IF NOT EXISTS knowledge_document_embeddings (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    source_sha256 TEXT NOT NULL,
    index_version INTEGER NOT NULL DEFAULT 0 CHECK(index_version >= 0),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','indexing','ready','failed','deleting','deleted')),
    chunk_count INTEGER NOT NULL DEFAULT 0 CHECK(chunk_count >= 0),
    last_job_id TEXT REFERENCES knowledge_jobs(id) ON DELETE SET NULL,
    error TEXT,
    indexed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(document_id,vector_index_version),
    FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS knowledge_document_embeddings_base_state
    ON knowledge_document_embeddings(knowledge_base_id,vector_index_version,state,updated_at);
  CREATE TABLE IF NOT EXISTS knowledge_backfill_runs (
    id TEXT PRIMARY KEY,
    scope_space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
    source_vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    target_vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','completed','failed','cancelled')),
    batch_size INTEGER NOT NULL DEFAULT 25 CHECK(batch_size BETWEEN 1 AND 500),
    total_documents INTEGER NOT NULL DEFAULT 0 CHECK(total_documents >= 0),
    completed_documents INTEGER NOT NULL DEFAULT 0 CHECK(completed_documents >= 0),
    failed_documents INTEGER NOT NULL DEFAULT 0 CHECK(failed_documents >= 0),
    cursor_document_id TEXT,
    error TEXT,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK(source_vector_index_version <> target_vector_index_version)
  );
  CREATE INDEX IF NOT EXISTS knowledge_backfill_runs_state
    ON knowledge_backfill_runs(state,created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS knowledge_backfill_one_active
    ON knowledge_backfill_runs(source_vector_index_version,target_vector_index_version,COALESCE(scope_space_id,''))
    WHERE state IN ('queued','running','paused');
  CREATE TABLE IF NOT EXISTS knowledge_backfill_run_bases (
    run_id TEXT NOT NULL REFERENCES knowledge_backfill_runs(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    source_base_version INTEGER NOT NULL CHECK(source_base_version >= 0),
    source_chunker_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(run_id,knowledge_base_id),
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS knowledge_backfill_items (
    run_id TEXT NOT NULL REFERENCES knowledge_backfill_runs(id) ON DELETE CASCADE,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    target_vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    source_sha256 TEXT NOT NULL,
    source_index_version INTEGER NOT NULL CHECK(source_index_version > 0),
    source_chunker_version TEXT NOT NULL,
    source_embedding_profile_json TEXT NOT NULL,
    target_embedding_profile_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','queued','processing','completed','failed')),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
    zero_progress_count INTEGER NOT NULL DEFAULT 0 CHECK(zero_progress_count >= 0),
    cursor_after_key TEXT NOT NULL DEFAULT '',
    processed_chunks INTEGER NOT NULL DEFAULT 0 CHECK(processed_chunks >= 0),
    written_chunks INTEGER NOT NULL DEFAULT 0 CHECK(written_chunks >= 0),
    remaining_chunks INTEGER,
    last_job_id TEXT REFERENCES knowledge_jobs(id) ON DELETE SET NULL,
    error TEXT,
    next_attempt_at TEXT,
    lease_owner TEXT,
    lease_token TEXT,
    lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
    lease_acquired_at TEXT,
    lease_expires_at TEXT,
    heartbeat_at TEXT,
    last_progress_at TEXT,
    runtime_metrics_json TEXT NOT NULL DEFAULT '{}',
    runtime_attestation_json TEXT NOT NULL DEFAULT '{}',
    runtime_attestation_sha256 TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY(run_id,document_id),
    FOREIGN KEY(document_id,space_id) REFERENCES knowledge_documents(id,space_id) ON DELETE CASCADE,
    FOREIGN KEY(knowledge_base_id,space_id) REFERENCES knowledge_bases(id,space_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS knowledge_backfill_items_dispatch
    ON knowledge_backfill_items(run_id,state,next_attempt_at,lease_expires_at,updated_at);
  CREATE TABLE IF NOT EXISTS knowledge_embedding_promotion_approvals (
    id TEXT PRIMARY KEY,
    backfill_run_id TEXT NOT NULL REFERENCES knowledge_backfill_runs(id) ON DELETE RESTRICT,
    knowledge_base_id TEXT,
    space_id TEXT,
    source_vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    target_vector_index_version TEXT NOT NULL REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT,
    corpus_manifest_sha256 TEXT NOT NULL CHECK(length(corpus_manifest_sha256)=64),
    gate_payload_json TEXT NOT NULL,
    gate_payload_sha256 TEXT NOT NULL CHECK(length(gate_payload_sha256)=64),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','revoked','consumed','expired')),
    artifact_sha256 TEXT UNIQUE CHECK(artifact_sha256 IS NULL OR length(artifact_sha256)=64),
    requested_by TEXT NOT NULL,
    approved_by TEXT,
    approval_reason TEXT,
    approved_at TEXT,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    CHECK((knowledge_base_id IS NULL AND space_id IS NULL) OR (knowledge_base_id IS NOT NULL AND space_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS knowledge_embedding_promotion_approval_scope
    ON knowledge_embedding_promotion_approvals(backfill_run_id,COALESCE(knowledge_base_id,''),gate_payload_sha256);
  CREATE TRIGGER IF NOT EXISTS knowledge_embedding_promotion_evidence_immutable
    BEFORE UPDATE OF backfill_run_id,knowledge_base_id,space_id,source_vector_index_version,target_vector_index_version,
      corpus_manifest_sha256,gate_payload_json,gate_payload_sha256,requested_by,expires_at,created_at
    ON knowledge_embedding_promotion_approvals
    WHEN NEW.backfill_run_id IS NOT OLD.backfill_run_id OR NEW.knowledge_base_id IS NOT OLD.knowledge_base_id
      OR NEW.space_id IS NOT OLD.space_id OR NEW.source_vector_index_version IS NOT OLD.source_vector_index_version
      OR NEW.target_vector_index_version IS NOT OLD.target_vector_index_version
      OR NEW.corpus_manifest_sha256 IS NOT OLD.corpus_manifest_sha256
      OR NEW.gate_payload_json IS NOT OLD.gate_payload_json OR NEW.gate_payload_sha256 IS NOT OLD.gate_payload_sha256
      OR NEW.requested_by IS NOT OLD.requested_by OR NEW.expires_at IS NOT OLD.expires_at
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Knowledge promotion request evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_embedding_promotion_delete_forbidden
    BEFORE DELETE ON knowledge_embedding_promotion_approvals
    BEGIN SELECT RAISE(ABORT,'Knowledge promotion approval history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_embedding_profiles_identity_immutable
    BEFORE UPDATE OF vector_index_version,provider,model,revision,dtype,dimensions ON knowledge_embedding_profiles
    WHEN NEW.vector_index_version IS NOT OLD.vector_index_version OR NEW.provider IS NOT OLD.provider
      OR NEW.model IS NOT OLD.model OR NEW.revision IS NOT OLD.revision OR NEW.dtype IS NOT OLD.dtype
      OR NEW.dimensions IS NOT OLD.dimensions
    BEGIN SELECT RAISE(ABORT,'Knowledge embedding profile identities are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_embedding_profiles_retirement_terminal
    BEFORE UPDATE OF state ON knowledge_embedding_profiles WHEN OLD.state='retired' AND NEW.state<>'retired'
    BEGIN SELECT RAISE(ABORT,'A retired knowledge embedding profile cannot be reactivated'); END;
  CREATE TRIGGER IF NOT EXISTS knowledge_embedding_profiles_delete_forbidden
    BEFORE DELETE ON knowledge_embedding_profiles
    BEGIN SELECT RAISE(ABORT,'Knowledge embedding profile identities cannot be deleted'); END;
`);
const knowledgeCleanupColumns = new Set((db.prepare('PRAGMA table_info(knowledge_file_cleanup)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeCleanupColumns.has('retry_at')) db.exec('ALTER TABLE knowledge_file_cleanup ADD COLUMN retry_at TEXT');
const knowledgeBackfillRunColumns = new Set((db.prepare('PRAGMA table_info(knowledge_backfill_runs)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeBackfillRunColumns.has('scope_space_id')) db.exec('ALTER TABLE knowledge_backfill_runs ADD COLUMN scope_space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE');
const knowledgeBackfillItemColumns = new Set((db.prepare('PRAGMA table_info(knowledge_backfill_items)').all() as Array<{ name: string }>).map((column) => column.name));
if (!knowledgeBackfillItemColumns.has('cursor_after_key')) db.exec("ALTER TABLE knowledge_backfill_items ADD COLUMN cursor_after_key TEXT NOT NULL DEFAULT ''");
if (!knowledgeBackfillItemColumns.has('processed_chunks')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN processed_chunks INTEGER NOT NULL DEFAULT 0');
if (!knowledgeBackfillItemColumns.has('written_chunks')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN written_chunks INTEGER NOT NULL DEFAULT 0');
if (!knowledgeBackfillItemColumns.has('remaining_chunks')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN remaining_chunks INTEGER');
if (!knowledgeBackfillItemColumns.has('next_attempt_at')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN next_attempt_at TEXT');
if (!knowledgeBackfillItemColumns.has('runtime_metrics_json')) db.exec("ALTER TABLE knowledge_backfill_items ADD COLUMN runtime_metrics_json TEXT NOT NULL DEFAULT '{}'");
if (!knowledgeBackfillItemColumns.has('source_index_version')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN source_index_version INTEGER NOT NULL DEFAULT 1');
if (!knowledgeBackfillItemColumns.has('source_chunker_version')) db.exec("ALTER TABLE knowledge_backfill_items ADD COLUMN source_chunker_version TEXT NOT NULL DEFAULT 'docling-hybrid-v1'");
if (!knowledgeBackfillItemColumns.has('source_embedding_profile_json')) db.exec(`ALTER TABLE knowledge_backfill_items ADD COLUMN source_embedding_profile_json TEXT NOT NULL DEFAULT '{"provider":"qwen-tei","model":"Qwen/Qwen3-Embedding-4B","revision":"5cf2132abc99cad020ac570b19d031efec650f2b","dtype":"float16","dimensions":2560,"vectorIndexVersion":"qwen-v1"}'`);
if (!knowledgeBackfillItemColumns.has('target_embedding_profile_json')) db.exec(`ALTER TABLE knowledge_backfill_items ADD COLUMN target_embedding_profile_json TEXT NOT NULL DEFAULT '{"provider":"gte-node","model":"Alibaba-NLP/gte-modernbert-base","revision":"e7f32e3c00f91d699e8c43b53106206bcc72bb22","dtype":"q8","dimensions":768,"vectorIndexVersion":"gte-modernbert-v1"}'`);
if (!knowledgeBackfillItemColumns.has('zero_progress_count')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN zero_progress_count INTEGER NOT NULL DEFAULT 0');
if (!knowledgeBackfillItemColumns.has('lease_owner')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN lease_owner TEXT');
if (!knowledgeBackfillItemColumns.has('lease_token')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN lease_token TEXT');
if (!knowledgeBackfillItemColumns.has('lease_generation')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0');
if (!knowledgeBackfillItemColumns.has('lease_acquired_at')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN lease_acquired_at TEXT');
if (!knowledgeBackfillItemColumns.has('lease_expires_at')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN lease_expires_at TEXT');
if (!knowledgeBackfillItemColumns.has('heartbeat_at')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN heartbeat_at TEXT');
if (!knowledgeBackfillItemColumns.has('last_progress_at')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN last_progress_at TEXT');
if (!knowledgeBackfillItemColumns.has('runtime_attestation_json')) db.exec("ALTER TABLE knowledge_backfill_items ADD COLUMN runtime_attestation_json TEXT NOT NULL DEFAULT '{}'");
if (!knowledgeBackfillItemColumns.has('runtime_attestation_sha256')) db.exec('ALTER TABLE knowledge_backfill_items ADD COLUMN runtime_attestation_sha256 TEXT');
db.prepare(`UPDATE knowledge_backfill_items SET source_index_version=(SELECT index_version FROM knowledge_documents
    WHERE knowledge_documents.id=knowledge_backfill_items.document_id),source_chunker_version=(SELECT chunker_version
      FROM knowledge_bases WHERE knowledge_bases.id=knowledge_backfill_items.knowledge_base_id
        AND knowledge_bases.space_id=knowledge_backfill_items.space_id)
  WHERE source_index_version=1 OR source_chunker_version='docling-hybrid-v1'`).run();
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_backfill_one_active
  ON knowledge_backfill_runs(source_vector_index_version,target_vector_index_version,COALESCE(scope_space_id,''))
  WHERE state IN ('queued','running','paused')`);

const now = new Date().toISOString();
const insertProfile = db.prepare(`INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(vector_index_version) DO NOTHING`);
insertProfile.run(qwenKnowledgeEmbeddingProfile.vectorIndexVersion, qwenKnowledgeEmbeddingProfile.provider,
  qwenKnowledgeEmbeddingProfile.model, qwenKnowledgeEmbeddingProfile.revision, qwenKnowledgeEmbeddingProfile.dtype,
  qwenKnowledgeEmbeddingProfile.dimensions, 'configured', now, now);
insertProfile.run(gteKnowledgeEmbeddingProfile.vectorIndexVersion, gteKnowledgeEmbeddingProfile.provider,
  gteKnowledgeEmbeddingProfile.model, gteKnowledgeEmbeddingProfile.revision, gteKnowledgeEmbeddingProfile.dtype,
  gteKnowledgeEmbeddingProfile.dimensions, 'disabled', now, now);
assertKnowledgeEmbeddingProfileIdentity(qwenKnowledgeEmbeddingProfile);
assertKnowledgeEmbeddingProfileIdentity(gteKnowledgeEmbeddingProfile);
db.prepare(`INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
  VALUES (?,?,?,?,?,?,'configured',?,?)
  ON CONFLICT(vector_index_version) DO NOTHING`)
  .run(config.knowledgeVectorIndexVersion, config.knowledgeEmbeddingProvider, config.knowledgeEmbeddingModel,
    config.knowledgeEmbeddingRevision, config.knowledgeEmbeddingDtype, config.knowledgeEmbeddingDimension, now, now);
assertKnowledgeEmbeddingProfileIdentity(config.knowledgeEmbeddingProfile);
db.prepare("UPDATE knowledge_embedding_profiles SET state='configured',updated_at=? WHERE vector_index_version=?")
  .run(now, config.knowledgeVectorIndexVersion);
db.prepare(`INSERT INTO knowledge_base_embedding_profiles
  (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,error,last_indexed_at,created_at,updated_at)
  SELECT space_id,id,vector_index_version,'primary',
    CASE WHEN status='ready' THEN 'ready' WHEN status='indexing' THEN 'indexing'
      WHEN status='degraded' THEN 'degraded' WHEN status IN ('deleting','deleted') THEN 'disabled' ELSE 'empty' END,
    current_version,NULL,last_indexed_at,created_at,updated_at FROM knowledge_bases WHERE 1=1
  ON CONFLICT(knowledge_base_id,vector_index_version) DO NOTHING`).run();
db.prepare(`INSERT INTO knowledge_document_embeddings
  (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,chunk_count,last_job_id,error,indexed_at,created_at,updated_at)
  SELECT d.space_id,d.knowledge_base_id,d.id,b.vector_index_version,d.sha256,d.index_version,
    CASE WHEN d.state='ready' THEN 'ready' WHEN d.state IN ('extracting','indexing') THEN 'indexing'
      WHEN d.state='failed' THEN 'failed' WHEN d.state='deleting' THEN 'deleting'
      WHEN d.state='deleted' THEN 'deleted' ELSE 'queued' END,
    d.chunk_count,NULL,d.error,d.indexed_at,d.created_at,d.updated_at
  FROM knowledge_documents d JOIN knowledge_bases b ON b.id=d.knowledge_base_id AND b.space_id=d.space_id WHERE 1=1
  ON CONFLICT(document_id,vector_index_version) DO NOTHING`).run();
db.prepare(`UPDATE knowledge_jobs SET embedding_profile_id=(
  SELECT vector_index_version FROM knowledge_bases WHERE knowledge_bases.id=knowledge_jobs.knowledge_base_id
    AND knowledge_bases.space_id=knowledge_jobs.space_id) WHERE embedding_profile_id IS NULL`).run();
}
const activeProfileConfiguredAt = new Date().toISOString();
assertKnowledgeEmbeddingProfileIdentity(qwenKnowledgeEmbeddingProfile);
assertKnowledgeEmbeddingProfileIdentity(gteKnowledgeEmbeddingProfile);
db.prepare(`INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
  VALUES (?,?,?,?,?,?,'configured',?,?)
  ON CONFLICT(vector_index_version) DO NOTHING`)
  .run(config.knowledgeVectorIndexVersion, config.knowledgeEmbeddingProvider, config.knowledgeEmbeddingModel,
    config.knowledgeEmbeddingRevision, config.knowledgeEmbeddingDtype, config.knowledgeEmbeddingDimension,
    activeProfileConfiguredAt, activeProfileConfiguredAt);
assertKnowledgeEmbeddingProfileIdentity(config.knowledgeEmbeddingProfile);
db.prepare("UPDATE knowledge_embedding_profiles SET state='configured',updated_at=? WHERE vector_index_version=?")
  .run(activeProfileConfiguredAt, config.knowledgeVectorIndexVersion);
if (config.knowledgeEmbeddingDualWrite) {
  const configureProfile = db.prepare(`INSERT INTO knowledge_embedding_profiles
    (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'configured',?,?)
    ON CONFLICT(vector_index_version) DO NOTHING`);
  for (const profile of [qwenKnowledgeEmbeddingProfile, gteKnowledgeEmbeddingProfile]) {
    configureProfile.run(profile.vectorIndexVersion, profile.provider, profile.model, profile.revision,
      profile.dtype, profile.dimensions, activeProfileConfiguredAt, activeProfileConfiguredAt);
    assertKnowledgeEmbeddingProfileIdentity(profile);
    db.prepare("UPDATE knowledge_embedding_profiles SET state='configured',updated_at=? WHERE vector_index_version=?")
      .run(activeProfileConfiguredAt, profile.vectorIndexVersion);
  }
  db.prepare(`INSERT INTO knowledge_base_embedding_profiles
    (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,created_at,updated_at)
    SELECT space_id,id,CASE WHEN embedding_provider='gte-node' THEN ? ELSE ? END,'dual_write','empty',0,?,?
    FROM knowledge_bases WHERE deleted_at IS NULL
    ON CONFLICT(knowledge_base_id,vector_index_version) DO NOTHING`)
    .run(qwenKnowledgeEmbeddingProfile.vectorIndexVersion, gteKnowledgeEmbeddingProfile.vectorIndexVersion,
      activeProfileConfiguredAt, activeProfileConfiguredAt);
}
db.prepare(`UPDATE knowledge_file_cleanup SET state='pending',retry_at=NULL,updated_at=? WHERE state='processing'`)
  .run(new Date().toISOString());

export function recoverKnowledgeJobs() {
  const recoveredAt = new Date().toISOString();
  const recovered = db.prepare(`UPDATE knowledge_jobs SET state='queued',stage='recovered_after_restart',progress=0,
    started_at=NULL,retry_at=NULL,lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,
    heartbeat_at=NULL,updated_at=? WHERE state='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
    .run(recoveredAt, recoveredAt).changes;
  db.prepare(`UPDATE knowledge_documents SET state=CASE
      WHEN index_version>0 AND EXISTS (SELECT 1 FROM knowledge_jobs j
        WHERE j.document_id=knowledge_documents.id AND j.state='queued' AND j.kind='document.reindex') THEN 'ready'
      ELSE 'queued' END,updated_at=?
    WHERE state IN ('extracting','indexing') AND EXISTS (
      SELECT 1 FROM knowledge_jobs j WHERE j.document_id=knowledge_documents.id AND j.state='queued'
    )`).run(recoveredAt);
  db.prepare(`UPDATE knowledge_document_embeddings SET state=CASE WHEN index_version>0 THEN 'ready' ELSE 'queued' END,
    updated_at=? WHERE state='indexing' AND EXISTS (
      SELECT 1 FROM knowledge_jobs j WHERE j.id=knowledge_document_embeddings.last_job_id AND j.state='queued'
    )`).run(recoveredAt);
  return recovered;
}
recoverKnowledgeJobs();

function embeddingProfileFromRow(row: any): KnowledgeEmbeddingProfile {
  const profile = {
    provider: row.registry_provider ?? row.provider ?? row.embedding_provider,
    model: row.registry_model ?? row.model ?? row.embedding_model,
    revision: row.registry_revision ?? row.revision ?? row.embedding_revision,
    dtype: row.registry_dtype ?? row.dtype ?? row.embedding_dtype,
    dimensions: Number(row.registry_dimensions ?? row.dimensions ?? row.embedding_dimension),
    vectorIndexVersion: row.vector_index_version
  } as KnowledgeEmbeddingProfile;
  if (!isKnowledgeEmbeddingProfile(profile)) {
    throw new Error(`Knowledge embedding profile ${String(row.vector_index_version || 'unknown')} is corrupt.`);
  }
  const pinned = profile.provider === 'gte-node' ? gteKnowledgeEmbeddingProfile : qwenKnowledgeEmbeddingProfile;
  if (JSON.stringify(profile) !== JSON.stringify(pinned)) {
    throw new Error(`Knowledge embedding profile ${profile.vectorIndexVersion} is not the pinned registry identity.`);
  }
  return profile;
}

function rowEmbeddingProfile(row: any): KnowledgeEmbeddingProfileRecord {
  return {
    ...embeddingProfileFromRow(row),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listKnowledgeEmbeddingProfiles() {
  return (db.prepare(`SELECT provider,model,revision,dtype,dimensions,vector_index_version,state,created_at,updated_at
    FROM knowledge_embedding_profiles ORDER BY created_at,vector_index_version`).all() as any[]).map(rowEmbeddingProfile);
}

export function getKnowledgeEmbeddingProfile(vectorIndexVersion: string) {
  const row = db.prepare(`SELECT provider,model,revision,dtype,dimensions,vector_index_version,state,created_at,updated_at
    FROM knowledge_embedding_profiles WHERE vector_index_version=?`).get(vectorIndexVersion) as any;
  return row ? rowEmbeddingProfile(row) : null;
}

export function knowledgeBaseEmbeddingProfiles(knowledgeBaseId: string, spaceId: string) {
  const rows = db.prepare(`SELECT m.*,p.provider,p.model,p.revision,p.dtype,p.dimensions,p.state profile_state
    FROM knowledge_base_embedding_profiles m JOIN knowledge_embedding_profiles p
      ON p.vector_index_version=m.vector_index_version
    WHERE m.knowledge_base_id=? AND m.space_id=?
    ORDER BY CASE m.mode WHEN 'primary' THEN 0 WHEN 'dual_write' THEN 1 WHEN 'shadow' THEN 2 ELSE 3 END,
      m.created_at,m.vector_index_version`).all(knowledgeBaseId, spaceId) as any[];
  return rows.map((row): KnowledgeBaseEmbeddingProfileRecord => ({
    spaceId: row.space_id,
    knowledgeBaseId: row.knowledge_base_id,
    mode: row.mode,
    state: row.state,
    currentVersion: Number(row.current_version || 0),
    error: row.error,
    lastIndexedAt: row.last_indexed_at,
    profileState: row.profile_state,
    embeddingProfile: embeddingProfileFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function knowledgeBaseTargetEmbeddingProfiles(knowledgeBaseId: string, spaceId: string) {
  return knowledgeBaseEmbeddingProfiles(knowledgeBaseId, spaceId)
    .filter((item) => item.mode === 'primary' || item.mode === 'dual_write')
    .filter((item) => item.state !== 'disabled' && item.profileState === 'configured')
    .map((item) => item.embeddingProfile);
}

function rowBase(row: any): KnowledgeBaseRecord {
  const embeddingProfile = config.knowledgeEmbeddingForceQwen
    ? { ...qwenKnowledgeEmbeddingProfile }
    : embeddingProfileFromRow(row);
  return {
    id: row.id, spaceId: row.space_id, name: row.name, description: row.description, privacy: row.privacy === 'private' ? 'private' : 'space',
    status: row.status, allowTerraContext: Boolean(row.allow_terra_context), embeddingProfile,
    embeddingModel: embeddingProfile.model, embeddingDimension: embeddingProfile.dimensions, chunkerVersion: row.chunker_version,
    currentVersion: Number(row.current_version), documentCount: Number(row.document_count || 0),
    readyDocumentCount: Number(row.ready_document_count || 0), chunkCount: Number(row.chunk_count || 0),
    entityCount: Number(row.entity_count || 0), relationshipCount: Number(row.relationship_count || 0),
    storageBytes: Number(row.storage_bytes || 0), createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, lastIndexedAt: row.last_indexed_at, deletedAt: row.deleted_at
  };
}

const baseSelect = `SELECT b.*,
  MAX(profile.provider) registry_provider,MAX(profile.model) registry_model,
  MAX(profile.revision) registry_revision,MAX(profile.dtype) registry_dtype,
  MAX(profile.dimensions) registry_dimensions,
  COUNT(DISTINCT CASE WHEN d.deleted_at IS NULL THEN d.id END) document_count,
  COUNT(DISTINCT CASE WHEN d.state='ready' AND d.deleted_at IS NULL THEN d.id END) ready_document_count,
  COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.chunk_count ELSE 0 END),0) chunk_count,
  COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.entity_count ELSE 0 END),0) entity_count
  ,COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.relationship_count ELSE 0 END),0) relationship_count
  ,COALESCE(SUM(CASE WHEN d.deleted_at IS NULL THEN d.size_bytes ELSE 0 END),0) storage_bytes
  FROM knowledge_bases b JOIN knowledge_embedding_profiles profile ON profile.vector_index_version=b.vector_index_version
  LEFT JOIN knowledge_documents d ON d.knowledge_base_id=b.id`;

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

/**
 * Serialize embedding-profile switches with durable job creation. Callers
 * must invoke this inside a database transaction and acquire multiple bases
 * in stable ID order.
 */
export function lockKnowledgeBaseEmbeddingMutation(id: string, spaceId: string) {
  if (db.provider === 'postgres') {
    db.prepare('SELECT id FROM knowledge_bases WHERE id=? AND space_id=? FOR UPDATE').get(id, spaceId);
  } else {
    // A no-op write obtains SQLite's writer lock before the profile snapshot is
    // checked, preventing two local processes from switching/enqueueing at once.
    db.prepare('UPDATE knowledge_bases SET updated_at=updated_at WHERE id=? AND space_id=?').run(id, spaceId);
  }
  return getKnowledgeBase(id, spaceId, true);
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
  db.transaction(() => {
    db.prepare(`INSERT INTO knowledge_bases
      (id,space_id,name,description,privacy,status,allow_terra_context,embedding_provider,embedding_model,embedding_revision,
        embedding_dtype,embedding_dimension,vector_index_version,chunker_version,current_version,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,'empty',?,?,?,?,?,?,?,?,0,?,?,?)`).run(id, spaceId, input.name.trim(), input.description?.trim() || '', input.privacy || 'space',
        input.allowTerraContext ? 1 : 0, config.knowledgeEmbeddingProvider, config.knowledgeEmbeddingModel,
        config.knowledgeEmbeddingRevision, config.knowledgeEmbeddingDtype, config.knowledgeEmbeddingDimension,
        config.knowledgeVectorIndexVersion, config.knowledgeChunkerVersion, userId, now, now);
    db.prepare(`INSERT INTO knowledge_base_embedding_profiles
      (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,created_at,updated_at)
      VALUES (?,?,?,'primary','empty',0,?,?)`).run(spaceId, id, config.knowledgeVectorIndexVersion, now, now);
    if (config.knowledgeEmbeddingDualWrite) {
      const secondary = config.knowledgeEmbeddingProvider === 'gte-node'
        ? qwenKnowledgeEmbeddingProfile : gteKnowledgeEmbeddingProfile;
      db.prepare(`INSERT INTO knowledge_base_embedding_profiles
        (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,created_at,updated_at)
        VALUES (?,?,?,'dual_write','empty',0,?,?)`).run(spaceId, id, secondary.vectorIndexVersion, now, now);
    }
    auditKnowledge({ spaceId, knowledgeBaseId: id, actorUserId: userId, action: 'knowledge_base.created',
      detail: { allowTerraContext: Boolean(input.allowTerraContext), embeddingProfile: config.knowledgeEmbeddingProfile } });
  })();
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
    targetVersion: row.target_version == null ? null : Number(row.target_version),
    embeddingProfileId: row.embedding_profile_id || null, input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, null), error: row.error, retryAt: row.retry_at, createdAt: row.created_at,
    startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at,
    leaseOwner: row.lease_owner || null, leaseToken: row.lease_token || null,
    leaseGeneration: Number(row.lease_generation || 0), leaseAcquiredAt: row.lease_acquired_at || null,
    leaseExpiresAt: row.lease_expires_at || null, heartbeatAt: row.heartbeat_at || null
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}

const internalKnowledgeJobInputKeys = new Set(['embeddingProfile', 'targetEmbeddingProfiles', 'dualWrite']);

function knowledgeJobIntent(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !internalKnowledgeJobInputKeys.has(key)));
}

function isKnowledgeEmbeddingProfile(value: unknown): value is KnowledgeEmbeddingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.provider === 'qwen-tei' || item.provider === 'gte-node')
    && typeof item.model === 'string' && Boolean(item.model.trim())
    && typeof item.revision === 'string' && /^[a-f0-9]{40}$/u.test(item.revision)
    && typeof item.dtype === 'string' && Boolean(item.dtype.trim())
    && typeof item.dimensions === 'number' && Number.isSafeInteger(item.dimensions)
    && item.dimensions >= 128 && item.dimensions <= 8192
    && typeof item.vectorIndexVersion === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/u.test(item.vectorIndexVersion);
}

function snapshotKnowledgeJobValues(base: KnowledgeBaseRecord, values: Record<string, unknown> = {}) {
  const configuredTargets = knowledgeBaseTargetEmbeddingProfiles(base.id, base.spaceId);
  if (!configuredTargets.some((profile) => profile.vectorIndexVersion === base.embeddingProfile.vectorIndexVersion)) {
    throw new KnowledgeError('The primary embedding profile is disabled or unavailable.',
      409, 'KNOWLEDGE_EMBEDDING_PROFILE_DISABLED');
  }
  const qwenRollbackRequired = config.knowledgeQwenRollbackRetained && base.embeddingProfile.provider === 'gte-node';
  const targets = config.knowledgeEmbeddingDualWrite || qwenRollbackRequired
    ? configuredTargets
    : configuredTargets.filter((profile) => profile.vectorIndexVersion === base.embeddingProfile.vectorIndexVersion);
  if (qwenRollbackRequired && !targets.some((profile) => profile.provider === 'qwen-tei')) {
    throw new KnowledgeError('GTE indexing cannot start until the retained Qwen rollback profile is assigned for dual-write.',
      409, 'KNOWLEDGE_QWEN_ROLLBACK_PROFILE_MISSING');
  }
  const targetEmbeddingProfiles = targets.length ? targets : [base.embeddingProfile];
  const embeddingProfile = targetEmbeddingProfiles.find((profile) =>
    profile.vectorIndexVersion === base.embeddingProfile.vectorIndexVersion) || base.embeddingProfile;
  return {
    ...values,
    embeddingProfile,
    targetEmbeddingProfiles,
    dualWrite: targetEmbeddingProfiles.length > 1
  };
}

export function knowledgeJobEmbeddingSnapshot(job: KnowledgeJobRecord, base?: KnowledgeBaseRecord) {
  const currentBase = base || getKnowledgeBase(job.knowledgeBaseId, job.spaceId, true);
  if (!currentBase) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  const primary = job.input.embeddingProfile === undefined ? currentBase.embeddingProfile : job.input.embeddingProfile;
  const targets = job.input.targetEmbeddingProfiles === undefined ? [primary] : job.input.targetEmbeddingProfiles;
  if (!isKnowledgeEmbeddingProfile(primary) || !Array.isArray(targets) || !targets.length
      || targets.length > 4 || targets.some((profile) => !isKnowledgeEmbeddingProfile(profile))) {
    throw new KnowledgeError('The queued embedding profile snapshot is invalid.', 409, 'KNOWLEDGE_EMBEDDING_SNAPSHOT_INVALID');
  }
  const targetEmbeddingProfiles = targets as KnowledgeEmbeddingProfile[];
  if (!targetEmbeddingProfiles.some((profile) => profile.vectorIndexVersion === primary.vectorIndexVersion)
      || new Set(targetEmbeddingProfiles.map((profile) => profile.vectorIndexVersion)).size !== targetEmbeddingProfiles.length
      || (job.embeddingProfileId && job.embeddingProfileId !== primary.vectorIndexVersion)) {
    throw new KnowledgeError('The queued embedding profile snapshot is inconsistent.', 409, 'KNOWLEDGE_EMBEDDING_SNAPSHOT_INVALID');
  }
  return {
    embeddingProfile: primary,
    targetEmbeddingProfiles,
    dualWrite: job.input.dualWrite === true && targetEmbeddingProfiles.length > 1
  };
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
    && JSON.stringify(canonicalValue(knowledgeJobIntent(parseJson(row.input_json, {}))))
      === JSON.stringify(canonicalValue(knowledgeJobIntent(input.values || {})));
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

export function assertKnowledgeStorageAllowance(spaceId: string, additionalBytes: number) {
  const current = knowledgeSpaceBytes(spaceId);
  if (current + additionalBytes > config.knowledgeMaxSpaceBytes) {
    throw new KnowledgeError('This space has reached its knowledge storage allowance.', 413, 'KNOWLEDGE_SPACE_QUOTA');
  }
  try {
    return assertSubscriptionQuota(spaceId, 'knowledgeStorageBytes', current, additionalBytes);
  } catch (error) {
    if (error instanceof SubscriptionEntitlementError && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED') {
      throw new KnowledgeError('This space has reached its plan knowledge storage allowance.', 413, 'KNOWLEDGE_PLAN_STORAGE_QUOTA');
    }
    throw error;
  }
}

function insertKnowledgeJob(input: {
  spaceId: string; knowledgeBaseId: string; documentId?: string | null; requestedBy?: string | null;
  kind: KnowledgeJobKind; idempotencyKey?: string | null; values?: Record<string, unknown>;
}) {
  const replay = idempotentKnowledgeJob(input);
  if (replay) return replay;
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const profile = input.values?.embeddingProfile;
  const lockedBase = lockKnowledgeBaseEmbeddingMutation(input.knowledgeBaseId, input.spaceId);
  if (!lockedBase) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  if (!isKnowledgeEmbeddingProfile(profile)
      || profile.vectorIndexVersion !== lockedBase.embeddingProfile.vectorIndexVersion) {
    throw new KnowledgeError('The knowledge base embedding profile changed while this job was being queued. Retry the operation.',
      409, 'KNOWLEDGE_EMBEDDING_SWITCH_RACE');
  }
  const embeddingProfileId = isKnowledgeEmbeddingProfile(profile) ? profile.vectorIndexVersion : null;
  db.prepare(`INSERT INTO knowledge_jobs
    (id,space_id,knowledge_base_id,document_id,requested_by,kind,state,stage,progress,attempt,max_attempts,embedding_profile_id,
      idempotency_key,input_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'queued','queued',0,0,3,?,?,?,?,?)`).run(id, input.spaceId, input.knowledgeBaseId,
      input.documentId || null, input.requestedBy || null, input.kind, embeddingProfileId, input.idempotencyKey || null,
      JSON.stringify(input.values || {}), now, now);
  auditKnowledge({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: input.documentId,
    jobId: id, actorUserId: input.requestedBy, action: 'knowledge_job.queued', detail: { kind: input.kind } });
  return getKnowledgeJob(id)!;
}

function lockKnowledgeJobLease(job: KnowledgeJobRecord) {
  const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM knowledge_jobs WHERE id=?${lock}`).get(job.id) as any;
  const now = new Date().toISOString();
  if (!row || row.state !== 'processing' || !job.leaseOwner || !job.leaseToken
      || row.lease_owner !== job.leaseOwner || row.lease_token !== job.leaseToken
      || Number(row.lease_generation || 0) !== job.leaseGeneration
      || !row.lease_expires_at || row.lease_expires_at <= now) {
    throw new KnowledgeError('The knowledge job lease is no longer owned by this worker.',
      409, 'KNOWLEDGE_JOB_LEASE_LOST');
  }
  return rowJob(row);
}

export function heartbeatKnowledgeJobLease(job: KnowledgeJobRecord) {
  if (!job.leaseOwner || !job.leaseToken) return false;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.knowledgeWorkerLeaseMs).toISOString();
  return db.prepare(`UPDATE knowledge_jobs SET heartbeat_at=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND state='processing' AND lease_owner=? AND lease_token=? AND lease_generation=?
      AND lease_expires_at>?`).run(now, expiresAt, now, job.id, job.leaseOwner, job.leaseToken,
        job.leaseGeneration, now).changes === 1;
}

function queueDocumentEmbeddingTargets(document: KnowledgeDocumentRecord, job: KnowledgeJobRecord) {
  const snapshot = knowledgeJobEmbeddingSnapshot(job);
  const now = new Date().toISOString();
  const statement = db.prepare(`INSERT INTO knowledge_document_embeddings
    (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,chunk_count,last_job_id,error,indexed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,0,'queued',0,?,NULL,NULL,?,?)
    ON CONFLICT(document_id,vector_index_version) DO UPDATE SET source_sha256=excluded.source_sha256,
      state='queued',last_job_id=excluded.last_job_id,error=NULL,updated_at=excluded.updated_at`);
  for (const profile of snapshot.targetEmbeddingProfiles) {
    statement.run(document.spaceId, document.knowledgeBaseId, document.id, profile.vectorIndexVersion,
      document.sha256, job.id, now, now);
    db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='queued',error=NULL,updated_at=?
      WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=? AND state<>'disabled'`)
      .run(now, document.knowledgeBaseId, document.spaceId, profile.vectorIndexVersion);
  }
}

export function createKnowledgeDocument(input: {
  spaceId: string; knowledgeBaseId: string; userId: string; storedFilename: string; originalName: string;
  mimeType: string; sizeBytes: number; sha256: string; metadata?: Record<string, unknown>; idempotencyKey?: string;
}) {
  const base = getKnowledgeBase(input.knowledgeBaseId, input.spaceId);
  if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  if (base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const jobValues = snapshotKnowledgeJobValues(base,
    { metadata: input.metadata || {}, sha256: input.sha256, mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  const replay = idempotentKnowledgeJob({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId,
    requestedBy: input.userId, kind: 'document.index', idempotencyKey: input.idempotencyKey,
    values: jobValues, acceptAnyDocument: true });
  if (replay?.documentId) {
    const document = getKnowledgeDocument(replay.documentId, input.knowledgeBaseId, input.spaceId, true);
    if (!document) throw new KnowledgeError('The original idempotent upload is no longer available.', 409, 'KNOWLEDGE_IDEMPOTENCY_ORPHANED');
    return { document, job: replay, deduplicated: true };
  }
  const existing = db.prepare(`SELECT * FROM knowledge_documents WHERE knowledge_base_id=? AND space_id=?
    AND sha256=? AND deleted_at IS NULL`).get(input.knowledgeBaseId, input.spaceId, input.sha256) as any;
  if (existing) {
    const active = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`)
      .get(existing.id) as any;
    return { document: rowDocument(existing), job: active ? rowJob(active) : null, deduplicated: true };
  }
  return db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    assertKnowledgeStorageAllowance(input.spaceId, input.sizeBytes);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    db.prepare(`INSERT INTO knowledge_documents
      (id,space_id,knowledge_base_id,created_by,stored_filename,original_name,mime_type,size_bytes,sha256,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(id, input.spaceId, input.knowledgeBaseId, input.userId,
        input.storedFilename, input.originalName, input.mimeType, input.sizeBytes, input.sha256, now, now);
    db.prepare(`UPDATE knowledge_bases SET status='indexing',updated_at=? WHERE id=? AND space_id=?`).run(now, input.knowledgeBaseId, input.spaceId);
    const job = insertKnowledgeJob({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: id,
      requestedBy: input.userId, kind: 'document.index', idempotencyKey: input.idempotencyKey,
      values: jobValues });
    const document = getKnowledgeDocument(id, input.knowledgeBaseId, input.spaceId)!;
    queueDocumentEmbeddingTargets(document, job);
    auditKnowledge({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: id,
      actorUserId: input.userId, action: 'knowledge_document.uploaded', detail: { sha256: input.sha256, sizeBytes: input.sizeBytes } });
    return { document, job, deduplicated: false };
  })();
}

export const createKnowledgeDocuments = db.transaction((inputs: Parameters<typeof createKnowledgeDocument>[0][]) =>
  inputs.map((input) => createKnowledgeDocument(input)));

/**
 * Stage a server-generated Markdown document through the same durable indexing
 * path as an uploaded document. Callers must supply derived content only; this
 * helper deliberately does not bypass storage quotas, document deduplication,
 * embedding-profile snapshots, jobs, or knowledge audit events.
 */
export function createKnowledgeMarkdownDocument(input: {
  spaceId: string; knowledgeBaseId: string; userId: string; originalName: string;
  markdown: string; metadata?: Record<string, unknown>;
}) {
  const bytes = Buffer.from(input.markdown, 'utf8');
  if (!bytes.length) throw new KnowledgeError('Generated knowledge content cannot be empty.', 400, 'KNOWLEDGE_DOCUMENT_EMPTY');
  if (bytes.length > config.knowledgeMaxDocumentBytes) {
    throw new KnowledgeError('The generated knowledge document exceeds the document size limit.', 413, 'KNOWLEDGE_DOCUMENT_TOO_LARGE');
  }
  const originalBase = path.basename(input.originalName).replace(/[\r\n]/gu, ' ').trim().slice(0, 252) || 'Derived intelligence';
  const originalName = originalBase.toLowerCase().endsWith('.md') ? originalBase : `${originalBase}.md`;
  const storedFilename = `${crypto.randomUUID()}.md`;
  const stagedPath = path.resolve(config.knowledgeStorageDir, storedFilename);
  const storageRoot = `${path.resolve(config.knowledgeStorageDir)}${path.sep}`.toLowerCase();
  if (!stagedPath.toLowerCase().startsWith(storageRoot)) {
    throw new KnowledgeError('The generated knowledge storage path is invalid.', 500, 'KNOWLEDGE_STORAGE_PATH_INVALID');
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(stagedPath, bytes, { flag: 'wx' });
  try {
    const created = createKnowledgeDocument({
      spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, userId: input.userId,
      storedFilename, originalName, mimeType: 'text/markdown', sizeBytes: bytes.length, sha256,
      metadata: input.metadata || {}
    });
    if (created.deduplicated) fs.rmSync(stagedPath, { force: true });
    return { ...created, sha256 };
  } catch (error) {
    fs.rmSync(stagedPath, { force: true });
    // A concurrent publisher may have committed the identical immutable
    // artifact after our preflight but before our insert. Resolve that race as
    // a normal deduplicated publication rather than surfacing a transient
    // unique-constraint failure.
    const existing = db.prepare(`SELECT * FROM knowledge_documents WHERE knowledge_base_id=? AND space_id=?
      AND sha256=? AND deleted_at IS NULL`).get(input.knowledgeBaseId, input.spaceId, sha256) as any;
    if (existing) {
      const active = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing')
        ORDER BY created_at LIMIT 1`).get(existing.id) as any;
      return { document: rowDocument(existing), job: active ? rowJob(active) : null, deduplicated: true, sha256 };
    }
    throw error;
  }
}

/**
 * Stage trusted, server-produced bytes through the normal knowledge indexing
 * pipeline. The caller is responsible for authorizing the source artifact;
 * quotas, deduplication, immutable hashing, jobs, and audit remain enforced here.
 */
export function createKnowledgeBinaryDocument(input: {
  spaceId: string; knowledgeBaseId: string; userId: string; originalName: string;
  mimeType: string; bytes: Buffer; metadata?: Record<string, unknown>; idempotencyKey?: string;
}) {
  if (!input.bytes.length) throw new KnowledgeError('Generated knowledge content cannot be empty.', 400, 'KNOWLEDGE_DOCUMENT_EMPTY');
  if (input.bytes.length > config.knowledgeMaxDocumentBytes) {
    throw new KnowledgeError('The generated knowledge document exceeds the document size limit.', 413, 'KNOWLEDGE_DOCUMENT_TOO_LARGE');
  }
  const safeBase = path.basename(input.originalName).replace(/[\r\n]/gu, ' ').trim().slice(0, 252) || 'Signed agreement.pdf';
  const extension = path.extname(safeBase).toLowerCase();
  const originalName = extension ? safeBase : `${safeBase}.pdf`;
  const storedFilename = `${crypto.randomUUID()}${extension || '.pdf'}`;
  const stagedPath = path.resolve(config.knowledgeStorageDir, storedFilename);
  const storageRoot = `${path.resolve(config.knowledgeStorageDir)}${path.sep}`.toLowerCase();
  if (!stagedPath.toLowerCase().startsWith(storageRoot)) {
    throw new KnowledgeError('The generated knowledge storage path is invalid.', 500, 'KNOWLEDGE_STORAGE_PATH_INVALID');
  }
  const sha256 = crypto.createHash('sha256').update(input.bytes).digest('hex');
  fs.writeFileSync(stagedPath, input.bytes, { flag: 'wx' });
  try {
    const created = createKnowledgeDocument({
      spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, userId: input.userId,
      storedFilename, originalName, mimeType: input.mimeType, sizeBytes: input.bytes.length, sha256,
      metadata: input.metadata || {}, idempotencyKey: input.idempotencyKey
    });
    if (created.deduplicated) fs.rmSync(stagedPath, { force: true });
    return { ...created, sha256 };
  } catch (error) {
    fs.rmSync(stagedPath, { force: true });
    throw error;
  }
}

export function queueKnowledgeDocumentReindex(documentId: string, knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
    kind: 'document.reindex', idempotencyKey, values: {} });
  if (replay) return { job: replay, deduplicated: true };
  const document = getKnowledgeDocument(documentId, knowledgeBaseId, spaceId);
  if (!document) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base || base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const jobValues = snapshotKnowledgeJobValues(base);
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
    const job = insertKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
      kind: 'document.reindex', idempotencyKey, values: jobValues });
    queueDocumentEmbeddingTargets(document, job);
    return { job, deduplicated: false };
  })();
}

export function queueKnowledgeDocumentDelete(documentId: string, knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
    kind: 'document.delete', idempotencyKey, values: {} });
  if (replay) return replay;
  const document = getKnowledgeDocument(documentId, knowledgeBaseId, spaceId);
  if (!document) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base || base.status === 'deleting') throw new KnowledgeError('This knowledge base is being deleted.', 409, 'KNOWLEDGE_BASE_DELETING');
  const jobValues = snapshotKnowledgeJobValues(base);
  const existing = db.prepare(`SELECT * FROM knowledge_jobs WHERE document_id=? AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`).get(documentId) as any;
  if (existing) throw new KnowledgeError('This document already has active indexing work.', 409, 'KNOWLEDGE_DOCUMENT_BUSY');
  return db.transaction(() => {
    db.prepare(`UPDATE knowledge_documents SET state='deleting',updated_at=? WHERE id=? AND space_id=?`)
      .run(new Date().toISOString(), documentId, spaceId);
    return insertKnowledgeJob({ spaceId, knowledgeBaseId, documentId, requestedBy: userId,
      kind: 'document.delete', idempotencyKey, values: jobValues });
  })();
}

export function queueKnowledgeBaseDelete(knowledgeBaseId: string, spaceId: string, userId: string, idempotencyKey?: string) {
  const replay = idempotentKnowledgeJob({ spaceId, knowledgeBaseId, documentId: null, requestedBy: userId,
    kind: 'base.delete', idempotencyKey, values: {} });
  if (replay) return { job: replay, deduplicated: true };
  const base = getKnowledgeBase(knowledgeBaseId, spaceId);
  if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  const jobValues = snapshotKnowledgeJobValues(base);
  const existing = db.prepare(`SELECT * FROM knowledge_jobs WHERE knowledge_base_id=? AND kind='base.delete'
    AND state IN ('queued','processing') ORDER BY created_at LIMIT 1`).get(knowledgeBaseId) as any;
  if (existing) return { job: rowJob(existing), deduplicated: true };
  return db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE knowledge_jobs SET state='cancelled',stage='cancelled_by_base_delete',progress=100,error='Knowledge base deletion superseded this job.',completed_at=?,updated_at=?
      WHERE knowledge_base_id=? AND state='queued'`).run(now, now, knowledgeBaseId);
    db.prepare(`UPDATE knowledge_bases SET status='deleting',updated_at=? WHERE id=? AND space_id=?`).run(now, knowledgeBaseId, spaceId);
    const job = insertKnowledgeJob({ spaceId, knowledgeBaseId, requestedBy: userId, kind: 'base.delete', idempotencyKey,
      values: jobValues });
    return { job, deduplicated: false };
  })();
}

export const claimNextKnowledgeJob = db.transaction((ownerId = `knowledge-worker-${process.pid}`): KnowledgeJobRecord | null => {
  const now = new Date().toISOString();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + config.knowledgeWorkerLeaseMs).toISOString();
  const lock = db.provider === 'postgres' ? ' FOR UPDATE OF candidate SKIP LOCKED' : '';
  const row = db.prepare(`SELECT candidate.* FROM knowledge_jobs candidate
    WHERE candidate.state='queued' AND (candidate.retry_at IS NULL OR candidate.retry_at<=?)
      AND NOT EXISTS (SELECT 1 FROM knowledge_jobs active WHERE active.knowledge_base_id=candidate.knowledge_base_id AND active.state='processing')
      AND candidate.id=(SELECT queued.id FROM knowledge_jobs queued
        WHERE queued.space_id=candidate.space_id AND queued.state='queued' AND (queued.retry_at IS NULL OR queued.retry_at<=?)
          AND NOT EXISTS (SELECT 1 FROM knowledge_jobs active
            WHERE active.knowledge_base_id=queued.knowledge_base_id AND active.state='processing')
        ORDER BY queued.created_at,queued.id LIMIT 1)
    ORDER BY (SELECT COUNT(*) FROM knowledge_jobs active WHERE active.space_id=candidate.space_id AND active.state='processing'),
      COALESCE((SELECT MAX(started_at) FROM knowledge_jobs served WHERE served.space_id=candidate.space_id AND served.started_at IS NOT NULL),''),
      candidate.created_at,candidate.id LIMIT 1${lock}`).get(now, now) as any;
  if (!row) return null;
  // Candidate row locks alone do not serialize two replicas that select two
  // different documents from the same base before either claim commits. Lock
  // the shared base row, then re-check the invariant inside that lock.
  const base = lockKnowledgeBaseEmbeddingMutation(row.knowledge_base_id, row.space_id);
  if (!base) return null;
  if (db.prepare(`SELECT 1 FROM knowledge_jobs WHERE knowledge_base_id=? AND state='processing' AND id<>? LIMIT 1`)
    .get(row.knowledge_base_id, row.id)) return null;
  // A retry keeps its original version. New work allocates above both the
  // committed base watermark and every prior allocation, including failed
  // jobs, so a target namespace is never reused.
  let targetVersion = Number(row.target_version_reserved || 0) === 1 ? Number(row.target_version || 0) : 0;
  if (!targetVersion) {
    targetVersion = Math.max(base.currentVersion, Number((db.prepare(`SELECT last_allocated_version
      FROM knowledge_bases WHERE id=? AND space_id=?`).get(row.knowledge_base_id, row.space_id) as any)?.last_allocated_version || 0)) + 1;
    db.prepare(`UPDATE knowledge_bases SET last_allocated_version=? WHERE id=? AND space_id=?`)
      .run(targetVersion, row.knowledge_base_id, row.space_id);
  }
  const changed = db.prepare(`UPDATE knowledge_jobs SET state='processing',stage='dispatching',progress=5,
    attempt=attempt+1,target_version=?,target_version_reserved=1,started_at=?,lease_owner=?,lease_token=?,lease_generation=lease_generation+1,
    lease_acquired_at=?,lease_expires_at=?,heartbeat_at=?,updated_at=? WHERE id=? AND state='queued'`)
    .run(targetVersion, now, ownerId, leaseToken, now, leaseExpiresAt, now, now, row.id).changes;
  return changed ? getKnowledgeJob(row.id) : null;
});

export function updateKnowledgeJob(id: string, values: {
  state?: KnowledgeJobState; stage?: string; progress?: number; result?: unknown; error?: string | null;
  retryAt?: string | null; completedAt?: string | null;
}) {
  const current = getKnowledgeJob(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const state = values.state || current.state;
  const releaseLease = state !== 'processing';
  db.prepare(`UPDATE knowledge_jobs SET state=?,stage=?,progress=?,result_json=?,error=?,retry_at=?,completed_at=?,updated_at=?,
    lease_owner=?,lease_token=?,lease_acquired_at=?,lease_expires_at=?,heartbeat_at=? WHERE id=?`).run(
    state, values.stage || current.stage, values.progress ?? current.progress,
    values.result === undefined ? (current.result == null ? null : JSON.stringify(current.result)) : JSON.stringify(values.result),
    values.error === undefined ? current.error : values.error, values.retryAt === undefined ? current.retryAt : values.retryAt,
    values.completedAt === undefined ? current.completedAt : values.completedAt, now,
    releaseLease ? null : current.leaseOwner, releaseLease ? null : current.leaseToken,
    releaseLease ? null : current.leaseAcquiredAt, releaseLease ? null : current.leaseExpiresAt,
    releaseLease ? null : current.heartbeatAt, id
  );
  return getKnowledgeJob(id);
}

function knowledgeJobProfileVersions(job: KnowledgeJobRecord) {
  try {
    return knowledgeJobEmbeddingSnapshot(job).targetEmbeddingProfiles.map((profile) => profile.vectorIndexVersion);
  } catch {
    return job.embeddingProfileId ? [job.embeddingProfileId] : [];
  }
}

export function markKnowledgeJobStage(job: KnowledgeJobRecord, stage: string, progress: number) {
  return db.transaction(() => {
  lockKnowledgeJobLease(job);
  const now = new Date().toISOString();
  if (job.documentId) {
    const prior = getKnowledgeDocument(job.documentId, job.knowledgeBaseId, job.spaceId, true);
    const documentState: KnowledgeDocumentState = job.kind === 'document.delete' || stage === 'deleting_index'
      ? 'deleting'
      : job.kind === 'document.reindex' && Number(prior?.indexVersion || 0) > 0
        ? 'ready'
        : stage === 'extracting' ? 'extracting' : stage === 'indexing' ? 'indexing' : 'queued';
    db.prepare(`UPDATE knowledge_documents SET state=?,error=NULL,updated_at=? WHERE id=? AND space_id=?`)
      .run(documentState, now, job.documentId, job.spaceId);
    const embeddingState = job.kind === 'document.delete' || stage === 'deleting_index' ? 'deleting' : 'indexing';
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state=?,last_job_id=?,error=NULL,updated_at=?
        WHERE document_id=? AND vector_index_version=?`).run(embeddingState, job.id, now, job.documentId, vectorIndexVersion);
    }
  } else if (job.kind === 'base.delete' && stage === 'deleting_index') {
    db.prepare(`UPDATE knowledge_document_embeddings SET state='deleting',last_job_id=?,error=NULL,updated_at=?
      WHERE knowledge_base_id=? AND space_id=? AND state<>'deleted'`).run(job.id, now, job.knowledgeBaseId, job.spaceId);
  }
  if (job.kind === 'document.index' || job.kind === 'document.reindex') {
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='indexing',error=NULL,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=? AND state<>'disabled'`)
        .run(now, job.knowledgeBaseId, job.spaceId, vectorIndexVersion);
    }
  }
  return updateKnowledgeJob(job.id, { stage, progress });
  })();
}

export function completeKnowledgeIndex(job: KnowledgeJobRecord, output: {
  document?: { pageCount?: number | null; chunkCount?: number; entityCount?: number; relationshipCount?: number; language?: string | null };
  metrics?: Record<string, unknown>;
}) {
  if (!job.documentId || !job.targetVersion) throw new KnowledgeError('The indexing job is missing its document or version.', 500, 'KNOWLEDGE_JOB_INVALID');
  return db.transaction(() => {
    lockKnowledgeJobLease(job);
    const now = new Date().toISOString(); const stats = output.document || {};
    db.prepare(`UPDATE knowledge_documents SET state='ready',index_version=?,page_count=?,chunk_count=?,entity_count=?,relationship_count=?,language=?,error=NULL,indexed_at=?,updated_at=?
      WHERE id=? AND space_id=?`).run(job.targetVersion, stats.pageCount ?? null, Math.max(0, Number(stats.chunkCount || 0)),
        Math.max(0, Number(stats.entityCount || 0)), Math.max(0, Number(stats.relationshipCount || 0)), stats.language || null, now, now, job.documentId, job.spaceId);
    db.prepare(`UPDATE knowledge_bases SET status=CASE WHEN status='deleting' THEN 'deleting' ELSE 'ready' END,
      current_version=MAX(current_version,?),last_indexed_at=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(job.targetVersion, now, now, job.knowledgeBaseId, job.spaceId);
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state='ready',index_version=?,chunk_count=?,last_job_id=?,
        error=NULL,indexed_at=?,updated_at=? WHERE document_id=? AND vector_index_version=?`)
        .run(job.targetVersion, Math.max(0, Number(stats.chunkCount || 0)), job.id, now, now,
          job.documentId, vectorIndexVersion);
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='ready',current_version=MAX(current_version,?),
        error=NULL,last_indexed_at=?,updated_at=? WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=?`)
        .run(job.targetVersion, now, now, job.knowledgeBaseId, job.spaceId, vectorIndexVersion);
    }
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
    ORDER BY created_at,id LIMIT ?`).all(now, Math.max(1, Math.min(500, limit))) as Array<{
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
    lockKnowledgeJobLease(job);
    const now = new Date().toISOString();
    if (job.kind === 'document.delete' && job.documentId) {
      const stored = db.prepare('SELECT stored_filename FROM knowledge_documents WHERE id=? AND space_id=?')
        .get(job.documentId, job.spaceId) as { stored_filename: string } | undefined;
      purgeKnowledgeEvidence(job.spaceId, job.knowledgeBaseId, job.documentId);
      db.prepare(`UPDATE knowledge_documents SET state='deleted',deleted_at=?,original_name='Deleted document',mime_type='application/octet-stream',
        size_bytes=0,sha256='deleted:'||id,page_count=NULL,chunk_count=0,entity_count=0,relationship_count=0,language=NULL,error=NULL,updated_at=?
        WHERE id=? AND space_id=?`).run(now, now, job.documentId, job.spaceId);
      db.prepare(`UPDATE knowledge_document_embeddings SET state='deleted',source_sha256='deleted:'||document_id,
        chunk_count=0,last_job_id=?,error=NULL,updated_at=? WHERE document_id=? AND space_id=?`)
        .run(job.id, now, job.documentId, job.spaceId);
      db.prepare(`UPDATE knowledge_backfill_items SET state='failed',source_sha256='deleted:'||document_id,
        error='Document deleted before backfill completed.',completed_at=?,updated_at=?
        WHERE document_id=? AND space_id=? AND state NOT IN ('completed','failed')`)
        .run(now, now, job.documentId, job.spaceId);
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
      db.prepare(`UPDATE knowledge_document_embeddings SET state='deleted',source_sha256='deleted:'||document_id,
        chunk_count=0,last_job_id=?,error=NULL,updated_at=? WHERE knowledge_base_id=? AND space_id=?`)
        .run(job.id, now, job.knowledgeBaseId, job.spaceId);
      db.prepare(`UPDATE knowledge_backfill_items SET state='failed',source_sha256='deleted:'||document_id,
        error='Knowledge base deleted before backfill completed.',completed_at=?,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND state NOT IN ('completed','failed')`)
        .run(now, now, job.knowledgeBaseId, job.spaceId);
      db.prepare(`UPDATE knowledge_jobs SET input_json='{}',result_json=NULL,error=NULL,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND id<>?`).run(now, job.knowledgeBaseId, job.spaceId, job.id);
      db.prepare(`UPDATE knowledge_bases SET status='deleted',deleted_at=?,name='Deleted knowledge base',description='',privacy='private',
        allow_terra_context=0,current_version=MAX(current_version,?),updated_at=? WHERE id=? AND space_id=?`)
        .run(now, job.targetVersion || 0, now, job.knowledgeBaseId, job.spaceId);
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET mode='disabled',state='disabled',error=NULL,updated_at=?
        WHERE knowledge_base_id=? AND space_id=?`).run(now, job.knowledgeBaseId, job.spaceId);
      for (const item of stored) enqueueKnowledgeFileCleanup({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId,
        storedFilename: item.stored_filename });
    }
    // Provider snapshots are required while a delete is queued or retrying, but
    // are no longer needed after the destructive operation has committed.
    db.prepare(`UPDATE knowledge_jobs SET input_json='{}' WHERE id=?`).run(job.id);
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
  return db.transaction(() => {
  lockKnowledgeJobLease(job);
  const now = new Date().toISOString();
  if (job.documentId) db.prepare(`UPDATE knowledge_documents SET state=CASE
      WHEN ?='document.reindex' AND index_version>0 THEN 'ready' ELSE 'failed' END,error=?,updated_at=? WHERE id=? AND space_id=?`)
    .run(job.kind, message.slice(0, 1000), now, job.documentId, job.spaceId);
  db.prepare(`UPDATE knowledge_bases SET status='degraded',updated_at=? WHERE id=? AND space_id=? AND status<>'deleting'`)
    .run(now, job.knowledgeBaseId, job.spaceId);
  if (job.documentId) {
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state='failed',last_job_id=?,error=?,updated_at=?
        WHERE document_id=? AND vector_index_version=?`).run(job.id, message.slice(0, 1000), now,
          job.documentId, vectorIndexVersion);
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='degraded',error=?,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=? AND state<>'disabled'`)
        .run(message.slice(0, 1000), now, job.knowledgeBaseId, job.spaceId, vectorIndexVersion);
    }
  }
  const failed = updateKnowledgeJob(job.id, { state: 'failed', stage: 'failed', progress: 100,
    error: message.slice(0, 1000), retryAt: null, completedAt: now });
  auditKnowledge({ spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId, documentId: job.documentId,
    jobId: job.id, actorUserId: job.requestedBy, action: 'knowledge_job.failed', detail: { message: message.slice(0, 500) } });
  return failed;
  })();
}

export function requeueKnowledgeJob(job: KnowledgeJobRecord, stage: string, message: string, retryAt: string) {
  return db.transaction(() => {
  lockKnowledgeJobLease(job);
  const now = new Date().toISOString();
  if (job.documentId) {
    db.prepare(`UPDATE knowledge_documents SET state=CASE
        WHEN ?='document.delete' THEN 'deleting'
        WHEN ?='document.reindex' AND index_version>0 THEN 'ready'
        ELSE 'queued' END,error=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(job.kind, job.kind, message.slice(0, 1000), now, job.documentId, job.spaceId);
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state=?,last_job_id=?,error=?,updated_at=?
        WHERE document_id=? AND vector_index_version=?`)
        .run(job.kind === 'document.delete' ? 'deleting' : 'queued', job.id, message.slice(0, 1000), now,
          job.documentId, vectorIndexVersion);
    }
  }
  db.prepare(`UPDATE knowledge_bases SET status=CASE WHEN status='deleting' THEN status ELSE 'indexing' END,updated_at=?
    WHERE id=? AND space_id=?`).run(now, job.knowledgeBaseId, job.spaceId);
  if (job.kind === 'document.index' || job.kind === 'document.reindex') {
    for (const vectorIndexVersion of knowledgeJobProfileVersions(job)) {
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='queued',error=?,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=? AND state<>'disabled'`)
        .run(message.slice(0, 1000), now, job.knowledgeBaseId, job.spaceId, vectorIndexVersion);
    }
  }
  return updateKnowledgeJob(job.id, { state: 'queued', stage, progress: 0, error: message.slice(0, 1000), retryAt });
  })();
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
    if (config.knowledgeEmbeddingForceQwen && base.currentVersion > 0) {
      const rollback = db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN projection.state='ready' AND projection.source_sha256=document.sha256
            AND projection.index_version>=document.index_version THEN 1 ELSE 0 END) covered
        FROM knowledge_documents document
        LEFT JOIN knowledge_document_embeddings projection ON projection.document_id=document.id
          AND projection.vector_index_version='qwen-v1'
        WHERE document.knowledge_base_id=? AND document.space_id=? AND document.deleted_at IS NULL
          AND document.state='ready'`).get(base.id, base.spaceId) as any;
      const mappingReady = db.prepare(`SELECT 1 FROM knowledge_base_embedding_profiles
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version='qwen-v1' AND state='ready'`)
        .get(base.id, base.spaceId);
      if (!mappingReady || Number(rollback?.covered || 0) !== Number(rollback?.total || 0)) {
        throw new KnowledgeError('The emergency Qwen rollback index is incomplete for this knowledge base.',
          409, 'KNOWLEDGE_QWEN_ROLLBACK_NOT_READY');
      }
    }
    const readableStatus = ['ready', 'indexing', 'degraded'].includes(base.status);
    if (!options.allowEmpty && (!readableStatus || base.currentVersion < 1 || base.readyDocumentCount < 1)) {
      throw new KnowledgeError(`"${base.name}" is not ready for retrieval.`, 409, 'KNOWLEDGE_BASE_NOT_READY');
    }
    refs.push({ id: base.id, name: base.name, indexVersion: base.currentVersion,
      embeddingModel: base.embeddingModel, embeddingDimension: base.embeddingDimension, chunkerVersion: base.chunkerVersion,
      embeddingProfile: base.embeddingProfile });
  }
  if (new Set(refs.map((ref) => ref.embeddingProfile.vectorIndexVersion)).size > 1) {
    throw new KnowledgeError('Selected knowledge bases use different embedding spaces and cannot be queried together.',
      409, 'KNOWLEDGE_EMBEDDING_PROFILE_MISMATCH');
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
    ? db.prepare(`SELECT id,knowledge_base_id AS "knowledgeBaseId",document_id AS "documentId",job_id AS "jobId",actor_user_id AS "actorUserId",
        ai_job_id AS "aiJobId",
        action,detail_json detail,created_at AS "createdAt" FROM knowledge_audit_events
        WHERE space_id=? AND knowledge_base_id=? ORDER BY created_at DESC LIMIT ?`).all(spaceId, knowledgeBaseId, limit)
    : db.prepare(`SELECT id,knowledge_base_id AS "knowledgeBaseId",document_id AS "documentId",job_id AS "jobId",actor_user_id AS "actorUserId",
        ai_job_id AS "aiJobId",
        action,detail_json detail,created_at AS "createdAt" FROM knowledge_audit_events
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
