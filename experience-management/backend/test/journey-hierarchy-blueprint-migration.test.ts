import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  journeyHierarchyLifecycles,
  journeyHierarchyLinkTypes,
  journeyHierarchyReviewStates,
  journeyHierarchyVariantDimensions
} from '../src/journeyHierarchy.js';
import {
  JOURNEY_SERVICE_BLUEPRINT_VERSION,
  journeyBlueprintElementKinds,
  journeyBlueprintGapSeverities,
  journeyBlueprintGapTypes,
  journeyBlueprintLanes,
  journeyBlueprintPortfolioRelationships,
  journeyBlueprintRelationshipKinds,
  journeyBlueprintResourceKinds,
  journeyBlueprintResourceLifecycles,
  journeyBlueprintReviewStates,
  journeyBlueprintStates
} from '../src/journeyServiceBlueprint.js';

/**
 * STATIC contract test for runtime-29 (`0029_journey_hierarchy_blueprints.sql`).
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * migration TEXT. This file does NOT create a database, does NOT apply the
 * migration, and does NOT execute a single trigger, so it is NOT executed-
 * PostgreSQL proof. A statement that satisfies these regexes can still fail
 * against a live server (wrong plpgsql control flow, a column that does not
 * exist on an upstream table, a planner-level rejection). Executed-PostgreSQL
 * coverage for runtime-29 is a separate and currently OPEN gate; see the
 * per-migration probe precedent in `scripts/probe-journey-*-postgres.mjs`.
 *
 * What it does prove is the class of defect that shipped in the first draft of
 * this migration: a three-column FOREIGN KEY whose referenced column set had no
 * matching unique key, which aborts the whole file at DDL time with SQLSTATE
 * 42830. `every runtime-29 foreign key resolves to a real unique key` below is
 * the standing regression guard for that.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const readMigration = (name: string) => fs.readFileSync(path.join(migrationRoot, name), 'utf8');

/**
 * Every assertion must read executable DDL, never prose. Absence assertions in
 * particular ("no ON DELETE RESTRICT", "no UNION ALL") would otherwise trip on a
 * comment that merely explains why the construct was removed. No string literal
 * in these migrations spans a line, so tracking quote parity per line is enough
 * to avoid truncating at a `--` that sits inside a literal.
 */
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

const migration = stripSqlComments(readMigration('0029_journey_hierarchy_blueprints.sql'));
const stageProcessing = stripSqlComments(readMigration('0018_journey_stage_processing.sql'));
const portfolio = stripSqlComments(readMigration('0027_journey_portfolio.sql'));
const collaboration = stripSqlComments(readMigration('0028_journey_collaboration.sql'));
const spacesSource = fs.readFileSync(path.join(backendRoot, 'src', 'spaces.ts'), 'utf8');
const runner = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'upgrade-postgres-schema.mjs'), 'utf8');

const flatten = (text: string) => text.replace(/\s+/gu, ' ').trim();
const flatMigration = flatten(migration);

function tableBlock(table: string): string {
  const start = migration.indexOf(`CREATE TABLE ${table} (`);
  assert.notEqual(start, -1, `${table} must be declared by runtime-29`);
  const end = migration.indexOf('\n);', start);
  assert.notEqual(end, -1, `${table} must terminate with a closing paren`);
  return migration.slice(start, end + 3);
}

