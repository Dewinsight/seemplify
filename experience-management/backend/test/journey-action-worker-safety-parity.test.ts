import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeJourneyWorkerSafetySqlite } from '../src/journeyActionWorkerSafetyRepository.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '../migrations/postgres/0042_journey_action_worker_safety.sql'), 'utf8');
const repository = fs.readFileSync(path.resolve(here, '../src/journeyActionWorkerSafetyRepository.ts'), 'utf8');
const matches = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[match.length - 1]);

const at = '2026-08-08T12:00:00.000Z';
const expires = '2026-08-09T00:00:00.000Z';
const profile = 'b'.repeat(64);
const leaseSha = 'c'.repeat(64);

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE spaces(id TEXT PRIMARY KEY);
    CREATE TABLE journey_action_queue(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,adapter TEXT NOT NULL,UNIQUE(id,space_id));
    INSERT INTO spaces VALUES ('space-a');
    INSERT INTO journey_action_queue VALUES ('queue-a','space-a','assistant_action'),('queue-b','space-a','assistant_action');`);
  initializeJourneyWorkerSafetySqlite(db);
  db.prepare(`INSERT INTO journey_worker_service_principals VALUES (?,?,?,'active',?,?,?,?,1,?,?)`)
    .run('principal-a', 'key-a', 'kms://workers/key-a', '["space-a"]', '["assistant_action"]', at, expires, at, at);
  return db;
}

function reserve(db: Database.Database, id: string, queueId: string, fence: number) {
  db.prepare(`INSERT INTO journey_action_worker_reservations VALUES (?,?,'space-a',?,'service-recovery',
    'monthlyOrchestrationActions',?,?,?,?,1,10,3,'reserved',?,?,?,1,?,?)`)
    .run(id, queueId, profile, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', at, expires, fence, leaseSha,
      expires, at, at);
}

test('runtime-42 revokes PUBLIC execute on every function it defines', () => {
  const functions = matches(migration, /CREATE OR REPLACE FUNCTION (\w+)\(\)/gu);
  for (const expected of ['journey_action_safety_counter_guard', 'journey_action_worker_reservation_fence_guard',
    'journey_worker_safety_append_only_guard', 'journey_worker_service_principal_lifecycle_guard']) {
    assert.ok(functions.includes(expected), `runtime-42 must define ${expected}`);
  }
  for (const name of functions) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION ${name}\\(\\) FROM PUBLIC`, 'u'));
  }
});

test('runtime-42 guards rotation, revocation, fencing and counter monotonicity', () => {
  assert.match(migration, /A revoked service principal is terminal/u);
  assert.match(migration, /A service principal identity and key reference are immutable/u);
  assert.match(migration, /cannot reuse or rewind a fencing token/u);
  assert.match(migration, /A settled journey action cannot take a further safety reservation/u);
  assert.match(migration, /A settled journey action reservation cannot be settled again/u);
  assert.match(migration, /Journey action safety consumption never moves backwards/u);
  assert.match(migration, /A journey action safety counter window is immutable once opened/u);
});

test('the SQLite runtime declares the same tables and guards the same tables as PostgreSQL', () => {
  const postgresTables = matches(migration, /CREATE TABLE (\w+)/gu).sort();
  const sqliteTables = matches(repository, /CREATE TABLE IF NOT EXISTS (\w+)/gu).sort();
  assert.deepEqual(sqliteTables, postgresTables);
  const guarded = (source: string, pattern: RegExp) => [...new Set(matches(source, pattern))].sort();
  assert.deepEqual(guarded(repository, /CREATE TRIGGER IF NOT EXISTS \w+\s+BEFORE (?:\w+)(?: OR \w+)? ON (\w+)/gu),
    guarded(migration, /CREATE TRIGGER \w+\s+BEFORE (?:\w+)(?: OR \w+)? ON (\w+)/gu));
});

test('SQLite keeps a revoked principal terminal and its key reference immutable', () => {
  const db = fixture();
  db.prepare("UPDATE journey_worker_service_principals SET updated_at=? WHERE id='principal-a'").run(expires);
  assert.throws(() => db.prepare("UPDATE journey_worker_service_principals SET key_ref='kms://workers/other' WHERE id='principal-a'").run(),
    /service principal lifecycle/u);
  assert.throws(() => db.prepare("UPDATE journey_worker_service_principals SET state='draining' WHERE id='principal-a'").run(),
    /service principal lifecycle/u);
  db.prepare("UPDATE journey_worker_service_principals SET state='draining',revision=2,updated_at=? WHERE id='principal-a'").run(at);
  db.prepare("UPDATE journey_worker_service_principals SET state='revoked',revision=3,updated_at=? WHERE id='principal-a'").run(at);
  assert.throws(() => db.prepare("UPDATE journey_worker_service_principals SET updated_at=? WHERE id='principal-a'").run(expires),
    /service principal lifecycle/u);
  db.close();
});

test('SQLite refuses a rewound fence and lets a higher one through', () => {
  const db = fixture();
  reserve(db, 'reservation-a', 'queue-a', 2);
  assert.throws(() => reserve(db, 'reservation-b', 'queue-a', 2), /reservation fence/u);
  assert.throws(() => reserve(db, 'reservation-c', 'queue-a', 1), /reservation fence/u);
  db.prepare("UPDATE journey_action_worker_reservations SET state='expired',revision=2,updated_at=? WHERE id='reservation-a'").run(at);
  reserve(db, 'reservation-d', 'queue-a', 3);
  reserve(db, 'reservation-e', 'queue-b', 1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_action_worker_reservations').get() as any).count, 3);
  db.close();
});

test('SQLite settles a reservation exactly once and keeps its binding fixed', () => {
  const db = fixture();
  reserve(db, 'reservation-a', 'queue-a', 1);
  assert.throws(() => db.prepare("UPDATE journey_action_worker_reservations SET meter='other',revision=2 WHERE id='reservation-a'").run(),
    /reservation settlement/u);
  assert.throws(() => db.prepare("UPDATE journey_action_worker_reservations SET state='consumed' WHERE id='reservation-a'").run(),
    /reservation settlement/u);
  db.prepare("UPDATE journey_action_worker_reservations SET state='consumed',revision=2,updated_at=? WHERE id='reservation-a'").run(at);
  assert.throws(() => db.prepare("UPDATE journey_action_worker_reservations SET state='released',revision=3,updated_at=? WHERE id='reservation-a'").run(at),
    /reservation settlement/u);
  db.close();
});

test('SQLite counters never rewind consumption and never move their window', () => {
  const db = fixture();
  db.prepare("INSERT INTO journey_action_quota_counters VALUES ('space-a','monthlyOrchestrationActions',?,?,1,0,?)")
    .run('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', at);
  db.prepare('UPDATE journey_action_quota_counters SET reserved_quantity=0,consumed_quantity=1,updated_at=? WHERE space_id=?').run(at, 'space-a');
  assert.throws(() => db.prepare('UPDATE journey_action_quota_counters SET consumed_quantity=0 WHERE space_id=?').run('space-a'),
    /safety counter/u);
  assert.throws(() => db.prepare('UPDATE journey_action_quota_counters SET period_end=? WHERE space_id=?').run('2026-10-01T00:00:00.000Z', 'space-a'),
    /safety counter/u);
  assert.throws(() => db.prepare('UPDATE journey_action_quota_counters SET consumed_quantity=-1 WHERE space_id=?').run('space-a'),
    /safety counter|CHECK/u);
  db.close();
});
