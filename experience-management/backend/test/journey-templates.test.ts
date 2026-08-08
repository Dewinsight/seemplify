import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-templates-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Template-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-template-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 32).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'journey-templates@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { seedJourneyTemplateCatalog } = await import('../src/journeyTemplates.js');
const { journeyTemplateSeeds } = await import('../src/journeyTemplateCatalog.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function rootAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-templates@seemplify.local', password: 'Journey-Template-Test-Password-2026!'
  }).expect(200);
  return agent;
}

function content(label: string) {
  const seed = journeyTemplateSeeds[0];
  return {
    name: `${label} onboarding`, description: `${label} governed template`, industry: 'Software', useCase: 'Onboarding',
    experienceType: seed.experienceType, mapType: seed.mapType, lanes: seed.lanes,
    stages: [{
      key: 'start', name: 'Start', goal: 'Begin safely', cards: [
        { laneType: 'stage_goal', kind: 'goal', title: 'Begin safely', content: `${label} goal` },
        { laneType: 'touchpoints', kind: 'touchpoint', title: `${label} touchpoint` }
      ]
    }]
  };
}

function grantEnterprise(spaceId: string) {
  db.prepare(`UPDATE platform_subscriptions SET plan_code='enterprise',status='active',updated_at=? WHERE space_id=?`)
    .run(new Date().toISOString(), spaceId);
}

function grantStarter(spaceId: string) {
  db.prepare(`UPDATE platform_subscriptions SET plan_code='starter',status='active',updated_at=? WHERE space_id=?`)
    .run(new Date().toISOString(), spaceId);
}

async function delegatedTemplateAdmin(email: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Delegated template admin', email, password: 'Delegated-Template-Admin-2026!',
    spaceName: 'Delegated template administration'
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const rootUser = db.prepare('SELECT id FROM users WHERE email=?').get('journey-templates@seemplify.local') as { id: string };
  db.prepare(`INSERT INTO platform_rbac_user_roles
    (id,user_id,role_id,assigned_by_user_id,assigned_at,revoked_by_user_id,revoked_at,reason)
    VALUES (?,?,'editor',?,?,NULL,NULL,?)`).run(
    crypto.randomUUID(), String(session.body.user.id), rootUser.id, new Date().toISOString(),
    'Two-person system-template governance test'
  );
  return agent;
}

test('the eight unreviewed system seeds are deterministic and idempotent', async () => {
  assert.equal(seedJourneyTemplateCatalog(), 0);
  const rows = db.prepare(`SELECT template.template_key,version.state,version.reviewed_at,version.published_at
    FROM journey_templates template JOIN journey_template_versions version ON version.template_id=template.id
    WHERE template.scope='system' ORDER BY template.template_key`).all() as any[];
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((row) => row.template_key), [...journeyTemplateSeeds.map((seed) => seed.key)].sort());
  assert.ok(rows.every((row) => row.state === 'draft' && row.reviewed_at === null && row.published_at === null));
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_template_audit_events WHERE action='seeded'").get() as any).count, 8);
});

test('system templates require explicit platform review before publication', async () => {
  const agent = await rootAgent();
  const adminList = await agent.get('/api/platform-admin/journey-templates').expect(200);
  const template = adminList.body.templates.find((item: any) => item.key === 'customer-onboarding');
  assert.ok(template);
  const draft = template.versions[0];

  await agent.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/publish`).send({
    expectedTemplateRevision: template.revision, expectedVersionRevision: draft.revision, reason: 'Publish without review'
  }).expect(409);

  const reviewed = await agent.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/review`).send({
    expectedTemplateRevision: template.revision, expectedVersionRevision: draft.revision, reason: 'Catalogue governance review'
  }).expect(200);
  assert.equal(reviewed.body.state, 'in_review');
  assert.ok(reviewed.body.reviewedAt);

  const selfPublish = await agent.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/publish`).send({
    expectedTemplateRevision: template.revision + 1, expectedVersionRevision: draft.revision + 1,
    reason: 'Approved for customer use'
  }).expect(409);
  assert.equal(selfPublish.body.code, 'JOURNEY_TEMPLATE_TWO_PERSON_REQUIRED');

  const publisher = await delegatedTemplateAdmin('template-publisher@example.test');
  const published = await publisher.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/publish`).send({
    expectedTemplateRevision: template.revision + 1, expectedVersionRevision: draft.revision + 1,
    reason: 'Independent approval for customer use'
  }).expect(200);
  assert.equal(published.body.publishedVersionId, draft.id);
  assert.equal(published.body.versions[0].state, 'published');

  const workspaceList = await agent.get('/api/journey-templates').expect(200);
  assert.ok(workspaceList.body.templates.some((item: any) => item.id === template.id));
  const audit = await agent.get(`/api/platform-admin/journey-templates/${template.id}/audit`).expect(200);
  assert.deepEqual(audit.body.events.slice(0, 3).map((event: any) => event.action),
    ['published', 'submitted_for_review', 'seeded']);
});

