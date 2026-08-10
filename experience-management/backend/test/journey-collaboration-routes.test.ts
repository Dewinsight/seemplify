import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-collaboration-routes-'));
const secret = (name: string, value: string) => { const file = path.join(root, name); fs.writeFileSync(file, value); return file; };
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-collaboration-routes@seemplify.local',
  ADMIN_PASSWORD_FILE: secret('admin-password', 'Journey-Collaboration-Routes-2026!'),
  SESSION_SECRET_FILE: secret('session-secret', 'journey-collaboration-routes-session-secret-long-enough'),
  TERRA_GATEWAY_SHARED_SECRET_FILE: secret('terra-secret', 'journey-collaboration-routes-terra-secret-long-enough'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra-secret'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: secret('x-key', Buffer.alloc(32, 73).toString('base64url')),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: secret('esign-key', Buffer.alloc(32, 74).toString('base64url')),
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function ownerIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'journey-collaboration-routes@seemplify.local',
    password: 'Journey-Collaboration-Routes-2026!' }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id); const userId = String(session.body.user.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId };
}

async function collaborator(spaceId: string | null, role: 'admin' | 'member', suffix: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, { name: `Collaboration ${suffix}`, email: `collaboration-route-${suffix}@example.test`,
    password: 'Journey-Collaboration-Member-2026!', spaceName: `Collaboration ${suffix} home` });
  const session = await agent.get('/api/auth/session').expect(200); const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  if (spaceId) {
    const at = new Date().toISOString();
    db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)')
      .run(spaceId, userId, role, at, at);
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, userId);
  }
  return { agent, userId, homeSpaceId };
}

function call(agent: ReturnType<typeof request.agent>, method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  url: string, spaceId: string, idempotent = false) {
  const value = agent[method](url).set('X-Seemplify-Space', spaceId);
  return idempotent ? value.set('Idempotency-Key', crypto.randomUUID()).set('X-Request-Id', crypto.randomUUID()) : value;
}

