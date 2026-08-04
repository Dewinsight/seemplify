-- Runtime schema 10: durable, resumable, tenant-isolated deep corpus analysis.

CREATE TABLE IF NOT EXISTS deep_analysis_runs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'planning',
  progress INTEGER NOT NULL DEFAULT 0,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  knowledge_refs_json TEXT NOT NULL DEFAULT '[]',
  corpus_manifest_json TEXT NOT NULL DEFAULT '{}',
  estimate_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  runtime_json TEXT,
  error TEXT,
  idempotency_key TEXT,
  total_partitions INTEGER NOT NULL DEFAULT 0,
  completed_partitions INTEGER NOT NULL DEFAULT 0,
  failed_partitions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS deep_analysis_runs_idempotency
  ON deep_analysis_runs(space_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS deep_analysis_runs_space_state
  ON deep_analysis_runs(space_id,state,created_at);

CREATE TABLE IF NOT EXISTS deep_analysis_partitions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES deep_analysis_runs(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  ai_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL,
  source_json TEXT NOT NULL DEFAULT '{}',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  runtime_json TEXT,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id,ordinal)
);

CREATE INDEX IF NOT EXISTS deep_analysis_partitions_run_state
  ON deep_analysis_partitions(run_id,state,level,ordinal);

CREATE TABLE IF NOT EXISTS deep_analysis_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES deep_analysis_runs(id) ON DELETE CASCADE,
  partition_id TEXT NOT NULL REFERENCES deep_analysis_partitions(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS deep_analysis_evidence_run_kind
  ON deep_analysis_evidence(run_id,kind,created_at);