test('a system-template review can be rejected back to an editable audited draft', async () => {
  const agent = await rootAgent();
  const templates = (await agent.get('/api/platform-admin/journey-templates').expect(200)).body.templates;
  const template = templates.find((item: any) => item.key === 'purchase');
  assert.ok(template);
  const draft = template.versions[0];
  const reviewed = await agent.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/review`).send({
    expectedTemplateRevision: template.revision, expectedVersionRevision: draft.revision,
    reason: 'Review this purchase template'
  }).expect(200);
  const rejected = await agent.post(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}/reject`).send({
    expectedTemplateRevision: template.revision + 1, expectedVersionRevision: reviewed.body.revision,
    reason: 'Clarify the purchase recovery handoff'
  }).expect(200);
  assert.equal(rejected.body.state, 'draft');
  assert.equal(rejected.body.reviewedAt, null);
  const edited = await agent.put(`/api/platform-admin/journey-templates/${template.id}/versions/${draft.id}`).send({
    expectedTemplateRevision: template.revision + 2, expectedVersionRevision: rejected.body.revision,
    content: content('Reworked purchase')
  }).expect(200);
  assert.equal(edited.body.state, 'draft');
  const audit = await agent.get(`/api/platform-admin/journey-templates/${template.id}/audit`).expect(200);
  assert.deepEqual(audit.body.events.slice(0, 4).map((event: any) => event.action),
    ['draft_updated', 'review_rejected', 'submitted_for_review', 'seeded']);
});

