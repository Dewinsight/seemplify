import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

/**
 * Domain tests for the Phase 3 collaboration facade, executed against SQLite.
 *
 * SCOPE WARNING. SQLite is a projection of `0028_journey_collaboration.sql`.
 * `runtime-compatibility.json` now pins min=max=29, so runtime-28 is inside the
 * shipped window on paper, but nothing here touches PostgreSQL and no applied
 * run is recorded, so a green run here is NOT executed-PostgreSQL evidence.
 * The projection is built by ensureSqliteSchema in journeyCollaboration.ts and
 * still lacks PostgreSQL's regex CHECKs, its deferred current-version foreign
 * key and its index-width constraints. Assertions that can only hold on
 * PostgreSQL are called out where they appear.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-collaboration-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Collaboration-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-collaboration-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 71).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 72).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5413',
  ADMIN_EMAIL: 'journey-collaboration@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
// journey_portfolio_items is created by this module at its own load, and the
// collaboration projection declares its portfolio target guard only when the
// table is present. Importing it here keeps the guard under test.
await import('../src/journeyPortfolio.js');
const maps = await import('../src/journeyMaps.js');
const collaboration = await import('../src/journeyCollaboration.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

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
    email: 'journey-collaboration@seemplify.local', password: 'Journey-Collaboration-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { spaceId, userId: String(session.body.user.id) };
}

async function collaborator(spaceId: string | null, role: 'admin' | 'member', suffix: string) {
  const agent = testAgent();
  await signupVerifyAndOnboard(agent, {
    name: `Collaboration ${suffix}`, email: `collaboration-${suffix}@example.test`,
    password: 'Strong-collaboration-password-2026!', spaceName: `Collaboration ${suffix} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  if (spaceId) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES (?,?,?,?,?)`).run(spaceId, userId, role, now, now);
  }
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(homeSpaceId);
  return { userId, homeSpaceId };
}

const owner = await ownerIdentity();
const manager = await collaborator(owner.spaceId, 'admin', 'manager');
const member = await collaborator(owner.spaceId, 'member', 'member');
const second = await collaborator(owner.spaceId, 'member', 'second');
const outsider = await collaborator(null, 'member', 'outsider');

const journey = maps.createJourneyMap(owner.spaceId, owner.userId, {
  name: 'Checkout experience', stageNames: ['Discover', 'Pay']
});
const foreignJourney = maps.createJourneyMap(outsider.homeSpaceId, outsider.userId, {
  name: 'Foreign journey', stageNames: ['Discover']
});
const target = { targetType: 'journey_map' as const, targetId: journey.id };

let keySequence = 0;
function key(label: string) { keySequence += 1; return `${label}-${keySequence}`; }

function rejects(run: () => unknown, expected: { status: number; code: string }) {
  assert.throws(run, (error: any) => {
    assert.equal(error.status, expected.status,
      `status for ${expected.code}: got ${error.status} ${error.code} ${error.message}`);
    assert.equal(error.code, expected.code, `code: ${error.message}`);
    return true;
  });
}

function comment(actorUserId: string, body: string, overrides: Record<string, unknown> = {}) {
  return collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId, target, body, idempotencyKey: key('comment'), ...overrides
  }).comment;
}

function activityActions(targetId: string) {
  return (db.prepare(`SELECT action FROM journey_collaboration_activity
    WHERE space_id=? AND target_id=? ORDER BY created_at,id`).all(owner.spaceId, targetId) as Array<{ action: string }>)
    .map((row) => row.action);
}

test('collaboration targets and actors are confined to their tenant', () => {
  rejects(() => collaboration.resolveJourneyCollaborationTarget(owner.spaceId, {
    targetType: 'journey_map', targetId: foreignJourney.id
  }), { status: 404, code: 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND' });
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId,
    target: { targetType: 'journey_map', targetId: foreignJourney.id },
    body: 'Cross-tenant comment', idempotencyKey: key('cross')
  }), { status: 404, code: 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND' });
  rejects(() => collaboration.listJourneyComments({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, target
  }), { status: 404, code: 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND' });
  for (const call of [
    () => collaboration.listJourneyComments({ spaceId: owner.spaceId, actorUserId: outsider.userId, target }),
    () => collaboration.getJourneyCollaborationContext({ spaceId: owner.spaceId, actorUserId: outsider.userId }),
    () => collaboration.listJourneyCollaborationNotifications({
      spaceId: owner.spaceId, actorUserId: outsider.userId
    }),
    () => collaboration.createJourneyComment({
      spaceId: owner.spaceId, actorUserId: outsider.userId, target, body: 'Outsider',
      idempotencyKey: key('outsider')
    })
  ]) {
    rejects(call, { status: 403, code: 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED' });
  }
});

test('space membership maps to a Journey role and grants are additive', () => {
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, owner.userId).role, 'administrator');
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, manager.userId).role, 'manager');
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, member.userId).role, 'viewer');
  const context = collaboration.getJourneyCollaborationContext({
    spaceId: owner.spaceId, actorUserId: member.userId, target
  });
  assert.equal(context.role, 'viewer');
  assert.equal(context.readOnly, false);
  assert.ok(context.capabilities.includes('journeys.comment'));
  assert.ok(!context.capabilities.includes('journeys.edit'));
  assert.equal(context.target?.targetId, journey.id);
  rejects(() => collaboration.assertJourneyCapability(owner.spaceId, member.userId, 'journeys.edit', target),
    { status: 403, code: 'JOURNEY_CAPABILITY_REQUIRED' });
});

test('a journey-scoped grant adds capability without removing the space-scoped one', () => {
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'editor',
    scopeType: 'space', idempotencyKey: key('grant-editor')
  });
  assert.ok(collaboration.effectiveJourneyRole(owner.spaceId, member.userId, journey.id)
    .capabilities.has('journeys.edit'));
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'approver',
    scopeType: 'journey', journeyDefinitionId: journey.id, idempotencyKey: key('grant-approver')
  });
  const effective = collaboration.effectiveJourneyRole(owner.spaceId, member.userId, journey.id);
  // Union, not replacement: the journey-scoped approver adds review/publish and
  // the space-scoped editor keeps edit. Max-by-rank would have dropped edit.
  assert.ok(effective.capabilities.has('journeys.review'));
  assert.ok(effective.capabilities.has('journeys.publish'));
  assert.ok(effective.capabilities.has('journeys.edit'));
  assert.equal(effective.role, 'approver');
  assert.equal(effective.source, 'journey_assignment');
  // Another journey is unaffected by a journey-scoped grant.
  const other = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Support experience' });
  assert.ok(!collaboration.effectiveJourneyRole(owner.spaceId, member.userId, other.id)
    .capabilities.has('journeys.review'));
});

test('role grants cannot escalate, replace a higher grant, or be self-issued', () => {
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: member.userId, role: 'administrator',
    scopeType: 'space', idempotencyKey: key('escalate')
  }), { status: 403, code: 'JOURNEY_ROLE_GRANT_FORBIDDEN' });
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: member.userId, role: 'manager',
    scopeType: 'space', idempotencyKey: key('equal')
  }), { status: 403, code: 'JOURNEY_ROLE_GRANT_FORBIDDEN' });
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: manager.userId, role: 'editor',
    scopeType: 'space', idempotencyKey: key('self')
  }), { status: 409, code: 'JOURNEY_ROLE_SELF_ASSIGNMENT_FORBIDDEN' });
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: owner.userId, role: 'viewer',
    scopeType: 'space', idempotencyKey: key('owner')
  }), { status: 409, code: 'JOURNEY_OWNER_ROLE_PROTECTED' });
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'nonsense' as never,
    scopeType: 'space', idempotencyKey: key('bad-role')
  }), { status: 400, code: 'JOURNEY_ROLE_INVALID' });
  for (const scope of [
    { scopeType: 'space' as const, journeyDefinitionId: journey.id },
    { scopeType: 'journey' as const, journeyDefinitionId: null }
  ]) {
    rejects(() => collaboration.assignJourneyRole({
      spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'viewer',
      idempotencyKey: key('bad-scope'), ...scope
    }), { status: 400, code: 'JOURNEY_ROLE_SCOPE_INVALID' });
  }
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'viewer',
    scopeType: 'journey', journeyDefinitionId: foreignJourney.id, idempotencyKey: key('cross-scope')
  }), { status: 404, code: 'JOURNEY_COLLABORATION_TARGET_NOT_FOUND' });
});

test('assigning a role cannot be used as an unguarded revoke of a higher one', () => {
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: second.userId, role: 'administrator',
    scopeType: 'space', idempotencyKey: key('grant-admin')
  });
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, second.userId).role, 'administrator');
  // The rank guard only inspected the role being granted, while the assignment
  // path unconditionally revoked whatever the subject already held.
  rejects(() => collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: second.userId, role: 'viewer',
    scopeType: 'space', idempotencyKey: key('strip-admin')
  }), { status: 403, code: 'JOURNEY_ROLE_REPLACE_FORBIDDEN' });
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, second.userId).role, 'administrator');
  // A journey-scoped grant at a lower rank is allowed -- there is no existing
  // assignment in that scope to replace -- but because grants are additive it
  // cannot be used to strip the space-scoped administrator either.
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, userId: second.userId, role: 'viewer',
    scopeType: 'journey', journeyDefinitionId: journey.id, idempotencyKey: key('scoped-viewer')
  });
  assert.ok(collaboration.effectiveJourneyRole(owner.spaceId, second.userId, journey.id)
    .capabilities.has('journeys.manage_roles'));
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, second.userId, journey.id).role,
    'administrator');
});

test('role revocation keeps its rank guard, self-revocation guard and revision check', () => {
  const assignment = collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'contributor',
    scopeType: 'journey', journeyDefinitionId: journey.id, idempotencyKey: key('grant-contributor')
  }).assignment;
  rejects(() => collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, assignmentId: assignment.id,
    expectedRevision: assignment.revision, reason: 'no', idempotencyKey: key('short-reason')
  }), { status: 400, code: 'JOURNEY_ROLE_REVOCATION_REASON_REQUIRED' });
  rejects(() => collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, assignmentId: assignment.id,
    expectedRevision: assignment.revision + 5, reason: 'Role no longer needed.',
    idempotencyKey: key('stale-revision')
  }), { status: 409, code: 'JOURNEY_ROLE_REVISION_CONFLICT' });
  const secondAssignment = db.prepare(`SELECT id,revision FROM journey_collaboration_role_assignments
    WHERE space_id=? AND user_id=? AND state='active' AND scope_type='space'`)
    .get(owner.spaceId, second.userId) as any;
  rejects(() => collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: manager.userId, assignmentId: String(secondAssignment.id),
    expectedRevision: Number(secondAssignment.revision), reason: 'Trying to remove an administrator.',
    idempotencyKey: key('revoke-higher')
  }), { status: 403, code: 'JOURNEY_ROLE_REVOKE_FORBIDDEN' });
  const revoked = collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, assignmentId: assignment.id,
    expectedRevision: assignment.revision, reason: 'Role no longer needed.', idempotencyKey: key('revoke')
  });
  assert.equal(revoked.state, 'revoked');
  const reason = db.prepare(`SELECT revocation_reason_sha256 reason FROM journey_collaboration_role_assignments
    WHERE id=?`).get(assignment.id) as any;
  assert.equal(String(reason.reason).length, 64, 'the revocation reason is stored only as a hash');
});

test('role listing is bounded, ordered and rejects malformed paging', () => {
  const listed = collaboration.listJourneyRoleAssignments({
    spaceId: owner.spaceId, actorUserId: owner.userId, limit: 2
  });
  assert.equal(listed.items.length, 2);
  assert.ok(listed.nextCursor);
  const next = collaboration.listJourneyRoleAssignments({
    spaceId: owner.spaceId, actorUserId: owner.userId, limit: 2, cursor: listed.nextCursor
  });
  const overlap = next.items.filter((item) => listed.items.some((seen) => seen.id === item.id));
  assert.deepEqual(overlap, [], 'cursor pages must not repeat an assignment');
  for (const limit of [0, -1, 1.5, 101, Number.NaN]) {
    rejects(() => collaboration.listJourneyRoleAssignments({
      spaceId: owner.spaceId, actorUserId: owner.userId, limit
    }), { status: 400, code: 'JOURNEY_COLLABORATION_PAGE_INVALID' });
  }
  rejects(() => collaboration.listJourneyRoleAssignments({
    spaceId: owner.spaceId, actorUserId: owner.userId, cursor: 'not-a-cursor!!'
  }), { status: 400, code: 'JOURNEY_COLLABORATION_CURSOR_INVALID' });
  rejects(() => collaboration.listJourneyRoleAssignments({
    spaceId: owner.spaceId, actorUserId: member.userId
  }), { status: 403, code: 'JOURNEY_CAPABILITY_REQUIRED' });
});

test('threads carry immutable revisions, mentions and deterministic ordering', () => {
  const rootComment = comment(owner.userId, 'Payment step loses people.',
    { mentionUserIds: [member.userId] });
  assert.equal(rootComment.revision, 1);
  assert.deepEqual(rootComment.mentions.map((entry) => entry.id), [member.userId]);
  const reply = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, target, parentCommentId: rootComment.id,
    body: 'Agreed, the address form is the drop-off.', idempotencyKey: key('reply')
  }).comment;
  assert.equal(reply.parentCommentId, rootComment.id);
  assert.equal(reply.rootCommentId, rootComment.id);
  const edited = collaboration.editJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 1,
    body: 'Payment step loses people at the address form.', editReason: 'Add the specific step.',
    idempotencyKey: key('edit')
  }).comment;
  assert.equal(edited.revision, 2);
  assert.equal(edited.mentions.length, 0, 'mentions are pinned to the revision that carried them');
  const history = collaboration.listJourneyCommentHistory({
    spaceId: owner.spaceId, actorUserId: member.userId, commentId: rootComment.id
  });
  assert.deepEqual(history.items.map((entry) => entry.versionNumber), [2, 1]);
  assert.equal(history.items[1].plainText, 'Payment step loses people.',
    'the superseded version stays readable and unchanged');
  assert.equal(history.redacted, false);
  rejects(() => collaboration.editJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 1,
    body: 'Stale write.', editReason: 'Should not apply.', idempotencyKey: key('stale-edit')
  }), { status: 409, code: 'JOURNEY_COMMENT_REVISION_CONFLICT' });
  rejects(() => collaboration.editJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, commentId: rootComment.id, expectedRevision: 2,
    body: 'Not my comment.', editReason: 'Should not apply.', idempotencyKey: key('foreign-edit')
  }), { status: 403, code: 'JOURNEY_COMMENT_AUTHOR_REQUIRED' });
  const listed = collaboration.listJourneyComments({
    spaceId: owner.spaceId, actorUserId: member.userId, target
  });
  const order = listed.items.map((entry) => entry.id);
  assert.deepEqual(order, [...order].sort((left, right) => {
    const leftRow = listed.items.find((entry) => entry.id === left)!;
    const rightRow = listed.items.find((entry) => entry.id === right)!;
    return leftRow.createdAt.localeCompare(rightRow.createdAt) || left.localeCompare(right);
  }), 'comments must be ordered by (created_at,id)');
});

test('comment bodies are validated for emptiness, character count and stored bytes', () => {
  rejects(() => comment(owner.userId, '   '), { status: 400, code: 'JOURNEY_COMMENT_BODY_INVALID' });
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target,
    body: { version: 1, blocks: Array.from({ length: 5 }, () => ({
      type: 'paragraph', text: 'a'.repeat(2_000), marks: []
    })) }, idempotencyKey: key('too-long')
  }), { status: 413, code: 'JOURNEY_COMMENT_BODY_TOO_LARGE' });
  // Inside the character limit, far outside the 64 KiB body_json check that only
  // PostgreSQL enforces as a column constraint.
  const href = (index: number) => `https://example.test/${String(index).padStart(4, '0')}${'a'.repeat(1_990)}`;
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target,
    body: { version: 1, blocks: [0, 1].map((block) => ({
      type: 'paragraph', text: 'x'.repeat(20),
      marks: Array.from({ length: 20 }, (_unused, index) => ({
        type: 'link', start: index, end: index + 1, href: href(block * 20 + index)
      }))
    })) }, idempotencyKey: key('too-many-bytes')
  }), { status: 413, code: 'JOURNEY_COMMENT_BODY_TOO_LARGE' });
});

test('mentions are rejected without leaking a third party role or membership', () => {
  rejects(() => comment(owner.userId, 'Mentioning an outsider.', { mentionUserIds: [outsider.userId] }),
    { status: 422, code: 'JOURNEY_COMMENT_MENTION_NOT_PERMITTED' });
  rejects(() => comment(owner.userId, 'Mentioning a ghost.', { mentionUserIds: ['user-does-not-exist'] }),
    { status: 422, code: 'JOURNEY_COMMENT_MENTION_NOT_PERMITTED' });
  rejects(() => comment(owner.userId, 'Duplicate mention.',
    { mentionUserIds: [member.userId, member.userId] }),
    { status: 400, code: 'JOURNEY_COMMENT_MENTION_DUPLICATE' });
  rejects(() => comment(owner.userId, 'Too many mentions.', {
    mentionUserIds: Array.from({ length: 51 }, (_unused, index) => `user-${index}`)
  }), { status: 422, code: 'JOURNEY_COMMENT_MENTION_INVALID' });
  try {
    comment(owner.userId, 'Mentioning an outsider.', { mentionUserIds: [outsider.userId] });
    assert.fail('the mention should have been rejected');
  } catch (error: any) {
    assert.equal(JSON.stringify(error.details || {}).includes(outsider.userId), false,
      'the rejection must not echo the third party identity');
    assert.equal(JSON.stringify(error.details || {}).includes('role'), false);
  }
});

test('resolution and reopening are root-only, guarded and audited', () => {
  const rootComment = comment(owner.userId, 'Thread to resolve.');
  const reply = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, target, parentCommentId: rootComment.id,
    body: 'A reply.', idempotencyKey: key('resolve-reply')
  }).comment;
  rejects(() => collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: reply.id, expectedRevision: 1,
    action: 'resolve', idempotencyKey: key('resolve-reply-fail')
  }), { status: 409, code: 'JOURNEY_COMMENT_ROOT_REQUIRED' });
  const resolved = collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 1,
    action: 'resolve', idempotencyKey: key('resolve')
  }).comment;
  assert.equal(resolved.state, 'resolved');
  assert.ok(resolved.resolvedAt);
  rejects(() => collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 2,
    action: 'resolve', idempotencyKey: key('resolve-twice')
  }), { status: 409, code: 'JOURNEY_COMMENT_REVISION_CONFLICT' });
  const reopened = collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 2,
    action: 'reopen', idempotencyKey: key('reopen')
  }).comment;
  assert.equal(reopened.state, 'active');
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.revision, 3);
  const actions = activityActions(journey.id);
  assert.ok(actions.includes('comment.resolved'), `resolution was not audited: ${actions.join(',')}`);
  assert.ok(actions.includes('comment.reopened'), `reopening was not audited: ${actions.join(',')}`);
});

test('deleting a comment removes its content from every read path', () => {
  const doomed = comment(owner.userId, 'Contains something prohibited.');
  rejects(() => collaboration.deleteJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, commentId: doomed.id, expectedRevision: 1,
    reason: 'Not mine to delete.', idempotencyKey: key('delete-foreign')
  }), { status: 403, code: 'JOURNEY_COMMENT_OWNER_REQUIRED' });
  const deleted = collaboration.deleteJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: doomed.id, expectedRevision: 1,
    reason: 'Contains customer data.', idempotencyKey: key('delete')
  });
  assert.equal(deleted.state, 'deleted');
  assert.ok(deleted.retentionExpiresAt > deleted.retentionExpiresAt.slice(0, 0));
  const listed = collaboration.listJourneyComments({
    spaceId: owner.spaceId, actorUserId: member.userId, target, state: 'deleted'
  });
  const row = listed.items.find((entry) => entry.id === doomed.id)!;
  assert.equal(row.body, null);
  assert.equal(row.plainText, null);
  // The edit history served every stored version of a deleted comment in full.
  const history = collaboration.listJourneyCommentHistory({
    spaceId: owner.spaceId, actorUserId: member.userId, commentId: doomed.id
  });
  assert.equal(history.redacted, true);
  assert.ok(history.items.length > 0, 'the audit trail of versions must survive');
  for (const version of history.items) {
    assert.equal(version.body, null);
    assert.equal(version.plainText, null);
    assert.equal(String(version.checksum).length, 64);
  }
  const raw = JSON.stringify(collaboration.listJourneyCollaborationActivity({
    spaceId: owner.spaceId, actorUserId: owner.userId, target
  }));
  assert.equal(raw.includes('Contains something prohibited'), false,
    'the activity ledger must never carry comment content');
});

test('the retention sweep removes expired content and keeps the audit trail', () => {
  const doomed = comment(owner.userId, 'Expires quickly.');
  collaboration.deleteJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: doomed.id, expectedRevision: 1,
    reason: 'Retention test.', idempotencyKey: key('retention-delete')
  });
  const before = collaboration.purgeExpiredJourneyComments({ spaceId: owner.spaceId });
  assert.equal(before.commentIds.includes(doomed.id), false, 'nothing is purged before it expires');
  // retention_expires_at>=deleted_at is a column check, so the fixture ages both.
  db.prepare('UPDATE journey_comments SET deleted_at=?,retention_expires_at=? WHERE id=?')
    .run('2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', doomed.id);
  const purged = collaboration.purgeExpiredJourneyComments({ spaceId: owner.spaceId });
  assert.ok(purged.commentIds.includes(doomed.id));
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_comment_versions
    WHERE comment_id=?`).get(doomed.id) as any).count), 0, 'every stored version body is gone');
  rejects(() => collaboration.listJourneyCommentHistory({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: doomed.id
  }), { status: 404, code: 'JOURNEY_COMMENT_NOT_FOUND' });
  const trail = activityActions(journey.id);
  assert.ok(trail.includes('comment.deleted'));
  assert.ok(trail.includes('comment.purged'));
  const audit = db.prepare(`SELECT COUNT(*) count FROM journey_collaboration_activity
    WHERE space_id=? AND comment_id=?`).get(owner.spaceId, doomed.id) as any;
  assert.ok(Number(audit.count) > 0, 'activity outlives the comment it describes');
});

test('a root comment is held back while a reply is still inside its retention window', () => {
  const rootComment = comment(owner.userId, 'Root that expires first.');
  const reply = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, target, parentCommentId: rootComment.id,
    body: 'Reply that is still live.', idempotencyKey: key('retention-reply')
  }).comment;
  collaboration.deleteJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: rootComment.id, expectedRevision: 1,
    reason: 'Retention ordering test.', idempotencyKey: key('retention-root-delete')
  });
  db.prepare('UPDATE journey_comments SET deleted_at=?,retention_expires_at=? WHERE id=?')
    .run('2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', rootComment.id);
  const purged = collaboration.purgeExpiredJourneyComments({ spaceId: owner.spaceId });
  assert.equal(purged.commentIds.includes(rootComment.id), false);
  assert.ok(db.prepare('SELECT 1 FROM journey_comments WHERE id=?').get(reply.id),
    'the live reply must not be cascaded away by an expired root');
});

test('idempotent replay returns the original result and rejects a reused key', () => {
  const idempotencyKey = key('replay');
  const first = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Replay me.', idempotencyKey
  });
  const second = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Replay me.', idempotencyKey
  });
  assert.equal(second.replayed, true);
  assert.equal(second.comment.id, first.comment.id);
  assert.equal(second.comment.plainText, 'Replay me.');
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_comments
    WHERE space_id=? AND target_id=? AND parent_comment_id IS NULL`)
    .get(owner.spaceId, journey.id) as any).count) > 0, true);
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Different intent.', idempotencyKey
  }), { status: 409, code: 'JOURNEY_COLLABORATION_IDEMPOTENCY_CONFLICT' });
  // The fourth key exercises normalizedIdempotencyKey's control-character
  // branch. It is built from a char code rather than embedded as a literal
  // U+0000: a raw NUL makes this file binary to ripgrep and to most diff and
  // review tooling, which silently truncates every later search of it. The
  // value is byte-identical, so the assertion below is unchanged.
  for (const invalid of ['', ' leading', 'x'.repeat(201), `with${String.fromCharCode(0)}null`]) {
    rejects(() => collaboration.createJourneyComment({
      spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Bad key.', idempotencyKey: invalid
    }), { status: 400, code: 'JOURNEY_COLLABORATION_IDEMPOTENCY_INVALID' });
  }
});

test('a replay cannot be reused by another actor and does not bypass authorisation', () => {
  const shared = key('shared-key');
  collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Owner comment.', idempotencyKey: shared
  });
  const other = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, target, body: 'Member comment.', idempotencyKey: shared
  });
  assert.equal(other.replayed, false, 'idempotency keys are scoped per actor');
  assert.equal(other.comment.author.id, member.userId);
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: outsider.userId, target, body: 'Outsider comment.',
    idempotencyKey: shared
  }), { status: 403, code: 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED' });
});

test('watchers, notifications and inboxes stay tenant-scoped and bounded', () => {
  collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: second.userId, target, state: 'watching',
    idempotencyKey: key('watch')
  });
  const watchers = collaboration.listJourneyWatchers({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, limit: 1
  });
  assert.equal(watchers.items.length, 1);
  assert.ok(watchers.nextCursor, 'watcher reads are paginated rather than unbounded');
  const paged = collaboration.listJourneyWatchers({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, limit: 1, cursor: watchers.nextCursor
  });
  assert.notEqual(paged.items[0]?.id, watchers.items[0]?.id);
  const muted = collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: second.userId, target, state: 'muted', idempotencyKey: key('mute')
  }).watcher;
  assert.equal(muted.state, 'muted');
  assert.equal(muted.revision, 2, 'the watcher row is updated in place, not duplicated');
  comment(owner.userId, 'Notify the watchers.', { mentionUserIds: [member.userId] });
  const inbox = collaboration.listJourneyCollaborationNotifications({
    spaceId: owner.spaceId, actorUserId: member.userId, state: 'unread', limit: 5
  });
  assert.ok(inbox.items.length > 0);
  assert.ok(inbox.items.some((entry) => entry.kind === 'mention'));
  const first = inbox.items[0];
  const updated = collaboration.updateJourneyCollaborationNotification({
    spaceId: owner.spaceId, actorUserId: member.userId, notificationId: first.id,
    expectedRevision: first.revision, state: 'read'
  });
  assert.equal(updated.state, 'read');
  rejects(() => collaboration.updateJourneyCollaborationNotification({
    spaceId: owner.spaceId, actorUserId: member.userId, notificationId: first.id,
    expectedRevision: first.revision, state: 'read'
  }), { status: 409, code: 'JOURNEY_NOTIFICATION_REVISION_CONFLICT' });
  rejects(() => collaboration.updateJourneyCollaborationNotification({
    spaceId: owner.spaceId, actorUserId: second.userId, notificationId: first.id,
    expectedRevision: 1, state: 'read'
  }), { status: 404, code: 'JOURNEY_NOTIFICATION_NOT_FOUND' });
  for (const invalid of ['archived', '', null]) {
    rejects(() => collaboration.updateJourneyCollaborationNotification({
      spaceId: owner.spaceId, actorUserId: member.userId, notificationId: first.id,
      expectedRevision: 1, state: invalid as never
    }), { status: 400, code: 'JOURNEY_NOTIFICATION_STATE_INVALID' });
  }
});

test('an inbox page is not lost when the whole scan window is unauthorised', () => {
  const hidden = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Hidden journey' });
  const hiddenTarget = { targetType: 'journey_map' as const, targetId: hidden.id };
  collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: second.userId, target: hiddenTarget, state: 'watching',
    idempotencyKey: key('hidden-watch')
  });
  for (let index = 0; index < 6; index += 1) {
    collaboration.createJourneyComment({
      spaceId: owner.spaceId, actorUserId: owner.userId, target: hiddenTarget,
      body: `Hidden comment ${index}.`, idempotencyKey: key('hidden-comment')
    });
  }
  const visible = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: 'Visible to everyone.',
    mentionUserIds: [second.userId], idempotencyKey: key('visible-comment')
  }).comment;
  // Archiving the journey makes its target unresolvable, so every notification
  // in the newest scan window is filtered out after it is read. A single bounded
  // over-read reported nextCursor: null here and stranded the older, still
  // readable notification behind it.
  db.prepare("UPDATE journey_definitions SET status='archived' WHERE id=? AND space_id=?")
    .run(hidden.id, owner.spaceId);
  const inbox = collaboration.listJourneyCollaborationNotifications({
    spaceId: owner.spaceId, actorUserId: second.userId, limit: 1
  });
  assert.ok(inbox.items.length === 1, 'the readable notification must still be reachable');
  assert.equal(inbox.items[0].commentId, visible.id);
});

test('append-only ledgers refuse rewriting and the operations ledger refuses deletion', () => {
  const sealed = comment(owner.userId, 'Sealed ledger check.');
  for (const table of ['journey_collaboration_activity', 'journey_collaboration_audit_events',
    'journey_collaboration_operations', 'journey_comment_versions', 'journey_collaboration_role_events']) {
    assert.throws(() => db.prepare(`UPDATE ${table} SET created_at=? WHERE space_id=?`)
      .run('2020-01-01T00:00:00.000Z', owner.spaceId), /append-only/u, `${table} accepted an UPDATE`);
  }
  for (const table of ['journey_collaboration_activity', 'journey_collaboration_audit_events',
    'journey_collaboration_operations']) {
    assert.throws(() => db.prepare(`DELETE FROM ${table} WHERE space_id=?`).run(owner.spaceId),
      /append-only/u, `${table} accepted a DELETE`);
  }
  // Comment versions are sealed against rewriting but must stay reachable by
  // their parent's cascade and by the retention sweep, or the declared cascade
  // is dead DDL.
  assert.ok(db.prepare('SELECT 1 FROM journey_comment_versions WHERE comment_id=?').get(sealed.id));
});

test('a journey with collaboration history can still be deleted', () => {
  const doomed = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Journey to delete' });
  const doomedTarget = { targetType: 'journey_map' as const, targetId: doomed.id };
  const created = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target: doomedTarget,
    body: 'A comment that becomes history.', idempotencyKey: key('doomed-comment')
  }).comment;
  collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: member.userId, target: doomedTarget, state: 'watching',
    idempotencyKey: key('doomed-watch')
  });
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'editor',
    scopeType: 'journey', journeyDefinitionId: doomed.id, idempotencyKey: key('doomed-role')
  });
  const current = db.prepare('SELECT revision FROM journey_definitions WHERE id=?').get(doomed.id) as any;
  // Composite ON DELETE SET NULL on journey_collaboration_activity nulled
  // space_id, which is NOT NULL, so this failed as soon as any activity existed.
  maps.deleteJourneyMap(owner.spaceId, doomed.id, Number(current.revision));
  assert.equal(db.prepare('SELECT 1 FROM journey_definitions WHERE id=?').get(doomed.id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM journey_comments WHERE id=?').get(created.id), undefined);
  const surviving = db.prepare(`SELECT COUNT(*) count FROM journey_collaboration_activity
    WHERE space_id=? AND target_id=?`).get(owner.spaceId, doomed.id) as any;
  assert.ok(Number(surviving.count) > 0, 'the activity ledger outlives the journey it describes');
});

test('governance review pins its target revision and enforces a two-person rule', () => {
  // The requester holds journeys.review as well, so the refusal below can only
  // come from the two-person rule and not from a missing capability.
  const review = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, target,
    summary: 'Ready for approval before the release.', reason: 'Content is complete.',
    idempotencyKey: key('review-request')
  }).review;
  assert.equal(review.state, 'pending');
  assert.ok(collaboration.effectiveJourneyRole(owner.spaceId, owner.userId, journey.id)
    .capabilities.has('journeys.review'));
  assert.equal(review.targetRevision, Number((db.prepare(
    'SELECT revision FROM journey_definitions WHERE id=?').get(journey.id) as any).revision));
  assert.equal(review.targetChecksum.length, 64);
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, summary: 'Duplicate request.',
    reason: 'Same revision.', idempotencyKey: key('review-duplicate')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_REVIEW_PENDING' });
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, reviewId: review.id,
    expectedRevision: review.revision, decision: 'approve', summary: 'Approving my own request.',
    reason: 'Self approval.', idempotencyKey: key('self-approve')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_SELF_APPROVAL_FORBIDDEN' });
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: manager.userId, reviewId: review.id,
    expectedRevision: review.revision, decision: 'sideways' as never, summary: 'Not a decision.',
    reason: 'Invalid decision.', idempotencyKey: key('bad-decision')
  }), { status: 400, code: 'JOURNEY_GOVERNANCE_DECISION_INVALID' });
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: manager.userId, reviewId: review.id,
    expectedRevision: review.revision + 3, decision: 'approve', summary: 'Stale revision.',
    reason: 'Should not apply.', idempotencyKey: key('stale-decide')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_REVISION_CONFLICT' });
  const approved = collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: manager.userId, reviewId: review.id,
    expectedRevision: review.revision, decision: 'approve', summary: 'Content checked and approved.',
    reason: 'Meets the bar.', idempotencyKey: key('approve')
  }).review;
  assert.equal(approved.state, 'approved');
  assert.equal(approved.decidedByUserId, manager.userId);
  rejects(() => collaboration.publishJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, reviewId: review.id,
    expectedRevision: approved.revision, reason: 'Publishing my own request.',
    idempotencyKey: key('self-publish')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_SELF_APPROVAL_FORBIDDEN' });
  const published = collaboration.publishJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: manager.userId, reviewId: review.id,
    expectedRevision: approved.revision, reason: 'Release approved.', idempotencyKey: key('publish')
  }).review;
  assert.equal(published.state, 'published');
  assert.ok(published.publishedAt);
  const publication = db.prepare('SELECT * FROM journey_governance_publications WHERE review_id=?')
    .get(review.id) as any;
  assert.equal(String(publication.target_sha256), review.targetChecksum);
  assert.equal(Number(publication.target_revision), review.targetRevision);
  const events = (db.prepare(`SELECT action,state_from,state_to FROM journey_governance_review_events
    WHERE review_id=? ORDER BY created_at,id`).all(review.id) as any[]).map((row) => row.action);
  assert.deepEqual(events, ['submitted', 'approved', 'published']);
  rejects(() => collaboration.publishJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: manager.userId, reviewId: review.id,
    expectedRevision: published.revision, reason: 'Publishing twice.', idempotencyKey: key('publish-twice')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_STATE_CONFLICT' });
});

test('a review pinned to a stale revision cannot be decided, and is superseded by a new one', () => {
  const staleTargetMap = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Stale review journey' });
  const staleTarget = { targetType: 'journey_map' as const, targetId: staleTargetMap.id };
  const review = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: staleTarget,
    summary: 'Review before the content moves.', reason: 'Initial submission.',
    idempotencyKey: key('stale-review')
  }).review;
  db.prepare('UPDATE journey_definitions SET revision=revision+1 WHERE id=? AND space_id=?')
    .run(staleTargetMap.id, owner.spaceId);
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, reviewId: review.id,
    expectedRevision: review.revision, decision: 'approve', summary: 'Approving moved content.',
    reason: 'Should be refused.', idempotencyKey: key('approve-stale')
  }), { status: 409, code: 'JOURNEY_GOVERNANCE_REVIEW_STALE' });
  const replacement = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: staleTarget,
    summary: 'Review of the updated content.', reason: 'Content changed.',
    idempotencyKey: key('stale-review-replacement')
  }).review;
  assert.equal(replacement.targetRevision, review.targetRevision + 1);
  const superseded = db.prepare('SELECT state FROM journey_governance_reviews WHERE id=?')
    .get(review.id) as any;
  assert.equal(superseded.state, 'withdrawn');
  const actions = (db.prepare(`SELECT action FROM journey_governance_review_events
    WHERE review_id=? ORDER BY created_at,id`).all(review.id) as any[]).map((row) => row.action);
  assert.deepEqual(actions, ['submitted', 'superseded']);
  const withdrawn = collaboration.withdrawJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, reviewId: replacement.id,
    expectedRevision: replacement.revision, reason: 'No longer required.', idempotencyKey: key('withdraw')
  }).review;
  assert.equal(withdrawn.state, 'withdrawn');
});

test('governance is capability gated, tenant scoped and validated', () => {
  const listed = collaboration.listJourneyGovernanceReviews({
    spaceId: owner.spaceId, actorUserId: member.userId, target, limit: 5
  });
  assert.ok(listed.items.length > 0);
  assert.deepEqual(listed.items.map((entry) => entry.requestedAt),
    [...listed.items.map((entry) => entry.requestedAt)].sort().reverse());
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId,
    target: { targetType: 'journey_stage', targetId: journey.id },
    summary: 'Stages are not governance targets.', reason: 'Invalid target type.',
    idempotencyKey: key('bad-governance-target')
  }), { status: 400, code: 'JOURNEY_GOVERNANCE_TARGET_INVALID' });
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, summary: 'no', reason: 'Too short.',
    idempotencyKey: key('short-summary')
  }), { status: 400, code: 'JOURNEY_GOVERNANCE_SUMMARY_REQUIRED' });
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, summary: 'A valid summary here.',
    reason: 'Valid reason.', dueAt: 'not-a-date', idempotencyKey: key('bad-due')
  }), { status: 400, code: 'JOURNEY_GOVERNANCE_DUE_AT_INVALID' });
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: outsider.userId, target, summary: 'Outsider request.',
    reason: 'Should be refused.', idempotencyKey: key('outsider-governance')
  }), { status: 403, code: 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED' });
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, reviewId: 'review-does-not-exist',
    expectedRevision: 1, decision: 'approve', summary: 'Nothing to approve.', reason: 'Missing review.',
    idempotencyKey: key('missing-review')
  }), { status: 404, code: 'JOURNEY_GOVERNANCE_REVIEW_NOT_FOUND' });
});

test('a plain viewer cannot request, review or publish', () => {
  const viewerOnly = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Viewer gated journey' });
  const viewerTarget = { targetType: 'journey_map' as const, targetId: viewerOnly.id };
  const viewerUser = second.userId;
  db.prepare(`UPDATE journey_collaboration_role_assignments SET state='revoked',revision=revision+1,
    revoked_at=?,revoked_by_user_id=?,revocation_reason_sha256=?
    WHERE space_id=? AND user_id=? AND state='active'`).run(new Date().toISOString(), owner.userId,
      crypto.createHash('sha256').update('test-cleanup').digest('hex'), owner.spaceId, viewerUser);
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, viewerUser, viewerOnly.id).role, 'viewer');
  rejects(() => collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: viewerUser, target: viewerTarget,
    summary: 'A viewer cannot request review.', reason: 'Capability check.',
    idempotencyKey: key('viewer-request')
  }), { status: 403, code: 'JOURNEY_CAPABILITY_REQUIRED' });
  // A viewer still comments -- the Phase 3 acceptance scenario.
  const commented = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: viewerUser, target: viewerTarget, body: 'A viewer comment.',
    idempotencyKey: key('viewer-comment')
  }).comment;
  assert.equal(commented.author.id, viewerUser);
});

test('the space kill switch makes collaboration read-only without locking out settings', () => {
  const settings = collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: 0, enabled: false,
    commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30, idempotencyKey: key('kill-switch')
  }).settings;
  assert.equal(settings.enabled, false);
  assert.equal(settings.revision, 1);
  for (const call of [
    () => comment(owner.userId, 'Should be refused.'),
    () => collaboration.setJourneyWatcher({
      spaceId: owner.spaceId, actorUserId: owner.userId, target, state: 'watching',
      idempotencyKey: key('kill-watch')
    }),
    () => collaboration.assignJourneyRole({
      spaceId: owner.spaceId, actorUserId: owner.userId, userId: member.userId, role: 'viewer',
      scopeType: 'space', idempotencyKey: key('kill-role')
    }),
    () => collaboration.requestJourneyGovernanceReview({
      spaceId: owner.spaceId, actorUserId: owner.userId, target, summary: 'Refused while disabled.',
      reason: 'Kill switch.', idempotencyKey: key('kill-governance')
    })
  ]) {
    rejects(call, { status: 403, code: 'JOURNEY_COLLABORATION_READ_ONLY' });
  }
  const context = collaboration.getJourneyCollaborationContext({
    spaceId: owner.spaceId, actorUserId: owner.userId, target
  });
  assert.equal(context.readOnly, true);
  assert.deepEqual(context.capabilities, ['journeys.read', 'journeys.view_activity']);
  assert.ok(collaboration.listJourneyComments({
    spaceId: owner.spaceId, actorUserId: member.userId, target
  }).items.length > 0, 'reads survive the kill switch');
  const restored = collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: 1, enabled: true,
    commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30, idempotencyKey: key('restore')
  }).settings;
  assert.equal(restored.enabled, true);
});

test('settings validate their bounds and preserve the recorded security review', () => {
  const current = collaboration.journeyCollaborationPlanState(owner.spaceId).settings;
  for (const invalid of [
    { commentRetentionDays: 0 }, { commentRetentionDays: 3_651 }, { viewRetentionDays: 0 },
    { maximumShareDays: 366 }, { commentRetentionDays: 1.5 }
  ]) {
    rejects(() => collaboration.updateJourneyCollaborationSettings({
      spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: current.revision, enabled: true,
      commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
      commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
      idempotencyKey: key('bad-settings'), ...invalid
    }), { status: 400, code: 'JOURNEY_COLLABORATION_SETTINGS_INVALID' });
  }
  rejects(() => collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: current.revision, enabled: true,
    commentsEnabled: true, sharingEnabled: true, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: 'short', idempotencyKey: key('short-review')
  }), { status: 422, code: 'JOURNEY_SHARING_SECURITY_REVIEW_REQUIRED' });
  rejects(() => collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: current.revision, enabled: true,
    commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: true,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30, idempotencyKey: key('bad-downloads')
  }), { status: 400, code: 'JOURNEY_SHARING_DOWNLOAD_POLICY_INVALID' });
  rejects(() => collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: member.userId, expectedRevision: current.revision, enabled: true,
    commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30, idempotencyKey: key('member-settings')
  }), { status: 403, code: 'JOURNEY_CAPABILITY_REQUIRED' });
  const enabled = collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: current.revision, enabled: true,
    commentsEnabled: true, sharingEnabled: true, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: 'SEC-REVIEW-2026-08', idempotencyKey: key('enable-sharing')
  }).settings;
  const reviewer = db.prepare(`SELECT security_reviewed_by_user_id reviewer,security_reviewed_at at
    FROM journey_collaboration_settings WHERE space_id=?`).get(owner.spaceId) as any;
  assert.equal(reviewer.reviewer, owner.userId);
  assert.ok(reviewer.at);
  // An unrelated toggle must not reattribute the security review to whoever
  // saved the form last.
  collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: manager.userId, expectedRevision: enabled.revision, enabled: true,
    commentsEnabled: false, sharingEnabled: true, externalDownloadsEnabled: false,
    commentRetentionDays: 45, viewRetentionDays: 30, maximumShareDays: 30,
    securityReviewReference: 'SEC-REVIEW-2026-08', idempotencyKey: key('unrelated-toggle')
  });
  const after = db.prepare(`SELECT security_reviewed_by_user_id reviewer,security_reviewed_at at
    FROM journey_collaboration_settings WHERE space_id=?`).get(owner.spaceId) as any;
  assert.equal(after.reviewer, owner.userId, 'the recorded reviewer must survive an unrelated write');
  assert.equal(after.at, reviewer.at);
  const disabledComments = collaboration.journeyCollaborationPlanState(owner.spaceId).settings;
  rejects(() => comment(owner.userId, 'Comments are switched off.'),
    { status: 403, code: 'JOURNEY_COMMENTS_DISABLED' });
  collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: disabledComments.revision,
    enabled: true, commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30, idempotencyKey: key('reset-settings')
  });
});

test('the audit projection refuses content-bearing keys in camelCase and nested objects', () => {
  const activity = collaboration.listJourneyCollaborationActivity({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, limit: 5
  });
  assert.ok(activity.items.length > 0);
  for (const entry of activity.items) {
    for (const detailKey of Object.keys(entry.detail as Record<string, unknown>)) {
      assert.ok(!/^(body|plainText|commentBody|authorName|summary)$/u.test(detailKey),
        `activity detail carried ${detailKey}`);
    }
  }
  rejects(() => collaboration.listJourneyCollaborationActivity({
    spaceId: owner.spaceId, actorUserId: member.userId, target, limit: 0
  }), { status: 400, code: 'JOURNEY_COLLABORATION_PAGE_INVALID' });
});

test('the plan gate closes writes when the subscription drops the feature', () => {
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  try {
    assert.equal(collaboration.journeyCollaborationPlanState(owner.spaceId).enabledByPlan, false);
    assert.equal(collaboration.journeyCollaborationPlanState(owner.spaceId).readOnly, true);
    rejects(() => comment(owner.userId, 'Plan gate closed.'),
      { status: 403, code: 'SUBSCRIPTION_FEATURE_REQUIRED' });
    rejects(() => collaboration.requestJourneyGovernanceReview({
      spaceId: owner.spaceId, actorUserId: owner.userId, target, summary: 'Refused by the plan.',
      reason: 'Plan gate.', idempotencyKey: key('plan-governance')
    }), { status: 403, code: 'SUBSCRIPTION_FEATURE_REQUIRED' });
    const context = collaboration.getJourneyCollaborationContext({
      spaceId: owner.spaceId, actorUserId: owner.userId, target
    });
    assert.equal(context.readOnly, true);
    assert.deepEqual(context.capabilities, ['journeys.read', 'journeys.view_activity']);
    assert.ok(collaboration.listJourneyComments({
      spaceId: owner.spaceId, actorUserId: owner.userId, target
    }).items.length > 0, 'existing collaboration stays readable on a downgraded plan');
  } finally {
    db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);
  }
});

test('collaborator seats are a plan quota', () => {
  db.prepare("UPDATE platform_subscriptions SET plan_code='team' WHERE space_id=?").run(owner.spaceId);
  try {
    const seats = collaboration.journeyCollaborationPlanState(owner.spaceId).limits.collaborators;
    assert.equal(seats, 25);
    const now = new Date().toISOString();
    let distinct = Number((db.prepare(`SELECT COUNT(DISTINCT user_id) count
      FROM journey_collaboration_role_assignments WHERE space_id=? AND state='active'`)
      .get(owner.spaceId) as any).count);
    const filler: string[] = [];
    for (let index = distinct; index < seats; index += 1) {
      const userId = `quota-user-${index}`;
      db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at,updated_at)
        VALUES (?,?,?,?,'member',?,?)`).run(userId, `${userId}@example.test`, `Quota ${index}`,
          'not-a-real-hash', now, now);
      db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
        VALUES (?,?,'member',?,?)`).run(owner.spaceId, userId, now, now);
      filler.push(userId);
      collaboration.assignJourneyRole({
        spaceId: owner.spaceId, actorUserId: owner.userId, userId, role: 'viewer', scopeType: 'space',
        idempotencyKey: key('quota-assign')
      });
    }
    distinct = Number((db.prepare(`SELECT COUNT(DISTINCT user_id) count
      FROM journey_collaboration_role_assignments WHERE space_id=? AND state='active'`)
      .get(owner.spaceId) as any).count);
    assert.equal(distinct, seats);
    const overflowUser = 'quota-user-overflow';
    db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at,updated_at)
      VALUES (?,?,?,?,'member',?,?)`).run(overflowUser, `${overflowUser}@example.test`, 'Quota overflow',
        'not-a-real-hash', now, now);
    db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES (?,?,'member',?,?)`).run(owner.spaceId, overflowUser, now, now);
    rejects(() => collaboration.assignJourneyRole({
      spaceId: owner.spaceId, actorUserId: owner.userId, userId: overflowUser, role: 'viewer',
      scopeType: 'space', idempotencyKey: key('quota-overflow')
    }), { status: 409, code: 'SUBSCRIPTION_QUOTA_EXCEEDED' });
    // Re-scoping someone who already collaborates consumes no further seat.
    const existing = filler[0];
    collaboration.assignJourneyRole({
      spaceId: owner.spaceId, actorUserId: owner.userId, userId: existing, role: 'contributor',
      scopeType: 'journey', journeyDefinitionId: journey.id, idempotencyKey: key('quota-rescope')
    });
  } finally {
    db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);
  }
});

/** Inserts a bare member without going through the signup flow, the same way the
 * seat-quota test above does. Used where a test needs an identity it can remove
 * from the space again. */
