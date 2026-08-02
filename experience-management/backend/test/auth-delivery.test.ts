import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-auth-delivery-'));
let failDelivery = true;
let holdDelivery = false;
let deliveryRequests = 0;
const deliveryBodies: string[] = [];
const heldDeliveryResponses: Array<() => void> = [];
const mailServer = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    deliveryRequests += 1;
    deliveryBodies.push(Buffer.concat(chunks).toString('utf8'));
    const requestNumber = deliveryRequests;
    const shouldFail = failDelivery;
    const complete = () => {
      response.statusCode = shouldFail ? 503 : 201;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(shouldFail ? { message: 'Simulated delivery failure' } : { messageId: `test-${requestNumber}` }));
    };
    if (holdDelivery) heldDeliveryResponses.push(complete);
    else complete();
  });
});
await new Promise<void>((resolve) => mailServer.listen(0, '127.0.0.1', resolve));
const address = mailServer.address();
if (!address || typeof address === 'string') throw new Error('Could not start the verification-email test server.');

const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Auth-Delivery-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'auth-delivery-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 62).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'auth.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5499',
  ADMIN_EMAIL: 'delivery-admin@example.test',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'send',
  BREVO_API_KEY: 'auth-delivery-test-key',
  BREVO_API_URL: `http://127.0.0.1:${address.port}/email`,
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
const { issueEmailVerificationToken } = await import('../src/auth.js');

