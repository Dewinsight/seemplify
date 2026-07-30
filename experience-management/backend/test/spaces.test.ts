import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-spaces-'));
const files = {
  password: path.join(root, 'admin-password'),
  session: path.join(root, 'session-secret'),
  terra: path.join(root, 'terra-secret'),
  xKey: path.join(root, 'x-key'),
  esignKey: path.join(root, 'esign-key')
};
fs.writeFileSync(files.password, 'Spaces-Admin-Password-2026!');
fs.writeFileSync(files.session, 'spaces-test-session-secret-that-is-long-enough');
fs.writeFileSync(files.terra, 'spaces-test-terra-secret-that-is-long-enough');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 41).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 42).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'spaces.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5497',
  ADMIN_EMAIL: 'owner-a@example.test',
  ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session,
  TERRA_GATEWAY_SHARED_SECRET_FILE: files.terra,
  LOCAL_LLM_SHARED_SECRET_FILE: files.terra,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files.esignKey,
  EMAIL_MODE: 'log',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const passwordA = 'Owner-A-Private-Password-2026!';
const passwordB = 'Owner-B-Private-Password-2026!';

test('isolates independent accounts, shares only invited spaces, and attributes public work to the owning space', async () => {
  const accountA = request.agent(app);
  const signupA = await accountA.post('/api/auth/signup').send({
    name: 'Owner Alpha',
    email: 'owner-a@example.test',
    password: passwordA,
    spaceName: 'Alpha research'
  }).expect(201);
  const spaceA = signupA.body.activeSpace;
  assert.equal(spaceA.name, 'Alpha research');
  assert.equal(spaceA.role, 'owner');

  const accountB = request.agent(app);
  const signupB = await accountB.post('/api/auth/signup').send({
    name: 'Owner Beta',
    email: 'owner-b@example.test',
    password: passwordB
  }).expect(201);
  const spaceB = signupB.body.activeSpace;
  assert.notEqual(spaceB.id, spaceA.id);
  assert.equal(spaceB.role, 'owner');

  const createdA = await accountA.post('/api/surveys').send({
    title: 'Alpha customer experience',
    questions: [
      { type: 'short_text', title: 'What should improve?', required: true },
      { type: 'file', title: 'Supporting evidence', required: false }
    ]
  }).expect(201);
  const surveyA = createdA.body;
  const generatedA = await accountA.post('/api/ai/surveys').send({
    brief: 'Create a short onboarding experience survey for Alpha customers.'
  }).expect(202);

  const bootstrapB = await accountB.get('/api/bootstrap').expect(200);
  assert.deepEqual(bootstrapB.body.surveys, []);
  assert.equal(bootstrapB.body.overview.responses, 0);
  assert.deepEqual(await accountB.get('/api/ai/jobs').expect(200).then((result) => result.body), []);
  await accountB.get(`/api/surveys/${surveyA.id}`).expect(404);
  await accountB.delete(`/api/surveys/${surveyA.id}`).expect(404);
  await accountB.get(`/api/ai/jobs/${generatedA.body.jobId}`).expect(404);

  const createdB = await accountB.post('/api/surveys').send({ title: 'Beta private survey', questions: [] }).expect(201);
  const surveyB = createdB.body;
  assert.deepEqual((await accountA.get('/api/surveys').expect(200)).body.map((survey: any) => survey.id), [surveyA.id]);
  assert.deepEqual((await accountB.get('/api/surveys').expect(200)).body.map((survey: any) => survey.id), [surveyB.id]);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO email_suppressions (space_id,email,reason,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(spaceA.id, 'shared-recipient@example.test', 'Alpha opt-out', 'test', now, now);
  await accountB.post(`/api/surveys/${surveyB.id}/publish`).send({ status: 'live' }).expect(200);
  const collectorB = await accountB.post(`/api/surveys/${surveyB.id}/collectors`).send({ name: 'Beta email', type: 'email' }).expect(201);
  const betaInvitation = await accountB.post(`/api/collectors/${collectorB.body.id}/invitations`).send({
    recipients: [{ email: 'shared-recipient@example.test', name: 'Shared Recipient' }]
  }).expect(200);
  assert.equal(betaInvitation.body.outcomes[0].status, 'sent');

  const invitation = await accountA.post(`/api/spaces/${spaceA.id}/invitations`).send({
    email: 'owner-b@example.test',
    role: 'member'
  }).expect(201);
  assert.equal(invitation.body.delivery.state, 'sent');
  const token = new URL(invitation.body.inviteUrl).pathname.split('/').at(-1);
  assert.ok(token);
  const preview = await request(app).get(`/api/public/spaces/invitations/${token}`).expect(200);
  assert.equal(preview.body.space.id, spaceA.id);
  assert.equal(preview.body.email, 'owner-b@example.test');

  const accepted = await accountB.post(`/api/spaces/invitations/${token}/accept`).send({}).expect(200);
  assert.equal(accepted.body.activeSpace.id, spaceA.id);
  assert.equal(accepted.body.spaces.length, 2);
  assert.deepEqual((await accountB.get('/api/surveys').expect(200)).body.map((survey: any) => survey.id), [surveyA.id]);
  await accountB.get(`/api/ai/jobs/${generatedA.body.jobId}`).expect(200);
  await accountB.post(`/api/spaces/invitations/${token}/accept`).send({}).expect(404);

  await accountB.post(`/api/spaces/${spaceB.id}/select`).send({}).expect(200);
  assert.deepEqual((await accountB.get('/api/surveys').expect(200)).body.map((survey: any) => survey.id), [surveyB.id]);
  await accountB.get(`/api/ai/jobs/${generatedA.body.jobId}`).expect(404);

  await accountA.post(`/api/surveys/${surveyA.id}/publish`).send({ status: 'live' }).expect(200);
  const collector = await accountA.post(`/api/surveys/${surveyA.id}/collectors`).send({
    name: 'Alpha public link',
    type: 'web'
  }).expect(201);
  const publicCollector = await request(app).get(`/api/public/collectors/${collector.body.slug}`).expect(200);
  const fileQuestionId = surveyA.questions[1].id;
  await request(app).post(`/api/public/collectors/${collector.body.slug}/uploads`)
    .set('x-upload-grant', publicCollector.body.uploadGrant)
    .set('x-upload-question', surveyA.questions[0].id)
    .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'not-eligible.png')
    .expect(400);
  const upload = await request(app).post(`/api/public/collectors/${collector.body.slug}/uploads`)
    .set('x-upload-grant', publicCollector.body.uploadGrant)
    .set('x-upload-question', fileQuestionId)
    .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'evidence.png')
    .expect(201);
  const publicUploadPath = new URL(upload.body.url).pathname;
  await request(app).get(publicUploadPath).expect(200);
  await request(app).get(`/api/uploads/${upload.body.id}/content`).expect(401);
  await accountA.get(`/api/uploads/${upload.body.id}/content`).expect(200);
  await accountB.get(`/api/uploads/${upload.body.id}/content`).expect(404);
  const storedFilename = (db.prepare('SELECT stored_filename FROM uploads WHERE id=?').get(upload.body.id) as any).stored_filename;
  await request(app).get(`/uploads/${encodeURIComponent(storedFilename)}`).expect(404);

  const questionId = surveyA.questions[0].id;
  const submitted = await request(app).post(`/api/public/collectors/${collector.body.slug}/responses`).send({
    answers: { [questionId]: 'Make the first screen clearer.', [fileQuestionId]: upload.body },
    status: 'completed'
  }).expect(201);
  const responseId = submitted.body.responseId;
  const claimedUpload = db.prepare('SELECT response_id,expires_at FROM uploads WHERE id=?').get(upload.body.id) as any;
  assert.equal(claimedUpload.response_id, responseId);
  assert.equal(claimedUpload.expires_at, null);
  await request(app).post(`/api/public/collectors/${collector.body.slug}/responses`).send({
    answers: { [questionId]: 'Attempt to reuse an existing upload.', [fileQuestionId]: upload.body },
    status: 'completed'
  }).expect(400);

  const jobsA = await accountA.get('/api/ai/jobs').expect(200);
  const responseJob = jobsA.body.find((job: any) => job.responseId === responseId);
  assert.ok(responseJob);
  assert.equal(responseJob.spaceId, spaceA.id);
  await accountB.get(`/api/ai/jobs/${responseJob.id}`).expect(404);
  await accountB.get(`/api/responses/${responseId}`).expect(404);
  assert.equal((await accountB.get('/api/bootstrap').expect(200)).body.overview.responses, 0);

  const members = await accountA.get(`/api/spaces/${spaceA.id}/members`).expect(200);
  const memberB = members.body.find((member: any) => member.email === 'owner-b@example.test');
  assert.equal(memberB.role, 'member');
  await accountA.patch(`/api/spaces/${spaceA.id}/members/${memberB.id}`).send({ role: 'admin' }).expect(200);
  await accountA.delete(`/api/spaces/${spaceA.id}/members/${memberB.id}`).expect(204);

  await accountB.get('/api/surveys').set('x-seemplify-space', spaceA.id).expect(403);
  await accountB.get(`/api/surveys/${surveyA.id}`).expect(404);
  const sessionB = await accountB.get('/api/auth/session').expect(200);
  assert.equal(sessionB.body.activeSpace.id, spaceB.id);
});

