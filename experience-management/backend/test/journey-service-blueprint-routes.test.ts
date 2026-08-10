import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-blueprint-routes-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Blueprint-Routes-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-blueprint-routes-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-blueprint-routes-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 73).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 74).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-blueprint-routes@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
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
    email: 'journey-blueprint-routes@seemplify.local', password: 'Journey-Blueprint-Routes-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

let memberSequence = 0;
async function memberIdentity(spaceId: string) {
  memberSequence += 1;
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Blueprint member', email: `blueprint-routes-member-${memberSequence}@example.test`,
    password: 'Blueprint-Member-Routes-Password-2026!', spaceName: 'Blueprint member home'
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id); const homeSpaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)')
    .run(spaceId, userId, 'member', now, now);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId, homeSpaceId };
}

function inSpace(agent: ReturnType<typeof request.agent>, method: 'get' | 'post' | 'patch', url: string, spaceId: string) {
  return agent[method](url).set('X-Seemplify-Space', spaceId);
}

test('service blueprint routes enforce authentication, entitlement, tenancy and manager-only mutations', async () => {
  await request(app).get('/api/journey-blueprints').expect(401);
  const owner = await ownerIdentity();
  const member = await memberIdentity(owner.spaceId);
  const map = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Enterprise onboarding blueprint', purpose: 'Blueprint route proof', stageNames: ['Verify']
  });

  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  await inSpace(owner.agent, 'get', '/api/journey-blueprints', owner.spaceId).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);

  await inSpace(member.agent, 'post', '/api/journey-blueprints', owner.spaceId).send({
    journeyDefinitionId: map.id, name: 'Member write denied'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_BLUEPRINT_MANAGE_REQUIRED'));

  const created = await inSpace(owner.agent, 'post', '/api/journey-blueprints', owner.spaceId).send({
    journeyDefinitionId: map.id, name: 'Enterprise onboarding service blueprint'
  }).expect(201);
  assert.equal(created.body.blueprint.revision, 1);

  const memberList = await inSpace(member.agent, 'get', '/api/journey-blueprints', owner.spaceId).expect(200);
  assert.equal(memberList.body.blueprints[0].id, created.body.blueprint.id);

  const updated = await inSpace(owner.agent, 'patch', `/api/journey-blueprints/${created.body.blueprint.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'in_review' }).expect(200);
  assert.equal(updated.body.blueprint.revision, 2);
  await inSpace(owner.agent, 'patch', `/api/journey-blueprints/${created.body.blueprint.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'approved' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_BLUEPRINT_REVISION_CONFLICT'));
});

test('service blueprint routes persist resources, full versions, analysis, review, gaps and current/future comparison', async () => {
  const owner = await ownerIdentity();
  const member = await memberIdentity(owner.spaceId);
  const map = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Verification operations', purpose: 'Blueprint aggregate proof', stageNames: ['Verify']
  });
  const stage = db.prepare('SELECT stage_key,name FROM journey_map_stages WHERE version_id=? ORDER BY ordinal LIMIT 1')
    .get(map.currentVersionId) as { stage_key: string; name: string };

  const team = await inSpace(owner.agent, 'post', '/api/journey-blueprints/resources/catalogue', owner.spaceId).send({
    kind: 'team', name: 'Verification operations'
  }).expect(201);
  const system = await inSpace(owner.agent, 'post', '/api/journey-blueprints/resources/catalogue', owner.spaceId).send({
    kind: 'system', name: 'Identity verification service'
  }).expect(201);
  await inSpace(member.agent, 'post', '/api/journey-blueprints/resources/catalogue', owner.spaceId).send({
    kind: 'team', name: 'Member-created team'
  }).expect(403);

  const blueprint = await inSpace(owner.agent, 'post', '/api/journey-blueprints', owner.spaceId).send({
    journeyDefinitionId: map.id, name: 'Verification service blueprint'
  }).expect(201);
  const base = {
    journeyVersionId: map.currentVersionId,
    stages: [{ stageKey: stage.stage_key, name: stage.name, ordinal: 0 }],
    elements: [
      { id: 'customer-submit', stageKey: stage.stage_key, lane: 'customer', kind: 'action',
        title: '=Submit verification details', ordinal: 0 },
      { id: 'agent-review', stageKey: stage.stage_key, lane: 'frontstage', kind: 'action',
        title: 'Review identity', ownerTeamId: team.body.resource.id, ordinal: 0 },
      { id: 'verification-process', stageKey: stage.stage_key, lane: 'backstage', kind: 'process',
        title: 'Run verification checks', ownerTeamId: team.body.resource.id, systemId: system.body.resource.id,
        slaMinutes: 30, riskProbability: 0.2, riskImpact: 0.8, ordinal: 0 },
      { id: 'verification-system', stageKey: stage.stage_key, lane: 'supporting_system', kind: 'system',
        title: 'Validate identity', systemId: system.body.resource.id, ordinal: 0 }
    ],
    relationships: [
      { id: 'review-depends-process', kind: 'depends_on', fromElementId: 'agent-review', toElementId: 'verification-process' },
      { id: 'process-depends-system', kind: 'depends_on', fromElementId: 'verification-process', toElementId: 'verification-system' }
    ]
  };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO journey_hierarchy_settings
    (space_id,hierarchy_enabled,blueprints_enabled,maximum_depth,maximum_links,revision,updated_by_user_id,created_at,updated_at)
    VALUES (?,1,0,12,2000,1,?,?,?)`).run(owner.spaceId, owner.userId, now, now);
  await inSpace(owner.agent, 'post', `/api/journey-blueprints/${blueprint.body.blueprint.id}/versions`, owner.spaceId)
    .send({ ...base, state: 'current' }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_BLUEPRINTS_DISABLED'));
  db.prepare('UPDATE journey_hierarchy_settings SET blueprints_enabled=1 WHERE space_id=?').run(owner.spaceId);
  const current = await inSpace(owner.agent, 'post', `/api/journey-blueprints/${blueprint.body.blueprint.id}/versions`, owner.spaceId)
    .send({ ...base, state: 'current', changeReason: 'Document the current operation' })
    .expect(201);
  assert.equal(current.body.version.versionNumber, 1);
  assert.equal(current.body.analysis.valid, true);
  assert.equal(current.body.analysis.resourceValidation.enforced, true);
  assert.ok(current.body.version.gaps.length > 0, 'analysis warnings must be persisted as reviewable gaps');

  const readByMember = await inSpace(member.agent, 'get', `/api/journey-blueprints/versions/${current.body.version.versionId}`, owner.spaceId)
    .expect(200);
  assert.equal(readByMember.body.version.elements.length, 4);
  const analysis = await inSpace(member.agent, 'get', `/api/journey-blueprints/versions/${current.body.version.versionId}/analysis`, owner.spaceId)
    .expect(200);
  assert.equal(analysis.body.analysis.valid, true);

  await inSpace(member.agent, 'get',
    `/api/journey-blueprints/versions/${current.body.version.versionId}/export.json`, owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_CAPABILITY_REQUIRED'));
  const jsonExport = await inSpace(owner.agent, 'get',
    `/api/journey-blueprints/versions/${current.body.version.versionId}/export.json`, owner.spaceId)
    .set('X-Request-Id', 'blueprint-export-json').expect(200).expect('Content-Type', /application\/json/u);
  assert.equal(jsonExport.body.schemaVersion, 'journey-service-blueprint-export/v1');
  assert.equal(jsonExport.body.version.versionId, current.body.version.versionId);
  assert.equal(jsonExport.body.version.journeyVersionId, map.currentVersionId);
  assert.equal(jsonExport.body.analysis.valid, true);
  assert.match(String(jsonExport.headers['x-content-sha256']), /^[a-f0-9]{64}$/u);
  const csvExport = await inSpace(owner.agent, 'get',
    `/api/journey-blueprints/versions/${current.body.version.versionId}/export.csv`, owner.spaceId)
    .set('X-Request-Id', 'blueprint-export-csv').expect(200).expect('Content-Type', /text\/csv/u);
  assert.match(csvExport.text, /^"record_type","blueprint_id","blueprint_version_id"/u);
  assert.match(csvExport.text, /element/);
  assert.match(csvExport.text, /relationship/);
  assert.match(csvExport.text, /'=Submit verification details/u);
  const exportAudit = db.prepare(`SELECT action,target_type,target_id,detail_json
    FROM journey_collaboration_audit_events WHERE space_id=? AND action='blueprint.export'
    ORDER BY created_at,id`).all(owner.spaceId) as Array<Record<string, unknown>>;
  assert.equal(exportAudit.length, 2);
  assert.equal(exportAudit[0]?.target_type, 'journey_blueprint_version');
  assert.equal(exportAudit[0]?.target_id, current.body.version.versionId);
  assert.doesNotMatch(JSON.stringify(exportAudit), /Submit verification details/u);

  await inSpace(member.agent, 'patch', `/api/journey-blueprints/gaps/${current.body.version.gaps[0].id}`, owner.spaceId)
    .send({ state: 'accepted' }).expect(403);
  const acceptedGap = await inSpace(owner.agent, 'patch',
    `/api/journey-blueprints/gaps/${current.body.version.gaps[0].id}`, owner.spaceId)
    .send({ state: 'accepted' }).expect(200);
  assert.equal(acceptedGap.body.gap.state, 'accepted');
  assert.equal(acceptedGap.body.gap.reviewerUserId, owner.userId);
  await inSpace(owner.agent, 'patch', `/api/journey-blueprints/gaps/${current.body.version.gaps[0].id}`, owner.spaceId)
    .send({ state: 'resolved' }).expect(409);

  await inSpace(member.agent, 'patch', `/api/journey-blueprints/versions/${current.body.version.versionId}/review`, owner.spaceId)
    .send({ expectedReviewState: 'draft', reviewState: 'in_review' }).expect(403);
  const approved = await inSpace(owner.agent, 'patch', `/api/journey-blueprints/versions/${current.body.version.versionId}/review`, owner.spaceId)
    .send({ expectedReviewState: 'draft', reviewState: 'approved' }).expect(200);
  assert.equal(approved.body.version.reviewState, 'approved');
  await inSpace(owner.agent, 'patch', `/api/journey-blueprints/versions/${current.body.version.versionId}/review`, owner.spaceId)
    .send({ expectedReviewState: 'draft', reviewState: 'in_review' }).expect(409);

  const publishedMap = maps.publishJourneyMap(owner.spaceId, map.id, map.revision, owner.userId);
  const future = await inSpace(owner.agent, 'post', `/api/journey-blueprints/${blueprint.body.blueprint.id}/versions`, owner.spaceId)
    .send({ ...base, journeyVersionId: publishedMap.draftVersionId, state: 'future',
      changeReason: 'Automate the verification checks', elements: [
      ...base.elements.map((element) => element.id === 'verification-process'
        ? { ...element, title: 'Automate verification checks', slaMinutes: 10 }
        : element),
      { id: 'verification-control', stageKey: stage.stage_key, lane: 'policy_control', kind: 'control',
        title: 'Review false-positive threshold', ordinal: 0 }
    ] }).expect(201);
  const comparison = await inSpace(owner.agent, 'post', '/api/journey-blueprints/comparisons', owner.spaceId).send({
    fromVersionId: current.body.version.versionId, toVersionId: future.body.version.versionId
  }).expect(201);
  assert.deepEqual(comparison.body.comparison.addedElementIds, ['verification-control']);
  assert.deepEqual(comparison.body.comparison.changed[0].fields.sort(), ['slaMinutes', 'title']);

  await inSpace(member.agent, 'get', `/api/journey-blueprints/versions/${current.body.version.versionId}`, member.homeSpaceId)
    .expect(404).expect(({ body }) => assert.equal(body.code, 'JOURNEY_BLUEPRINT_VERSION_NOT_FOUND'));

  const retired = await inSpace(owner.agent, 'patch', `/api/journey-blueprints/resources/catalogue/${team.body.resource.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'retired' }).expect(200);
  assert.equal(retired.body.resource.lifecycle, 'retired');
  await inSpace(owner.agent, 'patch', `/api/journey-blueprints/resources/catalogue/${team.body.resource.id}`, owner.spaceId)
    .send({ expectedRevision: 1, lifecycle: 'active' }).expect(409);
});