after(async () => {
  holdDelivery = false;
  for (const complete of heldDeliveryResponses.splice(0)) complete();
  db.close();
  await new Promise<void>((resolve, reject) => mailServer.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for asynchronous verification delivery.');
}

function tokenCount(email: string) {
  return Number((db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens t
    JOIN users u ON u.id=t.user_id WHERE u.email=?`).get(email) as { count: number }).count || 0);
}

function activeTokenCount(email: string) {
  return Number((db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens t
    JOIN users u ON u.id=t.user_id WHERE u.email=? AND t.used_at IS NULL`).get(email) as { count: number }).count || 0);
}

function verificationTokenFromDelivery(body: string) {
  const payload = JSON.parse(body) as { textContent?: string };
  const match = String(payload.textContent || '').match(/verify-email\?token=([A-Za-z0-9_-]{40,100})/);
  assert.ok(match, 'the captured email should contain a verification token');
  return match[1];
}

function passwordResetTokenFromDelivery(body: string) {
  const payload = JSON.parse(body) as { textContent?: string };
  const match = String(payload.textContent || '').match(/reset-password\?token=([A-Za-z0-9_-]{40,100})/);
  assert.ok(match, 'the captured email should contain a password reset token');
  return match[1];
}

function releaseHeldDeliveries() {
  holdDelivery = false;
  for (const complete of heldDeliveryResponses.splice(0)) complete();
}

async function createOnboardedOwner(input: { name: string; email: string; password: string; spaceName: string }) {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 150) + 1}`).send(input).expect(202);
  const verification = issueEmailVerificationToken(input.email); assert.ok(verification);
  await agent.post('/api/auth/verify-email').send({ token: verification.token }).expect(200);
  const onboarded = await agent.post('/api/account/onboarding').send({
    name: input.name, jobTitle: 'Research owner', organizationName: 'Delivery Lab',
    timezone: 'UTC', primaryGoal: 'customer_experience', spaceName: input.spaceName
  }).expect(200);
  return { agent, space: onboarded.body.activeSpace as { id: string; name: string } };
}

test('failed verification delivery is visible and preserves the previous working link', async () => {
  const email = 'delivery-failure@example.test';
  const account = request.agent(app);
  const signup = await account.post('/api/auth/signup').send({
    name: 'Delivery Failure', email, password: 'Delivery-Failure-2026!'
  }).expect(202);
  assert.equal(signup.body.delivery.state, 'failed');
  assert.equal(activeTokenCount(email), 0, 'the unsent signup token should not consume the resend allowance');

  const previous = issueEmailVerificationToken(email); assert.ok(previous);
  db.prepare(`UPDATE email_verification_tokens SET sent_at=? WHERE id=?`)
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), previous.id);
  const requestsBefore = deliveryRequests;
  const resend = await request(app).post('/api/auth/resend-verification').send({ email }).expect(202);
  const unknown = await request(app).post('/api/auth/resend-verification').send({ email: 'unknown@example.test' }).expect(202);
  assert.equal(resend.body.message, unknown.body.message);
  await waitFor(() => deliveryRequests > requestsBefore && activeTokenCount(email) === 1);

  const verified = await account.post('/api/auth/verify-email').send({ token: previous.token }).expect(200);
  assert.equal(verified.body.emailVerified, true);

  const onboarded = await account.post('/api/account/onboarding').send({
    name: 'Delivery Failure', jobTitle: 'Researcher', organizationName: 'Delivery Lab',
    timezone: 'UTC', primaryGoal: 'customer_experience'
  }).expect(200);
  const invitedEmail = 'delivery-invitee@example.test';
  const invitation = await account.post(`/api/spaces/${onboarded.body.activeSpace.id}/invitations`).send({
    email: invitedEmail, role: 'member'
  }).expect(201);
  const inviteToken = new URL(invitation.body.inviteUrl).pathname.split('/').at(-1);
  const invitee = request.agent(app);
  const invitedSignup = await invitee.post('/api/auth/signup').send({
    name: 'Delivery Invitee', email: invitedEmail, password: 'Delivery-Invitee-2026!', inviteToken
  }).expect(202);
  assert.equal(invitedSignup.body.delivery.state, 'failed');
  const replacement = issueEmailVerificationToken(invitedEmail, {
    requestId: invitedSignup.body.verificationRequestId
  }); assert.ok(replacement);
  const verifiedInvitee = await invitee.post('/api/auth/verify-email').send({ token: replacement.token }).expect(200);
  assert.notEqual(verifiedInvitee.body.activeSpace.id, onboarded.body.activeSpace.id, 'verification must not silently accept an invitation');
  assert.equal((db.prepare('SELECT accepted_at FROM space_invitations WHERE id=?').get(invitation.body.invitation.id) as any).accepted_at, null);
  const accepted = await invitee.post(`/api/spaces/invitations/${encodeURIComponent(inviteToken!)}/accept`).send({}).expect(200);
  assert.equal(accepted.body.activeSpace.id, onboarded.body.activeSpace.id, 'the request-bound invitation remains available for explicit acceptance');
});

test('successful resend is rate-limited without invalidating an earlier link', async () => {
  failDelivery = false;
  const email = 'delivery-success@example.test';
  const account = request.agent(app);
  const signup = await account.post('/api/auth/signup').send({
    name: 'Delivery Success', email, password: 'Delivery-Success-2026!'
  }).expect(202);
  assert.equal(signup.body.delivery.state, 'sent');

  const previous = issueEmailVerificationToken(email); assert.ok(previous);
  db.prepare(`UPDATE email_verification_tokens SET sent_at=? WHERE user_id=(SELECT id FROM users WHERE email=?)`)
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), email);
  const requestsBefore = deliveryRequests;
  await request(app).post('/api/auth/resend-verification').send({ email }).expect(202);
  await waitFor(() => deliveryRequests > requestsBefore && tokenCount(email) === 3);
  const countAfterSuccess = tokenCount(email);
  await request(app).post('/api/auth/resend-verification').send({ email }).expect(202);
  assert.equal(tokenCount(email), countAfterSuccess, 'the cooldown should not issue another token');

  await account.post('/api/auth/verify-email').send({ token: previous.token }).expect(200);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens t
    JOIN users u ON u.id=t.user_id WHERE u.email=? AND t.used_at IS NULL`).get(email) as { count: number }).count, 0);
});

