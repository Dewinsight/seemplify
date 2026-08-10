import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const sql = fs.readFileSync(new URL('../migrations/postgres/0041_journey_stage_intelligence.sql', import.meta.url), 'utf8');
const repositorySource = fs.readFileSync(new URL('../src/journeyStageIntelligenceSqlRepository.ts', import.meta.url), 'utf8');

test('runtime-41 is forward-only and exact predecessor-40 gated', () => {
  assert.match(sql, /MAX\(version\)[\s\S]*<>40/u);
  assert.match(sql, /runtime-41 journey stage intelligence requires runtime-40/u);
  assert.doesNotMatch(sql, /INSERT INTO experience_runtime_schema_version/u);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/u);
});

test('runtime-41 persists policy, pseudonymous facts, tombstones, lineage and content-safe audit', () => {
  for (const table of ['journey_stage_intelligence_policies', 'journey_stage_intelligence_policy_history',
    'journey_stage_intelligence_facts', 'journey_stage_intelligence_audit']) assert.match(sql, new RegExp(`CREATE TABLE ${table}`, 'u'));
  assert.match(sql, /subject_id_hmac TEXT NOT NULL CHECK\(subject_id_hmac ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(sql, /operation TEXT NOT NULL CHECK\(operation IN \('upsert','delete'\)\)/u);
  assert.match(sql, /source_version TEXT NOT NULL/u); assert.match(sql, /metric_definition_version_sha256/u);
  assert.match(sql, /dimensions_json <@ '\["persona","segment","cohort","channel"\]'/u);
  assert.match(sql, /emotions_json <@ '\["anger","anxiety","confusion","delight"/u);
  assert.match(sql, /retention_expires_at TIMESTAMPTZ NOT NULL/u);
  assert.match(sql, /idempotency_key_hmac TEXT NOT NULL/u);
  assert.match(sql, /supersedes_fact_id,space_id,metric_definition_id,source_id_hmac,external_record_hmac/u);
  assert.match(sql, /seemplify\.retention_purge/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION journey_stage_intelligence_retention_delete_guard\(\) FROM PUBLIC/u);
  assert.match(sql, /journey_stage_intelligence_facts_append_only/u);
  assert.match(sql, /NOT \(detail_json \?\| ARRAY\['payload','content','body','message','subject'/u);
});

test('production retention uses the PostgreSQL runtime prepared-query path', () => {
  assert.match(repositorySource,
    /db\.prepare\("SELECT set_config\('seemplify\.retention_purge','on',true\) configured"\)\.get\(\)/u);
  assert.doesNotMatch(repositorySource, /db\.exec\("SET LOCAL seemplify\.retention_purge/u,
    'PostgresRuntime rejects non-PRAGMA exec calls');
});
