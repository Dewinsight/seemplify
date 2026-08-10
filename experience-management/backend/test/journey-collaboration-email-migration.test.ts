import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * STATIC contract test for runtime-56
 * (`migrations/postgres/future/0056_journey_collaboration_email_delivery.sql`).
 *
 * SCOPE WARNING — READ BEFORE TRUSTING A GREEN RUN. Every assertion below reads
 * migration TEXT. This file does NOT create a database, does NOT apply the
 * migration and does NOT execute a single trigger, so it is NOT executed-
 * PostgreSQL proof and must not be recorded as one. Statements that satisfy
 * these regexes can still fail against a live server; executed coverage is a
 * separate gate in the shape of a per-migration probe script.
 *
 * runtime-56 is DELIBERATELY UNREGISTERED. It lives under `future/` because
 * runtime-compatibility.json, config.ts and the aggregate privilege file are all
 * pinned at 55, and `runtime-privilege-contract.test.ts` fails closed on any
 * `NNNN_*.sql` above the registered window sitting in the migration root.
 * Registration is a separate change; this file proves the tranche is correct
 * before it is wired, and asserts the staging location so it cannot drift into
 * the root by accident.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const migrationRoot = path.join(backendRoot, 'migrations', 'postgres');
const migrationRelativePath = path.join('future', '0056_journey_collaboration_email_delivery.sql');

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

const migration = stripSqlComments(fs.readFileSync(path.join(migrationRoot, migrationRelativePath), 'utf8'));
const repositorySource = fs.readFileSync(
  path.join(backendRoot, 'src', 'journeyCollaborationEmailRepository.ts'), 'utf8');
const domainSource = fs.readFileSync(
  path.join(backendRoot, 'src', 'journeyCollaborationEmailDomain.ts'), 'utf8');
const collaborationSource = fs.readFileSync(path.join(backendRoot, 'src', 'journeyCollaboration.ts'), 'utf8');
const collaborationMigration = stripSqlComments(
  fs.readFileSync(path.join(migrationRoot, '0028_journey_collaboration.sql'), 'utf8'));
const spacesSource = fs.readFileSync(path.join(backendRoot, 'src', 'spaces.ts'), 'utf8');
const configSource = fs.readFileSync(path.join(backendRoot, 'src', 'config.ts'), 'utf8');
const serverSource = fs.readFileSync(path.join(backendRoot, 'src', 'server.ts'), 'utf8');

const flatten = (text: string) => text.replace(/\s+/gu, ' ').trim();
const flatMigration = flatten(migration);

const runtime56Tables = [
  'journey_collaboration_email_preferences',
  'journey_collaboration_email_outbox',
  'journey_collaboration_email_attempts',
  'journey_collaboration_email_audit_events'
];

function tableBlock(source: string, table: string, indent = ''): string {
  const start = source.indexOf(`CREATE TABLE ${indent ? 'IF NOT EXISTS ' : ''}${table} (`);
  assert.notEqual(start, -1, `${table} must be declared`);
  const end = source.indexOf(`\n${indent});`, start);
  assert.notEqual(end, -1, `${table} must terminate with a closing paren`);
  return source.slice(start, end + indent.length + 3);
}

/**
 * Column names declared by a CREATE TABLE body, excluding CONSTRAINT / CHECK /
 * FOREIGN KEY / PRIMARY KEY / UNIQUE clauses. Splits on top-level commas rather
 * than on lines, so a mirror that packs several columns onto one line is still
 * compared as a set instead of silently passing for the wrong reason.
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
    const match = /^\s*([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|BIGINT|BOOLEAN|NUMERIC|TIMESTAMPTZ|REAL)\b/u.exec(segment);
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
    for (const key of flat.matchAll(/(?:UNIQUE|PRIMARY KEY)(?: NULLS NOT DISTINCT)? ?\(([^)]*)\)/gu)) add(table, key[1]!);
    for (const inline of flat.matchAll(/([a-z_]+) TEXT (?:[A-Z ]*)?PRIMARY KEY/gu)) add(table, inline[1]!);
  }
  for (const match of sql.matchAll(
    /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?[a-z_]+\s+ON ([a-z_]+)\s*\(([^)]*)\)([^;]*);/gu)) {
    if (/\bWHERE\b/u.test(match[3]!)) continue;
    add(match[1]!, match[2]!);
  }
  return keys;
}

/** Unique keys runtime-56 depends on but does not declare. Each is re-asserted
 * against its declaring source below, so an upstream rename breaks this test
 * rather than silently breaking the migration. */
