import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  JourneyInitiativeLifecycle,
  JourneyInsightLifecycle,
  JourneyPortfolioItemKind,
  JourneyPortfolioJourneyRelationship,
  JourneyPortfolioJourneyTarget
} from '../src/journeyPortfolioDomain.js';

/**
 * STATIC contract test for runtime-27 (`0027_journey_portfolio.sql`).
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * migration TEXT. This file does NOT create a database, does NOT apply the
 * migration, and does NOT execute a single statement, trigger or plpgsql body,
 * so it is NOT executed-PostgreSQL proof and must not be recorded as one. A
 * statement that satisfies these regexes can still fail against a live server:
 * plpgsql bodies are only syntax-checked at CREATE FUNCTION, referential-action
 * firing order is not observable here, RI-versus-trigger interaction is not
 * observable here, and deferred constraint-trigger timing is not observable
 * here. Executed-PostgreSQL coverage for runtime-27 is a separate and currently
 * OPEN gate. `scripts/probe-journey-portfolio-postgres.mjs` does exist, but
 * nothing here runs it and no run of it is recorded, so its existence is not
 * evidence. `runtime-compatibility.json` now pins min=max=29, which puts
 * runtime-27 inside the shipped window on paper; that is a declaration, not an
 * observation, and no applied-anywhere claim follows from it.
 *
 * What it does prove is the class of defect this migration actually shipped:
 * referential actions that contradict the same file's own append-only guards and
 * cascades, a self-stamp the migration runner cannot accept, and foreign keys
 * with no backing unique key. Each of those is asserted below in a form that
 * fails if the correction is reverted.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const readMigration = (name: string) => fs.readFileSync(path.join(migrationRoot, name), 'utf8');

/**
 * Every assertion must read executable DDL, never prose. Absence assertions in
 * particular ("no ON DELETE RESTRICT", "no self-stamp") would otherwise trip on
 * a comment that merely explains why the construct was removed — and this file's
 * corrections are all documented in exactly such comments. No string literal in
 * this migration spans a line, so tracking quote parity per line is enough to
 * avoid truncating at a `--` that sits inside a literal.
 *
 * Known limitation, inherited from the runtime-29 precedent: dollar-quoted
 * plpgsql bodies are not stripped, so negative assertions also scan function
 * bodies. That is deliberate here — a guard body is executable DDL too.
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

const migration = stripSqlComments(readMigration('0027_journey_portfolio.sql'));
const raw = readMigration('0027_journey_portfolio.sql');
const predecessor = stripSqlComments(readMigration('0026_journey_saved_views.sql'));
const stageProcessing = stripSqlComments(readMigration('0018_journey_stage_processing.sql'));
const metricObservations = stripSqlComments(readMigration('0021_journey_metric_observations.sql'));
const personas = stripSqlComments(readMigration('0023_versioned_journey_personas.sql'));
const spacesSource = fs.readFileSync(path.join(backendRoot, 'src', 'spaces.ts'), 'utf8');
const runnerSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'upgrade-postgres-schema.mjs'), 'utf8');

const flatten = (text: string) => text.replace(/\s+/gu, ' ').trim();
const flatMigration = flatten(migration);

function tableBlock(table: string): string {
  const start = migration.indexOf(`CREATE TABLE ${table} (`);
  assert.notEqual(start, -1, `${table} must be declared by runtime-27`);
  const end = migration.indexOf('\n);', start);
  assert.notEqual(end, -1, `${table} must terminate with a closing paren`);
  return migration.slice(start, end + 3);
}

function functionBody(name: string): string {
  const start = flatMigration.indexOf(`FUNCTION ${name}()`);
  assert.notEqual(start, -1, `${name} must be declared by runtime-27`);
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
 * Unique keys runtime-27 depends on but does not declare. Each entry is
 * re-asserted against its declaring source below, so an upstream rename breaks
 * this test rather than silently breaking the migration.
 */
const externalUniqueKeys = new Map<string, string[]>([
  ['spaces', ['id']],
  ['users', ['id']],
  ['space_memberships', ['space_id,user_id']],
  ['journey_definitions', ['id', 'id,space_id']],
  ['journey_map_versions', ['id', 'definition_id,id,space_id']],
  ['journey_evidence_links', ['id', 'id,space_id']],
  ['journey_metric_definitions', ['id', 'id,space_id']],
  ['journey_metric_definition_versions', ['definition_id,id,space_id']]
]);

