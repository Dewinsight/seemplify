import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-experience-api-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret');
const frontendDist = path.join(root, '.release', 'frontend', 'dist');
fs.mkdirSync(frontendDist, { recursive: true }); fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>Experience test shell</title>');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!'); fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: frontendDist, PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', LOCAL_LLM_SHARED_SECRET_FILE: sessionFile });
const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

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
