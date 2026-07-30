import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-tutorial-progress-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Tutorial-Progress-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'tutorial-progress-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 72).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'tutorials.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5511',
  ADMIN_EMAIL: 'tutorial-admin@example.test',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('stores strict versioned tutorial progress per authenticated user without stale-version rollback', async () => {
  await request(app).get('/api/tutorials/progress').expect(401);
  await request(app).put('/api/tutorials/progress/overview')
    .send({ version: 1, status: 'in_progress', lastStep: 0 }).expect(401);

  const alice = request.agent(app);
  const bob = request.agent(app);
  await signupVerifyAndOnboard(alice, {
    name: 'Alice Tutorial', email: 'alice-tutorial@example.test', password: 'Alice-Tutorial-2026!'
  });
  await signupVerifyAndOnboard(bob, {
    name: 'Bob Tutorial', email: 'bob-tutorial@example.test', password: 'Bob-Tutorial-2026!'
  });

  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version=11 AND name='account_tutorial_progress'").get());
  assert.deepEqual((await alice.get('/api/tutorials/progress').expect(200)).body, { progress: [] });

  const opened = await alice.put('/api/tutorials/progress/overview')
    .send({ version: 1, status: 'in_progress', lastStep: 0 }).expect(200);
  assert.deepEqual(Object.keys(opened.body.progress).sort(), [
    'completedAt', 'dismissedAt', 'firstOpenedAt', 'lastStep', 'status', 'tutorialKey', 'updatedAt', 'version'
  ].sort());
  assert.equal(opened.body.progress.tutorialKey, 'overview');
  assert.equal(opened.body.progress.version, 1);
  assert.equal(opened.body.progress.status, 'in_progress');
  assert.equal(opened.body.progress.lastStep, 0);
  assert.ok(Date.parse(opened.body.progress.firstOpenedAt));
  assert.equal(opened.body.progress.completedAt, null);
  assert.equal(opened.body.progress.dismissedAt, null);

  const completed = await alice.put('/api/tutorials/progress/overview')
    .send({ version: 1, status: 'completed', lastStep: 4 }).expect(200);
  assert.equal(completed.body.progress.firstOpenedAt, opened.body.progress.firstOpenedAt);
  assert.equal(completed.body.progress.status, 'completed');
  assert.equal(completed.body.progress.lastStep, 4);
  assert.ok(Date.parse(completed.body.progress.completedAt));
  assert.equal(completed.body.progress.dismissedAt, null);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const repeatedCompletion = await alice.put('/api/tutorials/progress/overview')
    .send({ version: 1, status: 'completed', lastStep: 4 }).expect(200);
  assert.equal(repeatedCompletion.body.progress.completedAt, completed.body.progress.completedAt);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const newVersion = await alice.put('/api/tutorials/progress/overview')
    .send({ version: 2, status: 'in_progress', lastStep: null }).expect(200);
  assert.equal(newVersion.body.progress.version, 2);
  assert.notEqual(newVersion.body.progress.firstOpenedAt, opened.body.progress.firstOpenedAt);
  assert.equal(newVersion.body.progress.completedAt, null);
  assert.equal(newVersion.body.progress.dismissedAt, null);

  const staleWrite = await alice.put('/api/tutorials/progress/overview')
    .send({ version: 1, status: 'dismissed', lastStep: 1 }).expect(200);
  assert.equal(staleWrite.body.progress.version, 2);
  assert.equal(staleWrite.body.progress.status, 'in_progress');
  assert.equal(staleWrite.body.progress.lastStep, null);

  const bobDismissed = await bob.put('/api/tutorials/progress/surveys')
    .send({ version: 3, status: 'dismissed', lastStep: 2 }).expect(200);
  assert.ok(Date.parse(bobDismissed.body.progress.dismissedAt));
  assert.equal(bobDismissed.body.progress.completedAt, null);

  const aliceProgress = await alice.get('/api/tutorials/progress').expect(200);
  assert.equal(aliceProgress.body.progress.length, 1);
  assert.equal(aliceProgress.body.progress[0].tutorialKey, 'overview');
  const bobProgress = await bob.get('/api/tutorials/progress').expect(200);
  assert.equal(bobProgress.body.progress.length, 1);
  assert.equal(bobProgress.body.progress[0].tutorialKey, 'surveys');

  const invalidBodies = [
    { version: 0, status: 'in_progress', lastStep: 0 },
    { version: 10_001, status: 'in_progress', lastStep: 0 },
    { version: 1, status: 'not_started', lastStep: 0 },
    { version: 1, status: 'in_progress', lastStep: -1 },
    { version: 1, status: 'in_progress', lastStep: 10_001 },
    { version: 1, status: 'in_progress', lastStep: 1.5 },
    { version: 1, status: 'in_progress' },
    { version: 1, status: 'in_progress', lastStep: 0, userId: 'another-user' }
  ];
  for (const body of invalidBodies) {
    await alice.put('/api/tutorials/progress/campaigns').send(body).expect(400)
      .expect(({ body: responseBody }) => assert.equal(responseBody.code, 'TUTORIAL_PROGRESS_INVALID'));
  }
  await alice.put('/api/tutorials/progress/unknown-tutorial')
    .send({ version: 1, status: 'in_progress', lastStep: 0 }).expect(400)
    .expect(({ body }) => assert.equal(body.code, 'TUTORIAL_KEY_INVALID'));
  assert.equal((db.prepare('SELECT COUNT(*) count FROM tutorial_progress').get() as any).count, 2);
});