/**
 * Exhaustive over the domain union in BOTH directions: a missing key and an
 * extra key are each a compile error under `tsc --strict`. This is what binds
 * the migration's literal CHECK lists to `journeyPortfolioDomain.ts` — a plain
 * string array would silently accept a union that grew a member.
 */
const itemKinds: Record<JourneyPortfolioItemKind, true> = {
  pain_point: true, opportunity: true, solution: true, initiative: true
};
const insightLifecycles: Record<JourneyInsightLifecycle, true> = {
  draft: true, validated: true, approved: true, archived: true
};
const initiativeLifecycles: Record<JourneyInitiativeLifecycle, true> = {
  draft: true, planned: true, active: true, blocked: true,
  completed: true, cancelled: true, archived: true
};
const journeyTargets: Record<JourneyPortfolioJourneyTarget, true> = {
  journey: true, stage: true, touchpoint: true, persona: true
};
const journeyRelationships: Record<JourneyPortfolioJourneyRelationship, true> = {
  occurs_at: true, affects: true, improves: true, changes: true, delivers: true
};
const keysOf = (value: Record<string, true>) => Object.keys(value).sort();

test('runtime-27 gates on its predecessor and never stamps its own schema version', () => {
  assert.match(
    migration,
    /IF COALESCE\(\(SELECT MAX\(version\) FROM experience_runtime_schema_version\),0\)<>26 THEN/u,
    'runtime-27 must refuse to apply on top of anything but runtime-26'
  );
  // The blocker this file shipped with. scripts/upgrade-postgres-schema.mjs owns
  // experience_runtime_schema_version, declares checksum NOT NULL with no
  // default, and inserts the row itself after the migration body succeeds. A
  // self-stamp therefore aborts the final statement with SQLSTATE 23502 and
  // rolls the whole migration back; even past that it would collide with the
  // runner's own insert on the version primary key. A migration cannot supply
  // the column, because the checksum is taken over its own text.
  assert.match(runnerSource, /checksum TEXT NOT NULL/u, 'the runner still owns a NOT NULL checksum column');
  assert.match(
    runnerSource,
    /INSERT INTO experience_runtime_schema_version\(version,name,checksum,applied_at\)/u,
    'the runner still stamps the version itself'
  );
  assert.deepEqual(
    [...migration.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)].map((match) => match[0]!),
    [],
    'the migration must not stamp a row the runner will stamp with a checksum this file cannot know'
  );
  // 0026 is the closest migration proven to apply under this runner; runtime-27
  // must end the same way it does.
  assert.deepEqual([...predecessor.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)], []);
});

