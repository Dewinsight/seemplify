import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-kill-switch-'));
for (const [name, value] of [['admin-password', 'Kill-Switch-Test-Password-2026!'],
  ['session-secret', 'kill-switch-session-secret-that-is-long-enough'],
  ['terra', 'kill-switch-terra-secret-that-is-long-enough'],
  ['x-key', Buffer.alloc(32, 61).toString('base64url')],
  ['esign-key', Buffer.alloc(32, 62).toString('base64url')],
  ['webhook-key', Buffer.alloc(32, 63).toString('base64url')]]) fs.writeFileSync(path.join(root, name), value);
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'kill-switch@seemplify.local', ADMIN_PASSWORD_FILE: path.join(root, 'admin-password'),
  SESSION_SECRET_FILE: path.join(root, 'session-secret'), TERRA_GATEWAY_SHARED_SECRET_FILE: path.join(root, 'terra'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra'), EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: path.join(root, 'x-key'),
  JOURNEY_WEBHOOK_ENCRYPTION_KEY_FILE: path.join(root, 'webhook-key'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: path.join(root, 'esign-key') });

const { app: mainApp } = await import('../src/app.js');
const { login } = await import('../src/auth.js');
const { db } = await import('../src/database.js');
const { journeyKillSwitchRouter } = await import('../src/journeyKillSwitchRoutes.js');
const isolatedApp = express();
isolatedApp.use(express.json());
isolatedApp.post('/api/auth/login', login);
isolatedApp.use('/api/journey-kill-switches', journeyKillSwitchRouter);

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
function agent(app: express.Express) {
  const value = request.agent(app); const server = (value as any).app;
  server?.on?.('listening', () => server.unref?.()); return value;
}
const admin = agent(isolatedApp);
await admin.post('/api/auth/login').send({ email: 'kill-switch@seemplify.local',
  password: 'Kill-Switch-Test-Password-2026!' }).expect(200);
const adminSession = await agent(mainApp).post('/api/auth/login').send({ email: 'kill-switch@seemplify.local',
  password: 'Kill-Switch-Test-Password-2026!' }).expect(200);
const adminId = String(adminSession.body.user?.id ||
  (db.prepare('SELECT id FROM users WHERE email=?').get('kill-switch@seemplify.local') as any).id);
const adminSpace = String((db.prepare('SELECT active_space_id FROM users WHERE id=?').get(adminId) as any).active_space_id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(adminSpace);

const gates = ['consent', 'suppression', 'entitlement', 'quota', 'quiet_hours', 'frequency_cap', 'source_state'];
function seedQueue(suffix: string, state: 'ready' | 'leased', subjectHash: string) {
  const at = new Date().toISOString(); const hash = 'a'.repeat(64);
  const workflowId = `workflow-${suffix}`; const versionId = `version-${suffix}`;
  const runId = `run-${suffix}`; const actionId = `action-${suffix}`; const queueId = `queue-${suffix}`;
  db.prepare(`INSERT INTO journey_workflow_definitions
    (id,space_id,name,state,revision,draft_json,current_version_id,current_version_number,paused,created_by_user_id,
     updated_by_user_id,created_at,updated_at,retired_at,retired_by_user_id)
    VALUES (?,?,?,'published',1,'{}',NULL,NULL,0,?,?,?,?,NULL,NULL)`)
    .run(workflowId, adminSpace, `Workflow ${suffix}`, adminId, adminId, at, at);
  db.prepare(`INSERT INTO journey_workflow_versions
    (id,workflow_id,space_id,version_number,content_json,content_sha256,published_by_user_id,published_at)
    VALUES (?,?,?,1,'{}',?,?,?)`).run(versionId, workflowId, adminSpace, hash, adminId, at);
  db.prepare(`INSERT INTO journey_workflow_runs
    (id,workflow_id,workflow_version_id,space_id,mode,trigger_fingerprint_sha256,subject_ref_sha256,result_json,
     result_sha256,actor_user_id,created_at) VALUES (?,?,?,?,'execution',?,?,'{}',?,?,?)`)
    .run(runId, workflowId, versionId, adminSpace, hash, subjectHash, hash, adminId, at);
  db.prepare(`INSERT INTO journey_workflow_actions
    (id,run_id,space_id,action_key,adapter,idempotency_key,decision,approval_required,trace_json,trace_sha256,created_at)
    VALUES (?,?,?,'action','assistant_action',?,'approved_held',0,'{}',?,?)`)
    .run(actionId, runId, adminSpace, `action-key-${suffix}`, hash, at);
  db.prepare(`INSERT INTO journey_action_queue
    (id,action_id,workflow_id,space_id,adapter,idempotency_key,state,hold_reason_code,payload_json,payload_sha256,
     attempt_count,max_attempts,available_at,lease_owner_sha256,lease_token,fencing_token,lease_expires_at,terminal_at,
     last_error_code,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,NULL,'{}',?,0,5,?,?,?,?,?,NULL,NULL,1,?,?)`)
    .run(queueId, actionId, workflowId, adminSpace, 'assistant_action', `queue-key-${suffix}`, state, hash, at,
      state === 'leased' ? hash : null, state === 'leased' ? `lease-${suffix}` : null,
      state === 'leased' ? 4 : 0, state === 'leased' ? new Date(Date.now() + 60_000).toISOString() : null, at, at);
  for (const gate of gates) db.prepare(`INSERT INTO journey_action_gate_resolutions
    (id,queue_id,space_id,gate_key,decision,reason_code,evidence_sha256,resolved_at)
    VALUES (?,?,?,?,'allow','TEST_ALLOWED',?,?)`).run(crypto.randomUUID(), queueId, adminSpace, gate, hash, at);
  return { queueId, workflowId, subjectHash };
}

const first = seedQueue('first', 'ready', '1'.repeat(64));
const second = seedQueue('second', 'leased', '2'.repeat(64));
const body = (state: 'enabled' | 'disabled', expectedRevision: number) =>
  ({ state, expectedRevision, reasonCode: state === 'disabled' ? 'operational_incident' : 'recovery_verified' });

test('strict tenant route pauses ready and leased work, fences leases, replays idempotently and recovers safely', async () => {
  await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-disable-01').send({ ...body('disabled', 0), extra: true }).expect(400);
  const disabled = await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-disable-01').send(body('disabled', 0)).expect(200);
  assert.equal(disabled.body.pausedCount, 2); assert.equal(disabled.body.releasedLeaseCount, 1);
  const leased = db.prepare('SELECT state,fencing_token,lease_token FROM journey_action_queue WHERE id=?')
    .get(second.queueId) as any;
  assert.deepEqual(leased, { state: 'held', fencing_token: 5, lease_token: null });
  const replay = await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-disable-01').send(body('disabled', 0)).expect(200);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.pausedCount, 2);
  await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-disable-01').send(body('enabled', 1)).expect(409);
  await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-stale-001').send(body('enabled', 0)).expect(409);
  const enabled = await admin.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'space-enable-001').send(body('enabled', 1)).expect(200);
  assert.equal(enabled.body.resumedCount, 2);
  assert.deepEqual((db.prepare('SELECT state FROM journey_action_queue WHERE id IN (?,?) ORDER BY id')
    .all(first.queueId, second.queueId) as any[]).map((row) => row.state), ['ready', 'ready']);
});

