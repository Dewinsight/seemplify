import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  journeyCollaborationAudiences,
  journeyCollaborationLimits,
  journeyCollaborationRoles,
  journeyCollaborationTargetTypes,
  journeyGovernanceTargetTypes
} from '../src/journeyCollaborationSchema.js';

/**
 * STATIC contract test for runtime-28 (`0028_journey_collaboration.sql`).
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * migration TEXT. This file does NOT create a database, does NOT apply the
 * migration, and does NOT execute a single statement, trigger or plpgsql body,
 * so it is NOT executed-PostgreSQL proof and must not be recorded as one. In
 * particular it cannot observe referential-action firing order, the interaction
 * between referential integrity and row triggers, deferred constraint timing, or
 * any runtime error inside a plpgsql body — bodies are only syntax-checked at
 * CREATE FUNCTION. Executed-PostgreSQL coverage for runtime-28 is a separate and
 * currently OPEN gate. `scripts/probe-journey-collaboration-postgres.mjs` does
 * exist, but nothing here runs it and no run of it is recorded, so its existence
 * is not evidence. `runtime-compatibility.json` now pins min=max=31, which puts
 * runtime-28 inside the shipped window on paper; that is a declaration, not an
 * observation, and no applied-anywhere claim follows from it.
 *
 * What it does prove is the class of defect this migration actually shipped:
 * ON DELETE actions that the same file's append-only guards make unreachable, a
 * composite foreign key that MATCH SIMPLE never enforced, a self-stamp the
 * migration runner cannot accept, and a primary-key column that pinned nothing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const readMigration = (name: string) => fs.readFileSync(path.join(migrationRoot, name), 'utf8');

/**
 * Every assertion must read executable DDL, never prose. Absence assertions in
 * particular ("no ON DELETE RESTRICT", "no SET NULL on a sealed table") would
 * otherwise trip on a comment that merely explains why the construct was
 * removed — and this file's corrections are all documented in exactly such
 * comments. No string literal in this migration spans a line, so tracking quote
 * parity per line is enough to avoid truncating at a `--` inside a literal.
 *
 * Known limitation, inherited from the runtime-29 precedent: dollar-quoted
 * plpgsql bodies are not stripped, so negative assertions also scan function
 * bodies. That is deliberate — a guard body is executable DDL too.
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

const migration = stripSqlComments(readMigration('0028_journey_collaboration.sql'));
const raw = readMigration('0028_journey_collaboration.sql');
const predecessor = stripSqlComments(readMigration('0026_journey_saved_views.sql'));
const stageProcessing = stripSqlComments(readMigration('0018_journey_stage_processing.sql'));
const metricObservations = stripSqlComments(readMigration('0021_journey_metric_observations.sql'));
const richCards = stripSqlComments(readMigration('0024_journey_rich_cards.sql'));
const personas = stripSqlComments(readMigration('0023_versioned_journey_personas.sql'));
const spacesSource = fs.readFileSync(path.join(backendRoot, 'src', 'spaces.ts'), 'utf8');
const runnerSource = fs.readFileSync(
  path.resolve(backendRoot, '..', 'scripts', 'upgrade-postgres-schema.mjs'), 'utf8');

const flatten = (text: string) => text.replace(/\s+/gu, ' ').trim();
const flatMigration = flatten(migration);

function tableBlock(table: string): string {
  const start = migration.indexOf(`CREATE TABLE ${table} (`);
  assert.notEqual(start, -1, `${table} must be declared by runtime-28`);
  const end = migration.indexOf('\n);', start);
  assert.notEqual(end, -1, `${table} must terminate with a closing paren`);
  return migration.slice(start, end + 3);
}

function functionBody(name: string): string {
  const start = flatMigration.indexOf(`FUNCTION ${name}(`);
  assert.notEqual(start, -1, `${name} must be declared by runtime-28`);
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
    for (const inline of flat.matchAll(/([a-z_]+) TEXT NOT NULL UNIQUE/gu)) add(table, inline[1]!);
  }
  for (const match of sql.matchAll(
    /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?[a-z_]+\s+ON ([a-z_]+)\s*\(([^)]*)\)([^;]*);/gu)) {
    if (/\bWHERE\b/u.test(match[3]!)) continue;
    add(match[1]!, match[2]!);
  }
  return keys;
}

/**
 * Unique keys runtime-28 depends on but does not declare. Each entry is
 * re-asserted against its declaring source below, so an upstream rename breaks
 * this test rather than silently breaking the migration.
 */