const externalUniqueKeys = new Map<string, string[]>([
  ['spaces', ['id']],
  ['users', ['id']],
  ['space_memberships', ['space_id,user_id']],
  ['journey_collaboration_notifications', ['id,recipient_user_id,space_id']]
]);

test('runtime-56 is staged unregistered and gates on the exact runtime-55 predecessor', () => {
  assert.equal(fs.existsSync(path.join(migrationRoot, migrationRelativePath)), true,
    'the runtime-56 tranche must live under migrations/postgres/future until it is registered');
  assert.equal(fs.existsSync(path.join(migrationRoot, '0056_journey_collaboration_email_delivery.sql')), false,
    'moving runtime-56 into the migration root registers it, and the aggregate contracts are still pinned at 55');
  assert.match(migration,
    /IF COALESCE\(\(SELECT MAX\(version\) FROM experience_runtime_schema_version\),0\)<>55 THEN/u,
    'runtime-56 must refuse to apply on top of anything but runtime-55');
  // The runner owns experience_runtime_schema_version and supplies a checksum a
  // migration cannot know about itself; a self-stamp aborts on 23502.
  assert.deepEqual([...migration.matchAll(/INSERT INTO experience_runtime_schema_version\b/gu)].map((m) => m[0]!), [],
    'the runner stamps the ledger; a migration that stamps itself never commits');
  // The predecessor tranche must stay exactly where the runtime-55 contract test
  // expects it, and the aggregate window must stay pinned.
  assert.equal(fs.existsSync(path.join(migrationRoot, 'future', '0055_journey_surface_saved_views.sql')), true,
    'the staged runtime-55 surface saved-view artifact must be preserved');
  const compatibility = JSON.parse(
    fs.readFileSync(path.join(migrationRoot, 'runtime-compatibility.json'), 'utf8')) as
    { maximumRuntimeSchemaVersion: number };
  assert.equal(compatibility.maximumRuntimeSchemaVersion, 55,
    'runtime-56 must not register the aggregate until that is a deliberate, separate change');
});

test('runtime-56 is additive: it creates and revokes, and alters nothing that already exists', () => {
  const created = [...migration.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+) \(/gmu)].map((m) => m[1]!);
  assert.deepEqual(created.sort(), [...runtime56Tables].sort());
  // An ALTER or a DROP against an existing object is what makes a tranche
  // non-additive and un-replayable; the only ALTER form allowed here would be an
  // ADD CONSTRAINT on a table this same file created, and there is none.
  assert.deepEqual([...migration.matchAll(/^\s*(ALTER TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER|FUNCTION|COLUMN))/gmu)]
    .map((m) => m[0]!.trim()), [],
    'runtime-56 must not alter or drop anything, including its own objects');
  // In-app notification semantics stay exactly as runtime-28 defined them.
  for (const table of ['journey_collaboration_notifications', 'journey_collaboration_notification_states',
    'journey_collaboration_notification_state_events']) {
    assert.doesNotMatch(migration, new RegExp(`(?:ALTER|DROP|UPDATE|DELETE FROM|INSERT INTO) ${table}\\b`, 'u'),
      `runtime-56 must not write to or reshape ${table}`);
  }
  assert.match(collaborationMigration, /CREATE TABLE journey_collaboration_notifications \(/u);
  assert.match(collaborationMigration,
    /journey_collaboration_notifications_recipient_identity UNIQUE\(id,space_id,recipient_user_id\)/u,
    'the outbox foreign key depends on this runtime-28 identity key');
});