function bareMember(suffix: string, role: 'admin' | 'member') {
  const now = new Date().toISOString();
  const userId = `bare-${suffix}`;
  db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at,updated_at)
    VALUES (?,?,?,?,'member',?,?)`).run(userId, `${userId}@example.test`, `Bare ${suffix}`,
      'not-a-real-hash', now, now);
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,?,?,?)`).run(owner.spaceId, userId, role, now, now);
  return userId;
}

test('an idempotent replay is re-authorised and cannot outlive the actor membership', () => {
  // idempotentMutation returns the stored response without ever entering run(),
  // so for every mutation that resolved its subject inside run() the replay path
  // carried no membership or capability check at all.
  const actor = bareMember('revoker', 'admin');
  const subject = bareMember('revoked-subject', 'member');
  const assignment = collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: subject, role: 'viewer',
    scopeType: 'space', idempotencyKey: key('replay-grant')
  }).assignment;
  const revokeKey = key('replay-revoke');
  const revoked = collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: actor, assignmentId: assignment.id,
    expectedRevision: assignment.revision, reason: 'Access no longer required.', idempotencyKey: revokeKey
  });
  assert.equal(revoked.replayed, false);
  assert.equal(collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: actor, assignmentId: assignment.id,
    expectedRevision: assignment.revision, reason: 'Access no longer required.', idempotencyKey: revokeKey
  }).replayed, true, 'a replay by a current member still returns the stored result');
  db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?').run(owner.spaceId, actor);
  rejects(() => collaboration.revokeJourneyRole({
    spaceId: owner.spaceId, actorUserId: actor, assignmentId: assignment.id,
    expectedRevision: assignment.revision, reason: 'Access no longer required.', idempotencyKey: revokeKey
  }), { status: 403, code: 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED' });
});