const externalUniqueKeys = new Map<string, string[]>([
  ['spaces', ['id']],
  ['users', ['id']],
  ['space_memberships', ['space_id,user_id']],
  ['journey_definitions', ['id', 'id,space_id']]
]);

/** Tables sealed against UPDATE only, because each is the child of a cascade. */
const cascadeChildSeals = [
  'journey_collaboration_notification_state_events',
  'journey_collaboration_notifications',
  'journey_collaboration_role_events',
  'journey_comment_versions',
  'journey_governance_publications',
  'journey_governance_review_events'
];
/** Space-scoped ledgers, sealed against UPDATE and DELETE alike. */
const ledgerSeals = [
  'journey_collaboration_activity',
  'journey_collaboration_audit_events',
  'journey_collaboration_operations',
  'journey_share_access_events'
];

test('runtime-28 gates on its predecessor and never stamps its own schema version', () => {
  assert.match(
    migration,
    /IF COALESCE\(\(SELECT MAX\(version\) FROM experience_runtime_schema_version\),0\)<>27 THEN/u,
    'runtime-28 must refuse to apply on top of anything but runtime-27'
  );
  // The blocker this file shipped with. scripts/upgrade-postgres-schema.mjs owns
  // experience_runtime_schema_version, declares checksum NOT NULL with no
  // default, and inserts the row itself after the migration body succeeds. A
  // self-stamp therefore aborts the final statement with SQLSTATE 23502 and
  // rolls the whole migration back; even past that it would collide with the
  // runner's own insert on the version primary key.
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
  assert.deepEqual([...predecessor.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)], []);
});

