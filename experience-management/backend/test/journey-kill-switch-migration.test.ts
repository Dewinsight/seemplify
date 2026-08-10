import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'migrations/postgres/0040_journey_kill_switch.sql'), 'utf8');

test('runtime-40 is forward-only and exactly predecessor-gated over 39', () => {
  assert.match(sql, /MAX\(version\)[\s\S]*?<>39/u);
  assert.doesNotMatch(sql, /INSERT INTO experience_runtime_schema_version/u);
});

test('runtime-40 matches the durable state, mutation, pause, recovery and audit repository contract', () => {
  for (const table of ['journey_kill_switch_states', 'journey_kill_switch_mutations',
    'journey_kill_switch_pauses', 'journey_kill_switch_resumptions', 'journey_kill_switch_audit']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
  }
  assert.doesNotMatch(sql, /journey_kill_switch_pending_actions|CREATE TABLE journey_kill_switches/u);
  assert.match(sql, /scope_level IN \('platform','space','workflow','adapter','profile'\)/u);
  assert.match(sql, /scope_level<>'profile' OR scope_key ~ '\^\[a-f0-9\]\{64\}\$'/u);
  assert.match(sql, /FOREIGN KEY\(queue_id,space_id\)[\s\S]*?REFERENCES journey_action_queue/u);
  assert.equal([...sql.matchAll(/EXECUTE FUNCTION journey_orchestration_append_only_guard\(\)/gu)].length, 4);
  assert.match(sql, /detail_json \?\| ARRAY/u);
});