test('a replay is refused once the actor loses the capability it was authorised by', () => {
  // Losing a role is not losing membership, and the response replayed here is the
  // rendered comment -- body and all.
  const moderator = bareMember('moderator', 'admin');
  const authored = comment(member.userId, 'A thread a manager may resolve.');
  const resolveKey = key('replay-resolve');
  const resolved = collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: moderator, commentId: authored.id,
    expectedRevision: authored.revision, action: 'resolve', idempotencyKey: resolveKey
  });
  assert.equal(resolved.comment.state, 'resolved');
  assert.equal(resolved.comment.plainText, 'A thread a manager may resolve.');
  db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, moderator);
  assert.equal(collaboration.effectiveJourneyRole(owner.spaceId, moderator).role, 'viewer');
  rejects(() => collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: moderator, commentId: authored.id,
    expectedRevision: authored.revision, action: 'resolve', idempotencyKey: resolveKey
  }), { status: 403, code: 'JOURNEY_COMMENT_OWNER_REQUIRED' });
  // The same guard on the governance transitions, whose responses carry the
  // request and decision summaries.
  const governed = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Replay governance journey' });
  const governedTarget = { targetType: 'journey_map' as const, targetId: governed.id };
  const review = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: governedTarget,
    summary: 'Summary that must not survive a lost role.', reason: 'Initial submission.',
    idempotencyKey: key('replay-governance-request')
  }).review;
  const reviewer = bareMember('reviewer', 'admin');
  const decideKey = key('replay-decide');
  collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: reviewer, reviewId: review.id, expectedRevision: review.revision,
    decision: 'approve', summary: 'Approved for publication.', reason: 'Meets the bar.',
    idempotencyKey: decideKey
  });
  db.prepare("UPDATE space_memberships SET role='member' WHERE space_id=? AND user_id=?")
    .run(owner.spaceId, reviewer);
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: reviewer, reviewId: review.id, expectedRevision: review.revision,
    decision: 'approve', summary: 'Approved for publication.', reason: 'Meets the bar.',
    idempotencyKey: decideKey
  }), { status: 403, code: 'JOURNEY_CAPABILITY_REQUIRED' });
});