test('every runtime-28 foreign key resolves to a real unique key', () => {
  // The single upstream key runtime-28 leans on, asserted at its source. It is
  // already declared twice upstream, which is why this migration must not
  // declare a third copy of its own.
  assert.match(stageProcessing, /journey_definitions_tenant_identity\s+ON journey_definitions\(id,space_id\)/u);
  assert.match(
    metricObservations,
    /journey_metric_definitions_parent_identity ON journey_definitions\(id,space_id\);/u
  );
  assert.match(spacesSource, /CREATE TABLE IF NOT EXISTS space_memberships \(/u);
  assert.match(spacesSource, /PRIMARY KEY\(space_id,user_id\)/u);

  const local = declaredUniqueKeys(migration);
  const references = [...flatMigration.matchAll(/REFERENCES ([a-z_]+)\(([^)]*)\)/gu)];
  assert.ok(references.length > 20, 'runtime-28 must keep its composite tenant foreign keys');
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

test('runtime-28 declares no duplicate upstream tenant-identity index', () => {
  // IF NOT EXISTS matches on index NAME, not on definition, so re-declaring an
  // existing key under a new name builds a second B-tree over identical values
  // and pays for it on every write to the busiest journey tables. Each of the
  // five this file used to declare is proven redundant at its source below.
  assert.deepEqual(
    [...flatMigration.matchAll(/CREATE UNIQUE INDEX IF NOT EXISTS [a-z_]+ ON (journey_definitions|journey_personas|journey_map_versions|journey_map_stages|journey_map_cards)\([^)]*\)/gu)]
      .map((match) => match[0]!),
    [],
    'runtime-28 must not re-declare an upstream index it does not own'
  );
  assert.match(personas, /journey_personas_tenant_identity\s+ON journey_personas\(id,space_id\)/u);
  assert.match(metricObservations, /journey_metric_personas_tenant_identity ON journey_personas\(id,space_id\);/u);
  assert.match(
    stageProcessing,
    /journey_map_versions_tenant_definition_identity\s+ON journey_map_versions\(id,definition_id,space_id\)/u
  );
  assert.match(richCards, /journey_rich_cards_tenant_identity\s+ON journey_map_cards\(id,version_id,space_id\)/u);
  // journey_map_stages(id,version_id,space_id) backed no foreign key in any
  // migration; the tenant lookups journey_collaboration_target_exists performs
  // are served by this (id,space_id) key.
  assert.match(metricObservations, /journey_metric_stages_tenant_identity ON journey_map_stages\(id,space_id\);/u);
});

test('no runtime-28 foreign key uses ON DELETE RESTRICT', () => {
  // RESTRICT is checked inside the deleting statement, so an edge whose parent
  // is reachable by a cascade in that same statement makes success depend on
  // referential-action firing order. NO ACTION refuses exactly the same orphans
  // but defers to end-of-statement, after the sibling cascades land. This is the
  // rule runtime-29 already adopted.
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
test('runtime-28 referential actions are exactly the reviewed set', () => {
  const edges = [...flatMigration.matchAll(
    /REFERENCES ([a-z_]+)\(([^)]*)\)(?: ON DELETE (CASCADE|NO ACTION|SET NULL))?/gu)]
    .map((match) => `${match[1]!}(${match[2]!.replace(/\s+/gu, '')}) ${match[3] ?? 'NO ACTION (implicit)'}`);
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge, (counts.get(edge) ?? 0) + 1);
  assert.deepEqual([...counts.entries()].sort(), [
    ['journey_collaboration_notifications(id,space_id,recipient_user_id) CASCADE', 2],
    // Per-subject audit now follows its subject. Under RESTRICT the declared
    // cascades from space_memberships and journey_definitions were dead DDL:
    // removing a member or deleting a journey raised a raw foreign-key error.
    ['journey_collaboration_role_assignments(id,space_id) CASCADE', 1],
    ['journey_comment_versions(comment_id,version_number) CASCADE', 1],
    ['journey_comment_versions(id,comment_id,space_id) NO ACTION (implicit)', 1],
    ['journey_comments(id,space_id) CASCADE', 5],
    ['journey_definitions(id,space_id) CASCADE', 3],
    ['journey_governance_reviews(id,space_id) CASCADE', 3],
    // Only the four cascading edges remain. The five NO ACTION edges that stood
    // here were a live offboarding defect, not a product decision: they bound
    // durable attribution (comment author, version editor, review requester,
    // view owner, share creator) to current membership, so after any
    // collaboration activity spaces.ts removeSpaceMember's
    // DELETE FROM space_memberships raised 23503 with no pre-check, no guard and
    // no typed error -- an unhandled 500. Every one of those columns is NOT NULL,
    // so SET NULL was impossible and CASCADE would have destroyed the audit;
    // attribution now rests on the users(id) NO ACTION edges below and tenancy on
    // journey_collaboration_membership_guard, asserted at write time.
    ['space_memberships(space_id,user_id) CASCADE', 4],
    ['spaces(id) CASCADE', 11],
    ['users(id) NO ACTION', 7],
    // Single-column attribution columns, every one nullable. Known family-wide
    // latent pattern: SET NULL is executed as an UPDATE and would be refused by
    // the append-only seals, but no code path hard-deletes a user (there is no
    // DELETE FROM users in backend/src) and the reviewed runtime-29 migration
    // carries the identical shape (0029:824). Correcting it in 0028 alone would
    // diverge from the ratified reference, so it stays pinned and reported.
    ['users(id) SET NULL', 16]
  ].sort());
});

test('runtime-28 actor columns are attribution, and tenancy is checked at write time', () => {
  // The regression this pins: a member who has authored a comment, edited a
  // version, requested a review, owns a collaboration view or created a
  // read-only share must still be removable from the space, and removing them
  // must not erase or rewrite any of that history.
  for (const [table, column] of [
    ['journey_comments', 'author_user_id'],
    ['journey_comment_versions', 'editor_user_id'],
    ['journey_governance_reviews', 'requested_by_user_id'],
    ['journey_collaboration_views', 'owner_user_id'],
    ['journey_read_only_shares', 'created_by_user_id']
  ] as ReadonlyArray<readonly [string, string]>) {
    const block = flatten(tableBlock(table));
    assert.match(block, new RegExp(`${column} TEXT NOT NULL REFERENCES users\\(id\\) ON DELETE NO ACTION`, 'u'),
      `${table}.${column} must keep immutable, non-nullable user attribution`);
    assert.doesNotMatch(block, new RegExp(`FOREIGN KEY\\(space_id,${column}\\) REFERENCES space_memberships`, 'u'),
      `${table}.${column} must not bind durable attribution to current membership`);
    assert.match(
      flatMigration,
      new RegExp(`CREATE TRIGGER \\w+ BEFORE INSERT OR UPDATE OF space_id,${column} ON ${table} FOR EACH ROW EXECUTE FUNCTION journey_collaboration_membership_guard\\('${column}'\\)`, 'u'),
      `${table}.${column} must be tenancy-checked on every write`
    );
  }
  // Every surviving membership edge cascades, so none of them can refuse a
  // member removal; the four are per-recipient/per-subject rows that are
  // meaningless once membership ends, and their durable record lives in the
  // sealed activity and audit tables that carry no parent foreign key.
  assert.deepEqual(
    [...flatMigration.matchAll(/REFERENCES space_memberships\(space_id,user_id\)(?: ON DELETE (CASCADE|NO ACTION|SET NULL))?/gu)]
      .map((match) => match[1] ?? 'NO ACTION (implicit)'),
    ['CASCADE', 'CASCADE', 'CASCADE', 'CASCADE'],
    'no runtime-28 membership edge may refuse a member removal'
  );
  // Without the lock this is advice, not an invariant: under READ COMMITTED a
  // bare existence check can be satisfied by a membership row that a concurrent
  // transaction is already deleting, and both statements then commit.
  const guard = functionBody('journey_collaboration_membership_guard');
  assert.match(guard, /FROM space_memberships\s+WHERE space_id=NEW\.space_id AND user_id=actor FOR SHARE/u,
    'the membership check must lock the row it read');
  assert.match(guard, /IF actor IS NULL THEN RETURN NEW; END IF;/u,
    'a nullable actor column must stay nullable');
  assert.match(guard, /ERRCODE='23503'/u,
    'a tenancy refusal must stay a referential-integrity error, as the dropped edge was');
});

test('no ON DELETE SET NULL edge targets a table an append-only guard seals', () => {
  // The deepest defect this migration shipped. ON DELETE SET NULL is executed as
  // an ordinary UPDATE against the child and fires its row-level BEFORE
  // triggers, so journey_collaboration_activity's three composite SET NULL edges
  // could never fire against its BEFORE UPDATE OR DELETE seal — and they nulled
  // every referencing column including space_id, which is NOT NULL, so they
  // would have raised 23502 even with no trigger. Deleting a journey, a comment
  // or a review was therefore impossible. journey_share_access_events had the
  // same shape, plus a MATCH SIMPLE hole: with space_id nullable, a row naming
  // another tenant's share with space_id IS NULL skipped the composite check
  // entirely.
  const composite = [...flatMigration.matchAll(
    /FOREIGN KEY\(([^)]*)\)\s*REFERENCES [a-z_]+\([^)]*\) ON DELETE SET NULL/gu)].map((match) => match[0]!);
  assert.deepEqual(composite, [], 'a composite SET NULL edge nulls every referencing column, space_id included');
  for (const match of flatMigration.matchAll(/([a-z_]+) TEXT[^,]*REFERENCES ([a-z_]+)\(id\) ON DELETE SET NULL/gu)) {
    assert.equal(match[2]!, 'users', `only user attribution may be nulled, not ${match[1]!} -> ${match[2]!}`);
    assert.doesNotMatch(match[0]!, /NOT NULL/u, 'SET NULL on a NOT NULL column can only ever raise 23502');
  }
  // The activity table keeps its subject references as bounded free columns,
  // exactly like journey_collaboration_audit_events and journey_portfolio_activity.
  const activity = flatten(tableBlock('journey_collaboration_activity'));
  for (const column of ['journey_definition_id', 'comment_id', 'review_id']) {
    assert.ok(
      activity.includes(`${column} TEXT CHECK(`) || activity.includes(`${column} TEXT CHECK( ${column} IS NULL`),
      `${column} must stay a bounded, unreferenced column so the audit outlives its subject`
    );
    assert.doesNotMatch(
      activity,
      new RegExp(`FOREIGN KEY\\(${column},space_id\\)`, 'u'),
      `${column} must not re-acquire a foreign key on an append-only ledger`
    );
  }
  // The half-populated share pair is now unrepresentable, closing the MATCH
  // SIMPLE hole the dropped foreign key never covered.
  assert.match(
    flatten(tableBlock('journey_share_access_events')),
    /journey_share_access_events_share_shape CHECK\( \(share_id IS NULL AND space_id IS NULL\) OR \(share_id IS NOT NULL AND space_id IS NOT NULL AND length\(share_id\) BETWEEN 1 AND 128 AND length\(space_id\) BETWEEN 1 AND 128\)\)/u
  );
});

