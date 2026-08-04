import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
  CODEX_RUNTIME_DIR: path.join(root, 'codex'),
  CODEX_CLI_PATH: fileURLToPath(new URL('./fixtures/fake-codex-app-server.js', import.meta.url)),
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

const { db, createJob } = await import('../src/database.js');
const {
  bootstrapAdminAccount, currentSessionUser, issueEmailVerificationToken, issuePasswordResetToken,
  login, resetPassword, session, verifyEmail
} = await import('../src/auth.js');
const { platformAdminRouter, subscriptionRouter } = await import('../src/platformAdmin.js');
const { adminControlPlaneRouter } = await import('../src/adminControlPlane.js');
const { stopCodexClients } = await import('../src/codexAppServer.js');
const { createSpace, resolveRequestSpace, SpaceError } = await import('../src/spaces.js');
const {
  assertCanQueueAiAction, consumeDirectAiAction, currentMonthlyAiActions, SubscriptionEntitlementError
} = await import('../src/subscriptionEntitlements.js');
const { assertKnowledgeStorageAllowance, KnowledgeError } = await import('../src/knowledgeRepository.js');

const rootUserId = bootstrapAdminAccount();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.post('/login', login);
app.post('/reset-password', resetPassword);
app.post('/verify-email', verifyEmail);
app.get('/session', session);
app.use('/api/platform-admin', platformAdminRouter);
app.use('/api/platform-admin', adminControlPlaneRouter);
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

