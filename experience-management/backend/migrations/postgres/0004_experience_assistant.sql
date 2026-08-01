-- Runtime schema 4: Experience Management personal assistant.
-- Nylas grants and assistant input snapshots are encrypted by the application;
-- this schema stores only ciphertext, hashes, bounded metadata, and advisory
-- outputs. No table or route grants authority to send mail or mutate calendars.

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
CREATE UNIQUE INDEX IF NOT EXISTS assistant_nylas_connections_grant
  ON assistant_nylas_connections(space_id,user_id,grant_fingerprint)
  WHERE grant_fingerprint IS NOT NULL;

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
  kind TEXT NOT NULL CHECK(kind IN ('email_summary','email_draft','knowledge_answer')),
  connection_id TEXT REFERENCES assistant_nylas_connections(id) ON DELETE SET NULL,
  subject_ref TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
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
  ON assistant_runs(space_id,requested_by,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
