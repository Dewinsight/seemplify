import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.resolve(here, '..', 'migrations', 'postgres',
  '0032_journey_taxonomy_retirement_safeguard.sql'), 'utf8');
const historical = fs.readFileSync(path.resolve(here, '..', 'migrations', 'postgres',
  '0029_journey_hierarchy_blueprints.sql'), 'utf8');

test('runtime-32 is forward-only and requires the exact runtime-31 predecessor', () => {
  assert.match(migration, /MAX\(version\).*<>31/su);
  assert.doesNotMatch(migration, /^CREATE TABLE/gmu);
  assert.doesNotMatch(historical, /Remove journey assignments before retiring this taxonomy term/u,
    'the already-shipped runtime-29 migration must remain immutable');
});

test('runtime-32 serializes assignment and retirement before enforcing both sides', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/u);
  assert.match(migration, /TG_TABLE_NAME='journey_definition_taxonomy'/u);
  assert.match(migration, /Journey taxonomy assignments require an active same-space term/u);
  assert.match(migration, /NEW.lifecycle='retired' AND OLD.lifecycle='active'/u);
  assert.match(migration, /Remove journey assignments before retiring this taxonomy term/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF space_id,term_id ON journey_definition_taxonomy/u);
  assert.match(migration, /BEFORE UPDATE OF space_id,lifecycle ON journey_taxonomy_terms/u);
});