test('every runtime-27 foreign key resolves to a real unique key', () => {
  // The upstream keys runtime-27 leans on, asserted at their source.
  assert.match(stageProcessing, /journey_definitions_tenant_identity\s+ON journey_definitions\(id,space_id\)/u);
  assert.match(
    stageProcessing,
    /journey_map_versions_tenant_definition_identity\s+ON journey_map_versions\(id,definition_id,space_id\)/u
  );
  assert.match(personas, /journey_evidence_links_tenant_identity\s+ON journey_evidence_links\(id,space_id\)/u);
  assert.match(metricObservations, /journey_metric_definitions_tenant_identity UNIQUE\(id,space_id\)/u);
  assert.match(
    metricObservations,
    /journey_metric_definition_versions_definition_identity UNIQUE\(id,definition_id,space_id\)/u
  );
  assert.match(spacesSource, /CREATE TABLE IF NOT EXISTS space_memberships \(/u);
  assert.match(spacesSource, /PRIMARY KEY\(space_id,user_id\)/u);

  const local = declaredUniqueKeys(migration);
  const references = [...flatMigration.matchAll(/REFERENCES ([a-z_]+)\(([^)]*)\)/gu)];
  assert.ok(references.length > 20, 'runtime-27 must keep its composite tenant foreign keys');
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

test('no runtime-27 foreign key uses ON DELETE RESTRICT', () => {
  // journey_definitions is hard-deleted (journeyMaps.ts) and cascades to
  // journey_map_versions (0012:56), which journey_portfolio_journey_links
  // references while the same DELETE also cascades that row away through
  // journey_portfolio_journey_links_journey_tenant_fk. RESTRICT is checked
  // inside the deleting statement, so whether the delete succeeds depends on
  // referential-action firing order; NO ACTION refuses the same orphans but
  // defers to end-of-statement, after the sibling cascades land. Runtime-29
  // already adopted this rule for the identical edge.
  const restricts = [...flatMigration.matchAll(/(\w+) (?:REFERENCES [a-z_]+\([^)]*\) )?ON DELETE RESTRICT/gu)]
    .map((match) => match[0]!);
  assert.deepEqual(restricts, [], 'use ON DELETE NO ACTION so deletion is order-independent');
});

/**
 * Frozen expected set of every `(referenced table, referenced columns, action)`
 * triple in the file. Removing an edge, adding one, or silently changing an
 * action all fail here — a regex match alone would only catch an edit to a
 * string that stayed present.
 */
test('runtime-27 referential actions are exactly the reviewed set', () => {
  const edges = [...flatMigration.matchAll(
    /REFERENCES ([a-z_]+)\(([^)]*)\)(?: ON DELETE (CASCADE|NO ACTION|SET NULL))?/gu)]
    .map((match) => `${match[1]!}(${match[2]!.replace(/\s+/gu, '')}) ${match[3] ?? 'NO ACTION (implicit)'}`)
    .sort();
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge, (counts.get(edge) ?? 0) + 1);
  assert.deepEqual([...counts.entries()].sort(), [
    ['journey_evidence_links(id,space_id) NO ACTION', 1],
    ['journey_definitions(id,space_id) CASCADE', 1],
    ['journey_map_versions(id,definition_id,space_id) NO ACTION', 1],
    ['journey_metric_definition_versions(id,definition_id,space_id) NO ACTION', 1],
    ['journey_metric_definitions(id,space_id) NO ACTION', 1],
    ['journey_portfolio_item_versions(item_id,space_id,revision) CASCADE', 4],
    ['journey_portfolio_items(id,space_id) CASCADE', 11],
    ['journey_portfolio_reviews(id,space_id) NO ACTION (implicit)', 1],
    ['journey_portfolio_scoring_policies(id,space_id) CASCADE', 1],
    ['journey_portfolio_scoring_policies(id,space_id) NO ACTION', 1],
    ['journey_portfolio_scoring_policy_versions(id,policy_id,space_id) NO ACTION (implicit)', 1],
    ['journey_portfolio_scoring_policy_versions(id,space_id) NO ACTION', 1],
    ['journey_initiative_baselines(id,space_id) CASCADE', 1],
    // Deliberately retained and therefore pinned: removing a member who owns a
    // portfolio item is refused rather than silently reassigned. That is a
    // product decision, not a DDL defect, and it is live in the SQLite mirror
    // today (journeyPortfolio.ts) — it must not be "fixed" inside a migration.
    ['space_memberships(space_id,user_id) NO ACTION', 1],
    ['spaces(id) CASCADE', 13],
    ['users(id) NO ACTION', 1],
    // Single-column attribution columns, every one nullable. This is a known
    // family-wide latent pattern: SET NULL is executed as an UPDATE and would be
    // refused by the append-only seals, but no code path hard-deletes a user
    // (there is no DELETE FROM users in backend/src) and the reviewed runtime-29
    // migration carries the identical shape (0029:824). Correcting it in 0027
    // alone would diverge from the ratified reference, so it stays pinned here
    // and reported as open rather than changed.
    ['users(id) SET NULL', 17]
  ].sort());
});

test('an ON DELETE SET NULL edge never targets a column set an append-only guard seals', () => {
  // ON DELETE SET NULL is executed as an ordinary UPDATE against the child and
  // fires its row-level BEFORE triggers, so a composite SET NULL edge on a
  // sealed table can never fire. In runtime-27 every SET NULL edge is a single
  // nullable attribution column pointing at users(id); no such edge exists on a
  // tenant key, and no tenant key is nullable.
  const composite = [...flatMigration.matchAll(
    /FOREIGN KEY\(([^)]*)\)\s*REFERENCES [a-z_]+\([^)]*\) ON DELETE SET NULL/gu)].map((match) => match[0]!);
  assert.deepEqual(composite, [], 'a composite SET NULL edge nulls every referencing column, space_id included');
  for (const match of flatMigration.matchAll(/([a-z_]+) TEXT[^,]*REFERENCES ([a-z_]+)\(id\) ON DELETE SET NULL/gu)) {
    assert.equal(match[2]!, 'users', `only user attribution may be nulled, not ${match[1]!} -> ${match[2]!}`);
    assert.doesNotMatch(match[0]!, /NOT NULL/u, 'SET NULL on a NOT NULL column can only ever raise 23502');
  }
});

