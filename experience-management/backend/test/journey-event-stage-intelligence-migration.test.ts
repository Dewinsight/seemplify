import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
const sql=fs.readFileSync(new URL('../migrations/postgres/0045_journey_event_stage_intelligence_adapter.sql',import.meta.url),'utf8');
test('runtime-45 is exact predecessor44 and stores server-owned mapping lineage',()=>{assert.match(sql,/MAX\(version\).*<>44/s);
  for(const token of ['source_id','schema_version_id','journey_definition_id','journey_map_version_id','stage_rule_version_id',
    'metric_definition_version_id','projection_version','source_envelope_sha256','mapping_content_sha256','raw_retention_expires_at',
    'visit_retention_expires_at','mapping_retention_days'])assert.match(sql,new RegExp(token));
  assert.match(sql,/FOREIGN KEY\(schema_version_id,source_id,space_id\)/);assert.match(sql,/AFTER INSERT ON journey_anonymous_stage_visits/);});
test('derived outbox contains no raw payload or text and fails closed on consent retention and erasure',()=>{const outbox=/CREATE TABLE journey_event_intelligence_outbox[\s\S]*?\);\nCREATE INDEX/u.exec(sql)?.[0]||'';
  assert.doesNotMatch(outbox,/\b(?:payload_json|context_json|raw_text|message|body)\s+(?:TEXT|JSONB)\b/i);assert.match(sql,/privacy_erased/);assert.match(sql,/consent_unknown/);
  assert.match(sql,/retention_expired/);assert.match(sql,/numeric_value_invalid/);assert.match(sql,/journey_event_intelligence_erasure_handles/);});
test('stateful materialization and correction/reprojection tombstones are durable and append-only',()=>{
  assert.match(sql,/journey_event_intelligence_materialization_state/);assert.match(sql,/elapsed_since_prior/);assert.match(sql,/correction','reprojection','privacy_erasure','retention_expiry/);
  assert.match(sql,/journey_event_intelligence_tombstones_append_only/);assert.match(sql,/journey_event_intelligence_erasure_handles_append_only/);
  assert.match(sql,/REVOKE ALL ON FUNCTION journey_event_intelligence_enqueue_visit\(\) FROM PUBLIC/);});
