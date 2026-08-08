import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-portfolio-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Portfolio-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-portfolio-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 61).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 62).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-portfolio@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
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
const portfolio = await import('../src/journeyPortfolio.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** supertest attaches an ephemeral server to the agent; unref it so a finished
 * run exits. `app` is untyped on the agent, so it is narrowed rather than cast
 * through `any`, keeping this file clean under a standalone strict compile. */
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
    email: 'journey-portfolio@seemplify.local', password: 'Journey-Portfolio-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { spaceId, userId: String(session.body.user.id) };
}

async function collaborator(spaceId: string | null, role: 'admin' | 'member', suffix: string) {
  const agent = testAgent();
  await signupVerifyAndOnboard(agent, {
    name: `Portfolio ${role}`, email: `portfolio-${suffix}@example.test`,
    password: 'Strong-portfolio-password-2026!', spaceName: `Portfolio ${suffix} home`
  });
  const session = await agent.get('/api/auth/session').expect(200);
  const userId = String(session.body.user.id);
  const homeSpaceId = String(session.body.activeSpace.id);
  if (spaceId) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES (?,?,?,?,?)`).run(spaceId, userId, role, now, now);
  }
  return { userId, homeSpaceId };
}

const owner = await ownerIdentity();

type Draft = Parameters<typeof portfolio.createJourneyPortfolioItem>[0]['draft'];

function draft(overrides: Partial<Draft> & { kind: Draft['kind'] }): Draft {
  return {
    title: 'Checkout abandons at payment', description: 'Customers drop out on the payment step.',
    lifecycle: 'draft', ownerUserId: null, ownerTeamId: null, priority: null, risk: null,
    severity: null, frequency: null, desiredOutcome: null, hypothesis: null, constraints: [],
    estimatedEffort: null, estimatedCost: null, expectedOutcome: null, plannedStart: null,
    plannedEnd: null, actualStart: null, actualEnd: null, dueDate: null, progressPercent: null,
    reviewCadenceDays: null, targetMetrics: [], evidenceLinkIds: [], tags: [],
    ...(overrides.kind === 'pain_point' ? { severity: 3 as const, frequency: 'frequent' as const } : {}),
    ...(overrides.kind === 'opportunity' ? { desiredOutcome: 'Reduce payment drop-off.' } : {}),
    ...(overrides.kind === 'solution' ? { hypothesis: 'A clearer payment form reduces drop-off.', risk: 'low' as const } : {}),
    ...(overrides.kind === 'initiative' ? {
      priority: 'high' as const, risk: 'medium' as const, expectedOutcome: 'Lift payment completion.',
      progressPercent: 0
    } : {}),
    ...overrides
  } as Draft;
}

let keySequence = 0;
function key(label: string) { keySequence += 1; return `${label}-${keySequence}`; }

function create(spaceId: string, actorUserId: string, overrides: Partial<Draft> & { kind: Draft['kind'] }) {
  return portfolio.createJourneyPortfolioItem({
    spaceId, actorUserId, draft: draft(overrides), idempotencyKey: key('create')
  }).item;
}

function rejects(run: () => unknown, expected: { status: number; code: string }) {
  assert.throws(run, (error: any) => {
    assert.equal(error.status, expected.status, `status for ${expected.code}: ${error.code} ${error.message}`);
    assert.equal(error.code, expected.code);
    return true;
  });
}

test('scopes every read and write to the owning space', async () => {
  const other = await collaborator(null, 'admin', 'tenant-isolation');
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(other.homeSpaceId);
  const item = create(owner.spaceId, owner.userId, { kind: 'pain_point' });

  rejects(() => portfolio.getJourneyPortfolioItem({
    spaceId: other.homeSpaceId, actorUserId: other.userId, itemId: item.id
  }), { status: 404, code: 'JOURNEY_PORTFOLIO_ITEM_NOT_FOUND' });

  rejects(() => portfolio.updateJourneyPortfolioItem({
    spaceId: other.homeSpaceId, actorUserId: other.userId, itemId: item.id, expectedRevision: 1,
    patch: { title: 'Cross-tenant write' }, idempotencyKey: key('cross')
  }), { status: 404, code: 'JOURNEY_PORTFOLIO_ITEM_NOT_FOUND' });

  const listed = portfolio.listJourneyPortfolioItems({ spaceId: other.homeSpaceId, actorUserId: other.userId });
  assert.equal(listed.items.some((entry) => entry.id === item.id), false);
  assert.equal(portfolio.listJourneyInitiativeOutcomes({
    spaceId: other.homeSpaceId, actorUserId: other.userId
  }).length, 0);
});

test('requires the subscription feature, then space membership, then a managing role', async () => {
  const member = await collaborator(owner.spaceId, 'member', 'member-role');
  const stranger = await collaborator(null, 'admin', 'stranger');

  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  rejects(() => portfolio.listJourneyPortfolioItems({ spaceId: owner.spaceId, actorUserId: owner.userId }),
    { status: 403, code: 'SUBSCRIPTION_FEATURE_REQUIRED' });
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);

  rejects(() => portfolio.listJourneyPortfolioItems({ spaceId: owner.spaceId, actorUserId: stranger.userId }),
    { status: 403, code: 'JOURNEY_PORTFOLIO_FORBIDDEN' });

  rejects(() => create(owner.spaceId, member.userId, { kind: 'pain_point' }),
    { status: 403, code: 'JOURNEY_PORTFOLIO_FORBIDDEN' });

  // A member still reads: the restriction is on managing, not on visibility.
  assert.ok(portfolio.listJourneyPortfolioItems({ spaceId: owner.spaceId, actorUserId: member.userId }).items.length >= 0);
});

test('refuses to create an item directly in an approval-gated lifecycle', () => {
  rejects(() => create(owner.spaceId, owner.userId, { kind: 'opportunity', lifecycle: 'approved' }),
    { status: 422, code: 'JOURNEY_PORTFOLIO_APPROVAL_REQUIRED' });
  rejects(() => create(owner.spaceId, owner.userId, { kind: 'initiative', lifecycle: 'active' }),
    { status: 422, code: 'JOURNEY_PORTFOLIO_APPROVAL_REQUIRED' });
  // The same gate on update is what creation must not be able to sidestep.
  const item = create(owner.spaceId, owner.userId, { kind: 'opportunity' });
  rejects(() => portfolio.updateJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: item.id, expectedRevision: item.revision,
    patch: { lifecycle: 'approved' }, idempotencyKey: key('gate')
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_APPROVAL_REQUIRED' });
});

test('replays an identical idempotent create and rejects a reused key for a different intent', () => {
  const idempotencyKey = key('replay');
  const first = portfolio.createJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, draft: draft({ kind: 'solution' }), idempotencyKey
  });
  const second = portfolio.createJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, draft: draft({ kind: 'solution' }), idempotencyKey
  });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.item.id, first.item.id);
  assert.equal(second.item.revision, first.item.revision);
  // The replay is rebuilt from immutable history and re-verified against its checksum.
  assert.equal(second.item.title, first.item.title);

  rejects(() => portfolio.createJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId,
    draft: draft({ kind: 'solution', title: 'A different intent entirely' }), idempotencyKey
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_IDEMPOTENCY_CONFLICT' });
});

test('enforces optimistic concurrency and keeps history append-only', () => {
  const item = create(owner.spaceId, owner.userId, { kind: 'pain_point' });
  const updated = portfolio.updateJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: item.id, expectedRevision: item.revision,
    patch: { title: 'Payment step drops customers' }, idempotencyKey: key('update')
  }).item;
  assert.equal(updated.revision, item.revision + 1);

  rejects(() => portfolio.updateJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: item.id, expectedRevision: item.revision,
    patch: { title: 'Stale writer wins' }, idempotencyKey: key('stale')
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_REVISION_CONFLICT' });

  const detail = portfolio.getJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: item.id
  });
  assert.deepEqual(detail.versions.map((version) => version.revision), [2, 1]);
  assert.deepEqual(detail.operationalLinks, []);
  assert.deepEqual(detail.outcomes, []);

  assert.throws(() => db.prepare(`UPDATE journey_portfolio_item_versions SET change_reason='rewritten'
    WHERE item_id=? AND space_id=?`).run(item.id, owner.spaceId), /append-only/u);
});

test('validates relationship endpoints and refuses self or duplicate links', () => {
  const pain = create(owner.spaceId, owner.userId, { kind: 'pain_point' });
  const opportunity = create(owner.spaceId, owner.userId, { kind: 'opportunity' });

  rejects(() => portfolio.createJourneyPortfolioRelationship({
    spaceId: owner.spaceId, actorUserId: owner.userId, type: 'pain_point_to_opportunity',
    fromItemId: pain.id, toItemId: pain.id, idempotencyKey: key('self')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_RELATIONSHIP_SELF' });

  rejects(() => portfolio.createJourneyPortfolioRelationship({
    spaceId: owner.spaceId, actorUserId: owner.userId, type: 'opportunity_to_solution',
    fromItemId: pain.id, toItemId: opportunity.id, idempotencyKey: key('kind')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_RELATIONSHIP_KIND_INVALID' });

  portfolio.createJourneyPortfolioRelationship({
    spaceId: owner.spaceId, actorUserId: owner.userId, type: 'pain_point_to_opportunity',
    fromItemId: pain.id, toItemId: opportunity.id, idempotencyKey: key('link')
  });
  rejects(() => portfolio.createJourneyPortfolioRelationship({
    spaceId: owner.spaceId, actorUserId: owner.userId, type: 'pain_point_to_opportunity',
    fromItemId: pain.id, toItemId: opportunity.id, idempotencyKey: key('duplicate')
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_RELATIONSHIP_EXISTS' });
});

test('refuses an initiative dependency that would close a cycle', () => {
  const first = create(owner.spaceId, owner.userId, { kind: 'initiative', title: 'Rebuild payment form' });
  const second = create(owner.spaceId, owner.userId, { kind: 'initiative', title: 'Retire legacy gateway' });

  portfolio.createJourneyInitiativeDependency({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: first.id,
    dependsOnInitiativeId: second.id, type: 'finish_to_start', idempotencyKey: key('dependency')
  });
  rejects(() => portfolio.createJourneyInitiativeDependency({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: second.id,
    dependsOnInitiativeId: first.id, type: 'finish_to_start', idempotencyKey: key('cycle')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_DEPENDENCY_CYCLE' });
  rejects(() => portfolio.createJourneyInitiativeDependency({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: first.id,
    dependsOnInitiativeId: first.id, type: 'blocks', idempotencyKey: key('dependency-self')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_DEPENDENCY_SELF' });
});

test('paginates with a total order and no repeated or skipped rows', () => {
  const space = owner.spaceId;
  const tag = 'pagination';
  for (let index = 0; index < 5; index += 1) {
    create(space, owner.userId, { kind: 'opportunity', title: `Paged opportunity ${index}`, tags: [tag] });
  }
  const all = portfolio.listJourneyPortfolioItems({
    spaceId: space, actorUserId: owner.userId, tag, sort: 'updated', limit: 100
  });
  assert.equal(all.items.length, 5);
  const paged: string[] = [];
  for (let offset = 0; offset < 5; offset += 2) {
    const page = portfolio.listJourneyPortfolioItems({
      spaceId: space, actorUserId: owner.userId, tag, sort: 'updated', limit: 2, offset
    });
    assert.equal(page.page.total, 5);
    paged.push(...page.items.map((entry) => entry.id));
  }
  assert.deepEqual(paged, all.items.map((entry) => entry.id));
  assert.equal(new Set(paged).size, 5);
  // A tag stored with the invariant lower-casing is still found by a mixed-case filter.
  assert.equal(portfolio.listJourneyPortfolioItems({
    spaceId: space, actorUserId: owner.userId, tag: 'PAGINATION', limit: 100
  }).items.length, 5);
  rejects(() => portfolio.listJourneyPortfolioItems({
    spaceId: space, actorUserId: owner.userId, limit: Number('not-a-number')
  }), { status: 400, code: 'JOURNEY_PORTFOLIO_PAGINATION_INVALID' });
});

test('versions scoring policies immutably and rejects an unrecognised weighted direction', () => {
  const created = portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: owner.spaceId, actorUserId: owner.userId, name: 'Weighted delivery value', method: 'weighted',
    configuration: { dimensions: [{ key: 'value', label: 'Value', weight: 2, minimum: 0, maximum: 10,
      direction: 'higher_is_better' }] },
    state: 'active', idempotencyKey: key('policy')
  }).policy;
  assert.equal(created.currentVersion.versionNumber, 1);
  assert.equal(created.currentVersion.formulaVersion, 'weighted.v1');

  const next = portfolio.createJourneyPortfolioScoringPolicyVersion({
    spaceId: owner.spaceId, actorUserId: owner.userId, policyId: created.id, expectedRevision: created.revision,
    configuration: { dimensions: [{ key: 'value', label: 'Value', weight: 3, minimum: 0, maximum: 10,
      direction: 'higher_is_better' }] },
    idempotencyKey: key('policy-version')
  }).policy;
  assert.equal(next.currentVersion.versionNumber, 2);
  assert.notEqual(next.currentVersion.configurationSha256, created.currentVersion.configurationSha256);
  assert.equal(next.revision, created.revision + 1);

  rejects(() => portfolio.createJourneyPortfolioScoringPolicyVersion({
    spaceId: owner.spaceId, actorUserId: owner.userId, policyId: created.id, expectedRevision: created.revision,
    configuration: { dimensions: [{ key: 'value', label: 'Value', weight: 4, minimum: 0, maximum: 10,
      direction: 'higher_is_better' }] },
    idempotencyKey: key('policy-stale')
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_REVISION_CONFLICT' });

  rejects(() => portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: owner.spaceId, actorUserId: owner.userId, name: 'Bad direction', method: 'weighted',
    configuration: { dimensions: [{ key: 'value', label: 'Value', weight: 1, minimum: 0, maximum: 10,
      direction: 'sideways' }] },
    idempotencyKey: key('policy-direction')
  }), { status: 400, code: 'JOURNEY_PORTFOLIO_POLICY_DIMENSIONS_INVALID' });

  // Calculator failures reach the caller as governed input errors, not as 500s.
  rejects(() => portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: owner.spaceId, actorUserId: owner.userId, name: 'Inverted range', method: 'weighted',
    configuration: { dimensions: [{ key: 'value', label: 'Value', weight: 1, minimum: 10, maximum: 0,
      direction: 'higher_is_better' }] },
    idempotencyKey: key('policy-range')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_SCORE_INVALID' });
});

test('requires an explicit policy while no space default exists, and maps score input failures', () => {
  const opportunity = create(owner.spaceId, owner.userId, { kind: 'opportunity' });
  rejects(() => portfolio.assessJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: opportunity.id,
    scoreInput: { reach: 10, impact: 2, confidence: 0.5, effort: 4 }, idempotencyKey: key('no-policy')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_POLICY_REQUIRED' });

  const policy = portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: owner.spaceId, actorUserId: owner.userId, name: 'RICE', method: 'rice',
    configuration: {}, state: 'active', idempotencyKey: key('rice')
  }).policy;

  const assessed = portfolio.assessJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: opportunity.id, policyId: policy.id,
    scoreInput: { reach: 100, impact: 2, confidence: 0.5, effort: 4 }, idempotencyKey: key('assess')
  }).assessment;
  assert.equal(assessed.score, 25);
  assert.equal(assessed.itemRevision, opportunity.revision);

  rejects(() => portfolio.assessJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: opportunity.id, policyId: policy.id,
    scoreInput: { reach: 100, impact: 2, confidence: 80, effort: 4 }, idempotencyKey: key('assess-range')
  }), { status: 422, code: 'JOURNEY_PORTFOLIO_SCORE_INVALID' });

  rejects(() => portfolio.assessJourneyPortfolioItem({
    spaceId: owner.spaceId, actorUserId: owner.userId, itemId: opportunity.id, policyId: policy.id,
    scoreInput: { reach: 1, impact: 2, confidence: 0.5, effort: 4, sneaky: 1 } as never,
    idempotencyKey: key('assess-field')
  }), { status: 400, code: 'JOURNEY_PORTFOLIO_SCORE_INPUT_INVALID' });
});

test('admits scoring policies against the declared plan allowance, counting drafts', async () => {
  const tenant = await collaborator(null, 'admin', 'quota');
  db.prepare("UPDATE platform_subscriptions SET plan_code='team' WHERE space_id=?").run(tenant.homeSpaceId);

  // The Team allowance declared by migration 0027 is ten scoring policies.
  for (let index = 0; index < 10; index += 1) {
    portfolio.createJourneyPortfolioScoringPolicy({
      spaceId: tenant.homeSpaceId, actorUserId: tenant.userId, name: `Draft policy ${index}`, method: 'ice',
      configuration: {}, state: 'draft', idempotencyKey: key('quota-policy')
    });
  }
  rejects(() => portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: tenant.homeSpaceId, actorUserId: tenant.userId, name: 'One too many', method: 'ice',
    configuration: {}, state: 'draft', idempotencyKey: key('quota-policy')
  }), { status: 409, code: 'SUBSCRIPTION_QUOTA_EXCEEDED' });

  const policies = portfolio.listJourneyPortfolioScoringPolicies({
    spaceId: tenant.homeSpaceId, actorUserId: tenant.userId
  });
  assert.equal(policies.length, 10);

  // Retiring one releases the allowance it held.
  portfolio.updateJourneyPortfolioScoringPolicyState({
    spaceId: tenant.homeSpaceId, actorUserId: tenant.userId, policyId: policies[0].id,
    expectedRevision: policies[0].revision, state: 'retired'
  });
  const admitted = portfolio.createJourneyPortfolioScoringPolicy({
    spaceId: tenant.homeSpaceId, actorUserId: tenant.userId, name: 'Admitted after retirement', method: 'ice',
    configuration: {}, state: 'draft', idempotencyKey: key('quota-policy')
  }).policy;
  assert.equal(admitted.state, 'draft');
});

test('records governed activity for every accepted portfolio mutation', () => {
  const item = create(owner.spaceId, owner.userId, { kind: 'pain_point', title: 'Audited pain point' });
  const rows = db.prepare(`SELECT action,target_id,actor_user_id FROM journey_portfolio_activity
    WHERE space_id=? AND target_id=? ORDER BY created_at,id`).all(owner.spaceId, item.id) as Array<{
      action: string; target_id: string; actor_user_id: string | null }>;
  assert.deepEqual(rows.map((row) => row.action), ['item.created']);
  assert.equal(rows[0].actor_user_id, owner.userId);
  assert.throws(() => db.prepare('DELETE FROM journey_portfolio_activity WHERE space_id=? AND target_id=?')
    .run(owner.spaceId, item.id), /append-only/u);
});
