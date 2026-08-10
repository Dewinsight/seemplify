import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-hierarchy-routes-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Hierarchy-Routes-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-hierarchy-routes-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-hierarchy-routes-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 93).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 94).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-hierarchy-routes@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile, EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function ownerIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-hierarchy-routes@seemplify.local', password: 'Journey-Hierarchy-Routes-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

let memberSequence = 0;
async function memberIdentity(spaceId: string) {
  memberSequence += 1;
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Hierarchy member', email: `hierarchy-routes-member-${memberSequence}@example.test`,
    password: 'Hierarchy-Member-Routes-Password-2026!', spaceName: 'Hierarchy member home'
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)`)
    .run(spaceId, userId, 'member', at, at);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId, homeSpaceId };
}

function inSpace(agent: ReturnType<typeof request.agent>, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, spaceId: string) {
  return agent[method](url).set('X-Seemplify-Space', spaceId);
}

function createMap(spaceId: string, userId: string, name: string, stages = ['Start']) {
  return maps.createJourneyMap(spaceId, userId, { name, purpose: `${name} hierarchy route proof`, stageNames: stages });
}

test('hierarchy routes expose shared subjourneys, breadcrumbs, traversal and manager-only writes', async () => {
  const owner = await ownerIdentity();
  const member = await memberIdentity(owner.spaceId);
  const macro = createMap(owner.spaceId, owner.userId, 'Enterprise onboarding', ['Signup', 'Verification', 'Implementation']);
  const signup = createMap(owner.spaceId, owner.userId, 'Signup');
  const verification = createMap(owner.spaceId, owner.userId, 'Verification');
  const support = createMap(owner.spaceId, owner.userId, 'Support');
  const verificationStage = db.prepare(`SELECT stage_key FROM journey_map_stages
    WHERE version_id=? AND name='Verification'`).get(macro.currentVersionId) as { stage_key: string };

  const parentSignup = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: macro.id, toDefinitionId: signup.id
  }).expect(201);
  assert.equal(parentSignup.body.link.reviewState, 'draft');

  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'stage_subjourney', fromDefinitionId: macro.id, toDefinitionId: verification.id,
    fromStageKey: verificationStage.stage_key
  }).expect(201);
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: support.id, toDefinitionId: verification.id
  }).expect(201);

  const listed = await inSpace(member.agent, 'get', '/api/journey-hierarchy', owner.spaceId).expect(200);
  assert.ok(listed.body.nodes.some((node: any) => node.definitionId === verification.id));
  assert.equal(listed.body.validation.maximumDepth, 1);

  const breadcrumbs = await inSpace(member.agent, 'get', `/api/journey-hierarchy/breadcrumbs/${verification.id}`, owner.spaceId)
    .expect(200);
  assert.equal(breadcrumbs.body.breadcrumbs.trails.length, 2);
  assert.deepEqual(breadcrumbs.body.breadcrumbs.trails.map((trail: any) => trail.definitionIds[1]).sort(), [verification.id, verification.id]);

  const traversal = await inSpace(member.agent, 'get', `/api/journey-hierarchy/traversal/${macro.id}`, owner.spaceId)
    .query({ direction: 'downstream' }).expect(200);
  assert.deepEqual(traversal.body.traversal.definitionIds.sort(), [macro.id, signup.id, verification.id].sort());

  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/taxonomy', owner.spaceId)
    .send({ kind: 'tag', name: '=Priority hierarchy' }).expect(201);
  await inSpace(member.agent, 'get', '/api/journey-hierarchy/export.json', owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_CAPABILITY_REQUIRED'));
  const jsonExport = await inSpace(owner.agent, 'get', '/api/journey-hierarchy/export.json', owner.spaceId)
    .set('X-Request-Id', 'hierarchy-json-export').expect(200).expect('Content-Type', /application\/json/u);
  assert.equal(jsonExport.body.schemaVersion, 'journey-hierarchy-export/v1');
  assert.ok(jsonExport.body.hierarchy.nodes.some((node: any) => node.definitionId === macro.id));
  assert.ok(jsonExport.body.hierarchy.links.some((link: any) => link.toDefinitionId === verification.id));
  assert.ok(jsonExport.body.taxonomy.some((term: any) => term.name === '=Priority hierarchy'));
  assert.match(String(jsonExport.headers['x-content-sha256']), /^[a-f0-9]{64}$/u);
  const csvExport = await inSpace(owner.agent, 'get', '/api/journey-hierarchy/export.csv', owner.spaceId)
    .set('X-Request-Id', 'hierarchy-csv-export').expect(200).expect('Content-Type', /text\/csv/u);
  assert.match(csvExport.text, /^"record_type","definition_id","record_id"/u);
  assert.match(csvExport.text, /'=Priority hierarchy/u);
  const exportAudit = db.prepare(`SELECT action,target_type,detail_json FROM journey_collaboration_audit_events
    WHERE space_id=? AND action='hierarchy.export' ORDER BY created_at,id`).all(owner.spaceId) as any[];
  assert.equal(exportAudit.length, 2);
  assert.ok(exportAudit.every((row) => row.target_type === 'journey_hierarchy'));
  assert.doesNotMatch(JSON.stringify(exportAudit), /Priority hierarchy/u);

  await inSpace(member.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: signup.id, toDefinitionId: support.id
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_MANAGE_REQUIRED'));

  const approved = await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/links/${parentSignup.body.link.id}`, owner.spaceId)
    .send({ expectedRevision: 1, reviewState: 'approved' }).expect(200);
  assert.equal(approved.body.link.revision, 2);
  assert.equal(approved.body.link.reviewedByUserId, owner.userId);

  const foreign = createMap(member.homeSpaceId, member.userId, 'Foreign hierarchy journey');
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: macro.id, toDefinitionId: foreign.id
  }).expect(404).expect(({ body }) => {
    assert.equal(body.code, 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
    assert.doesNotMatch(JSON.stringify(body), /Foreign hierarchy journey/u);
  });
});

