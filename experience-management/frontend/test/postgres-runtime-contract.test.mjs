import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  LATEST_RUNTIME_SCHEMA_VERSION,
  RUNTIME_EXTENSION_TABLES,
  journeyAiSuggestionRuntimeContract,
  journeyEvidenceLifecycleRuntimeContract,
  journeyMapRuntimeContract,
  journeyMetricAlertRuntimeContract,
  journeyMetricRuntimeContract,
  journeyResearchHubRuntimeContract,
  journeyRichCardRuntimeContract,
  journeySavedViewRuntimeContract,
  journeyV2RolloutRuntimeContract,
  runtimeTableSetDifference,
  usageLedgerRuntimeContract
} from '../../scripts/postgres-runtime-contract.mjs';

const migrationDirectory = path.resolve(import.meta.dirname, '..', '..', 'backend', 'migrations', 'postgres');

// Bound by the allowlist's own version rather than a literal. Pinned to 26 this
// stayed green while covering nothing new: every table a later migration added
// was excluded from the left-hand side and from RUNTIME_EXTENSION_TABLES at the
// same time, so the one static gate proving the allowlist equals the set of
// migration-owned tables silently stopped proving it.
function tablesCreatedByRuntimeMigrations() {
  return fs.readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)
      && Number(name.slice(0, 4)) <= LATEST_RUNTIME_SCHEMA_VERSION)
    .sort()
    .flatMap((name) => {
      const sql = fs.readFileSync(path.join(migrationDirectory, name), 'utf8');
      return [...sql.matchAll(/^CREATE TABLE(?: IF NOT EXISTS)? ([a-z_][a-z0-9_]*)/gimu)]
        .map((match) => match[1]);
    });
}

test('allows every migration-owned runtime table and no arbitrary tables', () => {
  const legitimateExtensions = new Set([
    'experience_runtime_schema_version',
    ...tablesCreatedByRuntimeMigrations()
  ]);
  const verifierExtensions = new Set(RUNTIME_EXTENSION_TABLES);

  assert.deepEqual(
    [...verifierExtensions].sort(),
    [...legitimateExtensions].sort(),
    'The verifier extension allowlist must exactly match migration-owned runtime tables.'
  );

  const sourceTables = ['users', 'spaces'];
  const legitimateActualTables = [...sourceTables, ...verifierExtensions];
  assert.deepEqual(runtimeTableSetDifference(sourceTables, legitimateActualTables), {
    unknownTables: [],
    missingTables: []
  });
  assert.deepEqual(
    runtimeTableSetDifference(sourceTables, [...legitimateActualTables, 'unexpected_runtime_table']),
    { unknownTables: ['unexpected_runtime_table'], missingTables: [] }
  );
});

test('the governed rich-card migration and SQLite schema converge on runtime 24', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeyRichCards.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0024_journey_rich_cards.sql'), 'utf8');
  const sqliteType = (type) => ({
    bigint: 'integer', jsonb: 'text', 'timestamp with time zone': 'text'
  })[type] || type;

  for (const [table, expected] of Object.entries(journeyRichCardRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0024 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite rich-card schema drifted from runtime 24`);
  }

  for (const index of Object.keys(journeyRichCardRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from migration 0024`);
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from the SQLite rich-card schema`);
  }
});

test('journey metric alert storage converges on runtime 25', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeyMetricAlertSchema.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0025_journey_metric_alerts.sql'), 'utf8');
  const sqliteType = (type) => ({ bigint: 'integer', boolean: 'integer', jsonb: 'text',
    'timestamp with time zone': 'text' })[type] || type;

  for (const [table, expected] of Object.entries(journeyMetricAlertRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0025 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite metric-alert schema drifted from runtime 25`);
  }

  for (const index of Object.keys(journeyMetricAlertRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from migration 0025`);
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from the SQLite metric-alert schema`);
  }
  for (const [name, [table]] of Object.entries(journeyMetricAlertRuntimeContract.triggers)) {
    assert.match(migration, new RegExp(`TRIGGER ${name}\\s+BEFORE UPDATE OR DELETE ON ${table}`, 'u'),
      `${name} must reject both mutation and deletion in PostgreSQL`);
  }
});

