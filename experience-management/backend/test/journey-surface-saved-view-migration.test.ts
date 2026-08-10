import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * STATIC contract test for runtime-55
 * (`migrations/postgres/future/0055_journey_surface_saved_views.sql`).
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * migration TEXT. This file does NOT create a database, does NOT apply the
 * migration and does NOT execute a single trigger, so it is NOT executed-
 * PostgreSQL proof and must not be recorded as one. Statements that satisfy
 * these regexes can still fail against a live server. Executed coverage for
 * runtime-55 remains a separate gate, in the shape of the per-migration probes
 * in `scripts/probe-journey-*-postgres.mjs`.
 *
 * runtime-55 is DELIBERATELY UNREGISTERED. It lives under `future/` because
 * runtime-compatibility.json, config.ts and the aggregate privilege file are all
 * still pinned at 54, and `runtime-privilege-contract.test.ts` fails closed on
 * any `NNNN_*.sql` above the registered window sitting in the migration root.
 * Registration is a separate change; this file proves the tranche is correct
 * before it is wired, and asserts the staging location so it cannot drift into
 * the root by accident.
 *
 * What it does prove is the defect class runtime-29 shipped in its first draft:
 * a composite FOREIGN KEY whose referenced column set has no matching unique
 * key, which aborts the entire file at DDL time with SQLSTATE 42830.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const readMigration = (relative: string) => fs.readFileSync(path.join(migrationRoot, relative), 'utf8');

/** Every assertion must read executable DDL, never prose: an absence assertion
 * would otherwise trip on a comment that explains why the construct was removed.
 * No string literal in this migration spans a line, so per-line quote parity is
 * enough to avoid truncating at a `--` inside a literal. */
function stripSqlComments(sql: string): string {
  return sql.split('\n').map((line) => {
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "'") quoted = !quoted;
      else if (!quoted && line[index] === '-' && line[index + 1] === '-') return line.slice(0, index);
    }
    return line;
  }).join('\n');
}

const migrationRelativePath = path.join('future', '0055_journey_surface_saved_views.sql');
const migration = stripSqlComments(readMigration(migrationRelativePath));
const repositorySource = fs.readFileSync(
  path.join(backendRoot, 'src', 'journeySurfaceSavedViewRepository.ts'), 'utf8');
const spacesSource = fs.readFileSync(path.join(backendRoot, 'src', 'spaces.ts'), 'utf8');
const hierarchyMigration = stripSqlComments(readMigration('0029_journey_hierarchy_blueprints.sql'));
const stageProcessing = stripSqlComments(readMigration('0018_journey_stage_processing.sql'));

const flatten = (text: string) => text.replace(/\s+/gu, ' ').trim();
const flatMigration = flatten(migration);

function tableBlock(source: string, table: string): string {
  const start = source.indexOf(`CREATE TABLE ${table} (`);
  assert.notEqual(start, -1, `${table} must be declared by runtime-55`);
  const end = source.indexOf('\n);', start);
  assert.notEqual(end, -1, `${table} must terminate with a closing paren`);
  return source.slice(start, end + 3);
}

function functionBody(name: string): string {
  const start = flatMigration.indexOf(`FUNCTION ${name}()`);
  assert.notEqual(start, -1, `${name} must be declared by runtime-55`);
  const end = flatMigration.indexOf(`$${name}$;`, start);
  assert.notEqual(end, -1, `${name} must terminate`);
  return flatMigration.slice(start, end);
}

/** First `<column> IN ('a','b')` list inside a block, sorted for order-free comparison. */
function enumValues(block: string, column: string): string[] {
  const match = new RegExp(`${column} IN \\(([^)]*)\\)`, 'u').exec(flatten(block));
  assert.ok(match, `${column} must declare an enumerated CHECK`);
  return match[1]!.split(',').map((value) => value.trim().replace(/^'|'$/gu, '')).sort();
}

/**
 * Column names declared by a CREATE TABLE body, excluding CONSTRAINT / CHECK /
 * FOREIGN KEY / PRIMARY KEY / UNIQUE clauses. Splits on top-level commas rather
 * than on lines: the SQLite mirror packs several columns onto one line, and a
 * line-based reader would silently compare a short list against a long one and
 * pass for the wrong reason.
 */