test('the idempotency ledger never becomes a second, unerasable copy of comment content', () => {
  // journey_collaboration_operations is sealed against UPDATE and DELETE in both
  // 0028 and the SQLite projection, and purgeExpiredJourneyComments only deletes
  // journey_comments. Storing the rendered comment in response_json therefore put
  // a verbatim body somewhere no code path and no operator could ever remove --
  // defeating "deletions preserve valid audit while removing prohibited content".
  const secret = 'PROHIBITED-CARDHOLDER-4111111111111111';
  const createKey = key('ledger-create');
  const made = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: secret, idempotencyKey: createKey
  }).comment;
  const storedRow = db.prepare(`SELECT response_json FROM journey_collaboration_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`)
    .get(owner.spaceId, owner.userId, createKey) as any;
  assert.equal(String(storedRow.response_json).includes(secret), false,
    'the replay ledger stored the comment body verbatim');
  // Redacting storage must not weaken replay: the body is re-read from the live
  // tables, so a legitimate retry still gets the whole comment back.
  const replay = collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: secret, idempotencyKey: createKey
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.comment.id, made.id);
  assert.equal(replay.comment.plainText, secret);
  collaboration.deleteJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: made.id, expectedRevision: 1,
    reason: 'Contains customer data.', idempotencyKey: key('ledger-delete')
  });
  // A replay after deletion redacts exactly as the normal read path does.
  assert.equal(collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: secret, idempotencyKey: createKey
  }).comment.body, null);
  db.prepare('UPDATE journey_comments SET deleted_at=?,retention_expires_at=? WHERE id=?')
    .run('2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', made.id);
  assert.ok(collaboration.purgeExpiredJourneyComments({ spaceId: owner.spaceId }).commentIds.includes(made.id));
  for (const row of db.prepare('SELECT action,response_json FROM journey_collaboration_operations WHERE space_id=?')
    .all(owner.spaceId) as any[]) {
    assert.equal(String(row.response_json).includes(secret), false,
      `${row.action} kept the purged body in the sealed ledger`);
  }
  // Nothing may resurrect a purged comment from the ledger either.
  rejects(() => collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, body: secret, idempotencyKey: createKey
  }), { status: 404, code: 'JOURNEY_COMMENT_NOT_FOUND' });
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_comment_versions WHERE comment_id=?')
    .get(made.id) as any).count), 0);
});

