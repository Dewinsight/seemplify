import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=fs.readFileSync(path.join(root,'migrations/postgres/0038_journey_reviewed_adapters.sql'),'utf8');
test('runtime-38 is forward-only and exactly predecessor-gated',()=>{
  assert.match(sql,/MAX\(version\)[\s\S]*?<>37/u);assert.doesNotMatch(sql,/INSERT INTO experience_runtime_schema_version/u);
});
test('runtime-38 stores allowlists, reviewed outcomes and replay-safe webhook state without email or social adapters',()=>{
  for(const table of ['journey_webhook_destinations','journey_adapter_execution_attempts','journey_adapter_effect_receipts',
    'journey_adapter_internal_notifications','journey_webhook_dispatches'])assert.match(sql,new RegExp(`CREATE TABLE ${table} \\(`,'u'));
  assert.match(sql,/UNIQUE\(space_id,idempotency_key\)/u);assert.match(sql,/UNIQUE\(destination_id,nonce\)/u);
  assert.doesNotMatch(sql,/email_reply|social_reply|tweet/u);
  assert.equal([...sql.matchAll(/EXECUTE FUNCTION journey_orchestration_append_only_guard\(\)/gu)].length,3);
});