test('profile and adapter scopes are isolated and effective precedence is server-derived', async () => {
  const profilePath = `/api/journey-kill-switches/scopes/profile/${first.subjectHash}`;
  const profile = await admin.put(profilePath).set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'profile-disable-01').send(body('disabled', 0)).expect(200);
  assert.equal(profile.body.pausedCount, 1);
  assert.equal((db.prepare('SELECT state FROM journey_action_queue WHERE id=?').get(first.queueId) as any).state, 'held');
  assert.equal((db.prepare('SELECT state FROM journey_action_queue WHERE id=?').get(second.queueId) as any).state, 'ready');
  const effective = await admin.get('/api/journey-kill-switches/effective').set('x-seemplify-space', adminSpace)
    .query({ workflowId: first.workflowId, adapter: 'assistant_action', profileRefSha256: first.subjectHash }).expect(200);
  assert.equal(effective.body.resolution.blockedLevel, 'profile');
  await admin.put(profilePath).set('x-seemplify-space', adminSpace).set('Idempotency-Key', 'profile-enable-001')
    .send(body('enabled', 1)).expect(200);
  const adapter = await admin.put('/api/journey-kill-switches/scopes/adapter/assistant_action')
    .set('x-seemplify-space', adminSpace).set('Idempotency-Key', 'adapter-disable-1')
    .send(body('disabled', 0)).expect(200);
  assert.equal(adapter.body.pausedCount, 2);
  await admin.put('/api/journey-kill-switches/scopes/adapter/email_reply').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'adapter-invalid-1').send(body('disabled', 0)).expect(422);
});

