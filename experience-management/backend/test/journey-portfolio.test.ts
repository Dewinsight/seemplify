import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const { createJourneyMap } = await import('../src/journeyMaps.js');

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

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function seedPortfolioMetric(journeyId: string) {
  const id = crypto.randomUUID(); const versionId = crypto.randomUUID(); const at = '2026-08-01T00:00:00.000Z';
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,name,state,current_version_id,revision,
       idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'journey',?,'Portfolio outcome','active',?,1,?,?,?,?,?)`).run(id, owner.spaceId, journeyId,
      journeyId, versionId, `portfolio-metric-${id}`, hash(id), owner.userId, at, at);
    db.prepare(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,
       window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,
       population_json,filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,
       created_by_user_id,created_at)
      VALUES (?,?,?,1,'operational_import',NULL,'operational','count','higher_is_better',86400,'UTC',2,86400,NULL,90,
        '{"population":"customers"}','{"country":"GB"}','{"kind":"count"}','{"kind":"count"}',?,?,?,?,?)`)
      .run(versionId, id, owner.spaceId, hash(`content-${id}`), `portfolio-version-${id}`,
        hash(`intent-${id}`), owner.userId, at);
  })();
  return { id, versionId };
}

function seedPortfolioObservation(metric: { id: string; versionId: string }, start: string, end: string, value: number) {
  const id = crypto.randomUUID(); const runId = crypto.randomUUID(); const result = JSON.stringify({ kind: 'count', value });
  db.prepare(`INSERT INTO journey_metric_rebuild_runs
    (id,space_id,definition_id,definition_version_id,reason,as_of,state,available_at,lease_generation,attempt_count,
     max_attempts,idempotency_key,intent_sha256,requested_by_user_id,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,'manual',?,'completed',?,0,0,3,?,?,?,?,?,?)`).run(runId, owner.spaceId, metric.id,
      metric.versionId, end, end, `portfolio-run-${runId}`, hash(runId), owner.userId, end, end, end);
  db.prepare(`INSERT INTO journey_metric_observations
    (id,space_id,definition_id,definition_version_id,revision,status,value,unit,numerator,denominator,sample_size,
     period_start,period_end,timezone,as_of,calculated_at,freshness_status,latest_observed_at,minimum_sample_warning,
     source_count,source_snapshot_sha256,result_sha256,result_json,rebuild_run_id,created_at)
    VALUES (?,?,?,?,1,'available',?,'score',?,20,20,?,?,'UTC',?,?,'fresh',?,0,20,?,?,?,?,?)`).run(id,
      owner.spaceId, metric.id, metric.versionId, value, value, start, end, end, end, end,
      hash(`source-${id}`), hash(result), result, runId, end);
  return id;
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

test('keeps portfolio owner attribution when an owning member is offboarded', async () => {
  const leaver = await collaborator(owner.spaceId, 'member', `offboarding-${keySequence}`);
  const item = create(owner.spaceId, owner.userId, {
    kind: 'initiative', ownerUserId: leaver.userId
  });
  db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?')
    .run(owner.spaceId, leaver.userId);
  assert.equal((db.prepare('SELECT owner_user_id ownerUserId FROM journey_portfolio_items WHERE id=?')
    .get(item.id) as { ownerUserId: string }).ownerUserId, leaver.userId);
  assert.throws(() => create(owner.spaceId, owner.userId, {
    kind: 'initiative', ownerUserId: leaver.userId
  }), /not a member/u);
});

test('governs typed operational links and optimistic outcome attribution', async () => {
  const initiative = create(owner.spaceId, owner.userId, { kind: 'initiative' });
  const actionId = crypto.randomUUID();
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO assistant_actions
    (id,space_id,created_by,title,description,owner,status,priority,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?, ?,1,?,?)`).run(actionId, owner.spaceId, owner.userId, 'Review checkout recovery', '', '',
      'open', 'normal', at, at);

  const created = portfolio.createJourneyPortfolioOperationalLink({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: initiative.id,
    operationalKind: 'assistant_action', operationalId: actionId, relationship: 'supports',
    idempotencyKey: key('operational-link')
  });
  assert.equal(created.operationalLink.outcomeState, 'linked');
  assert.equal(created.operationalLink.createdByUserId, owner.userId);

  rejects(() => portfolio.createJourneyPortfolioOperationalLink({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: initiative.id,
    operationalKind: 'assistant_action', operationalId: actionId, relationship: 'supports',
    idempotencyKey: key('operational-duplicate')
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_OPERATIONAL_LINK_DUPLICATE' });

  const updated = portfolio.updateJourneyPortfolioOperationalOutcome({
    spaceId: owner.spaceId, actorUserId: owner.userId, linkId: created.operationalLink.id,
    expectedRevision: 1, outcomeState: 'succeeded', outcomeDetail: { code: 'completed', count: 1 }
  }).operationalLink;
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdByUserId, owner.userId);
  assert.equal(updated.updatedByUserId, owner.userId);
  assert.deepEqual(updated.outcomeDetail, { code: 'completed', count: 1 });
  rejects(() => portfolio.updateJourneyPortfolioOperationalOutcome({
    spaceId: owner.spaceId, actorUserId: owner.userId, linkId: updated.id,
    expectedRevision: 1, outcomeState: 'failed', outcomeDetail: {}
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_REVISION_CONFLICT' });

  const other = await collaborator(null, 'admin', 'operational-source-tenant');
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(other.homeSpaceId);
  const foreignActionId = crypto.randomUUID();
  db.prepare(`INSERT INTO assistant_actions
    (id,space_id,created_by,title,description,owner,status,priority,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?, ?,1,?,?)`).run(foreignActionId, other.homeSpaceId, other.userId, 'Foreign action', '', '',
      'open', 'normal', at, at);
  rejects(() => portfolio.createJourneyPortfolioOperationalLink({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: initiative.id,
    operationalKind: 'assistant_action', operationalId: foreignActionId, relationship: 'informs',
    idempotencyKey: key('operational-cross-tenant')
  }), { status: 404, code: 'JOURNEY_PORTFOLIO_OPERATIONAL_SOURCE_NOT_FOUND' });
});

test('captures immutable persisted metric baselines and compares exact after observations', () => {
  const journey = createJourneyMap(owner.spaceId, owner.userId, {
    name: 'Portfolio measurement journey', purpose: 'Verify governed outcomes', stageNames: ['Measure']
  });
  const metric = seedPortfolioMetric(journey.id);
  const initiative = create(owner.spaceId, owner.userId, { kind: 'initiative', targetMetrics: [{
    metricId: metric.id, metricDefinitionVersion: metric.versionId, direction: 'higher_is_better',
    targetValue: 90, unit: 'score'
  }] });
  const beforeId = seedPortfolioObservation(metric, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 80);
  const afterId = seedPortfolioObservation(metric, '2026-08-02T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 92);
  const baseline = portfolio.captureJourneyInitiativeBaseline({
    spaceId: owner.spaceId, actorUserId: owner.userId, initiativeId: initiative.id,
    observationId: beforeId, idempotencyKey: key('baseline'), now: '2026-08-02T01:00:00.000Z'
  }).baseline;
  assert.equal(baseline.observation.observationId, beforeId);
  assert.equal(baseline.target.metricDefinitionVersion, metric.versionId);
  assert.throws(() => db.prepare('UPDATE journey_initiative_baselines SET checksum=? WHERE id=?')
    .run('0'.repeat(64), baseline.baselineId), /append-only/u);

  const outcome = portfolio.createJourneyInitiativeOutcomeComparison({
    spaceId: owner.spaceId, actorUserId: owner.userId, baselineId: baseline.baselineId,
    afterObservationId: afterId, idempotencyKey: key('outcome'), now: '2026-08-03T01:00:00.000Z'
  }).outcome;
  assert.equal(outcome.comparison.absoluteChange, 12);
  assert.equal(outcome.comparison.targetResult, 'met');
  assert.match(String((outcome.comparison.interpretation as any).statement), /does not establish/u);
  rejects(() => portfolio.createJourneyInitiativeOutcomeComparison({
    spaceId: owner.spaceId, actorUserId: owner.userId, baselineId: baseline.baselineId,
    afterObservationId: afterId, idempotencyKey: key('outcome-duplicate'), now: '2026-08-03T01:00:00.000Z'
  }), { status: 409, code: 'JOURNEY_PORTFOLIO_OUTCOME_DUPLICATE' });
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