after(async () => {
  await stopCodexClients();
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

test('seeded and custom control-plane roles enforce durable permissions without replacing legacy roles', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const rbac = await rootAgent.get('/api/platform-admin/rbac').expect(200);
  assert.deepEqual(rbac.body.roles.slice(0, 3).map((role: any) => role.id), ['admin', 'editor', 'viewer']);
  assert.ok(rbac.body.permissions.some((permission: any) => permission.id === 'jobs.read'));
  assert.ok(rbac.body.permissions.some((permission: any) => permission.id === 'ai_defaults.manage'));

  const custom = await rootAgent.post('/api/platform-admin/rbac/roles').send({
    name: 'Operations observer',
    description: 'A custom privacy-safe operational role.',
    permissions: ['roles.read', 'jobs.read', 'activity.read']
  }).expect(201);
  assert.equal(custom.body.role.builtIn, false);
  assert.match(custom.body.role.id, /^[0-9a-f-]{36}$/u);

  const viewer = seedUser('control-viewer@example.test', 'Control Viewer');
  const assignment = await rootAgent.post(`/api/platform-admin/users/${viewer.id}/admin-roles`).send({
    roleId: 'viewer', reason: 'Grant read-only administrator access for coverage.'
  }).expect(201);
  assert.equal(assignment.body.assignment.roleId, 'viewer');
  assert.equal((await rootAgent.get(`/api/platform-admin/users/${viewer.id}`).expect(200)).body.user.adminRoles[0], 'viewer');

  const viewerAgent = await loginAs(viewer.email);
  const me = await viewerAgent.get('/api/platform-admin/me').expect(200);
  assert.ok(me.body.adminRoles.includes('viewer'));
  assert.ok(me.body.permissions.includes('jobs.read'));
  assert.equal(me.body.capabilities.readJobs, true);
  assert.equal(me.body.capabilities.manageRoles, false);
  await viewerAgent.get('/api/platform-admin/jobs').expect(200);
  await viewerAgent.get('/api/platform-admin/activity').expect(200);
  await viewerAgent.post('/api/platform-admin/rbac/roles').send({ name: 'Forbidden', permissions: [] }).expect(403);

  const operator = seedUser('control-admin@example.test', 'Control Admin');
  const operatorAssignment = await rootAgent.post(`/api/platform-admin/users/${operator.id}/admin-roles`).send({
    roleId: 'admin', reason: 'Grant full administrator access for self-lockout coverage.'
  }).expect(201);
  const operatorAgent = await loginAs(operator.email);
  const adminRole = (await operatorAgent.get('/api/platform-admin/rbac/roles').expect(200)).body.roles
    .find((role: any) => role.id === 'admin');
  await operatorAgent.put('/api/platform-admin/rbac/roles/admin/permissions').send({
    permissions: adminRole.permissions.filter((permission: string) => permission !== 'roles.manage'),
    expectedVersion: adminRole.version
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'ADMIN_ROLE_SELF_LOCKOUT_BLOCKED'));
  await operatorAgent.delete(`/api/platform-admin/users/${operator.id}/admin-roles/${operatorAssignment.body.assignment.id}`).send({
    reason: 'Attempt to revoke the final role-management path must be blocked.'
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'ADMIN_ROLE_SELF_LOCKOUT_BLOCKED'));

  const delegatedRole = await rootAgent.post('/api/platform-admin/rbac/roles').send({
    name: 'Role delegator', description: 'Can administer roles only within its own permission ceiling.',
    permissions: ['roles.read', 'roles.manage']
  }).expect(201);
  const delegator = seedUser('role-delegator@example.test', 'Role Delegator');
  await rootAgent.post(`/api/platform-admin/users/${delegator.id}/admin-roles`).send({
    roleId: delegatedRole.body.role.id, reason: 'Exercise non-root delegation limits.'
  }).expect(201);
  const delegatorAgent = await loginAs(delegator.email);
  await delegatorAgent.post('/api/platform-admin/rbac/roles').send({
    name: 'Escalated role', permissions: ['roles.read', 'users.manage']
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'ADMIN_PERMISSION_GRANT_EXCEEDS_ACTOR'));
  await delegatorAgent.post(`/api/platform-admin/users/${viewer.id}/admin-roles`).send({
    roleId: 'admin', reason: 'Attempt to assign permissions the delegator does not hold.'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'ADMIN_PERMISSION_GRANT_EXCEEDS_ACTOR'));
  await delegatorAgent.delete(`/api/platform-admin/users/${operator.id}/admin-roles/${operatorAssignment.body.assignment.id}`).send({
    reason: 'Attempt to revoke permissions the delegator does not hold.'
  }).expect(403).expect(({ body }) => assert.equal(body.code, 'ADMIN_PERMISSION_GRANT_EXCEEDS_ACTOR'));

  const historyUser = seedUser('custom-role-history@example.test', 'Custom Role History');
  const customAssignment = await rootAgent.post(`/api/platform-admin/users/${historyUser.id}/admin-roles`).send({
    roleId: custom.body.role.id, reason: 'Create durable custom-role assignment history.'
  }).expect(201);
  await rootAgent.delete(`/api/platform-admin/users/${historyUser.id}/admin-roles/${customAssignment.body.assignment.id}`).send({
    reason: 'Revoke the custom role while retaining its history.'
  }).expect(204);
  const history = (await rootAgent.get(`/api/platform-admin/users/${historyUser.id}/admin-roles`).expect(200)).body.assignments
    .find((item: any) => item.id === customAssignment.body.assignment.id);
  assert.equal(history.reason, 'Create durable custom-role assignment history.');
  assert.equal(history.revocationReason, 'Revoke the custom role while retaining its history.');
  await rootAgent.delete(`/api/platform-admin/rbac/roles/${custom.body.role.id}`).send({
    reason: 'Deletion must not cascade durable assignment history.'
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'ADMIN_ROLE_HAS_HISTORY'));
});

test('AI defaults separate read and manage permissions and audit only successful mutations', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const viewer = seedUser('ai-defaults-viewer@example.test', 'AI Defaults Viewer');
  await rootAgent.post(`/api/platform-admin/users/${viewer.id}/admin-roles`).send({
    roleId: 'viewer', reason: 'Read-only AI-default coverage.'
  }).expect(201);
  const viewerAgent = await loginAs(viewer.email);
  const viewerDefaults = await viewerAgent.get('/api/platform-admin/ai-defaults').expect(200);
  assert.ok(Array.isArray(viewerDefaults.body.codex.actions));
  assert.equal((await viewerAgent.get('/api/platform-admin/me').expect(200)).body.capabilities.manageAiDefaults, false);
  await viewerAgent.put('/api/platform-admin/ai-defaults').send({ codexModel: 'gpt-not-allowed' }).expect(403);
  await viewerAgent.delete('/api/platform-admin/ai-defaults').expect(403);

  const editor = seedUser('ai-defaults-editor@example.test', 'AI Defaults Editor');
  await rootAgent.post(`/api/platform-admin/users/${editor.id}/admin-roles`).send({
    roleId: 'editor', reason: 'AI-default management coverage.'
  }).expect(201);
  const editorAgent = await loginAs(editor.email);
  const editorMe = await editorAgent.get('/api/platform-admin/me').expect(200);
  assert.equal(editorMe.body.capabilities.readAiDefaults, true);
  assert.equal(editorMe.body.capabilities.manageAiDefaults, true);
  const auditBefore = Number((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events
    WHERE action='ai_defaults.updated'`).get() as any).count);
  const policyOnly = await editorAgent.put('/api/platform-admin/ai-defaults').send({
    runtimePolicy: { localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local' }
  }).expect(200);
  assert.deepEqual(policyOnly.body.defaults.runtimePolicy, {
    localEnabled: true, chatgptEnabled: false, defaultRuntime: 'local'
  });
  const auditAfterPolicy = Number((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events
    WHERE action='ai_defaults.updated'`).get() as any).count);
  assert.equal(auditAfterPolicy, auditBefore + 1);
  await editorAgent.put('/api/platform-admin/ai-defaults').send({ codexModel: 'gpt-disconnected-test' })
    .expect(409).expect(({ body }) => assert.equal(body.code, 'CODEX_NOT_CONNECTED'));
  const auditAfter = Number((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events
    WHERE action='ai_defaults.updated'`).get() as any).count);
  assert.equal(auditAfter, auditAfterPolicy);
  const reset = await editorAgent.delete('/api/platform-admin/ai-defaults').expect(200);
  assert.equal(reset.body.defaults.codexModel, null);
  assert.deepEqual(reset.body.defaults.runtimePolicy, {
    localEnabled: true, chatgptEnabled: true, defaultRuntime: 'chatgpt'
  });
  assert.ok(db.prepare(`SELECT 1 FROM platform_audit_events WHERE action='ai_defaults.reset'
    AND actor_user_id=?`).get(editor.id));
});

test('administrator provisioning uses password-claim invitations and records role assignment', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const response = await rootAgent.post('/api/platform-admin/users').send({
    name: 'Invited Administrator', email: 'invited-administrator@example.test',
    spaceName: 'Invited administrator workspace', roleId: 'editor'
  }).expect(201);
  assert.equal(response.body.invitation.requiresPasswordSetup, true);
  assert.ok(['sent', 'failed'].includes(response.body.invitation.delivery.state));
  assert.equal(response.body.assignment.roleId, 'editor');
  assert.equal(JSON.stringify(response.body).includes('token'), false);
  assert.equal(JSON.stringify(response.body).includes('password'), false);
  const stored = db.prepare(`SELECT email_verified_at,password_claim_required FROM users WHERE id=?`).get(response.body.user.id) as any;
  assert.equal(stored.email_verified_at, null);
  assert.equal(Number(stored.password_claim_required), 1);
  assert.ok(db.prepare(`SELECT 1 FROM platform_rbac_user_roles WHERE user_id=? AND role_id='editor' AND revoked_at IS NULL`)
    .get(response.body.user.id));
  await rootAgent.post('/api/platform-admin/users').send({
    name: 'Duplicate Administrator', email: 'invited-administrator@example.test'
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'USER_EMAIL_EXISTS'));
  const audit = await rootAgent.get('/api/platform-admin/audit-events?search=user.provisioned').expect(200);
  assert.ok(audit.body.events.some((event: any) => event.targetId === response.body.user.id));
});

test('global AI jobs and product activity expose only privacy-safe operational metadata', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const account = seedUser('queue-requester@example.test', 'Queue Requester');
  const job = createJob('analyst.chat', {
    prompt: 'PRIVATE CUSTOMER PROMPT MUST NOT LEAK',
    evidence: 'PRIVATE CUSTOMER EVIDENCE MUST NOT LEAK'
  }, account.spaceId, null, null, account.id);
  const persistedInput = JSON.parse((db.prepare('SELECT input_json FROM ai_jobs WHERE id=?').get(job.id) as any).input_json);
  persistedInput._aiRuntime = {
    provider: 'codex', codexModel: 'gpt-operational-test', codexReasoningEffort: 'max',
    codexActionId: 'analyst.chat', codexDataSharingAcknowledgedAt: new Date().toISOString()
  };
  const providerResult = JSON.stringify({
    activity: 'experience.analyst_chat', schemaName: 'experience_analyst_answer', output: {},
    runtime: { provider: 'openai-codex', providerLabel: 'ChatGPT / Codex', model: 'gpt-operational-actual',
      reasoningEffort: 'high', action: 'analyst.chat' }
  });
  db.prepare(`UPDATE ai_jobs SET input_json=?,provider_result_json=?,state='failed',stage='provider_error',progress=100,attempt=2,
    error=?,updated_at=? WHERE id=?`).run(JSON.stringify(persistedInput), providerResult,
      'provider token=secret-value failed safely', new Date().toISOString(), job.id);

  const list = await rootAgent.get('/api/platform-admin/jobs').query({ state: 'failed', provider: 'codex',
    search: 'Queue Requester', limit: 10 }).expect(200);
  const row = list.body.jobs.find((item: any) => item.id === job.id);
  assert.ok(row);
  assert.deepEqual(row.runtime, {
    source: 'provider_result', status: 'actual', provider: 'codex', providerLabel: 'ChatGPT / Codex',
    model: 'gpt-operational-actual', reasoningEffort: 'high', actionId: 'analyst.chat'
  });
  assert.equal(row.requester.email, account.email);
  assert.equal(row.space.id, account.spaceId);
  assert.deepEqual(row.error, {
    code: 'AI_JOB_FAILED', message: 'The AI job failed. Use the job ID to inspect protected service logs.'
  });
  assert.equal(JSON.stringify(row.error).includes('secret-value'), false);
  assert.equal(JSON.stringify(list.body).includes('PRIVATE CUSTOMER'), false);
  assert.ok(list.body.summary.failed >= 1);
  const detail = await rootAgent.get(`/api/platform-admin/jobs/${job.id}`).expect(200);
  assert.equal(detail.body.job.id, job.id);
  assert.equal('input' in detail.body.job, false);
  assert.equal('result' in detail.body.job, false);

  const activity = await rootAgent.get('/api/platform-admin/activity').query({ type: 'ai_job', search: 'failed' }).expect(200);
  const event = activity.body.activity.find((item: any) => item.entityId === job.id);
  assert.ok(event);
  assert.equal(event.kind, 'analyst.chat');
  assert.equal(event.status, 'failed');
  assert.equal(event.actor.id, account.id);
  assert.equal(event.space.id, account.spaceId);
  assert.equal(JSON.stringify(activity.body).includes('PRIVATE CUSTOMER'), false);

  const privacyRole = await rootAgent.post('/api/platform-admin/rbac/roles').send({
    name: 'Queue metadata only', description: 'Operational access without user identity access.',
    permissions: ['jobs.read', 'activity.read']
  }).expect(201);
  const monitor = seedUser('queue-monitor@example.test', 'Queue Monitor');
  await rootAgent.post(`/api/platform-admin/users/${monitor.id}/admin-roles`).send({
    roleId: privacyRole.body.role.id, reason: 'Verify identity redaction boundaries.'
  }).expect(201);
  const monitorAgent = await loginAs(monitor.email);
  await monitorAgent.get('/api/platform-admin/overview').expect(403);
  const restrictedJobs = await monitorAgent.get('/api/platform-admin/jobs').query({ search: job.id }).expect(200);
  const restrictedJob = restrictedJobs.body.jobs.find((item: any) => item.id === job.id);
  assert.equal(restrictedJob.requester, null);
  assert.equal(restrictedJob.requesterRestricted, true);
  assert.equal((await monitorAgent.get('/api/platform-admin/jobs')
    .query({ search: account.email }).expect(200)).body.total, 0);
  const restrictedActivity = await monitorAgent.get('/api/platform-admin/activity')
    .query({ search: job.id }).expect(200);
  const restrictedEvent = restrictedActivity.body.activity.find((item: any) => item.entityId === job.id);
  assert.equal(restrictedEvent.actor, null);
  assert.equal(restrictedEvent.actorRestricted, true);
  assert.equal((await monitorAgent.get('/api/platform-admin/activity')
    .query({ search: account.email }).expect(200)).body.total, 0);

  const malformed = createJob('analyst.chat', { safe: true }, account.spaceId, null, null, account.id);
  db.prepare(`UPDATE ai_jobs SET input_json='{' WHERE id=?`).run(malformed.id);
  const legacyJobs = await rootAgent.get('/api/platform-admin/jobs').query({ provider: 'terra', search: malformed.id }).expect(200);
  assert.ok(legacyJobs.body.jobs.some((item: any) => item.id === malformed.id));
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

test('subscription plans are versioned, editable, propagated, resettable, and audited', async () => {
  const rootAgent = await loginAs('platform-admin@seemplify.local');
  const starter = seedUser('managed-plan-owner@example.test', 'Managed Plan Owner');
  const durableQuota = seedUser('managed-plan-durable-quota@example.test', 'Durable Quota');
  const directQuota = seedUser('managed-plan-direct-quota@example.test', 'Direct Quota');
  const storageQuota = seedUser('managed-plan-storage-quota@example.test', 'Storage Quota');
  const starterAgent = await loginAs(starter.email);
  await starterAgent.get('/api/social/check').set('X-Seemplify-Space', starter.spaceId).expect(403)
    .expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));

  const catalog = await rootAgent.get('/api/platform-admin/plans').expect(200);
  const current = catalog.body.plans.find((plan: any) => plan.code === 'starter');
  assert.equal(current.activeSubscriptions >= 1, true);
  assert.equal(current.features.socialListening, false);

  const updated = await rootAgent.put('/api/platform-admin/plans/starter').send({
    name: 'Starter managed',
    description: 'A managed starter plan used by smaller workspaces.',
    requestable: true,
    features: { ...current.features, socialListening: true },
    limits: { ...current.limits, monthlyAiActions: 1, knowledgeStorageBytes: 4 },
    expectedVersion: current.version,
    reason: 'Enable starter social listening for the managed plan test.'
  }).expect(200);
  assert.equal(updated.body.plan.name, 'Starter managed');
  assert.equal(updated.body.plan.features.socialListening, true);
  assert.equal(updated.body.plan.limits.monthlyAiActions, 1);
  assert.equal(updated.body.plan.version, current.version + 1);
  await starterAgent.get('/api/social/check').set('X-Seemplify-Space', starter.spaceId).expect(200);
  const stored = db.prepare('SELECT features_json,limits_json FROM platform_subscriptions WHERE space_id=?').get(starter.spaceId) as any;
  assert.equal(JSON.parse(stored.features_json).socialListening, true);
  assert.equal(JSON.parse(stored.limits_json).monthlyAiActions, 1);

  const reserved = createJob('survey.improve', { quotaFixture: true }, durableQuota.spaceId, null, null, durableQuota.id);
  assert.equal(currentMonthlyAiActions(durableQuota.spaceId), 1);
  assert.throws(() => assertCanQueueAiAction(durableQuota.spaceId), (error: unknown) =>
    error instanceof SubscriptionEntitlementError && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED');
  db.prepare('UPDATE ai_jobs SET attempt=2 WHERE id=?').run(reserved.id);
  assert.equal(currentMonthlyAiActions(durableQuota.spaceId), 2, 'started retries count as additional AI actions');

  consumeDirectAiAction({
    spaceId: directQuota.spaceId, userId: directQuota.id, actionId: 'knowledge.answer', requestKey: 'direct-usage-1'
  });
  consumeDirectAiAction({
    spaceId: directQuota.spaceId, userId: directQuota.id, actionId: 'knowledge.answer', requestKey: 'direct-usage-1'
  });
  assert.equal(currentMonthlyAiActions(directQuota.spaceId), 1, 'replayed direct requests are not charged twice');
  assert.throws(() => consumeDirectAiAction({
    spaceId: directQuota.spaceId, userId: directQuota.id, actionId: 'knowledge.answer', requestKey: 'direct-usage-2'
  }), (error: unknown) => error instanceof SubscriptionEntitlementError && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED');

  assert.throws(() => assertKnowledgeStorageAllowance(storageQuota.spaceId, 5), (error: unknown) =>
    error instanceof KnowledgeError && error.code === 'KNOWLEDGE_PLAN_STORAGE_QUOTA');

  await rootAgent.put('/api/platform-admin/plans/starter').send({
    name: 'Stale update', description: '', requestable: true,
    features: current.features, limits: current.limits, expectedVersion: current.version,
    reason: 'Prove stale plan changes cannot overwrite newer terms.'
  }).expect(409).expect(({ body }) => assert.equal(body.code, 'SUBSCRIPTION_PLAN_VERSION_CONFLICT'));

  const reset = await rootAgent.post('/api/platform-admin/plans/starter/reset').send({
    expectedVersion: updated.body.plan.version,
    reason: 'Restore the system Starter defaults after plan management testing.'
  }).expect(200);
  assert.equal(reset.body.plan.name, 'Starter');
  assert.equal(reset.body.plan.features.socialListening, false);
  await starterAgent.get('/api/social/check').set('X-Seemplify-Space', starter.spaceId).expect(403);

  const audit = await rootAgent.get('/api/platform-admin/audit-events?search=subscription_plan').expect(200);
  assert.ok(audit.body.events.some((event: any) => event.action === 'subscription_plan.updated'));
  assert.ok(audit.body.events.some((event: any) => event.action === 'subscription_plan.reset'));
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
  const series = await analystAgent.get('/api/platform-admin/analytics/timeseries')
    .query({ from: '2026-07-06', to: '2026-08-04' }).expect(200);
  assert.equal(series.body.series.length, 30);
  assert.deepEqual(Object.keys(series.body.series[0]),
    ['day', 'accounts', 'spaces', 'responses', 'aiJobs', 'agreements', 'campaigns']);
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
