import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

/**
 * Domain, repository, worker and route tests for runtime-56 Journey
 * collaboration email delivery, executed against SQLite.
 *
 * SCOPE WARNING. SQLite here is a projection of the staged
 * `migrations/postgres/future/0056_journey_collaboration_email_delivery.sql`,
 * built by ensureSqliteSchema in journeyCollaborationEmailRepository.ts. Nothing
 * below touches PostgreSQL, so a green run is NOT executed-PostgreSQL evidence:
 * the regex CHECKs, the plpgsql guards and FOR UPDATE SKIP LOCKED are
 * provider-specific and are only proved as TEXT by
 * journey-collaboration-email-migration.test.ts.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-collaboration-email-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Collaboration-Email-Test-2026!');
fs.writeFileSync(sessionFile, 'collaboration-email-test-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile, 'collaboration-email-test-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 72).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5418', ADMIN_EMAIL: 'collaboration-email@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile, LOCAL_LLM_SHARED_SECRET_FILE: terraFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { config } = await import('../src/config.js');
const { MailError } = await import('../src/mailClient.js');
const maps = await import('../src/journeyMaps.js');
const collaboration = await import('../src/journeyCollaboration.js');
const domain = await import('../src/journeyCollaborationEmailDomain.js');
const { journeyCollaborationEmailRepository: repository } =
  await import('../src/journeyCollaborationEmailRepository.js');
const { JourneyCollaborationEmailWorker } = await import('../src/journeyCollaborationEmailWorker.js');

after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

type UnrefableAgent = { app?: { on?: (event: string, listener: () => void) => void; unref?: () => void } };
function testAgent() {
  const agent = request.agent(app);
  const server = (agent as unknown as UnrefableAgent).app;
  server?.on?.('listening', () => server.unref?.());
  return agent;
}

async function ownerIdentity() {
  const agent = testAgent();
  await agent.post('/api/auth/login').send({
    email: 'collaboration-email@seemplify.local', password: 'Collaboration-Email-Test-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId, userId: String(session.body.user.id) };
}

async function collaborator(spaceId: string, role: 'admin' | 'member', suffix: string) {
  const agent = testAgent();
  const email = `collaboration-email-${suffix}@example.test`;
  await signupVerifyAndOnboard(agent, {
    name: `Collaboration ${suffix}`, email, password: 'Strong-collaboration-password-2026!',
    spaceName: `Collaboration ${suffix} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,?,?,?)')
    .run(spaceId, userId, role, now, now);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?")
    .run(String(session.body.activeSpace.id));
  return { agent, userId, email };
}

const owner = await ownerIdentity();
const optedIn = await collaborator(owner.spaceId, 'member', 'opted-in');
const optedOut = await collaborator(owner.spaceId, 'member', 'opted-out');
const transient = await collaborator(owner.spaceId, 'member', 'transient');

const journey = maps.createJourneyMap(owner.spaceId, owner.userId, {
  name: 'Checkout experience', stageNames: ['Discover', 'Pay']
});
const target = { targetType: 'journey_map' as const, targetId: journey.id };

let keySequence = 0;
const key = (label: string) => { keySequence += 1; return `${label}-${keySequence}`; };
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/** A comment body that is unmistakable if it ever reaches a delivery row. */
const SECRET_BODY = 'Refund policy exception for account 8842 must stay internal.';

function mention(userIds: string[], body = SECRET_BODY) {
  return collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body,
    mentionUserIds: userIds, idempotencyKey: key('comment')
  }).comment;
}

function optIn(userId: string) {
  const current = repository.getPreference(owner.spaceId, userId);
  if (current.emailEnabled) return current;
  return repository.setPreference({ spaceId: owner.spaceId, userId, actorUserId: userId,
    enabled: true, expectedRevision: current.revision });
}

function outboxRows(userId: string) {
  return db.prepare(`SELECT * FROM journey_collaboration_email_outbox
    WHERE space_id=? AND recipient_user_id=? ORDER BY created_at,id`).all(owner.spaceId, userId) as any[];
}
const pendingRows = (userId: string) => outboxRows(userId).filter((row) => row.state === 'pending');

