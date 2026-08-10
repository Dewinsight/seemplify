import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'migrations/postgres/0033_journey_actual_path_intelligence.sql'), 'utf8')
  .replace(/\s+/gu, ' ');

test('runtime-33 persists exact path-intelligence provenance and immutable content', () => {
  assert.match(sql, /MAX\(version\).*<>32/u);
  assert.match(sql, /CREATE TABLE journey_path_intelligence_runs/u);
  for (const column of ['space_id', 'journey_definition_id', 'journey_map_version_id', 'subject_scope',
    'period_start', 'period_end', 'as_of', 'minimum_sample_size', 'secondary_suppression_threshold',
    'detector_version', 'content_sha256', 'result_json']) assert.match(sql, new RegExp(`\\b${column}\\b`, 'u'));
  assert.match(sql, /journey_path_intelligence_runs_append_only BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /journey_path_intelligence_runs_version_fk FOREIGN KEY\(journey_map_version_id,journey_definition_id,space_id\)/u);
});

test('runtime-33 recommendations are review-only revisioned content with append-only audit', () => {
  assert.match(sql, /CREATE TABLE journey_stage_inference_recommendations/u);
  assert.match(sql, /state TEXT NOT NULL CHECK\(state IN \('draft','in_review','accepted','rejected','retired'\)\)/u);
  assert.match(sql, /revision INTEGER NOT NULL DEFAULT 1 CHECK\(revision>0\)/u);
  assert.match(sql, /content_sha256 TEXT NOT NULL/u);
  assert.match(sql, /CREATE TABLE journey_path_intelligence_audit/u);
  assert.match(sql, /journey_path_intelligence_audit_append_only BEFORE UPDATE OR DELETE/u);
  assert.doesNotMatch(sql, /UPDATE journey_map_stages|INSERT INTO journey_anonymous_stage_visits/u);
});