test('sealed portfolio history is immutable, and only the replay/audit ledgers refuse deletion', () => {
  // The distinction is load-bearing. A table that is the child of a declared
  // cascade must stay deletable or the cascade is dead DDL; a space-scoped
  // ledger must refuse deletion or its guarantee is decorative. Asserted as an
  // exact pair set, so adding or dropping `OR DELETE` anywhere fails here.
  const seals = [...flatMigration.matchAll(
    /CREATE TRIGGER ([a-z_]+_append_only) BEFORE (UPDATE OR DELETE|UPDATE) ON ([a-z_]+)/gu)]
    .map((match) => `${match[3]!}: ${match[2]!}`).sort();
  assert.deepEqual(seals, [
    // journey_portfolio_scoring_policy_versions cascades from
    // journey_portfolio_scoring_policies, which cascades from spaces; under
    // OR DELETE that chain could never complete. The SQLite mirror
    // (journey_portfolio_policy_versions_update_guard) is UPDATE-only too.
    'journey_initiative_baselines: UPDATE',
    'journey_initiative_outcome_comparisons: UPDATE',
    'journey_portfolio_activity: UPDATE OR DELETE',
    'journey_portfolio_item_versions: UPDATE',
    'journey_portfolio_operations: UPDATE OR DELETE',
    'journey_portfolio_priority_assessments: UPDATE',
    'journey_portfolio_reviews: UPDATE',
    'journey_portfolio_scoring_policy_versions: UPDATE'
  ].sort());
  // Deleting an operations row lets an idempotency key replay to a different
  // result; deleting an activity row erases the audit trail. Runtime-29's own
  // contract test pins the operations line, so it must not drift.
  assert.match(migration, /BEFORE UPDATE OR DELETE ON journey_portfolio_operations/u);
  assert.match(functionBody('journey_portfolio_append_only_guard'), /Journey portfolio history is append-only/u);
});

