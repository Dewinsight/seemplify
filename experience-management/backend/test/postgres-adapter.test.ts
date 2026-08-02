import assert from 'node:assert/strict';
import test from 'node:test';
import { bindPostgresQuery, isDatabaseConstraintError, translatePostgresSql } from '../src/databaseAdapter.js';

test('bindPostgresQuery converts positional values without touching literals or comments', () => {
  const result = bindPostgresQuery("SELECT '?' literal, value FROM records WHERE first=? -- ?\nAND second=?", ['one', 'two']);
  assert.equal(result.text, "SELECT '?' literal, value FROM records WHERE first=$1 -- ?\nAND second=$2");
  assert.deepEqual(result.values, ['one', 'two']);
});

test('bindPostgresQuery supports repeated better-sqlite3 named parameters', () => {
  const result = bindPostgresQuery('INSERT INTO records(id,name) VALUES (@id,:name) ON CONFLICT(id) DO UPDATE SET name=$name', [
    { id: 'record-1', name: 'Updated' }
  ]);
  assert.equal(result.text, 'INSERT INTO records(id,name) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET name=$2');
  assert.deepEqual(result.values, ['record-1', 'Updated']);
});

test('bindPostgresQuery rejects missing and extra positional bindings', () => {
  assert.throws(() => bindPostgresQuery('SELECT ?', []), /Missing positional SQL parameter 1/u);
  assert.throws(() => bindPostgresQuery('SELECT 1', ['unexpected']), /uses 0 placeholders/u);
});

test('translatePostgresSql preserves insert-ignore semantics and null parameter typing', () => {
  assert.equal(
    translatePostgresSql('INSERT OR IGNORE INTO records(id) VALUES ($1)'),
    'INSERT INTO records(id) VALUES ($1) ON CONFLICT DO NOTHING'
  );
  assert.equal(
    translatePostgresSql('SELECT 1 WHERE $1 IS NULL OR owner_id=$2'),
    'SELECT 1 WHERE ($1::text) IS NULL OR owner_id=$2'
  );
});

test('translatePostgresSql maps runtime JSON, scalar maximum, and case-insensitive comparisons', () => {
  const translated = translatePostgresSql(
    "SELECT json_extract(input_json,'$.output.journey.id') value FROM ai_jobs " +
    'WHERE json_valid(input_json) AND current_version=MAX(current_version,$1) AND email=$2 COLLATE NOCASE'
  );
  assert.match(translated, /experience_json_extract_safe\(input_json,'\$\.output\.journey\.id'\)/u);
  assert.match(translated, /\(input_json IS NOT NULL\)/u);
  assert.match(translated, /GREATEST\(current_version,\$1\)/u);
  assert.match(translated, /LOWER\(email\)=LOWER\(\$2\)/u);
});

test('translatePostgresSql keeps guarded JSON extraction safe for malformed legacy rows', () => {
  assert.equal(
    translatePostgresSql("SELECT CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.journeyId') END FROM ai_jobs"),
    "SELECT experience_json_extract_safe(input_json,'$.journeyId') FROM ai_jobs"
  );
});

test('constraint detection accepts SQLite and PostgreSQL integrity SQLSTATEs', () => {
  assert.equal(isDatabaseConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' }), true);
  assert.equal(isDatabaseConstraintError({ code: '23505' }), true);
  assert.equal(isDatabaseConstraintError({ code: '40001' }), false);
});
