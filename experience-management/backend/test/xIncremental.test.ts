import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-x-incremental-'));
const files = {
  password: path.join(root, 'admin-password'),
  session: path.join(root, 'session-secret'),
  webhook: path.join(root, 'brevo-webhook-secret'),
  xKey: path.join(root, 'x-credential-encryption-key'),
  esignKey: path.join(root, 'esign-encryption-key')
};
const frontendDist = path.join(root, 'frontend-dist');
fs.mkdirSync(frontendDist, { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>X incremental test</title>');
fs.writeFileSync(files.password, 'X-Incremental-Test-Password-2026!');
fs.writeFileSync(files.session, 'x-incremental-test-session-secret-that-is-long-enough');
fs.writeFileSync(files.webhook, 'x-incremental-test-webhook-secret-that-is-long-enough');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 19).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 20).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: frontendDist,
  PUBLIC_URL: 'http://127.0.0.1:5414',
  ADMIN_EMAIL: 'x-incremental-owner@example.test',
  ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session,
  BREVO_WEBHOOK_SECRET_FILE: files.webhook,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files.esignKey,
  EMAIL_MODE: 'log',
  X_API_BASE_URL: 'https://api.x.incremental.invalid',
  X_OAUTH_BASE_URL: 'https://api.x.incremental.invalid',
  X_OAUTH2_AUTHORIZE_BASE_URL: 'https://x.incremental.invalid',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'absent-consumer-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'absent-consumer-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'absent-bearer-token'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'absent-access-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'absent-access-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'absent-client-id'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'absent-client-secret')
});

const { app } = await import('../src/app.js');
const { aiJobRunner } = await import('../src/aiJobs.js');
const { db } = await import('../src/database.js');
const { createSocialIntelligenceReport } = await import('../src/intelligence.js');
const { xSyncRunner } = await import('../src/xIntegration.js');

const owner = request.agent(app);
const member = request.agent(app);
const originalFetch = globalThis.fetch;

type ProviderTarget = 'account_posts' | 'mentions' | 'searches';
type ProviderCall = {
  target: ProviderTarget;
  query: string | null;
  token: string | null;
  sinceId: string | null;
  untilId: string | null;
  maximumResults: number;
  returnedIds: string[];
  status: number;
};

const descending = (high: number, low: number) => Array.from({ length: high - low + 1 }, (_, index) => String(high - index));
const providerRows: Record<ProviderTarget, string[]> = {
  account_posts: descending(300, 221),
  mentions: descending(500, 421),
  searches: descending(700, 621)
};
const providerCalls: ProviderCall[] = [];
let failFirstMentionRequest = true;
let failAccountExpansionContinuation = false;
let expireSearchExpansionToken = false;
let expireAccountTokenWithoutLow = false;
let emptyIncrementalAccountPages = 0;
let emptyExpansionAccountPages = 0;

function targetForUrl(url: URL): ProviderTarget | null {
  if (url.pathname.endsWith('/mentions')) return 'mentions';
  if (url.pathname.endsWith('/tweets/search/recent')) return 'searches';
  if (/\/2\/users\/[^/]+\/tweets$/.test(url.pathname)) return 'account_posts';
  return null;
}

function post(id: string) {
  return {
    id,
    text: `Post ${id} contains enough stable evidence text for analysis.`,
    created_at: new Date(Date.UTC(2026, 0, 1) + Number(id) * 60_000).toISOString(),
    lang: 'en',
    author_id: '900000000000000123',
    public_metrics: { like_count: Number(id) % 17, reply_count: Number(id) % 5 }
  };
}