test('hierarchy routes reject cycles and support governed taxonomy assignment', async () => {
  const owner = await ownerIdentity();
  const parent = createMap(owner.spaceId, owner.userId, 'Taxonomy parent');
  const child = createMap(owner.spaceId, owner.userId, 'Taxonomy child');

  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: parent.id, toDefinitionId: child.id
  }).expect(201);
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: child.id, toDefinitionId: parent.id
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_CYCLE'));

  const product = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/taxonomy', owner.spaceId).send({
    kind: 'product', name: 'Experience Cloud'
  }).expect(201);
  await inSpace(owner.agent, 'put', `/api/journey-hierarchy/journeys/${parent.id}/taxonomy/${product.body.term.id}`, owner.spaceId)
    .send({}).expect(200);

  const listed = await inSpace(owner.agent, 'get', '/api/journey-hierarchy', owner.spaceId).expect(200);
  const node = listed.body.nodes.find((entry: any) => entry.definitionId === parent.id);
  assert.deepEqual(node.taxonomyTermIds, [product.body.term.id]);

  await inSpace(owner.agent, 'delete', `/api/journey-hierarchy/journeys/${parent.id}/taxonomy/${product.body.term.id}`, owner.spaceId)
    .send({}).expect(200);
  const afterRemoval = await inSpace(owner.agent, 'get', '/api/journey-hierarchy', owner.spaceId).expect(200);
  assert.deepEqual(afterRemoval.body.nodes.find((entry: any) => entry.definitionId === parent.id).taxonomyTermIds, []);
});

