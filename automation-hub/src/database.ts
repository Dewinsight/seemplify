import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  actor_json TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','paused','retired')),
  draft_json TEXT NOT NULL,
  current_version_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflows_org_idx ON workflows(organization_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  organization_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  compile_json TEXT NOT NULL,
  published_by TEXT NOT NULL,
  publisher_actor_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(workflow_id, version)
);
CREATE TABLE IF NOT EXISTS event_inbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
  event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','waiting_approval','succeeded','failed','rejected','cancelled','reconcile')),
  cursor INTEGER NOT NULL DEFAULT 0,
  context_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workflow_version_id, event_id)
);
CREATE INDEX IF NOT EXISTS runs_org_idx ON runs(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','unknown','skipped')),
  request_json TEXT NOT NULL,
  response_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(run_id, step_id, attempt_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_success_idempotency_idx ON attempts(idempotency_key) WHERE status='succeeded';
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_revision TEXT NOT NULL,
  action_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  rejection_action_id TEXT,
  rejection_payload_json TEXT,
  rejection_payload_hash TEXT,
  requester_id TEXT NOT NULL,
  runtime_identity TEXT NOT NULL,
  approver_roles_json TEXT NOT NULL,
  maker_checker INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired','superseded','cancelled')),
  decision_actor_id TEXT,
  decision_actor_name TEXT,
  rationale TEXT,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE(run_id, step_id)
);
CREATE INDEX IF NOT EXISTS approvals_org_idx ON approvals(organization_id, status, requested_at DESC);
CREATE TABLE IF NOT EXISTS connector_installations (
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  allowed_data_classes_json TEXT NOT NULL,
  installed_by TEXT,
  installed_at TEXT,
  PRIMARY KEY(organization_id, provider)
);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  nango_connection_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user','organization')),
  owner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','connected','invalid','revoked')),
  granted_scopes_json TEXT NOT NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, provider, nango_connection_id)
);
CREATE INDEX IF NOT EXISTS connections_org_idx ON connections(organization_id, provider, status);
CREATE TABLE IF NOT EXISTS external_mappings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  action_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  provider_resource_id TEXT NOT NULL,
  provider_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, connection_id, action_id, source_id)
);
CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  allowed_event_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  event_pattern TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret_cipher_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','revoked')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES event_subscriptions(id),
  event_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed','dead')),
  response_status INTEGER,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscription_id, event_id, attempt)
);
CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_events(organization_id, sequence DESC);
`);

// Keep developer databases forward-compatible without discarding local runs.
const approvalColumns = new Set((db.prepare("PRAGMA table_info(approvals)").all() as Array<{ name: string }>).map((column) => column.name));
for (const [name, type] of [["rejection_action_id", "TEXT"], ["rejection_payload_json", "TEXT"], ["rejection_payload_hash", "TEXT"]] as const) {
  if (!approvalColumns.has(name)) db.exec(`ALTER TABLE approvals ADD COLUMN ${name} ${type}`);
}

export function now() { return new Date().toISOString(); }
export function json<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function stringify(value: unknown) { return JSON.stringify(value); }

export function resetDatabaseForTests() {
  if (!config.testAuthEnabled) throw new Error("Test reset is disabled.");
  db.exec(`
    DELETE FROM webhook_deliveries;
    DELETE FROM event_subscriptions;
    DELETE FROM incoming_webhooks;
    DELETE FROM approvals;
    DELETE FROM attempts;
    DELETE FROM runs;
    DELETE FROM event_inbox;
    DELETE FROM workflow_versions;
    DELETE FROM workflows;
    DELETE FROM external_mappings;
    DELETE FROM connections;
    DELETE FROM connector_installations;
    DELETE FROM audit_events;
    DELETE FROM sessions;
    DELETE FROM oidc_states;
  `);
}
