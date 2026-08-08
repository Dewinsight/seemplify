import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-experience-api-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret'); const webhookSecretFile = path.join(root, 'brevo-webhook-secret'); const xKeyFile = path.join(root, 'x-credential-encryption-key');
const esignKeyFile = path.join(root, 'esign-encryption-key');
const frontendDist = path.join(root, '.release', 'frontend', 'dist');
fs.mkdirSync(frontendDist, { recursive: true }); fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>Experience test shell</title>');
fs.mkdirSync(path.join(frontendDist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'assets', 'current-build-a1b2c3.js'), 'globalThis.__experienceAssetLoaded = true;');
fs.writeFileSync(path.join(frontendDist, 'assets', 'current-build-d4e5f6.css'), ':root { color: rgb(1 2 3); }');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!'); fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough'); fs.writeFileSync(webhookSecretFile, 'test-brevo-webhook-secret-that-is-long-enough'); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 9).toString('base64url')); fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 10).toString('base64url'));
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: frontendDist, PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', BREVO_WEBHOOK_SECRET_FILE: webhookSecretFile, MAIL_IDEMPOTENCY_TTL_MINUTES: '120', MAIL_API_BASE_URL: 'http://127.0.0.1:5020', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_API_BASE_URL: 'https://api.x.invalid', X_OAUTH_BASE_URL: 'https://api.x.invalid',
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, ESIGN_WORKER_POLL_MS: '250',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'no-x-consumer-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'no-x-consumer-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'no-x-bearer-token'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'no-x-access-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'no-x-access-token-secret') });
const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { issuePasswordResetToken } = await import('../src/auth.js');
const { campaignRunner, recoverCampaignDeliveries } = await import('../src/campaigns.js');
const { xSyncRunner } = await import('../src/xIntegration.js');
const { sanitizeCampaignHtml } = await import('../src/emailService.js');
const { config } = await import('../src/config.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function sessionIdentity(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/auth/session').expect(200);
  return { userId: String(response.body.user.id), spaceId: String(response.body.activeSpace.id) };
}

async function journeyOwnerAgent() {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Journey Owner',
    email: `journey-owner-${Date.now()}@example.test`,
    password: 'Journey-Owner-2026!',
    spaceName: 'Journey owner space'
  });
  const current = await sessionIdentity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(current.spaceId);
  return { agent, ...current };
}

async function journeyMemberAgent(spaceId: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: 'Journey Member',
    email: `journey-member-${Date.now()}@example.test`,
    password: 'Journey-Member-2026!',
    spaceName: 'Journey member space'
  });
  const current = await sessionIdentity(agent);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(spaceId, current.userId, 'member', now, now);
  db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, current.userId);
  return { agent, ...current, sharedSpaceId: spaceId };
}

test('serves versioned assets immutably and never substitutes HTML for a missing asset', async () => {
  const asset = await request(app).get('/assets/current-build-a1b2c3.js').expect(200);
  assert.match(String(asset.headers['content-type']), /javascript/);
  assert.match(String(asset.headers['cache-control']), /public/);
  assert.match(String(asset.headers['cache-control']), /max-age=31536000/);
  assert.match(String(asset.headers['cache-control']), /immutable/);
  assert.match(asset.text, /__experienceAssetLoaded/);
  const stylesheet = await request(app).get('/assets/current-build-d4e5f6.css?cache=bust').expect(200);
  assert.match(String(stylesheet.headers['content-type']), /text\/css/);
  assert.match(String(stylesheet.headers['cache-control']), /immutable/);

  const missing = await request(app).get('/assets/retired-build-deadbeef.js').expect(404);
  assert.match(String(missing.headers['content-type']), /text\/plain/);
  assert.equal(missing.headers['cache-control'], 'no-store');
  assert.doesNotMatch(missing.text, /Experience test shell/);
  await request(app).head('/assets/retired-build-deadbeef.js').expect(404).expect('Cache-Control', 'no-store');

  const html = await request(app).get('/surveys/new').expect(200);
  assert.match(String(html.headers['content-type']), /text\/html/);
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.match(html.text, /Experience test shell/);
  await request(app).get('/index.html').expect(200).expect('Cache-Control', 'no-store');
});

test('supports shared-workspace signup and one-time password recovery', async () => {
  const email = 'researcher@example.com'; const originalPassword = 'Researcher-Start-2026';
  const created = request.agent(app);
  const account = await signupVerifyAndOnboard(created, { name: 'Research Owner', email, password: originalPassword });
  assert.equal(account.signup.body.authenticated, false);
  assert.equal(account.signup.body.code, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(account.verified.body.user.email, email);
  assert.equal(account.verified.body.user.role, 'owner');
  assert.equal(account.body.onboardingRequired, false);
  await created.get('/api/bootstrap').expect(200);
  const duplicate = await request(app).post('/api/auth/signup').send({ name: 'Duplicate User', email, password: originalPassword }).expect(202);
  assert.equal(duplicate.body.authenticated, false);
  assert.equal(duplicate.body.code, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(duplicate.body.email, email);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM users WHERE email=?').get(email) as any).count, 1);
  const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'missing@example.com' }).expect(202);
  const known = await request(app).post('/api/auth/forgot-password').send({ email }).expect(202);
  assert.equal(known.body.message, unknown.body.message);

  const issued = issuePasswordResetToken(email);
  assert.ok(issued?.token);
  const resetAgent = request.agent(app); const newPassword = 'Researcher-Reset-2026';
  await resetAgent.post('/api/auth/reset-password').send({ token: issued.token, password: newPassword }).expect(200);
  await resetAgent.get('/api/bootstrap').expect(200);
  await request(app).post('/api/auth/reset-password').send({ token: issued.token, password: 'Another-Password-2026' }).expect(400);
  await request(app).post('/api/auth/login').send({ email, password: originalPassword }).expect(401);
  await request(app).post('/api/auth/login').send({ email, password: newPassword }).expect(200);
});

test('protects admin APIs while allowing a complete public survey workflow', async () => {
  await request(app).get('/login').expect(200).expect(/Experience test shell/);
  await request(app).get('/api/bootstrap').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'wrong-password-long-enough' }).expect(401);
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  assert.equal(login.body.authenticated, true);
  await agent.get('/api/auth/session').expect(200).expect(({ body }) => assert.equal(body.authenticated, true));

  const created = await agent.post('/api/templates/customer-nps/create').send({ title: 'API journey survey' }).expect(201);
  const survey = created.body.survey; const collector = created.body.collector;
  assert.equal(survey.questions.length, 4);
  await agent.post(`/api/surveys/${survey.id}/publish`).send({ status: 'live' }).expect(200);
  await request(app).get(`/api/public/collectors/${collector.slug}`).expect(200);

  const answers = { [survey.questions[0].id]: 4, [survey.questions[1].id]: 'Setup was confusing and I need help.' };
  const submitted = await request(app).post(`/api/public/collectors/${collector.slug}/responses`).send({ answers, status: 'completed' }).expect(201);
  assert.equal(submitted.body.status, 'completed');
  const responses = await agent.get(`/api/surveys/${survey.id}/responses`).expect(200);
  assert.equal(responses.body.length, 1);
  const jobs = await agent.get('/api/ai/jobs').expect(200);
  assert.equal(jobs.body.length, 1);
  assert.equal(jobs.body[0].kind, 'response.analyze');
  assert.equal(jobs.body[0].state, 'queued');
  await request(app).post(`/api/public/collectors/${collector.slug}/responses`).send({ answers: {}, status: 'completed' }).expect(400);

  const conditional = await agent.post('/api/surveys').send({
    title: 'Conditional product review', purpose: 'market_research', primaryMetric: 'custom',
    questions: [
      { id: 'logic-source', page: 1, position: 0, type: 'dropdown', title: 'What should happen next?', required: true, options: ['Continue', 'Escalate'], settings: {}, logic: [{ action: 'skip_to', sourceQuestionId: 'logic-source', operator: 'equals', value: 'Escalate', targetQuestionId: 'logic-target' }] },
      { id: 'logic-skipped', page: 2, position: 1, type: 'multi_text', title: 'Tell us about each product', required: true, options: ['Product A', 'Product B'], settings: {}, logic: [] },
      { id: 'logic-target', page: 3, position: 2, type: 'graphical_rating', title: 'Rate the experience', required: true, options: [], settings: {}, logic: [{ action: 'create_ticket', sourceQuestionId: 'logic-source', operator: 'equals', value: 'Escalate' }] }
    ]
  }).expect(201);
  const conditionalCollector = await agent.post(`/api/surveys/${conditional.body.id}/collectors`).send({ name: 'Conditional web', type: 'web' }).expect(201);
  await agent.post(`/api/surveys/${conditional.body.id}/publish`).send({ status: 'live' }).expect(200);
  await request(app).post(`/api/public/collectors/${conditionalCollector.body.slug}/responses`).send({ answers: { 'logic-source': 'Escalate', 'logic-target': 1 }, status: 'completed' }).expect(201);
  const tickets = await agent.get(`/api/surveys/${conditional.body.id}/tickets`).expect(200);
  assert.equal(tickets.body.length, 1);
  assert.equal(tickets.body[0].priority, 'high');
  const recoveryDetail = await agent.get(`/api/tickets/${tickets.body[0].id}`).expect(200);
  assert.equal(recoveryDetail.body.response.id, tickets.body[0].response_id);
  assert.equal(recoveryDetail.body.response.answers['logic-source'], 'Escalate');
  assert.equal(recoveryDetail.body.events[0].eventType, 'created');
  assert.equal(recoveryDetail.body.events[0].detail.source, 'survey_rule');
});