test('every runtime-56 foreign key resolves to a real unique key', () => {
  assert.match(spacesSource, /CREATE TABLE IF NOT EXISTS space_memberships \(/u);
  assert.match(spacesSource, /PRIMARY KEY\(space_id,user_id\)/u);
  const local = declaredUniqueKeys(migration);
  const references = [...flatMigration.matchAll(/REFERENCES ([a-z_]+)\(([^)]*)\)/gu)];
  assert.ok(references.length >= 6, 'runtime-56 must keep its composite tenant foreign keys');
  const unbacked: string[] = [];
  for (const reference of references) {
    const table = reference[1]!;
    const key = sortedKey(reference[2]!);
    if (local.get(table)?.has(key) || externalUniqueKeys.get(table)?.includes(key)) continue;
    unbacked.push(`${table}(${reference[2]!.trim()})`);
  }
  assert.deepEqual(unbacked, [],
    'each listed reference has no unique key of exactly those columns, so PostgreSQL aborts the '
      + 'migration with SQLSTATE 42830 before anything else in this file can be evaluated');
});

test('no runtime-56 table can hold comment content, an address or a name', () => {
  // Structural, not a redaction rule: the columns simply do not exist, so there
  // is nothing for a later change to forget to redact.
  const banned = /(?:^|_)(?:email|address|mailbox|recipient_name|name|body|excerpt|snippet|subject|preview|message|comment_body|plain_text|html|text)$/u;
  for (const table of runtime56Tables) {
    for (const column of columnNames(tableBlock(migration, table))) {
      assert.equal(banned.test(column), false,
        `${table}.${column} could carry notification content or an address into the delivery plane`);
    }
  }
  // Nothing anywhere in the tranche declares a free-text payload column either.
  assert.deepEqual([...migration.matchAll(
    /^\s{2}([a-z_]*(?:body|excerpt|subject|preview|payload|detail_json|content|snippet)[a-z_]*)\s+TEXT/gimu)]
    .map((match) => match[1]!), [],
    'a delivery row must never carry the notification content it refers to');
  // The audited principal and the audited delivery are hashes, and the audit has
  // no free-text detail column at all.
  const audit = tableBlock(migration, 'journey_collaboration_email_audit_events');
  assert.deepEqual(columnNames(audit), [
    'actor_user_id', 'created_at', 'event', 'id', 'outbox_sha256', 'principal_user_sha256',
    'reason_code', 'space_id'
  ]);
  assert.match(audit, /principal_user_sha256 TEXT NOT NULL CHECK\(principal_user_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
  // The attempt ledger records a hash of the provider message id, never the id.
  assert.match(tableBlock(migration, 'journey_collaboration_email_attempts'),
    /provider_message_sha256 TEXT CHECK\(\s*provider_message_sha256 IS NULL OR provider_message_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/u);
});

test('the opt-in defaults to off and cannot be granted by anyone but the member', () => {
  const preferences = tableBlock(migration, 'journey_collaboration_email_preferences');
  assert.match(preferences, /email_enabled BOOLEAN NOT NULL DEFAULT FALSE/u,
    'a member who has never decided must never be emailed');
  assert.match(flatten(preferences), /PRIMARY KEY\(space_id,user_id\)/u,
    'consent is per principal per space, so there is no row a space-wide switch could write');
  assert.match(flatten(preferences),
    /journey_collaboration_email_preferences_membership_fk FOREIGN KEY\(space_id,user_id\) REFERENCES space_memberships\(space_id,user_id\) ON DELETE CASCADE/u);
  // The route layer is the other half: it derives both the tenant and the
  // principal from the session, so no request shape can name someone else.
  const routes = fs.readFileSync(path.join(backendRoot, 'src', 'journeyCollaborationEmailRoutes.ts'), 'utf8');
  assert.doesNotMatch(routes, /spaceId:\s*(?:input|request\.body|request\.query|request\.params)/u,
    'the tenant must come from resolveRequestSpace, never from the caller');
  assert.doesNotMatch(routes, /userId:\s*(?:input|request\.body|request\.query|request\.params)/u,
    'the principal must come from the session, never from the caller');
  assert.match(routes, /userId: user\.id, actorUserId: user\.id/u);
  assert.match(repositorySource,
    /if \(input\.actorUserId !== input\.userId\) throw new JourneyCollaborationEmailError/u,
    'the repository must refuse a preference write on somebody else behalf even if a route regresses');
});

test('a queued delivery is proven consented, verified and active by the database', () => {
  assert.match(flatMigration,
    /CREATE TRIGGER journey_collaboration_email_outbox_consent_guard BEFORE INSERT ON journey_collaboration_email_outbox FOR EACH ROW EXECUTE FUNCTION journey_collaboration_email_outbox_consent_guard\(\)/u);
  assert.match(flatMigration,
    /FROM journey_collaboration_email_preferences preference WHERE preference\.space_id=NEW\.space_id AND preference\.user_id=NEW\.recipient_user_id AND preference\.email_enabled/u);
  assert.match(flatMigration,
    /FROM users account WHERE account\.id=NEW\.recipient_user_id AND account\.email_verified_at IS NOT NULL AND account\.account_status='active'/u);
  // Losing membership deletes the queued row, which is what makes "membership
  // loss before send cancels" true even for a worker that is mid-pass.
  assert.match(flatMigration,
    /journey_collaboration_email_outbox_membership_fk FOREIGN KEY\(space_id,recipient_user_id\) REFERENCES space_memberships\(space_id,user_id\) ON DELETE CASCADE/u);
  assert.match(flatMigration,
    /journey_collaboration_email_outbox_notification_fk FOREIGN KEY\(notification_id,space_id,recipient_user_id\) REFERENCES journey_collaboration_notifications\(id,space_id,recipient_user_id\) ON DELETE CASCADE/u);
});

test('the delivery key is a stable UUID and one notification can only queue once', () => {
  assert.match(tableBlock(migration, 'journey_collaboration_email_outbox'),
    /delivery_idempotency_key TEXT NOT NULL CHECK\(\s*delivery_idempotency_key ~ '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-5\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$'\)/u);
  assert.match(flatMigration,
    /journey_collaboration_email_outbox_once UNIQUE\(notification_id,space_id,recipient_user_id\)/u);
  assert.match(flatMigration, /journey_collaboration_email_outbox_key_once UNIQUE\(delivery_idempotency_key\)/u);
  // Derived, not generated: that is the property that survives a crash.
  assert.match(domainSource, /createHash\('sha256'\)\s*\.update\(`\$\{DELIVERY_KEY_NAMESPACE\}\\x1F\$\{input\.spaceId\}\\x1F\$\{input\.notificationId\}\\x1F\$\{input\.recipientUserId\}`\)/u);
  assert.doesNotMatch(domainSource, /randomUUID\(\)/u,
    'a generated key would deliver twice after a crash between send and commit');
});

test('leases are fenced and every state move is forward-only', () => {
  const outbox = flatten(tableBlock(migration, 'journey_collaboration_email_outbox'));
  assert.match(outbox, /lease_token_sha256 IS NOT NULL AND lease_token_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/u,
    'the lease secret must be stored as a hash, never in the clear');
  assert.match(outbox, /fencing_token BIGINT NOT NULL DEFAULT 0 CHECK\(fencing_token>=0\)/u);
  assert.match(outbox, /journey_collaboration_email_outbox_leased_state CHECK\( state<>'sending' OR lease_owner IS NOT NULL\)/u);
  assert.match(outbox, /journey_collaboration_email_outbox_attempts CHECK\(attempt_count<=max_attempts\)/u);
  assert.match(flatMigration,
    /NEW\.attempt_count<OLD\.attempt_count OR NEW\.fencing_token<OLD\.fencing_token THEN RAISE EXCEPTION 'Journey collaboration email attempts and fencing tokens never move backwards' USING ERRCODE='40001'/u);
  assert.match(flatMigration,
    /OLD\.state IN \('sent','cancelled','dead_letter'\) THEN RAISE EXCEPTION 'A terminal journey collaboration email delivery cannot be reopened'/u);
  assert.match(flatMigration, /RAISE EXCEPTION 'Journey collaboration email delivery identity is immutable'/u);
  // UPDATE OF names only the governed columns, so a cascade that touches an
  // ungoverned column cannot trip the forward-only rule.
  const trigger = /CREATE TRIGGER journey_collaboration_email_outbox_transition_guard BEFORE UPDATE OF ([a-z0-9_,\s]+) ON journey_collaboration_email_outbox/u
    .exec(flatMigration);
  assert.ok(trigger, 'the transition guard must be column-scoped');
  const guarded = trigger[1]!.split(',').map((column) => column.trim());
  assert.equal(guarded.includes('state'), true);
  assert.equal(guarded.includes('lease_owner'), false,
    'renewing a lease is not a state transition and must not be forced through the guard');
});

test('the attempt and audit ledgers are append-only without breaking a cascade', () => {
  // UPDATE only. The outbox cascades from journey_collaboration_notifications,
  // which itself cascades from comment retention, and the audit cascades from
  // the tenant. A BEFORE DELETE guard would turn both into a hard failure.
  assert.match(flatMigration,
    /CREATE TRIGGER journey_collaboration_email_attempts_append_only BEFORE UPDATE ON journey_collaboration_email_attempts FOR EACH ROW EXECUTE FUNCTION journey_collaboration_email_history_guard\(\)/u);
  assert.doesNotMatch(flatMigration,
    /journey_collaboration_email_attempts_append_only BEFORE UPDATE OR DELETE/u);
  // The audit guard is additionally column-scoped: naming actor_user_id would
  // make the ON DELETE SET NULL that fires when an account is removed fail
  // against the audit trail (the runtime-29 membership-FK lesson).
  const auditTrigger = /CREATE TRIGGER journey_collaboration_email_audit_append_only BEFORE UPDATE OF ([a-z0-9_,\s]+) ON journey_collaboration_email_audit_events/u
    .exec(flatMigration);
  assert.ok(auditTrigger, 'the audit guard must be column-scoped');
  assert.equal(auditTrigger[1]!.split(',').map((column) => column.trim()).includes('actor_user_id'), false);
  assert.match(flatMigration, /RAISE EXCEPTION 'Journey collaboration email attempts and audit are append-only' USING ERRCODE='55000'/u);
});

test('every runtime-56 guard function closes the PUBLIC execute default', () => {
  // PostgreSQL grants EXECUTE on every new function to PUBLIC. Revoking only
  // from the application role drops the explicit grant and leaves the default,
  // so has_function_privilege stays true and assertRuntimePrivileges raises
  // RUNTIME_PRIVILEGE_OVER_GRANT. Runtime-43 is why this rule exists.
  const declared = [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_]+)\(\)/gu)].map((m) => m[1]!);
  assert.deepEqual(declared.sort(), [
    'journey_collaboration_email_history_guard',
    'journey_collaboration_email_outbox_consent_guard',
    'journey_collaboration_email_outbox_transition_guard'
  ]);
  for (const name of declared) {
    assert.match(flatMigration, new RegExp(`REVOKE ALL ON FUNCTION ${name}\\(\\) FROM PUBLIC;`, 'u'),
      `${name} stays executable by the application role through the PUBLIC default`);
  }
  assert.match(flatMigration,
    /REVOKE UPDATE,DELETE ON journey_collaboration_email_attempts, journey_collaboration_email_audit_events FROM PUBLIC;/u);
  assert.match(flatMigration,
    /REVOKE INSERT,UPDATE,DELETE ON journey_collaboration_email_preferences, journey_collaboration_email_outbox FROM PUBLIC;/u);
});