test('governed saved-view storage converges on runtime 26', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeySavedViews.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0026_journey_saved_views.sql'), 'utf8');
  const sqliteType = (type) => ({ boolean: 'integer', 'timestamp with time zone': 'text' })[type] || type;

  for (const [table, expected] of Object.entries(journeySavedViewRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0026 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite saved-view schema drifted from runtime 26`);
  }
  for (const index of Object.keys(journeySavedViewRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from migration 0026`);
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from the SQLite saved-view schema`);
  }
  assert.match(migration, /journey_saved_view_reference_tenant_guard[\s\S]+BEFORE INSERT OR UPDATE ON journey_saved_view_references/u);
  assert.match(migration, /journey_saved_view_operations_append_only[\s\S]+BEFORE UPDATE OR DELETE ON journey_saved_view_operations/u);
  assert.match(migration, /journey_saved_view_audit_append_only[\s\S]+BEFORE UPDATE OR DELETE ON journey_saved_view_audit_events/u);
});

/** Parse a CREATE TABLE body into [name, SQL type, nullable] triples so the
 * runtime contract can be checked against the schema that actually ships. */
function tableColumns(sql, table) {
  const declaration = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}\\s*\\(`, 'iu').exec(sql);
  if (!declaration) return null;
  const start = declaration.index;
  const open = sql.indexOf('(', start);
  let depth = 0;
  let end = open;
  for (; end < sql.length; end += 1) {
    if (sql[end] === '(') depth += 1;
    else if (sql[end] === ')') { depth -= 1; if (depth === 0) break; }
  }
  const body = sql.slice(open + 1, end);
  const parts = [];
  let current = '';
  depth = 0;
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += character;
  }
  parts.push(current);
  const pgType = {
    TEXT: 'text',
    INTEGER: 'integer',
    REAL: 'double precision',
    BIGINT: 'bigint',
    JSONB: 'jsonb',
    NUMERIC: 'numeric',
    TIMESTAMPTZ: 'timestamp with time zone',
    'DOUBLE PRECISION': 'double precision'
  };
  return parts
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT|--)/iu.test(part))
    .map((part) => {
      const [name, firstType, secondType] = part.split(/\s+/u);
      const rawDeclaredType = firstType.toUpperCase() === 'DOUBLE' && secondType?.toUpperCase() === 'PRECISION'
        ? 'DOUBLE PRECISION'
        : firstType.toUpperCase();
      const declaredType = rawDeclaredType.replace(/\([^)]*\)$/u, '');
      // A column-level PRIMARY KEY implies NOT NULL in PostgreSQL.
      const notNull = /NOT\s+NULL/iu.test(part) || /\bPRIMARY\s+KEY\b/iu.test(part);
      return [name, pgType[declaredType] || declaredType.toLowerCase(), !notNull];
    });
}