test('platform authority is separate and members cannot mutate or cross tenants without membership', async () => {
  const mainMember = agent(mainApp);
  await signupVerifyAndOnboard(mainMember, { name: 'Kill switch member', email: 'kill-member@example.test',
    password: 'Strong-kill-switch-password-2026!', spaceName: 'Member home' });
  const session = await mainMember.get('/api/auth/session').expect(200);
  const memberId = String(session.body.user.id); const memberHome = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(memberHome);
  const member = agent(isolatedApp);
  await member.post('/api/auth/login').send({ email: 'kill-member@example.test',
    password: 'Strong-kill-switch-password-2026!' }).expect(200);
  await member.get('/api/journey-kill-switches').set('x-seemplify-space', adminSpace).expect(403);
  const at = new Date().toISOString();
  db.prepare("INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)")
    .run(adminSpace, memberId, at, at);
  await member.get('/api/journey-kill-switches').set('x-seemplify-space', adminSpace).expect(200);
  await member.put('/api/journey-kill-switches/space').set('x-seemplify-space', adminSpace)
    .set('Idempotency-Key', 'member-denied-001').send(body('disabled', 2)).expect(403)
    .expect(({ body: responseBody }) => assert.equal(responseBody.code, 'JOURNEY_KILL_SWITCH_REVIEW_REQUIRED'));
  db.prepare(`INSERT INTO journey_collaboration_role_assignments
    (id,space_id,scope_type,journey_definition_id,user_id,role,state,revision,assigned_by_user_id,assigned_at)
    VALUES (? ,?,'space',NULL,?,'approver','active',1,?,?)`)
    .run('kill-switch-member-approver', adminSpace, memberId, adminId, at);
  const delegated = await member.put('/api/journey-kill-switches/scopes/workflow/delegated-workflow')
    .set('x-seemplify-space', adminSpace).set('Idempotency-Key', 'member-delegated-1')
    .send(body('disabled', 0)).expect(200);
  assert.equal(delegated.body.switch.scopeLevel, 'workflow');
  await member.get('/api/journey-kill-switches/platform').expect(403);
  const home = await member.get('/api/journey-kill-switches').set('x-seemplify-space', memberHome).expect(200);
  assert.deepEqual(home.body.scopes, []);
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(memberHome);
  await member.get('/api/journey-kill-switches').set('x-seemplify-space', memberHome).expect(403)
    .expect(({ body: responseBody }) => assert.equal(responseBody.code, 'SUBSCRIPTION_FEATURE_REQUIRED'));
  const platform = await admin.put('/api/journey-kill-switches/platform').set('Idempotency-Key', 'platform-disable-1')
    .send(body('disabled', 0)).expect(200);
  assert.equal(platform.body.switch.scopeLevel, 'platform');
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(adminSpace);
  await admin.get('/api/journey-kill-switches/platform').expect(200);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(adminSpace);
});

test('audit and pause evidence are append-only and omit raw profile identity', async () => {
  const audit = await admin.get('/api/journey-kill-switches/audit').set('x-seemplify-space', adminSpace).expect(200);
  assert.ok(audit.body.events.length >= 4);
  assert.equal(JSON.stringify(audit.body.events).includes('raw-person'), false);
  const pauses = await admin.get('/api/journey-kill-switches/pauses').set('x-seemplify-space', adminSpace).expect(200);
  assert.ok(pauses.body.pauses.some((pause: any) => pause.leaseReleased));
  const auditId = String(audit.body.events[0].id);
  assert.throws(() => db.prepare('UPDATE journey_kill_switch_audit SET action=? WHERE id=?')
    .run('tampered', auditId), /append-only/u);
});

test('SQLite catalog and constraints preserve the runtime-40 table, index and append-only semantics', () => {
  const expectedColumns: Record<string, string[]> = {
    journey_kill_switch_states: ['id','scope_level','space_id','scope_key','state','reason_code','revision',
      'updated_by_user_id','created_at','updated_at'],
    journey_kill_switch_mutations: ['id','state_id','scope_level','space_id','scope_key','idempotency_key',
      'requested_state','resulting_revision','paused_count','released_lease_count','resumed_count',
      'still_disabled_count','actor_user_id','created_at'],
    journey_kill_switch_pauses: ['id','state_id','mutation_id','space_id','queue_id','previous_state',
      'lease_released','fencing_token','reason_code','created_at'],
    journey_kill_switch_resumptions: ['id','pause_id','mutation_id','space_id','queue_id','outcome','created_at'],
    journey_kill_switch_audit: ['id','space_id','actor_user_id','authority','action','scope_level','scope_key',
      'detail_json','detail_sha256','created_at']
  };
  for (const [table, columns] of Object.entries(expectedColumns)) {
    assert.deepEqual((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((column) => column.name), columns);
  }
  const indexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'journey_kill_switch_%'")
    .all() as any[]).map((row) => String(row.name)));
  for (const index of ['journey_kill_switch_platform_singleton','journey_kill_switch_tenant_scope',
    'journey_kill_switch_mutation_list','journey_kill_switch_pause_open','journey_kill_switch_resumption_list',
    'journey_kill_switch_audit_list']) assert.ok(indexes.has(index), index);
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'journey_kill_switch_%'")
    .all() as any[]).map((row) => String(row.name));
  assert.equal(triggers.length, 8, 'SQLite uses paired UPDATE/DELETE guards for the four PostgreSQL append-only triggers');
  const audit = db.prepare('SELECT * FROM journey_kill_switch_audit LIMIT 1').get() as any;
  assert.throws(() => db.prepare(`INSERT INTO journey_kill_switch_audit
    (id,space_id,actor_user_id,authority,action,scope_level,scope_key,detail_json,detail_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), audit.space_id, audit.actor_user_id, audit.authority,
      audit.action, audit.scope_level, audit.scope_key, JSON.stringify({ payload: 'forbidden' }),
      'f'.repeat(64), new Date().toISOString()), /CHECK constraint failed/u);
});