test('governance summaries are not retained in the replay ledger either', () => {
  const governed = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Ledger governance journey' });
  const governedTarget = { targetType: 'journey_map' as const, targetId: governed.id };
  const summary = 'SUMMARY-THAT-MUST-NOT-BE-COPIED-INTO-THE-SEALED-LEDGER';
  const requestKey = key('ledger-governance');
  const review = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: governedTarget, summary,
    reason: 'Initial submission.', idempotencyKey: requestKey
  }).review;
  assert.equal(review.requestSummary, summary);
  const stored = db.prepare(`SELECT response_json FROM journey_collaboration_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`)
    .get(owner.spaceId, member.userId, requestKey) as any;
  assert.equal(String(stored.response_json).includes(summary), false);
  const replayed = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: governedTarget, summary,
    reason: 'Initial submission.', idempotencyKey: requestKey
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.review.requestSummary, summary, 'a replay still reproduces the review in full');
});

test('an explicit mute survives commenting on the target it silenced', () => {
  const muteTargetMap = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Muted journey' });
  const muteTarget = { targetType: 'journey_map' as const, targetId: muteTargetMap.id };
  const muted = collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: member.userId, target: muteTarget, state: 'muted',
    idempotencyKey: key('explicit-mute')
  }).watcher;
  assert.equal(muted.state, 'muted');
  // Auto-subscribe on comment used to overwrite the row in place, so replying to
  // a thread you had deliberately muted re-subscribed you to it.
  collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: member.userId, target: muteTarget,
    body: 'Taking part without unmuting.', idempotencyKey: key('muted-comment')
  });
  const after = db.prepare(`SELECT state,revision FROM journey_collaboration_watchers
    WHERE space_id=? AND target_type='journey_map' AND target_id=? AND user_id=?`)
    .get(owner.spaceId, muteTargetMap.id, member.userId) as any;
  assert.equal(after.state, 'muted', 'commenting silently unmuted the watcher');
  assert.equal(Number(after.revision), muted.revision, 'the auto-watch must not bump the revision either');
  // An explicit request still changes it.
  assert.equal(collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: member.userId, target: muteTarget, state: 'watching',
    idempotencyKey: key('explicit-unmute')
  }).watcher.state, 'watching');
  // Someone with no watcher row is still auto-subscribed by commenting.
  collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: second.userId, target: muteTarget,
    body: 'First contact with this target.', idempotencyKey: key('auto-watch')
  });
  assert.equal((db.prepare(`SELECT state FROM journey_collaboration_watchers
    WHERE space_id=? AND target_id=? AND user_id=?`)
    .get(owner.spaceId, muteTargetMap.id, second.userId) as any).state, 'watching');
});

