import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-experience-api-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!'); fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', LOCAL_LLM_SHARED_SECRET_FILE: sessionFile });
const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('protects admin APIs while allowing a complete public survey workflow', async () => {
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
});