test('rejects an invitation during signup atomically when its email does not match', async () => {
  const accountA = request.agent(app);
  await accountA.post('/api/auth/login').send({ email: 'owner-a@example.test', password: passwordA }).expect(200);
  const sessionA = await accountA.get('/api/auth/session').expect(200);
  const invited = await accountA.post(`/api/spaces/${sessionA.body.activeSpace.id}/invitations`).send({
    email: 'expected@example.test',
    role: 'member'
  }).expect(201);
  const token = new URL(invited.body.inviteUrl).pathname.split('/').at(-1);

  await request(app).post('/api/auth/signup').send({
    name: 'Wrong Recipient',
    email: 'wrong-recipient@example.test',
    password: 'Wrong-Recipient-Password-2026!',
    inviteToken: token
  }).expect(403);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM users WHERE email=?').get('wrong-recipient@example.test') as any).count, 0);

  const acceptedSignup = await request(app).post('/api/auth/signup').send({
    name: 'Expected Recipient',
    email: 'expected@example.test',
    password: 'Expected-Recipient-Password-2026!',
    inviteToken: token,
    spaceName: 'Expected private'
  }).expect(201);
  assert.equal(acceptedSignup.body.activeSpace.id, sessionA.body.activeSpace.id);
  assert.equal(acceptedSignup.body.spaces.length, 2);
  assert.ok(acceptedSignup.body.spaces.some((space: any) => space.name === 'Expected private' && space.isPersonal));
});