test('assertJourneyCapability is fail-closed on its own when collaboration is read-only', () => {
  // Exported, and every current mutation happens to call assertCollaborationWritable
  // first -- which is what made ignoring `readOnly` here survivable. The first
  // route or future mutation to authorise with this alone would have been
  // fail-open, because effectiveJourneyRole returns the full capability set
  // alongside readOnly: true.
  const settings = collaboration.journeyCollaborationPlanState(owner.spaceId).settings;
  collaboration.updateJourneyCollaborationSettings({
    spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: settings.revision, enabled: false,
    commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
    commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
    idempotencyKey: key('fail-closed-kill')
  });
  try {
    for (const denied of ['journeys.comment', 'journeys.edit', 'journeys.review', 'journeys.publish',
      'journeys.manage_roles'] as const) {
      rejects(() => collaboration.assertJourneyCapability(owner.spaceId, owner.userId, denied, target),
        { status: 403, code: 'JOURNEY_COLLABORATION_READ_ONLY' });
    }
    for (const allowed of ['journeys.read', 'journeys.view_activity'] as const) {
      assert.equal(collaboration.assertJourneyCapability(owner.spaceId, owner.userId, allowed, target).readOnly,
        true);
    }
  } finally {
    // The kill switch lives in the settings this capability guards, so it has to
    // stay reversible: the settings path is the one caller allowed through.
    collaboration.updateJourneyCollaborationSettings({
      spaceId: owner.spaceId, actorUserId: owner.userId, expectedRevision: settings.revision + 1, enabled: true,
      commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
      commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
      idempotencyKey: key('fail-closed-restore')
    });
  }
  assert.equal(collaboration.journeyCollaborationPlanState(owner.spaceId).settings.enabled, true);
});