test('mounted collaboration API governs roles, threads, notifications, reviews and content-free activity', async () => {
  const owner = await ownerIdentity(); const manager = await collaborator(owner.spaceId, 'admin', 'manager');
  const member = await collaborator(owner.spaceId, 'member', 'member');
  const second = await collaborator(owner.spaceId, 'member', 'second');
  const outsider = await collaborator(null, 'member', 'outsider');
  const journey = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Collaboration route journey', stageNames: ['Start'] });
  const foreign = maps.createJourneyMap(outsider.homeSpaceId, outsider.userId, { name: 'Foreign route journey', stageNames: ['Start'] });
  const target = { targetType: 'journey_map', targetId: journey.id };

  const plan = await call(member.agent, 'get', '/api/journey-collaboration/context', owner.spaceId).expect(200);
  assert.equal(plan.body.role, 'viewer'); assert.ok(plan.body.capabilities.includes('journeys.comment'));
  await call(member.agent, 'get', `/api/journey-collaboration/comments?targetType=journey_map&targetId=${foreign.id}`,
    owner.spaceId).expect(404).expect(({ body }) => assert.equal(body.code, 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND'));

  const assignment = await call(owner.agent, 'post', '/api/journey-collaboration/roles', owner.spaceId, true)
    .send({ userId: second.userId, role: 'approver', scopeType: 'space' }).expect(201);
  await call(owner.agent, 'get', '/api/journey-collaboration/roles?state=active&limit=20', owner.spaceId).expect(200)
    .expect(({ body }) => assert.ok(body.items.some((item: any) => item.id === assignment.body.assignment.id)));

  await call(owner.agent, 'put', '/api/journey-collaboration/watchers', owner.spaceId, true)
    .send({ target, state: 'watching' }).expect(200);
  const rootComment = await call(member.agent, 'post', '/api/journey-collaboration/comments', owner.spaceId, true)
    .send({ target, body: 'Please review the checkout handoff.', mentionUserIds: [owner.userId] }).expect(201);
  const rootId = rootComment.body.comment.id;
  await call(second.agent, 'post', '/api/journey-collaboration/comments', owner.spaceId, true)
    .send({ target, parentCommentId: rootId, body: 'I can review this decision.' }).expect(201);
  const edited = await call(member.agent, 'patch', `/api/journey-collaboration/comments/${rootId}`, owner.spaceId, true)
    .send({ expectedRevision: 1, body: 'Please review the revised checkout handoff.', mentionUserIds: [owner.userId],
      editReason: 'Clarified request.' }).expect(200);
  assert.equal(edited.body.comment.revision, 2);
  await call(owner.agent, 'get', `/api/journey-collaboration/comments/${rootId}/history?limit=20`, owner.spaceId)
    .expect(200).expect(({ body }) => assert.equal(body.items.length, 2));
  const resolved = await call(manager.agent, 'post', `/api/journey-collaboration/comments/${rootId}/resolve`, owner.spaceId, true)
    .send({ expectedRevision: 2 }).expect(200);
  await call(manager.agent, 'post', `/api/journey-collaboration/comments/${rootId}/reopen`, owner.spaceId, true)
    .send({ expectedRevision: resolved.body.comment.revision }).expect(200);
  await call(owner.agent, 'get', `/api/journey-collaboration/watchers?targetType=journey_map&targetId=${journey.id}&limit=20`,
    owner.spaceId).expect(200).expect(({ body }) => assert.ok(body.items.some((item: any) => item.user.id === owner.userId)));

  const notifications = await call(owner.agent, 'get', '/api/journey-collaboration/notifications?state=unread&limit=20', owner.spaceId).expect(200);
  assert.ok(notifications.body.items.length > 0);
  await call(owner.agent, 'patch', `/api/journey-collaboration/notifications/${notifications.body.items[0].id}`, owner.spaceId)
    .send({ expectedRevision: notifications.body.items[0].revision, state: 'read' }).expect(200);

  const review = await call(owner.agent, 'post', '/api/journey-collaboration/governance/reviews', owner.spaceId, true)
    .send({ target, summary: 'Checkout map is ready for review.', reason: 'Publication governance required.' }).expect(201);
  await call(owner.agent, 'post', `/api/journey-collaboration/governance/reviews/${review.body.review.id}/decision`,
    owner.spaceId, true).send({ expectedRevision: 1, decision: 'approve', summary: 'Approved.', reason: 'Meets policy.' })
    .expect(409).expect(({ body }) => assert.equal(body.code, 'JOURNEY_GOVERNANCE_SELF_APPROVAL_FORBIDDEN'));
  const approved = await call(manager.agent, 'post', `/api/journey-collaboration/governance/reviews/${review.body.review.id}/decision`,
    owner.spaceId, true).send({ expectedRevision: 1, decision: 'approve', summary: 'Approved.', reason: 'Meets policy.' }).expect(200);
  await call(manager.agent, 'post', `/api/journey-collaboration/governance/reviews/${review.body.review.id}/publish`,
    owner.spaceId, true).send({ expectedRevision: approved.body.review.revision, reason: 'Release approved.' }).expect(200);

  const activity = await call(member.agent, 'get', `/api/journey-collaboration/activity?targetType=journey_map&targetId=${journey.id}&limit=100`,
    owner.spaceId).expect(200);
  assert.ok(activity.body.items.some((item: any) => item.action === 'comment.created'));
  assert.equal(JSON.stringify(activity.body).includes('revised checkout handoff'), false);

  await call(owner.agent, 'post', `/api/journey-collaboration/roles/${assignment.body.assignment.id}/revoke`, owner.spaceId, true)
    .send({ expectedRevision: assignment.body.assignment.revision, reason: 'Review complete.' }).expect(200);

  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  await call(member.agent, 'post', '/api/journey-collaboration/comments', owner.spaceId, true)
    .send({ target, body: 'Blocked by entitlement.' }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);
  const settings = await call(owner.agent, 'get', '/api/journey-collaboration/settings', owner.spaceId).expect(200);
  await call(owner.agent, 'patch', '/api/journey-collaboration/settings', owner.spaceId, true).send({
    expectedRevision: settings.body.settings.revision, enabled: false,
    commentsEnabled: settings.body.settings.commentsEnabled, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: settings.body.settings.commentRetentionDays,
    viewRetentionDays: settings.body.settings.viewRetentionDays,
    maximumShareDays: settings.body.settings.maximumShareDays, securityReviewReference: null
  }).expect(200);
  await call(member.agent, 'post', '/api/journey-collaboration/comments', owner.spaceId, true)
    .send({ target, body: 'Blocked by kill switch.' }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_COLLABORATION_READ_ONLY'));
});

test('read-only Journey shares are permissioned, rotatable, revocable and fail closed on public access', async () => {
  const owner = await ownerIdentity();
  const member = await collaborator(owner.spaceId, 'member', 'share-member');
  const journey = maps.createJourneyMap(owner.spaceId, owner.userId, {
    name: 'External checkout journey', stageNames: ['Discover', 'Buy']
  });
  const current = await call(owner.agent, 'get', '/api/journey-collaboration/settings', owner.spaceId).expect(200);
  await call(owner.agent, 'patch', '/api/journey-collaboration/settings', owner.spaceId, true).send({
    expectedRevision: current.body.settings.revision,
    enabled: true, commentsEnabled: true, sharingEnabled: true, externalDownloadsEnabled: true,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: 'SECURITY-REVIEW-2026-08'
  }).expect(200);

  await call(member.agent, 'get', '/api/journey-collaboration/shares', owner.spaceId).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_CAPABILITY_REQUIRED'));

  const key = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const created = await owner.agent.post('/api/journey-collaboration/shares')
    .set('X-Seemplify-Space', owner.spaceId).set('Idempotency-Key', key)
    .send({ targetType: 'journey_map', targetId: journey.id, expiresAt,
      allowExport: true, allowDownload: false }).expect(201);
  assert.match(created.body.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(created.body.share.state, 'active');
  assert.equal(created.body.replayed, false);

  const replay = await owner.agent.post('/api/journey-collaboration/shares')
    .set('X-Seemplify-Space', owner.spaceId).set('Idempotency-Key', key)
    .send({ targetType: 'journey_map', targetId: journey.id, expiresAt,
      allowExport: true, allowDownload: false }).expect(201);
  assert.equal(replay.body.token, created.body.token);
  assert.equal(replay.body.replayed, true);

  const publicView = await request(app).get(`/api/public/journey-shares/${created.body.token}`).expect(200);
  assert.equal(publicView.body.snapshot.schemaVersion, 2);
  assert.equal(publicView.body.snapshot.content.kind, 'journey_map');
  assert.equal(publicView.body.snapshot.content.definition.name, 'External checkout journey');
  assert.equal(JSON.stringify(publicView.body).includes(owner.userId), false);
  for (const field of ['id', 'targetId', 'tokenPrefix', 'checksum']) {
    assert.equal(Object.hasOwn(publicView.body.share, field), false, `public share must omit ${field}`);
  }
  assert.equal(Object.hasOwn(publicView.body.snapshot, 'targetId'), false);
  assert.equal(Object.hasOwn(publicView.body.snapshot.content.definition, 'id'), false);
  await request(app).get(`/api/public/journey-shares/${created.body.token}?action=download`).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_SHARE_DOWNLOAD_FORBIDDEN'));

  const rotationKey = crypto.randomUUID();
  const rotated = await owner.agent.post(`/api/journey-collaboration/shares/${created.body.share.id}/rotate`)
    .set('X-Seemplify-Space', owner.spaceId).set('Idempotency-Key', rotationKey)
    .send({ expectedRevision: created.body.share.revision }).expect(200);
  assert.notEqual(rotated.body.token, created.body.token);
  const rotationReplay = await owner.agent.post(`/api/journey-collaboration/shares/${created.body.share.id}/rotate`)
    .set('X-Seemplify-Space', owner.spaceId).set('Idempotency-Key', rotationKey)
    .send({ expectedRevision: created.body.share.revision }).expect(200);
  assert.equal(rotationReplay.body.token, rotated.body.token);
  assert.equal(rotationReplay.body.replayed, true);
  await owner.agent.post('/api/journey-collaboration/shares')
    .set('X-Seemplify-Space', owner.spaceId).set('Idempotency-Key', key)
    .send({ targetType: 'journey_map', targetId: journey.id, expiresAt,
      allowExport: true, allowDownload: false }).expect(409)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_SHARE_REPLAY_SUPERSEDED'));
  await request(app).get(`/api/public/journey-shares/${created.body.token}`).expect(404);
  await request(app).get(`/api/public/journey-shares/${rotated.body.token}`).expect(200);

  const enabledSettings = await call(owner.agent, 'get', '/api/journey-collaboration/settings', owner.spaceId).expect(200);
  await call(owner.agent, 'patch', '/api/journey-collaboration/settings', owner.spaceId, true).send({
    expectedRevision: enabledSettings.body.settings.revision,
    enabled: true, commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: null
  }).expect(200);
  await request(app).get(`/api/public/journey-shares/${rotated.body.token}`).expect(404)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_SHARE_UNAVAILABLE'));

  const revoked = await call(owner.agent, 'post',
    `/api/journey-collaboration/shares/${created.body.share.id}/revoke`, owner.spaceId, true)
    .send({ expectedRevision: rotated.body.share.revision, reason: 'The external review period has ended.' }).expect(200);
  assert.equal(revoked.body.share.state, 'revoked');
  await request(app).get(`/api/public/journey-shares/${rotated.body.token}`).expect(404)
    .expect(({ body }) => assert.equal(body.code, 'JOURNEY_SHARE_UNAVAILABLE'));

  const accessEvents = db.prepare(`SELECT outcome,reason_code,requested_action FROM journey_share_access_events
    WHERE share_id=? ORDER BY created_at,id`).all(created.body.share.id) as any[];
  assert.ok(accessEvents.some((event) => event.outcome === 'allowed' && event.requested_action === 'view'));
  assert.ok(accessEvents.some((event) => event.outcome === 'denied'));
  assert.equal(JSON.stringify(accessEvents).includes(created.body.token), false);
});