test('opens, isolates, and tracks manual recovery cases through closure', async () => {
  await request(app).post('/api/tickets').send({}).expect(401);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Manual recovery workflow', purpose: 'customer_experience', primaryMetric: 'custom', questions: []
  }).expect(201);
  const created = await agent.post('/api/tickets').send({
    surveyId: survey.body.id,
    title: 'Customer requested a billing follow-up',
    priority: 'high',
    owner: 'Customer success',
    notes: 'Confirm the disputed renewal before responding.'
  }).expect(201);
  assert.equal(created.body.status, 'open');
  assert.equal(created.body.responseId, null);
  assert.equal(created.body.survey.id, survey.body.id);
  assert.equal(created.body.events.length, 1);
  assert.equal(created.body.events[0].eventType, 'created');

  const aggregate = await agent.get('/api/tickets').expect(200);
  assert.ok(aggregate.body.some((item: any) => item.id === created.body.id && item.eventCount === 1));
  const legacy = await agent.get(`/api/surveys/${survey.body.id}/tickets`).expect(200);
  assert.ok(legacy.body.some((item: any) => item.id === created.body.id));

  const updated = await agent.patch(`/api/tickets/${created.body.id}`).send({
    status: 'in_progress', priority: 'urgent', owner: 'Michael', notes: 'Customer contacted; finance is reviewing.'
  }).expect(200);
  assert.equal(updated.body.status, 'in_progress');
  assert.equal(updated.body.priority, 'urgent');
  assert.equal(updated.body.events.length, 2);
  assert.equal(updated.body.events[1].eventType, 'updated');

  await agent.patch(`/api/tickets/${created.body.id}`).send({ status: 'closed' }).expect(200);
  const closed = await agent.get('/api/tickets?status=closed&priority=urgent').expect(200);
  assert.ok(closed.body.some((item: any) => item.id === created.body.id));
  const detail = await agent.get(`/api/tickets/${created.body.id}`).expect(200);
  assert.equal(detail.body.status, 'closed');
  assert.equal(detail.body.events.at(-1).eventType, 'closed');

  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, {
    name: 'Recovery Outsider', email: `recovery-outsider-${Date.now()}@example.com`, password: 'Recovery-Outsider-2026', spaceName: 'Separate recovery space'
  });
  await outsider.get(`/api/tickets/${created.body.id}`).expect(404);
  const outsiderList = await outsider.get('/api/tickets').expect(200);
  assert.equal(outsiderList.body.some((item: any) => item.id === created.body.id), false);
  await outsider.patch(`/api/tickets/${created.body.id}`).send({ status: 'open' }).expect(404);

  await agent.post('/api/tickets').send({ surveyId: survey.body.id, title: 'x' }).expect(400);
  await agent.post('/api/tickets').send({ surveyId: survey.body.id, responseId: crypto.randomUUID(), title: 'Missing response' }).expect(404);
});

test('persists social mentions and journey maps before Terra work is dispatched', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);

  const imported = await agent.post('/api/social/mentions').send({
    mentions: [
      { source: 'google_play', content: 'Setup was confusing, but support resolved the issue quickly.' },
      { source: 'x', content: 'The latest onboarding flow is much easier to understand.' }
    ],
    analyze: true
  }).expect(202);
  assert.equal(imported.body.mentions.length, 2);
  assert.match(imported.body.jobId, /^[a-f0-9-]{36}$/);
  const mentions = await agent.get('/api/social/mentions?limit=not-a-number').expect(200);
  assert.equal(mentions.body.length, 2);
  assert.equal(mentions.body[0].analysis, null);
  const socialJob = await agent.get(`/api/ai/jobs/${imported.body.jobId}`).expect(200);
  assert.equal(socialJob.body.kind, 'social.analyze');
  assert.deepEqual(socialJob.body.input.mentionIds.sort(), imported.body.mentions.map((mention: any) => mention.id).sort());
  await agent.post('/api/social/analyze').send({ mentionIds: [] }).expect(400);

  const created = await agent.post('/api/journeys').send({
    name: 'Customer onboarding journey', audience: 'New customers', industry: 'Software', objective: 'Improve activation', summary: 'A measurable onboarding lifecycle.',
    stages: [{ name: 'Discover', goal: 'Understand value', touchpoints: ['Website'], customerActions: ['Compare options'], emotions: ['Curious'], painPoints: ['Unclear pricing'], metrics: ['Visit-to-demo conversion'], opportunities: ['Clarify plans'], recommendedActions: ['Publish a plan comparison', '=WEBSERVICE("https://invalid.example")'] }]
  }).expect(201);
  assert.equal(created.body.provenance.origin, 'workspace');
  assert.equal(created.body.provenance.evidenceLevel, 'hypothesis');
  await request(app).get(`/api/journeys/${created.body.id}`).expect(401);
  await agent.post('/api/journeys').send({ ...created.body }).expect(409);
  await agent.post('/api/journeys').send({ name: '   ', stages: created.body.stages }).expect(400);
  await agent.post('/api/ai/journeys').send({ brief: '          ' }).expect(400);
  const journeys = await agent.get('/api/journeys').expect(200);
  assert.equal(journeys.body[0].id, created.body.id);
  assert.equal(journeys.body[0].stages[0].metrics[0], 'Visit-to-demo conversion');

  const conflict = await agent.patch(`/api/journeys/${created.body.id}`).send({ expectedUpdatedAt: '2020-01-01T00:00:00.000Z', summary: 'Stale edit' }).expect(409);
  assert.equal(conflict.body.current.summary, created.body.summary);
  const updated = await agent.patch(`/api/journeys/${created.body.id}`).send({ expectedUpdatedAt: created.body.updatedAt, summary: '  A clearer measurable onboarding lifecycle.  ' }).expect(200);
  assert.equal(updated.body.summary, 'A clearer measurable onboarding lifecycle.');
  assert.notEqual(updated.body.updatedAt, created.body.updatedAt);
  assert.equal(updated.body.provenance.lastModifiedBy, 'workspace');
  await agent.patch(`/api/journeys/${created.body.id}`).send({ expectedUpdatedAt: created.body.updatedAt, objective: 'Overwrite a newer edit' }).expect(409);

  await request(app).get(`/api/journeys/${created.body.id}/versions`).expect(401);
  const versionsAfterEdit = await agent.get(`/api/journeys/${created.body.id}/versions`).expect(200);
  assert.equal(versionsAfterEdit.body.length, 1);
  assert.equal(versionsAfterEdit.body[0].reason, 'workspace_edit');
  assert.equal(versionsAfterEdit.body[0].name, created.body.name);
  assert.equal(versionsAfterEdit.body[0].stageCount, 1);
  assert.equal(versionsAfterEdit.body[0].snapshotUpdatedAt, created.body.updatedAt);
  assert.equal('snapshot' in versionsAfterEdit.body[0], false);
  await agent.post(`/api/journeys/${created.body.id}/versions/${versionsAfterEdit.body[0].id}/restore`)
    .send({ expectedUpdatedAt: created.body.updatedAt }).expect(409);
  const restored = await agent.post(`/api/journeys/${created.body.id}/versions/${versionsAfterEdit.body[0].id}/restore`)
    .send({ expectedUpdatedAt: updated.body.updatedAt }).expect(200);
  assert.equal(restored.body.summary, created.body.summary);
  assert.notEqual(restored.body.updatedAt, updated.body.updatedAt);
  const versionsAfterRestore = await agent.get(`/api/journeys/${created.body.id}/versions`).expect(200);
  assert.equal(versionsAfterRestore.body.length, 2);
  const displaced = versionsAfterRestore.body.find((version: any) => version.reason === 'restore_displaced');
  assert.equal(displaced.snapshotUpdatedAt, updated.body.updatedAt);

  const exportedJson = await agent.get(`/api/journeys/${created.body.id}/export.json`).expect(200);
  assert.equal(exportedJson.body.id, created.body.id);
  assert.match(String(exportedJson.headers['content-disposition']), /journey-map-[a-f0-9]{16}\.json/);
  const exportedCsv = await agent.get(`/api/journeys/${created.body.id}/export.csv`).expect(200);
  assert.match(String(exportedCsv.headers['content-type']), /text\/csv/);
  assert.match(exportedCsv.text, /"metric","Visit-to-demo conversion"/);
  assert.match(exportedCsv.text, /"recommended_action","'=WEBSERVICE/);

  const optimized = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'Ownership and metrics' }).expect(202);
  assert.equal(optimized.body.deduplicated, false);
  const duplicateOptimization = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: '  ownership   AND metrics  ' }).expect(202);
  assert.equal(duplicateOptimization.body.deduplicated, true);
  assert.equal(duplicateOptimization.body.jobId, optimized.body.jobId);
  const differentOptimization = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'A different audit' }).expect(409);
  assert.equal(differentOptimization.body.code, 'JOURNEY_SUGGESTION_ACTIVE');
  assert.equal(differentOptimization.body.details.runId, optimized.body.suggestionId);
  assert.equal(differentOptimization.body.details.state, 'queued');
  const optimizationJob = await agent.get(`/api/ai/jobs/${optimized.body.jobId}`).expect(200);
  assert.equal(optimizationJob.body.kind, 'journey.optimize');
  assert.equal(optimizationJob.body.input.suggestionRunId, optimized.body.suggestionId);
  assert.equal('journeyId' in optimizationJob.body.input, false);
  const changedWhileActive = await agent.patch(`/api/journeys/${created.body.id}`).send({
    expectedUpdatedAt: restored.body.updatedAt, summary: 'A newer version while the audit is still queued.'
  }).expect(200);
  const staleOptimization = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'Ownership and metrics' }).expect(202);
  assert.equal(staleOptimization.body.deduplicated, true);
  assert.equal(staleOptimization.body.jobId, optimized.body.jobId);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM ai_jobs WHERE kind='journey.optimize'
    AND CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.suggestionRunId') END=?`).get(optimized.body.suggestionId) as any).count, 1);
  const generated = await agent.post('/api/ai/journeys').send({ brief: 'Map the complete onboarding lifecycle for a new software customer.', audience: 'New customers' }).expect(202);
  const generationJob = await agent.get(`/api/ai/jobs/${generated.body.jobId}`).expect(200);
  assert.equal(generationJob.body.kind, 'journey.generate');

  await agent.delete(`/api/journeys/${created.body.id}`).send({}).expect(400);
  const staleDelete = await agent.delete(`/api/journeys/${created.body.id}`).send({ expectedUpdatedAt: restored.body.updatedAt }).expect(409);
  assert.equal(staleDelete.body.current.updatedAt, changedWhileActive.body.updatedAt);
  const retainedDelete = await agent.delete(`/api/journeys/${created.body.id}`)
    .send({ expectedUpdatedAt: changedWhileActive.body.updatedAt }).expect(409);
  assert.equal(retainedDelete.body.code, 'JOURNEY_AI_AUDIT_RETENTION');
  await agent.get(`/api/journeys/${created.body.id}`).expect(200);
  await agent.get(`/api/ai/jobs/${optimized.body.jobId}`).expect(200);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_applications WHERE journey_id=?').get(created.body.id) as any).count, 0);
  await agent.delete(`/api/social/mentions/${imported.body.mentions[0].id}`).expect(204);
});

