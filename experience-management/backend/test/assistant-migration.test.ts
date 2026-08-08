import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-assistant-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const files = {
  password: path.join(root, 'admin-password'),
  session: path.join(root, 'session-secret'),
  xKey: path.join(root, 'x-key'),
  esignKey: path.join(root, 'esign-key'),
  nylasKey: path.join(root, 'nylas-key')
};
fs.writeFileSync(files.password, 'Assistant-Migration-Password-2026!');
fs.writeFileSync(files.session, 'assistant-migration-session-secret-longer-than-twenty-characters');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 81).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 82).toString('base64url'));
fs.writeFileSync(files.nylasKey, Buffer.alloc(32, 83).toString('base64url'));

const environment = {
  ...process.env,
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5599',
  ADMIN_EMAIL: 'assistant-migration-admin@example.test',
  ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files.esignKey,
  NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE: files.nylasKey,
  EMAIL_MODE: 'log',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
};

const backendDirectory = path.resolve(import.meta.dirname, '..');
const assistantModule = pathToFileURL(path.resolve(backendDirectory, 'src/assistant.ts')).href;
const databaseModule = pathToFileURL(path.resolve(backendDirectory, 'src/database.ts')).href;

function bootstrapAssistant() {
  const initialized = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(assistantModule)}); const { db } = await import(${JSON.stringify(databaseModule)}); db.close();`
    ],
    { env: environment, cwd: backendDirectory, encoding: 'utf8' }
  );
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
}

bootstrapAssistant();

const legacy = new Database(databasePath);
legacy.pragma('foreign_keys = OFF');
legacy.exec(`
  DROP INDEX IF EXISTS assistant_runs_owner_history;
  DROP INDEX IF EXISTS assistant_runs_job;
  DROP INDEX IF EXISTS assistant_runs_idempotency;
  CREATE TABLE assistant_runs_legacy (
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
    request_fingerprint TEXT,
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
  DROP TABLE assistant_runs;
  ALTER TABLE assistant_runs_legacy RENAME TO assistant_runs;
`);
const timestamp = '2026-07-31T12:00:00.000Z';
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
  VALUES ('assistant-legacy-user','assistant-legacy@example.test','Legacy Assistant User','hash','member',?,?)`)
  .run(timestamp, timestamp);
legacy.prepare(`INSERT INTO spaces
  (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
  VALUES ('assistant-legacy-space','Legacy assistant space','assistant-legacy-space',
    'assistant-legacy-user','assistant-legacy-user',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
  VALUES ('assistant-legacy-space','assistant-legacy-user','owner',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO assistant_runs (
  id,space_id,requested_by,kind,source_refs_json,input_snapshot_json,input_sha256,request_fingerprint,
  state,advisory_only,external_dispatched,created_at,updated_at
) VALUES (
  'assistant-legacy-run','assistant-legacy-space','assistant-legacy-user','email_summary','[]',
  'legacy-encrypted-snapshot','legacy-sha',NULL,'completed',1,0,?,?
)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO assistant_actions (
  id,space_id,created_by,source_run_id,source_item_index,title,description,owner,status,priority,
  due_at,revision,completed_at,created_at,updated_at
) VALUES (
  'assistant-legacy-action','assistant-legacy-space','assistant-legacy-user','assistant-legacy-run',0,
  'Preserve this action','','','open','normal',NULL,1,NULL,?,?
)`).run(timestamp, timestamp);
legacy.pragma('foreign_keys = ON');
assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
legacy.close();

bootstrapAssistant();

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('upgrades the legacy assistant run kind check without losing runs or action references', () => {
  const migrated = new Database(databasePath);
  migrated.pragma('foreign_keys = ON');
  try {
    const tableSql = String((migrated.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='assistant_runs'"
    ).get() as any)?.sql || '');
    assert.match(tableSql, /'work_product'/u);
    assert.equal(
      (migrated.prepare("SELECT kind FROM assistant_runs WHERE id='assistant-legacy-run'").get() as any).kind,
      'email_summary'
    );
    assert.equal(
      (migrated.prepare("SELECT source_run_id FROM assistant_actions WHERE id='assistant-legacy-action'").get() as any).source_run_id,
      'assistant-legacy-run'
    );
    const actionForeignKey = (migrated.prepare('PRAGMA foreign_key_list(assistant_actions)').all() as any[])
      .find((foreignKey) => foreignKey.from === 'source_run_id');
    assert.equal(actionForeignKey.table, 'assistant_runs');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);

    migrated.prepare(`INSERT INTO assistant_runs (
      id,space_id,requested_by,kind,source_refs_json,knowledge_base_ids_json,document_type,title,
      input_snapshot_json,input_sha256,request_fingerprint,state,advisory_only,external_dispatched,
      created_at,updated_at
    ) VALUES (
      'assistant-work-product-probe','assistant-legacy-space','assistant-legacy-user','work_product',
      '[]','[]','memo','Compatibility probe','snapshot','sha','fingerprint','queued',1,0,?,?
    )`).run(timestamp, timestamp);
    assert.equal(
      (migrated.prepare("SELECT kind FROM assistant_runs WHERE id='assistant-work-product-probe'").get() as any).kind,
      'work_product'
    );
  } finally {
    migrated.close();
  }
});