test('a failed verification request grants only one immediate resend exemption', async () => {
  failDelivery = true;
  const email = 'single-resend-exemption@example.test';
  const signup = await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.90').send({
    name: 'Single Resend Exemption', email, password: 'Single-Resend-Exemption-2026!'
  }).expect(202);
  assert.equal(signup.body.delivery.state, 'failed');
  const failedRequestId = signup.body.verificationRequestId as string;
  assert.match(failedRequestId, /^[0-9a-f-]{36}$/i);

  failDelivery = false;
  const deliveryIndex = deliveryBodies.length;
  const first = await request(app).post('/api/auth/resend-verification').set('x-forwarded-for', '198.51.100.91').send({
    email, requestId: failedRequestId
  }).expect(202);
  await waitFor(() => deliveryBodies.length > deliveryIndex);
  const replacementToken = verificationTokenFromDelivery(deliveryBodies[deliveryIndex]);

  const deliveriesAfterExemption = deliveryRequests;
  const second = await request(app).post('/api/auth/resend-verification').set('x-forwarded-for', '198.51.100.92').send({
    email, requestId: failedRequestId
  }).expect(202);
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.deepEqual(second.body, first.body);
  assert.equal(deliveryRequests, deliveriesAfterExemption, 'the failed requestId must not bypass the cooldown twice');
  const failedToken = db.prepare('SELECT resend_exemption_used_at FROM email_verification_tokens WHERE id=?').get(failedRequestId) as { resend_exemption_used_at: string | null };
  assert.ok(failedToken.resend_exemption_used_at);
  await request(app).post('/api/auth/verify-email').send({ token: replacementToken }).expect(200);
});