function attempts(outboxId: string) {
  return db.prepare(`SELECT * FROM journey_collaboration_email_attempts
    WHERE outbox_id=? ORDER BY attempt_number`).all(outboxId) as any[];
}

function auditEvents(outboxId: string) {
  return db.prepare(`SELECT event,reason_code FROM journey_collaboration_email_audit_events
    WHERE space_id=? AND outbox_sha256=? ORDER BY created_at,id`)
    .all(owner.spaceId, sha(outboxId)) as any[];
}

/**
 * Claiming is deliberately global: the worker takes the oldest due row anywhere.
 * A test that wants one specific row therefore has to park every other pending
 * row in the future first, or it would assert against whichever row happened to
 * be queued earliest.
 */
function makeSoleDueRow(outboxId: string) {
  db.prepare("UPDATE journey_collaboration_email_outbox SET next_attempt_at='2999-01-01T00:00:00.000Z' WHERE state='pending'").run();
  db.prepare("UPDATE journey_collaboration_email_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .run(outboxId);
}

/** Queues one fresh delivery for the opted-in member and makes it the only due row. */
function freshDueRow(body?: string) {
  mention([optedIn.userId], body || `Fresh mention ${keySequence}.`);
  const row = pendingRows(optedIn.userId).at(-1)!;
  assert.ok(row, 'a fresh mention must queue a delivery for the opted-in member');
  makeSoleDueRow(String(row.id));
  return row;
}

function rejects(run: () => unknown, expected: { status: number; code: string }) {
  assert.throws(run, (error: any) => {
    assert.equal(error.status, expected.status, `status: got ${error.status} ${error.code} ${error.message}`);
    assert.equal(error.code, expected.code, `code: ${error.message}`);
    return true;
  });
}

test('the opt-in defaults to off, so an untouched member is never queued', () => {
  const preference = repository.getPreference(owner.spaceId, optedOut.userId);
  assert.equal(preference.emailEnabled, false);
  assert.equal(preference.revision, 0);
  assert.equal(preference.decidedAt, null);
  mention([optedOut.userId]);
  assert.deepEqual(outboxRows(optedOut.userId), [],
    'a member who never opted in must have no delivery row at all');
  // The in-app notification is unaffected: that semantic must not change.
  const notifications = db.prepare(`SELECT COUNT(*) total FROM journey_collaboration_notifications
    WHERE space_id=? AND recipient_user_id=?`).get(owner.spaceId, optedOut.userId) as any;
  assert.equal(Number(notifications.total) > 0, true);
});

test('a member may only manage its own preference and never anybody else', () => {
  rejects(() => repository.setPreference({ spaceId: owner.spaceId, userId: optedIn.userId,
    actorUserId: owner.userId, enabled: true, expectedRevision: 0 }),
  { status: 403, code: 'JOURNEY_COLLABORATION_EMAIL_PREFERENCE_FORBIDDEN' });
  // An owner is the most privileged principal in the space and still cannot do it.
  assert.equal(repository.getPreference(owner.spaceId, optedIn.userId).emailEnabled, false);
});

test('an unverified or suspended account cannot enable delivery', () => {
  db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(transient.userId);
  rejects(() => repository.setPreference({ spaceId: owner.spaceId, userId: transient.userId,
    actorUserId: transient.userId, enabled: true, expectedRevision: 0 }),
  { status: 409, code: 'JOURNEY_COLLABORATION_EMAIL_ACCOUNT_UNVERIFIED' });
  db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(), transient.userId);
  db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(transient.userId);
  rejects(() => repository.setPreference({ spaceId: owner.spaceId, userId: transient.userId,
    actorUserId: transient.userId, enabled: true, expectedRevision: 0 }),
  { status: 409, code: 'JOURNEY_COLLABORATION_EMAIL_ACCOUNT_UNVERIFIED' });
  db.prepare("UPDATE users SET account_status='active' WHERE id=?").run(transient.userId);
});

