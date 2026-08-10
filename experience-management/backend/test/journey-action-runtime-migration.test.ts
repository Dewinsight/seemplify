import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=fs.readFileSync(path.join(root,'migrations/postgres/0036_journey_action_runtime.sql'),'utf8');

test('runtime-36 is forward-only and exactly predecessor-gated',()=>{
  assert.match(sql,/MAX\(version\)[\s\S]*?<>35/u); assert.doesNotMatch(sql,/INSERT INTO experience_runtime_schema_version/u);
});

test('runtime-36 provides fenced mutable queue state and append-only safety/effect evidence',()=>{
  for(const table of ['journey_action_queue','journey_action_gate_resolutions','journey_action_attempts',
    'journey_action_effect_receipts']) assert.match(sql,new RegExp(`CREATE TABLE ${table} \\(`,'u'));
  assert.match(sql,/UNIQUE\(space_id,idempotency_key\)/u);
  assert.match(sql,/fencing_token BIGINT NOT NULL DEFAULT 0/u);
  assert.match(sql,/state TEXT NOT NULL CHECK\(state IN \('held','ready','leased','retry_scheduled','succeeded','dead_letter','cancelled'\)\)/u);
  assert.match(sql,/adapter TEXT NOT NULL CHECK\(adapter='deterministic_no_effect'\)/u,
    'this tranche must make real external effects structurally impossible');
  assert.equal([...sql.matchAll(/EXECUTE FUNCTION journey_orchestration_append_only_guard\(\)/gu)].length,3);
});
