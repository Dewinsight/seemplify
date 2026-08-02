import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-intelligence-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const files = {
  password: path.join(root, 'admin-password'), session: path.join(root, 'session-secret'), webhook: path.join(root, 'webhook-secret'),
  xKey: path.join(root, 'x-key'), esignKey: path.join(root, 'esign-key')
};
fs.writeFileSync(files.password, 'Migration-Test-Password-2026!');
fs.writeFileSync(files.session, 'migration-test-session-secret-that-is-long-enough');
fs.writeFileSync(files.webhook, 'migration-test-webhook-secret-that-is-long-enough');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 32).toString('base64url'));
const environment = {
  ...process.env, DATABASE_PATH: databasePath, UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5499', ADMIN_EMAIL: 'migration-owner@example.test', ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session, BREVO_WEBHOOK_SECRET_FILE: files.webhook, X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: files.esignKey, EMAIL_MODE: 'log',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-consumer'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-consumer-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-bearer'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-access'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-access-secret'), X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
};
Object.assign(process.env, environment);

const databaseModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/database.ts')).href;
const initialized = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `const { db } = await import(${JSON.stringify(databaseModule)}); db.close();`], {
  env: environment, cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8'
});
assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

const legacy = new Database(databasePath);
legacy.pragma('foreign_keys = OFF');
legacy.exec(`DROP TRIGGER IF EXISTS users_delete_owned_ai_jobs;
  DROP INDEX IF EXISTS social_reply_drafts_one_active_request;
  DROP INDEX IF EXISTS social_reply_drafts_idempotency;
  DROP INDEX IF EXISTS social_intelligence_reports_one_active_request;
  DROP INDEX IF EXISTS social_intelligence_reports_idempotency;
  DROP INDEX IF EXISTS intelligence_reports_one_active_request;
  DROP INDEX IF EXISTS intelligence_reports_idempotency;
  ALTER TABLE ai_jobs DROP COLUMN provider_result_json;
  ALTER TABLE ai_jobs DROP COLUMN requested_by;
  ALTER TABLE social_reply_drafts DROP COLUMN idempotency_key;
  ALTER TABLE social_intelligence_reports DROP COLUMN idempotency_key;
  ALTER TABLE intelligence_reports DROP COLUMN idempotency_key;`);
const timestamp = '2026-07-29T12:00:00.000Z';
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at) VALUES ('migration-user','migration@example.test','Migration User','hash','member',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO x_apps (id,credential_version,configured_by,created_at,updated_at) VALUES ('migration-app',1,'migration-user',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO x_connections (id,user_id,app_id,access_token_enc,auth_type,x_user_id,username,status,created_at,updated_at)
  VALUES ('migration-connection','migration-user','migration-app','encrypted','oauth2','9001','migration_x','connected',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO social_mentions (id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,created_at)
  VALUES ('migration-mention','x','post-1','migration-connection','mention','@voice','The onboarding process is difficult to complete.','','en',?,'{}',?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO x_connection_mentions (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
  VALUES ('migration-connection','migration-mention','["mention"]','[]',?,?)`).run(timestamp, timestamp);
legacy.prepare(`INSERT INTO x_sync_jobs (id,connection_id,trigger_type,state,stage,progress,attempt,created_at,updated_at)
  VALUES ('migration-sync','migration-connection','manual','completed','completed',100,1,?,?)`).run(timestamp, timestamp);

function insertJob(id: string, kind: string, input: unknown, createdAt: string) {
  legacy.prepare(`INSERT INTO ai_jobs (id,kind,state,stage,progress,attempt,input_json,created_at,updated_at)
    VALUES (?,?,'queued','queued',0,0,?,?,?)`).run(id, kind, JSON.stringify(input), createdAt, createdAt);
}
function time(offset: number) { return new Date(Date.parse(timestamp) + offset).toISOString(); }
const replyJobs = [crypto.randomUUID(), crypto.randomUUID()];
const socialJobs = [crypto.randomUUID(), crypto.randomUUID()];
const combinedJobs = [crypto.randomUUID(), crypto.randomUUID()];
for (const [index, id] of replyJobs.entries()) insertJob(id, 'social.reply_draft', { draftId: `reply-${index}` }, time(index));
for (const [index, id] of socialJobs.entries()) insertJob(id, 'social.report', { reportId: `social-${index}` }, time(index));
for (const [index, id] of combinedJobs.entries()) insertJob(id, 'intelligence.synthesize', { reportId: `combined-${index}` }, time(index));
insertJob('migration-x-analysis', 'social.analyze', { mentionIds: ['migration-mention'], source: 'x-sync', xSyncJobId: 'migration-sync' }, time(5));

for (const index of [0, 1]) legacy.prepare(`INSERT INTO social_reply_drafts
  (id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,ai_job_id,created_at,updated_at)
  VALUES (?,'migration-mention','migration-connection','migration-user','helpful','same request','{}','queued',?,?,?)`)
  .run(`reply-${index}`, replyJobs[index], time(index), time(index));
for (const index of [0, 1]) legacy.prepare(`INSERT INTO social_intelligence_reports
  (id,user_id,connection_id,title,mention_ids_json,source_snapshot_json,state,ai_job_id,created_at,updated_at)
  VALUES (?,'migration-user','migration-connection','Same report','["migration-mention"]','[]','queued',?,?,?)`)
  .run(`social-${index}`, socialJobs[index], time(index), time(index));
for (const index of [0, 1]) legacy.prepare(`INSERT INTO intelligence_reports
  (id,user_id,title,objective,source_refs_json,source_snapshot_json,state,ai_job_id,created_at,updated_at)
  VALUES (?,'migration-user','Same synthesis','Same objective','{"survey":["a"],"social":["b"]}','[]','queued',?,?,?)`)
  .run(`combined-${index}`, combinedJobs[index], time(index), time(index));
legacy.close();

const { db } = await import('../src/database.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('normalizes duplicate intelligence requests and backfills private ownership before creating indexes', () => {
  for (const table of ['social_reply_drafts', 'social_intelligence_reports', 'intelligence_reports']) {
    const counts = db.prepare(`SELECT state,COUNT(*) count FROM ${table} GROUP BY state`).all() as Array<{ state: string; count: number }>;
    assert.equal(counts.find((row) => row.state === 'queued')?.count, 1);
    assert.equal(counts.find((row) => row.state === 'failed')?.count, 1);
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((column) => column.name));
    assert.ok(columns.has('idempotency_key'));
  }
  const aiColumns = new Set((db.prepare('PRAGMA table_info(ai_jobs)').all() as any[]).map((column) => column.name));
  assert.ok(aiColumns.has('requested_by'));
  assert.ok(aiColumns.has('provider_result_json'));
  const privateJobs = db.prepare(`SELECT kind,requested_by FROM ai_jobs WHERE kind IN ('social.reply_draft','social.report','intelligence.synthesize','social.analyze')`).all() as any[];
  assert.ok(privateJobs.every((job) => job.requested_by === 'migration-user'));
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM ai_jobs WHERE stage='duplicate_request_recovered'`).get().count, 3);
  assert.throws(() => db.prepare(`INSERT INTO social_reply_drafts
    (id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,created_at,updated_at)
    VALUES ('duplicate-after-migration','migration-mention','migration-connection','migration-user','helpful','same request','{}','queued',?,?)`).run(timestamp, timestamp), /UNIQUE/i);
});