test('the Journey Map 2.0 runtime contract matches the schema that ships', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'database.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0012_journey_map_v2.sql'), 'utf8');

  for (const [table, expected] of Object.entries(journeyMapRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0012 drifted from its runtime column contract`);
    const sqliteExpected = table === 'journey_evidence_links'
      ? journeyEvidenceLifecycleRuntimeContract.columns.journey_evidence_links
      : expected;
    assert.deepEqual(tableColumns(sqlite, table), sqliteExpected,
      `${table} in the SQLite schema drifted from its runtime column contract`);
  }

  // Named indexes must exist in both schemas, or a fresh SQLite-to-PostgreSQL
  // cutover and an in-place upgrade would not converge on the same shape.
  for (const index of Object.keys(journeyMapRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'), `${index} is missing from migration 0012`);
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'), `${index} is missing from the SQLite schema`);
  }

  // Tenancy is a typed column on every journey table, never an inferred join.
  for (const table of Object.keys(journeyMapRuntimeContract.columns)) {
    assert.ok(
      journeyMapRuntimeContract.columns[table].some(([name]) => name === 'space_id'),
      `${table} must carry space_id`
    );
    assert.ok(
      journeyMapRuntimeContract.foreignKeys.some(([source, column, target]) =>
        source === table && column === 'space_id' && target === 'spaces'),
      `${table}.space_id must reference spaces`
    );
  }
});

test('the Journey Research Hub migration and SQLite schema converge on runtime 19', () => {
  const sqlitePlatform = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'platformSchema.ts'), 'utf8');
  const sqliteKnowledge = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'knowledgeRepository.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0019_journey_research_hub.sql'), 'utf8');

  const sqliteType = (type) => ({
    bigint: 'integer',
    jsonb: 'text',
    numeric: 'double precision',
    'timestamp with time zone': 'text'
  })[type] || type;

  for (const [table, expected] of Object.entries(journeyResearchHubRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0019 drifted from its runtime column contract`);
    assert.deepEqual(
      tableColumns(sqlitePlatform, table),
      expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite schema drifted from its runtime-19 column contract`
    );
  }

  for (const index of Object.keys(journeyResearchHubRuntimeContract.indexes)) {
    const pattern = new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u');
    assert.match(migration, pattern, `${index} is missing from migration 0019`);
    assert.match(`${sqlitePlatform}\n${sqliteKnowledge}`, pattern, `${index} is missing from the SQLite schema`);
  }

  assert.match(migration, /MAX\(version\)[^;]*<>18/isu,
    'runtime 19 must require the checksummed runtime-18 predecessor');
  assert.match(migration, /UNIQUE\(space_id,user_id,dedupe_key\)/u,
    'notifications must remain idempotent even when refresh_run_id is null');
  for (const name of Object.keys(journeyResearchHubRuntimeContract.constraints)) {
    assert.match(migration, new RegExp(`CONSTRAINT ${name}(?![A-Za-z0-9_])`, 'u'), `${name} is missing`);
  }
  assert.doesNotMatch(migration, /CREATE TABLE(?: IF NOT EXISTS)? (?:knowledge_chunks|document_chunks|embeddings|vector_store)/iu,
    'runtime 19 must reuse the existing knowledge/content stores instead of duplicating them');
});

test('Journey Map 2.0 rollout storage converges on runtime 20 without storing journey content', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeyRollout.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0020_journey_v2_rollout.sql'), 'utf8');
  const sqliteType = (type) => ({ jsonb: 'text', 'timestamp with time zone': 'text' })[type] || type;
  for (const [table, expected] of Object.entries(journeyV2RolloutRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0020 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite schema drifted from its runtime-20 column contract`);
  }
  for (const index of Object.keys(journeyV2RolloutRuntimeContract.indexes)) {
    const pattern = new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u');
    assert.match(migration, pattern);
    assert.match(sqlite, pattern);
  }
  assert.match(migration, /MAX\(version\)[^;]*<>19/isu);
  assert.match(migration, /journey_v2_divergences_append_only_trigger/u);
  assert.doesNotMatch(migration, /(?:content|excerpt|payload)_json\s/u);
});

