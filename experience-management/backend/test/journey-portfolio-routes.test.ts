import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-portfolio-routes-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Portfolio-Routes-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-portfolio-routes-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-portfolio-routes-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 91).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 92).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-portfolio-routes@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
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
    email: 'journey-portfolio-routes@seemplify.local',
    password: 'Journey-Portfolio-Routes-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

async function collaborator(spaceId: string, role: 'admin' | 'member', suffix: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: `Portfolio ${role}`,
    email: `portfolio-routes-${role}-${suffix}@example.test`,
    password: `Portfolio-${role}-Routes-Password-2026!`,
    spaceName: `Portfolio ${role} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, userId, role, at, at);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId };
}

function inSpace(agent: ReturnType<typeof request.agent>, method: 'get' | 'post' | 'patch' | 'delete', url: string, spaceId: string) {
  return agent[method](url).set('X-Seemplify-Space', spaceId);
}

function portfolioDraft(kind: 'pain_point' | 'opportunity' | 'solution' | 'initiative', title: string) {
  return {
    kind,
    title,
    description: `${title} description`,
    lifecycle: 'draft',
    ownerUserId: null,
    ownerTeamId: null,
    priority: kind === 'initiative' ? 'high' : null,
    risk: kind === 'solution' || kind === 'initiative' ? 'medium' : null,
    severity: kind === 'pain_point' ? 3 : null,
    frequency: kind === 'pain_point' ? 'frequent' : null,
    desiredOutcome: kind === 'opportunity' ? 'Improve conversion.' : null,
    hypothesis: kind === 'solution' ? 'A clearer path reduces friction.' : null,
    constraints: [],
    estimatedEffort: null,
    estimatedCost: null,
    expectedOutcome: kind === 'initiative' ? 'Lift checkout completion.' : null,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    dueDate: null,
    progressPercent: kind === 'initiative' ? 0 : null,
    reviewCadenceDays: null,
    targetMetrics: [],
    evidenceLinkIds: [],
    tags: []
  };
}

test('journey portfolio routes allow member reads but require manager writes', async () => {
  const owner = await ownerIdentity();
  const admin = await collaborator(owner.spaceId, 'admin', 'admin');
  const member = await collaborator(owner.spaceId, 'member', 'member');

  const created = await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('pain_point', 'Checkout abandons at payment'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(created.body.item.kind, 'pain_point');

  const listed = await inSpace(member.agent, 'get', '/api/journey-portfolio/items', owner.spaceId).expect(200);
  assert.ok(listed.body.items.some((item: any) => item.id === created.body.item.id));

  const report = await inSpace(member.agent, 'get', '/api/journey-portfolio/executive-report', owner.spaceId).expect(200);
  assert.equal(report.body.report.schemaVersion, 'journey-portfolio-executive-report/v1');
  assert.ok(report.body.report.scope.itemCount >= 1);
  assert.equal(report.body.report.interpretation.mode, 'descriptive_portfolio_snapshot');
  const csv = await inSpace(member.agent, 'get', '/api/journey-portfolio/executive-report.csv', owner.spaceId)
    .expect('Content-Type', /text\/csv/u).expect(200);
  assert.match(csv.text, /^category,metric,value,as_of\r?\n/u);
  assert.doesNotMatch(csv.text, /Checkout abandons at payment/u, 'aggregate export must not disclose item content');

  await inSpace(member.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('pain_point', 'Member blocked'),
    idempotencyKey: crypto.randomUUID()
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_PORTFOLIO_FORBIDDEN'));

  await inSpace(member.agent, 'patch', `/api/journey-portfolio/items/${created.body.item.id}`, owner.spaceId).send({
    expectedRevision: created.body.item.revision,
    patch: { lifecycle: 'validated' }, changeReason: 'Member move must fail', idempotencyKey: crypto.randomUUID()
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_PORTFOLIO_FORBIDDEN'));

  const updated = await inSpace(admin.agent, 'patch', `/api/journey-portfolio/items/${created.body.item.id}`, owner.spaceId).send({
    expectedRevision: created.body.item.revision,
    patch: { title: 'Payment step drops customers' },
    changeReason: 'Tighten the wording.',
    idempotencyKey: crypto.randomUUID()
  }).expect(200);
  assert.equal(updated.body.item.revision, created.body.item.revision + 1);
  assert.equal(updated.body.item.title, 'Payment step drops customers');
});

test('journey portfolio routes govern operational link outcome writes', async () => {
  const owner = await ownerIdentity();
  const member = await collaborator(owner.spaceId, 'member', 'operational-member');
  const initiative = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('initiative', 'Operational follow-up'), idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;
  const actionId = crypto.randomUUID(); const at = new Date().toISOString();
  db.prepare(`INSERT INTO assistant_actions
    (id,space_id,created_by,title,description,owner,status,priority,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?, ?,1,?,?)`).run(actionId, owner.spaceId, owner.userId, 'Follow up', '', '',
      'open', 'normal', at, at);

  const linked = await inSpace(owner.agent, 'post', '/api/journey-portfolio/operational-links', owner.spaceId).send({
    initiativeId: initiative.id, operationalKind: 'assistant_action', operationalId: actionId,
    relationship: 'supports', idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(linked.body.operationalLink.outcomeState, 'linked');

  await inSpace(member.agent, 'patch',
    `/api/journey-portfolio/operational-links/${linked.body.operationalLink.id}/outcome`, owner.spaceId).send({
      expectedRevision: 1, outcomeState: 'failed', outcomeDetail: {}
    }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_PORTFOLIO_FORBIDDEN'));

  const updated = await inSpace(owner.agent, 'patch',
    `/api/journey-portfolio/operational-links/${linked.body.operationalLink.id}/outcome`, owner.spaceId).send({
      expectedRevision: 1, outcomeState: 'succeeded', outcomeDetail: { resultCode: 'completed' }
    }).expect(200);
  assert.equal(updated.body.operationalLink.revision, 2);
  const listed = await inSpace(member.agent, 'get',
    `/api/journey-portfolio/operational-links?initiativeId=${initiative.id}`, owner.spaceId).expect(200);
  assert.equal(listed.body.operationalLinks[0].outcomeState, 'succeeded');
});

test('journey portfolio routes expose relationships, dependencies, scoring policies, assessments, and journey links', async () => {
  const owner = await ownerIdentity();

  const pain = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('pain_point', 'Payment confusion'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;
  const opportunity = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('opportunity', 'Clarify checkout'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;
  const solution = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('solution', 'Redesign payment form'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;
  const initiative = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('initiative', 'Ship payment redesign'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;
  const prerequisite = (await inSpace(owner.agent, 'post', '/api/journey-portfolio/items', owner.spaceId).send({
    draft: portfolioDraft('initiative', 'Retire legacy gateway'),
    idempotencyKey: crypto.randomUUID()
  }).expect(201)).body.item;

  const relationship = await inSpace(owner.agent, 'post', '/api/journey-portfolio/relationships', owner.spaceId).send({
    type: 'pain_point_to_opportunity',
    fromItemId: pain.id,
    toItemId: opportunity.id,
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(relationship.body.relationship.type, 'pain_point_to_opportunity');

  const dependency = await inSpace(owner.agent, 'post', '/api/journey-portfolio/dependencies', owner.spaceId).send({
    initiativeId: initiative.id,
    dependsOnInitiativeId: prerequisite.id,
    type: 'finish_to_start',
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(dependency.body.dependency.initiativeId, initiative.id);

  const policy = await inSpace(owner.agent, 'post', '/api/journey-portfolio/policies', owner.spaceId).send({
    name: 'RICE default',
    method: 'rice',
    configuration: {},
    state: 'active',
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(policy.body.policy.state, 'active');

  const assessment = await inSpace(owner.agent, 'post', '/api/journey-portfolio/assessments', owner.spaceId).send({
    itemId: opportunity.id,
    policyId: policy.body.policy.id,
    scoreInput: { reach: 8, impact: 5, confidence: 0.8, effort: 2 },
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(assessment.body.assessment.itemId, opportunity.id);

  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Portfolio route journey',
    purpose: 'Exercise journey portfolio links',
    stageNames: ['Discover']
  });
  const link = await inSpace(owner.agent, 'post', '/api/journey-portfolio/journey-links', owner.spaceId).send({
    itemId: solution.id,
    journeyDefinitionId: definition.id,
    journeyVersionId: null,
    targetType: 'journey',
    targetId: definition.id,
    relationship: 'changes',
    validFrom: null,
    validUntil: null,
    idempotencyKey: crypto.randomUUID()
  }).expect(201);
  assert.equal(link.body.link.itemId, solution.id);

  const links = await inSpace(owner.agent, 'get', '/api/journey-portfolio/journey-links', owner.spaceId)
    .query({ journeyDefinitionId: definition.id }).expect(200);
  assert.ok(links.body.links.some((entry: any) => entry.id === link.body.link.id));

  const dependencies = await inSpace(owner.agent, 'get', '/api/journey-portfolio/dependencies', owner.spaceId).expect(200);
  assert.ok(dependencies.body.dependencies.some((entry: any) => entry.id === dependency.body.dependency.id));

  const detail = await inSpace(owner.agent, 'get', `/api/journey-portfolio/items/${initiative.id}`, owner.spaceId).expect(200);
  assert.deepEqual(detail.body.operationalLinks, []);
  assert.deepEqual(detail.body.outcomes, []);

  const policies = await inSpace(owner.agent, 'get', '/api/journey-portfolio/policies', owner.spaceId).expect(200);
  assert.ok(policies.body.policies.some((entry: any) => entry.id === policy.body.policy.id));
});
