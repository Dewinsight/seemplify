import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.resolve(here,'../migrations/postgres/0049_journey_export_branding.sql'),'utf8');

test('runtime49 requires exact predecessor48 and pins tenant-scoped profile, asset and saved-view versions',()=>{
  assert.match(source,/MAX\(version\)[\s\S]*<>48/u);
  assert.match(source,/FOREIGN KEY\(source_upload_id,space_id\) REFERENCES uploads\(id,space_id\)/u);
  assert.match(source,/FOREIGN KEY\(id,space_id,current_version\)[\s\S]*journey_export_brand_profile_versions/u);
  assert.match(source,/FOREIGN KEY\(view_id,space_id\) REFERENCES journey_saved_views\(id,space_id\)/u);
  assert.match(source,/brand_policy TEXT NOT NULL CHECK\(brand_policy IN \('space_default','pinned'\)\)/u);
});

test('runtime49 keeps versions and evidence append-only and stores no raw filesystem location',()=>{
  assert.match(source,/journey_export_brand_versions_immutable/u);
  assert.match(source,/journey_export_brand_operations_immutable/u);
  assert.match(source,/journey_export_brand_audit_immutable/u);
  assert.match(source,/REVOKE EXECUTE ON FUNCTION journey_export_brand_append_only_guard\(\) FROM PUBLIC/u);
  assert.doesNotMatch(source,/stored_filename|storage_key(?!_sha256)/u);
  assert.match(source,/content_sha256 TEXT NOT NULL/u);
  assert.match(source,/lease_token_sha256/u);
});