test('every write guard fires only on the columns it reads', () => {
  // A bare BEFORE INSERT OR UPDATE re-runs the recursive dependency walk and the
  // assistant_actions/tickets existence probes when only outcome_state,
  // revision or updated_by_user_id changes — which made recording that a linked
  // operational action had failed or been cancelled impossible once the source
  // row was gone. 0028 and 0029 both use the narrow form throughout.
  assert.doesNotMatch(
    flatMigration,
    /BEFORE INSERT OR UPDATE ON /u,
    'the narrow BEFORE INSERT OR UPDATE OF <columns> form is the house convention'
  );
  const narrowed: ReadonlyArray<readonly [string, string, string]> = [
    ['journey_portfolio_relationship_kind_guard', 'journey_portfolio_relationships',
      'space_id,from_item_id,from_item_kind,to_item_id,to_item_kind'],
    ['journey_portfolio_journey_link_guard', 'journey_portfolio_journey_links',
      'space_id,item_id,item_kind,journey_definition_id,journey_version_id,target_type,target_id'],
    ['journey_initiative_dependency_kind_guard', 'journey_initiative_dependencies',
      'space_id,initiative_id,depends_on_initiative_id'],
    ['journey_portfolio_operational_link_guard', 'journey_portfolio_operational_links',
      'space_id,initiative_id,operational_kind,operational_id']
  ];
  for (const [trigger, table, columns] of narrowed) {
    assert.ok(
      flatMigration.includes(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OF ${columns} ON ${table}`),
      `${trigger} must list exactly the columns it reads: ${columns}`
    );
    // Every listed column must be one the guard body actually reads, so the
    // list cannot be padded to make this test pass.
    const body = functionBody(trigger);
    for (const column of columns.split(',')) {
      assert.ok(body.includes(`NEW.${column}`), `${trigger} lists ${column} but never reads it`);
    }
  }
});

test('a scoring policy cannot commit without a current version of its own method', () => {
  // journeyPortfolio.ts raises JOURNEY_PORTFOLIO_POLICY_INTEGRITY_FAILED both
  // when the current version is missing and when policy.method disagrees with
  // currentVersion.method, but current_version_id is physically nullable and its
  // foreign key says nothing about method. Without this trigger the invariant
  // lives only in application code and a direct app-role write bypasses it.
  const guard = functionBody('journey_portfolio_policy_current_version_guard');
  assert.match(guard, /journey_portfolio_scoring_policies\.current_version_id is required/u);
  assert.match(guard, /ERRCODE='23502'/u);
  assert.match(guard, /must reference this policy and space/u);
  assert.match(guard, /method must match its current version/u);
  assert.match(
    flatMigration,
    /CREATE CONSTRAINT TRIGGER journey_portfolio_policy_current_version_required AFTER INSERT OR UPDATE ON journey_portfolio_scoring_policies DEFERRABLE INITIALLY DEFERRED/u,
    'the policy row, its first version and the pointer are written in that order inside one '
      + 'transaction, so the check has to be deferred to commit time'
  );
  // The backing identity key the deferred pointer needs; runtime-29's contract
  // test pins the same string, so both files must keep it.
  assert.match(
    migration,
    /journey_portfolio_scoring_policy_versions_current_identity UNIQUE\(id,policy_id,space_id\)/u
  );
  assert.match(
    flatMigration,
    /ALTER TABLE journey_portfolio_scoring_policies ADD CONSTRAINT journey_portfolio_scoring_current_version_fk FOREIGN KEY\(current_version_id,id,space_id\) REFERENCES journey_portfolio_scoring_policy_versions\(id,policy_id,space_id\) DEFERRABLE INITIALLY DEFERRED;/u
  );
});

test('portfolio item enums and kind shape mirror the tested domain union', () => {
  const block = tableBlock('journey_portfolio_items');
  assert.deepEqual(enumValues(block, 'kind'), keysOf(itemKinds));
  assert.deepEqual(
    enumValues(block, 'lifecycle'),
    [...new Set([...keysOf(insightLifecycles), ...keysOf(initiativeLifecycles)])].sort(),
    'the column CHECK must admit the union of both lifecycle vocabularies'
  );
  const shape = flatten(block);
  // The lifecycle shape splits that union back apart by kind. Without it an
  // insight could claim an initiative-only lifecycle.
  assert.ok(shape.includes(
    "(kind<>'initiative' AND lifecycle IN ('draft','validated','approved','archived'))"
  ), 'insight kinds must be restricted to the JourneyInsightLifecycle vocabulary');
  assert.ok(shape.includes(
    "(kind='initiative' AND lifecycle IN ('draft','planned','active','blocked','completed','cancelled','archived'))"
  ), 'initiatives must be restricted to the JourneyInitiativeLifecycle vocabulary');
  assert.deepEqual(
    enumValues(block, 'review_state'),
    ['approved', 'changes_requested', 'in_review', 'not_submitted']
  );
  // priority is absent from JourneySolution and present on JourneyInitiative;
  // the kind shape is the only thing that encodes that.
  for (const clause of [
    "kind='pain_point' AND severity IS NOT NULL AND frequency IS NOT NULL",
    "kind='opportunity' AND desired_outcome IS NOT NULL",
    "kind='solution' AND hypothesis IS NOT NULL AND risk IS NOT NULL",
    "kind='initiative' AND expected_outcome IS NOT NULL AND priority IS NOT NULL AND risk IS NOT NULL"
  ]) assert.ok(shape.includes(clause), `the kind shape check must cover: ${clause}`);
});

test('journey links pin a canonical revision and enum against the domain', () => {
  const block = tableBlock('journey_portfolio_journey_links');
  assert.deepEqual(enumValues(block, 'target_type'), keysOf(journeyTargets));
  assert.deepEqual(enumValues(block, 'relationship'), keysOf(journeyRelationships));
  assert.deepEqual(enumValues(block, 'item_kind'), keysOf(itemKinds));
  const flat = flatten(block);
  // A published link keeps an immutable snapshot; a current link follows the
  // canonical record. Both must pin the exact revision they were built from.
  assert.match(
    flat,
    /journey_portfolio_journey_links_item_version_fk FOREIGN KEY\(item_id,space_id,canonical_item_revision\) REFERENCES journey_portfolio_item_versions\(item_id,space_id,revision\) ON DELETE CASCADE/u
  );
  assert.match(migration, /journey_portfolio_item_versions_item_revision UNIQUE\(item_id,space_id,revision\)/u);
  assert.match(
    flatMigration,
    /CREATE UNIQUE INDEX journey_portfolio_journey_links_current_once ON journey_portfolio_journey_links\(space_id,item_id,journey_definition_id,target_type,target_id,relationship\) WHERE journey_version_id IS NULL;/u,
    'exactly one current working link may exist per item/target/relationship'
  );
  assert.match(
    flat,
    /journey_portfolio_journey_links_snapshot_shape CHECK\( \(journey_version_id IS NULL AND item_snapshot_json IS NULL AND item_snapshot_sha256 IS NULL\)/u
  );
});

test('composite unique keys built on unbounded upstream ids declare an octet budget', () => {
  // spaces.id and users.id are unbounded TEXT primary keys, so per-column length
  // checks cannot bound a composite btree key. Runtime-29 solved this the same
  // way. A width overflow on the idempotency key is unrecoverable: the INSERT
  // that records the operation fails after its effects were computed.
  const widths: ReadonlyArray<readonly [string, string]> = [
    ['journey_portfolio_relationships', 'octet_length(space_id)+octet_length(from_item_id)+octet_length(to_item_id)<=1024'],
    ['journey_portfolio_journey_links', 'octet_length(space_id)+octet_length(item_id)+octet_length(journey_definition_id) +COALESCE(octet_length(journey_version_id),0)+octet_length(target_type) +octet_length(target_id)+octet_length(relationship)<=1024'],
    ['journey_portfolio_operational_links', 'octet_length(space_id)+octet_length(initiative_id)+octet_length(operational_id)<=1024'],
    ['journey_portfolio_operations', 'octet_length(space_id)+octet_length(actor_user_id)+octet_length(idempotency_key)<=1024']
  ];
  for (const [table, expression] of widths) {
    assert.ok(
      flatten(tableBlock(table)).includes(`CONSTRAINT ${table}_index_width CHECK( ${expression})`),
      `${table} must declare its composite key width budget: ${expression}`
    );
  }
});

test('runtime-27 declares the access paths its own guards, quotas and sweeps depend on', () => {
  const indexes: ReadonlyArray<readonly [string, string]> = [
    // countRetainedPolicies counts space_id AND state<>'retired' on every policy
    // create; the table declared no index at all.
    ['journey_portfolio_scoring_policies_state', 'journey_portfolio_scoring_policies(space_id,state,updated_at DESC,id)'],
    // journey_initiative_dependencies_once covers the forward walk; the reverse
    // edge had no access path.
    ['journey_initiative_dependencies_reverse', 'journey_initiative_dependencies(space_id,depends_on_initiative_id,dependency_type,initiative_id)'],
    ['journey_initiative_baselines_history', 'journey_initiative_baselines(space_id,initiative_id,captured_at DESC,id)'],
    ['journey_portfolio_activity_retention', 'journey_portfolio_activity(created_at,id)'],
    ['journey_portfolio_items_retention', 'journey_portfolio_items(retention_expires_at,id) WHERE state=\'deleted\'']
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
  for (const key of ['journeyPortfolioItems', 'journeyPortfolioScoringPolicies']) {
    assert.ok(flatMigration.includes(`"${key}"`), `the plan merge must define ${key}`);
  }
  // starter is deliberately zero: the feature is off, not unlimited.
  assert.match(flatMigration, /'starter' THEN '\{"journeyPortfolioItems":0,"journeyPortfolioScoringPolicies":0\}'/u);
});

test('the corrections are documented in the migration, not only in this test', () => {
  // Read from the UNSTRIPPED text on purpose: these are the comments the
  // stripper removes everywhere else. A future editor reverting a fix without
  // reading why is the failure mode this guards.
  assert.match(raw, /No experience_runtime_schema_version row is written here/u);
  assert.match(raw, /referential-action firing order/u);
  assert.match(raw, /UPDATE-only, like every other sealed table in this file/u);
});