test('a sealed table is deletable exactly when a declared cascade must reach it', () => {
  // The distinction is load-bearing and was inverted for six tables. Every
  // cascade child below is reached by a DELETE the guard used to refuse:
  // comment versions from journey_comments (itself cascading from
  // journey_definitions and swept by journey_comments_retention), role events
  // from role assignments, review events and publications from governance
  // reviews, notifications from space_memberships/comments/reviews, and state
  // events from notifications. Asserted as an exact pair set, so adding or
  // dropping `OR DELETE` anywhere fails here.
  const seals = [...flatMigration.matchAll(
    /CREATE TRIGGER ([a-z_]+_append_only) BEFORE (UPDATE OR DELETE|UPDATE) ON ([a-z_]+)/gu)]
    .map((match) => `${match[3]!}: ${match[2]!}`).sort();
  assert.deepEqual(seals, [
    ...cascadeChildSeals.map((table) => `${table}: UPDATE`),
    ...ledgerSeals.map((table) => `${table}: UPDATE OR DELETE`)
  ].sort());
  // A cascade child must not simultaneously be refused deletion; a ledger must
  // not be the child of anything but spaces.
  for (const table of cascadeChildSeals) {
    assert.ok(
      flatMigration.includes(`BEFORE UPDATE ON ${table} FOR EACH ROW`),
      `${table} must stay reachable by its parent's cascade and by retention`
    );
  }
  // Runtime-29's own contract test pins this exact line; it must not drift.
  assert.match(migration, /BEFORE UPDATE OR DELETE ON journey_collaboration_activity/u);
  assert.match(
    functionBody('journey_collaboration_append_only_guard'),
    /Journey collaboration history is append-only/u
  );
  // Retention is declared for deleted comments, so the sweep must be able to
  // reach both the comment and the versions that cascade from it.
  assert.match(
    flatMigration,
    /CREATE INDEX journey_comments_retention ON journey_comments\(retention_expires_at,id\) WHERE state='deleted';/u
  );
});