test('space administrators govern organisation versions and maps keep an immutable exact-version pin', async () => {
  const agent = await rootAgent();
  const created = await agent.post('/api/journey-templates').send({ key: 'acme-onboarding', content: content('Original') }).expect(201);
  assert.equal(created.body.scope, 'space');
  assert.equal(created.body.versions[0].state, 'draft');
  const templateId = created.body.id;
  const firstVersion = created.body.versions[0];

  // Drafts cannot be instantiated, even when the caller knows their IDs.
  await agent.post(`/api/journey-templates/${templateId}/versions/${firstVersion.id}/create-map`).send({}).expect(404);
  const stale = await agent.put(`/api/journey-templates/${templateId}/versions/${firstVersion.id}`).send({
    expectedTemplateRevision: 99, expectedVersionRevision: firstVersion.revision, content: content('Stale')
  }).expect(409);
  assert.equal(stale.body.code, 'JOURNEY_TEMPLATE_REVISION_CONFLICT');

  const updated = await agent.put(`/api/journey-templates/${templateId}/versions/${firstVersion.id}`).send({
    expectedTemplateRevision: created.body.revision, expectedVersionRevision: firstVersion.revision, content: content('Original')
  }).expect(200);
  assert.equal(updated.body.revision, 2);
  const publishedFirst = await agent.post(`/api/journey-templates/${templateId}/versions/${firstVersion.id}/publish`).send({
    expectedTemplateRevision: 2, expectedVersionRevision: 2, reason: 'Space owner approval'
  }).expect(200);
  assert.equal(publishedFirst.body.publishedVersionId, firstVersion.id);

  const mapped = await agent.post(`/api/journey-templates/${templateId}/versions/${firstVersion.id}/create-map`)
    .send({ name: 'Pinned customer journey' }).expect(201);
  const definitionId = mapped.body.definition.id;
  const pinBefore = db.prepare(`SELECT template_version_id,version_id FROM journey_template_instantiations
    WHERE definition_id=?`).get(definitionId) as any;
  assert.equal(pinBefore.template_version_id, firstVersion.id);
  const mapBefore = await agent.get(`/api/journey-maps/${definitionId}`).expect(200);
  assert.ok(mapBefore.body.cards.some((card: any) => card.title === 'Original touchpoint' && card.origin === 'template'));

  const second = await agent.post(`/api/journey-templates/${templateId}/versions`).send({
    expectedTemplateRevision: publishedFirst.body.revision, content: content('Replacement')
  }).expect(201);
  const secondVersion = second.body.versions.find((version: any) => version.versionNumber === 2);
  const editedSecond = await agent.put(`/api/journey-templates/${templateId}/versions/${secondVersion.id}`).send({
    expectedTemplateRevision: second.body.revision, expectedVersionRevision: secondVersion.revision,
    content: content('Replacement')
  }).expect(200);
  assert.equal(editedSecond.body.revision, 2);
  const latestDraftList = await agent.get('/api/journey-templates?includeDrafts=true').expect(200);
  const beforePublishSecond = latestDraftList.body.templates.find((item: any) => item.id === templateId);
  const publishedSecond = await agent.post(`/api/journey-templates/${templateId}/versions/${secondVersion.id}/publish`).send({
    expectedTemplateRevision: beforePublishSecond.revision, expectedVersionRevision: editedSecond.body.revision,
    reason: 'New organisation version'
  }).expect(200);
  assert.equal(publishedSecond.body.publishedVersionId, secondVersion.id);
  assert.equal(publishedSecond.body.versions.find((version: any) => version.id === firstVersion.id).state, 'retired');

  const pinAfter = db.prepare(`SELECT template_version_id,version_id FROM journey_template_instantiations
    WHERE definition_id=?`).get(definitionId) as any;
  assert.deepEqual(pinAfter, pinBefore);
  const mapAfter = await agent.get(`/api/journey-maps/${definitionId}`).expect(200);
  assert.ok(mapAfter.body.cards.some((card: any) => card.title === 'Original touchpoint'));
  assert.equal(mapAfter.body.cards.some((card: any) => card.title === 'Replacement touchpoint'), false);

  // Published content is immutable. Retirement blocks new maps but does not
  // mutate or remove maps already copied from the version.
  await agent.put(`/api/journey-templates/${templateId}/versions/${secondVersion.id}`).send({
    expectedTemplateRevision: publishedSecond.body.revision,
    expectedVersionRevision: publishedSecond.body.versions.find((version: any) => version.id === secondVersion.id).revision,
    content: content('Illegal edit')
  }).expect(409);
  const currentSecond = publishedSecond.body.versions.find((version: any) => version.id === secondVersion.id);
  const retired = await agent.post(`/api/journey-templates/${templateId}/versions/${secondVersion.id}/retire`).send({
    expectedTemplateRevision: publishedSecond.body.revision, expectedVersionRevision: currentSecond.revision,
    reason: 'Template replaced by policy'
  }).expect(200);
  assert.equal(retired.body.status, 'retired');
  await agent.post(`/api/journey-templates/${templateId}/versions/${secondVersion.id}/create-map`).send({}).expect(404);
  await agent.get(`/api/journey-maps/${definitionId}`).expect(200);
  const audit = await agent.get(`/api/journey-templates/${templateId}/audit`).expect(200);
  assert.ok(audit.body.events.some((event: any) => event.action === 'map_created'
    && event.after.definitionId === definitionId));
  assert.equal(audit.body.events.some((event: any) => 'content' in event.after), false);
});

