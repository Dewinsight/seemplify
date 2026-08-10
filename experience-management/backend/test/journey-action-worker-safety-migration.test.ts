import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sql=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../migrations/postgres/0042_journey_action_worker_safety.sql'),'utf8');
test('runtime-42 is exact predecessor-gated and stores external key references rather than credentials',()=>{
  assert.match(sql,/MAX\(version\).*<>41/s);assert.match(sql,/requires runtime-41/);
  assert.match(sql,/key_ref TEXT NOT NULL UNIQUE/);assert.doesNotMatch(sql,/secret_(?:enc|value)|credential_json/i);
  assert.match(sql,/REVOKE ALL ON FUNCTION journey_worker_safety_append_only_guard\(\) FROM PUBLIC/);
});
test('runtime-42 provides fenced active reservations, counters, live controls, and immutable events',()=>{
  for(const name of ['journey_worker_service_principals','journey_worker_service_key_audit','journey_action_live_contexts',
    'journey_action_subject_controls','journey_action_source_controls','journey_action_quota_counters',
    'journey_action_frequency_counters','journey_action_worker_reservations','journey_action_worker_reservation_events'])
    assert.match(sql,new RegExp(`CREATE TABLE ${name}`));
  assert.match(sql,/UNIQUE INDEX journey_action_worker_reservation_active[\s\S]*WHERE state='reserved'/);
  assert.match(sql,/fencing_token BIGINT NOT NULL/);assert.match(sql,/lease_token_sha256 TEXT NOT NULL/);
  assert.match(sql,/service_key_audit_append_only/);assert.match(sql,/reservation_events_append_only/);
});