function columnNames(block: string): string[] {
  const body = block.slice(block.indexOf('(') + 1, block.lastIndexOf(')'));
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { segments.push(current); current = ''; continue; }
    current += character;
  }
  segments.push(current);
  const names = new Set<string>();
  for (const segment of segments) {
    const match = /^\s*([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|BIGINT|BOOLEAN|NUMERIC|TIMESTAMPTZ|REAL)\b/u
      .exec(segment);
    if (match) names.add(match[1]!);
  }
  return [...names].sort();
}

const sortedKey = (columns: string) => columns.split(',')
  .map((column) => column.trim().replace(/\s+(?:DESC|ASC)$/u, '')).sort().join(',');

/** Column sets a FOREIGN KEY may legally reference: PostgreSQL requires a unique
 * index whose key columns match the referenced list as a SET. Partial unique
 * indexes are excluded because they cannot back a foreign key. */
function declaredUniqueKeys(sql: string): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  const add = (table: string, columns: string) => {
    const existing = keys.get(table) ?? new Set<string>();
    existing.add(sortedKey(columns));
    keys.set(table, existing);
  };
  for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+) \(([\s\S]*?)\n\);/gu)) {
    const table = match[1]!;
    const flat = flatten(match[2]!);
    for (const key of flat.matchAll(/(?:UNIQUE|PRIMARY KEY)(?: NULLS NOT DISTINCT)? ?\(([^)]*)\)/gu)) {
      add(table, key[1]!);
    }
    for (const inline of flat.matchAll(/([a-z_]+) TEXT (?:[A-Z ]*)?PRIMARY KEY/gu)) add(table, inline[1]!);
  }
  for (const match of sql.matchAll(
    /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?[a-z_]+\s+ON ([a-z_]+)\s*\(([^)]*)\)([^;]*);/gu)) {
    if (/\bWHERE\b/u.test(match[3]!)) continue;
    add(match[1]!, match[2]!);
  }
  return keys;
}

/** Unique keys runtime-55 depends on but does not declare. Each is re-asserted
 * against its declaring source below, so an upstream rename breaks this test
 * rather than silently breaking the migration. */
const externalUniqueKeys = new Map<string, string[]>([
  ['spaces', ['id']],
  ['users', ['id']],
  ['space_memberships', ['space_id,user_id']]
]);

const runtime55Tables = [
  'journey_surface_view_definitions',
  'journey_surface_view_versions',
  'journey_surface_view_defaults',
  'journey_surface_view_audit_events'
];

test('runtime-55 is staged unregistered and gates on the exact runtime-54 predecessor', () => {
  assert.equal(fs.existsSync(path.join(migrationRoot, migrationRelativePath)), true,
    'the runtime-55 tranche must live under migrations/postgres/future until it is registered');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0055_journey_surface_saved_views.sql')), false,
    'moving runtime-55 into the migration root registers it, and the aggregate contracts are still pinned at 54');
  assert.match(migration,
    /IF COALESCE\(\(SELECT MAX\(version\) FROM experience_runtime_schema_version\),0\)<>54 THEN/u,
    'runtime-55 must refuse to apply on top of anything but runtime-54');
  // The runner owns experience_runtime_schema_version and supplies a checksum a
  // migration cannot know about itself; a self-stamp aborts on 23502.
  assert.deepEqual([...migration.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)].map((m) => m[0]!), [],
    'the runner stamps the ledger; a migration that stamps itself never commits');
});

test('every runtime-55 foreign key resolves to a real unique key', () => {
  assert.match(spacesSource, /CREATE TABLE IF NOT EXISTS space_memberships \(/u);
  assert.match(spacesSource, /PRIMARY KEY\(space_id,user_id\)/u);
  const local = declaredUniqueKeys(migration);
  const references = [...flatMigration.matchAll(/REFERENCES ([a-z_]+)\(([^)]*)\)/gu)];
  assert.ok(references.length >= 8, 'runtime-55 must keep its composite tenant foreign keys');
  const unbacked: string[] = [];
  for (const reference of references) {
    const table = reference[1]!;
    const key = sortedKey(reference[2]!);
    const backed = local.get(table)?.has(key) || externalUniqueKeys.get(table)?.includes(key);
    if (!backed) unbacked.push(`${table}(${reference[2]!.trim()})`);
  }
  assert.deepEqual(unbacked, [],
    'each listed reference has no unique key of exactly those columns, so PostgreSQL aborts the '
      + 'migration with SQLSTATE 42830 before anything else in this file can be evaluated');
});

