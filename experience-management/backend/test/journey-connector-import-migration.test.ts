import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.resolve(here,'..','migrations','postgres','0037_journey_connector_imports.sql'),'utf8');
const repositorySource=fs.readFileSync(path.resolve(here,'..','src','journeyConnectorImports.ts'),'utf8');

test('runtime-37 is exactly predecessor-gated to settled runtime-36',()=>{
  assert.match(source,/MAX\(version\).*<>36/su);assert.match(source,/requires runtime-36/u);
  assert.doesNotMatch(source,/INSERT INTO experience_runtime_schema_version/u,
    'the checksummed migrator, not migration SQL, advances the runtime ledger');
});
test('runtime-37 stores approved connectors, exact checkpoints, tombstones and item receipts',()=>{
  for(const table of ['journey_connector_definitions','journey_connector_import_runs','journey_connector_records',
    'journey_connector_item_receipts','journey_connector_idempotency','journey_connector_audit'])
    assert.match(source,new RegExp(`CREATE TABLE ${table} \\(`,'u'));
  assert.match(source,/kind IN \('csv_upload','jsonl_upload','approved_object_store'\)/u);
  assert.match(source,/state IN \('active','tombstoned'\)/u);assert.match(source,/expected_cursor TEXT/u);
  assert.match(source,/external_id_sha256 TEXT NOT NULL/u);
});
test('runtime-37 seals content-safe history and the trigger function from direct runtime execution',()=>{
  assert.match(source,/journey_connector_receipts_append_only BEFORE UPDATE OR DELETE/u);
  assert.match(source,/journey_connector_audit_append_only BEFORE UPDATE OR DELETE/u);
  assert.match(source,/REVOKE ALL ON FUNCTION journey_connector_append_only_guard\(\) FROM PUBLIC/u);
  assert.doesNotMatch(source,/secret|credential|access_token|refresh_token|api_key/iu);
});
test('PostgreSQL idempotent mutations serialize and recheck after acquiring the key lock',()=>{
  assert.match(repositorySource,/pg_advisory_xact_lock\(hashtextextended\(\?,0\)\)/u);
  assert.match(repositorySource,/const concurrent = readStored\(\)/u);
  assert.match(repositorySource,/result = parse<T>\(concurrent\.response_json[\s\S]*?replayed = true/u);
});