test('legacy journey routes enforce member read-only capabilities explicitly', async () => {
  const owner = await journeyOwnerAgent();
  const member = await journeyMemberAgent(owner.spaceId);

  const created = await owner.agent.post('/api/journeys').send({
    name: 'Shared customer onboarding journey',
    audience: 'New customers',
    industry: 'Software',
    objective: 'Improve activation',
    summary: 'Journey used to verify member permissions.',
    stages: [{
      name: 'Discover',
      goal: 'Understand value',
      touchpoints: ['Website'],
      customerActions: ['Compare options'],
      emotions: ['Curious'],
      painPoints: ['Unclear pricing'],
      metrics: ['Visit-to-demo conversion'],
      opportunities: ['Clarify plans'],
      recommendedActions: ['Publish a plan comparison']
    }]
  }).set('X-Seemplify-Space', owner.spaceId).expect(201);

  await member.agent.get('/api/journeys')
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get(`/api/journeys/${created.body.id}`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await member.agent.get(`/api/journeys/${created.body.id}/versions`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);

  await member.agent.post('/api/journeys').set('X-Seemplify-Space', owner.spaceId).send({
    name: 'Member denied journey',
    stages: created.body.stages
  }).expect(403);
  await member.agent.patch(`/api/journeys/${created.body.id}`).set('X-Seemplify-Space', owner.spaceId).send({
    expectedUpdatedAt: created.body.updatedAt,
    summary: 'Members must not edit shared journeys.'
  }).expect(403);
  await member.agent.delete(`/api/journeys/${created.body.id}`).set('X-Seemplify-Space', owner.spaceId).send({
    expectedUpdatedAt: created.body.updatedAt
  }).expect(403);
  await member.agent.post('/api/ai/journeys').set('X-Seemplify-Space', owner.spaceId).send({
    brief: 'Map the onboarding lifecycle for new software customers.'
  }).expect(403);
  await member.agent.post(`/api/journeys/${created.body.id}/ai/optimize`).set('X-Seemplify-Space', owner.spaceId).send({
    focus: 'Ownership and metrics'
  }).expect(403);
  await member.agent.post(`/api/journeys/${created.body.id}/versions/version-1/restore`).set('X-Seemplify-Space', owner.spaceId).send({
    expectedUpdatedAt: created.body.updatedAt
  }).expect(403);
  await member.agent.get(`/api/journeys/${created.body.id}/export.json`)
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
  await member.agent.get(`/api/journeys/${created.body.id}/export.csv`)
    .set('X-Seemplify-Space', owner.spaceId).expect(403);
});

test('imports bounded UTF-8 social listening files with explicit field mapping', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  await request(app).post('/api/social/mentions/import').attach('file', Buffer.from('Mention\nNot authenticated'), 'mentions.csv').expect(401);

  const csv = '\uFEFFReview Text,Reviewer,Link,Published\r\n"Fast delivery, but setup was confusing",Ada,https://example.com/1,2026-07-20\r\n"Support replied quickly",Ben,https://example.com/2,2026-07-21';
  const imported = await agent.post('/api/social/mentions/import')
    .field('defaultSource', 'review').field('analyze', 'false')
    .field('mapping', JSON.stringify({ content: 'Review Text', author: 'Reviewer', url: 'Link', publishedAt: 'Published' }))
    .attach('file', Buffer.from(csv), { filename: 'reviews.csv', contentType: 'text/csv' }).expect(201);
  assert.equal(imported.body.mentions.length, 2);
  assert.equal(imported.body.mentions[0].source, 'review');
  assert.equal(imported.body.mentions[0].author, 'Ada');
  assert.equal(imported.body.jobId, null);
  assert.deepEqual({ ...imported.body.summary, batchId: undefined, fileHash: undefined, replayed: undefined }, { fileName: 'reviews.csv', format: 'csv', totalRecords: 2, imported: 2, skipped: 0, mapping: { content: 'Review Text', author: 'Reviewer', url: 'Link', publishedAt: 'Published' }, batchId: undefined, fileHash: undefined, replayed: undefined });
  assert.match(imported.body.summary.batchId, /^[0-9a-f-]{36}$/i);
  assert.match(imported.body.summary.fileHash, /^[0-9a-f]{64}$/i);
  assert.equal(imported.body.summary.replayed, false);
  assert.equal(imported.body.mentions[0].metadata.seemplifyImport.batchId, imported.body.summary.batchId);

  const replayed = await agent.post('/api/social/mentions/import')
    .field('defaultSource', 'review').field('analyze', 'false')
    .field('mapping', JSON.stringify({ publishedAt: 'Published', url: 'Link', author: 'Reviewer', content: 'Review Text' }))
    .attach('file', Buffer.from(csv), { filename: 'reviews.csv', contentType: 'text/csv' }).expect(201);
  assert.deepEqual(replayed.body.mentions.map((mention: any) => mention.id), imported.body.mentions.map((mention: any) => mention.id));
  assert.equal(replayed.body.summary.batchId, imported.body.summary.batchId);
  assert.equal(replayed.body.summary.imported, 0);
  assert.equal(replayed.body.summary.skipped, 2);
  assert.equal(replayed.body.summary.replayed, true);

  const jsonImport = await agent.post('/api/social/mentions/import').field('defaultSource', 'forum').field('analyze', 'false')
    .attach('file', Buffer.from(JSON.stringify([{ content: 'A valid forum mention', author: 'Researcher' }])), { filename: 'mentions.json', contentType: 'application/json' }).expect(201);
  assert.equal(jsonImport.body.mentions[0].source, 'forum');
  const txtImport = await agent.post('/api/social/mentions/import').field('defaultSource', 'other').field('analyze', 'false')
    .attach('file', Buffer.from('First permitted mention\nSecond permitted mention'), { filename: 'mentions.txt', contentType: 'text/plain' }).expect(201);
  assert.equal(txtImport.body.mentions.length, 2);

  await agent.post('/api/social/mentions/import').field('defaultSource', 'review').field('mapping', JSON.stringify({ content: 'Missing header' }))
    .attach('file', Buffer.from('Content\nA review'), 'bad.csv').expect(400).expect(({ body }) => assert.match(body.error, /Mapped column/));
  await agent.post('/api/social/mentions/import').field('defaultSource', 'review')
    .attach('file', Buffer.from(Array.from({ length: 201 }, (_, index) => `Mention ${index}`).join('\n')), 'too-many.txt').expect(400)
    .expect(({ body }) => assert.match(body.error, /at most 200/));
  await agent.post('/api/social/mentions/import').field('defaultSource', 'review')
    .attach('file', Buffer.from([0xc3, 0x28]), 'invalid.txt').expect(400).expect(({ body }) => assert.match(body.error, /valid UTF-8/));
});

