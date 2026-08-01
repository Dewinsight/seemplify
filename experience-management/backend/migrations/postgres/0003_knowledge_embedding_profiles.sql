-- Runtime schema 3: immutable embedding-space identities, parallel index state,
-- resumable corpus backfills, and per-job provider snapshots. This migration
-- is additive: all pre-existing data remains pinned to qwen-v1.

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

INSERT INTO knowledge_embedding_profiles
  (vector_index_version,provider,model,revision,dtype,dimensions,state,created_at,updated_at)
VALUES
  ('qwen-v1','qwen-tei','Qwen/Qwen3-Embedding-4B','5cf2132abc99cad020ac570b19d031efec650f2b','float16',2560,'configured',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text),
  ('gte-modernbert-v1','gte-node','Alibaba-NLP/gte-modernbert-base','e7f32e3c00f91d699e8c43b53106206bcc72bb22','q8',768,'disabled',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text)
ON CONFLICT(vector_index_version) DO NOTHING;

-- A version identifier is an immutable embedding-space identity. Refuse to
-- start on a registry that has been silently repointed at different weights.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM knowledge_embedding_profiles WHERE vector_index_version='qwen-v1'
      AND (provider<>'qwen-tei' OR model<>'Qwen/Qwen3-Embedding-4B'
        OR revision<>'5cf2132abc99cad020ac570b19d031efec650f2b'
        OR dtype<>'float16' OR dimensions<>2560)
  ) OR EXISTS (
    SELECT 1 FROM knowledge_embedding_profiles WHERE vector_index_version='gte-modernbert-v1'
      AND (provider<>'gte-node' OR model<>'Alibaba-NLP/gte-modernbert-base'
        OR revision<>'e7f32e3c00f91d699e8c43b53106206bcc72bb22'
        OR dtype<>'q8' OR dimensions<>768)
  ) THEN
    RAISE EXCEPTION 'Knowledge embedding profile registry identity mismatch';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION experience_guard_embedding_profile_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Knowledge embedding profile identities cannot be deleted';
  END IF;
  IF NEW.vector_index_version<>OLD.vector_index_version OR NEW.provider<>OLD.provider OR NEW.model<>OLD.model
    OR NEW.revision<>OLD.revision OR NEW.dtype<>OLD.dtype OR NEW.dimensions<>OLD.dimensions THEN
    RAISE EXCEPTION 'Knowledge embedding profile identities are immutable';
  END IF;
  IF OLD.state='retired' AND NEW.state<>'retired' THEN
    RAISE EXCEPTION 'A retired knowledge embedding profile cannot be reactivated';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_embedding_profiles_immutable ON knowledge_embedding_profiles;
CREATE TRIGGER knowledge_embedding_profiles_immutable
BEFORE UPDATE OR DELETE ON knowledge_embedding_profiles
FOR EACH ROW EXECUTE FUNCTION experience_guard_embedding_profile_identity();

ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS embedding_provider TEXT NOT NULL DEFAULT 'qwen-tei';
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS embedding_revision TEXT NOT NULL DEFAULT '5cf2132abc99cad020ac570b19d031efec650f2b';
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS embedding_dtype TEXT NOT NULL DEFAULT 'float16';
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS vector_index_version TEXT NOT NULL DEFAULT 'qwen-v1';
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS last_allocated_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS embedding_profile_id TEXT REFERENCES knowledge_embedding_profiles(vector_index_version) ON DELETE RESTRICT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS lease_acquired_at TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TEXT;
ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS target_version_reserved INTEGER NOT NULL DEFAULT 0;
UPDATE knowledge_bases base SET last_allocated_version=GREATEST(base.current_version,base.last_allocated_version,
  COALESCE((SELECT MAX(job.target_version) FROM knowledge_jobs job WHERE job.knowledge_base_id=base.id),0));
-- A candidate-row SKIP LOCKED query is not sufficient when two replicas select
-- different documents from the same base. Runtime claiming also locks the base
-- row; these constraints make the invariants fail closed at the database.
-- Schema upgrades run while workers are stopped. Legacy processing rows had no
-- leases and are returned to the durable queue before the active-base guard is
-- installed. Previously reused failed target versions remain as historical
-- evidence but are not treated as post-migration reservations; the monotonic
-- allocator starts above all of them and every new claim is marked reserved.
UPDATE knowledge_jobs SET state='queued' WHERE state='processing';
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_jobs_one_processing_base
  ON knowledge_jobs(knowledge_base_id) WHERE state='processing';
DROP INDEX IF EXISTS knowledge_jobs_unique_target_version;
CREATE UNIQUE INDEX knowledge_jobs_unique_target_version
  ON knowledge_jobs(knowledge_base_id,target_version)
  WHERE target_version IS NOT NULL AND target_version_reserved=1;

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

