import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-x-oauth2-'));
const files = {
  password: path.join(root, 'admin-password'),
  session: path.join(root, 'session-secret'),
  webhook: path.join(root, 'brevo-webhook-secret'),
  xKey: path.join(root, 'x-credential-encryption-key'),
  esignKey: path.join(root, 'esign-encryption-key')
};
const frontendDist = path.join(root, 'frontend-dist');
fs.mkdirSync(frontendDist, { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>X OAuth test</title>');
fs.writeFileSync(files.password, 'X-OAuth-Test-Password-2026!');
fs.writeFileSync(files.session, 'x-oauth-test-session-secret-that-is-long-enough');
fs.writeFileSync(files.webhook, 'x-oauth-test-webhook-secret-that-is-long-enough');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 14).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 15).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: frontendDist,
  PUBLIC_URL: 'http://127.0.0.1:5413',
  ADMIN_EMAIL: 'x-owner@example.test',
  ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session,
  BREVO_WEBHOOK_SECRET_FILE: files.webhook,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files.esignKey,
  EMAIL_MODE: 'log',
  X_API_BASE_URL: 'https://api.x.invalid',
  X_OAUTH_BASE_URL: 'https://api.x.invalid',
  X_OAUTH2_AUTHORIZE_BASE_URL: 'https://x.invalid',
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'absent-consumer-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'absent-consumer-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'absent-bearer-token'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'absent-access-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'absent-access-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'absent-client-id'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'absent-client-secret')
});

const { app } = await import('../src/app.js');
const { db, insertSocialMentions } = await import('../src/database.js');
const { xSyncRunner } = await import('../src/xIntegration.js');

const owner = request.agent(app);
const member = request.agent(app);
const oauthApp = {
  clientId: 'test-oauth2-client-id-12345',
  clientSecret: 'test-oauth2-client-secret-67890'
};
const accounts = [
  { id: '900000000000000001', username: 'research_account_one', name: 'Research Account One' },
  { id: '900000000000000002', username: 'research_account_two', name: 'Research Account Two' }
];
let connectionIds: string[] = [];