test('blueprint-only template lanes and cards cannot leak into a non-blueprint map', async () => {
  const agent = await rootAgent();
  const templateContent = {
    name: 'Current-state lane guard', description: 'Exercises blueprint-only filtering', industry: 'Software',
    useCase: 'Onboarding', experienceType: 'customer', mapType: 'current_state',
    lanes: [
      { laneType: 'stage_goal', title: 'Stage goal', description: '', ordinal: 0, blueprintOnly: false },
      { laneType: 'frontstage', title: 'Frontstage', description: '', ordinal: 1, blueprintOnly: true }
    ],
    stages: [{ key: 'start', name: 'Start', goal: 'Begin', cards: [
      { laneType: 'stage_goal', kind: 'goal', title: 'Visible goal' },
      { laneType: 'frontstage', kind: 'process', title: 'Blueprint-only action' }
    ] }]
  };
  const created = await agent.post('/api/journey-templates').send({ key: 'current-state-lane-guard', content: templateContent })
    .expect(201);
  const version = created.body.versions[0];
  const published = await agent.post(`/api/journey-templates/${created.body.id}/versions/${version.id}/publish`).send({
    expectedTemplateRevision: created.body.revision, expectedVersionRevision: version.revision,
    reason: 'Verify lane applicability'
  }).expect(200);
  const mapped = await agent.post(`/api/journey-templates/${created.body.id}/versions/${version.id}/create-map`).send({})
    .expect(201);
  const map = await agent.get(`/api/journey-maps/${mapped.body.definition.id}`).expect(200);
  assert.deepEqual(map.body.lanes.map((lane: any) => lane.laneType), ['stage_goal']);
  assert.deepEqual(map.body.cards.map((card: any) => card.title), ['Visible goal']);
  assert.equal(published.body.publishedVersionId, version.id);
});

test('governed templates preserve multiple custom lane keys and their note-only cards exactly', async () => {
  const agent = await rootAgent();
  const customContent = {
    name: 'Commitment template', description: 'Two independent customer-defined lanes', industry: 'Cross-industry',
    useCase: 'Commitment tracking', experienceType: 'customer', mapType: 'current_state',
    lanes: [
      { laneType: 'stage_goal', title: 'Stage goal', description: '', ordinal: 0, blueprintOnly: false },
      { laneType: 'custom_customer_commitment', title: 'Customer commitment', description: '', ordinal: 1, blueprintOnly: false },
      { laneType: 'custom_internal_commitment', title: 'Internal commitment', description: '', ordinal: 2, blueprintOnly: false }
    ],
    stages: [{ key: 'commit', name: 'Commit', goal: 'Set expectations', cards: [
      { laneType: 'stage_goal', kind: 'goal', title: 'Agree the next step' },
      { laneType: 'custom_customer_commitment', kind: 'note', title: 'Customer provides the documents' },
      { laneType: 'custom_internal_commitment', kind: 'note', title: 'Team replies within one day' }
   ] }]
  };
  const invalid = structuredClone(customContent);
  invalid.stages[0].cards[1].kind = 'action';
  const rejected = await agent.post('/api/journey-templates').send({ key: 'invalid-custom-lane-kind', content: invalid })
    .expect(400);
  assert.equal(rejected.body.code, 'JOURNEY_TEMPLATE_CARD_INVALID');

  const created = await agent.post('/api/journey-templates').send({
    key: 'commitment-template', content: customContent
  }).expect(201);
  const version = created.body.versions[0];
  await agent.post(`/api/journey-templates/${created.body.id}/versions/${version.id}/publish`).send({
    expectedTemplateRevision: created.body.revision,
    expectedVersionRevision: version.revision,
    reason: 'Approved custom commitment structure'
  }).expect(200);
  const mapped = await agent.post(`/api/journey-templates/${created.body.id}/versions/${version.id}/create-map`)
    .send({ name: 'Commitment map from template' }).expect(201);
  const map = await agent.get(`/api/journey-maps/${mapped.body.definition.id}`).expect(200);
  assert.deepEqual(map.body.lanes.map((lane: any) => lane.laneType), [
    'stage_goal', 'custom_customer_commitment', 'custom_internal_commitment'
  ]);
  assert.deepEqual(map.body.cards.filter((card: any) => card.laneType.startsWith('custom_'))
    .map((card: any) => [card.laneType, card.kind, card.title]), [
    ['custom_customer_commitment', 'note', 'Customer provides the documents'],
    ['custom_internal_commitment', 'note', 'Team replies within one day']
  ]);
});