test('the deferred current-version pointer is backed by its own three-column identity key', () => {
  assert.match(tableBlock(migration, 'journey_surface_view_versions'),
    /journey_surface_view_versions_current_identity UNIQUE\(id,view_id,space_id\)/u);
  assert.match(flatMigration,
    /ALTER TABLE journey_surface_view_definitions ADD CONSTRAINT journey_surface_view_definitions_current_version_fk FOREIGN KEY\(current_version_id,id,space_id\) REFERENCES journey_surface_view_versions\(id,view_id,space_id\) DEFERRABLE INITIALLY DEFERRED;/u);
  // runtime-29 solves the identical problem the identical way; runtime-55 must not drift.
  assert.match(hierarchyMigration,
    /journey_blueprint_versions_current_identity UNIQUE\(id,blueprint_id,space_id\)/u);
});

test('the surface discriminator and the audience kind are closed enumerations', () => {
  for (const table of runtime55Tables) {
    assert.deepEqual(enumValues(tableBlock(migration, table), 'surface'),
      ['hierarchy', 'service_blueprint'], `${table} must carry the same surface discriminator`);
  }
  assert.deepEqual(enumValues(tableBlock(migration, 'journey_surface_view_definitions'), 'audience'),
    ['delivery', 'executive', 'external', 'internal', 'research']);
  assert.deepEqual(enumValues(tableBlock(migration, 'journey_surface_view_definitions'), 'lifecycle'),
    ['active', 'retired']);
  // Three columns, not two: a version can never claim a surface its own view
  // does not have, and a default can never pin a view from another surface.
  assert.match(flatMigration,
    /journey_surface_view_versions_parent_fk FOREIGN KEY\(view_id,space_id,surface\) REFERENCES journey_surface_view_definitions\(id,space_id,surface\) ON DELETE CASCADE/u);
  assert.match(flatMigration,
    /journey_surface_view_defaults_view_fk FOREIGN KEY\(view_id,space_id,surface\) REFERENCES journey_surface_view_definitions\(id,space_id,surface\) ON DELETE CASCADE/u);
});

test('surface-specific configuration is bounded, typed and mutually exclusive', () => {
  const block = tableBlock(migration, 'journey_surface_view_versions');
  assert.deepEqual(enumValues(block, 'hierarchy_direction'), ['ancestors', 'both', 'descendants']);
  assert.deepEqual(enumValues(block, 'hierarchy_link_type'),
    ['handoff', 'parent_child', 'related', 'stage_subjourney', 'variant']);
  assert.deepEqual(enumValues(block, 'hierarchy_review_state'),
    ['approved', 'changes_requested', 'draft', 'in_review']);
  assert.deepEqual(enumValues(block, 'hierarchy_lifecycle'), ['active', 'all', 'retired']);
  assert.deepEqual(enumValues(block, 'blueprint_version_mode'), ['current', 'pinned']);
  assert.deepEqual(enumValues(block, 'blueprint_tab'),
    ['gaps', 'lanes', 'measurements', 'overview', 'portfolio', 'relationships']);
  assert.deepEqual(enumValues(block, 'blueprint_lifecycle'),
    ['all', 'approved', 'draft', 'in_review', 'retired']);
  // Both halves of the exclusion: the surface's own columns are required AND the
  // other surface's columns are all NULL, so a hierarchy view cannot carry a
  // blueprint pin that no reader would ever apply.
  assert.match(flatten(block),
    /surface='hierarchy' AND hierarchy_direction IS NOT NULL AND hierarchy_lifecycle IS NOT NULL AND blueprint_id IS NULL AND blueprint_version_mode IS NULL AND blueprint_version_id IS NULL AND blueprint_tab IS NULL AND blueprint_lifecycle IS NULL/u);
  assert.match(flatten(block),
    /surface='service_blueprint' AND blueprint_id IS NOT NULL AND blueprint_version_mode IS NOT NULL AND blueprint_tab IS NOT NULL AND blueprint_lifecycle IS NOT NULL AND hierarchy_root_definition_id IS NULL/u);
  assert.match(flatten(block),
    /hierarchy_direction IS NULL OR hierarchy_direction='both' OR hierarchy_root_definition_id IS NOT NULL/u);
  assert.match(flatten(block),
    /blueprint_version_mode='pinned' AND blueprint_version_id IS NOT NULL/u);
});