after(async () => {
  await xSyncRunner.pump();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function cookieFrom(response: request.Response) {
  const values = response.headers['set-cookie'] as unknown as string[];
  const value = values.find((item) => item.startsWith('seemplify_x_oauth_'));
  assert.ok(value, 'OAuth handshake cookie was not set');
  return value.split(';')[0];
}

async function waitForSyncState(connectionId: string, state: string, minimumAttempt = 1) {
  for (let index = 0; index < 100; index += 1) {
    const snapshot = await owner.get(`/api/integrations/x?connectionId=${encodeURIComponent(connectionId)}`).expect(200);
    const job = snapshot.body.syncJobs[0];
    if (job?.state === state && Number(job.attempt) >= minimumAttempt) return snapshot.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`X sync did not reach ${state}`);
}

test('uses PKCE to connect two OAuth 2 X accounts without exposing stored secrets', async () => {
  await signupVerifyAndOnboard(owner, {
    name: 'X Workspace Owner', email: 'x-owner@example.test', password: 'X-OAuth-Test-Password-2026!'
  });
  await signupVerifyAndOnboard(member, {
    name: 'X Workspace Member', email: 'x-member@example.test', password: 'X-Member-Test-Password-2026!'
  });

  const configured = await owner.put('/api/integrations/x/app').send(oauthApp).expect(200);
  assert.equal(configured.body.app.oauth2Configured, true);
  assert.doesNotMatch(JSON.stringify(configured.body), new RegExp(oauthApp.clientId));
  assert.doesNotMatch(JSON.stringify(configured.body), new RegExp(oauthApp.clientSecret));
  const storedApp = db.prepare('SELECT client_id_enc,client_secret_enc FROM x_apps WHERE id=?').get('workspace-x-app') as any;
  assert.notEqual(storedApp.client_id_enc, oauthApp.clientId);
  assert.notEqual(storedApp.client_secret_enc, oauthApp.clientSecret);

  const originalFetch = globalThis.fetch;
  const exchanges: Array<{ code: string; verifier: string; redirectUri: string; authorization: string }> = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith('/2/oauth2/token')) {
      const fields = new URLSearchParams(String(init?.body || ''));
      const code = String(fields.get('code') || '');
      const suffix = code.endsWith('two') ? 'two' : 'one';
      exchanges.push({
        code,
        verifier: String(fields.get('code_verifier') || ''),
        redirectUri: String(fields.get('redirect_uri') || ''),
        authorization: String(headers.get('authorization') || '')
      });
      return new Response(JSON.stringify({
        token_type: 'bearer', expires_in: 7200,
        access_token: `oauth2-access-${suffix}-not-real`,
        refresh_token: `oauth2-refresh-${suffix}-not-real`,
        scope: 'tweet.read tweet.write users.read offline.access'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/2/users/me')) {
      const authorization = String(headers.get('authorization') || '');
      const account = authorization.includes('access-two') ? accounts[1] : accounts[0];
      return new Response(JSON.stringify({ data: account }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-rate-limit-limit': '75', 'x-rate-limit-remaining': '74' }
      });
    }
    return new Response(JSON.stringify({ title: 'Unexpected test request' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };

  try {
    const starts = await Promise.all(accounts.map(() => owner.post('/api/integrations/x/connect').send({}).expect(201)));
    assert.notEqual(cookieFrom(starts[0]).split('=')[0], cookieFrom(starts[1]).split('=')[0], 'parallel OAuth requests need independent cookies');
    const authorizations = starts.map((started) => new URL(started.body.authorizeUrl));
    for (const authorizeUrl of authorizations) {
      assert.equal(authorizeUrl.origin, 'https://x.invalid');
      assert.equal(authorizeUrl.pathname, '/i/oauth2/authorize');
      assert.equal(authorizeUrl.searchParams.get('response_type'), 'code');
      assert.equal(authorizeUrl.searchParams.get('client_id'), oauthApp.clientId);
      assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:5413/api/integrations/x/callback');
      assert.equal(authorizeUrl.searchParams.get('scope'), 'tweet.read tweet.write users.read offline.access');
      assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(authorizeUrl.searchParams.get('state'));
      assert.ok(authorizeUrl.searchParams.get('code_challenge'));
      assert.doesNotMatch(authorizeUrl.toString(), new RegExp(oauthApp.clientSecret));
    }
    const callbacks = await Promise.all(authorizations.map((authorizeUrl, index) => {
      const state = authorizeUrl.searchParams.get('state')!;
      return request(app)
        .get(`/api/integrations/x/callback?code=approved-code-${index ? 'two' : 'one'}&state=${encodeURIComponent(state)}`)
        .set('Cookie', cookieFrom(starts[index]))
        .expect(303);
    }));
    for (const [index, callback] of callbacks.entries()) {
      assert.equal(callback.headers.location, '/social-listening?x=connected');
      const exchange = exchanges.find((candidate) => candidate.code === `approved-code-${index ? 'two' : 'one'}`)!;
      assert.equal(exchange.code, `approved-code-${index ? 'two' : 'one'}`);
      assert.equal(exchange.redirectUri, 'http://127.0.0.1:5413/api/integrations/x/callback');
      assert.equal(exchange.authorization, `Basic ${Buffer.from(`${oauthApp.clientId}:${oauthApp.clientSecret}`).toString('base64')}`);
      assert.equal(
        crypto.createHash('sha256').update(exchange.verifier).digest('base64url'),
        authorizations[index].searchParams.get('code_challenge')
      );

      const state = authorizations[index].searchParams.get('state')!;
      await request(app)
        .get(`/api/integrations/x/callback?code=replayed-code&state=${encodeURIComponent(state)}`)
        .set('Cookie', cookieFrom(starts[index]))
        .expect(303)
        .expect('Location', '/social-listening?x=failed');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const status = await owner.get('/api/integrations/x').expect(200);
  const oauth2Connections = status.body.connections.filter((connection: any) => connection.authType === 'oauth2');
  assert.equal(oauth2Connections.length, 2);
  assert.deepEqual(oauth2Connections.map((connection: any) => connection.account.id).sort(), accounts.map((account) => account.id).sort());
  connectionIds = oauth2Connections.map((connection: any) => connection.id);

  const secretValues = [
    oauthApp.clientSecret,
    'oauth2-access-one-not-real', 'oauth2-refresh-one-not-real',
    'oauth2-access-two-not-real', 'oauth2-refresh-two-not-real'
  ];
  const publicStatus = JSON.stringify(status.body);
  for (const secret of secretValues) assert.doesNotMatch(publicStatus, new RegExp(secret));
  const storedConnections = db.prepare("SELECT access_token_enc,refresh_token_enc,scopes_json FROM x_connections WHERE auth_type='oauth2' ORDER BY x_user_id").all() as any[];
  assert.equal(storedConnections.length, 2);
  for (const [index, row] of storedConnections.entries()) {
    assert.notEqual(row.access_token_enc, `oauth2-access-${index ? 'two' : 'one'}-not-real`);
    assert.notEqual(row.refresh_token_enc, `oauth2-refresh-${index ? 'two' : 'one'}-not-real`);
    assert.deepEqual(JSON.parse(row.scopes_json), ['tweet.read', 'tweet.write', 'users.read', 'offline.access']);
  }

  const oauthRows = db.prepare("SELECT request_token_hash,request_secret_enc,consumed_at FROM x_oauth_requests WHERE flow='oauth2'").all() as any[];
  assert.equal(oauthRows.length, 2);
  assert.ok(oauthRows.every((row) => /^[a-f0-9]{64}$/.test(row.request_token_hash) && row.consumed_at));
  for (const exchange of exchanges) assert.ok(oauthRows.every((row) => !String(row.request_secret_enc).includes(exchange.verifier)));

  await member.get(`/api/integrations/x?connectionId=${encodeURIComponent(connectionIds[0])}`).expect(404);
  const memberStatus = await member.get('/api/integrations/x').expect(200);
  assert.deepEqual(memberStatus.body.connections, []);
});

test('publishes a reviewed reply exactly once and preserves its X receipt', async () => {
  const connectionId = connectionIds[0];
  const connection = db.prepare('SELECT space_id,user_id FROM x_connections WHERE id=?').get(connectionId) as { space_id: string; user_id: string };
  const mentionId = crypto.randomUUID(); const draftId = crypto.randomUUID(); const timestamp = new Date().toISOString();
  insertSocialMentions([{
    id: mentionId, source: 'x', externalId: '1888888888888888888', xConnectionId: connectionId,
    ingestionKind: 'mention', author: '@customer', content: 'Could someone help me finish setup?',
    url: 'https://x.com/customer/status/1888888888888888888', language: 'en', publishedAt: timestamp
  }], connection.space_id);
  db.prepare(`INSERT INTO x_connection_mentions (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
    VALUES (?,?,'["mention"]','[]',?,?)`).run(connectionId, mentionId, timestamp, timestamp);
  db.prepare(`INSERT INTO social_reply_drafts
    (id,space_id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,generated_content,content,rationale,safety_flags_json,created_at,completed_at,updated_at)
    VALUES (?,?,?,?,?,'helpful','','{}','edited',?,?,?,'[]',?,?,?)`).run(
    draftId, connection.space_id, mentionId, connectionId, connection.user_id,
    'We can help you complete setup today.', 'We can help you complete setup today.', 'Clear and helpful.', timestamp, timestamp, timestamp
  );

  const originalFetch = globalThis.fetch; let publishCalls = 0; let failAmbiguously = false;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const headers = new Headers(init?.headers);
    if (url.endsWith('/2/tweets') && init?.method === 'POST') {
      publishCalls += 1;
      if (failAmbiguously) throw new TypeError('Simulated connection loss after dispatch.');
      assert.match(String(headers.get('authorization')), /^Bearer oauth2-access-/);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(init.body)), {
        text: 'We can help you complete setup today.', reply: { in_reply_to_tweet_id: '1888888888888888888' }
      });
      return new Response(JSON.stringify({ data: { id: '1999999999999999999', text: 'We can help you complete setup today.' } }), {
        status: 201, headers: { 'content-type': 'application/json', 'x-rate-limit-limit': '200', 'x-rate-limit-remaining': '199' }
      });
    }
    return new Response(JSON.stringify({ title: 'Unexpected test request' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };
  try {
    const posted = await owner.post(`/api/social/reply-drafts/${draftId}/publish`)
      .set('x-request-id', 'reply-publication-test').send({ content: 'We can help you complete setup today.', confirmation: true }).expect(201);
    assert.equal(posted.body.replayed, false);
    assert.equal(posted.body.publication.tweetId, '1999999999999999999');
    assert.equal(posted.body.publication.url, 'https://x.com/research_account_one/status/1999999999999999999');
    const replay = await owner.post(`/api/social/reply-drafts/${draftId}/publish`)
      .send({ content: 'We can help you complete setup today.', confirmation: true }).expect(200);
    assert.equal(replay.body.replayed, true);
    assert.equal(publishCalls, 1);
    const saved = (await owner.get('/api/social/reply-drafts').expect(200)).body.find((item: any) => item.id === draftId);
    assert.equal(saved.state, 'published');
    assert.equal(saved.publication.tweetId, '1999999999999999999');
    assert.equal((db.prepare("SELECT COUNT(*) count FROM platform_audit_events WHERE target_id=? AND action='social_reply.published'").get(draftId) as any).count, 1);

    const uncertainDraftId = crypto.randomUUID();
    db.prepare(`INSERT INTO social_reply_drafts
      (id,space_id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,generated_content,content,rationale,safety_flags_json,created_at,completed_at,updated_at)
      VALUES (?,?,?,?,?,'helpful','','{}','edited',?,?,?,'[]',?,?,?)`).run(
      uncertainDraftId, connection.space_id, mentionId, connectionId, connection.user_id,
      'Please check your direct messages for help.', 'Please check your direct messages for help.', 'Offers a support path.', timestamp, timestamp, timestamp
    );
    failAmbiguously = true;
    const uncertain = await owner.post(`/api/social/reply-drafts/${uncertainDraftId}/publish`)
      .send({ content: 'Please check your direct messages for help.', confirmation: true }).expect(409);
    assert.match(uncertain.body.error, /did not confirm whether the reply was posted/i);
    assert.equal((db.prepare('SELECT state FROM social_reply_drafts WHERE id=?').get(uncertainDraftId) as any).state, 'publish_unknown');
    await owner.post(`/api/social/reply-drafts/${uncertainDraftId}/publish`)
      .send({ content: 'Please check your direct messages for help.', confirmation: true }).expect(409);
    assert.equal(publishCalls, 2, 'an ambiguous result must never be automatically retried');
    assert.equal((db.prepare("SELECT COUNT(*) count FROM platform_audit_events WHERE target_id=? AND action='social_reply.publication_unknown'").get(uncertainDraftId) as any).count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('fans billing failure across accounts and releases every durable waiter after one successful credit probe', async () => {
  assert.equal(connectionIds.length, 2, 'OAuth accounts must be connected before testing sync billing');
  const targetId = connectionIds[0];
  const waitingId = connectionIds[1];
  const target = (await owner.get(`/api/integrations/x?connectionId=${encodeURIComponent(targetId)}`).expect(200)).body.connection;
  db.prepare('UPDATE x_connections SET auto_sync=1,next_sync_at=? WHERE id=?').run(new Date().toISOString(), targetId);
  const originalFetch = globalThis.fetch;
  let creditsAvailable = false;
  let timelineCalls = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = String(new Headers(init?.headers).get('authorization') || '');
    if (url.includes('/2/users/me')) {
      assert.match(authorization, /^Bearer oauth2-access-/);
      const account = authorization.includes('access-two') ? accounts[1] : accounts[0];
      return new Response(JSON.stringify({ data: account }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/tweets')) {
      timelineCalls += 1;
      if (!creditsAvailable) return new Response(JSON.stringify({
        detail: 'credits depleted', status: 402, title: 'Payment Required',
        type: 'https://api.x.invalid/2/problems/credits-depleted'
      }), { status: 402, headers: { 'content-type': 'application/problem+json' } });
    }
    if (url.includes('/tweets') || url.includes('/mentions')) return new Response(JSON.stringify({ data: [], meta: { result_count: 0 } }), {
      status: 200, headers: { 'content-type': 'application/json', 'x-rate-limit-limit': '75', 'x-rate-limit-remaining': '74' }
    });
    return new Response(JSON.stringify({ title: 'Unexpected test request' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };

  try {
    // Hold dispatch long enough to create one FIFO job per account. The first
    // 402 must fan out and preserve the second job without attempting it.
    xSyncRunner.running = true;
    const queued = await owner.post(`/api/integrations/x/connections/${targetId}/sync`).send({}).expect(202);
    const alsoQueued = await owner.post(`/api/integrations/x/connections/${waitingId}/sync`).send({}).expect(202);
    xSyncRunner.running = false;
    await xSyncRunner.pump();
    assert.equal(queued.body.created, true);
    assert.equal(alsoQueued.body.created, true);
    const first = await waitForSyncState(targetId, 'waiting_billing', 1);
    const waiting = await waitForSyncState(waitingId, 'waiting_billing', 0);
    assert.equal(first.syncJobs[0].id, queued.body.job.id);
    assert.equal(first.syncJobs[0].stage, 'credits_required');
    assert.equal(first.syncJobs[0].completedAt, null);
    assert.equal(first.syncJobs[0].runAfter, null);
    assert.match(first.syncJobs[0].error, /credits are depleted/i);
    assert.equal(first.connection.status, 'action_required');
    assert.equal(first.connection.autoSync, true, 'billing must not erase the account auto-sync preference');
    assert.equal(first.app.billing.status, 'credits_depleted');
    assert.match(first.app.billing.problemType, /credits-depleted/);
    assert.equal(waiting.syncJobs[0].id, alsoQueued.body.job.id);
    assert.equal(waiting.syncJobs[0].attempt, 0, 'global billing block must prevent a second provider call');

    creditsAvailable = true;
    xSyncRunner.running = true;
    const resumed = await owner.post(`/api/integrations/x/connections/${targetId}/sync`).send({}).expect(202);
    assert.equal(resumed.body.created, false);
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.job.id, queued.body.job.id);
    assert.equal(resumed.body.job.creditProbe, true);
    const durableProbe = db.prepare('SELECT state,stage,credit_probe FROM x_sync_jobs WHERE id=?').get(queued.body.job.id) as any;
    assert.deepEqual(durableProbe, { state: 'queued', stage: 'checking_credits', credit_probe: 1 });
    assert.equal((db.prepare("SELECT billing_status FROM x_apps WHERE id='workspace-x-app'").get() as any).billing_status, 'checking_credits');
    assert.equal((db.prepare('SELECT credit_probe FROM x_sync_jobs WHERE id=?').get(alsoQueued.body.job.id) as any).credit_probe, 0);
    xSyncRunner.running = false;
    await xSyncRunner.pump();
    const second = await waitForSyncState(targetId, 'completed', 2);
    const released = await waitForSyncState(waitingId, 'completed', 1);
    assert.equal(second.syncJobs[0].id, queued.body.job.id);
    assert.equal(second.syncJobs[0].attempt, 2);
    assert.equal(second.app.billing.status, 'ready');
    assert.equal(second.connection.autoSync, true);
    assert.ok(second.connection.nextSyncAt);
    assert.equal(released.syncJobs[0].id, alsoQueued.body.job.id);
    assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_sync_jobs WHERE connection_id=?').get(targetId) as any).count), 1);
    assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM x_sync_jobs WHERE connection_id=?').get(waitingId) as any).count), 1);
    assert.equal(timelineCalls, 3);
  } finally {
    xSyncRunner.running = false;
    globalThis.fetch = originalFetch;
  }
});

test('disconnect cancels a billing waiter and deleting its history removes the disconnected account tombstone', async () => {
  const connectionId = connectionIds[1];
  const timestamp = new Date().toISOString();
  db.prepare("UPDATE x_apps SET billing_status='credits_depleted',billing_problem_type='credits-depleted',updated_at=? WHERE id='workspace-x-app'").run(timestamp);
  const waitingJobId = crypto.randomUUID();
  db.prepare(`INSERT INTO x_sync_jobs (id,connection_id,trigger_type,state,stage,progress,attempt,error,created_at,updated_at)
    VALUES (?,?,'manual','waiting_billing','credits_required',0,0,'credits required',?,?)`).run(waitingJobId, connectionId, timestamp, timestamp);
  await owner.delete(`/api/integrations/x/connection?connectionId=${encodeURIComponent(connectionId)}`).expect(204);
  const cancelled = db.prepare('SELECT state FROM x_sync_jobs WHERE id=?').get(waitingJobId) as { state: string };
  assert.equal(cancelled.state, 'cancelled');
  await owner.delete(`/api/integrations/x/history?connectionId=${encodeURIComponent(connectionId)}`).expect(200);
  assert.equal(db.prepare('SELECT id FROM x_connections WHERE id=?').get(connectionId), undefined);
});

test('deleting collected history during a credit probe cannot strand the global billing queue', async () => {
  const connectionId = connectionIds[0];
  const timestamp = new Date().toISOString();
  db.prepare("UPDATE x_apps SET billing_status='credits_depleted',billing_problem_type='credits-depleted',updated_at=? WHERE id='workspace-x-app'").run(timestamp);
  db.prepare("UPDATE x_sync_jobs SET created_at='2020-01-01T00:00:00.000Z' WHERE connection_id=?").run(connectionId);
  xSyncRunner.running = true;
  const started = await owner.post(`/api/integrations/x/connections/${connectionId}/sync`).send({}).expect(202);
  xSyncRunner.running = false;
  assert.equal(started.body.created, true);
  assert.equal(started.body.resumed, true);
  assert.equal(started.body.job.creditProbe, true);
  const probeId = started.body.job.id;
  const atomicState = db.prepare(`SELECT s.state,s.credit_probe,a.billing_status FROM x_sync_jobs s JOIN x_connections c ON c.id=s.connection_id
    JOIN x_apps a ON a.id=c.app_id WHERE s.id=?`).get(probeId) as any;
  assert.deepEqual(atomicState, { state: 'queued', credit_probe: 1, billing_status: 'checking_credits' });
  db.prepare("UPDATE x_sync_jobs SET stage='retrying',attempt=1,run_after=? WHERE id=?")
    .run(new Date(Date.now() + 60_000).toISOString(), probeId);
  await owner.delete(`/api/integrations/x/history?connectionId=${encodeURIComponent(connectionId)}`).expect(200);
  const status = await owner.get(`/api/integrations/x?connectionId=${encodeURIComponent(connectionId)}`).expect(200);
  assert.equal(status.body.app.billing.status, 'credits_depleted');
  assert.equal(db.prepare('SELECT id FROM x_sync_jobs WHERE id=?').get(probeId), undefined);
});

test('disconnecting a rate-limited credit probe resets global billing and cancels the durable job', async () => {
  const connectionId = connectionIds[0];
  const timestamp = new Date().toISOString();
  const probeId = crypto.randomUUID();
  db.prepare("UPDATE x_apps SET billing_status='checking_credits',billing_problem_type='credits-depleted',updated_at=? WHERE id='workspace-x-app'").run(timestamp);
  db.prepare(`INSERT INTO x_sync_jobs (id,connection_id,trigger_type,state,stage,progress,attempt,credit_probe,run_after,error,created_at,updated_at)
    VALUES (?,?,'manual','waiting_rate_limit','waiting_rate_limit',20,1,1,?,NULL,?,?)`)
    .run(probeId, connectionId, new Date(Date.now() + 60_000).toISOString(), timestamp, timestamp);
  await owner.delete(`/api/integrations/x/connections/${connectionId}`).expect(204);
  const app = db.prepare("SELECT billing_status FROM x_apps WHERE id='workspace-x-app'").get() as any;
  const cancelled = db.prepare('SELECT state,credit_probe FROM x_sync_jobs WHERE id=?').get(probeId) as any;
  assert.equal(app.billing_status, 'credits_depleted');
  assert.deepEqual(cancelled, { state: 'cancelled', credit_probe: 1 });
});