test('a mailbox owner safely claims a pre-registered email, chooses the password, and accepts only the current invitation', async () => {
  failDelivery = false;
  const email = 'preclaimed@example.test';
  const attackerPassword = 'Attacker-Preclaim-2026!';
  const ownerPassword = 'Mailbox-Owner-2026!';
  const racedPassword = 'Attacker-Raced-2026!';

  const firstOwner = await createOnboardedOwner({
    name: 'First Space Owner', email: 'first-space-owner@example.test',
    password: 'First-Space-Owner-2026!', spaceName: 'First invitation space'
  });
  const currentOwner = await createOnboardedOwner({
    name: 'Current Space Owner', email: 'current-space-owner@example.test',
    password: 'Current-Space-Owner-2026!', spaceName: 'Current invitation space'
  });
  const firstInvitation = await firstOwner.agent.post(`/api/spaces/${firstOwner.space.id}/invitations`).send({ email, role: 'member' }).expect(201);
  const currentInvitation = await currentOwner.agent.post(`/api/spaces/${currentOwner.space.id}/invitations`).send({ email, role: 'admin' }).expect(201);
  const firstInviteToken = new URL(firstInvitation.body.inviteUrl).pathname.split('/').at(-1);
  const currentInviteToken = new URL(currentInvitation.body.inviteUrl).pathname.split('/').at(-1);

  const firstDeliveryIndex = deliveryBodies.length;
  const attackerSignup = await request(app).post('/api/auth/signup').send({
    name: 'Mailbox Owner', email, password: attackerPassword, inviteToken: firstInviteToken
  }).expect(202);
  assert.equal(attackerSignup.body.delivery.state, 'sent');
  const attackerToken = verificationTokenFromDelivery(deliveryBodies[firstDeliveryIndex]);

  const ownerDeliveryIndex = deliveryBodies.length;
  const ownerSignup = await request(app).post('/api/auth/signup').send({
    name: 'Mailbox Owner', email, password: ownerPassword, inviteToken: currentInviteToken
  }).expect(202);
  assert.equal(ownerSignup.body.delivery.state, attackerSignup.body.delivery.state);
  const ownerToken = verificationTokenFromDelivery(deliveryBodies[ownerDeliveryIndex]);

  // A resend is tied to the specific signup attempt. It must preserve that
  // attempt's invitation instead of inheriting another token's invitation.
  db.prepare(`UPDATE email_verification_tokens SET sent_at=? WHERE user_id=(SELECT id FROM users WHERE email=?)`)
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), email);
  const resendDeliveryIndex = deliveryBodies.length;
  await request(app).post('/api/auth/resend-verification').send({
    email, requestId: ownerSignup.body.verificationRequestId
  }).expect(202);
  await waitFor(() => deliveryBodies.length > resendDeliveryIndex);
  const currentInviteClaimToken = verificationTokenFromDelivery(deliveryBodies[resendDeliveryIndex]);

  const racedDeliveryIndex = deliveryBodies.length;
  await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.82').send({
    name: 'Mailbox Owner', email, password: racedPassword
  }).expect(202);
  const racedToken = verificationTokenFromDelivery(deliveryBodies[racedDeliveryIndex]);

  await request(app).post('/api/auth/verify-email').send({ token: attackerToken }).expect(400);
  await request(app).post('/api/auth/login').send({ email, password: attackerPassword }).expect(403);
  await request(app).post('/api/auth/login').send({ email, password: ownerPassword }).expect(401);
  await request(app).post('/api/auth/login').send({ email, password: racedPassword }).expect(401);

  const claimed = await request(app).post('/api/auth/verify-email').send({ token: currentInviteClaimToken }).expect(200);
  assert.equal(claimed.body.authenticated, false);
  assert.equal(claimed.body.claimPasswordRequired, true);
  assert.match(claimed.body.passwordSetupToken, /^[A-Za-z0-9_-]{40,100}$/);
  assert.equal(([] as string[]).concat(claimed.headers['set-cookie'] || []).some((value) => value.startsWith('seemplify_experience_session=')), false);
  assert.equal((db.prepare('SELECT accepted_at FROM space_invitations WHERE id=?').get(currentInvitation.body.invitation.id) as any).accepted_at, null);

  await request(app).post('/api/auth/verify-email').send({ token: ownerToken }).expect(400);
  await request(app).post('/api/auth/verify-email').send({ token: racedToken }).expect(400);
  await request(app).post('/api/auth/login').send({ email, password: attackerPassword }).expect(401);
  await request(app).post('/api/auth/login').send({ email, password: racedPassword }).expect(401);

  const completed = await request(app).post('/api/auth/reset-password').send({
    token: claimed.body.passwordSetupToken, password: ownerPassword
  }).expect(200);
  assert.equal(completed.body.emailVerified, true);
  assert.notEqual(completed.body.activeSpace.id, currentOwner.space.id, 'password setup must not silently accept an invitation');
  assert.equal((db.prepare('SELECT accepted_at FROM space_invitations WHERE id=?').get(currentInvitation.body.invitation.id) as any).accepted_at, null);
  await request(app).post('/api/auth/reset-password').send({
    token: claimed.body.passwordSetupToken, password: 'Replay-Claim-2026!'
  }).expect(400);
  await request(app).post('/api/auth/login').send({ email, password: attackerPassword }).expect(401);
  await request(app).post('/api/auth/login').send({ email, password: racedPassword }).expect(401);
  const claimant = request.agent(app);
  await claimant.post('/api/auth/login').send({ email, password: ownerPassword }).expect(200);
  const joined = await claimant.post(`/api/spaces/invitations/${encodeURIComponent(currentInviteToken!)}/accept`).send({}).expect(200);
  assert.equal(joined.body.activeSpace.id, currentOwner.space.id);

  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string };
  const memberships = db.prepare('SELECT space_id,role FROM space_memberships WHERE user_id=?').all(user.id) as Array<{ space_id: string; role: string }>;
  assert.ok(memberships.some((membership) => membership.space_id === currentOwner.space.id && membership.role === 'admin'));
  assert.equal(memberships.some((membership) => membership.space_id === firstOwner.space.id), false);
  assert.equal((db.prepare('SELECT accepted_at FROM space_invitations WHERE id=?').get(firstInvitation.body.invitation.id) as any).accepted_at, null);
});

