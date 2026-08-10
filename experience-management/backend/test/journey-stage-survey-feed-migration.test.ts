import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const migration = fs.readFileSync(path.resolve(import.meta.dirname,
  '../migrations/postgres/0043_journey_stage_survey_feed.sql'), 'utf8');

test('runtime 43 is standalone and requires exact runtime 42 without advancing aggregate metadata', () => {
  assert.match(migration, /MAX\(version\)[\s\S]*<>42/u);
  assert.match(migration, /runtime-43 journey stage survey feed requires runtime-42/u);
  assert.doesNotMatch(migration, /INSERT INTO experience_runtime_schema_version/iu);
});

test('runtime 43 persists immutable governance, source revisions and a fenced outbox', () => {
  for (const table of ['journey_stage_source_mappings', 'journey_stage_source_mapping_versions',
    'journey_stage_survey_policies', 'journey_stage_survey_policy_versions',
    'journey_stage_survey_governance_receipts', 'journey_stage_survey_source_revisions',
    'journey_stage_survey_outbox', 'journey_stage_survey_outbox_attempts',
    'journey_stage_survey_checkpoints', 'journey_stage_survey_feed_audit']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`, 'u'));
  }
  assert.match(migration, /lease_generation INTEGER NOT NULL/u);
  assert.match(migration, /UNIQUE\(outbox_id,lease_generation\)/u);
  assert.match(migration, /journey_stage_survey_governance_receipts_append_only/u);
  assert.match(migration, /journey_stage_survey_source_revisions_append_only/u);
  assert.match(migration, /NOT \(projection_json \?\| ARRAY\['answer','answers','text','content','body','email','name','respondentToken','token'\]\)/u);
});

test('runtime 43 stores source identities and idempotency as hashes only', () => {
  assert.match(migration, /survey_id_hmac TEXT NOT NULL/u);
  assert.match(migration, /collector_id_hmac TEXT NOT NULL/u);
  assert.match(migration, /response_id_hmac TEXT NOT NULL/u);
  assert.match(migration, /subject_id_hmac TEXT NOT NULL/u);
  assert.match(migration, /idempotency_key_hmac TEXT NOT NULL/u);
  assert.doesNotMatch(migration, /\bsurvey_id TEXT\b|\bcollector_id TEXT\b|\brespondent_token TEXT\b|\banswer_json\b/iu);
});

test('retention is an explicit expiry-checked authority and privileges remain a standalone delta', () => {
  assert.match(migration, /journey_stage_survey_retention_delete_guard/u);
  assert.match(migration, /current_setting\('seemplify\.survey_feed_retention_purge',true\)/u);
  assert.match(migration, /expires_at>clock_timestamp\(\)/u);
  const privileges = fs.readFileSync(path.resolve(import.meta.dirname,
    '../migrations/postgres/runtime43_survey_feed_privileges.sql'), 'utf8');
  assert.match(privileges, /GRANT DELETE[\s\S]*TO __WORKER_ROLE__/u);
  assert.match(privileges, /REVOKE UPDATE,DELETE[\s\S]*FROM __APP_ROLE__/u);
  assert.doesNotMatch(privileges, /experience_runtime_schema_version/u);
});