-- Keep modified schema-3 development databases forward compatible too.
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS source_index_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS source_chunker_version TEXT NOT NULL DEFAULT 'docling-hybrid-v1';
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS source_embedding_profile_json TEXT NOT NULL DEFAULT '{"provider":"qwen-tei","model":"Qwen/Qwen3-Embedding-4B","revision":"5cf2132abc99cad020ac570b19d031efec650f2b","dtype":"float16","dimensions":2560,"vectorIndexVersion":"qwen-v1"}';
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS target_embedding_profile_json TEXT NOT NULL DEFAULT '{"provider":"gte-node","model":"Alibaba-NLP/gte-modernbert-base","revision":"e7f32e3c00f91d699e8c43b53106206bcc72bb22","dtype":"q8","dimensions":768,"vectorIndexVersion":"gte-modernbert-v1"}';
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS zero_progress_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS lease_acquired_at TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS heartbeat_at TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS last_progress_at TEXT;
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS runtime_attestation_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE knowledge_backfill_items ADD COLUMN IF NOT EXISTS runtime_attestation_sha256 TEXT;

UPDATE knowledge_backfill_items item SET
  source_index_version=document.index_version,
  source_chunker_version=base.chunker_version
FROM knowledge_documents document,knowledge_bases base
WHERE document.id=item.document_id AND document.knowledge_base_id=item.knowledge_base_id
  AND document.space_id=item.space_id AND base.id=item.knowledge_base_id AND base.space_id=item.space_id;
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

CREATE OR REPLACE FUNCTION experience_guard_knowledge_promotion_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Knowledge promotion approval history cannot be deleted';
  END IF;
  IF NEW.backfill_run_id IS DISTINCT FROM OLD.backfill_run_id
    OR NEW.knowledge_base_id IS DISTINCT FROM OLD.knowledge_base_id
    OR NEW.space_id IS DISTINCT FROM OLD.space_id
    OR NEW.source_vector_index_version IS DISTINCT FROM OLD.source_vector_index_version
    OR NEW.target_vector_index_version IS DISTINCT FROM OLD.target_vector_index_version
    OR NEW.corpus_manifest_sha256 IS DISTINCT FROM OLD.corpus_manifest_sha256
    OR NEW.gate_payload_json IS DISTINCT FROM OLD.gate_payload_json
    OR NEW.gate_payload_sha256 IS DISTINCT FROM OLD.gate_payload_sha256
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Knowledge promotion request evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_embedding_promotion_evidence_immutable
  ON knowledge_embedding_promotion_approvals;
CREATE TRIGGER knowledge_embedding_promotion_evidence_immutable
BEFORE UPDATE OR DELETE ON knowledge_embedding_promotion_approvals
FOR EACH ROW EXECUTE FUNCTION experience_guard_knowledge_promotion_evidence();

INSERT INTO knowledge_base_embedding_profiles
  (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,error,last_indexed_at,created_at,updated_at)
SELECT space_id,id,vector_index_version,'primary',
  CASE WHEN status='ready' THEN 'ready' WHEN status='indexing' THEN 'indexing'
    WHEN status='degraded' THEN 'degraded' WHEN status IN ('deleting','deleted') THEN 'disabled' ELSE 'empty' END,
  current_version,NULL,last_indexed_at,created_at,updated_at
FROM knowledge_bases WHERE TRUE
ON CONFLICT(knowledge_base_id,vector_index_version) DO NOTHING;

INSERT INTO knowledge_document_embeddings
  (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,chunk_count,last_job_id,error,indexed_at,created_at,updated_at)
SELECT d.space_id,d.knowledge_base_id,d.id,b.vector_index_version,d.sha256,d.index_version,
  CASE WHEN d.state='ready' THEN 'ready' WHEN d.state IN ('extracting','indexing') THEN 'indexing'
    WHEN d.state='failed' THEN 'failed' WHEN d.state='deleting' THEN 'deleting'
    WHEN d.state='deleted' THEN 'deleted' ELSE 'queued' END,
  d.chunk_count,NULL,d.error,d.indexed_at,d.created_at,d.updated_at
FROM knowledge_documents d
JOIN knowledge_bases b ON b.id=d.knowledge_base_id AND b.space_id=d.space_id WHERE TRUE
ON CONFLICT(document_id,vector_index_version) DO NOTHING;

UPDATE knowledge_jobs j SET embedding_profile_id=b.vector_index_version
FROM knowledge_bases b
WHERE j.embedding_profile_id IS NULL AND b.id=j.knowledge_base_id AND b.space_id=j.space_id;
