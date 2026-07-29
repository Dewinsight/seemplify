import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-x-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const now = '2026-01-01T00:00:00.000Z';
const legacy = new Database(databasePath);

legacy.pragma('foreign_keys = ON');
legacy.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE x_apps (
    id TEXT PRIMARY KEY,
    consumer_key_enc TEXT,
    consumer_secret_enc TEXT,
    bearer_token_enc TEXT,
    billing_status TEXT NOT NULL DEFAULT 'unknown',
    billing_problem_type TEXT,
    billing_checked_at TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    configured_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE x_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES x_apps(id) ON DELETE CASCADE,
    access_token_enc TEXT NOT NULL,
    access_token_secret_enc TEXT,
    x_user_id TEXT,
    username TEXT,
    display_name TEXT,
    profile_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending_verification',
    auto_sync INTEGER NOT NULL DEFAULT 0,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    next_sync_at TEXT,
    last_sync_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    rate_limit_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX x_connections_schedule ON x_connections(auto_sync,next_sync_at);
  CREATE TABLE x_listening_queries (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    query TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    since_id TEXT,
    last_sync_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX x_listening_queries_connection ON x_listening_queries(connection_id,enabled,created_at);
  CREATE TABLE x_sync_jobs (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    run_after TEXT,
    posts_fetched INTEGER NOT NULL DEFAULT 0,
    mentions_fetched INTEGER NOT NULL DEFAULT 0,
    search_fetched INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    analysis_job_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX x_sync_jobs_dispatch ON x_sync_jobs(state,run_after,created_at);
  CREATE UNIQUE INDEX x_sync_jobs_one_active ON x_sync_jobs(connection_id)
    WHERE state IN ('queued','processing','waiting_rate_limit');
  CREATE TABLE social_mentions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    analysis_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX social_mentions_published ON social_mentions(published_at DESC);
  CREATE TABLE x_connection_mentions (
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    mention_id TEXT NOT NULL REFERENCES social_mentions(id) ON DELETE CASCADE,
    streams_json TEXT NOT NULL DEFAULT '[]',
    query_ids_json TEXT NOT NULL DEFAULT '[]',
    discovered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(connection_id,mention_id)
  );
  CREATE INDEX x_connection_mentions_recent ON x_connection_mentions(connection_id,last_seen_at DESC);
`);

legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
  VALUES ('legacy-user','legacy@example.test','Legacy Researcher','legacy-password-hash','member',?,?)`).run(now, now);
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
  VALUES ('probe-user','probe@example.test','Probe Researcher','probe-password-hash','member',?,?)`).run(now, now);
legacy.prepare(`INSERT INTO x_apps (
  id,consumer_key_enc,consumer_secret_enc,bearer_token_enc,billing_status,billing_problem_type,billing_checked_at,credential_version,configured_by,created_at,updated_at
) VALUES ('legacy-app','enc:consumer-key','enc:consumer-secret','enc:bearer-token','checking_credits','credits-depleted',?,7,'legacy-user',?,?)`).run(now, now, now);
legacy.prepare(`INSERT INTO x_apps (
  id,consumer_key_enc,consumer_secret_enc,bearer_token_enc,billing_status,billing_problem_type,billing_checked_at,credential_version,configured_by,created_at,updated_at
) VALUES ('probe-app','enc:probe-consumer-key','enc:probe-consumer-secret','enc:probe-bearer-token','checking_credits','credits-depleted',?,3,'probe-user',?,?)`).run(now, now, now);
legacy.prepare(`INSERT INTO x_connections (
  id,user_id,app_id,access_token_enc,access_token_secret_enc,x_user_id,username,display_name,profile_image_url,status,
  auto_sync,sync_interval_minutes,next_sync_at,last_sync_at,last_success_at,last_error,
  rate_limit_json,created_at,updated_at
) VALUES (
  'legacy-connection','legacy-user','legacy-app','enc:access-token','enc:access-secret','100000000000000001',
  'legacy_account','Legacy Account','https://images.example.test/legacy.png','connected',1,30,
  '2026-01-01T01:00:00.000Z','2025-12-31T23:55:00.000Z','2025-12-31T23:56:00.000Z',
  'legacy transient error','{"remaining":17}',?,?
)`).run(now, now);
legacy.prepare(`INSERT INTO x_connections (
  id,user_id,app_id,access_token_enc,access_token_secret_enc,x_user_id,username,display_name,profile_image_url,status,
  auto_sync,sync_interval_minutes,next_sync_at,last_sync_at,last_success_at,last_error,rate_limit_json,created_at,updated_at
) VALUES (
  'probe-connection','probe-user','probe-app','enc:probe-access-token','enc:probe-access-secret','100000000000000002',
  'probe_account','Probe Account',NULL,'action_required',0,60,NULL,NULL,NULL,'retrying credit probe','{}',?,?
)`).run(now, now);
legacy.prepare(`INSERT INTO x_listening_queries (
  id,connection_id,label,query,enabled,since_id,last_sync_at,last_success_at,last_error,created_at,updated_at
) VALUES (
  'legacy-query','legacy-connection','Product watch','seemplify OR \"customer experience\"',1,'search-700',
  '2025-12-31T23:50:00.000Z','2025-12-31T23:51:00.000Z','previous query warning',?,?
)`).run(now, now);
legacy.prepare(`INSERT INTO x_sync_jobs (
  id,connection_id,trigger_type,state,stage,progress,attempt,run_after,posts_fetched,mentions_fetched,search_fetched,
  imported_count,analysis_job_id,error,created_at,started_at,completed_at,updated_at
) VALUES (
  'probe-sync','probe-connection','manual','queued','retrying',10,2,'2026-01-01T00:10:00.000Z',
  0,0,0,0,NULL,'temporary provider failure',?,NULL,NULL,?
)`).run(now, now);
legacy.prepare(`INSERT INTO x_sync_jobs (
  id,connection_id,trigger_type,state,stage,progress,attempt,run_after,posts_fetched,mentions_fetched,search_fetched,
  imported_count,analysis_job_id,error,created_at,started_at,completed_at,updated_at
) VALUES (
  'legacy-sync','legacy-connection','scheduled','waiting_billing','waiting_billing',35,3,'2026-01-01T00:05:00.000Z',
  4,5,6,7,'legacy-analysis-job','billing paused',?,'2025-12-31T23:59:00.000Z',NULL,?
)`).run(now, now);
legacy.prepare(`INSERT INTO social_mentions (
  id,source,author,content,url,language,published_at,metadata_json,analysis_json,created_at
) VALUES (
  'legacy-mention','x','@legacy_author','Legacy customer feedback','https://x.example.test/status/800','en',
  '2025-12-31T23:45:00.000Z','{"legacy":true}','{"sentiment":"positive"}',?
)`).run(now);
legacy.prepare(`INSERT INTO x_connection_mentions (
  connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at
) VALUES (
  'legacy-connection','legacy-mention','["mentions","search"]','["legacy-query"]',
  '2025-12-31T23:46:00.000Z','2025-12-31T23:57:00.000Z'
)`).run();
legacy.close();

Object.assign(process.env, {
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: path.join(root, 'uploads'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign')
});

const { db } = await import('../src/database.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy single-account X schema migrates without losing account history or foreign keys', () => {
  const connection = db.prepare(`SELECT * FROM x_connections WHERE id='legacy-connection'`).get() as any;
  assert.equal(connection.user_id, 'legacy-user');
  assert.equal(connection.app_id, 'legacy-app');
  assert.equal(connection.access_token_enc, 'enc:access-token');
  assert.equal(connection.access_token_secret_enc, 'enc:access-secret');
  assert.equal(connection.x_user_id, '100000000000000001');
  assert.equal(connection.generation, 1);
  assert.equal(connection.last_post_id, null);
  assert.equal(connection.last_mention_id, null);
  assert.equal(connection.rate_limit_json, '{"remaining":17}');

  const app = db.prepare(`SELECT * FROM x_apps WHERE id='legacy-app'`).get() as any;
  assert.equal(app.consumer_key_enc, 'enc:consumer-key');
  assert.equal(app.consumer_secret_enc, 'enc:consumer-secret');
  assert.equal(app.bearer_token_enc, 'enc:bearer-token');
  assert.equal(app.credential_version, 7);
  assert.equal(app.billing_status, 'credits_depleted', 'startup must repair checking_credits when no dispatchable probe exists');

  const query = db.prepare(`SELECT * FROM x_listening_queries WHERE id='legacy-query'`).get() as any;
  assert.equal(query.connection_id, 'legacy-connection');
  assert.equal(query.since_id, 'search-700');
  assert.equal(query.last_success_at, '2025-12-31T23:51:00.000Z');

  const syncJob = db.prepare(`SELECT * FROM x_sync_jobs WHERE id='legacy-sync'`).get() as any;
  assert.equal(syncJob.connection_id, 'legacy-connection');
  assert.equal(syncJob.state, 'waiting_billing');
  assert.equal(syncJob.attempt, 3);
  assert.equal(syncJob.imported_count, 7);
  assert.equal(syncJob.analysis_job_id, 'legacy-analysis-job');
  assert.equal(syncJob.credit_probe, 0);
  const recoveredProbe = db.prepare(`SELECT s.state,s.stage,s.credit_probe,a.billing_status FROM x_sync_jobs s
    JOIN x_connections c ON c.id=s.connection_id JOIN x_apps a ON a.id=c.app_id WHERE s.id='probe-sync'`).get() as any;
  assert.deepEqual(recoveredProbe, { state: 'queued', stage: 'retrying', credit_probe: 1, billing_status: 'checking_credits' });

  const linkedMention = db.prepare(`SELECT cm.*,m.content,m.analysis_json
    FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id='legacy-connection' AND cm.mention_id='legacy-mention'`).get() as any;
  assert.equal(linkedMention.content, 'Legacy customer feedback');
  assert.equal(linkedMention.analysis_json, '{"sentiment":"positive"}');
  assert.equal(linkedMention.streams_json, '["mentions","search"]');
  assert.equal(linkedMention.query_ids_json, '["legacy-query"]');

  const columns = new Set((db.prepare('PRAGMA table_info(x_connections)').all() as any[])
    .map((column) => String(column.name)));
  for (const column of ['refresh_token_enc', 'auth_type', 'scopes_json', 'token_expires_at']) {
    assert.ok(columns.has(column), `migrated X connection is missing ${column}`);
  }
  const syncColumns = new Set((db.prepare('PRAGMA table_info(x_sync_jobs)').all() as any[]).map((column) => String(column.name)));
  assert.ok(syncColumns.has('credit_probe'));
  assert.equal(connection.refresh_token_enc, null);
  assert.equal(connection.auth_type, 'oauth1');
  assert.equal(connection.scopes_json, '[]');
  assert.equal(connection.token_expires_at, null);

  assert.doesNotThrow(() => db.prepare(`INSERT INTO x_connections (
    id,user_id,app_id,access_token_enc,access_token_secret_enc,x_user_id,username,status,created_at,updated_at
  ) VALUES (
    'second-connection','legacy-user','legacy-app','enc:second-access','enc:second-secret','100000000000000002',
    'second_account','connected',?,?
  )`).run(now, now));
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM x_connections WHERE user_id='legacy-user'`).get() as any).count, 2);

  const activeIndex = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type='index' AND name='x_sync_jobs_one_active'`).get() as any;
  assert.match(String(activeIndex.sql), /waiting_billing/i);
  assert.throws(() => db.prepare(`INSERT INTO x_sync_jobs (
    id,connection_id,trigger_type,state,stage,created_at,updated_at
  ) VALUES ('duplicate-active-sync','legacy-connection','manual','queued','queued',?,?)`).run(now, now), /UNIQUE constraint failed/);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