test('the SQLite mirror declares the same tables and the same columns as runtime-56', () => {
  // Development and test runs must enforce the same shape the migrated database
  // does, or a defect only reproduces in production. Column SETS are compared;
  // the type mapping (BOOLEAN -> INTEGER, TIMESTAMPTZ -> TEXT, regex CHECK ->
  // length()) is provider-specific by necessity.
  for (const table of runtime56Tables) {
    const mirrored = columnNames(tableBlock(repositorySource, table, '    '));
    assert.deepEqual(mirrored, columnNames(tableBlock(migration, table)),
      `${table} mirror has drifted from runtime-56`);
  }
  for (const fragment of [
    'journey_collaboration_email_attempts_append_only',
    'journey_collaboration_email_audit_append_only',
    'journey_collaboration_email_outbox_consent_guard',
    'journey_collaboration_email_outbox_account_guard',
    'journey_collaboration_email_outbox_identity_guard',
    'journey_collaboration_email_outbox_terminal_guard',
    'journey_collaboration_email_outbox_forward_guard'
  ]) {
    assert.match(repositorySource, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${fragment}\\b`, 'u'),
      `${fragment} must exist in the SQLite mirror`);
  }
  assert.match(repositorySource,
    /Number\(db\.health\(\)\.runtimeSchemaVersion \|\| 0\) >= JOURNEY_COLLABORATION_EMAIL_RUNTIME_SCHEMA_VERSION/u,
    'the repository must refuse to run against a PostgreSQL runtime below 56');
  assert.match(domainSource, /JOURNEY_COLLABORATION_EMAIL_RUNTIME_SCHEMA_VERSION = 56/u);
});

test('the outbox row is written inside the notification transaction and never on its own', () => {
  // The enqueue must sit between the two runtime-28 inserts' savepoint and its
  // return, or a rolled-back notification could leave a queued email behind.
  const appendBlock = collaborationSource.slice(
    collaborationSource.indexOf('function appendNotification('),
    collaborationSource.indexOf('export function updateJourneyCollaborationSettings('));
  assert.notEqual(appendBlock.length, 0, 'appendNotification must still exist');
  const transactionStart = appendBlock.indexOf('return db.transaction(() => {');
  const enqueueAt = appendBlock.indexOf('journeyCollaborationEmailRepository.enqueueForNotification(');
  const transactionEnd = appendBlock.indexOf('})();', transactionStart);
  assert.ok(transactionStart >= 0 && enqueueAt > transactionStart && enqueueAt < transactionEnd,
    'the delivery enqueue must run inside the same transaction as the notification insert');
  // In-app semantics are untouched: both original inserts are still there and
  // still unconditional.
  assert.match(appendBlock, /INSERT INTO journey_collaboration_notifications/u);
  assert.match(appendBlock, /INSERT INTO journey_collaboration_notification_states/u);
  // Ineligibility returns null instead of throwing, so an opted-out recipient
  // cannot roll back their own in-app notification.
  assert.match(repositorySource, /if \(eligibilityInside\(input\.spaceId, input\.recipientUserId\)\) return null;/u);
});

test('the delivery worker is globally disabled by default and bounded when enabled', () => {
  assert.match(configSource,
    /journeyCollaborationEmailWorkerEnabled: configuredBoolean\(\s*process\.env\.JOURNEY_COLLABORATION_EMAIL_WORKER_ENABLED, false,/u,
    'a deployment that has made no decision must send no mail');
  assert.match(configSource,
    /journeyCollaborationEmailWorkerBatchSize: boundedNumber\(\s*process\.env\.JOURNEY_COLLABORATION_EMAIL_WORKER_BATCH_SIZE, 25, 1, 100\)/u);
  assert.match(serverSource,
    /const journeyCollaborationEmailWorker=config\.journeyCollaborationEmailWorkerEnabled\s*\?new JourneyCollaborationEmailWorker\(/u,
    'the worker must not even be constructed unless it is enabled');
  assert.match(serverSource, /journeyCollaborationEmailWorker\?\.start\(\);/u);
  assert.match(serverSource, /journeyCollaborationEmailWorker\.stop\(\),journeyCollaborationEmailWorker\.drain\(8_000\)/u,
    'shutdown must stop and drain the worker so an in-flight lease is released');
});
