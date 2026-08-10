import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-workspace-saved-views-'));
for (const [name, value] of Object.entries({
  'admin-password': 'Workspace-Saved-Views-Admin-Password-2026!',
  'session-secret': 'workspace-saved-views-session-secret-that-is-long-enough',
  'terra-secret': 'workspace-saved-views-terra-secret-that-is-long-enough',
  'x-key': Buffer.alloc(32, 101).toString('base64url'),
  'esign-key': Buffer.alloc(32, 102).toString('base64url')
})) fs.writeFileSync(path.join(root, name), value);

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'workspace-saved-views@seemplify.local', ADMIN_PASSWORD_FILE: path.join(root, 'admin-password'),
  SESSION_SECRET_FILE: path.join(root, 'session-secret'), TERRA_GATEWAY_SHARED_SECRET_FILE: path.join(root, 'terra-secret'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra-secret'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: path.join(root, 'x-key'), ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: path.join(root, 'esign-key'), X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const views = await import('../src/journeyWorkspaceSavedViews.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function owner() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'workspace-saved-views@seemplify.local', password: 'Workspace-Saved-Views-Admin-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id), userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

async function member(spaceId: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Saved view member', email: 'workspace-saved-view-member@example.test',
    password: 'Workspace-Saved-View-Member-Password-2026!', spaceName: 'Saved view member home'
  });
  const session = await agent.get('/api/auth/session').expect(200), userId = String(session.body.user.id);
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)`)
    .run(spaceId, userId, at, at);
  return userId;
}

const hierarchyConfiguration = {
  version: 1 as const, includeRetired: false, rootDefinitionId: null, direction: 'both' as const,
  taxonomyKinds: ['product'] as const, reviewStates: ['approved'] as const, lifecycles: ['active'] as const
};
const blueprintConfiguration = {
  version: 1 as const, blueprintId: null, versionMode: 'comparison' as const,
  selectedSection: 'analysis' as const, lifecycles: ['approved'] as const
};

test('runtime55 migration declares exact predecessor, tenant keys and append-only guards', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations', 'postgres',
    '0055_journey_workspace_saved_views.sql'), 'utf8');
  assert.match(sql, /MAX\(version\)[\s\S]*<>54/u);
  for (const table of ['journey_workspace_view_definitions','journey_workspace_view_versions',
    'journey_workspace_view_preferences','journey_workspace_view_operations','journey_workspace_view_audit_events']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`, 'u'));
  }
  assert.match(sql, /FOREIGN KEY\(space_id,owner_user_id\) REFERENCES space_memberships\(space_id,user_id\)/u);
  assert.match(sql, /workspace_view_versions_guard BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /default workspace view must be an active user-owned view for the same surface/u);
  assert.match(sql, /REVOKE UPDATE,DELETE ON journey_workspace_view_versions/u);
});

test('private hierarchy and blueprint views are revisioned, replay-safe and surface-scoped', async () => {
  const identity = await owner();
  const created = views.createJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    surface: 'hierarchy', audience: 'internal', name: 'My hierarchy', configuration: hierarchyConfiguration,
    makeDefault: true, idempotencyKey: 'create-hierarchy-view', at: '2026-08-08T14:00:00.000Z' });
  assert.equal(created.replayed, false);
  assert.deepEqual(views.createJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    surface: 'hierarchy', audience: 'internal', name: 'My hierarchy', configuration: hierarchyConfiguration,
    makeDefault: true, idempotencyKey: 'create-hierarchy-view', at: '2026-08-08T14:00:01.000Z' }),
  { viewId: created.viewId, preferenceRevision: 1, replayed: true });
  let listed = views.listJourneyWorkspaceSavedViews({ ...identity, actorUserId: identity.userId, surface: 'hierarchy' });
  assert.equal(listed.defaultViewId, created.viewId);
  assert.equal(listed.preferenceRevision, 1);
  assert.equal(listed.views[0]?.configurationSha256.length, 64);
  assert.equal(listed.views[0]?.versionNumber, 1);

  const revised = views.reviseJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    viewId: created.viewId, expectedRevision: 1, audience: 'executive', name: 'Executive hierarchy',
    configuration: { ...hierarchyConfiguration, direction: 'downstream' }, idempotencyKey: 'revise-hierarchy-view',
    at: '2026-08-08T14:01:00.000Z' });
  assert.equal(revised.replayed, false);
  listed = views.listJourneyWorkspaceSavedViews({ ...identity, actorUserId: identity.userId, surface: 'hierarchy' });
  assert.equal(listed.views[0]?.revision, 2);
  assert.equal(listed.views[0]?.versionNumber, 2);
  assert.equal(listed.views[0]?.audience, 'executive');
  assert.throws(() => views.reviseJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    viewId: created.viewId, expectedRevision: 1, audience: 'internal', name: 'Stale',
    configuration: hierarchyConfiguration, idempotencyKey: 'stale-revise' }),
  (error: any) => error.code === 'JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');

  const blueprint = views.createJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    surface: 'service_blueprint', audience: 'delivery', name: 'Delivery blueprint',
    configuration: blueprintConfiguration, idempotencyKey: 'create-blueprint-view' });
  assert.equal(views.listJourneyWorkspaceSavedViews({ ...identity, actorUserId: identity.userId,
    surface: 'service_blueprint' }).views[0]?.id, blueprint.viewId);
  assert.throws(() => views.setJourneyWorkspaceDefaultView({ ...identity, actorUserId: identity.userId,
    surface: 'service_blueprint', viewId: created.viewId, expectedRevision: 0, idempotencyKey: 'wrong-surface-default' }),
  (error: any) => error.code === 'JOURNEY_WORKSPACE_VIEW_NOT_FOUND');
});

