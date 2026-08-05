#!/usr/bin/env node

/** Destructive only to randomly named, isolated PostgreSQL test roles/database. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { assertRuntimePrivileges, assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.POSTGRES_TEST_CONTAINER || 'xplorer-postgres';
const host = process.env.POSTGRES_TEST_HOST || '127.0.0.1';
const port = Number(process.env.POSTGRES_TEST_PORT || 5432);
const suffix = crypto.randomBytes(5).toString('hex');
const database = `experience_migration_test_${suffix}`;
const ownerRole = `experience_owner_${suffix}`;
const appRole = `experience_app_${suffix}`;
const ownerPassword = crypto.randomBytes(24).toString('base64url');
const appPassword = crypto.randomBytes(24).toString('base64url');
const sourceSha256 = crypto.createHash('sha256').update(`source:${suffix}`).digest('hex');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-pg-runtime-'));
const passwordFile = path.join(temporaryDir, 'owner-password');
const migrationDir = path.join(temporaryDir, 'migrations');

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function emit(event, details = {}) { process.stdout.write(`${JSON.stringify({ event, ...details })}\n`); }

function dockerPsql(databaseName, sql, allowFailure = false) {
  const result = spawnSync('docker.exe', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-U', adminUser, '-d', databaseName], {
    input: sql,
    encoding: 'utf8',
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) throw new Error(`docker psql failed: ${result.stderr || result.stdout}`);
  return result;
}

function runUpgrade(extra = [], expectedStatus = 0) {
  const result = spawnSync(process.execPath, [
    path.join(projectDir, 'scripts', 'upgrade-postgres-schema.mjs'),
    '--target-version', '29',
    '--expected-source-version', '1',
    '--expected-source-sha256', sourceSha256,
    '--pg-host', host,
    '--pg-port', String(port),
    '--pg-database', database,
    '--pg-user', ownerRole,
    '--pg-password-file', passwordFile,
    '--pg-ssl', 'disable',
    '--json',
    ...extra
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, expectedStatus, `upgrade exit ${result.status}: ${result.stderr || result.stdout}`);
  return result;
}

const inspect = spawnSync('docker.exe', ['inspect', container], { encoding: 'utf8', windowsHide: true });
assert.equal(inspect.status, 0, `PostgreSQL test container ${container} is unavailable.`);
const containerDefinition = JSON.parse(inspect.stdout)[0];
const containerEnvironment = Object.fromEntries((containerDefinition.Config.Env || []).map((entry) => entry.split(/=(.*)/su).slice(0, 2)));
const adminUser = containerEnvironment.POSTGRES_USER;
const adminDatabase = containerEnvironment.POSTGRES_DB;
assert.ok(adminUser && adminDatabase, 'The PostgreSQL container does not expose its bootstrap identity.');

let ownerClient;
let appClient;
let mainSucceeded = false;
try {
  fs.writeFileSync(passwordFile, `${ownerPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.mkdirSync(migrationDir);
  dockerPsql(adminDatabase, `
    CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(ownerPassword)};
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(appPassword)};
  `);
  dockerPsql(adminDatabase, `CREATE DATABASE ${database} OWNER ${ownerRole};`);
  dockerPsql(adminDatabase, `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC; GRANT CONNECT ON DATABASE ${database} TO ${ownerRole},${appRole};`);

  ownerClient = new Client({ host, port, database, user: ownerRole, password: ownerPassword, ssl: false });
  await ownerClient.connect();
  await ownerClient.query(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE spaces (id TEXT PRIMARY KEY);
    -- Mirrors the cutover source (backend/src/spaces.ts createSpaceSchema). It is
    -- source-owned, not runtime-owned, so no migration creates it -- yet runtime
    -- 25 onwards declare composite membership foreign keys against it. Without it
    -- 0025 aborts with 42P01 and this harness can never reach the shipped window.
    CREATE TABLE space_memberships (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id)
    );
    CREATE INDEX space_memberships_user ON space_memberships(user_id,joined_at);
    CREATE TABLE tickets (id TEXT PRIMARY KEY);
    CREATE TABLE ai_jobs (id TEXT PRIMARY KEY,space_id TEXT,kind TEXT);
    CREATE TABLE surveys (id TEXT PRIMARY KEY,space_id TEXT NOT NULL);
    CREATE TABLE collectors (id TEXT PRIMARY KEY,survey_id TEXT NOT NULL);
    CREATE TABLE questions (id TEXT PRIMARY KEY,survey_id TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'rating');
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,collector_id TEXT,response_id TEXT,created_by_user_id TEXT,
      stored_filename TEXT NOT NULL,original_name TEXT NOT NULL,mime_type TEXT NOT NULL,size BIGINT NOT NULL,
      expires_at TEXT,created_at TEXT NOT NULL
    );
    CREATE TABLE social_reply_drafts (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,requested_by TEXT NOT NULL,mention_id TEXT NOT NULL,
      tone TEXT NOT NULL,instructions TEXT NOT NULL,state TEXT NOT NULL
    );
    CREATE UNIQUE INDEX social_reply_drafts_one_active_request
      ON social_reply_drafts(space_id,requested_by,mention_id,tone,instructions) WHERE state='queued';
    CREATE TABLE social_intelligence_reports (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,user_id TEXT NOT NULL,connection_id TEXT,
      title TEXT NOT NULL,mention_ids_json TEXT NOT NULL,state TEXT NOT NULL
    );
    CREATE UNIQUE INDEX social_intelligence_reports_one_active_request
      ON social_intelligence_reports(space_id,user_id,connection_id,title,mention_ids_json) WHERE state='queued';
    CREATE TABLE intelligence_reports (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,user_id TEXT NOT NULL,title TEXT NOT NULL,
      objective TEXT NOT NULL,source_refs_json TEXT NOT NULL,knowledge_refs_json TEXT NOT NULL,state TEXT NOT NULL
    );
    CREATE UNIQUE INDEX intelligence_reports_one_active_request
      ON intelligence_reports(space_id,user_id,title,objective,source_refs_json,knowledge_refs_json) WHERE state='queued';
    CREATE TABLE knowledge_bases (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      current_version INTEGER NOT NULL DEFAULT 0, last_indexed_at TEXT,
      chunker_version TEXT NOT NULL DEFAULT 'docling-hybrid-v1',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,space_id)
    );
    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL,
      sha256 TEXT NOT NULL, index_version INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'queued', chunk_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE TABLE knowledge_jobs (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', target_version INTEGER
    );
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE experience_schema_version (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
      version INTEGER NOT NULL,
      source_sha256 TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      manifest_json TEXT NOT NULL
    );
    INSERT INTO schema_migrations(version,name,applied_at) VALUES (1,'base','2026-01-01T00:00:00.000Z');
    INSERT INTO spaces(id) VALUES ('legacy-space');
    INSERT INTO knowledge_bases(id,space_id,status,current_version,chunker_version,created_at,updated_at)
      VALUES ('legacy-base','legacy-space','ready',7,'docling-hybrid-v1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO knowledge_jobs(id,space_id,knowledge_base_id,state,target_version) VALUES
      ('legacy-failed-a','legacy-space','legacy-base','failed',8),
      ('legacy-failed-b','legacy-space','legacy-base','failed',8);
  `);
  await ownerClient.query(`INSERT INTO experience_schema_version(singleton,version,source_sha256,migrated_at,manifest_json)
    VALUES (TRUE,1,$1,'2026-01-01T00:00:00.000Z','{}')`, [sourceSha256]);

  await ownerClient.query(`CREATE TABLE assistant_runs (
    id TEXT PRIMARY KEY,space_id TEXT NOT NULL,requested_by TEXT NOT NULL,ai_job_id TEXT,
    created_at TEXT NOT NULL,idempotency_key TEXT
  )`);
  const malformedAssistant = runUpgrade([], 1);
  assert.match(malformedAssistant.stderr, /RUNTIME_SCHEMA_COLUMN_MISMATCH/u);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 3);
  await ownerClient.query('DROP TABLE assistant_runs');
  emit('malformed_assistant_schema_rejected');

  runUpgrade(['--target-version', '22']);
  await assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 22 });
  await ownerClient.query(`
    INSERT INTO users(id) VALUES ('persona-owner');
    INSERT INTO spaces(id) VALUES ('persona-space');
    INSERT INTO journey_personas
      (id,space_id,name,summary,lifecycle_state,owner_user_id,source,attributes_json,goals_json,
       behaviours_json,needs_json,barriers_json,review_at,revision,created_at,updated_at)
    VALUES
      ('legacy-persona','persona-space','Field engineer','Works in low-connectivity sites','active',
       'persona-owner','workspace','{"region":"North","device":"mobile"}','["Complete inspection","Avoid rework"]',
       '["Works offline"]','["Clear status"]','["Unreliable signal"]','2026-09-01T00:00:00.000Z',4,
       '2026-01-01T00:00:00.000Z','2026-07-01T00:00:00.000Z'),
      ('malformed-persona','persona-space','Malformed legacy persona','Must fail closed','draft',
       'persona-owner','workspace','{}','not-json','[]','[]','[]',NULL,1,
       '2026-01-02T00:00:00.000Z','2026-07-02T00:00:00.000Z');
    INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
       published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES ('persona-map','persona-space','Inspection journey','Preserve a historical persona pin','customer',
      'current_state','evidence_backed','published','persona-owner',NULL,'persona-map-v1',30,2,
      '2026-01-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
    INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,
       industry,summary,legacy_audience,provenance_json,author_user_id,published_at,created_at)
    VALUES ('persona-map-v1','persona-map','persona-space',1,2,'published','current_state','evidence_backed',
      'customer','Inspect a site','Utilities','Legacy publication','Field engineer','{}','persona-owner',
      '2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
    INSERT INTO journey_definition_personas(definition_id,persona_id,space_id,ordinal,created_at)
    VALUES ('persona-map','legacy-persona','persona-space',0,'2026-07-01T00:00:00.000Z');
  `);
  const malformedPersona = runUpgrade([], 1);
  assert.match(malformedPersona.stderr, /cannot losslessly version malformed persona malformed-persona JSON/u);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 22);
  assert.equal((await ownerClient.query("SELECT to_regclass('public.journey_persona_versions') name")).rows[0].name, null);
  emit('runtime_23_malformed_persona_rollback_passed');
  await ownerClient.query("UPDATE journey_personas SET goals_json='[]' WHERE id='malformed-persona'");

  runUpgrade();
  runUpgrade();
  {
    const { generateRuntimeContractSource } = await import('./local-contract-generator.mjs');
    fs.writeFileSync(path.join(projectDir, '.local-contract-29.js'),
      await generateRuntimeContractSource((sql) => ownerClient.query(sql)), 'utf8');
    emit('contract_dump_written');
  }
  await assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 29 });
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 29);
  const backfilledPersona = (await ownerClient.query(`SELECT persona.*,version.version_number,version.name version_name,
      version.summary version_summary,version.attributes_json version_attributes_json,version.goals_json version_goals_json,
      version.behaviours_json version_behaviours_json,version.needs_json version_needs_json,
      version.barriers_json version_barriers_json,version.review_at version_review_at
    FROM journey_personas persona
    JOIN journey_persona_versions version ON version.id=persona.current_version_id
    WHERE persona.id='legacy-persona' AND persona.space_id='persona-space'`)).rows[0];
  assert.equal(Number(backfilledPersona.version_number), 1);
  for (const field of ['name','summary','attributes_json','goals_json','behaviours_json','needs_json','barriers_json']) {
    assert.equal(String(backfilledPersona[`version_${field}`]), String(backfilledPersona[field]), `lossless ${field} backfill`);
  }
  assert.equal(new Date(backfilledPersona.version_review_at).toISOString(), new Date(backfilledPersona.review_at).toISOString());
  assert.equal(Number((await ownerClient.query(`SELECT COUNT(*)::int count FROM journey_persona_claims
    WHERE persona_id='legacy-persona'`)).rows[0].count), 8);
  const historicalPin = (await ownerClient.query(`SELECT pin.persona_version_id,version.version_number
    FROM journey_map_version_personas pin JOIN journey_persona_versions version ON version.id=pin.persona_version_id
    WHERE pin.version_id='persona-map-v1' AND pin.persona_id='legacy-persona'`)).rows[0];
  assert.equal(Number(historicalPin.version_number), 1);
  emit('runtime_23_persona_lossless_backfill_passed');

  const researchHash = 'a'.repeat(64);
  await ownerClient.query(`
    INSERT INTO users(id) VALUES ('research-user');
    INSERT INTO spaces(id) VALUES ('research-space');
    INSERT INTO knowledge_bases(id,space_id,status,current_version,chunker_version,created_at,updated_at) VALUES
      ('research-base-a','research-space','ready',1,'docling-hybrid-v1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
      ('research-base-b','research-space','ready',1,'docling-hybrid-v1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO knowledge_documents
      (id,space_id,knowledge_base_id,sha256,index_version,state,chunk_count,created_at,updated_at) VALUES
      ('research-doc-a','research-space','research-base-a',repeat('b',64),1,'ready',1,
        '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO journey_research_sources
      (id,space_id,source_type,source_ref,adapter,intent_sha256,created_at,updated_at) VALUES
      ('research-source-a','research-space','knowledge_document','research-doc-a','knowledge',
        '${researchHash}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
      ('research-source-b','research-space','interview','research-interview-b','research_intake',
        '${researchHash}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO journey_research_snapshots
      (id,source_id,space_id,version_number,fingerprint,access_state,source_label,excerpt,population,
       metadata_json,created_by_user_id,created_at,retention_expires_at) VALUES
      ('research-snapshot-a','research-source-a','research-space',1,repeat('c',64),'available',
        'Document A','Content-free test excerpt','Customers','{}','research-user',
        '2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z'),
      ('research-snapshot-b','research-source-b','research-space',1,repeat('d',64),'available',
        'Interview B','Content-free test excerpt','Customers','{}','research-user',
        '2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z');
  `);

  await assert.rejects(ownerClient.query(`INSERT INTO journey_research_intakes
    (id,space_id,source_id,knowledge_base_id,knowledge_document_id,intake_kind,method,consent_basis,
     retention_expires_at,idempotency_key,intent_sha256,created_at)
    VALUES ('bad-intake-base','research-space','research-source-a','research-base-b','research-doc-a',
      'research_note','manual','documented','2027-01-01T00:00:00.000Z','bad-intake-base',$1,
      '2026-01-01T00:00:00.000Z')`, [researchHash]), (error) => error?.code === '23503');
  await assert.rejects(ownerClient.query(`INSERT INTO journey_research_links
    (id,space_id,source_id,snapshot_id,target_type,target_id,intent_sha256,created_at,updated_at)
    VALUES ('bad-link-snapshot','research-space','research-source-a','research-snapshot-b','stage','stage-a',$1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`, [researchHash]),
  (error) => error?.code === '23503');
  await assert.rejects(ownerClient.query(`INSERT INTO journey_research_refresh_runs
    (id,space_id,source_id,trigger_kind,available_at,before_snapshot_id,idempotency_key,intent_sha256,
     created_at,updated_at)
    VALUES ('bad-refresh-snapshot','research-space','research-source-a','manual','2026-01-01T00:00:00.000Z',
      'research-snapshot-b','bad-refresh-snapshot',$1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`,
  [researchHash]), (error) => error?.code === '23503');
  await ownerClient.query(`INSERT INTO journey_research_notifications
    (id,space_id,user_id,source_id,kind,dedupe_key,created_at)
    VALUES ('manual-notification-a','research-space','research-user','research-source-a','source_stale',
      'manual:source-stale:research-source-a','2026-01-01T00:00:00.000Z')`);
  await assert.rejects(ownerClient.query(`INSERT INTO journey_research_notifications
    (id,space_id,user_id,source_id,kind,dedupe_key,created_at)
    VALUES ('manual-notification-b','research-space','research-user','research-source-a','source_stale',
      'manual:source-stale:research-source-a','2026-01-01T00:00:00.000Z')`),
  (error) => error?.code === '23505');
  emit('journey_research_hub_tenant_constraints_passed');

  const largeSelection = JSON.stringify(Array.from({ length: 200 }, (_, index) =>
    `${String(index).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`));
  await ownerClient.query(`INSERT INTO social_intelligence_reports
    (id,space_id,user_id,connection_id,title,mention_ids_json,state) VALUES ('large-report','legacy-space','user','connection','Large report',$1,'failed')`, [largeSelection]);
  await ownerClient.query("UPDATE social_intelligence_reports SET state='queued' WHERE id='large-report'");
  await ownerClient.query(`INSERT INTO social_reply_drafts
    (id,space_id,requested_by,mention_id,tone,instructions,state) VALUES ('large-reply','legacy-space','user','mention','helpful',$1,'queued')`, ['x'.repeat(32_000)]);
  await ownerClient.query(`INSERT INTO intelligence_reports
    (id,space_id,user_id,title,objective,source_refs_json,knowledge_refs_json,state)
    VALUES ('large-intelligence','legacy-space','user','Large intelligence',$1,$2,$3,'queued')`,
  ['o'.repeat(16_000), largeSelection, largeSelection]);
  emit('bounded_active_request_indexes_passed');
  const managedPlans = await ownerClient.query(`SELECT code,requestable,version FROM platform_subscription_plans ORDER BY display_order`);
  assert.deepEqual(managedPlans.rows.map((row) => [row.code, Number(row.requestable), Number(row.version)]), [
    ['starter', 1, 1], ['team', 1, 1], ['enterprise', 1, 1]
  ]);
  const controlRoles = await ownerClient.query(`SELECT id,built_in,version FROM platform_rbac_roles ORDER BY id`);
  assert.deepEqual(controlRoles.rows.map((row) => [row.id, Number(row.built_in), Number(row.version)]), [
    ['admin', 1, 1], ['editor', 1, 1], ['viewer', 1, 1]
  ]);
  const controlPermissions = await ownerClient.query(`SELECT role_id,COUNT(*)::int count
    FROM platform_rbac_role_permissions GROUP BY role_id ORDER BY role_id`);
  assert.deepEqual(controlPermissions.rows, [
    { role_id: 'admin', count: 21 }, { role_id: 'editor', count: 19 }, { role_id: 'viewer', count: 12 }
  ]);
  const assistantTables = (await ownerClient.query(`SELECT to_regclass(name) name FROM unnest(ARRAY[
    'assistant_nylas_connections','assistant_nylas_oauth_states','assistant_runs',
    'assistant_actions','assistant_reminders','assistant_audit_events','assistant_outbound_messages'
  ]) AS names(name)`)).rows;
  assert.ok(assistantTables.every((row) => row.name), 'Runtime schema 5 assistant tables are incomplete.');
  const assistantColumns = (await ownerClient.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND (table_name,column_name) IN (
      ('assistant_nylas_connections','grant_id_enc'),('assistant_nylas_connections','grant_fingerprint'),
      ('assistant_runs','input_snapshot_json'),('assistant_runs','request_fingerprint'),
      ('assistant_runs','advisory_only'),('assistant_runs','external_dispatched'))`)).rows;
  assert.equal(assistantColumns.length, 6, 'Runtime assistant privacy/idempotency columns are incomplete.');
  const phase1Columns = (await ownerClient.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND (table_name,column_name) IN (
      ('assistant_runs','document_type'),('assistant_runs','title'),('assistant_runs','knowledge_base_ids_json'),
      ('assistant_actions','source_run_id'),('assistant_actions','revision'),
      ('assistant_reminders','remind_at'),('assistant_audit_events','detail_json'))`)).rows;
  assert.equal(phase1Columns.length, 7, 'Runtime schema 5 assistant work-product/action/audit columns are incomplete.');
  const profiles = (await ownerClient.query(`SELECT provider,model,revision,dtype,dimensions,vector_index_version
    FROM knowledge_embedding_profiles ORDER BY vector_index_version`)).rows;
  assert.deepEqual(profiles.map((row) => [row.provider, row.dtype, Number(row.dimensions), row.vector_index_version]), [
    ['gte-node', 'q8', 768, 'gte-modernbert-v1'],
    ['qwen-tei', 'float16', 2560, 'qwen-v1']
  ]);
  const migrationTables = (await ownerClient.query(`SELECT to_regclass(name) name FROM unnest(ARRAY[
    'knowledge_base_embedding_profiles','knowledge_document_embeddings','knowledge_backfill_runs','knowledge_backfill_items'
  ]) AS names(name)`)).rows;
  assert.ok(migrationTables.every((row) => row.name), 'Runtime schema 3 embedding migration tables are incomplete.');
  assert.equal((await ownerClient.query(`SELECT COUNT(*)::int count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_jobs' AND column_name='embedding_profile_id'`)).rows[0].count, 1);
  const fencingIndexes = (await ownerClient.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('knowledge_jobs_one_processing_base','knowledge_jobs_unique_target_version') ORDER BY indexname`)).rows;
  assert.deepEqual(fencingIndexes.map((row) => row.indexname),
    ['knowledge_jobs_one_processing_base','knowledge_jobs_unique_target_version']);
  const leaseColumns = (await ownerClient.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_jobs' AND column_name IN
      ('lease_owner','lease_token','lease_generation','lease_acquired_at','lease_expires_at','heartbeat_at')`)).rows;
  assert.equal(leaseColumns.length, 6);
  const legacyReservations = await ownerClient.query(`SELECT COUNT(*)::int count,
    SUM(target_version_reserved)::int reserved FROM knowledge_jobs WHERE knowledge_base_id='legacy-base' AND target_version=8`);
  assert.deepEqual(legacyReservations.rows[0], { count: 2, reserved: 0 });
  assert.equal(Number((await ownerClient.query(`SELECT last_allocated_version FROM knowledge_bases
    WHERE id='legacy-base'`)).rows[0].last_allocated_version), 8);
  emit('upgrade_and_idempotency_passed');

  const wrongSource = spawnSync(process.execPath, [
    path.join(projectDir, 'scripts', 'upgrade-postgres-schema.mjs'), '--target-version', '10',
    '--expected-source-version', '1', '--expected-source-sha256', 'f'.repeat(64),
    '--pg-host', host, '--pg-port', String(port), '--pg-database', database,
    '--pg-user', ownerRole, '--pg-password-file', passwordFile, '--pg-ssl', 'disable', '--json'
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.notEqual(wrongSource.status, 0);
  assert.match(wrongSource.stderr, /SOURCE_SCHEMA_PRECONDITION_FAILED/u);
  emit('source_precondition_passed');

  const sourceMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0002_platform_administration.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0002_platform_administration.sql'), sourceMigration.replace(/\r?\n/gu, '\r\n'));
  const embeddingMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0003_knowledge_embedding_profiles.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0003_knowledge_embedding_profiles.sql'), embeddingMigration.replace(/\r?\n/gu, '\r\n'));
  const assistantMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0004_experience_assistant.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0004_experience_assistant.sql'), assistantMigration.replace(/\r?\n/gu, '\r\n'));
  const assistantPhase1Migration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0005_experience_assistant_phase1.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0005_experience_assistant_phase1.sql'), assistantPhase1Migration.replace(/\r?\n/gu, '\r\n'));
  const reviewedIntelligenceMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0006_reviewed_social_intelligence_publications.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0006_reviewed_social_intelligence_publications.sql'), reviewedIntelligenceMigration.replace(/\r?\n/gu, '\r\n'));
  const reviewedReplyMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0007_assistant_reviewed_replies.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0007_assistant_reviewed_replies.sql'), reviewedReplyMigration.replace(/\r?\n/gu, '\r\n'));
  const adminControlMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0008_admin_control_plane.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0008_admin_control_plane.sql'), adminControlMigration.replace(/\r?\n/gu, '\r\n'));
  const managedPlanMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0009_managed_subscription_plans.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0009_managed_subscription_plans.sql'), managedPlanMigration.replace(/\r?\n/gu, '\r\n'));
  const deepAnalysisMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0010_deep_corpus_analysis.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0010_deep_corpus_analysis.sql'), deepAnalysisMigration.replace(/\r?\n/gu, '\r\n'));
  const boundedIndexMigration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', '0011_bounded_active_request_indexes.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationDir, '0011_bounded_active_request_indexes.sql'), boundedIndexMigration.replace(/\r?\n/gu, '\r\n'));
  for (const name of [
    '0012_journey_map_v2.sql', '0013_governed_journey_templates.sql',
    '0014_journey_evidence_lifecycle.sql', '0015_subscription_usage_ledger.sql',
    '0016_journey_event_control_plane.sql', '0017_journey_event_data_plane.sql',
    '0018_journey_stage_processing.sql', '0019_journey_research_hub.sql',
    '0020_journey_v2_rollout.sql', '0021_journey_metric_observations.sql',
    '0022_journey_ai_suggestions.sql', '0023_versioned_journey_personas.sql',
    '0024_journey_rich_cards.sql', '0025_journey_metric_alerts.sql', '0026_journey_saved_views.sql',
    '0027_journey_portfolio.sql', '0028_journey_collaboration.sql',
    '0029_journey_hierarchy_blueprints.sql'
  ]) {
    const migration = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', name), 'utf8');
    fs.writeFileSync(path.join(migrationDir, name), migration.replace(/\r?\n/gu, '\r\n'));
  }
  runUpgrade(['--target-version', '29', '--migrations-dir', migrationDir]);
  // Numbered above the highest committed migration on purpose. While this
  // fixture was 0027 it collided with the real 0027 the moment the copy list
  // above reached it, and migrationsIn would abort with
  // MIGRATION_VERSION_DUPLICATE -- a rollback gate that fails for the wrong
  // reason proves nothing about rollback.
  fs.writeFileSync(path.join(migrationDir, '0030_intentional_failure.sql'), `CREATE TABLE should_rollback(id TEXT PRIMARY KEY);\nSELECT * FROM definitely_missing_table;\n`);
  const failedUpgrade = runUpgrade(['--target-version', '30', '--migrations-dir', migrationDir], 1);
  assert.match(failedUpgrade.stderr, /definitely_missing_table/u);
  assert.equal((await ownerClient.query("SELECT to_regclass('public.should_rollback') name")).rows[0].name, null);
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 29);
  emit('checksum_normalization_and_rollback_passed');
  fs.rmSync(path.join(migrationDir, '0030_intentional_failure.sql'));
  runUpgrade(['--target-version', '29', '--migrations-dir', migrationDir]);
  runUpgrade(['--target-version', '29', '--migrations-dir', migrationDir]);
  await assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 29 });
  assert.equal(Number((await ownerClient.query('SELECT MAX(version) version FROM experience_runtime_schema_version')).rows[0].version), 29);
  emit('runtime_29_hierarchy_blueprint_schema_passed');

  let privilegeSql = fs.readFileSync(path.join(projectDir, 'backend', 'migrations', 'postgres', 'runtime_privileges.sql'), 'utf8');
  privilegeSql = privilegeSql.replaceAll('__DATABASE__', database).replaceAll('__APP_ROLE__', appRole).replaceAll('__OWNER_ROLE__', ownerRole);
  dockerPsql(database, privilegeSql);
  await assertRuntimePrivileges((sql) => ownerClient.query(sql), appRole, { schema: 'public', runtimeVersion: 29 });
  appClient = new Client({ host, port, database, user: appRole, password: appPassword, ssl: false });
  await appClient.connect();
  const directPersonaInsert = `INSERT INTO journey_personas
    (id,space_id,name,summary,lifecycle_state,owner_user_id,source,attributes_json,goals_json,behaviours_json,
     needs_json,barriers_json,review_at,revision,created_at,updated_at,current_version_id)
    VALUES ($1,'persona-space',$2,'Direct write must fail','draft','persona-owner','workspace','{}','[]','[]',
      '[]','[]',NULL,1,'2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z',$3)`;
  await assert.rejects(appClient.query(directPersonaInsert, ['direct-null-persona','Direct null persona',null]),
    (error) => error?.code === '23502');
  await assert.rejects(appClient.query(directPersonaInsert,
    ['direct-orphan-persona','Direct orphan persona','missing-persona-version']),
  (error) => error?.code === '23503');
  assert.equal(Number((await ownerClient.query(`SELECT COUNT(*)::int count FROM journey_personas
    WHERE id IN ('direct-null-persona','direct-orphan-persona')`)).rows[0].count), 0);
  emit('journey_persona_direct_orphan_insert_denied');
  await assert.rejects(appClient.query("UPDATE experience_schema_version SET migrated_at='changed'"), (error) => error?.code === '42501');
  await assert.rejects(appClient.query("DELETE FROM platform_audit_events"), (error) => error?.code === '42501');
  await assert.rejects(appClient.query("DELETE FROM assistant_audit_events"), (error) => error?.code === '42501');
  for (const table of ['journey_research_snapshots','journey_research_assessments','journey_research_intakes',
    'journey_research_refresh_attempts','journey_research_audit_events']) {
    await assert.rejects(appClient.query(`UPDATE ${table} SET id=id`), (error) => error?.code === '42501');
    await assert.rejects(appClient.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  await assert.rejects(appClient.query('UPDATE journey_v2_divergences SET id=id'), (error) => error?.code === '42501');
  await assert.rejects(appClient.query('DELETE FROM journey_v2_divergences'), (error) => error?.code === '42501');
  for (const table of ['journey_metric_definition_versions','journey_metric_imports',
    'journey_metric_rebuild_attempts','journey_metric_observations','journey_metric_observation_sources',
    'journey_metric_audit_events']) {
    await assert.rejects(appClient.query(`UPDATE ${table} SET id=id`), (error) => error?.code === '42501');
    await assert.rejects(appClient.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  for (const table of ['journey_ai_suggestion_evidence','journey_ai_suggestion_changes',
    'journey_ai_suggestion_decisions','journey_ai_suggestion_audit_events',
    'journey_ai_suggestion_purge_receipts']) {
    await assert.rejects(appClient.query(`UPDATE ${table} SET id=id`), (error) => error?.code === '42501');
    await assert.rejects(appClient.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  await assert.rejects(appClient.query('DELETE FROM journey_ai_suggestion_runs'), (error) => error?.code === '42501');
  await assert.rejects(appClient.query(
    "SELECT journey_ai_suggestion_controlled_purge('legacy-space',NULL,'privacy_erasure','CHG-123456')"),
  (error) => error?.code === '42501');
  for (const table of ['journey_persona_versions','journey_persona_claims','journey_persona_claim_evidence',
    'journey_persona_review_events','journey_map_version_personas']) {
    await assert.rejects(appClient.query(`UPDATE ${table} SET space_id=space_id`), (error) => error?.code === '42501');
    await assert.rejects(appClient.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  for (const table of ['journey_channel_versions','journey_touchpoint_versions','journey_rich_card_audit_events']) {
    await assert.rejects(appClient.query(`UPDATE ${table} SET id=id`), (error) => error?.code === '42501');
    await assert.rejects(appClient.query(`DELETE FROM ${table}`), (error) => error?.code === '42501');
  }
  await assert.rejects(appClient.query('DELETE FROM journey_asset_blob_purge_outbox'),
    (error) => error?.code === '42501');
  await appClient.query(`INSERT INTO platform_audit_events
    (id,action,target_type,target_id,created_at) VALUES ('test','read','test','test','2026-01-01T00:00:00.000Z')`);
  emit('atomic_least_privilege_passed');

  await ownerClient.query('BEGIN');
  try {
    await ownerClient.query('ALTER TABLE assistant_runs DROP COLUMN output_json');
    await assert.rejects(
      assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 29 }),
      (error) => error?.code === 'RUNTIME_SCHEMA_COLUMN_MISMATCH'
    );
  } finally { await ownerClient.query('ROLLBACK'); }
  emit('assistant_schema_drift_detection_passed');

  await ownerClient.query('BEGIN');
  try {
    await ownerClient.query('DROP TRIGGER journey_persona_claims_immutable ON journey_persona_claims');
    await assert.rejects(
      assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 29 }),
      (error) => error?.code === 'RUNTIME_SCHEMA_TRIGGER_MISMATCH'
    );
  } finally { await ownerClient.query('ROLLBACK'); }
  emit('journey_persona_immutability_drift_detection_passed');

  await ownerClient.query('DROP INDEX platform_audit_events_target');
  await assert.rejects(
    assertRuntimeSchemaContract((sql) => ownerClient.query(sql), { schema: 'public', runtimeVersion: 29 }),
    (error) => error?.code === 'RUNTIME_SCHEMA_INDEX_MISMATCH'
  );
  emit('schema_drift_detection_passed');
  emit('postgres_runtime_migration_tests_passed', { database });
  mainSucceeded = true;
} finally {
  await appClient?.end().catch(() => {});
  await ownerClient?.end().catch(() => {});
  // These were one batched psql call under ON_ERROR_STOP=1 with allowFailure=true
  // and an uninspected result. pg_terminate_backend only *sends* SIGTERM, so the
  // following DROP DATABASE could still lose the race and fail with 55006; the
  // batch then aborted, both DROP ROLE statements never ran, the error was
  // discarded, and the script still exited 0. That leaks the database and both
  // roles together -- and because the roles own/are granted on the database
  // (pg_shdepend), they can only be dropped after it, never before. Separate
  // calls, WITH (FORCE), and recorded failures.
  const cleanupFailures = [];
  const cleanupStep = (label, sql) => {
    const result = dockerPsql(adminDatabase, sql, true);
    if (result.error || result.status !== 0) {
      cleanupFailures.push(`${label}: ${result.stderr || result.stdout || result.error?.message || 'failed'}`);
      return false;
    }
    return true;
  };
  dockerPsql(adminDatabase, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname=${literal(database)} AND pid<>pg_backend_pid();`, true);
  // WITH (FORCE) (PG13+) closes the terminate/drop race outright; the plain form
  // remains the fallback for an older server.
  if (dockerPsql(adminDatabase, `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`, true).status !== 0) {
    cleanupStep(`database ${database}`, `DROP DATABASE IF EXISTS ${database};`);
  }
  cleanupStep(`role ${appRole}`, `DROP ROLE IF EXISTS ${appRole};`);
  cleanupStep(`role ${ownerRole}`, `DROP ROLE IF EXISTS ${ownerRole};`);
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  if (cleanupFailures.length) {
    emit('postgres_runtime_migration_cleanup_failed', { database, failures: cleanupFailures });
    if (mainSucceeded) throw new Error(`PostgreSQL runtime migration cleanup failed: ${cleanupFailures.join('; ')}`);
  } else {
    emit('postgres_runtime_migration_cleanup_complete', { database });
  }
}
