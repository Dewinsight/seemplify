import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const migration=fs.readFileSync(path.resolve(here,'../migrations/postgres/0047_journey_privacy_propagation_authority.sql'),'utf8');

test('runtime47 has exact predecessor46 and dedicated privacy authority storage',()=>{
  assert.match(migration,/MAX\(version\)[\s\S]*<>46/u);
  for(const table of ['journey_privacy_service_principals','journey_privacy_service_key_audit',
    'journey_privacy_erasure_authorities','journey_privacy_propagation_claims','journey_privacy_propagation_events'])
    assert.match(migration,new RegExp(`CREATE TABLE ${table} \\(`,'u'));
  assert.match(migration,/key_ref TEXT NOT NULL UNIQUE CHECK\(key_ref ~ '\^\(kms\|vault\|external-file\):\/\//u);
  assert.doesNotMatch(migration,/secret_enc|secret_value|credential_json|private_key/iu);
});

test('runtime47 fences claim and checkpoint mutations behind scoped security-definer functions',()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION journey_privacy_claim\([\s\S]*SECURITY DEFINER/u);
  assert.match(migration,/FOR UPDATE SKIP LOCKED LIMIT 1/u);
  assert.match(migration,/lease_generation=lease_generation\+1/u);
  assert.match(migration,/claim\.lease_generation<>p_generation[\s\S]*claim\.lease_token_sha256<>p_lease_token_sha256[\s\S]*claim\.revision<>p_expected_revision/u);
  assert.match(migration,/principal\.allowed_space_ids_json \? claim\.space_id/u);
  assert.match(migration,/REVOKE ALL ON FUNCTION journey_privacy_claim/u);
  assert.match(migration,/REVOKE ALL ON FUNCTION journey_privacy_checkpoint/u);
  assert.match(migration,/REVOKE INSERT,UPDATE,DELETE ON journey_privacy_service_principals/u);
  assert.match(migration,/checkpoint_json::text !~\* '"\(payload\|content[\s\S]*\[\[:space:\]\]\*:'/u);
  assert.match(migration,/p_checkpoint::text ~\* '"\(payload\|content/u);
  assert.equal((migration.match(/'\{\}'::jsonb,repeat\('0',64\),1,p_now,p_now/gmu)||[]).length,2,
    'both source kinds must seed a content-free checkpoint instead of trusting caller-controlled result JSON');
});

test('physical erasure completion requires explicit legal hold, backup, region, and raw authority',()=>{
  assert.match(migration,/raw_erasure_state='completed'[\s\S]*legal_hold_state='clear'[\s\S]*backup_state IN \('not_applicable','deletion_confirmed'\)[\s\S]*region_state IN \('not_applicable','deletion_confirmed'\)/u);
  assert.match(migration,/IF p_state='completed' AND claim\.operation='erasure'[\s\S]*physical erasure authority is incomplete/u);
  assert.match(migration,/erasure authority must bind the tenant erasure job/u);
  assert.match(migration,/raw_identifier_erasure|raw_erasure_state/u);
  assert.match(migration,/CREATE OR REPLACE FUNCTION journey_privacy_erasure_ready\(p_principal_id TEXT,p_privacy_job_id TEXT\)/u);
  assert.match(migration,/claim\.state='operator_required'[\s\S]*checkpoint_json->>'cursor'[\s\S]*::integer>=9[\s\S]*journey_privacy_erasure_ready\(principal\.id,claim\.source_id\)[\s\S]*SET state='waiting'/u);
});

test('principal scopes are bounded, unique, real tenants, and region identifiers are strict',()=>{
  assert.match(migration,/jsonb_array_length\(allowed_space_ids_json\) BETWEEN 1 AND 100/u);
  assert.match(migration,/COUNT\(DISTINCT value\)[\s\S]*jsonb_array_elements_text\(NEW\.allowed_space_ids_json\)/u);
  assert.match(migration,/NOT EXISTS\(SELECT 1 FROM spaces WHERE spaces\.id=value\)/u);
  assert.match(migration,/value !~ '\^\[A-Z\]\[A-Z0-9-\]\{1,31\}\$'/u);
  assert.match(migration,/invalid privacy principal lifecycle/u);
});
