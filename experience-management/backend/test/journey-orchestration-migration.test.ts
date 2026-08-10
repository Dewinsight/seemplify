import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=fs.readFileSync(path.join(root,'migrations/postgres/0035_journey_orchestration.sql'),'utf8');
test('runtime-35 is forward-only and exactly predecessor-gated',()=>{
  assert.match(sql,/MAX\(version\)[\s\S]*?<>34/u); assert.doesNotMatch(sql,/INSERT INTO experience_runtime_schema_version/u);
});
test('runtime-35 provides tenant-bound immutable workflow, run, action, approval, outbox and audit storage',()=>{
  for(const table of ['journey_workflow_definitions','journey_workflow_versions','journey_workflow_runs',
    'journey_workflow_actions','journey_workflow_approvals','journey_workflow_outbox','journey_workflow_audit'])
    assert.match(sql,new RegExp(`CREATE TABLE ${table} \\(`,'u'));
  assert.match(sql,/UNIQUE\(space_id,idempotency_key\)/u);
  assert.equal([...sql.matchAll(/EXECUTE FUNCTION journey_orchestration_append_only_guard\(\)/gu)].length,6);
  assert.match(sql,/journey_workflow_outbox[\s\S]*?CHECK\(state='held'\)/u);
});
