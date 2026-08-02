-- Runtime schema 7: explicitly reviewed Personal Assistant replies.
-- AI output remains advisory; this table records the separate human-approved
-- provider action and preserves one provider idempotency key per assistant run.

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
  subject_sha256 TEXT NOT NULL CHECK(subject_sha256 ~ '^[a-f0-9]{64}$'),
  body_sha256 TEXT NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
  error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assistant_outbound_messages_owner
  ON assistant_outbound_messages(space_id,user_id,created_at DESC,id);