test('runs a durable multi-step survey campaign and stops reminders after response', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Campaign-linked satisfaction survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'csat',
    questions: [{ id: 'campaign-rating', page: 1, position: 0, type: 'single_choice', title: 'How was the service?', required: true, options: ['Great', 'Needs work'], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const templates = await agent.get('/api/campaign-templates').expect(200);
  assert.ok(templates.body.some((item: any) => item.id === 'simple-survey-invitation'));

  const created = await agent.post('/api/campaigns').send({ name: 'July feedback campaign', surveyId: survey.body.id, templateId: 'simple-survey-invitation' }).expect(201);
  assert.equal(created.body.campaign.status, 'draft');
  assert.equal(created.body.collector.type, 'email');
  assert.equal(created.body.steps.length, 2);
  const campaignId = created.body.campaign.id;
  const steps = await agent.put(`/api/campaigns/${campaignId}/steps`).send({ steps: [
    { delayMinutes: 0, subject: 'Hello {{first_name}}', mode: 'html', bodyText: 'Please answer {{survey_title}}: {{survey_link}}', bodyHtml: '<script>alert(1)</script><p>Hello {{first_name}}</p><a href="javascript:alert(1)">Unsafe</a><a href="{{survey_link}}">Survey</a>', embedQuestionId: 'campaign-rating' },
    { delayMinutes: 60, subject: 'Reminder: {{survey_title}}', mode: 'plain', bodyText: 'A reminder for {{first_name}} at {{company}}: {{survey_link}}' }
  ] }).expect(200);
  assert.equal(steps.body.steps[1].delayMinutes, 60);

  const contacts = await agent.post(`/api/campaigns/${campaignId}/contacts`).send({ contacts: [
    { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', jobTitle: 'Mathematician', company: 'Analytical Engines', customData: { segment: 'customer' } },
    { email: 'ADA@example.com', firstName: 'Duplicate' }
  ] }).expect(201);
  assert.equal(contacts.body.summary.received, 2);
  assert.equal(contacts.body.summary.added, 1);
  assert.equal(contacts.body.summary.duplicates, 1);
  assert.equal(contacts.body.summary.imported, 1);
  assert.equal(contacts.body.summary.skipped, 1);
  assert.equal(contacts.body.contacts[0].firstName, 'Ada');
  assert.equal(contacts.body.contacts[0].lastName, 'Lovelace');
  assert.equal(contacts.body.contacts[0].jobTitle, 'Mathematician');
  assert.equal(contacts.body.contacts[0].company, 'Analytical Engines');
  assert.deepEqual(contacts.body.contacts[0].customData, { segment: 'customer' });
  const contactId = contacts.body.contacts[0].id;
  const updatedContact = await agent.put(`/api/campaigns/${campaignId}/contacts/${contactId}`).send({
    jobTitle: 'Chief analyst', customData: { 'Account tier': 'Enterprise', Region: 'London' }
  }).expect(200);
  assert.equal(updatedContact.body.jobTitle, 'Chief analyst');
  assert.deepEqual(updatedContact.body.customData, { 'Account tier': 'Enterprise', Region: 'London' });
  await agent.post(`/api/campaigns/${campaignId}/contacts`).send({ contacts: [{
    email: 'collision@example.com', customData: { 'Account tier': 'Enterprise', 'account-tier': 'Duplicate token' }
  }] }).expect(400);
  await agent.post(`/api/campaigns/${campaignId}/contacts`).send({ contacts: [{
    email: 'too-many-fields@example.com', customData: Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`Field ${index}`, `${index}`]))
  }] }).expect(400);
  const testSend = await agent.post(`/api/campaigns/${campaignId}/test`).send({ email: 'preview@example.com' }).expect(200);
  assert.equal(testSend.body.outcomes[0].status, 'sent');
  assert.doesNotMatch(sanitizeCampaignHtml('<script>alert(1)</script><p>Safe</p><a href="javascript:bad">No</a>'), /script|javascript/i);

  const readiness = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  assert.equal(readiness.body.readiness.sections.setup.complete, true);
  assert.equal(readiness.body.readiness.sections.audience.complete, true);
  assert.equal(readiness.body.readiness.sections.sequence.complete, true);
  assert.equal(readiness.body.readiness.sections.schedule.complete, false);
  assert.match(readiness.body.readiness.sections.schedule.issues[0], /start time/i);
  await agent.post(`/api/campaigns/${campaignId}/launch`).send({}).expect(400)
    .expect(({ body }) => assert.match(body.error, /start time/i));

  await agent.post(`/api/campaigns/${campaignId}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  await campaignRunner.pump();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const running = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  assert.equal(running.body.metrics.sentDeliveries, 1);
  assert.equal(running.body.metrics.queuedDeliveries, 1);
  assert.equal(running.body.contacts[0].status, 'active');
  await agent.put(`/api/campaigns/${campaignId}/contacts/${contactId}`).send({ firstName: 'Augusta' }).expect(400)
    .expect(({ body }) => assert.match(body.error, /pause the campaign/i));
  const token = running.body.contacts[0].token;
  const slug = running.body.collector.slug;

  await request(app).post(`/api/public/collectors/${slug}/responses`).query({ recipient: token }).send({ answers: { 'campaign-rating': 'Great' }, status: 'completed' }).expect(201);
  const completed = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  assert.equal(completed.body.contacts[0].status, 'responded');
  assert.equal(completed.body.metrics.skippedDeliveries, 1);
  assert.equal(completed.body.campaign.status, 'completed');
  const summaries = await agent.get('/api/campaigns').expect(200);
  assert.ok(summaries.body.some((item: any) => item.id === campaignId && item.metrics.respondedContacts === 1));
  await agent.delete(`/api/campaigns/${campaignId}/contacts/${completed.body.contacts[0].id}`).expect(404);
  const preserved = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  assert.equal(preserved.body.contacts[0].status, 'responded');
});

test('pauses, resumes and recovers leased campaign deliveries without losing work', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Durability campaign survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'durable-answer', page: 1, position: 0, type: 'short_text', title: 'What should improve?', required: true, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const campaign = await agent.post('/api/campaigns').send({ name: 'Durable campaign', surveyId: survey.body.id }).expect(201);
  const id = campaign.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 30, subject: 'Scheduled survey', mode: 'plain', bodyText: '{{survey_link}}' }] }).expect(200);
  const added = await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'queued@example.com' }] }).expect(201);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  await agent.post(`/api/campaigns/${id}/pause`).send({}).expect(200);
  await campaignRunner.pump();
  const paused = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(paused.body.metrics.sentDeliveries, 0);
  assert.equal(paused.body.metrics.queuedDeliveries, 1);
  await agent.post(`/api/campaigns/${id}/resume`).send({}).expect(200);

  const deliveryId = (db.prepare('SELECT id FROM campaign_deliveries WHERE campaign_id=?').get(id) as any).id;
  db.prepare("UPDATE campaign_deliveries SET state='sending' WHERE id=?").run(deliveryId);
  assert.equal(recoverCampaignDeliveries(), 1);
  const recovered = db.prepare('SELECT state,error FROM campaign_deliveries WHERE id=?').get(deliveryId) as any;
  assert.equal(recovered.state, 'queued');
  assert.match(recovered.error, /Recovered/);
  await agent.post(`/api/campaigns/${id}/pause`).send({}).expect(200);
  await agent.delete(`/api/campaigns/${id}/contacts/${added.body.contacts[0].id}`).expect(204);
  const detail = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(detail.body.contacts[0].status, 'suppressed');
  assert.equal(detail.body.metrics.skippedDeliveries, 1);
  assert.equal(detail.body.campaign.status, 'paused');
  const reconciled = await agent.post(`/api/campaigns/${id}/resume`).send({}).expect(200);
  assert.equal(reconciled.body.campaign.status, 'completed');
});

test('can continue follow-ups after a response when stop-on-response is disabled', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Continued follow-up survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'follow-up-answer', page: 1, position: 0, type: 'short_text', title: 'Your comment', required: true, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const created = await agent.post('/api/campaigns').send({ name: 'Continue after response', surveyId: survey.body.id, stopOnResponse: false }).expect(201);
  const id = created.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [
    { delayMinutes: 0, subject: 'First', mode: 'plain', bodyText: '{{survey_link}}' },
    { delayMinutes: 60, subject: 'Second', mode: 'plain', bodyText: '{{survey_link}}' }
  ] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'continue@example.com' }] }).expect(201);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  await campaignRunner.pump(); await new Promise((resolve) => setTimeout(resolve, 20));
  const before = await agent.get(`/api/campaigns/${id}`).expect(200);
  const contact = before.body.contacts[0];
  await request(app).post(`/api/public/collectors/${before.body.collector.slug}/responses`).query({ recipient: contact.token }).send({ answers: { 'follow-up-answer': 'Already answered' }, status: 'completed' }).expect(201);
  const after = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(after.body.contacts[0].status, 'active');
  assert.ok(after.body.contacts[0].respondedAt);
  assert.equal(after.body.metrics.responded, 1);
  assert.equal(after.body.metrics.queued, 1);
  assert.equal(after.body.campaign.status, 'active');
  await agent.delete(`/api/campaigns/${id}/contacts/${contact.id}`).expect(204);
});

test('does not orphan a follow-up when a response arrives during an in-flight send', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'In-flight response survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'race-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: true, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const created = await agent.post('/api/campaigns').send({ name: 'In-flight campaign', surveyId: survey.body.id }).expect(201);
  const id = created.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [
    { delayMinutes: 0, subject: 'First', mode: 'plain', bodyText: '{{survey_link}}' },
    { delayMinutes: 60, subject: 'Second', mode: 'plain', bodyText: '{{survey_link}}' }
  ] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'race@example.com' }] }).expect(201);

  const originalMode = config.emailMode; const originalKey = config.mailApiToken; const originalFetch = globalThis.fetch;
  let releaseSend!: (value: Response) => void; let providerRequest: any; let providerIdempotencyKey = '';
  const pendingSend = new Promise<Response>((resolve) => { releaseSend = resolve; });
  config.emailMode = 'send'; config.mailApiToken = 'key-id.test-secret';
  globalThis.fetch = async (url, init) => String(url) === `${config.mailApiBaseUrl}/v1/messages`
    ? (providerRequest = JSON.parse(String(init?.body || '{}')),
      providerIdempotencyKey = String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''),
      pendingSend)
    : new Response(JSON.stringify({ error: 'runtime unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
  try {
    await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (db.prepare('SELECT state FROM campaign_deliveries WHERE campaign_id=?').get(id) as any)?.state;
      if (state === 'sending') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const during = await agent.get(`/api/campaigns/${id}`).expect(200);
    assert.equal(during.body.deliveries[0].state, 'sending');
    assert.equal(providerIdempotencyKey, during.body.deliveries[0].id);
    assert.match(providerRequest.html, /\/api\/public\/campaigns\/unsubscribe\//);
    await request(app).post(`/api/public/collectors/${during.body.collector.slug}/responses`).query({ recipient: during.body.contacts[0].token }).send({ answers: { 'race-answer': 'Responded while sending' }, status: 'completed' }).expect(201);
    releaseSend(new Response(JSON.stringify({ status: 'accepted', messageId: 'race-message' }), { status: 202, headers: { 'content-type': 'application/json' } }));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (db.prepare('SELECT status FROM campaigns WHERE id=?').get(id) as any)?.status;
      if (state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const after = await agent.get(`/api/campaigns/${id}`).expect(200);
    assert.equal(after.body.campaign.status, 'completed');
    assert.equal(after.body.contacts[0].status, 'responded');
    assert.equal(after.body.metrics.queued, 0);
    assert.equal(after.body.metrics.sendingDeliveries, 0);
    assert.equal(after.body.metrics.sent, 1);
  } finally {
    config.emailMode = originalMode; config.mailApiToken = originalKey; globalThis.fetch = originalFetch;
  }
});

test('enforces campaign collector, embedding and post-launch scheduling invariants', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Campaign invariant survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [
      { id: 'embed-first', page: 1, position: 0, type: 'single_choice', title: 'Choose one', required: false, options: ['One', 'Two'], settings: {}, logic: [] },
      { id: 'embed-later', page: 2, position: 1, type: 'single_choice', title: 'Later choice', required: false, options: ['One', 'Two'], settings: {}, logic: [] },
      { id: 'embed-dropdown', page: 1, position: 2, type: 'dropdown', title: 'Dropdown choice', required: false, options: ['One', 'Two'], settings: {}, logic: [] }
    ]
  }).expect(201);
  const closedCollector = await agent.post(`/api/surveys/${survey.body.id}/collectors`).send({ name: 'Closed email collector', type: 'email' }).expect(201);
  db.prepare("UPDATE collectors SET status='closed' WHERE id=?").run(closedCollector.body.id);
  await agent.post('/api/campaigns').send({ name: 'Closed collector campaign', surveyId: survey.body.id, collectorId: closedCollector.body.id }).expect(400)
    .expect(({ body }) => assert.match(body.error, /open email collector/i));
  const campaign = await agent.post('/api/campaigns').send({ name: 'Invariant campaign', surveyId: survey.body.id }).expect(201);
  const id = campaign.body.campaign.id;
  assert.notEqual(campaign.body.collector.id, closedCollector.body.id);
  assert.equal(campaign.body.collector.status, 'open');
  const originalStartAt = new Date(Date.now() + 30_000).toISOString();
  const rejectedStartAt = new Date(Date.now() + 45_000).toISOString();
  await agent.put(`/api/campaigns/${id}`).send({ startAt: originalStartAt }).expect(200);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: rejectedStartAt }).expect(400);
  const afterRejectedLaunch = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(afterRejectedLaunch.body.campaign.startsAt, originalStartAt);

  const step = (embedQuestionId: string) => ({ delayMinutes: 30, subject: 'Survey', mode: 'plain', bodyText: '{{survey_link}}', embedQuestionId });
  await agent.put(`/api/campaigns/${id}`).send({ name: '   ' }).expect(400);
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 0, subject: '   ', mode: 'plain', bodyText: 'Message' }] }).expect(400);
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 0, subject: 'Subject', mode: 'plain', bodyText: '   ' }] }).expect(400);
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 0, subject: 'Subject', mode: 'html', bodyText: '', bodyHtml: '   ' }] }).expect(400);
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-later')] }).expect(400)
    .expect(({ body }) => assert.match(body.error, /first survey page/i));
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-dropdown')] }).expect(400)
    .expect(({ body }) => assert.match(body.error, /supported choice or rating/i));
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-first')] }).expect(200);
  const alternate = await agent.post('/api/surveys').send({
    title: 'Alternate campaign survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'csat',
    questions: [{ id: 'alternate-embed', page: 1, position: 0, type: 'single_choice', title: 'Alternate choice', required: false, options: ['Yes', 'No'], settings: {}, logic: [] }]
  }).expect(201);
  const switched = await agent.put(`/api/campaigns/${id}`).send({ surveyId: alternate.body.id }).expect(200);
  assert.equal(switched.body.campaign.surveyId, alternate.body.id);
  assert.equal(switched.body.collector.surveyId, alternate.body.id);
  assert.ok(switched.body.steps.every((item: any) => item.embedQuestionId === null));
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('alternate-embed')] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'invariant@example.com' }] }).expect(201);
  await agent.post(`/api/surveys/${alternate.body.id}/publish`).send({ status: 'live' }).expect(200);
  db.prepare("UPDATE campaigns SET name='' WHERE id=?").run(id);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() + 60_000).toISOString() }).expect(400)
    .expect(({ body }) => assert.match(body.error, /campaign name/i));
  db.prepare("UPDATE campaigns SET name='Invariant campaign' WHERE id=?").run(id);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() + 60_000).toISOString() }).expect(200);
  await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(400)
    .expect(({ body }) => assert.match(body.error, /already been launched/i));
  await agent.put(`/api/campaigns/${id}`).send({ surveyId: survey.body.id }).expect(400)
    .expect(({ body }) => assert.match(body.error, /survey can only be changed while.*draft/i));
  await agent.put(`/api/campaigns/${id}`).send({ startAt: new Date(Date.now() + 120_000).toISOString() }).expect(400)
    .expect(({ body }) => assert.match(body.error, /cannot be changed after launch/i));
  await agent.post(`/api/campaigns/${id}/pause`).send({}).expect(200);
});

test('fails stale ambiguous delivery leases instead of risking duplicate sends', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Stale delivery recovery survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'stale-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const campaign = await agent.post('/api/campaigns').send({ name: 'Stale lease campaign', surveyId: survey.body.id }).expect(201);
  const id = campaign.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 30, subject: 'Later', mode: 'plain', bodyText: '{{survey_link}}' }] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'stale-lease@example.com' }] }).expect(201);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  const staleAt = new Date(Date.now() - (config.mailIdempotencyTtlMinutes + 5) * 60_000).toISOString();
  db.prepare("UPDATE campaign_deliveries SET state='sending',attempt=1,first_attempt_at=?,updated_at=? WHERE campaign_id=?").run(staleAt, staleAt, id);
  assert.equal(recoverCampaignDeliveries(), 1);
  const delivery = db.prepare('SELECT state,error FROM campaign_deliveries WHERE campaign_id=?').get(id) as any;
  const contact = db.prepare('SELECT status FROM campaign_contacts WHERE campaign_id=?').get(id) as any;
  assert.equal(delivery.state, 'failed');
  assert.match(delivery.error, /not retried to avoid a duplicate send/i);
  assert.equal(contact.status, 'failed');
});

test('persists the campaign sender name, keeps the verified sender email, and reports provider outcomes', async () => {
  assert.equal(config.mailIdempotencyTtlMinutes, Number(process.env.MAIL_IDEMPOTENCY_TTL_MINUTES));
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Provider outcome survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'provider-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  const defaultCampaign = await agent.post('/api/campaigns').send({ name: 'Default sender campaign', surveyId: survey.body.id }).expect(201);
  assert.equal(defaultCampaign.body.campaign.senderName, config.mailFromName);
  assert.equal(defaultCampaign.body.campaign.senderEmail, config.mailFromEmail);
  const senderName = 'Provider outcome research team';
  const campaign = await agent.post('/api/campaigns').send({
    name: 'Provider outcome campaign', surveyId: survey.body.id, senderName: `  ${senderName}  `
  }).expect(201);
  const id = campaign.body.campaign.id;
  assert.equal(campaign.body.campaign.senderName, senderName);
  assert.equal(campaign.body.campaign.senderEmail, config.mailFromEmail);
  const reloaded = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(reloaded.body.campaign.senderName, senderName);
  assert.equal(reloaded.body.campaign.senderEmail, config.mailFromEmail);
  const reset = await agent.put(`/api/campaigns/${id}`).send({ senderName: '   ' }).expect(200);
  assert.equal(reset.body.campaign.senderName, config.mailFromName);
  const saved = await agent.put(`/api/campaigns/${id}`).send({ senderName: `  ${senderName}  ` }).expect(200);
  assert.equal(saved.body.campaign.senderName, senderName);
  await agent.put(`/api/campaigns/${id}`).send({ senderName: 'Unsafe\r\nBcc: attacker@example.com' }).expect(400)
    .expect(({ body }) => assert.match(JSON.stringify(body.details), /control characters/i));
  await agent.put(`/api/campaigns/${id}`).send({ senderName: 'x'.repeat(151) }).expect(400)
    .expect(({ body }) => assert.match(JSON.stringify(body.details), /150|too_big/i));
  const originalMode = config.emailMode; const originalKey = config.mailApiToken; const originalFetch = globalThis.fetch;
  config.emailMode = 'send'; config.mailApiToken = 'key-id.test-secret';
  try {
    const requests: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    const record = (url: unknown, init: RequestInit | undefined) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      requests.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')), headers });
      return headers;
    };
    globalThis.fetch = async (url, init) => {
      record(url, init);
      return new Response(JSON.stringify({ message: 'Provider unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    };
    const failed = await agent.post(`/api/campaigns/${id}/test`).send({ email: 'failed-preview@example.com' }).expect(502);
    assert.equal(failed.body.outcomes[0].status, 'failed');
    assert.equal(requests[0].url, `${config.mailApiBaseUrl}/v1/messages`);
    assert.equal(requests[0].body.from, config.mailFromEmail);
    assert.equal(requests[0].body.fromName, senderName);
    assert.equal(requests[0].headers.Authorization, 'Bearer key-id.test-secret');
    assert.match(requests[0].headers['Idempotency-Key'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    let call = 0; requests.length = 0;
    globalThis.fetch = async (url, init) => {
      record(url, init); call += 1;
      return call === 1
        ? new Response(JSON.stringify({ status: 'accepted', messageId: 'accepted-message' }), { status: 202, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ message: 'Rejected message' }), { status: 500, headers: { 'content-type': 'application/json' } });
    };
    const mixed = await agent.post(`/api/campaigns/${id}/test`).send({ emails: ['accepted@example.com', 'rejected@example.com'] }).expect(207);
    assert.deepEqual(mixed.body.outcomes.map((outcome: any) => outcome.status), ['sent', 'failed']);
    assert.equal(new Set(requests.map((item) => item.headers['Idempotency-Key'])).size, 2);

    // A replayed Idempotency-Key answers 409: the original message was already
    // accepted, so the business event completes instead of sending twice.
    globalThis.fetch = async (_url, init) => {
      const key = (init?.headers as Record<string, string>)?.['Idempotency-Key'];
      return new Response(JSON.stringify({ status: 'duplicate', message: `Duplicate idempotency key ${key}` }), { status: 409, headers: { 'content-type': 'application/json' } });
    };
    const duplicate = await agent.post(`/api/campaigns/${id}/test`).send({ email: 'idempotent@example.com' }).expect(200);
    assert.equal(duplicate.body.outcomes[0].status, 'sent');
    assert.match(duplicate.body.outcomes[0].messageId, /^idempotent:/);

    // 401 is a deployment-credential fault, not a transient one.
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'invalid_key' }), { status: 401, headers: { 'content-type': 'application/json' } });
    const unauthorized = await agent.post(`/api/campaigns/${id}/test`).send({ email: 'unauthorized@example.com' }).expect(502);
    assert.equal(unauthorized.body.outcomes[0].status, 'failed');
    assert.match(unauthorized.body.outcomes[0].error, /rejected the credential/i);
    assert.doesNotMatch(JSON.stringify(unauthorized.body), /test-secret/, 'the bearer token must never reach a response body');

    requests.length = 0;
    globalThis.fetch = async (url, init) => {
      record(url, init);
      return new Response(JSON.stringify({ status: 'accepted', messageId: 'campaign-message' }), { status: 202, headers: { 'content-type': 'application/json' } });
    };
    await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
    await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'sender-delivery@example.com' }] }).expect(201);
    await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    await campaignRunner.pump();
    const campaignRequest = requests.find((item) => item.body.to?.[0] === 'sender-delivery@example.com');
    assert.ok(campaignRequest, 'the launched campaign should reach the mail service');
    assert.equal(campaignRequest.body.from, config.mailFromEmail);
    assert.equal(campaignRequest.body.fromName, senderName);
    assert.equal(campaignRequest.body.tag, 'campaign_delivery');
    await agent.put(`/api/campaigns/${id}`).send({ senderName: 'Changed after launch' }).expect(400)
      .expect(({ body }) => assert.match(body.error, /cannot be changed after launch/i));
    const locked = await agent.get(`/api/campaigns/${id}`).expect(200);
    assert.equal(locked.body.campaign.senderName, senderName);
  } finally {
    config.emailMode = originalMode; config.mailApiToken = originalKey; globalThis.fetch = originalFetch;
  }
});

test('personalizes job title and scalar custom contact fields without bypassing HTML escaping', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Personalized campaign survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'personalized-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const campaign = await agent.post('/api/campaigns').send({ name: 'Personalized fields campaign', surveyId: survey.body.id }).expect(201);
  const id = campaign.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{
    delayMinutes: 0, subject: '{{first_name}} · {{position}} · {{custom.account_tier}}', mode: 'html',
    bodyText: '{{first_name}} {{job_title}} {{custom.region}}',
    bodyHtml: '<p>{{first_name}} {{job_title}} {{custom.region}} {{unknown_value}}</p>'
  }] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{
    email: 'personalized@example.com', firstName: 'Mina', lastName: 'Test', jobTitle: 'Head <Research>',
    customData: { 'Account tier': 'Enterprise', Region: '<North>' }
  }] }).expect(201);
  const originalMode = config.emailMode; const originalKey = config.mailApiToken; const originalFetch = globalThis.fetch;
  let providerRequest: any;
  config.emailMode = 'send'; config.mailApiToken = 'key-id.test-secret';
  globalThis.fetch = async (_url, init) => {
    providerRequest = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ status: 'accepted', messageId: 'personalized-message' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  try {
    await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    await campaignRunner.pump();
    assert.equal(providerRequest.subject, 'Mina · Head <Research> · Enterprise');
    assert.match(providerRequest.html, /Mina Head &lt;Research&gt; &lt;North&gt; \{\{unknown_value\}\}/);
    assert.match(providerRequest.text, /^Mina Head <Research> <North>\n\nUnsubscribe:/);
    assert.equal(providerRequest.to[0], 'personalized@example.com');
  } finally {
    config.emailMode = originalMode; config.mailApiToken = originalKey; globalThis.fetch = originalFetch;
  }
});

test('requires unsubscribe confirmation and applies global suppression without GET side effects', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Unsubscribe flow survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'unsubscribe-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const first = await agent.post('/api/campaigns').send({ name: 'Unsubscribe campaign', surveyId: survey.body.id }).expect(201);
  const id = first.body.campaign.id;
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [{ delayMinutes: 30, subject: 'Later', mode: 'plain', bodyText: '{{survey_link}}' }] }).expect(200);
  const added = await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'unsubscribe-me@example.com' }] }).expect(201);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  const token = added.body.contacts[0].token;

  const preview = await request(app).get(`/api/public/campaigns/unsubscribe/${token}`).expect(200);
  assert.match(preview.text, /Confirm/);
  assert.equal((db.prepare('SELECT status FROM campaign_contacts WHERE id=?').get(added.body.contacts[0].id) as any).status, 'active');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM email_suppressions WHERE email=?').get('unsubscribe-me@example.com')?.count ?? 0, 0);

  await request(app).post(`/api/public/campaigns/unsubscribe/${token}`).expect(200).expect(/You are unsubscribed/);
  const detail = await agent.get(`/api/campaigns/${id}`).expect(200);
  assert.equal(detail.body.contacts[0].status, 'unsubscribed');
  assert.equal(detail.body.metrics.skippedDeliveries, 1);
  assert.equal(detail.body.metrics.unsubscribedContacts, 1);
  await request(app).get(`/api/public/campaigns/unsubscribe/${token}`).expect(200).expect(/Already unsubscribed/);

  const second = await agent.post('/api/campaigns').send({ name: 'Future campaign suppression', surveyId: survey.body.id }).expect(201);
  const suppressed = await agent.post(`/api/campaigns/${second.body.campaign.id}/contacts`).send({ contacts: [{ email: 'UNSUBSCRIBE-ME@example.com' }] }).expect(201);
  assert.deepEqual(suppressed.body.summary, { received: 1, added: 0, duplicates: 0, suppressed: 1, imported: 0, skipped: 1 });
  await request(app).post('/api/public/campaigns/unsubscribe/not-a-real-token').expect(404);
});

test('authenticates, bounds and idempotently applies single and batched Brevo delivery webhooks', async () => {
  const agent = request.agent(app); const webhookToken = 'test-brevo-webhook-secret-that-is-long-enough';
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Webhook delivery survey', purpose: 'customer_experience', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'webhook-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  const campaign = await agent.post('/api/campaigns').send({ name: 'Webhook campaign', surveyId: survey.body.id }).expect(201);
  const campaignId = campaign.body.campaign.id;
  await agent.put(`/api/campaigns/${campaignId}/steps`).send({ steps: [
    { delayMinutes: 0, subject: 'First', mode: 'plain', bodyText: '{{survey_link}}' },
    { delayMinutes: 60, subject: 'Follow-up', mode: 'plain', bodyText: '{{survey_link}}' }
  ] }).expect(200);
  await agent.post(`/api/campaigns/${campaignId}/contacts`).send({ contacts: [{ email: 'webhook-bounce@example.com' }] }).expect(201);
  await agent.post(`/api/campaigns/${campaignId}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  await campaignRunner.pump();
  const before = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  const sent = before.body.deliveries.find((delivery: any) => delivery.state === 'sent');
  assert.ok(sent?.providerMessageId);
  const base = Math.floor(Date.now() / 1000) - 20;
  const event = (kind: string, timestamp: number, custom = true) => ({
    event: kind, email: 'webhook-bounce@example.com', id: 812, ts_event: timestamp,
    'message-id': sent.providerMessageId, ...(custom ? { 'X-Mailin-custom': `campaign_delivery:${sent.id}` } : {})
  });

  await request(app).post('/api/webhooks/brevo/transactional').send(event('delivered', base)).expect(401);
  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`).send({ event: 'unknown' }).expect(400);
  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`).send(event('delivered', base)).expect(204);
  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`).send(event('delivered', base)).expect(204);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM campaign_delivery_events WHERE delivery_id=?').get(sent.id) as any).count, 1);

  const batch = { events: [event('opened', base + 1), event('click', base + 2, false), event('hard_bounce', base + 3)] };
  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`).send(batch).expect(204);
  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`).send(batch).expect(204);
  const after = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  const updated = after.body.deliveries.find((delivery: any) => delivery.id === sent.id);
  assert.equal(updated.providerStatus, 'hard_bounce');
  assert.ok(updated.deliveredAt); assert.ok(updated.openedAt); assert.ok(updated.clickedAt); assert.ok(updated.bouncedAt);
  assert.equal(after.body.contacts[0].status, 'suppressed');
  assert.equal(after.body.metrics.skippedDeliveries, 1);
  assert.equal(after.body.campaign.status, 'completed');
  assert.equal((db.prepare('SELECT COUNT(*) count FROM campaign_delivery_events WHERE delivery_id=?').get(sent.id) as any).count, 4);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM email_suppressions WHERE email=?').get('webhook-bounce@example.com') as any).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM pragma_table_info('campaign_delivery_events') WHERE name IN ('email','payload','body')").get() as any).count, 0);

  await request(app).post('/api/webhooks/brevo/transactional').set('Authorization', `Bearer ${webhookToken}`)
    .send(Array.from({ length: 501 }, (_, index) => event('delivered', base + index))).expect(400);
});

test('makes Quick Email durable, idempotent, unsubscribe-safe and suppression-aware', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Quick email safety survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'quick-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  const collector = await agent.post(`/api/surveys/${survey.body.id}/collectors`).send({ name: 'Quick email', type: 'email' }).expect(201);
  const originalMode = config.emailMode; const originalKey = config.mailApiToken; const originalFetch = globalThis.fetch;
  const providerBodies: any[] = []; const providerHeaders: Record<string, string>[] = [];
  config.emailMode = 'send'; config.mailApiToken = 'key-id.test-secret';
  globalThis.fetch = async (_url, init) => {
    providerBodies.push(JSON.parse(String(init?.body || '{}')));
    providerHeaders.push((init?.headers || {}) as Record<string, string>);
    return new Response(JSON.stringify({ status: 'accepted', messageId: 'quick-email-message' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  try {
    const first = await agent.post(`/api/collectors/${collector.body.id}/invitations`).send({ recipients: [{ email: 'quick-optout@example.com', name: 'Quick Recipient' }] }).expect(200);
    assert.equal(first.body.outcomes[0].status, 'sent');
    assert.equal(providerBodies.length, 1);
    assert.equal(providerHeaders[0]['Idempotency-Key'], first.body.outcomes[0].id);
    assert.equal(providerBodies[0].headers['X-Seemplify-Correlation'], `collector_recipient:${first.body.outcomes[0].id}`);
    assert.equal(providerBodies[0].to[0], 'quick-optout@example.com');
    assert.match(providerBodies[0].html, /\/api\/public\/collectors\/unsubscribe\//);

    const replay = await agent.post(`/api/collectors/${collector.body.id}/invitations`).send({ recipients: [{ email: 'QUICK-OPTOUT@example.com', name: 'Quick Recipient' }] }).expect(200);
    assert.equal(replay.body.outcomes[0].id, first.body.outcomes[0].id);
    assert.equal(providerBodies.length, 1);
    const recipient = db.prepare('SELECT token,status FROM recipients WHERE id=?').get(first.body.outcomes[0].id) as any;
    await request(app).get(`/api/public/collectors/unsubscribe/${recipient.token}`).expect(200).expect(/Confirm/);
    assert.equal((db.prepare('SELECT status FROM recipients WHERE id=?').get(first.body.outcomes[0].id) as any).status, 'sent');
    await request(app).post(`/api/public/collectors/unsubscribe/${recipient.token}`).expect(200).expect(/You are unsubscribed/);
    assert.equal((db.prepare('SELECT status FROM recipients WHERE id=?').get(first.body.outcomes[0].id) as any).status, 'unsubscribed');

    const blocked = await agent.post(`/api/collectors/${collector.body.id}/invitations`).send({ recipients: [{ email: 'quick-optout@example.com' }] }).expect(207);
    assert.equal(blocked.body.outcomes[0].status, 'failed');
    assert.equal(providerBodies.length, 1);
    const otherCollector = await agent.post(`/api/surveys/${survey.body.id}/collectors`).send({ name: 'Other quick email', type: 'email' }).expect(201);
    await agent.post(`/api/collectors/${otherCollector.body.id}/invitations`).send({ recipients: [{ email: 'quick-optout@example.com' }] }).expect(207);
    assert.equal(providerBodies.length, 1);
  } finally {
    config.emailMode = originalMode; config.mailApiToken = originalKey; globalThis.fetch = originalFetch;
  }
});

test('connects X with a one-time OAuth handshake, encrypts secrets, and durably synchronises posts', async () => {
  const platformAdmin = request.agent(app);
  await platformAdmin.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  await request(app).get('/api/integrations/x').expect(401);
  await request(app).get('/api/integrations/x/callback?oauth_token=junk-token&oauth_verifier=junk-verifier').expect(303)
    .expect('Location', '/social-listening?x=failed').expect('Cache-Control', 'no-store').expect('Referrer-Policy', 'no-referrer');

  const owner = request.agent(app);
  await owner.post('/api/auth/login').send({ email: 'researcher@example.com', password: 'Researcher-Reset-2026' }).expect(200);
  await owner.put('/api/integrations/x/app').send({ consumerKey: 'space-owner-cannot-change-platform-app', consumerSecret: 'space-owner-cannot-change-platform-secret' }).expect(403);
  const sentinels = {
    consumerKey: 'test-consumer-key-12345', consumerSecret: 'test-consumer-secret-67890', bearerToken: 'test-bearer-token-123456',
    accessToken: 'test-access-token-123456', accessTokenSecret: 'test-access-secret-123456'
  };
  const configured = await platformAdmin.put('/api/integrations/x/app').send({ consumerKey: sentinels.consumerKey, consumerSecret: sentinels.consumerSecret, bearerToken: sentinels.bearerToken }).expect(200);
  assert.equal(configured.body.app.configured, true); assert.equal(configured.body.app.bearerTokenConfigured, true);
  const configurationJson = JSON.stringify(configured.body);
  for (const value of Object.values(sentinels)) assert.doesNotMatch(configurationJson, new RegExp(value));
  const storedApp = db.prepare('SELECT * FROM x_apps WHERE id=?').get('workspace-x-app') as any;
  assert.notEqual(storedApp.consumer_key_enc, sentinels.consumerKey); assert.notEqual(storedApp.consumer_secret_enc, sentinels.consumerSecret);
  assert.notEqual(storedApp.bearer_token_enc, sentinels.bearerToken);

  const originalFetch = globalThis.fetch; const requests: Array<{ url: string; authorization: string; method: string }> = [];
  let requestTokenCalls = 0; let holdNextTimeline = false; let releaseTimeline: ((response: Response) => void) | null = null;
  let holdNextSearch = false; let releaseSearch: ((response: Response) => void) | null = null;
  let holdNextAccessExchange = false; let releaseAccessExchange: ((response: Response) => void) | null = null;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const authorization = String(new Headers(init?.headers).get('authorization') || ''); const method = String(init?.method || 'GET');
    requests.push({ url, authorization, method });
    const rateHeaders = { 'content-type': 'application/json', 'x-rate-limit-limit': '450', 'x-rate-limit-remaining': '449', 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900) };
    if (url.includes('/oauth/request_token')) {
      requestTokenCalls += 1; const suffix = requestTokenCalls === 1 ? '12345' : '67890';
      return new Response(`oauth_token=request-token-${suffix}&oauth_token_secret=request-secret-${suffix}&oauth_callback_confirmed=true`, { status: 200, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    }
    if (url.endsWith('/oauth/access_token') && holdNextAccessExchange) {
      holdNextAccessExchange = false;
      return await new Promise<Response>((resolve) => { releaseAccessExchange = resolve; });
    }
    if (url.endsWith('/oauth/access_token')) return new Response('oauth_token=test-access-token-123456&oauth_token_secret=test-access-secret-123456&user_id=1221648900181962758&screen_name=research_owner', { status: 200, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (url.includes('/2/users/me')) return new Response(JSON.stringify({ data: { id: '1221648900181962758', username: 'research_owner', name: 'Research Owner', profile_image_url: 'https://pbs.twimg.com/profile_images/test.png' } }), { status: 200, headers: rateHeaders });
    if (url.includes('/2/users/1221648900181962758/tweets') && holdNextTimeline) {
      holdNextTimeline = false;
      return await new Promise<Response>((resolve) => { releaseTimeline = resolve; });
    }
    if (url.includes('/2/users/1221648900181962758/tweets') && url.includes('pagination_token=posts-page-2')) return new Response(JSON.stringify({ data: [
      { id: '1004', text: 'Second paginated account post', created_at: '2026-07-28T13:00:00.000Z', lang: 'en', author_id: '1221648900181962758' }
    ], includes: { users: [{ id: '1221648900181962758', username: 'research_owner', name: 'Research Owner' }] }, meta: { newest_id: '1004' } }), { status: 200, headers: rateHeaders });
    if (url.includes('/2/users/1221648900181962758/tweets')) return new Response(JSON.stringify({ data: [
      { id: '1001', text: '<script>untrusted post text</script>', created_at: '2026-07-28T10:00:00.000Z', lang: 'en', author_id: '1221648900181962758', public_metrics: { like_count: 2 } }
    ], includes: { users: [{ id: '1221648900181962758', username: 'research_owner', name: 'Research Owner' }] }, meta: { newest_id: '1004', next_token: 'posts-page-2' } }), { status: 200, headers: rateHeaders });
    if (url.includes('/2/users/1221648900181962758/mentions')) return new Response(JSON.stringify({ data: [
      { id: '1002', text: 'A public mention for the connected account', created_at: '2026-07-28T11:00:00.000Z', lang: 'en', author_id: '200', public_metrics: { reply_count: 1 } }
    ], includes: { users: [{ id: '200', username: 'customer_voice', name: 'Customer Voice' }] }, meta: { newest_id: '1002' } }), { status: 200, headers: rateHeaders });
    if (url.includes('/2/tweets/search/recent') && holdNextSearch) {
      holdNextSearch = false;
      return await new Promise<Response>((resolve) => { releaseSearch = resolve; });
    }
    if (url.includes('/2/tweets/search/recent')) return new Response(JSON.stringify({ data: [
      { id: '1002', text: 'A public mention for the connected account', created_at: '2026-07-28T11:00:00.000Z', lang: 'en', author_id: '200' },
      { id: '1003', text: 'A matching brand search result', created_at: '2026-07-28T12:00:00.000Z', lang: 'en', author_id: '201' }
    ], includes: { users: [{ id: '200', username: 'customer_voice', name: 'Customer Voice' }, { id: '201', username: 'market_watch', name: 'Market Watch' }] }, meta: { newest_id: '1003' } }), { status: 200, headers: rateHeaders });
    return new Response('{}', { status: 404, headers: rateHeaders });
  };

  try {
    const started = await owner.post('/api/integrations/x/connect').send({}).expect(201);
    assert.equal(started.body.authorizeUrl, 'https://api.x.invalid/oauth/authenticate?oauth_token=request-token-12345');
    const setCookies = started.headers['set-cookie'] as unknown as string[]; const handshakeCookie = setCookies.find((value) => value.startsWith('seemplify_x_oauth_'))!;
    assert.match(handshakeCookie, /HttpOnly/); assert.match(handshakeCookie, /SameSite=Lax/); assert.match(handshakeCookie, /Path=\/api\/integrations\/x\/callback/);
    const cookiePair = handshakeCookie.split(';')[0];
    const callback = await request(app).get('/api/integrations/x/callback?oauth_token=request-token-12345&oauth_verifier=approved-verifier-12345').set('Cookie', cookiePair).expect(303);
    assert.equal(callback.headers.location, '/social-listening?x=connected');
    await request(app).get('/api/integrations/x/callback?oauth_token=request-token-12345&oauth_verifier=approved-verifier-12345').set('Cookie', cookiePair).expect(303).expect('Location', '/social-listening?x=failed');
    const connectionRow = db.prepare('SELECT * FROM x_connections WHERE user_id=(SELECT id FROM users WHERE email=?)').get('researcher@example.com') as any;
    assert.ok(connectionRow); assert.notEqual(connectionRow.access_token_enc, sentinels.accessToken); assert.notEqual(connectionRow.access_token_secret_enc, sentinels.accessTokenSecret);

    await owner.post('/api/integrations/x/queries').send({ label: 'Seemplify brand', query: '"Seemplify" -is:retweet', enabled: true }).expect(201);
    db.exec(`CREATE TRIGGER fail_x_analysis_handoff BEFORE INSERT ON ai_jobs
      WHEN NEW.kind='social.analyze' AND json_extract(NEW.input_json,'$.source')='x-sync'
      BEGIN SELECT RAISE(ABORT,'simulated analysis handoff crash'); END`);
    const queued = await owner.post('/api/integrations/x/sync').send({}).expect(202); assert.equal(queued.body.created, true);
    let retrying: any = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await owner.get('/api/integrations/x').expect(200); retrying = snapshot.body.syncJobs[0];
      if (retrying?.state === 'queued' && retrying?.stage === 'retrying') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(retrying?.stage, 'retrying');
    assert.equal((await owner.get('/api/integrations/x/mentions?limit=1000').expect(200)).body.length, 0);
    const rolledBack = db.prepare('SELECT last_post_id,last_mention_id FROM x_connections WHERE id=?').get(retrying.connectionId) as any;
    assert.equal(rolledBack.last_post_id, null); assert.equal(rolledBack.last_mention_id, null);
    assert.equal((db.prepare('SELECT since_id FROM x_listening_queries WHERE connection_id=?').get(retrying.connectionId) as any).since_id, null);
    db.exec('DROP TRIGGER fail_x_analysis_handoff');
    db.prepare("UPDATE x_sync_jobs SET run_after=datetime('now','-1 second') WHERE id=?").run(retrying.id);
    await xSyncRunner.pump();
    let terminal: any = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await owner.get('/api/integrations/x').expect(200); terminal = snapshot.body.syncJobs[0];
      if (terminal && ['completed', 'failed'].includes(terminal.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(terminal?.state, 'completed', terminal?.error); assert.equal(terminal.postsFetched, 2); assert.equal(terminal.mentionsFetched, 1);
    assert.equal(terminal.searchFetched, 2); assert.equal(terminal.importedCount, 4);
    const xMentions = (await owner.get('/api/social/mentions?limit=1000').expect(200)).body.filter((mention: any) => mention.externalId);
    assert.deepEqual(xMentions.map((mention: any) => mention.externalId).sort(), ['1001', '1002', '1003', '1004']);
    const ownerScopedMentions = (await owner.get('/api/integrations/x/mentions?limit=1000').expect(200)).body;
    assert.deepEqual(ownerScopedMentions.map((mention: any) => mention.externalId).sort(), ['1001', '1002', '1003', '1004']);
    assert.deepEqual((await platformAdmin.get('/api/integrations/x/mentions?limit=1000').expect(200)).body, []);
    assert.equal(xMentions.find((mention: any) => mention.externalId === '1001').content, '<script>untrusted post text</script>');
    const duplicate = ownerScopedMentions.find((mention: any) => mention.externalId === '1002'); assert.deepEqual(duplicate.metadata.x.streams.sort(), ['mention', 'search']);
    assert.ok(requests.some((item) => item.url.includes('/oauth/request_token?x_auth_access_type=write') && item.authorization.includes('oauth_callback') && !item.authorization.includes('x_auth_access_type')));
    assert.ok(requests.some((item) => item.url.includes('/2/users/1221648900181962758/tweets') && item.authorization.startsWith('OAuth ')));
    assert.ok(requests.some((item) => item.url.includes('/2/tweets/search/recent') && item.authorization === `Bearer ${sentinels.bearerToken}`));
    for (const item of requests) assert.doesNotMatch(item.url, /test-consumer-secret|test-access-secret/);

    const query = (await owner.get('/api/integrations/x').expect(200)).body.queries[0];
    db.prepare("UPDATE x_sync_jobs SET created_at=datetime('now','-2 minutes') WHERE id=?").run(terminal.id);
    holdNextSearch = true; await owner.post('/api/integrations/x/sync').send({}).expect(202);
    for (let attempt = 0; attempt < 100 && !releaseSearch; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(releaseSearch, 'search request did not start');
    await owner.patch(`/api/integrations/x/queries/${query.id}`).send({ query: '"Renamed query" -is:retweet' }).expect(200);
    releaseSearch!(new Response(JSON.stringify({ data: [{ id: '3001', text: 'result from stale query', author_id: '300' }], meta: { newest_id: '3001' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await owner.get('/api/integrations/x').expect(200);
      if (snapshot.body.syncJobs[0]?.state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((db.prepare("SELECT COUNT(*) count FROM social_mentions WHERE source='x' AND external_id='3001'").get() as any).count, 0);
    const changedQuery = db.prepare('SELECT since_id,last_error FROM x_listening_queries WHERE id=?').get(query.id) as any;
    assert.equal(changedQuery.since_id, null); assert.match(changedQuery.last_error, /changed while this search/i);

    const pendingReconnect = await owner.post('/api/integrations/x/connect').send({}).expect(201);
    assert.equal(pendingReconnect.body.authorizeUrl, 'https://api.x.invalid/oauth/authenticate?oauth_token=request-token-67890');
    const pendingCookie = (pendingReconnect.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('seemplify_x_oauth_'))!.split(';')[0];
    holdNextAccessExchange = true;
    const staleCallback = request(app).get('/api/integrations/x/callback?oauth_token=request-token-67890&oauth_verifier=approved-verifier-67890')
      .set('Cookie', pendingCookie).then((response) => response);
    for (let attempt = 0; attempt < 100 && !releaseAccessExchange; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(releaseAccessExchange, 'OAuth access-token exchange did not start');
    await owner.delete('/api/integrations/x/connection').expect(204);
    releaseAccessExchange!(new Response('oauth_token=test-access-token-123456&oauth_token_secret=test-access-secret-123456&user_id=1221648900181962758&screen_name=research_owner', { status: 200, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    const staleResult = await staleCallback; assert.equal(staleResult.status, 303); assert.equal(staleResult.headers.location, '/social-listening?x=failed');
    const disconnected = await owner.get('/api/integrations/x').expect(200); assert.equal(disconnected.body.connection.status, 'disconnected');
    assert.equal((await owner.get('/api/integrations/x/mentions?limit=1000').expect(200)).body.length, 4);
    await owner.post('/api/integrations/x/sync').send({}).expect(409);
    const deleted = await owner.delete('/api/integrations/x/history').expect(200); assert.equal(deleted.body.unlinked, 4);
    assert.deepEqual((await owner.get('/api/integrations/x/mentions?limit=1000').expect(200)).body, []);

    await owner.put('/api/integrations/x/app').send({ accessToken: sentinels.accessToken, accessTokenSecret: sentinels.accessTokenSecret }).expect(200);
    holdNextTimeline = true;
    await owner.post('/api/integrations/x/sync').send({}).expect(202);
    for (let attempt = 0; attempt < 100 && !releaseTimeline; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(releaseTimeline, 'timeline request did not start');
    await owner.delete('/api/integrations/x/connection').expect(204);
    releaseTimeline!(new Response(JSON.stringify({ data: [{ id: '2001', text: 'must be discarded after disconnect', author_id: '1221648900181962758' }], meta: { newest_id: '2001' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    let cancelled: any = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await owner.get('/api/integrations/x').expect(200); cancelled = snapshot.body.syncJobs[0];
      if (cancelled?.state === 'cancelled') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(cancelled?.state, 'cancelled');
    assert.deepEqual((await owner.get('/api/integrations/x/mentions?limit=1000').expect(200)).body, []);
  } finally { globalThis.fetch = originalFetch; }
});