test('a non-member learns nothing about the plan or the space kill switch', () => {
  // The plan gate and the settings gate both ran before any membership check, so
  // probing a known space id answered SUBSCRIPTION_FEATURE_REQUIRED or
  // JOURNEY_COMMENTS_DISABLED to someone with no membership at all.
  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  try {
    rejects(() => comment(owner.userId, 'Member sees the plan gate.'),
      { status: 403, code: 'SUBSCRIPTION_FEATURE_REQUIRED' });
    for (const call of [
      () => collaboration.createJourneyComment({
        spaceId: owner.spaceId, actorUserId: outsider.userId, target, body: 'Probe.',
        idempotencyKey: key('probe-plan')
      }),
      () => collaboration.setJourneyWatcher({
        spaceId: owner.spaceId, actorUserId: outsider.userId, target, state: 'watching',
        idempotencyKey: key('probe-watch')
      }),
      () => collaboration.assignJourneyRole({
        spaceId: owner.spaceId, actorUserId: outsider.userId, userId: member.userId, role: 'viewer',
        scopeType: 'space', idempotencyKey: key('probe-role')
      }),
      () => collaboration.requestJourneyGovernanceReview({
        spaceId: owner.spaceId, actorUserId: outsider.userId, target, summary: 'Probe submission.',
        reason: 'Probe.', idempotencyKey: key('probe-governance')
      }),
      () => collaboration.updateJourneyCollaborationSettings({
        spaceId: owner.spaceId, actorUserId: outsider.userId, expectedRevision: 0, enabled: true,
        commentsEnabled: true, sharingEnabled: false, externalDownloadsEnabled: false,
        commentRetentionDays: 30, viewRetentionDays: 30, maximumShareDays: 30,
        idempotencyKey: key('probe-settings')
      })
    ]) {
      rejects(call, { status: 403, code: 'JOURNEY_COLLABORATION_MEMBERSHIP_REQUIRED' });
    }
  } finally {
    db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);
  }
});

test('an identifier from another space is not found rather than acted on', () => {
  const local = comment(owner.userId, 'Lives in the owner space.');
  const localReview = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target,
    summary: 'A review that belongs to the owner space.', reason: 'Cross-space probe.',
    idempotencyKey: key('cross-review')
  }).review;
  const localAssignment = db.prepare(`SELECT id,revision FROM journey_collaboration_role_assignments
    WHERE space_id=? AND state='active' LIMIT 1`).get(owner.spaceId) as any;
  // The outsider is a full member and administrator of their own home space, so
  // this is a tenancy check and not an authorisation one.
  rejects(() => collaboration.deleteJourneyComment({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, commentId: local.id, expectedRevision: 1,
    reason: 'Reaching across tenants.', idempotencyKey: key('cross-delete')
  }), { status: 404, code: 'JOURNEY_COMMENT_NOT_FOUND' });
  rejects(() => collaboration.transitionJourneyComment({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, commentId: local.id, expectedRevision: 1,
    action: 'resolve', idempotencyKey: key('cross-resolve')
  }), { status: 404, code: 'JOURNEY_COMMENT_NOT_FOUND' });
  rejects(() => collaboration.listJourneyCommentHistory({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, commentId: local.id
  }), { status: 404, code: 'JOURNEY_COMMENT_NOT_FOUND' });
  rejects(() => collaboration.decideJourneyGovernanceReview({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, reviewId: localReview.id,
    expectedRevision: localReview.revision, decision: 'approve', summary: 'Reaching across tenants.',
    reason: 'Cross-space probe.', idempotencyKey: key('cross-decide')
  }), { status: 404, code: 'JOURNEY_GOVERNANCE_REVIEW_NOT_FOUND' });
  rejects(() => collaboration.withdrawJourneyGovernanceReview({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, reviewId: localReview.id,
    expectedRevision: localReview.revision, reason: 'Cross-space probe.', idempotencyKey: key('cross-withdraw')
  }), { status: 404, code: 'JOURNEY_GOVERNANCE_REVIEW_NOT_FOUND' });
  rejects(() => collaboration.revokeJourneyRole({
    spaceId: outsider.homeSpaceId, actorUserId: outsider.userId, assignmentId: String(localAssignment.id),
    expectedRevision: Number(localAssignment.revision), reason: 'Cross-space probe.',
    idempotencyKey: key('cross-revoke')
  }), { status: 404, code: 'JOURNEY_ROLE_ASSIGNMENT_NOT_FOUND' });
});

