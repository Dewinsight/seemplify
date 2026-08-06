#!/usr/bin/env node

/** Runtime-29 proof for the journey hierarchy and governed service blueprints.
 * This probe only writes to the disposable PostgreSQL E2E database.
 *
 * Runtime 29 moves five invariants out of application code and into the
 * database, and every one of them is invisible to a static migration test:
 * the recursive cycle and depth walks in journey_hierarchy_link_guard, the
 * bidirectional unknown-score shape on health snapshots, the current -> future
 * direction of a blueprint comparison, the typed causality guard that couples a
 * blueprint element to a runtime-27 portfolio item, and the deferred
 * journey_blueprints_current_version_fk that can only be judged at COMMIT.
 * It also proves the runtime-29 half of the offboarding fix: the composite
 * membership foreign keys are gone, so a member who owns a blueprint can be
 * removed, and journey_hierarchy_membership_guard still refuses a non-member --
 * including against a concurrent offboarding, which is what its FOR SHARE buys. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'pg';
import { assertRuntimePrivileges, assertRuntimeSchemaContract } from './postgres-runtime-contract.mjs';

const database = String(process.env.POSTGRES_DATABASE || '');
const host = String(process.env.POSTGRES_HOST || '127.0.0.1');
const port = Number(process.env.POSTGRES_PORT || 5432);
const ownerUser = String(process.env.POSTGRES_PROBE_OWNER_USER || '');
const ownerPasswordFile = String(process.env.POSTGRES_PROBE_OWNER_PASSWORD_FILE || '');
const appUser = String(process.env.POSTGRES_USER || '');
const appPasswordFile = String(process.env.POSTGRES_PASSWORD_FILE || '');
const proof = `pg29hierarchy${crypto.randomBytes(6).toString('hex')}`;

assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES, 'true',
  'The runtime-29 hierarchy/blueprint probe requires POSTGRES_PROBE_ALLOW_WRITES=true.');
// {12}, not +: the harness names its disposable database with exactly twelve hex
// characters (test-postgres-e2e.mjs). An open-ended suffix would also accept a
// hand-named long-lived database that merely starts the same way.
assert.match(database, /^experience_e2e_[a-f0-9]{12}$/u,
  'The runtime-29 hierarchy/blueprint probe refuses every non-disposable database.');
assert.match(ownerUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.match(appUser, /^[A-Za-z_][A-Za-z0-9_]*$/u);
assert.ok(ownerPasswordFile && fs.existsSync(ownerPasswordFile));
assert.ok(appPasswordFile && fs.existsSync(appPasswordFile));

const password = (filename) => fs.readFileSync(filename, 'utf8').replace(/[\r\n]+$/u, '');
const connection = (user, credential, name) => ({ host, port, database, user, password: credential, ssl: false,
  application_name: name, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
const owner = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-hierarchy-runtime29-owner'));
const app = new Client(connection(appUser, password(appPasswordFile), 'journey-hierarchy-runtime29-app'));
const left = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-hierarchy-runtime29-left'));
const right = new Client(connection(ownerUser, password(ownerPasswordFile), 'journey-hierarchy-runtime29-right'));
const at = '2026-08-05T16:00:00.000Z';
const later = '2026-08-05T17:00:00.000Z';
const hash = (value) => crypto.createHash('sha256').update(`${proof}:${value}`).digest('hex');
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const id = (suffix) => `${proof}-${suffix}`;
const ids = {
  owner: id('owner'), leaver: id('leaver'), outsider: id('outsider'), racer: id('racer'),
  spaceA: id('space-a'), spaceB: id('space-b'),
  d1: id('def-1'), d2: id('def-2'), d3: id('def-3'), d4: id('def-4'), defB: id('def-b'),
  termA: id('term-a'), termB: id('term-b'),
  healthPolicy: id('health-policy'),
  team: id('resource-team'), actor: id('resource-actor'),
  blueprint: id('blueprint'), blueprintOther: id('blueprint-other'), blueprintB: id('blueprint-b'),
  current: id('bpv-current'), future: id('bpv-future'), otherVersion: id('bpv-other'),
  otherFuture: id('bpv-other-future'),
  backstage: id('element-backstage'), customer: id('element-customer'),
  painPoint: id('item-pain'), solution: id('item-solution')
};
const definitionsA = [ids.d1, ids.d2, ids.d3, ids.d4];

const insertDefinition = `INSERT INTO journey_definitions
  (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
   published_version_id,review_cadence_days,revision,created_at,updated_at)
  VALUES ($1,$2,'Runtime 29 hierarchy','Executed proof','customer','current_state','designed','draft',$3,
    NULL,NULL,30,1,$4,$4)`;
const insertMapVersion = `INSERT INTO journey_map_versions
  (id,definition_id,space_id,version_number,state,map_type,mode,experience_type,author_user_id,published_at,created_at)
  VALUES ($1,$2,$3,1,'draft','current_state','designed','customer',$4,NULL,$5)`;
const insertLink = `INSERT INTO journey_hierarchy_links
  (id,space_id,link_type,from_definition_id,to_definition_id,review_state,lifecycle,revision,
   created_by_user_id,updated_by_user_id,created_at,updated_at)
  VALUES ($1,$2,$3,$4,$5,'draft','active',1,$6,$6,$7,$7)`;
const insertSnapshot = `INSERT INTO journey_hierarchy_health_snapshots
  (id,space_id,definition_id,policy_id,policy_version,policy_revision,policy_configuration_sha256,
   definition_revision,score,status,explanation,components_json,child_lineage_json,calculated_at)
  VALUES ($1,$2,$3,$4,'v1',1,$5,1,$6,$7,'Runtime 29 executed proof','[]','[]',$8)`;
const insertBlueprintVersion = `INSERT INTO journey_blueprint_versions
  (id,blueprint_id,space_id,journey_definition_id,journey_version_id,version_number,blueprint_state,review_state,
   schema_version,snapshot_sha256,change_reason,actor_user_id,created_at,approved_by_user_id,approved_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','journey-service-blueprint/v1',$8,'initial',$9,$10,NULL,NULL)`;
const insertPortfolioLink = `INSERT INTO journey_blueprint_portfolio_links
  (id,space_id,blueprint_version_id,element_id,portfolio_item_id,portfolio_item_revision,relationship,
   created_by_user_id,created_at)
  VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`;
const insertComparison = `INSERT INTO journey_blueprint_comparisons
  (id,space_id,journey_definition_id,from_version_id,to_version_id,result_json,result_sha256,actor_user_id,created_at)
  VALUES ($1,$2,$3,$4,$5,'{}',$6,$7,$8)`;

// Deletable fixture tables, in dependency order. journey_hierarchy_operations and
// journey_hierarchy_activity are deliberately absent: their seals are BEFORE
// UPDATE OR DELETE, so a DELETE here would raise 55000 and a swallowed teardown
// error would make this probe's cleanup claim false. See the cleanup block.
const teardown = [
  'DELETE FROM journey_blueprint_comparisons WHERE space_id=$1',
  'DELETE FROM journey_blueprint_portfolio_links WHERE space_id=$1',
  'DELETE FROM journey_blueprints WHERE space_id=$1',
  'DELETE FROM journey_hierarchy_health_snapshots WHERE space_id=$1',
  'DELETE FROM journey_hierarchy_health_policies WHERE space_id=$1',
  'DELETE FROM journey_hierarchy_links WHERE space_id=$1',
  'DELETE FROM journey_definition_taxonomy WHERE space_id=$1',
  'DELETE FROM journey_taxonomy_terms WHERE space_id=$1',
  'DELETE FROM journey_blueprint_resources WHERE space_id=$1',
  'DELETE FROM journey_portfolio_item_versions WHERE space_id=$1',
  'DELETE FROM journey_portfolio_items WHERE space_id=$1',
  'DELETE FROM journey_portfolio_settings WHERE space_id=$1',
  'DELETE FROM journey_hierarchy_settings WHERE space_id=$1',
  'DELETE FROM journey_definitions WHERE space_id=$1'
];
// What must be zero afterwards. journey_blueprint_versions/stages/elements are
// reached only by cascade from journey_blueprints, so counting them proves the
// cascade actually ran rather than being refused by a seal.
const residueTables = ['journey_blueprint_comparisons', 'journey_blueprint_portfolio_links',
  'journey_blueprint_element_resources', 'journey_blueprint_relationships', 'journey_blueprint_elements',
  'journey_blueprint_stages', 'journey_blueprint_versions', 'journey_blueprints',
  'journey_hierarchy_health_snapshots', 'journey_hierarchy_health_policies', 'journey_hierarchy_links',
  'journey_definition_taxonomy', 'journey_taxonomy_terms', 'journey_blueprint_resources',
  'journey_portfolio_item_versions', 'journey_portfolio_items', 'journey_portfolio_settings',
  'journey_hierarchy_settings', 'journey_definitions'];

try {
  await Promise.all([owner.connect(), app.connect(), left.connect(), right.connect()]);
  const migration = await owner.query('SELECT version,checksum FROM experience_runtime_schema_version WHERE version=29');
  assert.equal(migration.rowCount, 1);
  assert.match(String(migration.rows[0].checksum), /^[a-f0-9]{64}$/u);
  await assertRuntimeSchemaContract((sql) => owner.query(sql), { runtimeVersion: 29 });
  await assertRuntimePrivileges((sql) => owner.query(sql), appUser, { runtimeVersion: 29 });
  emit('journey_hierarchy_runtime_contract_passed');

  for (const [user, email, name] of [[ids.owner, 'owner', 'Hierarchy owner'],
    [ids.leaver, 'leaver', 'Departing blueprint owner'], [ids.outsider, 'outsider', 'Hierarchy outsider'],
    [ids.racer, 'racer', 'Concurrently offboarded reviewer']]) {
    await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
      VALUES ($1,$2,$3,'not-a-login','member',1,$4,$4)`, [user, `${proof}-${email}@example.invalid`, name, at]);
  }
  for (const [spaceId, slug] of [[ids.spaceA, `${proof}-a`], [ids.spaceB, `${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES ($1,'Runtime 29 hierarchy',$2,$3,NULL,$4,$4)`, [spaceId, slug, ids.owner, at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,'owner',$3,$3)`, [spaceId, ids.owner, at]);
  }
  for (const user of [ids.leaver, ids.racer]) {
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES ($1,$2,'member',$3,$3)`, [ids.spaceA, user, at]);
  }
  await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES ($1,$2,'member',$3,$3)`, [ids.spaceB, ids.outsider, at]);
  // maximum_depth=2 makes the depth ceiling reachable in three links instead of
  // thirteen; the guard reads the configured value, so a small budget exercises
  // exactly the same recursive walk the default would.
  await owner.query(`INSERT INTO journey_hierarchy_settings
    (space_id,hierarchy_enabled,blueprints_enabled,maximum_depth,maximum_links,revision,updated_by_user_id,
     created_at,updated_at)
    VALUES ($1,TRUE,TRUE,2,2000,1,$2,$3,$3)`, [ids.spaceA, ids.owner, at]);
  // Space B is the kill-switch tenant: both features off.
  await owner.query(`INSERT INTO journey_hierarchy_settings
    (space_id,hierarchy_enabled,blueprints_enabled,maximum_depth,maximum_links,revision,updated_by_user_id,
     created_at,updated_at)
    VALUES ($1,FALSE,FALSE,12,2000,1,$2,$3,$3)`, [ids.spaceB, ids.owner, at]);
  for (const [definitionId, spaceId] of [...definitionsA.map((value) => [value, ids.spaceA]),
    [ids.defB, ids.spaceB]]) {
    await owner.query(insertDefinition, [definitionId, spaceId, ids.owner, at]);
    await owner.query(insertMapVersion, [`${definitionId}-map`, definitionId, spaceId, ids.owner, at]);
    await owner.query('UPDATE journey_definitions SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
      [`${definitionId}-map`, definitionId, spaceId]);
  }

  // Tenancy: a link is a same-space edge, and the composite definition foreign
  // keys are what make that true rather than the space_id column agreeing with
  // itself. Both endpoints are proven independently.
  await assert.rejects(owner.query(insertLink,
    [id('cross-to'), ids.spaceA, 'related', ids.d1, ids.defB, ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_hierarchy_links_to_definition_fk');
  await assert.rejects(owner.query(insertLink,
    [id('cross-from'), ids.spaceA, 'related', ids.defB, ids.d1, ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_hierarchy_links_from_definition_fk');
  // The kill switch refuses an active link in space B even though both endpoints
  // are legitimately its own.
  await assert.rejects(owner.query(insertLink,
    [id('disabled'), ids.spaceB, 'related', ids.defB, ids.defB, ids.owner, at]),
  (error) => error?.code === '23514' || error?.code === '55000');
  emit('journey_hierarchy_cross_space_guard_passed');

  // Containment chain at the configured ceiling: d1 -> d2 -> d3 is depth 2 and
  // admissible; the fourth link is depth 3 and is not.
  await owner.query(insertLink, [id('link-1-2'), ids.spaceA, 'parent_child', ids.d1, ids.d2, ids.owner, at]);
  await owner.query(insertLink, [id('link-2-3'), ids.spaceA, 'parent_child', ids.d2, ids.d3, ids.owner, at]);
  await assert.rejects(owner.query(insertLink,
    [id('link-3-4'), ids.spaceA, 'parent_child', ids.d3, ids.d4, ids.owner, at]),
  (error) => error?.code === '23514' && /exceeds configured hierarchy depth/u.test(String(error?.message)));
  // Closing the chain is refused by the cycle walk, which runs before the depth
  // walk, so the two failures stay distinguishable.
  await assert.rejects(owner.query(insertLink,
    [id('link-3-1'), ids.spaceA, 'parent_child', ids.d3, ids.d1, ids.owner, at]),
  (error) => error?.code === '23514' && /would create a cycle/u.test(String(error?.message)));
  // A 'related' edge is not containment, so the same closing pair is admissible.
  await owner.query(insertLink, [id('link-3-1-related'), ids.spaceA, 'related', ids.d3, ids.d1, ids.owner, at]);
  // Logical uniqueness is lifecycle-independent and relies on NULLS NOT DISTINCT:
  // every optional key column is NULL for a parent_child pair, so under default
  // NULLS-DISTINCT semantics this duplicate would be accepted.
  await assert.rejects(owner.query(insertLink,
    [id('link-1-2-duplicate'), ids.spaceA, 'parent_child', ids.d1, ids.d2, ids.owner, at]),
  (error) => error?.code === '23505' && error?.constraint === 'journey_hierarchy_links_logical_once');
  emit('journey_hierarchy_cycle_and_depth_guards_passed');

  // Variant tenancy: variant_value_id is free text under the shape CHECK, so only
  // the guard proves it names a term of the right kind in this tenant.
  for (const [termId, spaceId] of [[ids.termA, ids.spaceA], [ids.termB, ids.spaceB]]) {
    await owner.query(`INSERT INTO journey_taxonomy_terms
      (id,space_id,kind,name,normalized_name,parent_term_id,lifecycle,revision,created_by_user_id,
       updated_by_user_id,created_at,updated_at)
      VALUES ($1,$2,'segment','Runtime 29 segment','runtime 29 segment',NULL,'active',1,$3,$3,$4,$4)`,
    [termId, spaceId, ids.owner, at]);
  }
  const insertVariant = `INSERT INTO journey_hierarchy_links
    (id,space_id,link_type,from_definition_id,to_definition_id,variant_dimension,variant_value_id,
     review_state,lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'variant',$3,$4,'segment',$5,'draft','active',1,$6,$6,$7,$7)`;
  await assert.rejects(owner.query(insertVariant,
    [id('variant-foreign'), ids.spaceA, ids.d1, ids.d4, ids.termB, ids.owner, at]),
  (error) => error?.code === '23503' && /same-space taxonomy term/u.test(String(error?.message)));
  await owner.query(insertVariant, [id('variant'), ids.spaceA, ids.d1, ids.d4, ids.termA, ids.owner, at]);
  emit('journey_hierarchy_variant_tenant_guard_passed');

  // Health: 'unknown' is represented by a NULL score and nothing else. The shape
  // CHECK is bidirectional, so both lies are refused -- a scored unknown and an
  // unscored verdict.
  await owner.query(`INSERT INTO journey_hierarchy_health_policies
    (id,space_id,name,lifecycle,configuration_json,configuration_sha256,revision,created_by_user_id,
     updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'Runtime 29 health','active','{}',$3,1,$4,$4,$5,$5)`,
  [ids.healthPolicy, ids.spaceA, hash('health-config'), ids.owner, at]);
  await owner.query(insertSnapshot, [id('snapshot-unknown'), ids.spaceA, ids.d1, ids.healthPolicy,
    hash('health-config'), null, 'unknown', at]);
  await owner.query(insertSnapshot, [id('snapshot-healthy'), ids.spaceA, ids.d1, ids.healthPolicy,
    hash('health-config'), 91.5, 'healthy', at]);
  await assert.rejects(owner.query(insertSnapshot, [id('snapshot-scored-unknown'), ids.spaceA, ids.d1,
    ids.healthPolicy, hash('health-config'), 50, 'unknown', at]),
  (error) => error?.code === '23514'
    && error?.constraint === 'journey_hierarchy_health_snapshots_status_shape');
  await assert.rejects(owner.query(insertSnapshot, [id('snapshot-unscored-healthy'), ids.spaceA, ids.d1,
    ids.healthPolicy, hash('health-config'), null, 'healthy', at]),
  (error) => error?.code === '23514'
    && error?.constraint === 'journey_hierarchy_health_snapshots_status_shape');
  const unknown = (await owner.query(`SELECT score,status FROM journey_hierarchy_health_snapshots
    WHERE id=$1`, [id('snapshot-unknown')])).rows[0];
  assert.equal(unknown.score, null, 'an unknown roll-up must persist without inventing a zero');
  assert.equal(unknown.status, 'unknown');
  emit('journey_hierarchy_health_unknown_score_passed');

  // Blueprint resources and the durable-owner rule: attribution is a users(id)
  // reference and tenancy is asserted at write time, so an outsider is refused
  // by the guard rather than by a membership foreign key.
  for (const [resourceId, kind, ownerUserId] of [[ids.team, 'team', ids.leaver], [ids.actor, 'actor', ids.owner]]) {
    await owner.query(`INSERT INTO journey_blueprint_resources
      (id,space_id,kind,name,description,owner_user_id,lifecycle,revision,created_by_user_id,updated_by_user_id,
       created_at,updated_at)
      VALUES ($1,$2,$3,'Runtime 29 resource','',$4,'active',1,$5,$5,$6,$6)`,
    [resourceId, ids.spaceA, kind, ownerUserId, ids.owner, at]);
  }
  await assert.rejects(owner.query(`INSERT INTO journey_blueprint_resources
    (id,space_id,kind,name,description,owner_user_id,lifecycle,revision,created_by_user_id,updated_by_user_id,
     created_at,updated_at)
    VALUES ($1,$2,'system','Outsider owned','',$3,'active',1,$4,$4,$5,$5)`,
  [id('resource-outsider'), ids.spaceA, ids.outsider, ids.owner, at]),
  (error) => error?.code === '23503' && /is not a member of space/u.test(String(error?.message)));

  // The deferred current-version edge. A blueprint may be created before its
  // first version exists, so the rule is a commit-time invariant; both halves
  // are proven, including the three-column key that binds a version to ITS
  // blueprint rather than to any version in the tenant.
  //
  // Insert-NULL-then-patch is safe HERE and is not safe in runtime 27. This is a
  // deferred FOREIGN KEY: the queued check re-reads the referencing row's key at
  // COMMIT and, under MATCH SIMPLE, a NULL column satisfies it outright, so the
  // INSERT event is a no-op and the UPDATE event carries the real pointer.
  // 0027 guards its equivalent with a deferred CONSTRAINT TRIGGER, which is
  // queued against the tuple version its own statement produced and therefore
  // still sees NULL at COMMIT -- see the pinned defect in the runtime-27 probe.
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Runtime 29 blueprint','draft',$4,NULL,NULL,1,$5,$5,$6,$6)`,
  [ids.blueprint, ids.spaceA, ids.d1, ids.leaver, ids.owner, at]);
  await owner.query(insertBlueprintVersion, [ids.current, ids.blueprint, ids.spaceA, ids.d1, `${ids.d1}-map`,
    1, 'current', hash('current'), ids.owner, at]);
  await owner.query('UPDATE journey_blueprints SET current_version_id=$1 WHERE id=$2 AND space_id=$3',
    [ids.current, ids.blueprint, ids.spaceA]);
  await owner.query('COMMIT');
  await owner.query(insertBlueprintVersion, [ids.future, ids.blueprint, ids.spaceA, ids.d1, `${ids.d1}-map`,
    2, 'future', hash('future'), ids.owner, at]);
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Runtime 29 sibling blueprint','draft',$4,NULL,NULL,1,$5,$5,$6,$6)`,
  [ids.blueprintOther, ids.spaceA, ids.d2, ids.owner, ids.owner, at]);
  await owner.query(insertBlueprintVersion, [ids.otherVersion, ids.blueprintOther, ids.spaceA, ids.d2,
    `${ids.d2}-map`, 1, 'current', hash('other'), ids.owner, at]);
  // A 'future' endpoint on a DIFFERENT journey. The comparison guard is a BEFORE
  // INSERT trigger and therefore runs ahead of the endpoint foreign keys, so a
  // cross-journey negative only reaches the key if the direction is valid first.
  await owner.query(insertBlueprintVersion, [ids.otherFuture, ids.blueprintOther, ids.spaceA, ids.d2,
    `${ids.d2}-map`, 2, 'future', hash('other-future'), ids.owner, at]);
  // A pointer that never materialises must not be able to commit ...
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Dangling blueprint','draft',$4,NULL,$5,1,$4,$4,$6,$6)`,
  [id('blueprint-dangling'), ids.spaceA, ids.d3, ids.owner, id('bpv-never-created'), at]);
  await assert.rejects(owner.query('COMMIT'), (error) => error?.code === '23503');
  await owner.query('ROLLBACK');
  // ... and neither must a pointer at a version belonging to another blueprint.
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Stolen version blueprint','draft',$4,NULL,$5,1,$4,$4,$6,$6)`,
  [id('blueprint-stolen'), ids.spaceA, ids.d3, ids.owner, ids.otherVersion, at]);
  await assert.rejects(owner.query('COMMIT'), (error) => error?.code === '23503');
  await owner.query('ROLLBACK');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_blueprints
    WHERE id IN ($1,$2)`, [id('blueprint-dangling'), id('blueprint-stolen')])).rows[0].count), 0);
  // The blueprint kill switch is enforced on the version, not the root.
  await owner.query(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,$3,'Disabled tenant blueprint','draft',NULL,NULL,NULL,1,$4,$4,$5,$5)`,
  [ids.blueprintB, ids.spaceB, ids.defB, ids.owner, at]);
  await assert.rejects(owner.query(insertBlueprintVersion, [id('bpv-disabled'), ids.blueprintB, ids.spaceB,
    ids.defB, `${ids.defB}-map`, 1, 'current', hash('disabled'), ids.owner, at]),
  (error) => error?.code === '55000' && /disabled for this space/u.test(String(error?.message)));
  emit('journey_blueprint_current_version_invariant_passed');

  // Blueprint content, and the element-resource kind guard that keeps an 'actor'
  // slot from pointing at a team.
  for (const versionId of [ids.current, ids.future]) {
    await owner.query(`INSERT INTO journey_blueprint_stages(version_id,space_id,stage_key,name,ordinal)
      VALUES ($1,$2,'onboard','Onboard',0)`, [versionId, ids.spaceA]);
  }
  const insertElement = `INSERT INTO journey_blueprint_elements
    (id,version_id,space_id,stage_key,lane,kind,title,description,owner_team_resource_id,actor_resource_id,
     ordinal,evidence_refs_json,metric_refs_json)
    VALUES ($1,$2,$3,'onboard',$4,$5,$6,'',$7,NULL,$8,'[]','[]')`;
  await owner.query(insertElement, [ids.backstage, ids.current, ids.spaceA, 'backstage', 'process',
    'Manual verification step', ids.team, 0]);
  await owner.query(insertElement, [ids.customer, ids.current, ids.spaceA, 'customer', 'action',
    'Customer submits documents', null, 0]);
  await assert.rejects(owner.query(`INSERT INTO journey_blueprint_elements
    (id,version_id,space_id,stage_key,lane,kind,title,description,actor_resource_id,ordinal,
     evidence_refs_json,metric_refs_json)
    VALUES ($1,$2,$3,'onboard','frontstage','action','Wrong resource kind','',$4,1,'[]','[]')`,
  [id('element-wrong-kind'), ids.current, ids.spaceA, ids.team]),
  (error) => error?.code === '23514' && /actor must reference an active actor resource/u.test(String(error?.message)));
  await owner.query(`INSERT INTO journey_blueprint_relationships
    (id,version_id,space_id,kind,from_element_id,to_element_id,label)
    VALUES ($1,$2,$3,'supports',$4,$5,'Verification supports submission')`,
  [id('relationship'), ids.current, ids.spaceA, ids.backstage, ids.customer]);
  await assert.rejects(owner.query(`INSERT INTO journey_blueprint_relationships
    (id,version_id,space_id,kind,from_element_id,to_element_id,label)
    VALUES ($1,$2,$3,'supports',$4,$4,'')`,
  [id('relationship-self'), ids.current, ids.spaceA, ids.backstage]),
  (error) => error?.code === '23514' && error?.constraint === 'journey_blueprint_relationships_no_self');

  // Comparison direction: current -> future only. The declarative endpoints
  // cannot read blueprint_state, so only the trigger enforces the direction.
  await assert.rejects(owner.query(insertComparison, [id('comparison-reversed'), ids.spaceA, ids.d1,
    ids.future, ids.current, hash('reversed'), ids.owner, at]),
  (error) => error?.code === '23514' && /from a current version to a future version/u.test(String(error?.message)));
  // Both endpoints must belong to the ONE journey the comparison names. The
  // direction is valid here, so this reaches the three-column endpoint key.
  await assert.rejects(owner.query(insertComparison, [id('comparison-cross-journey'), ids.spaceA, ids.d1,
    ids.current, ids.otherFuture, hash('cross'), ids.owner, at]),
  (error) => error?.code === '23503' && error?.constraint === 'journey_blueprint_comparisons_to_fk');
  await owner.query(insertComparison, [id('comparison'), ids.spaceA, ids.d1, ids.current, ids.future,
    hash('comparison'), ids.owner, at]);
  emit('journey_blueprint_comparison_direction_passed');

  // Typed causality across runtime 27 and 29. The link pins an exact portfolio
  // item revision, so this edge is the one place the two runtimes are proven to
  // interoperate rather than merely coexist.
  await owner.query(`INSERT INTO journey_portfolio_settings
    (space_id,enabled,retention_days,approval_required,default_scoring_policy_id,revision,updated_by_user_id,
     created_at,updated_at)
    VALUES ($1,TRUE,30,TRUE,NULL,1,$2,$3,$3)`, [ids.spaceA, ids.owner, at]);
  await owner.query(`INSERT INTO journey_portfolio_items
    (id,space_id,kind,title,description,lifecycle,owner_user_id,severity,frequency,state,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'pain_point','Verification backlog','Runtime 29 executed proof','validated',$3,4,'frequent',
      'active',1,$3,$3,$4,$4)`, [ids.painPoint, ids.spaceA, ids.owner, at]);
  await owner.query(`INSERT INTO journey_portfolio_items
    (id,space_id,kind,title,description,lifecycle,owner_user_id,hypothesis,risk,state,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'solution','Automate verification','Runtime 29 executed proof','validated',$3,
      'Automation clears the backlog','low','active',1,$3,$3,$4,$4)`, [ids.solution, ids.spaceA, ids.owner, at]);
  for (const itemId of [ids.painPoint, ids.solution]) {
    await owner.query(`INSERT INTO journey_portfolio_item_versions
      (id,item_id,space_id,revision,schema_version,snapshot_json,snapshot_sha256,change_reason,actor_user_id,created_at)
      VALUES ($1,$2,$3,1,1,'{}',$4,'initial',$5,$6)`,
    [`${itemId}-v1`, itemId, ids.spaceA, hash(itemId), ids.owner, at]);
  }
  // A relationship that does not accept the item's kind.
  await assert.rejects(owner.query(insertPortfolioLink, [id('link-mitigated-pain'), ids.spaceA, ids.current,
    ids.backstage, ids.painPoint, 'mitigated_by', ids.owner, at]),
  (error) => error?.code === '23514' && /does not accept this portfolio item kind/u.test(String(error?.message)));
  // A customer-lane element cannot be the declared cause of a pain point.
  await assert.rejects(owner.query(insertPortfolioLink, [id('link-customer-cause'), ids.spaceA, ids.current,
    ids.customer, ids.painPoint, 'causes', ids.owner, at]),
  (error) => error?.code === '23514' && /customer-lane element cannot be the declared cause/u.test(String(error?.message)));
  // The valid triples.
  await owner.query(insertPortfolioLink, [id('link-cause'), ids.spaceA, ids.current, ids.backstage,
    ids.painPoint, 'causes', ids.owner, at]);
  await owner.query(insertPortfolioLink, [id('link-mitigation'), ids.spaceA, ids.current, ids.backstage,
    ids.solution, 'mitigated_by', ids.owner, at]);
  // A wrong revision cannot be pinned, and a soft-deleted item cannot be linked
  // at all -- the guard reads state='active', which no foreign key can express.
  //
  // The edge below is deliberately (customer, affected_by): the uniqueness key
  // is (space, version, element, item, relationship) and is enforced during
  // insertion, ahead of the foreign key, so reusing the already-linked
  // (backstage, causes) pair would fail with 23505 and never reach the revision.
  await assert.rejects(owner.query(`INSERT INTO journey_blueprint_portfolio_links
    (id,space_id,blueprint_version_id,element_id,portfolio_item_id,portfolio_item_revision,relationship,
     created_by_user_id,created_at)
    VALUES ($1,$2,$3,$4,$5,7,'affected_by',$6,$7)`,
  [id('link-wrong-revision'), ids.spaceA, ids.current, ids.customer, ids.painPoint, ids.owner, at]),
  (error) => error?.code === '23503'
    && error?.constraint === 'journey_blueprint_portfolio_links_item_version_fk');
  await owner.query(`UPDATE journey_portfolio_items SET state='deleted',deleted_at=$1,retention_expires_at=$2
    WHERE id=$3 AND space_id=$4`, [later, '2026-09-05T16:00:00.000Z', ids.solution, ids.spaceA]);
  await assert.rejects(owner.query(insertPortfolioLink, [id('link-deleted-item'), ids.spaceA, ids.current,
    ids.backstage, ids.solution, 'improved_by', ids.owner, at]),
  (error) => error?.code === '23503' && /live same-space portfolio item/u.test(String(error?.message)));
  emit('journey_blueprint_portfolio_causality_passed');

  // Offboarding, runtime-29 half. The leaver owns a blueprint and a team
  // resource; before the fix each composite membership foreign key made this
  // DELETE fail with 23503.
  await owner.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2', [ids.spaceA, ids.leaver]);
  const surviving = await owner.query(`SELECT
      (SELECT owner_user_id FROM journey_blueprints WHERE id=$1) blueprint_owner,
      (SELECT owner_user_id FROM journey_blueprint_resources WHERE id=$2) resource_owner,
      (SELECT COUNT(*)::int FROM space_memberships WHERE space_id=$3 AND user_id=$4) membership`,
  [ids.blueprint, ids.team, ids.spaceA, ids.leaver]);
  assert.deepEqual(surviving.rows[0], { blueprint_owner: ids.leaver, resource_owner: ids.leaver, membership: 0 },
    'offboarding must succeed and leave every attributed row unchanged');
  await assert.rejects(owner.query('DELETE FROM users WHERE id=$1', [ids.leaver]),
    (error) => error?.code === '23503');
  // A former member cannot take ownership again without rejoining.
  await assert.rejects(owner.query(`INSERT INTO journey_blueprint_resources
    (id,space_id,kind,name,description,owner_user_id,lifecycle,revision,created_by_user_id,updated_by_user_id,
     created_at,updated_at)
    VALUES ($1,$2,'system','After leaving','',$3,'active',1,$4,$4,$5,$5)`,
  [id('resource-after-leaving'), ids.spaceA, ids.leaver, ids.owner, later]),
  (error) => error?.code === '23503' && /is not a member of space/u.test(String(error?.message)));
  emit('journey_hierarchy_member_offboarding_passed');

  // The FOR SHARE in journey_hierarchy_membership_guard is what makes it an
  // invariant rather than advice: a bare EXISTS under READ COMMITTED could be
  // satisfied by a membership row a concurrent transaction is already deleting.
  // The reviewing write must block on the offboarding and then fail.
  await left.query('BEGIN');
  await left.query('DELETE FROM space_memberships WHERE space_id=$1 AND user_id=$2', [ids.spaceA, ids.racer]);
  let reviewSettled = false;
  const racingReview = right.query(`INSERT INTO journey_hierarchy_links
    (id,space_id,link_type,from_definition_id,to_definition_id,review_state,reviewed_by_user_id,reviewed_at,
     lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES ($1,$2,'related',$3,$4,'approved',$5,$6,'active',1,$7,$7,$6,$6)`,
  [id('link-raced'), ids.spaceA, ids.d2, ids.d4, ids.racer, later, ids.owner])
    .then(() => 'committed', (error) => error).finally(() => { reviewSettled = true; });
  await delay(150);
  assert.equal(reviewSettled, false, 'the membership guard must block behind the concurrent offboarding');
  await left.query('COMMIT');
  const raced = await racingReview;
  assert.notEqual(raced, 'committed', 'a reviewer offboarded mid-write must not be recorded as a member');
  assert.equal(raced?.code, '23503');
  assert.equal(Number((await owner.query(`SELECT COUNT(*)::int count FROM journey_hierarchy_links
    WHERE id=$1`, [id('link-raced')])).rows[0].count), 0);
  emit('journey_hierarchy_membership_race_passed');

  // Replay receipts and the append-only seals, against both roles.
  const replayKey = `replay-${proof}`;
  await owner.query(`INSERT INTO journey_hierarchy_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'hierarchy.link.create',$5,'{"replayed":false}',$6)`,
  [id('operation'), ids.spaceA, ids.owner, replayKey, hash('intent'), at]);
  await assert.rejects(owner.query(`INSERT INTO journey_hierarchy_operations
    (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
    VALUES ($1,$2,$3,$4,'hierarchy.link.create',$5,'{}',$6)`,
  [id('operation-duplicate'), ids.spaceA, ids.owner, replayKey, hash('intent'), at]),
  (error) => error?.code === '23505' && error?.constraint === 'journey_hierarchy_operations_idempotency');
  await owner.query(`INSERT INTO journey_hierarchy_activity
    (id,space_id,actor_user_id,action,target_kind,target_id,target_revision,detail_json,created_at)
    VALUES ($1,$2,$3,'hierarchy.link.created','hierarchy_link',$4,1,'{}',$5)`,
  [id('activity'), ids.spaceA, ids.owner, id('link-1-2'), at]);
  // Content tables are sealed against UPDATE so a frozen version's snapshot hash
  // cannot silently stop matching; the ledgers are sealed against DELETE too.
  for (const table of ['journey_hierarchy_health_snapshots', 'journey_blueprint_versions',
    'journey_blueprint_stages', 'journey_blueprint_elements', 'journey_blueprint_relationships',
    'journey_blueprint_comparisons', 'journey_hierarchy_operations', 'journey_hierarchy_activity']) {
    await assert.rejects(owner.query(`UPDATE ${table} SET space_id=space_id WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '55000');
    await assert.rejects(app.query(`UPDATE ${table} SET space_id=space_id WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
    await assert.rejects(app.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
  }
  for (const table of ['journey_hierarchy_operations', 'journey_hierarchy_activity']) {
    await assert.rejects(owner.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '55000');
  }
  // Parents whose ON DELETE CASCADE would reach a BEFORE UPDATE-only seal.
  for (const table of ['journey_hierarchy_settings', 'journey_hierarchy_health_policies', 'journey_blueprints']) {
    await assert.rejects(app.query(`DELETE FROM ${table} WHERE space_id=$1`, [ids.spaceA]),
      (error) => error?.code === '42501');
  }
  emit('journey_hierarchy_append_only_and_idempotency_passed');
} finally {
  await Promise.allSettled([owner.query('ROLLBACK'), left.query('ROLLBACK'), right.query('ROLLBACK')]);
  // Deterministic teardown. Failures are collected and reported rather than
  // swallowed: a probe that cannot prove its own cleanup changes what every
  // later probe in this database observes.
  const failures = [];
  for (const spaceId of [ids.spaceA, ids.spaceB]) {
    for (const statement of teardown) {
      const result = await owner.query(statement, [spaceId]).then(() => null, (error) => error);
      if (result) failures.push(`${statement} [${spaceId}]: ${result.code || ''} ${result.message}`);
    }
  }
  // spaces and users are deliberately retained. journey_hierarchy_operations and
  // journey_hierarchy_activity cascade from spaces(id) and are sealed BEFORE
  // DELETE, so DELETE FROM spaces raises 55000 by design -- there is no ordering
  // that removes the space without erasing an append-only ledger. The disposable
  // database is dropped by the harness; what matters here is that the residue is
  // exactly the sealed ledger and nothing else.
  const sealed = await owner.query(`SELECT
      (SELECT COUNT(*)::int FROM journey_hierarchy_operations WHERE space_id=$1) operations,
      (SELECT COUNT(*)::int FROM journey_hierarchy_activity WHERE space_id=$1) activity`, [ids.spaceA])
    .then((result) => result.rows[0], (error) => { failures.push(`sealed count: ${error.message}`); return null; });
  const residue = await owner.query(`SELECT ${residueTables
    .map((table, index) => `(SELECT COUNT(*)::int FROM ${table} WHERE space_id IN ($1,$2)) t${index}`)
    .join(',')}`, [ids.spaceA, ids.spaceB])
    .then((result) => Object.values(result.rows[0]).reduce((total, value) => total + Number(value), 0),
      (error) => { failures.push(`residue count: ${error.message}`); return -1; });
  emit('journey_hierarchy_cleanup_complete', {
    deletableResidue: residue, sealedRetained: sealed, failures
  });
  await Promise.allSettled([owner.end(), app.end(), left.end(), right.end()]);
  assert.deepEqual(failures, [], 'runtime-29 teardown must not fail silently');
  assert.equal(residue, 0, 'runtime-29 teardown must leave no deletable fixture row behind');
}
