import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-auth-lifecycle-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Auth-Lifecycle-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'auth-lifecycle-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 51).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 52).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'auth.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5498',
  ADMIN_EMAIL: 'auth-admin@example.test',
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
const { issueEmailVerificationToken, issuePasswordResetToken } = await import('../src/auth.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('signup throttling keeps unrelated accounts behind one shared address independent', async () => {
  const sharedAddress = '198.51.100.220';
  for (let index = 0; index < 7; index += 1) {
    await request(app).post('/api/auth/signup').set('x-forwarded-for', sharedAddress).send({
      name: `Shared Network User ${index}`,
      email: `shared-network-${index}@example.test`,
      password: `Shared-Network-${index}-2026!`
    }).expect(202);
  }
});

test('requires mailbox verification and onboarding while keeping tokens one-time and profiles private', async () => {
  const alice = request.agent(app);
  const email = 'alice@example.test';
  const password = 'Alice-Experience-2026!';
  const signup = await alice.post('/api/auth/signup').send({
    name: 'Alice Researcher', email, password, spaceName: 'Alice research'
  }).expect(202);
  assert.equal(signup.body.authenticated, false);
  assert.equal(signup.body.code, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(([] as string[]).concat(signup.headers['set-cookie'] || []).some((value) => value.startsWith('seemplify_experience_session=')), false);
  const aliceRow = db.prepare('SELECT id,email_verified_at FROM users WHERE email=?').get(email) as any;
  assert.equal(aliceRow.email_verified_at, null);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM space_memberships WHERE user_id=?').get(aliceRow.id) as any).count, 1);
  await alice.get('/api/bootstrap').expect(401);
  await request(app).post('/api/auth/login').send({ email, password }).expect(403).expect(({ body }) => {
    assert.equal(body.code, 'EMAIL_VERIFICATION_REQUIRED');
  });

  const expired = issueEmailVerificationToken(email); assert.ok(expired);
  const stored = db.prepare('SELECT token_hash FROM email_verification_tokens WHERE id=?').get(expired.id) as any;
  assert.notEqual(stored.token_hash, expired.token);
  assert.equal(stored.token_hash, crypto.createHash('sha256').update(expired.token).digest('hex'));
  db.prepare('UPDATE email_verification_tokens SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.id);
  await alice.post('/api/auth/verify-email').send({ token: expired.token }).expect(400).expect(({ body }) => {
    assert.equal(body.code, 'EMAIL_VERIFICATION_EXPIRED');
  });

  const verification = issueEmailVerificationToken(email); assert.ok(verification);
  const verified = await alice.post('/api/auth/verify-email').send({ token: verification.token }).expect(200);
  assert.equal(verified.body.emailVerified, true);
  assert.equal(verified.body.onboardingRequired, true);
  assert.deepEqual(verified.body.profile, {
    name: 'Alice Researcher', email, jobTitle: '', organizationName: '', timezone: '', primaryGoal: null, onboardingVersion: 0, completedAt: null
  });
  await alice.post('/api/auth/verify-email').send({ token: verification.token }).expect(400).expect(({ body }) => {
    assert.equal(body.code, 'EMAIL_VERIFICATION_INVALID');
  });
  await alice.get('/api/bootstrap').expect(428).expect(({ body }) => assert.equal(body.code, 'ONBOARDING_REQUIRED'));
  await alice.post('/api/account/onboarding').send({
    name: 'Alice Researcher', jobTitle: 'Insights lead', organizationName: 'Alice Labs', timezone: 'Not/A_Timezone', primaryGoal: 'customer_experience'
  }).expect(400);
  const onboarded = await alice.post('/api/account/onboarding').send({
    name: 'Alice Researcher', jobTitle: 'Insights lead', organizationName: 'Alice Labs', timezone: 'Europe/London',
    primaryGoal: 'customer_experience', spaceName: 'Alice Experience Lab'
  }).expect(200);
  assert.equal(onboarded.body.onboardingRequired, false);
  assert.equal(onboarded.body.profile.onboardingVersion, 1);
  assert.ok(onboarded.body.profile.completedAt);
  assert.ok(onboarded.body.spaces.some((space: any) => space.isPersonal && space.name === 'Alice Experience Lab'));
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM platform_audit_events
    WHERE actor_user_id=? AND action='onboarding_completed'`).get(aliceRow.id) as any).count, 1);
  await alice.get('/api/bootstrap').expect(200);
  await alice.put('/api/account/profile').send({ organizationName: 'Alice Insights' }).expect(200);
  await alice.put('/api/account/profile').send({ onboardingVersion: 99, completedAt: new Date().toISOString() }).expect(400)
    .expect(({ body }) => assert.equal(body.code, 'PROFILE_INVALID'));

  const bob = request.agent(app);
  await signupVerifyAndOnboard(bob, { name: 'Bob Analyst', email: 'bob@example.test', password: 'Bob-Experience-2026!' });
  await bob.put('/api/account/profile').send({ organizationName: 'Bob Research' }).expect(200);
  const aliceProfile = await alice.get('/api/account/profile').expect(200);
  const bobProfile = await bob.get('/api/account/profile').expect(200);
  assert.equal(aliceProfile.body.profile.organizationName, 'Alice Insights');
  assert.equal(bobProfile.body.profile.organizationName, 'Bob Research');

  const carol = request.agent(app);
  await carol.post('/api/auth/signup').send({
    name: 'Carol Owner', email: 'carol@example.test', password: 'Carol-Experience-2026!'
  }).expect(202);
  const verificationCount = (db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens t
    JOIN users u ON u.id=t.user_id WHERE u.email='carol@example.test'`).get() as any).count;
  await request(app).post('/api/auth/resend-verification').send({ email: 'carol@example.test' }).expect(202)
    .expect(({ body }) => assert.match(body.message, /If an unverified account exists/));
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens t
    JOIN users u ON u.id=t.user_id WHERE u.email='carol@example.test'`).get() as any).count, verificationCount);
  const staleVerification = issueEmailVerificationToken('carol@example.test'); assert.ok(staleVerification);
  const reset = issuePasswordResetToken('carol@example.test'); assert.ok(reset);
  const resetResponse = await carol.post('/api/auth/reset-password').send({ token: reset.token, password: 'Carol-Recovered-2026!' }).expect(200);
  assert.equal(resetResponse.body.emailVerified, true);
  assert.equal(resetResponse.body.onboardingRequired, true);
  await carol.post('/api/auth/verify-email').send({ token: staleVerification.token }).expect(400).expect(({ body }) => {
    assert.equal(body.code, 'EMAIL_VERIFICATION_INVALID');
  });

  const replayEmail = 'replay@example.test';
  await request(app).post('/api/auth/signup').send({
    name: 'Replay Researcher', email: replayEmail, password: 'Replay-Experience-2026!'
  }).expect(202);
  const replayVerification = issueEmailVerificationToken(replayEmail); assert.ok(replayVerification);
  const replayResponses = await Promise.all([
    request(app).post('/api/auth/verify-email').send({ token: replayVerification.token }),
    request(app).post('/api/auth/verify-email').send({ token: replayVerification.token })
  ]);
  assert.deepEqual(replayResponses.map((result) => result.status).sort(), [200, 400]);
});
