import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const sql=fs.readFileSync(path.resolve(here,'../migrations/postgres/0053_journey_event_retention_reconciliation.sql'),'utf8');
test('Runtime53 is upgrader-registered, exact predecessor52, bounded and content-safe',()=>{assert.match(sql,/MAX\(version\)[\s\S]*<>52/u);
  for(const table of ['journey_event_retention_runs','journey_event_retention_checkpoints','journey_event_retention_events'])assert.match(sql,new RegExp(`CREATE TABLE ${table}`,'u'));
  assert.match(sql,/batch_size BETWEEN 1 AND 500/u);assert.match(sql,/detail_json JSONB[\s\S]*octet_length\(detail_json::text\)<=32768/u);
  assert.doesNotMatch(sql,/payload_json|anonymous_id_hash|user_id_hash/u);});
test('destructive raw purge is lease-fenced, expiry-bound and fails closed on active or stage-linked work',()=>{
  assert.match(sql,/SECURITY DEFINER SET search_path=public,pg_temp/u);assert.match(sql,/v_run\.lease_token<>p_lease_token/u);
  assert.match(sql,/v_run\.lease_expires_at<=clock_timestamp\(\)/u);assert.match(sql,/v_raw\.retention_expires_at>p_as_of/u);
  assert.match(sql,/active_processing/u);assert.match(sql,/stage_reconciliation_required/u);assert.match(sql,/dependent_retention/u);
  assert.match(sql,/set_config\('seemplify\.retention_purge','on',true\)/u);assert.match(sql,/REVOKE ALL ON FUNCTION journey_event_retention_purge_raw/u);});
test('purge order respects raw-event foreign keys and leaves reconciliation-required stage lineage intact',()=>{const order=['DELETE FROM journey_event_dead_letters',
  'DELETE FROM journey_event_processing_receipts','DELETE FROM journey_event_processing_inbox','DELETE FROM journey_event_deduplication',
  'DELETE FROM journey_event_ingest_receipts','DELETE FROM journey_raw_events'].map(token=>sql.indexOf(token));assert.equal(order.every(value=>value>=0),true);
  assert.deepEqual([...order].sort((a,b)=>a-b),order);assert.doesNotMatch(sql,/DELETE FROM journey_(stage_rule_decisions|anonymous_stage_visits)/u);});