test('members own their views, cannot enumerate another owner, and retirement clears defaults', async () => {
  const identity = await owner(), memberId = await member(identity.spaceId);
  const ownerView = views.createJourneyWorkspaceSavedView({ spaceId: identity.spaceId, actorUserId: identity.userId,
    surface: 'hierarchy', audience: 'research', name: 'Owner only', configuration: hierarchyConfiguration,
    idempotencyKey: 'owner-private-view' });
  assert.equal(views.listJourneyWorkspaceSavedViews({ spaceId: identity.spaceId, actorUserId: memberId,
    surface: 'hierarchy' }).views.length, 0);
  assert.throws(() => views.reviseJourneyWorkspaceSavedView({ spaceId: identity.spaceId, actorUserId: memberId,
    viewId: ownerView.viewId, expectedRevision: 1, audience: 'internal', name: 'Takeover',
    configuration: hierarchyConfiguration, idempotencyKey: 'member-takeover' }),
  (error: any) => error.code === 'JOURNEY_WORKSPACE_VIEW_NOT_FOUND');

  const own = views.createJourneyWorkspaceSavedView({ spaceId: identity.spaceId, actorUserId: memberId,
    surface: 'hierarchy', audience: 'research', name: 'Member research', configuration: hierarchyConfiguration,
    makeDefault: true, idempotencyKey: 'member-own-view' });
  views.retireJourneyWorkspaceSavedView({ spaceId: identity.spaceId, actorUserId: memberId,
    viewId: own.viewId, expectedRevision: 1, idempotencyKey: 'member-retire-view' });
  const listed = views.listJourneyWorkspaceSavedViews({ spaceId: identity.spaceId, actorUserId: memberId,
    surface: 'hierarchy' });
  assert.equal(listed.views.length, 0);
  assert.equal(listed.defaultViewId, null);
  assert.equal(listed.preferenceRevision, 2);
});

test('configuration is exact and immutable history rejects mutation', async () => {
  const identity = await owner();
  assert.throws(() => views.createJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    surface: 'hierarchy', audience: 'external', name: 'Unsafe',
    configuration: { ...hierarchyConfiguration, query: 'select * from users' }, idempotencyKey: 'unsafe-config' }),
  (error: any) => error.code === 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  const created = views.createJourneyWorkspaceSavedView({ ...identity, actorUserId: identity.userId,
    surface: 'service_blueprint', audience: 'external', name: 'External blueprint',
    configuration: blueprintConfiguration, idempotencyKey: 'immutable-blueprint' });
  const version = db.prepare(`SELECT current_version_id FROM journey_workspace_view_definitions
    WHERE id=? AND space_id=?`).get(created.viewId, identity.spaceId) as any;
  assert.throws(() => db.prepare(`UPDATE journey_workspace_view_versions SET configuration_sha256=? WHERE id=?`)
    .run('0'.repeat(64), version.current_version_id), /append-only/u);
  const audit = db.prepare(`SELECT detail_json FROM journey_workspace_view_audit_events WHERE view_id=?`)
    .all(created.viewId) as Array<{ detail_json: string }>;
  assert.equal(audit.some((row) => /select \*|users/iu.test(row.detail_json)), false);
});

test('mounted routes derive tenancy and enforce strict idempotent contracts', async () => {
  const identity = await owner();
  const endpoint = '/api/journey-workspace-saved-views';
  await identity.agent.post(endpoint).set('X-Seemplify-Space', identity.spaceId).send({
    surface: 'hierarchy', audience: 'internal', name: 'Missing key', configuration: hierarchyConfiguration
  }).expect(400);
  const before = await identity.agent.get(`${endpoint}?surface=hierarchy`)
    .set('X-Seemplify-Space', identity.spaceId).expect(200);
  const created = await identity.agent.post(endpoint).set('X-Seemplify-Space', identity.spaceId)
    .set('Idempotency-Key', 'route-create-workspace-view').send({
      surface: 'hierarchy', audience: 'internal', name: 'Route hierarchy',
      configuration: hierarchyConfiguration, makeDefault: true,
      expectedPreferenceRevision: before.body.preferenceRevision
    }).expect(201);
  assert.equal(typeof created.body.viewId, 'string');
  const listed = await identity.agent.get(`${endpoint}?surface=hierarchy`)
    .set('X-Seemplify-Space', identity.spaceId).expect(200);
  assert.equal(listed.body.defaultViewId, created.body.viewId);
  assert.equal(listed.body.views.some((entry: any) => entry.name === 'Route hierarchy'), true);
  await identity.agent.patch(`${endpoint}/${created.body.viewId}`).set('X-Seemplify-Space', identity.spaceId)
    .set('Idempotency-Key', 'route-invalid-workspace-view').send({
      expectedRevision: 1, audience: 'external', name: 'Unsafe route',
      configuration: { ...hierarchyConfiguration, query: 'owner_user_id' }
    }).expect(400);
  await identity.agent.put(`${endpoint}/default/hierarchy`).set('X-Seemplify-Space', identity.spaceId)
    .set('Idempotency-Key', 'route-reset-workspace-view')
    .send({ viewId: null, expectedRevision: created.body.preferenceRevision }).expect(200);
});