test('duplicate signup mail is persistently limited per account across source addresses and keeps generic timing', async () => {
  failDelivery = false;
  const email = 'mail-limit@example.test';
  const body = { name: 'Mail Limit Owner', email, password: 'Mail-Limit-Owner-2026!' };
  const initialStartedAt = Date.now();
  const initial = await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.100').send(body).expect(202);
  const initialElapsed = Date.now() - initialStartedAt;
  const deliveriesAfterInitial = deliveryRequests;
  const duplicateBodies: any[] = [];
  const duplicateDurations: number[] = [];

  for (let index = 0; index < 7; index += 1) {
    const startedAt = Date.now();
    const response = await request(app).post('/api/auth/signup')
      .set('x-forwarded-for', `198.51.100.${110 + index}`)
      .send({ ...body, password: `Duplicate-Claim-${index}-2026!` })
      .expect(202);
    duplicateDurations.push(Date.now() - startedAt);
    duplicateBodies.push(response.body);
  }

  assert.ok(initialElapsed >= 450, `fresh signup returned too quickly (${initialElapsed} ms)`);
  assert.ok(duplicateDurations.every((elapsed) => elapsed >= 450), `duplicate timings were ${duplicateDurations.join(', ')} ms`);
  for (const responseBody of duplicateBodies) {
    assert.deepEqual(Object.keys(responseBody).sort(), Object.keys(initial.body).sort());
    assert.equal(responseBody.code, initial.body.code);
  }
  assert.equal(deliveryRequests - deliveriesAfterInitial, 5, 'only five successful duplicate-account messages may be delivered per hour');
  const attempts = db.prepare(`SELECT kind,delivered_at,failed_at FROM account_email_attempts a
    JOIN users u ON u.id=a.user_id WHERE u.email=? ORDER BY a.created_at`).all(email) as Array<{ kind: string; delivered_at: string | null; failed_at: string | null }>;
  assert.equal(attempts.length, 5);
  assert.ok(attempts.every((attempt) => attempt.kind === 'claim' && attempt.delivered_at && !attempt.failed_at));
});