test('the preference is revisioned, so a stale panel cannot silently re-enable delivery', () => {
  const enabled = optIn(optedIn.userId);
  assert.equal(enabled.emailEnabled, true);
  assert.equal(enabled.revision, 1);
  assert.ok(enabled.decidedAt);
  rejects(() => repository.setPreference({ spaceId: owner.spaceId, userId: optedIn.userId,
    actorUserId: optedIn.userId, enabled: false, expectedRevision: 0 }),
  { status: 409, code: 'JOURNEY_COLLABORATION_EMAIL_PREFERENCE_CONFLICT' });
  assert.equal(repository.getPreference(owner.spaceId, optedIn.userId).emailEnabled, true);
});

test('a notification for an opted-in member queues exactly one content-free delivery', () => {
  const before = outboxRows(optedIn.userId).length;
  const comment = mention([optedIn.userId, optedOut.userId]);
  const rows = outboxRows(optedIn.userId);
  assert.equal(rows.length, before + 1, 'exactly one delivery per notification');
  assert.deepEqual(outboxRows(optedOut.userId), [], 'the opted-out mention must not queue');
  const row = rows.at(-1)!;
  assert.equal(row.state, 'pending');
  assert.equal(row.attempt_count, 0);
  assert.equal(row.notification_kind, 'mention');
  assert.equal(row.target_type, 'journey_map');
  // No column may contain the comment body, the recipient address or a name.
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes(SECRET_BODY), false, 'the comment body reached the delivery plane');
  assert.equal(serialized.includes(optedIn.email), false, 'the recipient address was stored');
  assert.equal(serialized.includes('Collaboration opted-in'), false, 'the recipient name was stored');
  assert.equal(serialized.includes(comment.id), false, 'the comment identifier was stored');
  // The key is derived, not generated: recomputing it from the tenant, the
  // notification and the recipient must reproduce it exactly.
  const notificationId = String((db.prepare(`SELECT id FROM journey_collaboration_notifications
    WHERE space_id=? AND recipient_user_id=? ORDER BY created_at DESC,id DESC LIMIT 1`)
    .get(owner.spaceId, optedIn.userId) as any).id);
  assert.equal(row.notification_id, notificationId);
  assert.equal(row.delivery_idempotency_key, domain.journeyCollaborationEmailIdempotencyKey({
    spaceId: owner.spaceId, notificationId, recipientUserId: optedIn.userId
  }));
  assert.match(String(row.delivery_idempotency_key),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual(auditEvents(String(row.id)).map((event) => event.event), ['delivery_queued']);
});