test('hierarchy settings are revisioned, manager governed, and disable hierarchy writes', async () => {
  const owner = await ownerIdentity();
  const member = await memberIdentity(owner.spaceId);
  const initial = await inSpace(member.agent, 'get', '/api/journey-hierarchy/settings', owner.spaceId).expect(200);
  assert.equal(initial.body.settings.revision, 0);
  assert.equal(initial.body.settings.hierarchyEnabled, true);

  await inSpace(member.agent, 'patch', '/api/journey-hierarchy/settings', owner.spaceId)
    .send({ expectedRevision: 0, hierarchyEnabled: false }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_MANAGE_REQUIRED'));
  const disabled = await inSpace(owner.agent, 'patch', '/api/journey-hierarchy/settings', owner.spaceId)
    .send({ expectedRevision: 0, hierarchyEnabled: false, maximumDepth: 8, maximumLinks: 100 }).expect(200);
  assert.equal(disabled.body.settings.revision, 1);
  assert.equal(disabled.body.settings.enabled, false);

  await inSpace(owner.agent, 'patch', '/api/journey-hierarchy/settings', owner.spaceId)
    .send({ expectedRevision: 0, hierarchyEnabled: true }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_SETTINGS_REVISION_CONFLICT'));
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/taxonomy', owner.spaceId)
    .send({ kind: 'tag', name: 'Disabled tag' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_DISABLED'));
  const disabledParent = createMap(owner.spaceId, owner.userId, 'Disabled hierarchy parent');
  const disabledChild = createMap(owner.spaceId, owner.userId, 'Disabled hierarchy child');
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: disabledParent.id, toDefinitionId: disabledChild.id
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'JOURNEY_HIERARCHY_DISABLED'));

  const enabled = await inSpace(owner.agent, 'patch', '/api/journey-hierarchy/settings', owner.spaceId)
    .send({ expectedRevision: 1, hierarchyEnabled: true }).expect(200);
  assert.equal(enabled.body.settings.revision, 2);
});

test('taxonomy correction and retirement enforce revisions, active children, and assignments', async () => {
  const owner = await ownerIdentity();
  const map = createMap(owner.spaceId, owner.userId, 'Taxonomy retirement journey');
  const parent = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/taxonomy', owner.spaceId)
    .send({ kind: 'product', name: 'Core suite' }).expect(201);
  const child = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/taxonomy', owner.spaceId)
    .send({ kind: 'product', name: 'Core suite mobile', parentTermId: parent.body.term.id }).expect(201);

  await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'retired' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_TAXONOMY_ACTIVE_CHILDREN'));
  const retiredChild = await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/taxonomy/${child.body.term.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'retired' }).expect(200);
  assert.equal(retiredChild.body.term.revision, 2);

  await inSpace(owner.agent, 'put', `/api/journey-hierarchy/journeys/${map.id}/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({}).expect(200);
  await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'retired' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_TAXONOMY_ASSIGNED'));
  await inSpace(owner.agent, 'delete', `/api/journey-hierarchy/journeys/${map.id}/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({}).expect(200);
  const corrected = await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({ expectedRevision: 1, name: 'Core platform', lifecycle: 'retired' }).expect(200);
  assert.equal(corrected.body.term.name, 'Core platform');
  assert.equal(corrected.body.term.revision, 2);
  await inSpace(owner.agent, 'patch', `/api/journey-hierarchy/taxonomy/${parent.body.term.id}`, owner.spaceId)
    .send({ expectedRevision: 1, name: 'Stale correction' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_TAXONOMY_REVISION_CONFLICT'));
});

test('health snapshots persist exact rules, explicit unknown children, and shared-child lineage once', async () => {
  const owner = await ownerIdentity();
  const rootMap = createMap(owner.spaceId, owner.userId, 'Health root');
  const left = createMap(owner.spaceId, owner.userId, 'Health left');
  const right = createMap(owner.spaceId, owner.userId, 'Health right');
  const shared = createMap(owner.spaceId, owner.userId, 'Health shared child');
  for (const [fromDefinitionId, toDefinitionId] of [
    [rootMap.id, left.id], [rootMap.id, right.id], [left.id, shared.id], [right.id, shared.id]
  ]) await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId)
    .send({ type: 'parent_child', fromDefinitionId, toDefinitionId }).expect(201);

  const policy = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/health/policies', owner.spaceId).send({
    id: 'strict-health-policy', name: 'Strict child health', policy: {
      version: 'strict-v1', ownWeight: 0.5, missingChild: 'unknown', healthyAt: 80, watchAt: 60
    }
  }).expect(201);
  const observedAt = new Date().toISOString();
  const calculated = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/health/snapshots', owner.spaceId).send({
    policyId: policy.body.policy.id,
    observations: [{ definitionId: shared.id, score: 82, observedAt, sourceRevision: 'shared-rev-7' }]
  }).expect(201);
  const byDefinition = new Map(calculated.body.snapshots.map((snapshot: any) => [snapshot.definitionId, snapshot]));
  const rootSnapshot: any = byDefinition.get(rootMap.id);
  assert.equal(rootSnapshot.score, 82);
  assert.equal(rootSnapshot.children.length, 2);
  assert.deepEqual(rootSnapshot.childLineage, [`${shared.id}@shared-rev-7`]);
  assert.deepEqual(rootSnapshot.policy.rules, {
    version: 'strict-v1', ownWeight: 0.5, missingChild: 'unknown', healthyAt: 80, watchAt: 60
  });

  const missing = createMap(owner.spaceId, owner.userId, 'Health missing child');
  await inSpace(owner.agent, 'post', '/api/journey-hierarchy/links', owner.spaceId).send({
    type: 'parent_child', fromDefinitionId: rootMap.id, toDefinitionId: missing.id
  }).expect(201);
  const strict = await inSpace(owner.agent, 'post', '/api/journey-hierarchy/health/snapshots', owner.spaceId).send({
    policyId: policy.body.policy.id, definitionId: rootMap.id,
    observations: [{ definitionId: shared.id, score: 82, observedAt, sourceRevision: 'shared-rev-8' }]
  }).expect(201);
  assert.equal(strict.body.snapshots[0].score, null);
  assert.equal(strict.body.snapshots[0].status, 'unknown');
  assert.equal(strict.body.snapshots[0].children.find((entry: any) => entry.definitionId === missing.id).score, null);

  const read = await inSpace(owner.agent, 'get',
    `/api/journey-hierarchy/health/snapshots/${strict.body.snapshots[0].id}`, owner.spaceId).expect(200);
  assert.equal(read.body.snapshot.policy.revision, 1);
  assert.equal(read.body.snapshot.status, 'unknown');
  const listed = await inSpace(owner.agent, 'get', '/api/journey-hierarchy/health/snapshots', owner.spaceId)
    .query({ definitionId: rootMap.id }).expect(200);
  assert.ok(listed.body.snapshots.length >= 2);
});