test('the configuration document is a closed key surface with no interpretable string', () => {
  const block = flatten(tableBlock(migration, 'journey_surface_view_versions'));
  assert.match(block,
    /configuration_json::jsonb - ARRAY\['schemaVersion','surface','hierarchy','blueprint','presentation'\]::text\[\]\) = '\{\}'::jsonb/u,
    'an unlisted top-level key must leave a non-empty remainder and fail the CHECK');
  for (const nested of ['hierarchy', 'blueprint', 'presentation']) {
    assert.match(block, new RegExp(`configuration_json::jsonb->'${nested}' - ARRAY\\[`, 'u'),
      `${nested} must carry its own key allowlist, or the ban only holds at the top level`);
  }
  // CASE, not AND: PostgreSQL does not guarantee AND evaluation order and
  // `jsonb - text[]` RAISES on a scalar, so a typeof test written as a preceding
  // conjunct would not reliably guard the subtraction.
  assert.match(block, /CASE jsonb_typeof\(configuration_json::jsonb\) WHEN 'object' THEN/u);
  assert.match(block, /ELSE FALSE END/u);
  // No column anywhere in the tranche may hold a query, an expression or free
  // prose for the service to interpret.
  const suspicious = [...migration.matchAll(
    /^\s{2}([a-z_]*(?:sql|query|expression|predicate|clause|filter_text|script)[a-z_]*)\s+TEXT/gimu)];
  assert.deepEqual(suspicious.map((match) => match[1]!), [],
    'a saved view must never carry a SQL fragment or query string');
});

test('configuration versions and the audit trail are append-only and content-safe', () => {
  const guard = functionBody('journey_surface_view_append_only_guard');
  assert.match(guard, /RAISE EXCEPTION 'Journey surface view configuration versions and audit are append-only'/u);
  assert.match(flatMigration,
    /CREATE TRIGGER journey_surface_view_versions_append_only BEFORE UPDATE OR DELETE ON journey_surface_view_versions FOR EACH ROW EXECUTE FUNCTION journey_surface_view_append_only_guard\(\)/u);
  assert.match(flatMigration,
    /CREATE TRIGGER journey_surface_view_audit_append_only BEFORE UPDATE OR DELETE ON journey_surface_view_audit_events FOR EACH ROW EXECUTE FUNCTION journey_surface_view_append_only_guard\(\)/u);
  // Content-safety is structural: the audit table has no name, no configuration
  // document and no free-text detail column at all, so there is nothing for a
  // redaction rule to get wrong later.
  const audit = tableBlock(migration, 'journey_surface_view_audit_events');
  assert.deepEqual(columnNames(audit), [
    'action', 'actor_user_id', 'configuration_sha256', 'created_at', 'definition_revision',
    'id', 'space_id', 'surface', 'version_number', 'view_sha256'
  ]);
  assert.match(audit, /view_sha256 TEXT NOT NULL CHECK\(view_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u,
    'the audited view identity must be a hash, not the identifier itself');
  assert.doesNotMatch(audit, /\bname\b|detail_json|configuration_json/u);
});

test('every runtime-55 guard function closes the PUBLIC execute default', () => {
  // PostgreSQL grants EXECUTE on every new function to PUBLIC. Revoking only
  // from the application role drops the explicit grant and leaves the default,
  // so has_function_privilege stays true and assertRuntimePrivileges raises
  // RUNTIME_PRIVILEGE_OVER_GRANT. Runtime-43 is why this rule exists.
  const declared = [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_]+)\(\)/gu)].map((m) => m[1]!);
  assert.deepEqual(declared.sort(), [
    'journey_surface_view_append_only_guard',
    'journey_surface_view_definition_guard',
    'journey_surface_view_version_guard'
  ]);
  for (const name of declared) {
    assert.match(flatMigration, new RegExp(`REVOKE ALL ON FUNCTION ${name}\\(\\) FROM PUBLIC;`, 'u'),
      `${name} stays executable by the application role through the PUBLIC default`);
  }
});