test('a rolled-back notification leaves no queued delivery behind', () => {
  const before = outboxRows(optedIn.userId).length;
  const notifications = Number((db.prepare(`SELECT COUNT(*) total FROM journey_collaboration_notifications
    WHERE space_id=?`).get(owner.spaceId) as any).total);
  // The enqueue rides the notification's own savepoint, so aborting the enclosing
  // transaction must take the delivery with it.
  try {
    db.transaction(() => {
      collaboration.createJourneyComment({ spaceId: owner.spaceId, actorUserId: owner.userId, target,
        body: 'Rolled back mention.', mentionUserIds: [optedIn.userId], idempotencyKey: key('rollback') });
      throw new Error('forced rollback');
    })();
    assert.fail('the forced rollback must propagate');
  } catch (error) {
    assert.equal((error as Error).message, 'forced rollback');
  }
  assert.equal(outboxRows(optedIn.userId).length, before);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) total FROM journey_collaboration_notifications
    WHERE space_id=?`).get(owner.spaceId) as any).total), notifications);
});

test('the rendered message carries a generic notice and an authenticated product link only', () => {
  const message = domain.renderJourneyCollaborationEmail({ kind: 'mention' });
  assert.equal(message.url, `${config.publicUrl}/journey-collaboration`);
  for (const part of [message.subject, message.text, message.html]) {
    assert.equal(part.includes(SECRET_BODY), false);
    assert.equal(part.includes(optedIn.email), false);
    assert.equal(part.includes(journey.id), false);
    assert.equal(part.includes(owner.spaceId), false);
  }
  assert.equal(message.subject, 'You have a new Journey collaboration notification');
  assert.match(message.text, /no discussion content/u);
  // No token, share secret or target identifier may ride in the link.
  assert.equal(new URL(message.url).search, '');
  // Every kind renders, and none of them names an actor or a target.
  for (const kind of domain.journeyCollaborationEmailKinds) {
    const rendered = domain.renderJourneyCollaborationEmail({ kind });
    assert.equal(rendered.subject, message.subject, 'the subject must not vary with the event');
    assert.equal(rendered.url, message.url);
  }
});

test('a claimed delivery resolves the current verified address and never stores it', () => {
  const queued = freshDueRow('Claimable mention.');
  const claim = repository.claim({ owner: 'test-worker' });
  assert.ok(claim, 'a due delivery must be claimable');
  assert.equal(claim.outboxId, String(queued.id));
  assert.equal(claim.recipientEmail, optedIn.email.toLowerCase());
  assert.equal(claim.attemptNumber, 1);
  assert.equal(claim.fencingToken, 1);
  const row = db.prepare('SELECT * FROM journey_collaboration_email_outbox WHERE id=?').get(claim.outboxId) as any;
  assert.equal(row.state, 'sending');
  assert.equal(row.lease_owner, 'test-worker');
  assert.match(String(row.lease_token_sha256), /^[a-f0-9]{64}$/u, 'the lease secret is stored hashed');
  assert.notEqual(row.lease_token_sha256, claim.leaseToken);
  assert.equal(JSON.stringify(row).includes(optedIn.email), false);

  // A second worker cannot take the same row while the lease holds.
  assert.equal(repository.claim({ owner: 'other-worker' }), null);

  assert.equal(repository.markSent(claim, 'provider-message-123').state, 'sent');
  const final = db.prepare('SELECT * FROM journey_collaboration_email_outbox WHERE id=?').get(claim.outboxId) as any;
  assert.equal(final.state, 'sent');
  assert.equal(final.lease_owner, null);
  assert.ok(final.sent_at && final.terminal_at);
  const ledger = attempts(claim.outboxId);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].outcome, 'sent');
  assert.equal(ledger[0].outcome_code, 'delivered');
  assert.equal(ledger[0].provider_message_sha256, sha('provider-message-123'));
  assert.deepEqual(auditEvents(claim.outboxId).map((event) => event.event),
    ['delivery_queued', 'delivery_sent']);
});

test('an immutable attempt ledger and audit trail cannot be rewritten', () => {
  const row = db.prepare('SELECT id FROM journey_collaboration_email_attempts ORDER BY completed_at DESC LIMIT 1')
    .get() as any;
  assert.throws(() => db.prepare("UPDATE journey_collaboration_email_attempts SET outcome='cancelled' WHERE id=?")
    .run(row.id), /append-only/u);
  assert.throws(() => db.prepare("UPDATE journey_collaboration_email_audit_events SET event='delivery_sent' WHERE space_id=?")
    .run(owner.spaceId), /append-only/u);
});

test('a terminal delivery can never be reopened or re-identified', () => {
  const sent = db.prepare("SELECT * FROM journey_collaboration_email_outbox WHERE state='sent' LIMIT 1").get() as any;
  assert.ok(sent);
  assert.throws(() => db.prepare("UPDATE journey_collaboration_email_outbox SET state='pending',fencing_token=99 WHERE id=?")
    .run(sent.id), /cannot be reopened/u);
  const queued = freshDueRow('Identity guard mention.');
  assert.throws(() => db.prepare('UPDATE journey_collaboration_email_outbox SET delivery_idempotency_key=? WHERE id=?')
    .run('11111111-1111-5111-8111-111111111111', queued.id), /identity is immutable/u);
  assert.throws(() => db.prepare('UPDATE journey_collaboration_email_outbox SET fencing_token=? WHERE id=?')
    .run(Number(queued.fencing_token) - 1, queued.id), /never move backwards/u);
});

test('a transport failure retries with bounded backoff and then dead-letters', () => {
  const queued = freshDueRow('Retry mention.');
  const outboxId = String(queued.id);
  for (let attempt = 1; attempt <= domain.journeyCollaborationEmailLimits.maxAttempts; attempt += 1) {
    const claim = repository.claim({ owner: `retry-worker-${attempt}` });
    assert.ok(claim, `attempt ${attempt} must be claimable`);
    assert.equal(claim.outboxId, outboxId);
    assert.equal(claim.attemptNumber, attempt);
    const outcome = repository.recordFailure(claim, 'transport_retryable');
    const current = db.prepare('SELECT * FROM journey_collaboration_email_outbox WHERE id=?').get(outboxId) as any;
    if (attempt < domain.journeyCollaborationEmailLimits.maxAttempts) {
      assert.equal(outcome.state, 'pending');
      assert.equal(Date.parse(current.next_attempt_at) > Date.now(), true, 'the retry must be scheduled forward');
      // Backoff doubles and is capped, so a persistent outage becomes neither a
      // tight loop nor an unbounded wait.
      assert.equal(domain.journeyCollaborationEmailBackoffMs(attempt),
        Math.min(domain.journeyCollaborationEmailLimits.maximumBackoffMs,
          domain.journeyCollaborationEmailLimits.minimumBackoffMs * 2 ** (attempt - 1)));
      makeSoleDueRow(outboxId);
    } else {
      assert.equal(outcome.state, 'dead_letter');
      assert.equal(current.state, 'dead_letter');
      assert.ok(current.terminal_at);
      assert.equal(current.sent_at, null);
    }
  }
  const ledger = attempts(outboxId);
  assert.equal(ledger.length, domain.journeyCollaborationEmailLimits.maxAttempts);
  assert.deepEqual(ledger.map((entry) => entry.outcome),
    ['retry_scheduled', 'retry_scheduled', 'retry_scheduled', 'retry_scheduled', 'dead_lettered']);
  assert.equal(ledger.every((entry) => entry.outcome_code === 'transport_retryable'), true);
});

test('a permanent transport rejection stops immediately instead of burning the budget', () => {
  const queued = freshDueRow('Permanent failure mention.');
  const claim = repository.claim({ owner: 'permanent-worker' });
  assert.ok(claim);
  assert.equal(claim.outboxId, String(queued.id));
  assert.equal(repository.recordFailure(claim, 'transport_permanent').state, 'dead_letter');
  assert.equal(attempts(claim.outboxId).length, 1);
  assert.equal(domain.classifyJourneyCollaborationEmailFailure(
    new MailError('bad address', { code: 'invalid_message' })), 'transport_permanent');
  assert.equal(domain.classifyJourneyCollaborationEmailFailure(
    new MailError('upstream busy', { code: 'transport_error', retryable: true })), 'transport_retryable');
});

test('a lost lease cannot overwrite the outcome the replacement worker recorded', () => {
  const queued = freshDueRow('Fencing mention.');
  const stale = repository.claim({ owner: 'stale-worker' });
  assert.ok(stale);
  assert.equal(stale.outboxId, String(queued.id));
  // Expire the lease and let a second worker take the row.
  db.prepare("UPDATE journey_collaboration_email_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .run(stale.outboxId);
  assert.equal(repository.recoverStaleDeliveries().requeued, 1);
  makeSoleDueRow(stale.outboxId);
  const fresh = repository.claim({ owner: 'fresh-worker' });
  assert.ok(fresh);
  assert.equal(fresh.outboxId, stale.outboxId);
  assert.equal(fresh.fencingToken > stale.fencingToken, true, 'the fencing token must advance');
  rejects(() => repository.markSent(stale, 'stale-message'),
    { status: 409, code: 'JOURNEY_COLLABORATION_EMAIL_LEASE_LOST' });
  repository.markSent(fresh, 'fresh-message');
  assert.equal((db.prepare('SELECT state FROM journey_collaboration_email_outbox WHERE id=?')
    .get(fresh.outboxId) as any).state, 'sent');
});

test('a delivery left in flight past the provider dedupe window is dead-lettered, not resent', () => {
  const queued = freshDueRow('Crash recovery mention.');
  const claim = repository.claim({ owner: 'crashed-worker' });
  assert.ok(claim);
  assert.equal(claim.outboxId, String(queued.id));
  // The row stays exactly as the killed process left it. Recovery is driven from
  // an hour later, so the lease is expired AND the row is older than the 29
  // minute provider dedupe window; `updated_at` is never rewritten backwards,
  // which the updated_at>=created_at CHECK would refuse anyway.
  const recovered = repository.recoverStaleDeliveries(new Date(Date.now() + 3_600_000), 29 * 60_000);
  assert.equal(recovered.deadLettered >= 1, true);
  assert.equal(recovered.requeued, 0, 'a delivery of unknown state must never be resent');
  const current = db.prepare('SELECT * FROM journey_collaboration_email_outbox WHERE id=?')
    .get(claim.outboxId) as any;
  assert.equal(current.state, 'dead_letter');
  assert.equal(current.last_outcome_code, 'recovery_timeout');
  assert.equal(current.sent_at, null, 'an unknown delivery must never be recorded as sent');
});

test('opting out before the send cancels everything already queued', () => {
  const before = pendingRows(optedIn.userId).length;
  mention([optedIn.userId], 'Mention before opting out.');
  assert.equal(pendingRows(optedIn.userId).length, before + 1);
  const preference = repository.getPreference(owner.spaceId, optedIn.userId);
  repository.setPreference({ spaceId: owner.spaceId, userId: optedIn.userId, actorUserId: optedIn.userId,
    enabled: false, expectedRevision: preference.revision });
  assert.deepEqual(pendingRows(optedIn.userId), [],
    'withdrawing consent must cancel the queue, not just stop new rows');
  const cancelled = outboxRows(optedIn.userId)
    .filter((row) => row.state === 'cancelled' && row.last_outcome_code === 'recipient_opted_out');
  assert.equal(cancelled.length >= 1, true);
  // A new notification for the same member no longer queues at all.
  mention([optedIn.userId], 'Post-opt-out mention.');
  assert.deepEqual(pendingRows(optedIn.userId), []);
  optIn(optedIn.userId);
});

test('an opt-out that lands after the row was queued cancels it at claim time', () => {
  const queued = freshDueRow('Racing opt-out mention.');
  // Withdraw consent behind the repository's back, exactly as a concurrent
  // request would land between the queue and the claim.
  db.prepare(`UPDATE journey_collaboration_email_preferences SET email_enabled=0,decided_at=NULL
    WHERE space_id=? AND user_id=?`).run(owner.spaceId, optedIn.userId);
  assert.equal(repository.claim({ owner: 'racing-worker' }), null, 'an ineligible row must not be claimable');
  const current = db.prepare('SELECT * FROM journey_collaboration_email_outbox WHERE id=?')
    .get(queued.id) as any;
  assert.equal(current.state, 'cancelled');
  assert.equal(current.last_outcome_code, 'recipient_opted_out');
  assert.equal(attempts(String(queued.id)).at(-1)!.outcome, 'cancelled');
  db.prepare(`UPDATE journey_collaboration_email_preferences SET email_enabled=1,decided_at=?
    WHERE space_id=? AND user_id=?`).run(new Date().toISOString(), owner.spaceId, optedIn.userId);
});

test('losing membership removes the queued delivery with the consent record', () => {
  optIn(transient.userId);
  mention([transient.userId], 'Mention for a member about to leave.');
  assert.equal(outboxRows(transient.userId).length, 1);
  db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?').run(owner.spaceId, transient.userId);
  assert.deepEqual(outboxRows(transient.userId), [],
    'a revoked member must not keep a queued delivery that a later pass could send');
  assert.deepEqual(db.prepare(`SELECT * FROM journey_collaboration_email_preferences
    WHERE space_id=? AND user_id=?`).all(owner.spaceId, transient.userId), [],
    'the consent record belongs to the membership and goes with it');
});

test('the worker sends the generic message under the derived key and records the outcome', async () => {
  const queued = freshDueRow('Worker mention.');
  const captured: any[] = [];
  const worker = new JourneyCollaborationEmailWorker(60_000, 5, 29 * 60_000, repository,
    (async (input: any) => { captured.push(input); return { messageId: 'worker-message-1' }; }) as any,
    () => {});
  const result = await worker.runOnce();
  worker.stop();
  assert.ok(result);
  assert.equal(result.sent, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].to, optedIn.email.toLowerCase());
  assert.equal(captured[0].idempotencyKey, queued.delivery_idempotency_key,
    'the send must present the derived key so a replay deduplicates at the provider');
  assert.equal(captured[0].correlation, `journey_collaboration_email:${queued.id}`);
  assert.equal(JSON.stringify(captured[0]).includes(SECRET_BODY), false);
  assert.equal(captured[0].subject, 'You have a new Journey collaboration notification');
  assert.equal((db.prepare('SELECT state FROM journey_collaboration_email_outbox WHERE id=?')
    .get(queued.id) as any).state, 'sent');
});

test('a worker pass is bounded and a retried row stays queued for the next pass', async () => {
  for (let index = 0; index < 3; index += 1) mention([optedIn.userId], `Bounded pass mention ${index}.`);
  db.prepare(`UPDATE journey_collaboration_email_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z'
    WHERE space_id=? AND state='pending'`).run(owner.spaceId);
  const due = Number((db.prepare(`SELECT COUNT(*) total FROM journey_collaboration_email_outbox
    WHERE space_id=? AND state='pending'`).get(owner.spaceId) as any).total);
  assert.equal(due >= 3, true);
  let calls = 0;
  const worker = new JourneyCollaborationEmailWorker(60_000, 2, 29 * 60_000, repository,
    (async () => { calls += 1; throw new MailError('upstream busy', { code: 'transport_error', retryable: true }); }) as any,
    () => {});
  const result = await worker.runOnce();
  worker.stop();
  assert.ok(result);
  assert.equal(calls, 2, 'the pass must stop at the configured batch size');
  assert.equal(result.retried, 2);
  assert.equal(result.sent, 0);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) total FROM journey_collaboration_email_outbox
    WHERE space_id=? AND state='pending'`).get(owner.spaceId) as any).total), due,
    'a retried row is rescheduled, never dropped');
});