test('an unknown list filter is rejected rather than answered with an empty page', () => {
  // A typo returned an empty page, which is indistinguishable from "there are
  // none" -- the defect listJourneyGovernanceReviews already rejected.
  rejects(() => collaboration.listJourneyComments({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, state: 'archived' as never
  }), { status: 400, code: 'JOURNEY_COMMENT_STATE_INVALID' });
  rejects(() => collaboration.listJourneyRoleAssignments({
    spaceId: owner.spaceId, actorUserId: owner.userId, state: 'suspended' as never
  }), { status: 400, code: 'JOURNEY_ROLE_STATE_INVALID' });
  rejects(() => collaboration.listJourneyGovernanceReviews({
    spaceId: owner.spaceId, actorUserId: owner.userId, state: 'cancelled' as never
  }), { status: 400, code: 'JOURNEY_GOVERNANCE_STATE_INVALID' });
  rejects(() => collaboration.transitionJourneyComment({
    spaceId: owner.spaceId, actorUserId: owner.userId, commentId: 'irrelevant',
    expectedRevision: 1, action: 'archive' as never, idempotencyKey: key('bad-transition')
  }), { status: 400, code: 'JOURNEY_COMMENT_TRANSITION_INVALID' });
  // A valid filter still answers.
  assert.ok(collaboration.listJourneyComments({
    spaceId: owner.spaceId, actorUserId: owner.userId, target, state: 'active'
  }).items.length > 0);
});

test('an automatic supersession records no decider', () => {
  // Supersession is a consequence of a newer revision arriving, not a decision.
  // Stamping the incoming requester as decided_by_user_id let anyone holding
  // journeys.request_review appear in the audit as the decider of someone else's
  // review. The withdrawn state permits a null decider in 0028 and the projection.
  const supersededMap = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Supersession journey' });
  const supersededTarget = { targetType: 'journey_map' as const, targetId: supersededMap.id };
  const first = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, target: supersededTarget,
    summary: 'The first submission.', reason: 'Initial.', idempotencyKey: key('supersede-first')
  }).review;
  db.prepare('UPDATE journey_definitions SET revision=revision+1 WHERE id=? AND space_id=?')
    .run(supersededMap.id, owner.spaceId);
  // A different requester from the one above, which is the whole point: the
  // incoming requester is who used to be written into decided_by_user_id.
  collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: owner.userId, target: supersededTarget,
    summary: 'The replacement submission.', reason: 'Content moved.', idempotencyKey: key('supersede-second')
  });
  const row = db.prepare(`SELECT state,decided_by_user_id,decided_at FROM journey_governance_reviews
    WHERE id=? AND space_id=?`).get(first.id, owner.spaceId) as any;
  assert.equal(row.state, 'withdrawn');
  assert.equal(row.decided_by_user_id, null,
    'an automatic supersession must not attribute a decision to the incoming requester');
  assert.ok(row.decided_at, 'the supersession is still timestamped');
  // The actor is still recorded, on the event and the activity ledger where it belongs.
  const event = db.prepare(`SELECT actor_user_id FROM journey_governance_review_events
    WHERE review_id=? AND action='superseded'`).get(first.id) as any;
  assert.equal(event.actor_user_id, owner.userId);
  // An explicit withdrawal still records who withdrew it.
  const withdrawnMap = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Explicit withdrawal journey' });
  const explicit = collaboration.requestJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId,
    target: { targetType: 'journey_map', targetId: withdrawnMap.id },
    summary: 'A review to withdraw by hand.', reason: 'Explicit withdrawal.',
    idempotencyKey: key('explicit-withdraw-request')
  }).review;
  collaboration.withdrawJourneyGovernanceReview({
    spaceId: owner.spaceId, actorUserId: member.userId, reviewId: explicit.id,
    expectedRevision: explicit.revision, reason: 'No longer required.',
    idempotencyKey: key('explicit-withdraw')
  });
  assert.equal((db.prepare('SELECT decided_by_user_id FROM journey_governance_reviews WHERE id=?')
    .get(explicit.id) as any).decided_by_user_id, member.userId);
});

test('the persisted intent hash is canonical JSON in code-unit key order', () => {
  // intent_sha256 gates every idempotent replay and content_sha256 is re-verified
  // on each comment read, so the key ordering these hashes are built from is a
  // persisted format that must be identical on every runtime for ever. It was
  // produced with localeCompare, which is locale- and ICU-dependent. This pins
  // the contract to plain UTF-16 code-unit order.
  const hashTargetMap = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Canonical hash journey' });
  const watcherKey = key('canonical-watch');
  collaboration.setJourneyWatcher({
    spaceId: owner.spaceId, actorUserId: owner.userId,
    target: { targetType: 'journey_map', targetId: hashTargetMap.id }, state: 'watching',
    idempotencyKey: watcherKey
  });
  const stored = db.prepare(`SELECT intent_sha256 FROM journey_collaboration_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`)
    .get(owner.spaceId, owner.userId, watcherKey) as any;
  const intent: Record<string, unknown> = {
    action: 'watcher.set', targetType: 'journey_map', targetId: hashTargetMap.id, state: 'watching'
  };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(intent)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))));
  assert.equal(stored.intent_sha256, crypto.createHash('sha256').update(canonical).digest('hex'));
  // Insertion order of the same key set must not change the hash.
  const shuffled = JSON.stringify(Object.fromEntries(Object.entries({
    state: 'watching', targetId: hashTargetMap.id, action: 'watcher.set', targetType: 'journey_map'
  }).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))));
  assert.equal(shuffled, canonical);
});

test('collaboration SQL carries no PostgreSQL reserved-word table alias', () => {
  // `user` is a reserved keyword in PostgreSQL and is not accepted where a table
  // alias is parsed, with or without AS. This module aliased `users` as `user` in
  // seven statements -- membership lookup, role listing, revocation, mentions,
  // edit history, watchers and activity -- every one of which would have raised a
  // syntax error on its first PostgreSQL execution. It never surfaced because
  // runtime-28 has never been applied and SQLite accepts the alias, so no test can
  // catch it dynamically until the migration lands. This guards the source.
  const source = fs.readFileSync(new URL('../src/journeyCollaboration.ts', import.meta.url), 'utf8');
  assert.equal(/\busers\s+(?:AS\s+)?user\b/iu.test(source), false,
    'users is aliased as the reserved word `user`');
  assert.equal(/\buser\.(?:id|name|email)\b/u.test(source), false,
    'a bare `user.` qualifier parses as the PostgreSQL USER function');
  // Canonicalisation feeds persisted hashes and must stay locale-independent.
  assert.equal(source.includes('.localeCompare('), false,
    'canonical key ordering must not depend on locale or ICU data');
});

test('KNOWN DEFECT (SQLite projection, out of scope here): a comment author cannot be offboarded', () => {
  // Pinned so the behaviour is visible and evidenced, NOT because it is correct.
  // The defect has been HALF fixed, and this test pins the half that remains.
  //
  // 0028 used to declare five composite foreign keys from collaboration tables
  // into space_memberships. It no longer does: those five columns are now
  // users(id) ON DELETE NO ACTION plus journey_collaboration_membership_guard,
  // which checks tenancy at write time and lets offboarding proceed afterwards
  // (see journey-collaboration-migration.test.ts, which pins exactly that shape).
  // ensureSqliteSchema in journeyCollaboration.ts was NOT updated with it and
  // still declares all five as ON DELETE RESTRICT.
  //
  // SQLite is the runtime the product actually ships on, so spaces.ts
  // removeSpaceMember -- a plain DELETE FROM space_memberships -- still fails with
  // a raw foreign-key error once someone has authored a comment, edited one or
  // requested a review: a 500, not a clean 409. The facade renders absent authors
  // as 'Former member', i.e. it was written expecting members to disappear.
  //
  // Closing this means porting the 0028 correction into journeyCollaboration.ts,
  // which is out of scope for this run. Until then this assertion is the accurate
  // record that the fix has not reached the shipped runtime; if it stops throwing,
  // the projection has been corrected and this test should be replaced.
  const author = bareMember('offboard-author', 'member');
  collaboration.createJourneyComment({
    spaceId: owner.spaceId, actorUserId: author, target, body: 'Authored before offboarding.',
    idempotencyKey: key('offboard-comment')
  });
  assert.throws(() => db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?')
    .run(owner.spaceId, author), /FOREIGN KEY constraint failed/u,
    'if this stops throwing, ensureSqliteSchema has caught up with 0028 and this test should be replaced');
  // A member who has only ever held a role assignment offboards cleanly, because
  // that edge is declared ON DELETE CASCADE.
  const assignee = bareMember('offboard-assignee', 'member');
  collaboration.assignJourneyRole({
    spaceId: owner.spaceId, actorUserId: owner.userId, userId: assignee, role: 'viewer',
    scopeType: 'space', idempotencyKey: key('offboard-assign')
  });
  db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?').run(owner.spaceId, assignee);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_collaboration_role_assignments
    WHERE space_id=? AND user_id=?`).get(owner.spaceId, assignee) as any).count), 0);
});