test('the optimistic revision and the gapless version sequence are enforced in the database', () => {
  const definitionGuard = functionBody('journey_surface_view_definition_guard');
  assert.match(definitionGuard,
    /NEW.owner_user_id<>OLD.owner_user_id[\s\S]*?RAISE EXCEPTION 'Journey surface view identity and ownership are immutable'/u,
    'ownership must be immutable, or a member could hand a view to somebody else');
  assert.match(definitionGuard,
    /NEW.definition_revision<>OLD.definition_revision\+1 THEN RAISE EXCEPTION 'Journey surface view revision is stale' USING ERRCODE='40001'/u);
  assert.match(definitionGuard,
    /NEW.current_version_number<OLD.current_version_number THEN RAISE EXCEPTION 'Journey surface view configuration versions never move backwards'/u);
  // UPDATE OF names only the governed columns: the ON DELETE SET NULL that fires
  // when an attributed user is removed must not trip the revision rule and make
  // user deletion fail (the runtime-29 membership-FK lesson).
  const trigger =
    /CREATE TRIGGER journey_surface_view_definition_guard BEFORE UPDATE OF ([a-z_,\s]+) ON journey_surface_view_definitions/u
      .exec(flatMigration);
  assert.ok(trigger, 'the definition guard must be column-scoped');
  const guarded = trigger[1]!.split(',').map((column) => column.trim());
  assert.equal(guarded.includes('created_by_user_id'), false);
  assert.equal(guarded.includes('updated_by_user_id'), false);
  assert.equal(guarded.includes('definition_revision'), true);

  const versionGuard = functionBody('journey_surface_view_version_guard');
  assert.match(versionGuard, /FOR UPDATE;/u,
    'concurrent revisions of one view must serialise on the parent row');
  assert.match(versionGuard,
    /NEW.definition_revision<>parent_revision THEN RAISE EXCEPTION 'Journey surface view revision is stale' USING ERRCODE='40001'/u);
  assert.match(versionGuard,
    /SELECT COALESCE\(MAX\(version_number\),0\)\+1 INTO appended_version_number/u);
  assert.match(versionGuard, /A retired journey surface view cannot be revised/u);
  assert.match(flatMigration,
    /CREATE TRIGGER journey_surface_view_version_guard BEFORE INSERT ON journey_surface_view_versions/u);
});

