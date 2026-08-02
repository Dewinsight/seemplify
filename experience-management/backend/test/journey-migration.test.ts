import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const legacy = new Database(databasePath);
legacy.exec(`CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, survey_id TEXT, response_id TEXT, state TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT, error TEXT, retry_at TEXT, created_at TEXT NOT NULL,
  started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE journeys (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,audience TEXT NOT NULL DEFAULT '',objective TEXT NOT NULL DEFAULT '',industry TEXT NOT NULL DEFAULT '',
  stages_json TEXT NOT NULL DEFAULT '[]',summary TEXT NOT NULL DEFAULT '',provenance_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE journey_versions (
  id TEXT PRIMARY KEY,journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,reason TEXT NOT NULL,actor TEXT NOT NULL,
  source_job_id TEXT,snapshot_json TEXT NOT NULL,snapshot_updated_at TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(journey_id,snapshot_updated_at)
)`);
const insert = legacy.prepare(`INSERT INTO ai_jobs (id,kind,state,stage,progress,attempt,input_json,created_at,started_at,updated_at)
  VALUES (?,?,?,?,0,0,?,?,?,?)`);
insert.run('legacy-processing', 'journey.optimize', 'processing', 'running_terra', JSON.stringify({ journeyId: 'legacy-journey' }), '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:03.000Z', '2026-01-01T00:00:03.000Z');
insert.run('legacy-queued-duplicate', 'journey.optimize', 'queued', 'queued', JSON.stringify({ journeyId: 'legacy-journey' }), '2026-01-01T00:00:01.000Z', null, '2026-01-01T00:00:01.000Z');
insert.run('legacy-other', 'journey.optimize', 'queued', 'queued', JSON.stringify({ journeyId: 'other-journey' }), '2026-01-01T00:00:04.000Z', null, '2026-01-01T00:00:04.000Z');
insert.run('legacy-malformed', 'journey.optimize', 'queued', 'queued', '{broken-json', '2026-01-01T00:00:05.000Z', null, '2026-01-01T00:00:05.000Z');
const legacySnapshot = {
  id: 'versioned-legacy', name: 'Versioned legacy map', audience: '', objective: '', industry: '', stages: [{ name: 'Stage' }], summary: '',
  provenance: { origin: 'legacy', lastModifiedBy: 'unknown', evidenceBasis: 'unknown', evidenceLevel: 'hypothesis', generatedAt: null, optimizedAt: null },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
};
legacy.prepare(`INSERT INTO journeys (id,name,stages_json,created_at,updated_at) VALUES (?,?,?,?,?)`)
  .run(legacySnapshot.id, legacySnapshot.name, JSON.stringify(legacySnapshot.stages), legacySnapshot.createdAt, legacySnapshot.updatedAt);
legacy.prepare(`INSERT INTO journey_versions (id,journey_id,reason,actor,source_job_id,snapshot_json,snapshot_updated_at,created_at)
  VALUES ('legacy-version',?,'workspace_edit','workspace',NULL,?,?,?)`)
  .run(legacySnapshot.id, JSON.stringify(legacySnapshot), legacySnapshot.updatedAt, '2026-01-01T00:00:01.000Z');
legacy.close();

Object.assign(process.env, {
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: path.join(root, 'uploads'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign')
});

const { db, deleteJourney, listJourneyVersionSummaries } = await import('../src/database.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('legacy duplicate journey optimizations are normalized before the active-job unique index is installed', () => {
  const duplicateRows = db.prepare("SELECT id,state,stage FROM ai_jobs WHERE id IN ('legacy-processing','legacy-queued-duplicate') ORDER BY id").all() as any[];
  assert.equal(duplicateRows.filter((row) => row.state === 'queued').length, 1);
  assert.equal(duplicateRows.filter((row) => row.state === 'failed').length, 1);
  assert.equal(duplicateRows.find((row) => row.state === 'failed')?.stage, 'duplicate_journey_optimization');
  const index = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ai_jobs_one_active_journey_optimize'").get() as any;
  assert.equal(index.name, 'ai_jobs_one_active_journey_optimize');
  assert.equal((db.prepare("SELECT state FROM ai_jobs WHERE id='legacy-other'").get() as any).state, 'queued');
  assert.equal((db.prepare("SELECT state FROM ai_jobs WHERE id='legacy-malformed'").get() as any).state, 'queued');
  const migratedVersion = listJourneyVersionSummaries('versioned-legacy', 10)[0];
  assert.equal(migratedVersion.name, 'Versioned legacy map');
  assert.equal(migratedVersion.stageCount, 1);
  assert.equal(migratedVersion.snapshotUpdatedAt, legacySnapshot.updatedAt);
  assert.ok((db.prepare("SELECT snapshot_bytes FROM journey_versions WHERE id='legacy-version'").get() as any).snapshot_bytes > 0);
  assert.throws(() => db.prepare(`INSERT INTO ai_jobs (id,kind,state,stage,progress,attempt,input_json,created_at,updated_at)
    VALUES ('post-upgrade-duplicate','journey.optimize','queued','queued',0,0,?,'2026-01-01T00:00:06.000Z','2026-01-01T00:00:06.000Z')`)
    .run(JSON.stringify({ journeyId: 'legacy-journey' })), /UNIQUE constraint failed/);

  const now = '2026-01-01T00:00:07.000Z';
  db.prepare(`INSERT INTO journeys (id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at)
    VALUES ('deletable-legacy','Legacy','','','','[]','','{}',?,?)`).run(now, now);
  assert.equal(deleteJourney('deletable-legacy', now), 'deleted');
});
