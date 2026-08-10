import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here,
  '../migrations/postgres/0052_journey_operational_stage_feed.sql'), 'utf8');
const privileges = fs.readFileSync(path.resolve(here,
  '../migrations/postgres/runtime52_operational_stage_feed_privileges.sql'), 'utf8');

test('runtime 52 is upgrader-registered and requires exact predecessor 51', () => {
  assert.match(migration, /MAX\(version\)[\s\S]*<>51/u);
  assert.match(migration, /runtime-52 journey operational stage feed requires runtime-51/u);
  assert.doesNotMatch(migration, /INSERT INTO experience_runtime_schema_version/u);
});

test('runtime 52 persists versioned governance, fenced delivery, tombstones and a separate timeline bridge', () => {
  for (const table of ['journey_operational_stage_mappings', 'journey_operational_stage_mapping_versions',
    'journey_operational_stage_source_revisions', 'journey_operational_stage_outbox',
    'journey_operational_stage_outbox_attempts', 'journey_operational_stage_checkpoints',
    'journey_operational_stage_tombstones', 'journey_operational_timeline_revisions',
    'journey_operational_stage_feed_audit']) assert.match(migration, new RegExp(`CREATE TABLE ${table}`, 'u'));
  assert.match(migration, /source_kind='service_recovery_ticket'/u);
  assert.match(migration, /\$\[\*\] \? \(!\(@ like_regex "\^\[a-f0-9\]\{64\}\$"\)\)/u);
  assert.doesNotMatch(migration, /source_kind[^\n]*social/u);
  assert.match(migration, /governance_receipt_id[^\n]*NOT NULL/u);
  assert.match(migration, /lease_generation/u);
  assert.match(migration, /supersedes_revision_id/u);
  assert.match(migration, /operation TEXT NOT NULL CHECK\(operation IN \('upsert','delete'\)\)/u);
});

test('runtime 52 forbids raw communication fields and separates worker privileges', () => {
  assert.match(migration, /NOT \(projection_json \?\| ARRAY\['title','notes','detail','content','body','message','email','name','token','respondentToken'\]\)/u);
  assert.match(migration, /idempotency_key_hmac/u);
  assert.match(privileges, /REVOKE UPDATE,DELETE ON journey_operational_stage_source_revisions/u);
  assert.match(privileges, /GRANT SELECT,UPDATE,DELETE ON journey_operational_stage_outbox TO __OPERATIONAL_FEED_WORKER_ROLE__/u);
  assert.match(privileges, /GRANT DELETE ON journey_operational_stage_source_revisions/u);
  assert.match(migration, /journey_operational_stage_retention_delete_guard/u);
});