test('configuration targets are proven same-tenant at write time instead of by foreign key', () => {
  // journey_definitions is hard-deleted, so a NO ACTION reference would refuse
  // that delete and a cascade cannot reach an append-only version row. The
  // tenancy proof therefore lives in the guard, exactly as runtime-26 does it.
  const block = tableBlock(migration, 'journey_surface_view_versions');
  for (const column of ['hierarchy_root_definition_id', 'hierarchy_taxonomy_term_id',
    'blueprint_id', 'blueprint_version_id']) {
    assert.doesNotMatch(flatten(block), new RegExp(`${column}[^,]*REFERENCES`, 'u'),
      `${column} must not carry a foreign key that could refuse an upstream delete`);
  }
  const guard = functionBody('journey_surface_view_version_guard');
  assert.match(guard, /FROM journey_definitions WHERE id=NEW.hierarchy_root_definition_id AND space_id=NEW.space_id/u);
  assert.match(guard, /FROM journey_taxonomy_terms WHERE id=NEW.hierarchy_taxonomy_term_id AND space_id=NEW.space_id/u);
  assert.match(guard, /FROM journey_blueprints WHERE id=NEW.blueprint_id AND space_id=NEW.space_id/u);
  assert.match(guard,
    /FROM journey_blueprint_versions WHERE id=NEW.blueprint_version_id AND space_id=NEW.space_id AND blueprint_id=NEW.blueprint_id/u,
    'a pinned blueprint version must belong to the blueprint the same view names');
  // The upstream tables the guard reads, asserted at their source.
  assert.match(stageProcessing, /journey_definitions_tenant_identity\s+ON journey_definitions\(id,space_id\)/u);
  assert.match(hierarchyMigration, /CREATE TABLE journey_taxonomy_terms \(/u);
  assert.match(hierarchyMigration, /CREATE TABLE journey_blueprints \(/u);
  assert.match(hierarchyMigration, /CREATE TABLE journey_blueprint_versions \(/u);
});

test('idempotent create, revise and default operations each have a durable natural key', () => {
  assert.match(flatMigration,
    /journey_surface_view_definitions_create_once UNIQUE\(space_id,owner_user_id,create_request_sha256\)/u);
  assert.match(flatMigration,
    /journey_surface_view_versions_request_once UNIQUE\(view_id,space_id,request_sha256\)/u);
  assert.match(flatMigration, /journey_surface_view_versions_number UNIQUE\(view_id,space_id,version_number\)/u);
  // One default per principal per surface; reset is the deletion of this row.
  assert.match(flatten(tableBlock(migration, 'journey_surface_view_defaults')),
    /PRIMARY KEY\(space_id,user_id,surface\)/u);
  assert.match(flatten(tableBlock(migration, 'journey_surface_view_defaults')),
    /journey_surface_view_defaults_version_fk FOREIGN KEY\(view_version_id,view_id,space_id\)/u,
    'a default must pin the exact version it selected, not just the view');
  // Owner-private and owner-bound: every writer path is anchored to a MEMBER of
  // the tenant, which is what makes "a member manages only its own views"
  // expressible at all.
  assert.match(flatMigration,
    /journey_surface_view_definitions_owner_membership_fk FOREIGN KEY\(space_id,owner_user_id\) REFERENCES space_memberships\(space_id,user_id\)/u);
  assert.match(flatMigration,
    /journey_surface_view_defaults_membership_fk FOREIGN KEY\(space_id,user_id\) REFERENCES space_memberships\(space_id,user_id\) ON DELETE CASCADE/u);
  assert.match(tableBlock(migration, 'journey_surface_view_definitions'),
    /owner_private BOOLEAN NOT NULL DEFAULT TRUE/u);
});

test('the SQLite mirror declares the same tables and the same columns as runtime-55', () => {
  // Development and test runs must enforce the same shape the migrated database
  // does, or a defect only reproduces in production. Column SETS are compared;
  // the type mapping (BOOLEAN -> INTEGER, TIMESTAMPTZ -> TEXT, regex CHECK ->
  // length()) is provider-specific by necessity.
  for (const table of runtime55Tables) {
    const start = repositorySource.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    assert.notEqual(start, -1, `${table} must be mirrored for SQLite`);
    const end = repositorySource.indexOf('\n    );', start);
    assert.notEqual(end, -1, `${table} mirror must terminate`);
    const mirrored = columnNames(repositorySource.slice(start, end + 7));
    const declared = columnNames(tableBlock(migration, table));
    assert.deepEqual(mirrored, declared, `${table} mirror has drifted from runtime-55`);
  }
  // The append-only and optimistic-revision guarantees are mirrored as triggers,
  // not left to the writer's good behaviour.
  for (const fragment of [
    'journey_surface_view_versions_update_append_only',
    'journey_surface_view_versions_delete_append_only',
    'journey_surface_view_audit_update_append_only',
    'journey_surface_view_audit_delete_append_only',
    'journey_surface_view_definition_revision_guard',
    'journey_surface_view_definition_identity_guard',
    'journey_surface_view_version_sequence_guard',
    'journey_surface_view_version_revision_guard',
    'journey_surface_view_version_config_keys_guard'
  ]) {
    assert.match(repositorySource, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${fragment}\\b`, 'u'),
      `${fragment} must exist in the SQLite mirror`);
  }
  assert.match(repositorySource,
    /Number\(db\.health\(\)\.runtimeSchemaVersion \|\| 0\) >= JOURNEY_SURFACE_VIEW_RUNTIME_SCHEMA_VERSION/u,
    'the repository must refuse to run against a PostgreSQL runtime below 55');
  assert.match(repositorySource, /JOURNEY_SURFACE_VIEW_RUNTIME_SCHEMA_VERSION = 55/u);
});