test('a mention pins a revision that actually exists', () => {
  // comment_revision was part of the primary key but pinned nothing: any integer
  // was accepted, including a revision that never existed. journey_comments
  // .revision and journey_comment_versions.version_number advance in lockstep and
  // the version row is always inserted before its mentions, so this rejects only
  // writes that were already incoherent.
  const block = flatten(tableBlock('journey_comment_mentions'));
  assert.match(block, /comment_revision INTEGER NOT NULL CHECK\(comment_revision>0\)/u);
  assert.match(block, /PRIMARY KEY\(comment_id,user_id,comment_revision\)/u);
  assert.match(
    block,
    /journey_comment_mentions_revision_fk FOREIGN KEY\(comment_id,comment_revision\) REFERENCES journey_comment_versions\(comment_id,version_number\) ON DELETE CASCADE/u
  );
  // The backing key. Without it the foreign key above aborts the file with 42830.
  assert.match(migration, /journey_comment_versions_sequence UNIQUE\(comment_id,version_number\)/u);
});

test('comment threading, edit history and resolve/reopen shapes are enforced in DDL', () => {
  const block = flatten(tableBlock('journey_comments'));
  assert.deepEqual(enumValues(block, 'target_type'), [...journeyCollaborationTargetTypes].sort());
  assert.deepEqual(enumValues(block, 'state'), ['active', 'deleted', 'resolved']);
  // A root comment references itself; a reply may not, and may not root itself.
  assert.match(
    block,
    /journey_comments_thread_shape CHECK\( \(parent_comment_id IS NULL AND root_comment_id=id\) OR \(parent_comment_id IS NOT NULL AND root_comment_id<>id\)\)/u
  );
  // Only a root comment can be resolved, and reopening must clear the record —
  // which is why journey_collaboration_activity is the audit of record and must
  // survive the comment it describes.
  assert.match(block, /state='resolved' AND parent_comment_id IS NULL AND resolved_at IS NOT NULL/u);
  assert.match(block, /state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL/u);
  const versions = flatten(tableBlock('journey_comment_versions'));
  assert.match(versions, /content_sha256 TEXT NOT NULL CHECK\(content_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(versions, /edit_reason_sha256 TEXT CHECK\(/u, 'an edit records why, content-free');
  assert.match(
    flatMigration,
    /ALTER TABLE journey_comments ADD CONSTRAINT journey_comments_current_version_fk FOREIGN KEY\(current_version_id,id,space_id\) REFERENCES journey_comment_versions\(id,comment_id,space_id\) DEFERRABLE INITIALLY DEFERRED;/u,
    'the comment and its first version reference each other, so the pointer must be deferred'
  );
});

test('collaboration enums mirror the tested in-memory contract', () => {
  assert.deepEqual(
    enumValues(tableBlock('journey_collaboration_role_assignments'), 'role'),
    [...journeyCollaborationRoles].sort()
  );
  assert.deepEqual(
    enumValues(tableBlock('journey_collaboration_role_events'), 'role'),
    [...journeyCollaborationRoles].sort()
  );
  assert.deepEqual(
    enumValues(tableBlock('journey_governance_reviews'), 'target_type'),
    [...journeyGovernanceTargetTypes].sort()
  );
  assert.deepEqual(
    enumValues(tableBlock('journey_governance_publications'), 'target_type'),
    [...journeyGovernanceTargetTypes].sort()
  );
  assert.deepEqual(
    enumValues(tableBlock('journey_collaboration_views'), 'audience'),
    [...journeyCollaborationAudiences].sort()
  );
  assert.deepEqual(
    enumValues(tableBlock('journey_collaboration_watchers'), 'target_type'),
    [...journeyCollaborationTargetTypes].sort()
  );
  // Bounds are the schema module's, not invented here.
  const versions = flatten(tableBlock('journey_comment_versions'));
  assert.ok(versions.includes(`length(plain_text) BETWEEN 1 AND ${journeyCollaborationLimits.commentCharacters}`));
  const views = flatten(tableBlock('journey_collaboration_views'));
  assert.ok(views.includes(`length(name) BETWEEN 1 AND ${journeyCollaborationLimits.viewNameCharacters}`));
  assert.ok(views.includes(
    `octet_length(configuration_json) BETWEEN 2 AND ${journeyCollaborationLimits.viewConfigurationBytes}`));
  const shares = flatten(tableBlock('journey_read_only_shares'));
  assert.ok(shares.includes(
    `octet_length(snapshot_json) BETWEEN 2 AND ${journeyCollaborationLimits.shareSnapshotBytes}`));
});

test('governance state, approval and publication shapes are enforced in DDL', () => {
  const block = flatten(tableBlock('journey_governance_reviews'));
  assert.deepEqual(
    enumValues(block, 'state'),
    ['approved', 'pending', 'published', 'rejected', 'withdrawn']
  );
  // A decision without a decider, or a publication without a publisher, is
  // unrepresentable — the approval trail cannot be back-filled.
  assert.match(block, /state='pending' AND decided_by_user_id IS NULL AND decided_at IS NULL/u);
  assert.match(
    block,
    /state='published' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND published_by_user_id IS NOT NULL AND published_at IS NOT NULL/u
  );
  // A review pins the exact revision and content hash it was requested against.
  assert.match(block, /target_revision INTEGER NOT NULL CHECK\(target_revision>0\)/u);
  assert.match(block, /target_sha256 TEXT NOT NULL CHECK\(target_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(
    flatMigration,
    /CREATE UNIQUE INDEX journey_governance_reviews_one_pending ON journey_governance_reviews\(space_id,target_type,target_id,target_revision\) WHERE state='pending';/u,
    'one pending review per target revision'
  );
  assert.match(flatten(tableBlock('journey_governance_publications')), /journey_governance_publications_review_once UNIQUE\(review_id\)/u);
});

test('sharing stays off until a security review is recorded, and tokens are stored hashed', () => {
  const settings = flatten(tableBlock('journey_collaboration_settings'));
  assert.match(settings, /sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.match(settings, /external_downloads_enabled BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.match(
    settings,
    /journey_collaboration_settings_security_review CHECK\( \(sharing_enabled=FALSE AND security_review_reference IS NULL/u,
    'sharing may not be enabled without a recorded security review'
  );
  assert.match(settings, /journey_collaboration_settings_downloads CHECK\( external_downloads_enabled=FALSE OR sharing_enabled=TRUE\)/u);
  const shares = flatten(tableBlock('journey_read_only_shares'));
  assert.match(shares, /token_hash TEXT NOT NULL UNIQUE CHECK\(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/u,
    'a share token must never be stored in the clear');
  assert.match(shares, /permission TEXT NOT NULL DEFAULT 'view' CHECK\(permission='view'\)/u);
  assert.match(shares, /journey_read_only_shares_download_policy CHECK\(allow_download=FALSE OR allow_export=TRUE\)/u);
  assert.match(shares, /journey_read_only_shares_expiry CHECK\(expires_at>created_at\)/u);
  // A revoked share keeps its reason hash; access events are content-free.
  assert.match(shares, /state='revoked' AND revoked_at IS NOT NULL AND revocation_reason_sha256 IS NOT NULL/u);
  const events = flatten(tableBlock('journey_share_access_events'));
  assert.match(events, /token_fingerprint TEXT NOT NULL CHECK\(token_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  assert.match(events, /outcome TEXT NOT NULL CHECK\(outcome IN \('allowed','denied'\)\)/u);
});

test('composite unique keys built on unbounded upstream ids declare an octet budget', () => {
  // spaces.id and users.id are unbounded TEXT primary keys, so per-column length
  // checks cannot bound a composite btree key. Runtime-29 solved this the same
  // way. A width overflow on the idempotency key is unrecoverable: the INSERT
  // that records the operation fails after its effects were computed.
  const widths: ReadonlyArray<readonly [string, string, string]> = [
    ['journey_collaboration_role_assignments', 'journey_collaboration_roles_index_width',
      'octet_length(space_id)+octet_length(user_id) +COALESCE(octet_length(journey_definition_id),0)<=1024'],
    ['journey_comments', 'journey_comments_index_width',
      'octet_length(id)+octet_length(space_id)+octet_length(target_type)+octet_length(target_id)<=1024'],
    ['journey_collaboration_watchers', 'journey_collaboration_watchers_index_width',
      'octet_length(space_id)+octet_length(target_type)+octet_length(target_id) +octet_length(user_id)<=1024'],
    ['journey_governance_reviews', 'journey_governance_reviews_index_width',
      'octet_length(space_id)+octet_length(target_type)+octet_length(target_id)<=1024'],
    ['journey_collaboration_notifications', 'journey_collaboration_notifications_index_width',
      'octet_length(space_id)+octet_length(recipient_user_id)<=1024'],
    ['journey_collaboration_operations', 'journey_collaboration_operations_index_width',
      'octet_length(space_id)+octet_length(actor_user_id)+octet_length(idempotency_key)<=1024']
  ];
  for (const [table, constraint, expression] of widths) {
    assert.ok(
      flatten(tableBlock(table)).includes(`CONSTRAINT ${constraint} CHECK( ${expression})`),
      `${table} must declare its composite key width budget: ${expression}`
    );
  }
});

test('runtime-28 declares the access paths its own inboxes and sweeps depend on', () => {
  const indexes: ReadonlyArray<readonly [string, string]> = [
    // The unread badge led with notification_id under the primary key alone.
    ['journey_collaboration_notification_states_recipient', 'journey_collaboration_notification_states(space_id,recipient_user_id,state,notification_id)'],
    ['journey_collaboration_notification_state_events_history', 'journey_collaboration_notification_state_events(space_id,notification_id,created_at,id)'],
    // "What is published for this target" had no access path: both unique keys
    // lead with id or review_id.
    ['journey_governance_publications_target', 'journey_governance_publications(space_id,target_type,target_id,published_at DESC,id)'],
    // Written by unauthenticated share traffic and reached by no cascade.
    ['journey_share_rate_buckets_expiry', 'journey_share_rate_buckets(bucket_started_at,requester_fingerprint)'],
    ['journey_share_access_events_retention', 'journey_share_access_events(created_at,id)'],
    ['journey_collaboration_activity_retention', 'journey_collaboration_activity(created_at,id)']
  ];
  for (const [name, target] of indexes) {
    assert.ok(
      flatMigration.includes(`CREATE INDEX ${name} ON ${target}`),
      `missing access path: CREATE INDEX ${name} ON ${target}`
    );
  }
});

test('every write guard fires only on the columns it reads', () => {
  assert.doesNotMatch(
    flatMigration,
    /BEFORE INSERT OR UPDATE ON /u,
    'the narrow BEFORE INSERT OR UPDATE OF <columns> form is the house convention'
  );
  const narrowed: ReadonlyArray<readonly [string, string, string]> = [
    ['journey_comments_target_guard', 'journey_comments', 'space_id,target_type,target_id'],
    ['journey_watchers_target_guard', 'journey_collaboration_watchers', 'space_id,target_type,target_id'],
    ['journey_governance_reviews_target_guard', 'journey_governance_reviews', 'space_id,target_type,target_id'],
    ['journey_comment_thread_guard', 'journey_comments', 'parent_comment_id,root_comment_id,target_type,target_id'],
    ['journey_collaboration_view_guard', 'journey_collaboration_views', 'space_id,resource_type,resource_id'],
    ['journey_share_target_guard', 'journey_read_only_shares', 'space_id,target_type,target_id']
  ];
  for (const [trigger, table, columns] of narrowed) {
    assert.ok(
      flatMigration.includes(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OF ${columns} ON ${table}`),
      `${trigger} must list exactly the columns it reads: ${columns}`
    );
  }
  // The tenancy probe every target guard delegates to must stay tenant-scoped on
  // each branch; a missing space_id predicate would let a comment name another
  // tenant's row.
  const exists = functionBody('journey_collaboration_target_exists');
  for (const branch of ['journey_map', 'journey_stage', 'journey_card', 'persona', 'portfolio_item', 'recommendation']) {
    assert.ok(exists.includes(`requested_type='${branch}'`), `the target probe must handle ${branch}`);
  }
  assert.ok(
    (exists.match(/requested_space/gu) ?? []).length >= 6,
    'every branch of the target probe must constrain the tenant'
  );
  assert.match(exists, /RETURN FALSE;/u, 'an unknown target type must not fall through as valid');
});

test('the corrections are documented in the migration, not only in this test', () => {
  // Read from the UNSTRIPPED text on purpose: these are the comments the
  // stripper removes everywhere else. A future editor reverting a fix without
  // reading why is the failure mode this guards.
  assert.match(raw, /No experience_runtime_schema_version row is written here/u);
  assert.match(raw, /MATCH SIMPLE/u);
  assert.match(raw, /Two classes of sealed table, and the difference is load-bearing/u);
  assert.match(raw, /Per-subject audit follows its subject/u);
});