test('journey metric observation storage converges on runtime 21 without copying raw source payloads', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeyMetricSchema.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0021_journey_metric_observations.sql'), 'utf8');
  const sqliteType = (type) => ({ jsonb: 'text', 'timestamp with time zone': 'text' })[type] || type;
  for (const [table, expected] of Object.entries(journeyMetricRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0021 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite schema drifted from its runtime-21 column contract`);
  }
  for (const index of Object.keys(journeyMetricRuntimeContract.indexes)) {
    const pattern = new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u');
    assert.match(migration, pattern, `${index} is missing from migration 0021`);
    assert.match(sqlite, pattern, `${index} is missing from SQLite parity`);
  }
  assert.match(migration, /MAX\(version\)[^;]*<>20/isu);
  assert.match(migration, /UNIQUE\(space_id,definition_id,source_id,external_record_sha256,revision\)/u);
  assert.doesNotMatch(migration, /answers_json|properties_json\s+JSONB|payload_json/u);
});

test('reviewed journey AI suggestion storage converges on runtime 22 with immutable tenant-scoped history', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'journeySuggestions.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0022_journey_ai_suggestions.sql'), 'utf8');
  const sqliteType = (type) => ({ jsonb: 'text', 'timestamp with time zone': 'text' })[type] || type;
  for (const [table, expected] of Object.entries(journeyAiSuggestionRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0022 drifted from its runtime column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected.map(([name, type, nullable]) => [name, sqliteType(type), nullable]),
      `${table} in the SQLite schema drifted from the runtime-22 column contract`);
  }
  for (const index of Object.keys(journeyAiSuggestionRuntimeContract.indexes)) {
    const pattern = new RegExp(`INDEX(?: IF NOT EXISTS)? ${index}(?![A-Za-z0-9_])`, 'u');
    assert.match(migration, pattern, `${index} is missing from migration 0022`);
    if (!index.includes('definitions_tenant_identity') && !index.includes('versions_tenant_identity')) {
      assert.match(sqlite, pattern, `${index} is missing from SQLite parity`);
    }
  }
  assert.match(migration, /MAX\(version\)[^;]*<>21/isu);
  assert.match(migration, /journey_ai_suggestion_controlled_purge/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION journey_ai_suggestion_controlled_purge/u);
  assert.doesNotMatch(migration, /answers_json|properties_json\s+JSONB|raw_payload_json/u);
});

test('the Journey evidence lifecycle migration and SQLite schema converge on runtime 14', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'database.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0014_journey_evidence_lifecycle.sql'), 'utf8');
  const evidenceColumns = journeyEvidenceLifecycleRuntimeContract.columns.journey_evidence_links;
  assert.deepEqual(tableColumns(sqlite, 'journey_evidence_links'), evidenceColumns,
    'SQLite Journey evidence links drifted from the runtime-14 column contract');
  for (const column of ['source_updated_at', 'last_validated_at']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} TEXT`, 'u'));
  }
  assert.deepEqual(
    tableColumns(migration, 'journey_evidence_audit_events'),
    journeyEvidenceLifecycleRuntimeContract.columns.journey_evidence_audit_events
  );
  assert.deepEqual(
    tableColumns(sqlite, 'journey_evidence_audit_events'),
    journeyEvidenceLifecycleRuntimeContract.columns.journey_evidence_audit_events
  );
  for (const index of Object.keys(journeyEvidenceLifecycleRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'));
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'));
  }
});

test('the durable usage ledger migration and SQLite schema converge on runtime 15', () => {
  const sqlite = fs.readFileSync(path.resolve(migrationDirectory, '..', '..', 'src', 'platformSchema.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(migrationDirectory, '0015_subscription_usage_ledger.sql'), 'utf8');
  for (const [table, expected] of Object.entries(usageLedgerRuntimeContract.columns)) {
    assert.deepEqual(tableColumns(migration, table), expected,
      `${table} in migration 0015 drifted from the runtime-15 column contract`);
    assert.deepEqual(tableColumns(sqlite, table), expected,
      `${table} in the SQLite schema drifted from the runtime-15 column contract`);
  }
  for (const index of Object.keys(usageLedgerRuntimeContract.indexes)) {
    assert.match(migration, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from migration 0015`);
    assert.match(sqlite, new RegExp(`INDEX IF NOT EXISTS ${index}(?![A-Za-z0-9_])`, 'u'),
      `${index} is missing from the SQLite schema`);
  }
  assert.doesNotMatch(migration, /\b(?:metadata_json|request_body|prompt|export_content)\s+TEXT/iu,
    'usage accounting must not persist customer payloads or free-form metadata');
});
