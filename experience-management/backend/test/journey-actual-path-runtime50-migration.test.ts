import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const sql=fs.readFileSync(path.resolve(here,'../migrations/postgres/0050_journey_actual_path_durability.sql'),'utf8');
const sqlite=fs.readFileSync(path.resolve(here,'../src/platformSchema.ts'),'utf8');
const worker=fs.readFileSync(path.resolve(here,'../src/journeyPrivacyPropagationWorker.ts'),'utf8');
const runtime=fs.readFileSync(path.resolve(here,'../src/journeyPrivacyPropagationRuntime.ts'),'utf8');
const privileges=fs.readFileSync(path.resolve(here,'../migrations/postgres/runtime50_actual_path_privileges.sql'),'utf8');

test('runtime50 has exact predecessor49 and durable bounded actual-path artifacts',()=>{
  assert.match(sql,/MAX\(version\)[\s\S]*<>49/u);
  assert.match(sql,/CREATE TABLE journey_actual_path_snapshots/u);
  assert.match(sql,/CREATE TABLE journey_actual_path_rollups/u);
  for(const column of ['space_id','journey_definition_id','journey_map_version_id','subject_scope','period_start','period_end',
    'minimum_cohort_size','analytics_version','summary_json','result_json'])assert.match(sql,new RegExp(`\\b${column}\\b`,'u'));
  assert.match(sql,/octet_length\(result_json::text\)<=1048576/u);
  assert.match(sql,/journey_actual_path_snapshots_latest/u);
  assert.match(sql,/journey_actual_path_rollups_latest/u);
});

test('runtime50 preserves exact correction, source, window and result lineage as immutable revisions',()=>{
  assert.match(sql,/CREATE TABLE journey_actual_path_artifact_revisions/u);
  for(const column of ['artifact_kind','artifact_id','revision','journey_map_version_id','subject_scope','period_start','period_end',
    'as_of','source_lineage_sha256','result_sha256','latest_reprojection_run_id','latest_reprojection_completed_at'])
    assert.match(sql,new RegExp(`\\b${column}\\b`,'u'));
  assert.match(sql,/journey_actual_path_artifact_revisions_guard BEFORE UPDATE OR DELETE/u);
});

test('runtime50 privacy invalidation is tenant scoped, claim fenced and unavailable to PUBLIC',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION journey_actual_path_privacy_invalidate/u);
  assert.match(sql,/claim[\s\S]*source_type=p_source_type[\s\S]*source_id=p_source_id[\s\S]*space_id=p_space_id[\s\S]*state='leased'/u);
  assert.match(sql,/claim\.lease_expires_at<=p_at/u);
  assert.match(sql,/principal\.allowed_space_ids_json \? p_space_id/u);
  assert.match(sql,/DELETE FROM public\.journey_actual_path_snapshots WHERE space_id=p_space_id AND journey_definition_id=p_journey_definition_id/u);
  assert.match(sql,/CREATE TABLE journey_actual_path_privacy_invalidations/u);
  assert.match(sql,/source_id_sha256/u);
  assert.doesNotMatch(sql,/journey_actual_path_privacy_invalidations[\s\S]{0,1200}FOREIGN KEY\(journey_definition_id,space_id\)/u,
    'content-safe invalidation audit must not prevent later governed journey deletion');
  assert.doesNotMatch(sql,/INSERT INTO experience_runtime_schema_version/u);
  assert.match(sql,/REVOKE ALL ON FUNCTION journey_actual_path_privacy_invalidate/u);
});

test('SQLite parity and the production worker preserve audit while PostgreSQL fails closed without injected authority',()=>{
  for(const table of ['journey_actual_path_snapshots','journey_actual_path_rollups','journey_actual_path_artifact_revisions',
    'journey_actual_path_privacy_invalidations'])assert.match(sqlite,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`,'u'));
  assert.match(worker,/actual_path_privacy_authority_unavailable/u);
  assert.match(worker,/INSERT INTO journey_actual_path_privacy_invalidations/u);
  assert.match(runtime,/journey_actual_path_privacy_invalidate\(\?,\?,\?,\?,\?,\?\)/u);
  assert.doesNotMatch(worker,/DELETE FROM journey_actual_path_snapshots[\s\S]{0,300}return \{ state: 'completed'/u,
    'privacy invalidation must not silently bypass its audited transaction');
});

test('runtime50 privileges separate application materialisation from privacy invalidation authority',()=>{
  assert.match(privileges,/GRANT SELECT,INSERT ON TABLE public\.journey_actual_path_snapshots,public\.journey_actual_path_artifact_revisions[\s\S]*TO __APP_ROLE__/u);
  assert.match(privileges,/GRANT SELECT,INSERT,UPDATE ON TABLE public\.journey_actual_path_rollups TO __APP_ROLE__/u);
  assert.match(privileges,/REVOKE UPDATE,DELETE ON TABLE public\.journey_actual_path_snapshots/u);
  assert.match(privileges,/REVOKE INSERT,UPDATE,DELETE ON TABLE public\.journey_actual_path_privacy_invalidations/u);
  assert.match(privileges,/GRANT EXECUTE ON FUNCTION public\.journey_actual_path_privacy_invalidate[\s\S]*TO __PRIVACY_WORKER_ROLE__/u);
  assert.match(privileges,/REVOKE ALL ON TABLE public\.journey_actual_path_snapshots[\s\S]*FROM __PRIVACY_WORKER_ROLE__/u);
  assert.doesNotMatch(privileges,/CREATE ROLE|ALTER ROLE/u);
});