test('outbound delivery is globally disabled unless a deployment turns it on', () => {
  assert.equal(config.journeyCollaborationEmailWorkerEnabled, false,
    'the default environment must send no collaboration mail');
  assert.equal(config.journeyCollaborationEmailWorkerBatchSize <= 100, true);
});

test('the preference route reads and writes only the caller own record', async () => {
  const initial = await optedOut.agent.get('/api/journey-collaboration-email/preference')
    .query({ spaceId: owner.spaceId }).expect(200);
  assert.equal(initial.body.preference.emailEnabled, false);
  assert.equal(initial.body.preference.deliveryEnabled, false);
  const updated = await optedOut.agent.put('/api/journey-collaboration-email/preference')
    .query({ spaceId: owner.spaceId })
    .send({ enabled: true, expectedRevision: initial.body.preference.revision }).expect(200);
  assert.equal(updated.body.preference.emailEnabled, true);
  assert.equal(updated.body.preference.revision, 1);
  // The route accepts no principal and no tenant from the caller, so a body that
  // names somebody else is rejected outright rather than quietly ignored.
  await optedOut.agent.put('/api/journey-collaboration-email/preference').query({ spaceId: owner.spaceId })
    .send({ enabled: false, expectedRevision: 1, userId: optedIn.userId }).expect(400);
  assert.equal(repository.getPreference(owner.spaceId, optedOut.userId).emailEnabled, true);
  // A stale revision is a conflict, not a silent overwrite.
  await optedOut.agent.put('/api/journey-collaboration-email/preference').query({ spaceId: owner.spaceId })
    .send({ enabled: false, expectedRevision: 0 }).expect(409);
  // An owner reads its own record, never the member's it might want to enable.
  const ownerView = await owner.agent.get('/api/journey-collaboration-email/preference')
    .query({ spaceId: owner.spaceId }).expect(200);
  assert.equal(ownerView.body.preference.emailEnabled, false);
});

test('the status route reports content-free counters for the caller own tenant', async () => {
  const response = await optedIn.agent.get('/api/journey-collaboration-email/status')
    .query({ spaceId: owner.spaceId }).expect(200);
  assert.deepEqual(Object.keys(response.body.counts).sort(),
    ['cancelled', 'dead_letter', 'pending', 'sending', 'sent']);
  assert.equal(response.body.deliveryEnabled, false);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(SECRET_BODY), false);
  assert.equal(serialized.includes(optedIn.email), false);
  assert.equal(serialized.includes(optedIn.userId), false);
  // An unauthenticated caller gets no tenant at all.
  await testAgent().get('/api/journey-collaboration-email/status').expect(401);
});