test('successful login does not erase the IP failure bucket and account failures persist across source addresses', async () => {
  failDelivery = false;
  const ipAccount = await createOnboardedOwner({
    name: 'IP Bucket Owner', email: 'ip-login-bucket@example.test',
    password: 'IP-Login-Bucket-2026!', spaceName: 'IP login bucket'
  });
  const sharedIp = '198.51.100.150';
  for (let index = 0; index < 7; index += 1) {
    await request(app).post('/api/auth/login').set('x-forwarded-for', sharedIp).send({
      email: `unknown-ip-login-${index}@example.test`, password: 'Wrong-IP-Password-2026!'
    }).expect(401);
  }
  await request(app).post('/api/auth/login').set('x-forwarded-for', sharedIp).send({
    email: 'ip-login-bucket@example.test', password: 'IP-Login-Bucket-2026!'
  }).expect(200);
  await request(app).post('/api/auth/login').set('x-forwarded-for', sharedIp).send({
    email: 'unknown-ip-login-final@example.test', password: 'Wrong-IP-Password-2026!'
  }).expect(401);
  await request(app).post('/api/auth/login').set('x-forwarded-for', sharedIp).send({
    email: 'ip-login-bucket@example.test', password: 'IP-Login-Bucket-2026!'
  }).expect(429);

  const accountEmail = 'account-login-bucket@example.test';
  await createOnboardedOwner({
    name: 'Account Bucket Owner', email: accountEmail,
    password: 'Account-Login-Bucket-2026!', spaceName: 'Account login bucket'
  });
  const unknownAccountEmail = 'unknown-account-login-bucket@example.test';
  for (let index = 0; index < 8; index += 1) {
    await request(app).post('/api/auth/login').set('x-forwarded-for', `198.51.100.${160 + index}`).send({
      email: accountEmail, password: `Wrong-Account-Password-${index}-2026!`
    }).expect(401);
    await request(app).post('/api/auth/login').set('x-forwarded-for', `198.51.100.${180 + index}`).send({
      email: unknownAccountEmail, password: `Wrong-Unknown-Password-${index}-2026!`
    }).expect(401);
  }
  await request(app).post('/api/auth/login').set('x-forwarded-for', '198.51.100.168').send({
    email: accountEmail, password: 'Wrong-Account-Password-8-2026!'
  }).expect(429);
  await request(app).post('/api/auth/login').set('x-forwarded-for', '198.51.100.188').send({
    email: unknownAccountEmail, password: 'Wrong-Unknown-Password-8-2026!'
  }).expect(429);
  await request(app).post('/api/auth/login').set('x-forwarded-for', '198.51.100.169').send({
    email: accountEmail, password: 'Account-Login-Bucket-2026!'
  }).expect(200);
  await request(app).post('/api/auth/login').set('x-forwarded-for', '198.51.100.170').send({
    email: accountEmail, password: 'Wrong-After-Recovery-2026!'
  }).expect(401);
  const accountIdentityHash = crypto.createHmac('sha256', fs.readFileSync(sessionFile, 'utf8'))
    .update(`login-identity\0${accountEmail}`).digest('hex');
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM auth_identity_attempts WHERE identity_hash=? AND created_at>=?`)
    .get(accountIdentityHash, new Date(Date.now() - 60_000).toISOString()) as any).count), 1);
  assert.ok(ipAccount.space.id);
});

test('forgot-password keeps known and unknown accounts response-equivalent with a minimum timing floor', async () => {
  failDelivery = false;
  const email = 'forgot-timing@example.test';
  await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.140').send({
    name: 'Forgot Timing Owner', email, password: 'Forgot-Timing-Owner-2026!'
  }).expect(202);

  const knownStartedAt = Date.now();
  const known = await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.141').send({ email }).expect(202);
  const knownElapsed = Date.now() - knownStartedAt;
  const unknownStartedAt = Date.now();
  const unknown = await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.142').send({
    email: 'unknown-forgot-timing@example.test'
  }).expect(202);
  const unknownElapsed = Date.now() - unknownStartedAt;

  assert.deepEqual(Object.keys(known.body).sort(), Object.keys(unknown.body).sort());
  assert.equal(known.body.message, unknown.body.message);
  assert.ok(knownElapsed >= 100, `known-account reset returned too quickly (${knownElapsed} ms)`);
  assert.ok(unknownElapsed >= 100, `unknown-account reset returned too quickly (${unknownElapsed} ms)`);
  assert.ok(Math.abs(knownElapsed - unknownElapsed) <= 250,
    `known and unknown reset timing diverged (${knownElapsed} ms vs ${unknownElapsed} ms)`);
});

test('forgot-password allows only one in-flight delivery for an account', async () => {
  failDelivery = false;
  await createOnboardedOwner({
    name: 'Inflight Reset Owner', email: 'inflight-reset@example.test',
    password: 'Inflight-Reset-Owner-2026!', spaceName: 'Inflight reset'
  });
  const before = deliveryRequests;
  holdDelivery = true;
  try {
    const first = await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.180').send({
      email: 'inflight-reset@example.test'
    }).expect(202);
    await waitFor(() => deliveryRequests === before + 1 && heldDeliveryResponses.length === 1);
    const second = await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.181').send({
      email: 'inflight-reset@example.test'
    }).expect(202);
    const third = await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.182').send({
      email: 'inflight-reset@example.test'
    }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.deepEqual(second.body, first.body);
    assert.deepEqual(third.body, first.body);
    assert.equal(deliveryRequests, before + 1, 'parallel reset requests must reuse the in-flight account delivery');
  } finally {
    releaseHeldDeliveries();
  }
});

test('forgot-password is persistently capped per account across source addresses', async () => {
  failDelivery = false;
  const email = 'reset-mail-cap@example.test';
  await createOnboardedOwner({
    name: 'Reset Mail Cap Owner', email,
    password: 'Reset-Mail-Cap-Owner-2026!', spaceName: 'Reset mail cap'
  });
  const before = deliveryRequests;
  const responses: any[] = [];
  for (let index = 0; index < 7; index += 1) {
    responses.push((await request(app).post('/api/auth/forgot-password')
      .set('x-forwarded-for', `198.51.100.${190 + index}`).send({ email }).expect(202)).body);
  }
  await waitFor(() => deliveryRequests >= before + 5);
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(deliveryRequests - before, 5, 'only five password-reset messages may be delivered per account per hour');
  assert.ok(responses.every((body) => JSON.stringify(body) === JSON.stringify(responses[0])));
});

test('a failed password-reset replacement preserves the previous working token', async () => {
  failDelivery = false;
  const email = 'reset-replacement@example.test';
  await createOnboardedOwner({
    name: 'Reset Replacement Owner', email,
    password: 'Reset-Replacement-Owner-2026!', spaceName: 'Reset replacement'
  });
  const firstDeliveryIndex = deliveryBodies.length;
  await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.210').send({ email }).expect(202);
  await waitFor(() => deliveryBodies.length > firstDeliveryIndex);
  const previousToken = passwordResetTokenFromDelivery(deliveryBodies[firstDeliveryIndex]);
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string };
  db.prepare('UPDATE account_email_attempts SET created_at=? WHERE user_id=?')
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), user.id);

  failDelivery = true;
  const failedDeliveryIndex = deliveryRequests;
  await request(app).post('/api/auth/forgot-password').set('x-forwarded-for', '198.51.100.211').send({ email }).expect(202);
  await waitFor(() => deliveryRequests > failedDeliveryIndex);
  await waitFor(() => Number((db.prepare(`SELECT COUNT(*) count FROM account_email_attempts
    WHERE user_id=? AND failed_at IS NOT NULL`).get(user.id) as any).count) > 0);

  await request(app).post('/api/auth/reset-password').set('x-forwarded-for', '198.51.100.212').send({
    token: previousToken, password: 'Reset-Replacement-Recovered-2026!'
  }).expect(200);
  await request(app).post('/api/auth/reset-password').set('x-forwarded-for', '198.51.100.213').send({
    token: previousToken, password: 'Reset-Replacement-Replay-2026!'
  }).expect(400);
});

test('new and existing accounts return the same delivery result during a provider outage', async () => {
  failDelivery = true;
  const existingStartedAt = Date.now();
  const existing = await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.80').send({
    name: 'Mailbox Owner', email: 'preclaimed@example.test', password: 'Another-Valid-2026!'
  }).expect(202);
  const existingElapsed = Date.now() - existingStartedAt;
  const freshStartedAt = Date.now();
  const fresh = await request(app).post('/api/auth/signup').set('x-forwarded-for', '198.51.100.81').send({
    name: 'Fresh Mailbox', email: 'provider-outage@example.test', password: 'Fresh-Mailbox-2026!'
  }).expect(202);
  const freshElapsed = Date.now() - freshStartedAt;
  assert.deepEqual(Object.keys(existing.body).sort(), Object.keys(fresh.body).sort());
  assert.equal(existing.body.code, fresh.body.code);
  assert.equal(existing.body.delivery.state, 'failed');
  assert.equal(fresh.body.delivery.state, 'failed');
  assert.ok(existingElapsed >= 450, `existing-account response returned too quickly (${existingElapsed} ms)`);
  assert.ok(freshElapsed >= 450, `new-account response returned too quickly (${freshElapsed} ms)`);
});
