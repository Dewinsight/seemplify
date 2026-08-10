import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sql=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../migrations/postgres/0044_journey_reviewed_action_worker_bridge.sql'),'utf8');

test('runtime-44 is standalone, exact-predecessor gated, and recognizes both canonical receipt kinds',()=>{
  assert.match(sql,/MAX\(version\)[\s\S]*<>43/);assert.match(sql,/requires runtime-43/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION journey_action_worker_reservation_fence_guard/);
  assert.match(sql,/FROM journey_action_effect_receipts/);assert.match(sql,/FROM journey_adapter_effect_receipts/);
  assert.doesNotMatch(sql,/INSERT INTO experience_runtime_schema_version/,
    'the checksummed runtime migrator, not migration SQL, owns the version ledger');
  assert.match(sql,/REVOKE ALL ON FUNCTION journey_action_worker_reservation_fence_guard\(\) FROM PUBLIC/);
  assert.doesNotMatch(sql,/ALTER TABLE journey_action_effect_receipts[\s\S]*DROP CONSTRAINT/);
});

test('worker privileges are narrow but include reviewed settlement and effect-specific tables',()=>{
  const privileges=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../migrations/postgres/runtime_worker_privileges.sql'),'utf8');
  for(const table of ['journey_adapter_execution_attempts','journey_adapter_effect_receipts',
    'journey_adapter_internal_notifications','journey_webhook_dispatches'])assert.match(privileges,new RegExp(table));
  assert.match(privileges,/REVOKE DELETE ON ALL TABLES/);assert.match(privileges,/REVOKE CREATE ON SCHEMA/);
});
