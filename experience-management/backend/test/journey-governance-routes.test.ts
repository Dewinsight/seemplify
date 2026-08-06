import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-governance-routes-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
const identityKeyFile = path.join(root, 'identity-key');
fs.writeFileSync(passwordFile, 'Journey-Governance-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-governance-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-governance-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 72).toString('base64url'));
fs.writeFileSync(identityKeyFile, Buffer.alloc(32, 73));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-governance@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
const { journeyTemplateSeeds } = await import('../src/journeyTemplateCatalog.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function ownerIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-governance@seemplify.local',
    password: 'Journey-Governance-Test-Password-2026!'
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
    name: `Journey ${role}`,
    email: `journey-${role}-${suffix}@example.test`,
    password: `Journey-${role}-Password-2026!`,
    spaceName: `Journey ${role} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, userId, role, at, at);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  return { agent, userId, homeSpaceId };
}

function inSpace(agent: ReturnType<typeof request.agent>, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, spaceId: string) {
  return agent[method](url).set('X-Seemplify-Space', spaceId);
}

function savedViewConfig() {
  return {
    schemaVersion: 1,
    binding: { policy: 'follows_current', versionId: null },
    filters: {
      personaIds: [],
      segmentIds: [],
      cohortIds: [],
      channelIds: [],
      evidenceLinkIds: [],
      evidenceStates: [],
      cardKinds: [],
      laneKeys: [],
      timeWindow: null
    },
    comparisonTarget: null,
    presentation: {
      density: 'comfortable',
      showEvidenceLegend: true,
      showResearchGaps: true,
      showEmptyLanes: true,
      title: ''
    }
  };
}

function templateContent(label: string) {
  const seed = journeyTemplateSeeds[0];
  return {
    name: `${label} onboarding`,
    description: `${label} governed template`,
    industry: 'Software',
    useCase: 'Onboarding',
    experienceType: seed.experienceType,
    mapType: seed.mapType,
    lanes: seed.lanes,
    stages: [{
      key: 'start',
      name: 'Start',
      goal: 'Begin safely',
      cards: [
        { laneType: 'stage_goal', kind: 'goal', title: 'Begin safely', content: `${label} goal` },
        { laneType: 'touchpoints', kind: 'touchpoint', title: `${label} touchpoint` }
      ]
    }]
  };
}

function grantPlatformRole(userId: string, roleId: 'viewer' | 'editor', reason: string) {
  db.prepare(`INSERT INTO platform_rbac_user_roles
    (id,user_id,role_id,assigned_by_user_id,assigned_at,revoked_by_user_id,revoked_at,reason)
    VALUES (?,?,?,?,?,NULL,NULL,?)`).run(
    crypto.randomUUID(),
    userId,
    roleId,
    db.prepare('SELECT id FROM users WHERE email=?').get('journey-governance@seemplify.local')!.id,
    new Date().toISOString(),
    reason
  );
}

test('journey route governance enforces member vs editor boundaries across map, saved-view, research, rich-card, suggestion, metric-alert, and identity surfaces', async () => {
  const owner = await ownerIdentity();
  const admin = await collaborator(owner.spaceId, 'admin', 'admin');
  const member = await collaborator(owner.spaceId, 'member', 'member');

  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Governed route matrix',
    purpose: 'Prove route-by-route journey permissions',
    stageNames: ['Discover', 'Decide']
  });
  const draft = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;

  await inSpace(member.agent, 'get', `/api/journey-maps/${definition.id}`, owner.spaceId).expect(200);
  await inSpace(member.agent, 'post', `/api/journey-maps/${definition.id}/publish`, owner.spaceId)
    .send({ expectedRevision: draft.definition.revision }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(admin.agent, 'post', `/api/journey-maps/${definition.id}/publish`, owner.spaceId)
    .send({ expectedRevision: draft.definition.revision }).expect(200);

  const savedView = await inSpace(owner.agent, 'post', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ name: 'Shared route view', visibility: 'space', config: savedViewConfig() }).expect(201);
  await inSpace(member.agent, 'get', `/api/journey-maps/${definition.id}/saved-views`, owner.spaceId).expect(200);
  await inSpace(member.agent, 'get', `/api/journey-maps/${definition.id}/saved-views/audit`, owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_SAVED_VIEW_AUDIT_FORBIDDEN'));
  await inSpace(member.agent, 'patch', `/api/journey-maps/${definition.id}/saved-views/settings`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 0, enabled: true, retentionDays: 30 }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_SAVED_VIEW_SETTINGS_FORBIDDEN'));
  await inSpace(admin.agent, 'patch', `/api/journey-maps/${definition.id}/saved-views/settings`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 0, enabled: true, retentionDays: 30 }).expect(200);
  await inSpace(member.agent, 'patch', `/api/journey-maps/${definition.id}/saved-views/${savedView.body.view.id}`, owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ expectedRevision: 1, name: 'Member cannot rewrite shared view', visibility: 'space', config: savedViewConfig() })
    .expect(403);

  await inSpace(member.agent, 'get', '/api/journey-rich-cards/catalog', owner.spaceId).expect(200);
  await inSpace(member.agent, 'post', '/api/journey-rich-cards/channels', owner.spaceId).send({
    name: 'Member denied channel',
    description: 'Must be blocked for members',
    category: 'web'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_RICH_CARD_FORBIDDEN'));
  await inSpace(admin.agent, 'post', '/api/journey-rich-cards/channels', owner.spaceId).send({
    name: 'Website',
    description: 'Authenticated web channel',
    category: 'web'
  }).expect(201);

  await inSpace(member.agent, 'get', '/api/journey-research/gaps', owner.spaceId).expect(200);
  await inSpace(member.agent, 'post', '/api/journey-research/gaps', owner.spaceId).send({
    targetType: 'definition',
    targetId: definition.id,
    title: 'Member denied research gap'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_RESEARCH_FORBIDDEN'));
  await inSpace(admin.agent, 'post', '/api/journey-research/gaps', owner.spaceId).send({
    targetType: 'definition',
    targetId: definition.id,
    title: 'Owned research gap'
  }).set('Idempotency-Key', crypto.randomUUID()).expect(201);

  await inSpace(owner.agent, 'post', '/api/journey-identities/commands', owner.spaceId).send({
    type: 'observe',
    commandId: 'governance-observe-anon-a',
    occurredAt: '2026-08-06T10:00:00.000Z',
    profileId: 'anon-route-a',
    profileKind: 'anonymous',
    identifier: { kind: 'anonymous_id', namespace: 'browser', value: 'session-route-a' },
    sourceFact: {
      factId: 'fact-governance-observe-anon-a',
      source: 'sdk',
      sourceRef: 'event:governance-observe-anon-a',
      occurredAt: '2026-08-06T09:59:58.000Z'
    }
  }).expect(201);
  await inSpace(member.agent, 'get', '/api/journey-identities/profiles', owner.spaceId).expect(200);
  await inSpace(member.agent, 'get', '/api/journey-identities/profiles/anon-route-a/customer-360?purpose=analytics', owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_IDENTITY_FORBIDDEN'));
  await inSpace(member.agent, 'post', '/api/journey-identities/profiles/anon-route-a/export', owner.spaceId)
    .send({ purpose: 'analytics' }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_IDENTITY_FORBIDDEN'));
  await inSpace(member.agent, 'post', '/api/journey-identities/profiles/anon-route-a/privacy-jobs', owner.spaceId)
    .send({ operation: 'suppress', lawfulBasis: 'privacy_request', reason: 'Member cannot open privacy jobs' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_IDENTITY_FORBIDDEN'));
  await inSpace(admin.agent, 'get', '/api/journey-identities/profiles/anon-route-a/customer-360?purpose=analytics', owner.spaceId)
    .expect(200);
  await inSpace(admin.agent, 'post', '/api/journey-identities/profiles/anon-route-a/export', owner.spaceId)
    .send({ purpose: 'analytics' }).expect(201);
  await inSpace(admin.agent, 'post', '/api/journey-identities/profiles/anon-route-a/privacy-jobs', owner.spaceId)
    .send({ operation: 'suppress', lawfulBasis: 'privacy_request', reason: 'Admin governance route check' })
    .expect((response) => {
      assert.ok(response.status === 201 || response.status === 202);
    });

  const suggestion = await inSpace(admin.agent, 'post', `/api/journey-maps/${definition.id}/ai-suggestions`, owner.spaceId)
    .send({ focus: 'Clarify the ownership handoff' }).expect(202);
  await inSpace(member.agent, 'get', `/api/journey-suggestions/${suggestion.body.suggestion.run.id}`, owner.spaceId).expect(200);
  await inSpace(member.agent, 'post',
    `/api/journey-suggestions/${suggestion.body.suggestion.run.id}/changes/${crypto.randomUUID()}/decision`,
    owner.spaceId)
    .send({ expectedRunRevision: 1, decision: 'accepted', reason: 'Member cannot approve suggestions' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_SUGGESTION_FORBIDDEN'));

  const metricDefinitionId = crypto.randomUUID();
  const metricVersionId = crypto.randomUUID();
  const metricAt = '2026-08-06T12:00:00.000Z';
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,name,state,current_version_id,revision,
        idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'journey',?,?,'active',?,1,?,?,?,?,?)`)
      .run(metricDefinitionId, owner.spaceId, definition.id, definition.id, 'Governed metric',
        metricVersionId, `metric-${metricDefinitionId}`, crypto.createHash('sha256').update(metricDefinitionId).digest('hex'),
        owner.userId, metricAt, metricAt);
    db.prepare(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,
        window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,
        population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,
        created_by_user_id,created_at)
      VALUES (?,?,?,1,'operational_import',NULL,'operational','count','higher_is_better',86400,'UTC',2,86400,
        NULL,NULL,'{}','{}','{\"kind\":\"count\"}','{\"kind\":\"count\"}',?,?,?,?,?)`)
      .run(metricVersionId, metricDefinitionId, owner.spaceId,
        crypto.createHash('sha256').update(`content-${metricDefinitionId}`).digest('hex'),
        `metric-version-${metricDefinitionId}`,
        crypto.createHash('sha256').update(`intent-${metricDefinitionId}`).digest('hex'),
        owner.userId, metricAt);
  })();

  await inSpace(member.agent, 'get', '/api/journey-metrics/alert-definitions', owner.spaceId).expect(200);
  await inSpace(member.agent, 'post', '/api/journey-metrics/alert-definitions', owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      journeyDefinitionId: definition.id,
      metricDefinitionId,
      name: 'Member denied alert',
      version: {
        ruleKind: 'small_sample',
        direction: 'any',
        thresholdValue: 0,
        windowSeconds: 172800,
        cooldownSeconds: 3600,
        minimumSampleSize: 2,
        staleAfterSeconds: 3600,
        contradictionMinRatio: 0.4
      },
      versionIdempotencyKey: `alert-version-${crypto.randomUUID()}`
    }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_METRICS_FORBIDDEN'));
  await inSpace(admin.agent, 'post', '/api/journey-metrics/alert-definitions', owner.spaceId)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      journeyDefinitionId: definition.id,
      metricDefinitionId,
      name: 'Admin alert definition',
      version: {
        ruleKind: 'small_sample',
        direction: 'any',
        thresholdValue: 0,
        windowSeconds: 172800,
        cooldownSeconds: 3600,
        minimumSampleSize: 2,
        staleAfterSeconds: 3600,
        contradictionMinRatio: 0.4
      },
      versionIdempotencyKey: `alert-version-${crypto.randomUUID()}`
    }).expect(201);
});

test('journey governance also pins persona, evidence, and space-template boundaries', async () => {
  const owner = await ownerIdentity();
  const admin = await collaborator(owner.spaceId, 'admin', 'persona-template-admin');
  const member = await collaborator(owner.spaceId, 'member', 'persona-template-member');

  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Persona and template governance',
    purpose: 'Pin remaining governance surfaces',
    stageNames: ['Discover']
  });
  const workingMap = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  const stageKey = workingMap.stages[0]!.stageKey;

  await inSpace(member.agent, 'post', `/api/journey-maps/${definition.id}/personas`, owner.spaceId)
    .send({ personaId: crypto.randomUUID() })
    .expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  const persona = await inSpace(admin.agent, 'post', '/api/journey-personas', owner.spaceId).send({
    name: 'Approver persona',
    summary: 'Needs clear approval handoffs.',
    goals: ['Approve quickly']
  }).expect(201);

  await inSpace(member.agent, 'post', '/api/journey-personas', owner.spaceId).send({
    name: 'Member denied persona'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  const linkedMap = await inSpace(admin.agent, 'post', `/api/journey-maps/${definition.id}/personas`, owner.spaceId)
    .send({ personaId: persona.body.id }).expect(200);
  const claimId = linkedMap.body.personas[0].claims.find((claim: any) => claim.type === 'goal').id;

  await inSpace(member.agent, 'delete', `/api/journey-maps/${definition.id}/personas/${persona.body.id}`, owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  const card = await inSpace(owner.agent, 'post', `/api/journey-maps/${definition.id}/cards`, owner.spaceId).send({
    expectedRevision: linkedMap.body.definition.revision,
    stageKey,
    kind: 'action',
    title: 'Submit approval'
  }).expect(201);

  const evidence = await inSpace(admin.agent, 'post', '/api/journey-evidence', owner.spaceId).send({
    targetType: 'persona',
    targetId: persona.body.id,
    sourceType: 'manual_note',
    sourceRef: `note:${crypto.randomUUID()}`,
    sourceLabel: 'Manual approver note',
    excerpt: 'Approvers need an explicit owner before they proceed.',
    assessment: 'supports'
  }).expect(201);

  await inSpace(member.agent, 'post', '/api/journey-evidence', owner.spaceId).send({
    targetType: 'persona',
    targetId: persona.body.id,
    sourceType: 'manual_note',
    sourceRef: `note:${crypto.randomUUID()}`,
    assessment: 'supports'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  await inSpace(member.agent, 'get', `/api/journey-personas/${persona.body.id}/usage`, owner.spaceId)
    .expect(200);
  await inSpace(member.agent, 'get', '/api/journey-evidence', owner.spaceId)
    .query({ targetType: 'persona', targetId: persona.body.id })
    .expect(200);
  await inSpace(member.agent, 'get', `/api/journey-evidence/${evidence.body.id}/source`, owner.spaceId)
    .expect(200);
  await inSpace(member.agent, 'get', `/api/journey-evidence/${evidence.body.id}/audit`, owner.spaceId)
    .expect(200);

  await inSpace(member.agent, 'post',
    `/api/journey-personas/${persona.body.id}/versions/${persona.body.currentVersionId}/claims/${claimId}/evidence`,
    owner.spaceId)
    .send({ expectedRevision: persona.body.revision, evidenceLinkId: evidence.body.id })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(member.agent, 'post', `/api/journey-personas/${persona.body.id}/versions/${persona.body.currentVersionId}/submit`, owner.spaceId)
    .send({ expectedRevision: persona.body.revision, comment: 'Member cannot submit for review.' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(member.agent, 'post', `/api/journey-personas/${persona.body.id}/versions/${persona.body.currentVersionId}/withdraw`, owner.spaceId)
    .send({ expectedRevision: persona.body.revision, comment: 'Member cannot withdraw review.' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(member.agent, 'delete', `/api/journey-personas/${persona.body.id}`, owner.spaceId)
    .send({ expectedRevision: persona.body.revision })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(member.agent, 'patch', `/api/journey-evidence/${evidence.body.id}`, owner.spaceId)
    .send({ invalidated: true, reason: 'Member cannot invalidate evidence.' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
  await inSpace(member.agent, 'delete', `/api/journey-evidence/${evidence.body.id}`, owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  const linkedPersona = await inSpace(admin.agent, 'post',
    `/api/journey-personas/${persona.body.id}/versions/${persona.body.currentVersionId}/claims/${claimId}/evidence`,
    owner.spaceId)
    .send({ expectedRevision: persona.body.revision, evidenceLinkId: evidence.body.id })
    .expect(201);
  const refreshFingerprint = linkedPersona.body.claims.find((claim: any) => claim.id === claimId).evidence[0].fingerprint;
  await inSpace(member.agent, 'post', `/api/journey-evidence/${evidence.body.id}/refresh`, owner.spaceId)
    .send({ expectedFingerprint: refreshFingerprint })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));

  const createdTemplate = await inSpace(admin.agent, 'post', '/api/journey-templates', owner.spaceId).send({
    key: `governance-template-${crypto.randomUUID().slice(0, 8)}`,
    content: templateContent('Governance')
  }).expect(201);
  const templateVersion = createdTemplate.body.versions[0];

  await inSpace(member.agent, 'get', '/api/journey-templates', owner.spaceId)
    .query({ includeDrafts: 'true' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'get',
    `/api/journey-templates/${createdTemplate.body.id}/versions/${templateVersion.id}`,
    owner.spaceId)
    .query({ includeDraft: 'true' })
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'get', `/api/journey-templates/${createdTemplate.body.id}/audit`, owner.spaceId)
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'post', '/api/journey-templates', owner.spaceId).send({
    key: `member-denied-${crypto.randomUUID().slice(0, 8)}`,
    content: templateContent('Member denied')
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'post', `/api/journey-templates/${createdTemplate.body.id}/versions`, owner.spaceId).send({
    expectedTemplateRevision: createdTemplate.body.revision,
    content: templateContent('Second draft')
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'put',
    `/api/journey-templates/${createdTemplate.body.id}/versions/${templateVersion.id}`,
    owner.spaceId).send({
    expectedTemplateRevision: createdTemplate.body.revision,
    expectedVersionRevision: templateVersion.revision,
    content: templateContent('Updated draft')
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'post',
    `/api/journey-templates/${createdTemplate.body.id}/versions/${templateVersion.id}/publish`,
    owner.spaceId).send({
    expectedTemplateRevision: createdTemplate.body.revision,
    expectedVersionRevision: templateVersion.revision,
    reason: 'Member cannot publish.'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'post',
    `/api/journey-templates/${createdTemplate.body.id}/versions/${templateVersion.id}/retire`,
    owner.spaceId).send({
    expectedTemplateRevision: createdTemplate.body.revision,
    expectedVersionRevision: templateVersion.revision,
    reason: 'Member cannot retire.'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED'));
  await inSpace(member.agent, 'post',
    `/api/journey-templates/${createdTemplate.body.id}/versions/${templateVersion.id}/create-map`,
    owner.spaceId).send({})
    .expect(403).expect(({ body }) => assert.equal(body.code, 'JOURNEY_MAP_FORBIDDEN'));
});

test('platform template governance enforces platform role, permission, and origin boundaries', async () => {
  const rootAgent = await ownerIdentity();
  const viewer = await collaborator(rootAgent.spaceId, 'member', 'platform-viewer');
  const ordinary = await collaborator(rootAgent.spaceId, 'member', 'platform-ordinary');
  grantPlatformRole(viewer.userId, 'viewer', 'Journey template permission boundary test');

  const adminList = await rootAgent.agent.get('/api/platform-admin/journey-templates').expect(200);
  const systemTemplate = adminList.body.templates[0];
  assert.ok(systemTemplate);
  const systemVersion = systemTemplate.versions[0];

  await viewer.agent.get(`/api/platform-admin/journey-templates/${systemTemplate.id}/versions/${systemVersion.id}`)
    .expect(200);
  await viewer.agent.post('/api/platform-admin/journey-templates')
    .send({ key: `viewer-blocked-${crypto.randomUUID().slice(0, 8)}`, content: templateContent('Viewer blocked') })
    .expect(403)
    .expect(({ body }) => {
      assert.equal(body.code, 'ADMIN_PERMISSION_REQUIRED');
      assert.equal(body.permission, 'journey_templates.manage');
    });
  await viewer.agent.post(`/api/platform-admin/journey-templates/${systemTemplate.id}/versions/${systemVersion.id}/reject`)
    .send({
      expectedTemplateRevision: systemTemplate.revision,
      expectedVersionRevision: systemVersion.revision,
      reason: 'Viewer cannot reject.'
    })
    .expect(403)
    .expect(({ body }) => {
      assert.equal(body.code, 'ADMIN_PERMISSION_REQUIRED');
      assert.equal(body.permission, 'journey_templates.manage');
    });

  await ordinary.agent.get('/api/platform-admin/journey-templates')
    .expect(403)
    .expect(({ body }) => assert.equal(body.code, 'PLATFORM_ADMIN_REQUIRED'));

  await rootAgent.agent.post('/api/platform-admin/journey-templates')
    .set('Origin', 'http://evil.test')
    .send({ key: `origin-blocked-${crypto.randomUUID().slice(0, 8)}`, content: templateContent('Origin blocked') })
    .expect(403)
    .expect(({ body }) => assert.equal(body.code, 'ADMIN_ORIGIN_REJECTED'));
});