test('published visibility is tenant-scoped, members are read-only, and plan access is enforced', async () => {
  const owner = await rootAgent();
  const list = await owner.get('/api/journey-templates?includeDrafts=true').expect(200);
  const organisation = list.body.templates.find((item: any) => item.key === 'acme-onboarding');
  assert.ok(organisation);

  const outsider = request.agent(app);
  const onboarded = await signupVerifyAndOnboard(outsider, {
    name: 'Template outsider', email: 'template-outsider@example.test', password: 'Template-Outsider-2026!',
    spaceName: 'Outsider templates'
  });
  const outsiderSpaceId = String(onboarded.body.activeSpace.id);
  grantStarter(outsiderSpaceId);
  await outsider.get('/api/journey-templates').expect(403);
  grantEnterprise(outsiderSpaceId);
  await outsider.get(`/api/journey-templates/${organisation.id}/versions/${organisation.versions[0].id}`).expect(404);
  await outsider.post(`/api/journey-templates/${organisation.id}/versions`).send({
    expectedTemplateRevision: organisation.revision, content: content('Cross space')
  }).expect(404);

  const session = await owner.get('/api/auth/session').expect(200);
  const invitation = await owner.post(`/api/spaces/${session.body.activeSpace.id}/invitations`).send({
    email: 'template-member@example.test', role: 'member'
  }).expect(201);
  const token = new URL(invitation.body.inviteUrl).pathname.split('/').at(-1)!;
  const member = request.agent(app);
  await signupVerifyAndOnboard(member, {
    name: 'Template member', email: 'template-member@example.test', password: 'Template-Member-2026!', inviteToken: token
  });
  await member.post(`/api/spaces/invitations/${token}/accept`).send({}).expect(200);
  const visible = await member.get('/api/journey-templates').expect(200);
  const system = visible.body.templates.find((item: any) => item.key === 'customer-onboarding');
  assert.ok(system);
  await member.get(`/api/journey-templates/${system.id}/versions/${system.publishedVersionId}`).expect(200);
  await member.post(`/api/journey-templates/${system.id}/versions/${system.publishedVersionId}/create-map`).send({}).expect(403);
});

test('template map creation consumes the existing journey-map allowance', async () => {
  const agent = await rootAgent();
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  const published = (await agent.get('/api/journey-templates').expect(200)).body.templates
    .find((item: any) => item.key === 'customer-onboarding');
  assert.ok(published);
  const plan = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'").get() as { limits_json: string };
  const original = JSON.parse(plan.limits_json);
  const current = Number((db.prepare(`SELECT COUNT(*) count FROM journey_definitions
    WHERE space_id=? AND legacy_journey_id IS NULL`).get(spaceId) as any).count);
  try {
    db.prepare("UPDATE platform_subscription_plans SET limits_json=?,updated_at=? WHERE code='enterprise'")
      .run(JSON.stringify({ ...original, journeyMaps: current }), new Date().toISOString());
    const blocked = await agent.post(`/api/journey-templates/${published.id}/versions/${published.publishedVersionId}/create-map`)
      .send({ name: 'Over allowance' }).expect(409);
    assert.equal(blocked.body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED');
  } finally {
    db.prepare("UPDATE platform_subscription_plans SET limits_json=?,updated_at=? WHERE code='enterprise'")
      .run(JSON.stringify(original), new Date().toISOString());
  }
});

test('platform journey-template permissions distinguish read from management', async () => {
  const viewer = request.agent(app);
  await signupVerifyAndOnboard(viewer, {
    name: 'Template platform viewer', email: 'template-platform-viewer@example.test',
    password: 'Template-Platform-Viewer-2026!', spaceName: 'Viewer space'
  });
  const user = db.prepare("SELECT id FROM users WHERE email='template-platform-viewer@example.test'").get() as { id: string };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_rbac_user_roles
    (id,user_id,role_id,assigned_by_user_id,assigned_at,revoked_by_user_id,revoked_at,reason,revocation_reason)
    VALUES (?,?, 'viewer', NULL, ?, NULL, NULL, 'Template permission test', NULL)`)
    .run(crypto.randomUUID(), user.id, now);
  const list = await viewer.get('/api/platform-admin/journey-templates').expect(200);
  const draft = list.body.templates.find((item: any) => item.key === 'purchase');
  await viewer.post(`/api/platform-admin/journey-templates/${draft.id}/versions/${draft.versions[0].id}/review`).send({
    expectedTemplateRevision: draft.revision, expectedVersionRevision: draft.versions[0].revision,
    reason: 'Viewer must not review'
  }).expect(403);
});