globalThis.fetch = async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.x.incremental.invalid') {
    return new Response(JSON.stringify({ error: 'Unexpected non-X request in incremental collection test.' }), {
      status: 503, headers: { 'content-type': 'application/json' }
    });
  }
  if (url.pathname.endsWith('/2/users/me')) {
    return new Response(JSON.stringify({ data: { id: '900000000000000123', username: 'bounded_reader', name: 'Bounded Reader' } }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  const target = targetForUrl(url);
  if (!target) return new Response(JSON.stringify({ detail: 'Unexpected X endpoint.' }), { status: 500, headers: { 'content-type': 'application/json' } });
  const query = url.searchParams.get('query');
  const token = url.searchParams.get('pagination_token');
  const sinceId = url.searchParams.get('since_id');
  const untilId = url.searchParams.get('until_id');
  const maximumResults = Number(url.searchParams.get('max_results') || 10);
  const offset = token?.startsWith('empty-') ? 0 : token ? Number(token.split(':').at(-1) || 0) : 0;
  const call: ProviderCall = { target, query, token, sinceId, untilId, maximumResults, returnedIds: [], status: 200 };

  const success = (ids: string[], nextToken?: string) => {
    call.returnedIds = ids; providerCalls.push(call);
    return new Response(JSON.stringify({
      data: ids.map(post),
      includes: { users: [{ id: '900000000000000123', username: 'bounded_reader', name: 'Bounded Reader' }] },
      meta: { result_count: ids.length, newest_id: ids[0], ...(nextToken ? { next_token: nextToken } : {}) }
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-rate-limit-limit': '75',
        'x-rate-limit-remaining': '74'
      }
    });
  };

  if (target === 'mentions' && failFirstMentionRequest) {
    failFirstMentionRequest = false;
    call.status = 503; providerCalls.push(call);
    return new Response(JSON.stringify({ detail: 'Temporary mention endpoint failure.' }), {
      status: 503, headers: { 'content-type': 'application/problem+json' }
    });
  }
  if (target === 'account_posts' && failAccountExpansionContinuation && offset === 100 && untilId === '220') {
    failAccountExpansionContinuation = false;
    call.status = 503; providerCalls.push(call);
    return new Response(JSON.stringify({ detail: 'Temporary history page failure.' }), {
      status: 503, headers: { 'content-type': 'application/problem+json' }
    });
  }
  if (target === 'searches' && expireSearchExpansionToken && offset === 100 && untilId === '621') {
    expireSearchExpansionToken = false;
    call.status = 400; providerCalls.push(call);
    return new Response(JSON.stringify({ detail: 'Pagination token expired.' }), {
      status: 400, headers: { 'content-type': 'application/problem+json' }
    });
  }
  if (target === 'account_posts' && expireAccountTokenWithoutLow && token === 'expired-without-low') {
    expireAccountTokenWithoutLow = false;
    call.status = 400; providerCalls.push(call);
    return new Response(JSON.stringify({ detail: 'Pagination token expired without a committed low boundary.' }), {
      status: 400, headers: { 'content-type': 'application/problem+json' }
    });
  }
  if (target === 'account_posts' && emptyIncrementalAccountPages > 0 && sinceId === '300') {
    const hop = 3 - emptyIncrementalAccountPages;
    emptyIncrementalAccountPages -= 1;
    return success([], `empty-incremental:${hop + 1}`);
  }
  if (target === 'account_posts' && emptyExpansionAccountPages > 0 && untilId === '220') {
    const hop = 3 - emptyExpansionAccountPages;
    emptyExpansionAccountPages -= 1;
    return success([], `empty-expansion:${hop + 1}`);
  }

  // Only the original listening query has historical provider results. Extra
  // queries created later exercise fair rotation and deferred-query telemetry.
  let candidates = target === 'searches' && query !== 'seemplify' ? [] : [...providerRows[target]];
  if (sinceId) candidates = candidates.filter((id) => BigInt(id) > BigInt(sinceId));
  if (untilId) candidates = candidates.filter((id) => target === 'searches'
    ? BigInt(id) < BigInt(untilId)
    : BigInt(id) <= BigInt(untilId));
  candidates.sort((left, right) => BigInt(left) > BigInt(right) ? -1 : BigInt(left) < BigInt(right) ? 1 : 0);
  const ids = candidates.slice(offset, offset + maximumResults);
  const nextOffset = offset + ids.length;
  const nextToken = nextOffset < candidates.length ? `page:${target}:${nextOffset}` : undefined;
  return success(ids, nextToken);
};

after(async () => {
  globalThis.fetch = originalFetch;
  xSyncRunner.stop();
  aiJobRunner.stop();
  await aiJobRunner.drain();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function heldDispatch<T>(operation: () => Promise<T>) {
  assert.equal(xSyncRunner.running, false, 'X worker should be idle before deterministic dispatch');
  xSyncRunner.running = true;
  try { return await operation(); }
  finally { xSyncRunner.running = false; }
}

async function status(connectionId: string) {
  return (await owner.get(`/api/integrations/x?connectionId=${encodeURIComponent(connectionId)}`).expect(200)).body;
}

async function jobStatus(connectionId: string, jobId: string) {
  const snapshot = await status(connectionId);
  const job = snapshot.syncJobs.find((candidate: any) => candidate.id === jobId);
  assert.ok(job, `Expected sync job ${jobId} in status history`);
  return { snapshot, job };
}

async function enqueueNormal(connectionId: string) {
  // The production one-minute manual cooldown is intentional. Backdating only
  // completed fixture jobs keeps the test fast without bypassing dispatch.
  db.prepare("UPDATE x_sync_jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE connection_id=? AND state='completed'").run(connectionId);
  const queued = await heldDispatch(() => owner.post(`/api/integrations/x/connections/${connectionId}/sync`).send({}).expect(202));
  await xSyncRunner.pump();
  return queued.body.job.id as string;
}

async function enqueueExpansion(connectionId: string, limit: number, streams: ProviderTarget[], idempotencyKey: string) {
  const estimate = await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=${limit}&streams=${streams.join(',')}`).expect(200);
  const queued = await heldDispatch(() => owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('Idempotency-Key', idempotencyKey).send({ limit, streams, planFingerprint: estimate.body.planFingerprint }).expect(202));
  await xSyncRunner.pump();
  return queued.body;
}

async function retryNow(jobId: string) {
  db.prepare("UPDATE x_sync_jobs SET run_after='2000-01-01T00:00:00.000Z' WHERE id=? AND state='queued'").run(jobId);
  await xSyncRunner.pump();
}

test('X collection is capped, checkpointed, cached, authorized, and safely expandable', async () => {
  await signupVerifyAndOnboard(owner, {
    name: 'Incremental Owner', email: 'x-incremental-owner@example.test', password: 'X-Incremental-Test-Password-2026!'
  });
  await signupVerifyAndOnboard(member, {
    name: 'Read-only Member', email: 'x-incremental-member@example.test', password: 'X-Incremental-Member-Password-2026!'
  });
  const ownerRow = db.prepare('SELECT id,email,name,role,session_version,email_verified_at,active_space_id FROM users WHERE email=?')
    .get('x-incremental-owner@example.test') as any;
  const memberRow = db.prepare('SELECT id FROM users WHERE email=?').get('x-incremental-member@example.test') as { id: string };
  const spaceId = String(ownerRow.active_space_id);
  const membershipTime = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO space_memberships (space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'member',?,?)`)
    .run(spaceId, memberRow.id, membershipTime, membershipTime);

  const configured = await owner.put('/api/integrations/x/app').send({
    consumerKey: 'incremental-consumer-key',
    consumerSecret: 'incremental-consumer-secret',
    bearerToken: 'incremental-bearer-token',
    accessToken: 'incremental-access-token',
    accessTokenSecret: 'incremental-access-token-secret'
  }).expect(200);
  const connectionId = configured.body.connection.id as string;
  // Account identity is established by OAuth in production. Seed that verified
  // identity here so collection-request accounting is isolated from /users/me.
  db.prepare(`UPDATE x_connections SET x_user_id='900000000000000123',username='bounded_reader',display_name='Bounded Reader',status='connected' WHERE id=?`)
    .run(connectionId);
  const mainQuery = await owner.post(`/api/integrations/x/connections/${connectionId}/queries`)
    .send({ label: 'Seemplify mentions', query: 'seemplify', enabled: true }).expect(201);
  const mainQueryId = mainQuery.body.id as string;

  // The first target succeeds, the second target fails, and the durable retry
  // resumes at the second target instead of paying for the first page twice.
  const firstJobId = await enqueueNormal(connectionId);
  let first = await jobStatus(connectionId, firstJobId);
  assert.equal(first.job.state, 'queued');
  assert.equal(first.job.stage, 'retrying');
  assert.equal(first.job.targets.find((target: any) => target.key === 'account_posts').fetchedCount, 15);
  assert.equal(providerCalls.filter((call) => call.target === 'account_posts').length, 1);
  assert.equal(first.snapshot.connection.cursors.latestPostId, null, 'high-water must not move while a snapshot has another page');
  assert.equal(first.snapshot.connection.catchUp.accountPosts.pending, true);
  await retryNow(firstJobId);
  first = await jobStatus(connectionId, firstJobId);
  assert.equal(first.job.state, 'completed');
  assert.equal(first.job.attempt, 2);
  assert.equal(first.job.postsFetched + first.job.mentionsFetched + first.job.searchFetched, 50);
  assert.equal(providerCalls.filter((call) => call.target === 'account_posts').length, 1, 'retry must skip the committed target');

  const normalJobIds = [firstJobId];
  for (let index = 1; index < 6; index += 1) normalJobIds.push(await enqueueNormal(connectionId));
  for (const jobId of normalJobIds) {
    const current = (await jobStatus(connectionId, jobId)).job;
    assert.equal(current.state, 'completed');
    assert.ok(current.postsFetched + current.mentionsFetched + current.searchFetched <= 50, 'one normal sync may read at most 50 provider rows');
    assert.equal(current.maximumPostsRead, 50);
  }

  const normalSuccessful = providerCalls.filter((call) => call.status === 200);
  for (const target of ['account_posts', 'mentions', 'searches'] as ProviderTarget[]) {
    const ids = normalSuccessful.filter((call) => call.target === target).flatMap((call) => call.returnedIds);
    assert.equal(ids.length, 80, `${target} should drain its initial snapshot across bounded jobs`);
    assert.equal(new Set(ids).size, 80, `${target} provider rows must not be fetched twice`);
  }
  let snapshot = await status(connectionId);
  assert.equal(snapshot.connection.cursors.latestPostId, '300');
  assert.equal(snapshot.connection.cursors.latestMentionId, '500');
  assert.equal(snapshot.queries.find((query: any) => query.id === mainQueryId).sinceId, '700');
  assert.equal(snapshot.connection.catchUp.accountPosts.pending, false);
  assert.equal(snapshot.connection.catchUp.mentions.pending, false);
  assert.equal(snapshot.queries.find((query: any) => query.id === mainQueryId).catchUpPending, false);
  assert.equal(snapshot.counts.collected, 240);

  // A later empty forward sync must use high-water cursors and must not create
  // AI work for cached, still-unanalyzed rows.
  const analysisJobsBefore = Number((db.prepare("SELECT COUNT(*) count FROM ai_jobs WHERE kind='social.analyze'").get() as any).count);
  const emptyJobId = await enqueueNormal(connectionId);
  const emptyJob = (await jobStatus(connectionId, emptyJobId)).job;
  assert.equal(emptyJob.postsFetched + emptyJob.mentionsFetched + emptyJob.searchFetched, 0);
  const analysisJobsAfter = Number((db.prepare("SELECT COUNT(*) count FROM ai_jobs WHERE kind='social.analyze'").get() as any).count);
  assert.equal(analysisJobsAfter, analysisJobsBefore, 'cached analysis backlog must not be silently re-enqueued');
  const latestForwardCalls = providerCalls.slice(-3);
  assert.equal(latestForwardCalls.find((call) => call.target === 'account_posts')?.sinceId, '300');
  assert.equal(latestForwardCalls.find((call) => call.target === 'mentions')?.sinceId, '500');
  assert.equal(latestForwardCalls.find((call) => call.target === 'searches')?.sinceId, '700');

  // A legacy/opaque token can expire before any page establishes a low
  // boundary. Clear it once, restart from the original since_id, and persist
  // the guard so a repeated bad token cannot loop forever.
  db.prepare(`UPDATE x_connections SET post_backlog_token='expired-without-low',post_backlog_since_id='300',
    post_backlog_newest_id=NULL,post_backlog_low_id=NULL WHERE id=?`).run(connectionId);
  expireAccountTokenWithoutLow = true;
  const noLowFallbackJobId = await enqueueNormal(connectionId);
  const noLowFallbackJob = (await jobStatus(connectionId, noLowFallbackJobId)).job;
  const noLowTarget = noLowFallbackJob.targets.find((target: any) => target.key === 'account_posts');
  assert.equal(noLowFallbackJob.state, 'completed');
  assert.equal(noLowTarget.tokenFallbackUsed, true);
  assert.equal(noLowTarget.pageRequests, 2);
  assert.equal(noLowTarget.fetchedCount, 0);
  assert.equal((await status(connectionId)).connection.catchUp.accountPosts.pending, false);

  // Empty first and intermediate pages carrying next_token are traversed in
  // the same bounded job; they do not lose the token or falsely exhaust the
  // snapshot. The hop counters reset after a real page arrives.
  providerRows.account_posts.unshift(...descending(310, 301));
  emptyIncrementalAccountPages = 2;
  const emptyHopJobId = await enqueueNormal(connectionId);
  const emptyHopJob = (await jobStatus(connectionId, emptyHopJobId)).job;
  const emptyHopTarget = emptyHopJob.targets.find((target: any) => target.key === 'account_posts');
  assert.equal(emptyHopJob.state, 'completed');
  assert.equal(emptyHopTarget.fetchedCount, 10);
  assert.equal(emptyHopTarget.pageRequests, 3);
  assert.equal(emptyHopTarget.emptyPageHops, 0);
  assert.equal((await status(connectionId)).connection.cursors.latestPostId, '310');

  const ownerEstimate = await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=120&streams=account_posts`).expect(200);
  assert.equal(ownerEstimate.body.canManagePaidCollection, true);
  assert.equal(ownerEstimate.body.alreadyStoredExcluded, false);
  assert.equal(ownerEstimate.body.cachedPostsDeduplicatedAfterFetch, true);
  assert.equal(ownerEstimate.body.estimated.maximumProviderRows, 120);
  assert.equal(ownerEstimate.body.estimated.maximumUniqueNewPosts, 120);
  assert.equal(ownerEstimate.body.estimated.providerRequests, 2, 'request estimate must use X\'s 100-row page size');
  assert.equal(ownerEstimate.body.estimated.standardPostReadUsd, 0.005);

  const memberStatus = await member.get(`/api/integrations/x?connectionId=${connectionId}`)
    .set('x-seemplify-space', spaceId).expect(200);
  assert.equal(memberStatus.body.canManagePaidCollection, false);
  await member.post(`/api/integrations/x/connections/${connectionId}/sync`)
    .set('x-seemplify-space', spaceId).send({}).expect(403);
  await member.post(`/api/integrations/x/connections/${connectionId}/queries`)
    .set('x-seemplify-space', spaceId).send({ label: 'Forbidden', query: 'forbidden query' }).expect(403);
  await member.patch(`/api/integrations/x/queries/${mainQueryId}`)
    .set('x-seemplify-space', spaceId).send({ label: 'Forbidden rename' }).expect(403);
  await member.delete(`/api/integrations/x/queries/${mainQueryId}`)
    .set('x-seemplify-space', spaceId).expect(403);
  await member.patch(`/api/integrations/x/connections/${connectionId}`)
    .set('x-seemplify-space', spaceId).send({ autoSync: true }).expect(403);
  await member.delete(`/api/integrations/x/connections/${connectionId}/history`)
    .set('x-seemplify-space', spaceId).expect(403);
  await member.delete(`/api/integrations/x/connections/${connectionId}`)
    .set('x-seemplify-space', spaceId).expect(403);
  await member.post('/api/integrations/x/connect')
    .set('x-seemplify-space', spaceId).send({}).expect(403);
  const jobsBeforeDeniedExpansion = Number((db.prepare('SELECT COUNT(*) count FROM x_sync_jobs').get() as any).count);
  await member.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('x-seemplify-space', spaceId)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ limit: 120, streams: ['account_posts'], planFingerprint: `xplan_${'0'.repeat(64)}` }).expect(403);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_sync_jobs').get() as any).count), jobsBeforeDeniedExpansion);

  // Explicit history expansion may span provider pages. A retry after page one
  // resumes from its checkpoint; the committed 100 rows are not read again.
  providerRows.account_posts.push(...descending(220, 100));
  failAccountExpansionContinuation = true;
  emptyExpansionAccountPages = 2;
  const accountExpansionKey = crypto.randomUUID();
  const accountExpansion = await enqueueExpansion(connectionId, 120, ['account_posts'], accountExpansionKey);
  let accountJob = (await jobStatus(connectionId, accountExpansion.job.id)).job;
  assert.equal(accountJob.state, 'queued');
  assert.equal(accountJob.stage, 'retrying');
  assert.equal(accountJob.targets[0].fetchedCount, 100);
  assert.equal(accountJob.targets[0].pageRequests, 4, 'two empty hops, one committed page, and one failed continuation are persisted');
  assert.deepEqual(JSON.parse((db.prepare('SELECT estimate_json FROM x_sync_jobs WHERE id=?').get(accountExpansion.job.id) as any).estimate_json), accountExpansion.estimate);
  assert.equal(accountJob.importedCount, 100);
  assert.equal(providerCalls.filter((call) => call.status === 200 && call.target === 'account_posts' && call.returnedIds.includes('220')).length, 1);
  await retryNow(accountExpansion.job.id);
  accountJob = (await jobStatus(connectionId, accountExpansion.job.id)).job;
  assert.equal(accountJob.state, 'completed');
  assert.equal(accountJob.attempt, 2);
  assert.equal(accountJob.postsFetched, 120);
  assert.equal(accountJob.importedCount, 120);
  assert.equal(accountJob.reusedCount, 0);
  assert.equal(accountJob.providerRequests, 5, 'empty hops and the failed provider attempt remain visible in exact telemetry');
  snapshot = await status(connectionId);
  assert.equal(snapshot.connection.cursors.latestPostId, '310', 'history expansion must not move the forward high-water');
  assert.equal(snapshot.connection.cursors.oldestPostId, '101');
  assert.equal(snapshot.connection.history.accountPostsExhausted, false, 'one older row remains available in the fixture');
  const providerCallCountBeforeReplay = providerCalls.length;
  const replay = await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('Idempotency-Key', accountExpansionKey).send({
      limit: 120, streams: ['account_posts'], planFingerprint: accountExpansion.estimate.planFingerprint
    }).expect(202);
  assert.equal(replay.body.created, false);
  assert.equal(replay.body.job.id, accountExpansion.job.id);
  assert.deepEqual(replay.body.estimate, accountExpansion.estimate, 'replay returns the frozen accepted estimate, not a plan rebuilt from newer cursors');
  assert.equal(providerCalls.length, providerCallCountBeforeReplay, 'idempotent replay must not call X');

  // Search history deliberately overlaps the just-cached account timeline.
  // X still charges/returns provider rows, while the durable cache links the
  // additional discovery stream without storing or analyzing a second copy.
  providerRows.searches.push(...descending(220, 101));
  expireSearchExpansionToken = true;
  const mentionsBeforeOverlap = Number((db.prepare('SELECT COUNT(*) count FROM social_mentions WHERE space_id=?').get(spaceId) as any).count);
  const searchExpansion = await enqueueExpansion(connectionId, 120, ['searches'], crypto.randomUUID());
  const searchJob = (await jobStatus(connectionId, searchExpansion.job.id)).job;
  assert.equal(searchJob.state, 'completed');
  assert.equal(searchJob.searchFetched, 120);
  assert.equal(searchJob.importedCount, 0);
  assert.equal(searchJob.reusedCount, 120);
  assert.equal(searchJob.providerRequests, 3, 'expired token attempt and safe boundary fallback are both audited');
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM social_mentions WHERE space_id=?').get(spaceId) as any).count), mentionsBeforeOverlap);
  const overlappingLink = db.prepare(`SELECT cm.streams_json,cm.query_ids_json FROM x_connection_mentions cm
    JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id=? AND m.external_id='220'`).get(connectionId) as any;
  assert.deepEqual(JSON.parse(overlappingLink.streams_json).sort(), ['account_post', 'search']);
  assert.deepEqual(JSON.parse(overlappingLink.query_ids_json), [mainQueryId]);
  const expiredAttempt = providerCalls.find((call) => call.target === 'searches' && call.status === 400);
  assert.equal(expiredAttempt?.token, 'page:searches:100');
  const fallbackCall = providerCalls.find((call) => call.target === 'searches' && call.status === 200 && call.untilId === '121' && !call.token);
  assert.deepEqual(fallbackCall?.returnedIds, descending(120, 101), 'search until_id is strict, so fallback starts at the saved low boundary');
  const searchRow = db.prepare('SELECT since_id,oldest_id,history_exhausted,configuration_version FROM x_listening_queries WHERE id=?').get(mainQueryId) as any;
  assert.equal(searchRow.since_id, '700');
  assert.equal(searchRow.oldest_id, '101');
  assert.equal(searchRow.history_exhausted, 1);
  assert.equal(searchRow.configuration_version, 1, 'operational page timestamps must not invalidate a multi-page query');

  // Paid expansion freezes the exact query/version/budget before dispatch.
  // If that query changes while queued, the preflight guard skips it before a
  // billable request; changing its text also unlinks its old associations.
  const guardedQuery = await owner.post(`/api/integrations/x/connections/${connectionId}/queries`)
    .send({ label: 'Guarded query', query: 'guarded-original', enabled: true }).expect(201);
  const overlapMention = db.prepare(`SELECT cm.mention_id,cm.streams_json,cm.query_ids_json FROM x_connection_mentions cm
    JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id=? AND m.external_id='220'`).get(connectionId) as any;
  db.prepare('UPDATE x_connection_mentions SET query_ids_json=? WHERE connection_id=? AND mention_id=?')
    .run(JSON.stringify([...new Set([...JSON.parse(overlapMention.query_ids_json), guardedQuery.body.id])]), connectionId, overlapMention.mention_id);
  const staleGuardedEstimate = await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=51&streams=searches`).expect(200);
  await owner.patch(`/api/integrations/x/queries/${guardedQuery.body.id}`).send({ label: 'Guarded query renamed' }).expect(200);
  await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      limit: 51, streams: ['searches'], planFingerprint: staleGuardedEstimate.body.planFingerprint
    }).expect(409);
  const guardedEstimate = await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=51&streams=searches`).expect(200);
  const guardedKey = crypto.randomUUID();
  const providerCallsBeforeGuardedJob = providerCalls.length;
  let guardedQueued: any;
  xSyncRunner.running = true;
  try {
    guardedQueued = (await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
      .set('Idempotency-Key', guardedKey).send({
        limit: 51, streams: ['searches'], planFingerprint: guardedEstimate.body.planFingerprint
      }).expect(202)).body;
    const frozenTarget = db.prepare('SELECT query_text,query_version,budget FROM x_sync_target_checkpoints WHERE job_id=?').get(guardedQueued.job.id) as any;
    assert.deepEqual(frozenTarget, { query_text: 'guarded-original', query_version: 2, budget: 51 });
    await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
      .set('Idempotency-Key', crypto.randomUUID()).send({
        limit: 51, streams: ['searches'], planFingerprint: guardedEstimate.body.planFingerprint
      }).expect(409);
    await owner.patch(`/api/integrations/x/queries/${guardedQuery.body.id}`).send({ query: 'guarded-updated' }).expect(200);
  } finally { xSyncRunner.running = false; }
  await xSyncRunner.pump();
  const guardedJob = (await jobStatus(connectionId, guardedQueued.job.id)).job;
  assert.equal(guardedJob.state, 'completed');
  assert.equal(guardedJob.targets[0].state, 'skipped');
  assert.equal(guardedJob.providerRequests, 0);
  assert.equal(providerCalls.length, providerCallsBeforeGuardedJob, 'stale query must be rejected before contacting X');
  const unlinkedGuarded = db.prepare('SELECT streams_json,query_ids_json FROM x_connection_mentions WHERE connection_id=? AND mention_id=?')
    .get(connectionId, overlapMention.mention_id) as any;
  assert.ok(!JSON.parse(unlinkedGuarded.query_ids_json).includes(guardedQuery.body.id));
  assert.ok(JSON.parse(unlinkedGuarded.streams_json).includes('search'), 'another query still owns the search discovery stream');
  const guardedReplay = await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('Idempotency-Key', guardedKey).send({
      limit: 51, streams: ['searches'], planFingerprint: guardedEstimate.body.planFingerprint
    }).expect(202);
  assert.equal(guardedReplay.body.created, false);
  assert.deepEqual(guardedReplay.body.estimate, guardedQueued.estimate);
  await owner.delete(`/api/integrations/x/queries/${guardedQuery.body.id}`).expect(204);

  // A short final page proves history exhaustion. Future estimates and jobs are
  // rejected before another paid provider request can be made.
  providerRows.mentions.push(...descending(420, 416));
  const mentionExpansion = await enqueueExpansion(connectionId, 60, ['mentions'], crypto.randomUUID());
  const mentionJob = (await jobStatus(connectionId, mentionExpansion.job.id)).job;
  assert.equal(mentionJob.state, 'completed');
  assert.equal(mentionJob.mentionsFetched, 5);
  snapshot = await status(connectionId);
  assert.equal(snapshot.connection.history.mentionsExhausted, true);
  const callsBeforeExhaustedRequest = providerCalls.length;
  await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=60&streams=mentions`).expect(409);
  await owner.post(`/api/integrations/x/connections/${connectionId}/expand`)
    .set('Idempotency-Key', crypto.randomUUID()).send({
      limit: 60, streams: ['mentions'], planFingerprint: `xplan_${'0'.repeat(64)}`
    }).expect(409);
  assert.equal(providerCalls.length, callsBeforeExhaustedRequest);

  // Expansion never silently drops paid search targets. Normal collection may
  // rotate one query at a time, but explicitly reports the deferred count.
  await owner.patch(`/api/integrations/x/queries/${mainQueryId}`).send({ enabled: false }).expect(200);
  for (let index = 1; index <= 6; index += 1) {
    await owner.post(`/api/integrations/x/connections/${connectionId}/queries`)
      .send({ label: `Extra query ${index}`, query: `extra-query-${index}`, enabled: true }).expect(201);
  }
  const tooSmall = await owner.get(`/api/integrations/x/connections/${connectionId}/expansion-estimate?limit=51&streams=searches`).expect(422);
  assert.match(tooSmall.body.error, /minimum 60/i);
  const deferredJobId = await enqueueNormal(connectionId);
  const deferredJob = (await jobStatus(connectionId, deferredJobId)).job;
  assert.equal(deferredJob.state, 'completed');
  assert.equal(deferredJob.selectedQueryIds.length, 1);
  assert.equal(deferredJob.deferredSearchQueries, 5);
  assert.equal(deferredJob.targets.filter((target: any) => target.stream === 'searches').length, 1);

  // Default intelligence is a bounded latest-50 snapshot, regardless of how
  // much durable X history is stored for the connection.
  const expectedLatest = (db.prepare(`SELECT cm.mention_id id FROM x_connection_mentions cm
    JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id=?
    ORDER BY m.published_at DESC,m.created_at DESC,m.id DESC LIMIT 50`).all(connectionId) as Array<{ id: string }>).map((row) => row.id);
  const report = createSocialIntelligenceReport({
    id: ownerRow.id, email: ownerRow.email, name: ownerRow.name, role: ownerRow.role,
    sessionVersion: Number(ownerRow.session_version), emailVerifiedAt: ownerRow.email_verified_at
  }, spaceId, { connectionId, title: 'Latest fifty bounded report' });
  assert.equal(report.report.mentionIds.length, 50);
  assert.deepEqual([...report.report.mentionIds].sort(), [...expectedLatest].sort());
  const reportRow = db.prepare('SELECT source_snapshot_json FROM social_intelligence_reports WHERE id=?').get(report.report.id) as any;
  const sourceOrder = (JSON.parse(reportRow.source_snapshot_json) as Array<{ sourceRef: string }>).map((item) => item.sourceRef.replace('x-post:', ''));
  assert.deepEqual(sourceOrder, expectedLatest, 'report snapshot must preserve latest-first selection order');

  // Static credentials supplied after disconnect belong to an unverified new
  // account. They must never reuse account A's row and relabel its durable
  // posts, queries, or reports as account B.
  const oldLinkCount = Number((db.prepare('SELECT COUNT(*) count FROM x_connection_mentions WHERE connection_id=?').get(connectionId) as any).count);
  const oldQueryCount = Number((db.prepare('SELECT COUNT(*) count FROM x_listening_queries WHERE connection_id=?').get(connectionId) as any).count);
  await owner.delete(`/api/integrations/x/connections/${connectionId}`).expect(204);
  const rejectedReplacement = await owner.put('/api/integrations/x/app').send({
    accessToken: 'replacement-static-access-token', accessTokenSecret: 'replacement-static-access-secret'
  }).expect(409);
  assert.match(rejectedReplacement.body.error, /retained history/i);
  const oldConnection = db.prepare('SELECT status,x_user_id,last_post_id FROM x_connections WHERE id=?').get(connectionId) as any;
  assert.deepEqual(oldConnection, { status: 'disconnected', x_user_id: '900000000000000123', last_post_id: '310' });
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_connection_mentions WHERE connection_id=?').get(connectionId) as any).count), oldLinkCount);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_listening_queries WHERE connection_id=?').get(connectionId) as any).count), oldQueryCount);
  const purgedOld = await owner.delete(`/api/integrations/x/connections/${connectionId}/history`).expect(200);
  assert.equal(purgedOld.body.connectionDeleted, true);
  assert.equal(db.prepare('SELECT 1 FROM x_connections WHERE id=?').get(connectionId), undefined);
  const replacement = await owner.put('/api/integrations/x/app').send({
    accessToken: 'replacement-static-access-token', accessTokenSecret: 'replacement-static-access-secret'
  }).expect(200);
  const replacementId = replacement.body.connection.id as string;
  assert.notEqual(replacementId, connectionId);
  const cleanReplacement = db.prepare(`SELECT status,x_user_id,username,last_sync_at,last_success_at,last_post_id,last_mention_id,
    oldest_post_id,oldest_mention_id,post_backlog_token,mention_backlog_token,rate_limit_json FROM x_connections WHERE id=?`).get(replacementId) as any;
  assert.deepEqual(cleanReplacement, {
    status: 'pending_verification', x_user_id: null, username: null, last_sync_at: null, last_success_at: null,
    last_post_id: null, last_mention_id: null, oldest_post_id: null, oldest_mention_id: null,
    post_backlog_token: null, mention_backlog_token: null, rate_limit_json: '{}'
  });
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_connection_mentions WHERE connection_id=?').get(replacementId) as any).count), 0);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_listening_queries WHERE connection_id=?').get(replacementId) as any).count), 0);

  const replacementQuery = await owner.post(`/api/integrations/x/connections/${replacementId}/queries`)
    .send({ label: 'Replacement telemetry', query: 'replacement telemetry', enabled: true }).expect(201);
  db.prepare(`UPDATE x_connections SET last_sync_at='2026-07-30T10:00:00.000Z',last_success_at='2026-07-30T10:01:00.000Z',
    last_error='old error',last_post_id='999',last_mention_id='998',oldest_post_id='900',oldest_mention_id='899',
    post_backlog_token='old-post-token',mention_backlog_token='old-mention-token',rate_limit_json='{"remaining":1}' WHERE id=?`).run(replacementId);
  db.prepare(`UPDATE x_listening_queries SET since_id='997',oldest_id='901',backlog_token='old-query-token',
    last_sync_at='2026-07-30T10:00:00.000Z',last_success_at='2026-07-30T10:01:00.000Z',last_error='old query error' WHERE id=?`).run(replacementQuery.body.id);
  await owner.delete(`/api/integrations/x/connections/${replacementId}/history`).expect(200);
  const resetConnection = db.prepare(`SELECT last_sync_at,last_success_at,last_error,last_post_id,last_mention_id,oldest_post_id,oldest_mention_id,
    post_backlog_token,mention_backlog_token,rate_limit_json FROM x_connections WHERE id=?`).get(replacementId) as any;
  assert.deepEqual(resetConnection, {
    last_sync_at: null, last_success_at: null, last_error: null, last_post_id: null, last_mention_id: null,
    oldest_post_id: null, oldest_mention_id: null, post_backlog_token: null, mention_backlog_token: null, rate_limit_json: '{}'
  });
  const resetQuery = db.prepare('SELECT since_id,oldest_id,backlog_token,last_sync_at,last_success_at,last_error FROM x_listening_queries WHERE id=?')
    .get(replacementQuery.body.id) as any;
  assert.deepEqual(resetQuery, { since_id: null, oldest_id: null, backlog_token: null, last_sync_at: null, last_success_at: null, last_error: null });
});
