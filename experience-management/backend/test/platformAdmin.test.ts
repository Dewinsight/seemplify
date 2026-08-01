import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { after, test } from 'node:test';
import express from 'express';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-platform-admin-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
fs.writeFileSync(passwordFile, 'Test-Platform-Admin-2026!');
fs.writeFileSync(sessionFile, 'test-platform-session-secret-that-is-long-enough');
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  PUBLIC_URL: 'http://127.0.0.1:5499',
  PORT: '5499',
  ADMIN_EMAIL: 'platform-admin@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  SUBSCRIPTION_ENFORCEMENT_ENABLED: 'true',
  LOCAL_LLM_SHARED_SECRET_FILE: sessionFile,
  KNOWLEDGE_RUNTIME_BASE_URL: 'http://knowledge-admin.test',
  KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log'
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'knowledge-admin.test' && url.pathname === '/v1/status') {
    return new Response(JSON.stringify({ ready: true, version: 'admin-test', components: { arango: { ready: true } },
      queue: { waiting: 3 }, rollout: { percent: 0 }, nestedTelemetry: { preserved: true } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected platform admin test request: ${String(input)}`);
};

const { db } = await import('../src/database.js');
const {
  bootstrapAdminAccount, currentSessionUser, issueEmailVerificationToken, issuePasswordResetToken,
  login, resetPassword, session, verifyEmail
} = await import('../src/auth.js');
const { platformAdminRouter, subscriptionRouter } = await import('../src/platformAdmin.js');
const { createSpace, resolveRequestSpace, SpaceError } = await import('../src/spaces.js');

const rootUserId = bootstrapAdminAccount();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.post('/login', login);
app.post('/reset-password', resetPassword);
app.post('/verify-email', verifyEmail);
app.get('/session', session);
app.use('/api/platform-admin', platformAdminRouter);
app.use('/api/subscription', subscriptionRouter);
app.get('/api/social/check', (request, response) => {
  try {
    const user = currentSessionUser(request);
    if (!user) return response.status(401).json({ error: 'Authentication required.' });
    return response.json({ space: resolveRequestSpace(request, user.id) });
  } catch (error) {
    if (error instanceof SpaceError) return response.status(error.status).json({ error: error.message, code: error.code });
    throw error;
  }
});

function seedUser(email: string, name: string, verified = true) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const rootPassword = (db.prepare('SELECT password_hash FROM users WHERE id=?').get(rootUserId) as { password_hash: string }).password_hash;
  db.prepare(`INSERT INTO users
    (id,email,name,password_hash,role,session_version,email_verified_at,password_claim_required,account_status,created_at,updated_at)
    VALUES (?,?,?,?, 'member',1,?,0,'active',?,?)`).run(id, email, name, rootPassword, verified ? now : null, now, now);
  const space = createSpace({ id, name }, { name: `${name} workspace` });
  return { id, email, spaceId: space.id };
}

async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post('/login').send({ email, password: 'Test-Platform-Admin-2026!' }).expect(200);
  return agent;
}

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('platform administration is authenticated and exposes privacy-safe operational projections', async () => {
  await request(app).get('/api/platform-admin/overview').expect(401);
  const agent = request.agent(app);
  await agent.post('/login').send({
    email: 'platform-admin@seemplify.local',
    password: 'Test-Platform-Admin-2026!'
  }).expect(200);

  const me = await agent.get('/api/platform-admin/me').expect(200);
  assert.equal(me.body.root, true);
  assert.ok(me.body.roles.includes('superadmin'));

  const overview = await agent.get('/api/platform-admin/overview').expect(200);
  assert.equal(overview.body.accounts.total, 1);
  assert.equal(overview.body.spaces.total, 1);
  assert.equal(overview.body.subscriptions.pendingRequests, 0);

  const users = await agent.get('/api/platform-admin/users?q=platform-admin&page=1&limit=25').expect(200);
  assert.equal(users.body.items.length, 1);
  assert.equal(users.body.users.length, 1);
  assert.equal(users.body.total, 1);
  assert.equal(users.body.page, 1);
  assert.equal(users.body.users[0].accountStatus, 'active');
  assert.equal(users.body.users[0].status, 'active');
  assert.equal('passwordHash' in users.body.users[0], false);

  const detail = await agent.get(`/api/platform-admin/users/${users.body.users[0].id}`).expect(200);
  assert.equal(detail.body.user.email, 'platform-admin@seemplify.local');
  assert.equal(detail.body.memberships.length, 1);
  assert.equal(detail.body.spaces.length, 1);
  assert.equal('password_hash' in detail.body.user, false);

  const runtime = await agent.get('/api/platform-admin/knowledge-runtime').expect(200);
  assert.equal(runtime.body.runtime.ready, true);
  assert.deepEqual(runtime.body.runtime.nestedTelemetry, { preserved: true });
  const tenant = seedUser('knowledge-tenant@example.test', 'Knowledge Tenant');
  const tenantAgent = await loginAs(tenant.email);
  await tenantAgent.get('/api/platform-admin/knowledge-runtime').expect(403);
  await tenantAgent.post('/api/platform-admin/knowledge-backfills').send({}).expect(403);
  const audit = await agent.get('/api/platform-admin/audit-events?search=knowledge').expect(200);
  assert.ok(Array.isArray(audit.body.events));
});

test('subscription requests are durable, versioned, approved explicitly, and audited', async () => {
  const agent = request.agent(app);
  await agent.post('/login').send({
    email: 'platform-admin@seemplify.local',
    password: 'Test-Platform-Admin-2026!'
  }).expect(200);

  const plans = await agent.get('/api/subscription/plans').expect(200);
  assert.deepEqual(plans.body.plans.map((plan: any) => plan.code), ['starter', 'team', 'enterprise']);
  const initial = await agent.get('/api/subscription/current').expect(200);
  assert.equal(initial.body.subscription.planCode, 'enterprise');
  assert.equal(initial.body.effectivePlan.code, 'enterprise');
  assert.equal(initial.body.entitlement.source, 'managed');

  const created = await agent.post('/api/subscription/requests').send({
    requestType: 'activate',
    planCode: 'team',
    note: 'Please enable collaboration for our research team.'
  }).expect(201);
  assert.equal(created.body.request.status, 'pending');
  assert.equal(created.body.request.version, 1);

  await agent.post('/api/subscription/requests').send({
    requestType: 'activate',
    planCode: 'enterprise',
    note: 'This duplicate request must be rejected.'
  }).expect(409);

  const pending = await agent.get('/api/platform-admin/subscription-requests?status=pending&page=1&limit=25').expect(200);
  assert.equal(pending.body.total, 1);
  assert.equal(pending.body.items[0].id, created.body.request.id);

  const approved = await agent.post(`/api/platform-admin/subscription-requests/${created.body.request.id}/decision`).send({
    decision: 'approved',
    reviewNote: 'Approved after the requested plan and limits were reviewed.',
    expectedVersion: 1,
    breakGlass: false
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_BREAK_GLASS_REQUIRED'));

  const approvedWithBreakGlass = await agent.post(`/api/platform-admin/subscription-requests/${created.body.request.id}/decision`).send({
    decision: 'approved',
    reviewNote: 'Approved with explicit break-glass because this administrator belongs to the requesting space.',
    expectedVersion: 1,
    breakGlass: true
  }).expect(200);
  assert.equal(approvedWithBreakGlass.body.request.status, 'approved');
  assert.equal(approvedWithBreakGlass.body.subscription.planCode, 'team');
  assert.equal(approvedWithBreakGlass.body.subscription.status, 'active');

  await agent.post(`/api/platform-admin/subscription-requests/${created.body.request.id}/decision`).send({
    decision: 'rejected',
    reviewNote: 'A stale duplicate decision must not overwrite approval.',
    expectedVersion: 1,
    breakGlass: true
  }).expect(409);

  const current = await agent.get('/api/subscription/current').expect(200);
  assert.equal(current.body.subscription.planCode, 'team');
  const audit = await agent.get('/api/platform-admin/audit-events?search=subscription_request').expect(200);
  assert.ok(audit.body.events.some((event: any) => event.action === 'subscription_request.created'));
  assert.ok(audit.body.events.some((event: any) => event.action === 'subscription_request.approved'));
  assert.ok(audit.body.events.some((event: any) => event.action === 'subscription_request.break_glass_used'));
  assert.ok(audit.body.events.every((event: any) => !('before' in event) && !('after' in event)));
});

test('delegated platform roles are least-privileged and cannot self-approve billing', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const billing = seedUser('billing-admin@example.test', 'Billing Admin');
  const support = seedUser('support-admin@example.test', 'Support Admin');
  const analyst = seedUser('analyst-admin@example.test', 'Analyst Admin');
  for (const [userId, role] of [[billing.id, 'billing_approver'], [support.id, 'support'], [analyst.id, 'analyst']] as const) {
    await rootAgent.post(`/api/platform-admin/users/${userId}/platform-roles`).send({
      role, reason: `Grant ${role} for authorization coverage.`
    }).expect(201);
  }

  const billingAgent = await loginAs(billing.email);
  await billingAgent.get('/api/platform-admin/users').expect(403);
  await billingAgent.get('/api/platform-admin/audit-events').expect(403);
  await billingAgent.get('/api/platform-admin/analytics/overview').expect(403);
  const billingSpace = await billingAgent.get(`/api/platform-admin/spaces/${billing.spaceId}`).expect(200);
  assert.ok(billingSpace.body.members.every((member: any) => !('email' in member)));

  const created = await billingAgent.post('/api/subscription/requests').set('X-Seemplify-Space', billing.spaceId).send({
    requestType: 'change', planCode: 'team', note: 'Enable the team plan for delegated approval testing.'
  }).expect(201);
  await billingAgent.post(`/api/platform-admin/subscription-requests/${created.body.request.id}/decision`).send({
    decision: 'approved', reviewNote: 'A requester must not approve this themselves.', expectedVersion: 1, breakGlass: false
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_SELF_APPROVAL_FORBIDDEN'));

  const supportAgent = await loginAs(support.email);
  await supportAgent.get('/api/platform-admin/users').expect(200);
  await supportAgent.get('/api/platform-admin/audit-events').expect(403);
  const analystAgent = await loginAs(analyst.email);
  await analystAgent.get('/api/platform-admin/analytics/overview').expect(200);
  await analystAgent.get('/api/platform-admin/users').expect(403);
});

test('subscription terms are immutable, member billing history is redacted, and loopback origins are explicit', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const target = seedUser('terms-owner@example.test', 'Terms Owner');
  const member = seedUser('terms-member@example.test', 'Terms Member');
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'member',?,?)`).run(target.spaceId, member.id, new Date().toISOString(), new Date().toISOString());
  const ownerAgent = await loginAs(target.email);
  const created = await ownerAgent.post('/api/subscription/requests').set('X-Seemplify-Space', target.spaceId).send({
    requestType: 'change', planCode: 'team', note: 'These exact plan terms must remain stable until approval.'
  }).expect(201);
  db.prepare("UPDATE platform_subscription_requests SET plan_snapshot_json='{}' WHERE id=?").run(created.body.request.id);
  await rootAgent.post(`/api/platform-admin/subscription-requests/${created.body.request.id}/decision`).send({
    decision: 'approved', reviewNote: 'The altered snapshot must not be accepted.', expectedVersion: 1, breakGlass: false
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_PLAN_TERMS_CHANGED'));

  const memberAgent = await loginAs(member.email);
  const history = await memberAgent.get('/api/subscription/requests').set('X-Seemplify-Space', target.spaceId).expect(200);
  assert.equal(history.body.detailAccess, 'redacted');
  assert.equal(history.body.requests[0].requestNote, '');
  assert.equal(history.body.requests[0].reviewNote, '');
  assert.equal(history.body.requests[0].requestedBy, null);

  await rootAgent.post(`/api/platform-admin/users/${member.id}/revoke-sessions`)
    .set('Origin', 'https://attacker.example').send({ reason: 'Reject a foreign mutation origin.' }).expect(403);
  await rootAgent.post(`/api/platform-admin/users/${member.id}/revoke-sessions`)
    .set('Origin', 'http://localhost:7777').send({ reason: 'Reject a hostile loopback port.' }).expect(403);
  await rootAgent.post(`/api/platform-admin/users/${member.id}/revoke-sessions`)
    .set('Origin', 'http://localhost:5499').send({ reason: 'Allow the configured local administration origin.' }).expect(200);
});

test('space restrictions preserve session visibility while blocking tenant and public-feature access', async () => {
  const account = seedUser('restricted-space@example.test', 'Restricted Space');
  const agent = await loginAs(account.email);
  await agent.get('/api/social/check').set('X-Seemplify-Space', account.spaceId).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));

  db.prepare("UPDATE spaces SET status='suspended' WHERE id=?").run(account.spaceId);
  const sessionResponse = await agent.get('/session').expect(200);
  assert.equal(sessionResponse.body.activeSpace, null);
  assert.equal(sessionResponse.body.spaces.find((space: any) => space.id === account.spaceId).status, 'suspended');
  await agent.get('/api/subscription/current').set('X-Seemplify-Space', account.spaceId).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SPACE_SUSPENDED'));
  db.prepare("UPDATE spaces SET status='active' WHERE id=?").run(account.spaceId);
});

test('restricted accounts cannot regain a session through verification, reset, or bootstrap', async () => {
  const unverified = seedUser('restricted-verify@example.test', 'Restricted Verify', false);
  const verification = issueEmailVerificationToken(unverified.email);
  assert.ok(verification);
  db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(unverified.id);
  await request(app).post('/verify-email').send({ token: verification!.token }).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'ACCOUNT_RESTRICTED'));

  const resetting = seedUser('restricted-reset@example.test', 'Restricted Reset');
  const reset = issuePasswordResetToken(resetting.email);
  assert.ok(reset);
  db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(resetting.id);
  const resetResponse = await request(app).post('/reset-password').send({
    token: reset!.token, password: 'Changed-Password-2026!'
  }).expect(403);
  assert.equal(resetResponse.headers['set-cookie'], undefined);
  assert.equal(resetResponse.body.code, 'ACCOUNT_RESTRICTED');

  db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(rootUserId);
  bootstrapAdminAccount();
  assert.equal((db.prepare('SELECT account_status FROM users WHERE id=?').get(rootUserId) as any).account_status, 'suspended');
  db.prepare("UPDATE users SET account_status='active' WHERE id=?").run(rootUserId);
});

test('audit detail redacts secret-shaped fields at the server boundary', async () => {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,request_id,ip_address,user_agent,created_at)
    VALUES (?,?, 'superadmin','security.redaction_test','user',?,NULL,'Redaction coverage',?,?,?,'127.0.0.1','test-agent',?)`).run(
      id, rootUserId, rootUserId,
      JSON.stringify({ password: 'must-not-leak', nested: { accessToken: 'must-not-leak' }, status: 'active' }),
      JSON.stringify({ apiKey: 'must-not-leak', status: 'suspended' }), crypto.randomUUID(), new Date().toISOString()
    );
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const detail = await rootAgent.get(`/api/platform-admin/audit-events/${id}`).expect(200);
  assert.equal(detail.body.event.before.password, '[redacted]');
  assert.equal(detail.body.event.before.nested.accessToken, '[redacted]');
  assert.equal(detail.body.event.after.apiKey, '[redacted]');
  assert.equal(detail.body.event.before.status, 'active');
});
