import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-experience-api-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret'); const webhookSecretFile = path.join(root, 'brevo-webhook-secret');
const frontendDist = path.join(root, '.release', 'frontend', 'dist');
fs.mkdirSync(frontendDist, { recursive: true }); fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>Experience test shell</title>');
fs.mkdirSync(path.join(frontendDist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'assets', 'current-build-a1b2c3.js'), 'globalThis.__experienceAssetLoaded = true;');
fs.writeFileSync(path.join(frontendDist, 'assets', 'current-build-d4e5f6.css'), ':root { color: rgb(1 2 3); }');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!'); fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough'); fs.writeFileSync(webhookSecretFile, 'test-brevo-webhook-secret-that-is-long-enough');
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: frontendDist, PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', LOCAL_LLM_SHARED_SECRET_FILE: sessionFile, BREVO_WEBHOOK_SECRET_FILE: webhookSecretFile, BREVO_IDEMPOTENCY_TTL_MINUTES: '120' });
const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { issuePasswordResetToken } = await import('../src/auth.js');
const { campaignRunner, recoverCampaignDeliveries } = await import('../src/campaigns.js');
const { sanitizeCampaignHtml } = await import('../src/emailService.js');
const { config } = await import('../src/config.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

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
  await created.post('/api/auth/signup').send({ name: 'Research Owner', email, password: originalPassword }).expect(201)
    .expect(({ body }) => {
      assert.equal(body.authenticated, true);
      assert.equal(body.user.email, email);
      assert.equal(body.user.role, 'owner');
    });
  await created.get('/api/bootstrap').expect(200);
  await request(app).post('/api/auth/signup').send({ name: 'Duplicate User', email, password: originalPassword }).expect(409);
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
    stages: [{ name: 'Discover', goal: 'Understand value', touchpoints: ['Website'], customerActions: ['Compare options'], emotions: ['Curious'], painPoints: ['Unclear pricing'], metrics: ['Visit-to-demo conversion'], opportunities: ['Clarify plans'], recommendedActions: ['Publish a plan comparison'] }]
  }).expect(201);
  const journeys = await agent.get('/api/journeys').expect(200);
  assert.equal(journeys.body[0].id, created.body.id);
  assert.equal(journeys.body[0].stages[0].metrics[0], 'Visit-to-demo conversion');

  const optimized = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'Ownership and metrics' }).expect(202);
  const optimizationJob = await agent.get(`/api/ai/jobs/${optimized.body.jobId}`).expect(200);
  assert.equal(optimizationJob.body.kind, 'journey.optimize');
  assert.equal(optimizationJob.body.input.journeyId, created.body.id);
  const generated = await agent.post('/api/ai/journeys').send({ brief: 'Map the complete onboarding lifecycle for a new software customer.', audience: 'New customers' }).expect(202);
  const generationJob = await agent.get(`/api/ai/jobs/${generated.body.jobId}`).expect(200);
  assert.equal(generationJob.body.kind, 'journey.generate');

  await agent.delete(`/api/journeys/${created.body.id}`).expect(204);
  await agent.delete(`/api/social/mentions/${imported.body.mentions[0].id}`).expect(204);
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
    { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', company: 'Analytical Engines', customData: { segment: 'customer' } },
    { email: 'ADA@example.com', firstName: 'Duplicate' }
  ] }).expect(201);
  assert.equal(contacts.body.summary.received, 2);
  assert.equal(contacts.body.summary.added, 1);
  assert.equal(contacts.body.summary.duplicates, 1);
  assert.equal(contacts.body.summary.imported, 1);
  assert.equal(contacts.body.summary.skipped, 1);
  const testSend = await agent.post(`/api/campaigns/${campaignId}/test`).send({ email: 'preview@example.com' }).expect(200);
  assert.equal(testSend.body.outcomes[0].status, 'sent');
  assert.doesNotMatch(sanitizeCampaignHtml('<script>alert(1)</script><p>Safe</p><a href="javascript:bad">No</a>'), /script|javascript/i);

  await agent.post(`/api/campaigns/${campaignId}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
  await campaignRunner.pump();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const running = await agent.get(`/api/campaigns/${campaignId}`).expect(200);
  assert.equal(running.body.metrics.sentDeliveries, 1);
  assert.equal(running.body.metrics.queuedDeliveries, 1);
  assert.equal(running.body.contacts[0].status, 'active');
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
  await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(200);
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
  await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(200);
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

  const originalMode = config.emailMode; const originalKey = config.brevoApiKey; const originalFetch = globalThis.fetch;
  let releaseSend!: (value: Response) => void; let providerRequest: any;
  const pendingSend = new Promise<Response>((resolve) => { releaseSend = resolve; });
  config.emailMode = 'send'; config.brevoApiKey = 'test-key';
  globalThis.fetch = async (url, init) => String(url) === config.brevoApiUrl
    ? (providerRequest = JSON.parse(String(init?.body || '{}')), pendingSend)
    : new Response(JSON.stringify({ error: 'runtime unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
  try {
    await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(200);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (db.prepare('SELECT state FROM campaign_deliveries WHERE campaign_id=?').get(id) as any)?.state;
      if (state === 'sending') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const during = await agent.get(`/api/campaigns/${id}`).expect(200);
    assert.equal(during.body.deliveries[0].state, 'sending');
    assert.equal(providerRequest.headers.idempotencyKey, during.body.deliveries[0].id);
    assert.match(providerRequest.htmlContent, /\/api\/public\/campaigns\/unsubscribe\//);
    await request(app).post(`/api/public/collectors/${during.body.collector.slug}/responses`).query({ recipient: during.body.contacts[0].token }).send({ answers: { 'race-answer': 'Responded while sending' }, status: 'completed' }).expect(201);
    releaseSend(new Response(JSON.stringify({ messageId: 'race-message' }), { status: 201, headers: { 'content-type': 'application/json' } }));
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
    config.emailMode = originalMode; config.brevoApiKey = originalKey; globalThis.fetch = originalFetch;
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

  const step = (embedQuestionId: string) => ({ delayMinutes: 30, subject: 'Survey', mode: 'plain', bodyText: '{{survey_link}}', embedQuestionId });
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-later')] }).expect(400)
    .expect(({ body }) => assert.match(body.error, /first survey page/i));
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-dropdown')] }).expect(400)
    .expect(({ body }) => assert.match(body.error, /supported choice or rating/i));
  await agent.put(`/api/campaigns/${id}/steps`).send({ steps: [step('embed-first')] }).expect(200);
  await agent.post(`/api/campaigns/${id}/contacts`).send({ contacts: [{ email: 'invariant@example.com' }] }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);
  await agent.post(`/api/campaigns/${id}/launch`).send({ startAt: new Date(Date.now() + 60_000).toISOString() }).expect(200);
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
  await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(200);
  const staleAt = new Date(Date.now() - (config.brevoIdempotencyTtlMinutes + 5) * 60_000).toISOString();
  db.prepare("UPDATE campaign_deliveries SET state='sending',attempt=1,first_attempt_at=?,updated_at=? WHERE campaign_id=?").run(staleAt, staleAt, id);
  assert.equal(recoverCampaignDeliveries(), 1);
  const delivery = db.prepare('SELECT state,error FROM campaign_deliveries WHERE campaign_id=?').get(id) as any;
  const contact = db.prepare('SELECT status FROM campaign_contacts WHERE campaign_id=?').get(id) as any;
  assert.equal(delivery.state, 'failed');
  assert.match(delivery.error, /not retried to avoid a duplicate send/i);
  assert.equal(contact.status, 'failed');
});

test('uses UUID idempotency keys and reports all-failed and mixed test-send outcomes', async () => {
  assert.equal(config.brevoIdempotencyTtlMinutes, 29);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'qa@seemplify.local', password: 'Test-Admin-Password-2026!' }).expect(200);
  const survey = await agent.post('/api/surveys').send({
    title: 'Provider outcome survey', purpose: 'market_research', status: 'draft', primaryMetric: 'custom',
    questions: [{ id: 'provider-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  const campaign = await agent.post('/api/campaigns').send({ name: 'Provider outcome campaign', surveyId: survey.body.id }).expect(201);
  const id = campaign.body.campaign.id;
  const originalMode = config.emailMode; const originalKey = config.brevoApiKey; const originalFetch = globalThis.fetch;
  config.emailMode = 'send'; config.brevoApiKey = 'test-key';
  try {
    const requests: any[] = [];
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({ message: 'Provider unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    };
    const failed = await agent.post(`/api/campaigns/${id}/test`).send({ email: 'failed-preview@example.com' }).expect(502);
    assert.equal(failed.body.outcomes[0].status, 'failed');
    assert.match(requests[0].headers.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    let call = 0; requests.length = 0;
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body || '{}'))); call += 1;
      return call === 1
        ? new Response(JSON.stringify({ messageId: 'accepted-message' }), { status: 201, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ message: 'Rejected message' }), { status: 500, headers: { 'content-type': 'application/json' } });
    };
    const mixed = await agent.post(`/api/campaigns/${id}/test`).send({ emails: ['accepted@example.com', 'rejected@example.com'] }).expect(207);
    assert.deepEqual(mixed.body.outcomes.map((outcome: any) => outcome.status), ['sent', 'failed']);
    assert.equal(new Set(requests.map((item) => item.headers.idempotencyKey)).size, 2);

    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ code: 'duplicate_parameter', message: `Duplicate idempotency key ${body.headers.idempotencyKey}` }), { status: 400, headers: { 'content-type': 'application/json' } });
    };
    const duplicate = await agent.post(`/api/campaigns/${id}/test`).send({ email: 'idempotent@example.com' }).expect(200);
    assert.equal(duplicate.body.outcomes[0].status, 'sent');
    assert.match(duplicate.body.outcomes[0].messageId, /^idempotent:/);
  } finally {
    config.emailMode = originalMode; config.brevoApiKey = originalKey; globalThis.fetch = originalFetch;
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
  await agent.post(`/api/campaigns/${id}/launch`).send({}).expect(200);
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
  await agent.post(`/api/campaigns/${campaignId}/launch`).send({}).expect(200);
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
  const originalMode = config.emailMode; const originalKey = config.brevoApiKey; const originalFetch = globalThis.fetch;
  const providerBodies: any[] = []; config.emailMode = 'send'; config.brevoApiKey = 'test-key';
  globalThis.fetch = async (_url, init) => {
    providerBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ messageId: 'quick-email-message' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    const first = await agent.post(`/api/collectors/${collector.body.id}/invitations`).send({ recipients: [{ email: 'quick-optout@example.com', name: 'Quick Recipient' }] }).expect(200);
    assert.equal(first.body.outcomes[0].status, 'sent');
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].headers.idempotencyKey, first.body.outcomes[0].id);
    assert.equal(providerBodies[0].headers['X-Mailin-custom'], `collector_recipient:${first.body.outcomes[0].id}`);
    assert.match(providerBodies[0].htmlContent, /\/api\/public\/collectors\/unsubscribe\//);

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
    config.emailMode = originalMode; config.brevoApiKey = originalKey; globalThis.fetch = originalFetch;
  }
});