function functionBody(name: string): string {
  const start = flatMigration.indexOf(`FUNCTION ${name}()`);
  assert.notEqual(start, -1, `${name} must be declared by runtime-29`);
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

const sortedKey = (columns: string) => columns.split(',')
  .map((column) => column.trim().replace(/\s+(?:DESC|ASC)$/u, '')).sort().join(',');

/**
 * Column sets a FOREIGN KEY may legally reference: PostgreSQL requires a unique
 * index whose key columns match the referenced list as a SET (same count, same
 * members; order is irrelevant). Partial unique indexes are excluded because
 * they cannot back a foreign key.
 */
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

/**
 * Unique keys runtime-29 depends on but does not declare. Each entry is
 * re-asserted against its declaring source below, so an upstream rename breaks
 * this test rather than silently breaking the migration.
 */
const externalUniqueKeys = new Map<string, string[]>([
  ['spaces', ['id']],
  ['users', ['id']],
  ['space_memberships', ['space_id,user_id']],
  ['journey_definitions', ['id', 'id,space_id']],
  ['journey_map_versions', ['id', 'definition_id,id,space_id']],
  ['journey_portfolio_item_versions', ['id', 'id,space_id', 'item_id,revision,space_id']]
]);

test('runtime-29 gates on its predecessor and leaves the ledger to the runner', () => {
  assert.match(
    migration,
    /IF COALESCE\(\(SELECT MAX\(version\) FROM experience_runtime_schema_version\),0\)<>28 THEN/u,
    'runtime-29 must refuse to apply on top of anything but runtime-28'
  );
  // This test used to require the opposite, and the requirement was unsatisfiable.
  // upgrade-postgres-schema.mjs owns experience_runtime_schema_version, declares
  // checksum TEXT NOT NULL with no default, and inserts the row itself after the
  // body commits. A self-stamp cannot supply that checksum -- a migration cannot
  // know its own sha256 -- so it aborted the entire file on its last statement
  // with SQLSTATE 23502, and would have collided on the version primary key even
  // if it could. 0027 and 0028 already carry the corrected shape.
  // \b, not \(: a stamp written as `... experience_runtime_schema_version VALUES`
  // or `... SELECT` is the same defect and must not slip past on punctuation.
  // This matches the strictness runtime-28's equivalent test already applies.
  const stamps = [...migration.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)];
  assert.deepEqual(stamps.map((match) => match[0]!), [],
    'the runner stamps the ledger; a migration that stamps itself never commits');
  assert.doesNotMatch(migration, /VALUES\(29,'journey_hierarchy_and_blueprints'/u);
  assert.match(runner, /checksum TEXT NOT NULL/u, 'the runner still owns a checksum this file cannot supply');
  assert.match(
    runner,
    /INSERT INTO experience_runtime_schema_version\(version,name,checksum,applied_at\)/u,
    'the runner still stamps the ledger itself'
  );
});

test('every runtime-29 foreign key resolves to a real unique key', () => {
  // The upstream keys runtime-29 leans on, asserted at their source.
  assert.match(stageProcessing, /journey_definitions_tenant_identity\s+ON journey_definitions\(id,space_id\)/u);
  assert.match(
    stageProcessing,
    /journey_map_versions_tenant_definition_identity\s+ON journey_map_versions\(id,definition_id,space_id\)/u
  );
  assert.match(portfolio, /journey_portfolio_item_versions_item_revision UNIQUE\(item_id,space_id,revision\)/u);
  assert.match(spacesSource, /CREATE TABLE IF NOT EXISTS space_memberships \(/u);
  assert.match(spacesSource, /PRIMARY KEY\(space_id,user_id\)/u);

  const local = declaredUniqueKeys(migration);
  const references = [...flatMigration.matchAll(/REFERENCES ([a-z_]+)\(([^)]*)\)/gu)];
  assert.ok(references.length > 20, 'runtime-29 must keep its composite tenant foreign keys');
  const unbacked: string[] = [];
  for (const reference of references) {
    const table = reference[1]!;
    const key = sortedKey(reference[2]!);
    const backed = local.get(table)?.has(key) || externalUniqueKeys.get(table)?.includes(key);
    if (!backed) unbacked.push(`${table}(${reference[2]!.trim()})`);
  }
  assert.deepEqual(
    unbacked,
    [],
    'each listed reference has no unique key of exactly those columns, so PostgreSQL aborts the '
      + 'migration with SQLSTATE 42830 before anything else in this file can be evaluated'
  );
});

test('the deferred current-version pointer is backed by its own three-column identity key', () => {
  // The specific 42830 abort that shipped in the first draft: the ALTER below
  // referenced (id,blueprint_id,space_id) while only (id,space_id) existed.
  const block = tableBlock('journey_blueprint_versions');
  assert.match(block, /journey_blueprint_versions_current_identity UNIQUE\(id,blueprint_id,space_id\)/u);
  assert.match(
    flatMigration,
    /ALTER TABLE journey_blueprints ADD CONSTRAINT journey_blueprints_current_version_fk FOREIGN KEY\(current_version_id,id,space_id\) REFERENCES journey_blueprint_versions\(id,blueprint_id,space_id\) DEFERRABLE INITIALLY DEFERRED;/u
  );
  // 0027 solves the identical problem the identical way; runtime-29 must not drift.
  assert.match(portfolio, /journey_portfolio_scoring_policy_versions_current_identity UNIQUE\(id,policy_id,space_id\)/u);
});

test('health snapshots make "unknown" status and a null score the same fact', () => {
  const block = tableBlock('journey_hierarchy_health_snapshots');
  assert.doesNotMatch(
    block,
    /score NUMERIC NOT NULL/u,
    'a NOT NULL score cannot store the unknown roll-up rollUpJourneyHierarchyHealth produces'
  );
  assert.match(block, /score NUMERIC CHECK\(score IS NULL OR score BETWEEN 0 AND 100\)/u);
  assert.match(
    flatten(block),
    /journey_hierarchy_health_snapshots_status_shape CHECK\( \(status='unknown' AND score IS NULL\) OR \(status<>'unknown' AND score IS NOT NULL\)\)/u,
    'the coherence check must be bidirectional: nullability alone would allow status=healthy with no score'
  );
  assert.deepEqual(enumValues(block, 'status'), ['at_risk', 'healthy', 'unknown', 'watch']);
});

test('a health snapshot pins the exact policy it was scored under', () => {
  const block = tableBlock('journey_hierarchy_health_snapshots');
  // journey_hierarchy_health_policies.revision advances in place, so a snapshot
  // holding only policy_id would silently re-point at re-tuned thresholds.
  assert.match(block, /policy_revision INTEGER NOT NULL CHECK\(policy_revision>0\)/u);
  assert.match(block, /policy_configuration_sha256 TEXT NOT NULL CHECK\(policy_configuration_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(block, /policy_version TEXT NOT NULL/u);
  assert.match(block, /explanation TEXT NOT NULL/u, 'the domain returns an explanation; it needs a column');
  assert.match(block, /definition_revision INTEGER NOT NULL CHECK\(definition_revision>0\)/u);
});

test('hierarchy link enums mirror the tested in-memory contract', () => {
  const block = tableBlock('journey_hierarchy_links');
  assert.deepEqual(enumValues(block, 'link_type'), [...journeyHierarchyLinkTypes].sort());
  assert.deepEqual(enumValues(block, 'review_state'), [...journeyHierarchyReviewStates].sort());
  assert.deepEqual(enumValues(block, 'lifecycle'), [...journeyHierarchyLifecycles].sort());
  assert.deepEqual(enumValues(block, 'variant_dimension'), [...journeyHierarchyVariantDimensions].sort());
  assert.match(block, /journey_hierarchy_links_no_self CHECK\(from_definition_id<>to_definition_id\)/u);
  const shape = flatten(block);
  for (const clause of [
    "link_type='stage_subjourney' AND from_stage_key IS NOT NULL AND to_stage_key IS NULL",
    "link_type='handoff' AND from_stage_key IS NOT NULL AND to_stage_key IS NOT NULL",
    "link_type='variant' AND from_stage_key IS NULL AND to_stage_key IS NULL",
    "link_type IN ('parent_child','related') AND from_stage_key IS NULL AND to_stage_key IS NULL"
  ]) assert.ok(shape.includes(clause), `the link shape check must cover: ${clause}`);
});

test('logical link uniqueness stays lifecycle-independent, matching journeyHierarchy.ts', () => {
  const block = flatten(tableBlock('journey_hierarchy_links'));
  // NULLS NOT DISTINCT is load-bearing, not decorative: under default
  // NULLS-DISTINCT semantics two parent_child links between the same pair would
  // not collide, because every optional key column is NULL for that shape.
  assert.match(
    block,
    /journey_hierarchy_links_logical_once UNIQUE NULLS NOT DISTINCT \( ?space_id,link_type,from_definition_id,to_definition_id,from_stage_key,to_stage_key, ?variant_dimension,variant_value_id\)/u
  );
  // Guards the resolved product question. journeyHierarchy.ts adds the logical
  // key to `seenLinks` BEFORE its `lifecycle !== 'active'` skip, so the domain
  // rejects a retired+active duplicate pair too. Narrowing this constraint to a
  // partial `WHERE lifecycle='active'` index would make PostgreSQL accept rows
  // that validateJourneyHierarchy throws JOURNEY_HIERARCHY_DUPLICATE_LINK on.
  assert.doesNotMatch(
    migration,
    /ON journey_hierarchy_links\([^)]*\)[^;]*WHERE lifecycle='active'/u,
    'do not narrow logical uniqueness to active links without changing the domain contract first'
  );
});

test('the logical-uniqueness key has a statically provable btree width', () => {
  const block = flatten(tableBlock('journey_hierarchy_links'));
  // space_id / from_definition_id / to_definition_id inherit from unbounded TEXT
  // primary keys upstream, so per-column length checks alone cannot bound the
  // composite key. An explicit octet budget can.
  assert.match(
    block,
    /journey_hierarchy_links_index_width CHECK\( octet_length\(space_id\)\+octet_length\(from_definition_id\)\+octet_length\(to_definition_id\) \+COALESCE\(octet_length\(from_stage_key\),0\)\+COALESCE\(octet_length\(to_stage_key\),0\) \+COALESCE\(octet_length\(variant_value_id\),0\)<=1024\)/u
  );
});

test('hierarchy links carry a real review audit trail', () => {
  const block = flatten(tableBlock('journey_hierarchy_links'));
  assert.match(block, /reviewed_at TIMESTAMPTZ,/u);
  assert.match(
    block,
    /journey_hierarchy_links_review_shape CHECK\( \(review_state='draft' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL\) OR \(review_state<>'draft' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL\)\)/u
  );
  // A reviewer must have been a member when the review was recorded -- not
  // forever after. The composite membership foreign key this test used to
  // require asserted the second, so once any link carried a reviewer,
  // spaces.ts removeSpaceMember's DELETE FROM space_memberships raised 23503 and
  // the member could not be offboarded. review_shape forbids nulling the
  // reviewer, so no ON DELETE action could resolve it either. Attribution now
  // rests on an immutable users(id) edge and tenancy on a write-time guard.
  assert.match(block, /reviewed_by_user_id TEXT REFERENCES users\(id\) ON DELETE NO ACTION,/u,
    'reviewer attribution must survive offboarding and still resolve to a real user');
  assert.doesNotMatch(
    block,
    /journey_hierarchy_links_reviewer_fk FOREIGN KEY\(space_id,reviewed_by_user_id\)/u,
    'a live membership edge on an attribution column blocks member offboarding'
  );
  assert.match(
    flatMigration,
    /CREATE TRIGGER journey_hierarchy_links_reviewer_membership_guard BEFORE INSERT OR UPDATE OF space_id,reviewed_by_user_id ON journey_hierarchy_links FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard\('reviewed_by_user_id'\)/u,
    'tenancy must still be asserted at write time'
  );
});

test('runtime-29 actor columns are attribution, not live membership', () => {
  // The five columns that carried a composite space_memberships foreign key.
  // Each one is nullable or CHECK-pinned in a way that made every referential
  // action either impossible (SET NULL on a reviewer that review_shape requires)
  // or destructive (CASCADE erasing the audit the column exists to hold).
  for (const [table, column] of [
    ['journey_hierarchy_links', 'handoff_owner_user_id'],
    ['journey_hierarchy_links', 'reviewed_by_user_id'],
    ['journey_blueprint_resources', 'owner_user_id'],
    ['journey_blueprints', 'owner_user_id'],
    ['journey_blueprint_gap_assessments', 'reviewer_user_id']
  ] as ReadonlyArray<readonly [string, string]>) {
    const block = flatten(tableBlock(table));
    assert.match(block, new RegExp(`${column} TEXT REFERENCES users\\(id\\) ON DELETE NO ACTION`, 'u'),
      `${table}.${column} must keep immutable user attribution`);
    assert.match(
      flatMigration,
      new RegExp(`BEFORE INSERT OR UPDATE OF space_id,${column} ON ${table} FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_membership_guard\\('${column}'\\)`, 'u'),
      `${table}.${column} must be tenancy-checked at write time`
    );
  }
  assert.deepEqual(
    [...flatMigration.matchAll(/REFERENCES space_memberships\(space_id,user_id\)(?: ON DELETE (CASCADE|NO ACTION|SET NULL))?/gu)]
      .map((match) => match[1] ?? 'NO ACTION (implicit)'),
    [],
    'runtime-29 must add no membership edge that can refuse a member removal'
  );
  // The guard has to lock, or the invariant is advice: under READ COMMITTED a
  // bare existence check can be satisfied by a row a concurrent transaction is
  // already deleting, and both statements then commit.
  const guard = functionBody('journey_hierarchy_membership_guard');
  assert.match(guard, /FROM space_memberships\s+WHERE space_id=NEW\.space_id AND user_id=actor FOR SHARE/u);
  assert.match(guard, /ERRCODE='23503'/u, 'a tenancy refusal must stay a referential-integrity error');
});

test('the hierarchy guard enforces the kill switch, tenancy, stages, variants, cycles and depth', () => {
  const guard = functionBody('journey_hierarchy_link_guard');
  assert.match(guard, /COALESCE\(settings\.hierarchy_enabled,TRUE\)/u, 'hierarchy_enabled must not be decorative');
  assert.match(guard, /IF NEW\.lifecycle='active' AND NOT hierarchy_is_enabled THEN/u);
  assert.match(guard, /Journey hierarchy linking is disabled for this space/u);
  assert.match(guard, /exceeds its configured link limit/u);
  assert.match(guard, /Hierarchy source stage is not part of the same-space source journey/u);
  assert.match(guard, /Hierarchy destination stage is not part of the same-space destination journey/u);
  // variant_value_id is otherwise unbounded free text and could name another tenant's row.
  assert.match(guard, /FROM journey_personas persona WHERE persona\.id=NEW\.variant_value_id AND persona\.space_id=NEW\.space_id/u);
  assert.match(guard, /FROM journey_taxonomy_terms term WHERE term\.id=NEW\.variant_value_id AND term\.space_id=NEW\.space_id AND term\.kind=NEW\.variant_dimension/u);
  assert.match(guard, /would create a cycle/u);
  assert.match(guard, /exceeds configured hierarchy depth/u);
});

test('the hierarchy guard walks nodes, not paths, and reads two scalar maxima', () => {
  const guard = functionBody('journey_hierarchy_link_guard');
  assert.doesNotMatch(
    guard,
    /UNION ALL/u,
    'UNION ALL enumerates paths: a diamond containment DAG at the depth ceiling costs exponential work per write'
  );
  assert.doesNotMatch(
    guard,
    /FROM ancestors CROSS JOIN descendants/u,
    'the cartesian product materialised |ancestors| x |descendants| rows to read two numbers'
  );
  assert.match(
    guard,
    /SELECT \(SELECT COALESCE\(MAX\(depth\),0\) FROM ancestors\) \+ 1 \+ \(SELECT COALESCE\(MAX\(depth\),0\) FROM descendants\) INTO discovered_depth;/u
  );
  assert.match(guard, /ancestors\.depth<maximum_depth\+1/u, 'the upward walk must stay bounded');
  assert.match(guard, /descendants\.depth<maximum_depth\+1/u, 'the downward walk must stay bounded');
});

test('write guards fire only on the columns they read', () => {
  // A bare `BEFORE INSERT OR UPDATE` re-runs the recursive walks when only
  // updated_by_user_id or revision changes. 0028 uses the narrow form throughout.
  assert.match(collaboration, /BEFORE INSERT OR UPDATE OF /u, 'the narrow form is the house convention');
  const narrowed: ReadonlyArray<readonly [string, string]> = [
    ['journey_taxonomy_parent_guard', 'journey_taxonomy_terms'],
    ['journey_definition_taxonomy_guard', 'journey_definition_taxonomy'],
    ['journey_hierarchy_link_guard', 'journey_hierarchy_links'],
    ['journey_blueprint_element_resource_kind_guard', 'journey_blueprint_elements'],
    ['journey_blueprint_element_resource_role_guard', 'journey_blueprint_element_resources'],
    ['journey_blueprint_portfolio_link_guard', 'journey_blueprint_portfolio_links']
  ];
  for (const [trigger, table] of narrowed) {
    assert.match(
      flatMigration,
      new RegExp(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OF [a-z_, ]+ ON ${table}`, 'u'),
      `${trigger} must list the columns it reads`
    );
  }
});

test('taxonomy lifecycle is enforced on retire and on assignment, not only on write of a parent', () => {
  const guard = functionBody('journey_taxonomy_parent_guard');
  // The retire/kind check must precede the `parent_term_id IS NULL` short-circuit,
  // otherwise retiring a ROOT term runs no checks at all and orphans its children.
  const retireAt = guard.indexOf('Retire the child terms before retiring their taxonomy parent');
  const shortCircuitAt = guard.indexOf('IF NEW.parent_term_id IS NULL THEN RETURN NEW; END IF;');
  assert.notEqual(retireAt, -1, 'retiring a parent with active children must be refused');
  assert.notEqual(shortCircuitAt, -1);
  assert.ok(retireAt < shortCircuitAt, 'the root-term checks must run before the parent short-circuit');
  assert.match(guard, /A taxonomy term with active children cannot change kind/u);
  assert.match(guard, /Taxonomy parent would create a cycle/u);

  const assignment = functionBody('journey_definition_taxonomy_guard');
  assert.match(
    assignment,
    /Journey taxonomy assignments require an active same-space term/u,
    'the composite FK proves tenancy but says nothing about lifecycle'
  );
});

test('blueprint identity keys stop a version pinning a journey its blueprint does not own', () => {
  assert.match(tableBlock('journey_blueprints'), /journey_blueprints_journey_identity UNIQUE\(id,space_id,journey_definition_id\)/u);
  const versions = flatten(tableBlock('journey_blueprint_versions'));
  assert.match(
    versions,
    /journey_blueprint_versions_parent_fk FOREIGN KEY\(blueprint_id,space_id,journey_definition_id\) REFERENCES journey_blueprints\(id,space_id,journey_definition_id\) ON DELETE CASCADE/u,
    'a two-column parent key lets version v of blueprint B claim journey X while B claims journey Y'
  );
  assert.match(versions, /journey_blueprint_versions_journey_identity UNIQUE\(id,space_id,journey_definition_id\)/u);
});

test('blueprint version enums, states and approval shape mirror the domain module', () => {
  const block = tableBlock('journey_blueprint_versions');
  assert.deepEqual(enumValues(block, 'blueprint_state'), [...journeyBlueprintStates].sort());
  assert.deepEqual(enumValues(block, 'review_state'), [...journeyBlueprintReviewStates].sort());
  assert.match(block, new RegExp(`schema_version='${JOURNEY_SERVICE_BLUEPRINT_VERSION}'`, 'u'));
  assert.match(
    flatten(block),
    /journey_blueprint_versions_approval_shape CHECK\( \(review_state='approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL\) OR \(review_state<>'approved' AND approved_by_user_id IS NULL AND approved_at IS NULL\)\)/u
  );
  assert.deepEqual(enumValues(tableBlock('journey_blueprint_elements'), 'lane'), [...journeyBlueprintLanes].sort());
  assert.deepEqual(enumValues(tableBlock('journey_blueprint_elements'), 'kind'), [...journeyBlueprintElementKinds].sort());
  assert.deepEqual(
    enumValues(tableBlock('journey_blueprint_relationships'), 'kind'),
    [...journeyBlueprintRelationshipKinds].sort()
  );
  const resources = tableBlock('journey_blueprint_resources');
  assert.deepEqual(enumValues(resources, 'kind'), [...journeyBlueprintResourceKinds].sort());
  assert.deepEqual(enumValues(resources, 'lifecycle'), [...journeyBlueprintResourceLifecycles].sort());
  const gaps = tableBlock('journey_blueprint_gap_assessments');
  assert.deepEqual(enumValues(gaps, 'gap_type'), [...journeyBlueprintGapTypes].sort());
  assert.deepEqual(enumValues(gaps, 'severity'), [...journeyBlueprintGapSeverities].sort());
});

test('the blueprints kill switch is enforced on version creation', () => {
  const guard = functionBody('journey_blueprint_versions_settings_guard');
  assert.match(guard, /COALESCE\(settings\.blueprints_enabled,TRUE\)/u);
  assert.match(guard, /Service blueprints are disabled for this space/u);
  // BEFORE INSERT only: UPDATE is already refused by the append-only guard, so
  // the two triggers on this table never contend.
  assert.match(
    flatMigration,
    /CREATE TRIGGER journey_blueprint_versions_settings_guard BEFORE INSERT ON journey_blueprint_versions/u
  );
});

test('portfolio links carry tenant identity and enforce typed causality', () => {
  const block = flatten(tableBlock('journey_blueprint_portfolio_links'));
  assert.match(block, /journey_blueprint_portfolio_links_tenant_identity UNIQUE\(id,space_id\)/u);
  assert.deepEqual(
    enumValues(block, 'relationship'),
    [...journeyBlueprintPortfolioRelationships].sort()
  );
  const guard = functionBody('journey_blueprint_portfolio_link_guard');
  // Restates portfolioRelationshipTargets: the enum CHECK proves the value is
  // one of the four but not that it accepts the linked item's kind.
  assert.match(guard, /NEW\.relationship='causes' AND item_kind='pain_point'/u);
  assert.match(guard, /NEW\.relationship='affected_by' AND item_kind IN \('pain_point','opportunity'\)/u);
  assert.match(guard, /NEW\.relationship IN \('mitigated_by','improved_by'\) AND item_kind IN \('solution','initiative'\)/u);
  assert.match(guard, /Blueprint portfolio relationship does not accept this portfolio item kind/u);
  assert.match(guard, /A customer-lane element cannot be the declared cause of a pain point/u);
  assert.match(guard, /AND state='active'/u, 'a link must not point at a soft-deleted portfolio item');
});

test('gap assessments can anchor a relationship-shaped gap and cannot duplicate an open one', () => {
  const block = flatten(tableBlock('journey_blueprint_gap_assessments'));
  // handoff_missing is emitted with a relationshipId, not an elementId.
  assert.match(block, /target_relationship_id TEXT,/u);
  assert.match(
    block,
    /journey_blueprint_gap_assessments_target_shape CHECK\( target_element_id IS NULL OR target_relationship_id IS NULL\)/u
  );
  assert.match(
    block,
    /journey_blueprint_gap_assessments_relationship_fk FOREIGN KEY\(target_relationship_id,blueprint_version_id,space_id\) REFERENCES journey_blueprint_relationships\(id,version_id,space_id\) ON DELETE CASCADE/u
  );
  assert.match(
    flatMigration,
    /CREATE UNIQUE INDEX journey_blueprint_gap_assessments_open_once ON journey_blueprint_gap_assessments\(blueprint_version_id,gap_type,target_element_id,target_relationship_id\) NULLS NOT DISTINCT WHERE state='open';/u,
    'regenerating an analysis must refresh, not duplicate, an open gap'
  );
});

test('comparisons are pinned to one journey and to a current -> future direction', () => {
  const block = flatten(tableBlock('journey_blueprint_comparisons'));
  assert.match(block, /journey_definition_id TEXT NOT NULL/u);
  for (const endpoint of ['from', 'to']) {
    assert.match(
      block,
      new RegExp(
        `journey_blueprint_comparisons_${endpoint}_fk FOREIGN KEY\\(${endpoint}_version_id,space_id,journey_definition_id\\) `
          + 'REFERENCES journey_blueprint_versions\\(id,space_id,journey_definition_id\\) ON DELETE CASCADE',
        'u'
      ),
      `the ${endpoint} endpoint must be pinned to one space and one journey definition`
    );
  }
  assert.match(block, /journey_blueprint_comparisons_not_self CHECK\(from_version_id<>to_version_id\)/u);
  const guard = functionBody('journey_blueprint_comparison_guard');
  assert.match(guard, /IF from_state IS DISTINCT FROM 'current' OR to_state IS DISTINCT FROM 'future' THEN/u);
  assert.match(guard, /Blueprint comparisons run from a current version to a future version/u);
});

test('sealed blueprint content is immutable but still sweepable, and idempotency/audit rows are neither', () => {
  const updateOnly = [
    'journey_hierarchy_health_snapshots',
    'journey_blueprint_versions',
    'journey_blueprint_comparisons',
    // A version's content is sealed by snapshot_sha256; without these the stored
    // hash could silently stop matching the rows it covers.
    'journey_blueprint_stages',
    'journey_blueprint_elements',
    'journey_blueprint_element_resources',
    'journey_blueprint_relationships'
  ];
  for (const table of updateOnly) {
    assert.match(
      flatMigration,
      new RegExp(`BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard\\(\\)`, 'u'),
      `${table} must be immutable but stay deletable for retention and version cascade`
    );
  }
  // 0027:611/614 and every append-only table in 0028 use UPDATE OR DELETE here.
  // Deleting an operations row lets an idempotency key replay to a different
  // result; deleting an activity row erases the audit trail.
  assert.match(portfolio, /BEFORE UPDATE OR DELETE ON journey_portfolio_operations/u);
  assert.match(collaboration, /BEFORE UPDATE OR DELETE ON journey_collaboration_activity/u);
  for (const table of ['journey_hierarchy_operations', 'journey_hierarchy_activity']) {
    assert.match(
      flatMigration,
      new RegExp(`BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION journey_hierarchy_append_only_guard\\(\\)`, 'u'),
      `${table} must refuse deletion as well as update`
    );
  }
});

test('each content seal sorts before the sibling guard on the same table', () => {
  // PostgreSQL fires BEFORE row triggers in alphabetical name order, so naming
  // decides which error a caller sees when two guards would both reject a write.
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['journey_blueprint_element_append_only', 'journey_blueprint_element_resource_kind_guard'],
    ['journey_blueprint_element_resource_append_only', 'journey_blueprint_element_resource_role_guard']
  ];
  for (const [seal, sibling] of pairs) {
    assert.match(flatMigration, new RegExp(`CREATE TRIGGER ${seal} `, 'u'), `${seal} must exist`);
    assert.ok(seal < sibling, `${seal} must sort before ${sibling} so the reported error is deterministic`);
  }
});

test('no runtime-29 foreign key uses ON DELETE RESTRICT', () => {
  // journey_definitions is hard-deleted (journeyMaps.ts) and cascades to
  // journey_map_versions, which several tables here reference. RESTRICT is
  // checked inside the deleting statement, so whether the delete succeeds
  // depends on referential-action firing order; NO ACTION gives the same
  // guarantee but defers to end-of-statement, after the sibling cascades land.
  const restricts = [...flatMigration.matchAll(/(\w+) (?:REFERENCES [a-z_]+\([^)]*\) )?ON DELETE RESTRICT/gu)]
    .map((match) => match[0]!);
  assert.deepEqual(restricts, [], 'use ON DELETE NO ACTION so journey deletion is order-independent');
  assert.ok(
    flatMigration.includes('ON DELETE NO ACTION'),
    'the orphan-refusing edges must still refuse orphans'
  );
});

test('runtime-29 declares the access paths its own guards and sweeps depend on', () => {
  const indexes: ReadonlyArray<readonly [string, string]> = [
    // Counted on every hierarchy-link write; neither _from nor _to leads with lifecycle.
    ['journey_hierarchy_links_lifecycle', 'journey_hierarchy_links(space_id,lifecycle,id)'],
    ['journey_taxonomy_terms_children', 'journey_taxonomy_terms(space_id,parent_term_id,lifecycle,id)'],
    ['journey_definition_taxonomy_reverse', 'journey_definition_taxonomy(space_id,term_id,definition_id)'],
    ['journey_hierarchy_health_retention', 'journey_hierarchy_health_snapshots(calculated_at,id)'],
    ['journey_blueprint_versions_history', 'journey_blueprint_versions(space_id,blueprint_id,version_number DESC,id)'],
    ['journey_blueprint_relationships_incoming', 'journey_blueprint_relationships(version_id,to_element_id,kind,from_element_id)'],
    ['journey_blueprint_element_resources_reverse', 'journey_blueprint_element_resources(space_id,resource_id,role,version_id,element_id)'],
    ['journey_blueprint_portfolio_links_reverse', 'journey_blueprint_portfolio_links(space_id,portfolio_item_id,relationship,blueprint_version_id,element_id)'],
    ['journey_blueprint_gap_assessments_open', 'journey_blueprint_gap_assessments(space_id,blueprint_version_id,state,severity,gap_type,id)'],
    ['journey_blueprint_comparisons_retention', 'journey_blueprint_comparisons(created_at,id)'],
    ['journey_hierarchy_activity_retention', 'journey_hierarchy_activity(created_at,id)']
  ];
  for (const [name, target] of indexes) {
    assert.ok(
      flatMigration.includes(`CREATE INDEX ${name} ON ${target}`),
      `missing access path: CREATE INDEX ${name} ON ${target}`
    );
  }
});

test('the subscription-plan merge preserves operator overrides', () => {
  // (defaults - existing_keys) adds only absent keys, so a tenant-specific limit
  // set by an operator survives the upgrade.
  assert.match(flatMigration, /- ARRAY\(SELECT jsonb_object_keys\(limits_json::jsonb\)\)/u);
  assert.match(flatMigration, /WHERE code IN \('starter','team','enterprise'\);/u);
  for (const key of ['journeyHierarchyLinks', 'journeyBlueprints', 'journeyBlueprintResources']) {
    assert.ok(flatMigration.includes(`"${key}"`), `the plan merge must define ${key}`);
  }
});
