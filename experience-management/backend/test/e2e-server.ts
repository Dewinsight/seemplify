import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const liveKnowledge = process.env.KNOWLEDGE_E2E_LIVE === '1';
const repositoryRoot = path.resolve(process.cwd(), '..');
const liveRunId = crypto.randomBytes(16).toString('hex');
const liveSpaceId = `knowledge-live-benchmark-${liveRunId}`;
const state = liveKnowledge
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-knowledge-e2e-'))
  : path.resolve(repositoryRoot, '.local-runtime', 'experience-management', 'e2e');
if (!liveKnowledge) fs.rmSync(state, { recursive: true, force: true });
fs.mkdirSync(state, { recursive: true });
const passwordFile = path.join(state, 'admin-password'); const sessionFile = path.join(state, 'session-secret');
const xKeyFile = path.join(state, 'x-credential-encryption-key');
const nylasKeyFile = path.join(state, 'nylas-credential-encryption-key');
const esignKeyFile = path.join(state, 'esign-encryption-key');
const knowledgeSecretFile = liveKnowledge
  ? path.resolve(process.env.KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE
    || path.join(repositoryRoot, '.local-runtime', 'knowledge', 'service-secret'))
  : path.join(state, 'knowledge-secret');
const terraSecretFile = liveKnowledge
  ? path.resolve(process.env.TERRA_GATEWAY_SHARED_SECRET_FILE
    || path.join(repositoryRoot, '.local-runtime', 'llm', 'service-secret'))
  : path.join(state, 'terra-secret');
const knowledgeRuntimeBaseUrl = String(process.env.KNOWLEDGE_RUNTIME_BASE_URL || 'http://127.0.0.1:11540').replace(/\/+$/, '');
const terraGatewayBaseUrl = String(process.env.TERRA_GATEWAY_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const knowledgeStagingRoot = process.env.SEEMPLIFY_KNOWLEDGE_STAGING_DIR
  || path.join(path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_DATA_ROOT || 'D:\\SeemplifyKnowledge'), 'staging');
const knowledgeStorageDir = liveKnowledge ? path.join(knowledgeStagingRoot, `experience-e2e-${liveRunId}`) : path.join(state, 'knowledge');
const e2eDatabaseProvider = String(process.env.EXPERIENCE_E2E_DATABASE_PROVIDER || 'sqlite');
if (!['sqlite', 'postgres'].includes(e2eDatabaseProvider)) {
  throw new Error(`Unsupported E2E database provider: ${e2eDatabaseProvider}.`);
}
if (e2eDatabaseProvider === 'postgres') {
  const runId = String(process.env.EXPERIENCE_POSTGRES_E2E_RUN_ID || '');
  const postgresHost = String(process.env.POSTGRES_HOST || '');
  const postgresDatabase = String(process.env.POSTGRES_DATABASE || '');
  const postgresUser = String(process.env.POSTGRES_USER || '');
  const postgresPasswordFile = path.resolve(String(process.env.POSTGRES_PASSWORD_FILE || ''));
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!/^[a-f0-9]{12}$/u.test(runId)
    || !['127.0.0.1', '::1', 'localhost'].includes(postgresHost)
    || postgresDatabase !== `experience_e2e_${runId}`
    || postgresUser !== `experience_e2e_app_${runId}`
    || !postgresPasswordFile.startsWith(`${temporaryRoot}${path.sep}experience-pg-e2e-`)) {
    throw new Error('PostgreSQL E2E refused a database that was not provisioned by the isolated test harness.');
  }
}
fs.writeFileSync(passwordFile, 'Playwright-Test-Password-2026!'); fs.writeFileSync(sessionFile, 'playwright-session-secret-longer-than-twenty-characters'); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 11).toString('base64url')); fs.writeFileSync(nylasKeyFile, Buffer.alloc(32, 13).toString('base64url')); fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 12).toString('base64url'));
if (liveKnowledge) {
  for (const filename of [knowledgeSecretFile, terraSecretFile]) {
    if (!fs.existsSync(filename) || fs.readFileSync(filename, 'utf8').trim().length < 32) {
      throw new Error(`KNOWLEDGE_E2E_LIVE requires the configured local runtime secret: ${filename}`);
    }
  }
} else {
  fs.writeFileSync(knowledgeSecretFile, 'playwright-knowledge-secret-longer-than-thirty-two-characters');
  fs.writeFileSync(terraSecretFile, 'playwright-terra-secret-longer-than-thirty-two-characters');
}
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: '5412', PUBLIC_URL: 'http://127.0.0.1:5412', DATABASE_PATH: path.join(state, 'e2e.sqlite'), UPLOAD_DIR: path.join(state, 'uploads'),
  CODEX_RUNTIME_DIR: path.join(state, 'codex'),
  DATABASE_PROVIDER: e2eDatabaseProvider,
  SUBSCRIPTION_ENFORCEMENT_ENABLED: 'true',
  ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', AI_WORKER_CONCURRENCY: '1', LOCAL_LLM_BASE_URL: 'http://127.0.0.1:9',
  ESIGN_STORAGE_DIR: path.join(state, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, ESIGN_WORKER_POLL_MS: '250',
  KNOWLEDGE_STORAGE_DIR: knowledgeStorageDir, KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: knowledgeSecretFile,
  KNOWLEDGE_RUNTIME_BASE_URL: liveKnowledge ? knowledgeRuntimeBaseUrl : 'http://127.0.0.1:9', KNOWLEDGE_WORKER_POLL_MS: liveKnowledge ? '1000' : '250',
  ...(liveKnowledge ? {
    TERRA_GATEWAY_BASE_URL: terraGatewayBaseUrl,
    TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
    LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile
  } : {
    TERRA_GATEWAY_BASE_URL: 'http://127.0.0.1:5493',
    TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
    LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile
  }),
  NYLAS_CLIENT_ID: 'experience-e2e-client', NYLAS_API_KEY: 'experience-e2e-api-key-not-live', NYLAS_API_URI: 'http://127.0.0.1:5492',
  NYLAS_REDIRECT_URI: 'http://127.0.0.1:5412/api/integrations/nylas/callback', NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE: nylasKeyFile,
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(state, 'no-x-consumer-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(state, 'no-x-consumer-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(state, 'no-x-bearer-token'), X_SEED_ACCESS_TOKEN_FILE: path.join(state, 'no-x-access-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(state, 'no-x-access-token-secret')
});

function sendJson(response: http.ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
}
async function requestJson(request: http.IncomingMessage) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error('Test request is too large.');
  }
  return body ? JSON.parse(body) as any : {};
}
function listen(server: http.Server, port: number) {
  return new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
}

const fakeNylas = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1:5492');
  if (request.method === 'GET' && url.pathname === '/v3/connect/auth') {
    const callback = new URL(String(url.searchParams.get('redirect_uri')));
    callback.searchParams.set('state', String(url.searchParams.get('state')));
    callback.searchParams.set('code', 'playwright-oauth-code');
    response.writeHead(302, { location: callback.toString() }); response.end(); return;
  }
  if (request.method === 'POST' && url.pathname === '/v3/connect/token') {
    const body = await requestJson(request);
    if (body.client_id !== 'experience-e2e-client' || body.client_secret !== 'experience-e2e-api-key-not-live'
      || body.grant_type !== 'authorization_code' || body.code_verifier !== 'nylas') {
      return sendJson(response, { error: 'invalid test exchange' }, 400);
    }
    return sendJson(response, { data: { grant_id: 'playwright-grant', email: 'connected@example.test', provider: 'google' } });
  }
  if (request.method === 'GET' && url.pathname === '/v3/grants/playwright-grant/threads') return sendJson(response, { data: [{
    id: 'playwright-thread', subject: 'Board pack review', snippet: 'Please confirm the revised customer-risk section by Friday.',
    participants: [{ name: 'Ada Okafor', email: 'ada@example.test' }], message_count: 2, last_message_timestamp: 1_785_500_000
  }] });
  if (request.method === 'GET' && url.pathname === '/v3/grants/playwright-grant/threads/playwright-thread') return sendJson(response, { data: {
    id: 'playwright-thread', subject: 'Board pack review', participants: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
    message_count: 2, last_message_timestamp: 1_785_500_000
  } });
  if (request.method === 'GET' && url.pathname === '/v3/grants/playwright-grant/messages') return sendJson(response, { data: [
    { id: 'playwright-message-1', subject: 'Board pack review', date: 1_785_499_000 },
    { id: 'playwright-message-2', subject: 'Re: Board pack review', date: 1_785_500_000 }
  ] });
  if (request.method === 'GET' && url.pathname === '/v3/grants/playwright-grant/messages/playwright-message-1') return sendJson(response, { data: {
    id: 'playwright-message-1', subject: 'Board pack review', date: 1_785_499_000,
    from: [{ name: 'Ada Okafor', email: 'ada@example.test' }], to: [{ email: 'qa@seemplify.local' }],
    body: '<p>Please confirm the revised customer-risk section by Friday.</p>'
  } });
  if (request.method === 'GET' && url.pathname === '/v3/grants/playwright-grant/messages/playwright-message-2') return sendJson(response, { data: {
    id: 'playwright-message-2', subject: 'Re: Board pack review', date: 1_785_500_000,
    from: [{ email: 'qa@seemplify.local' }], to: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
    body: '<p>I will review the section before the deadline.</p>'
  } });
  if (request.method === 'DELETE' && url.pathname === '/v3/grants/playwright-grant') return sendJson(response, { data: { id: 'playwright-grant' } });
  return sendJson(response, { error: 'not found' }, 404);
});

const fakeTerra = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1:5493');
  const body = await requestJson(request);
  if (request.method === 'POST' && url.pathname === '/v1/status') return sendJson(response, {
    runtimeProfile: 'experience-management', health: { ok: true }, providerLabel: 'Terra (Playwright)', model: 'gpt-5.6-terra'
  });
  if (request.method !== 'POST' || url.pathname !== '/v1/complete') return sendJson(response, { error: 'not found' }, 404);
  let data: unknown;
  if (body.activity === 'experience.assistant.email_summarise') data = {
    summary: 'Ada needs confirmation of the revised customer-risk section by Friday.',
    keyPoints: ['The customer-risk section was revised.'],
    actionItems: [{ action: 'Confirm the revised section.', owner: '', dueDate: 'Friday', sourceMessageId: 'playwright-message-1' }],
    openQuestions: ['Which timezone applies to Friday?']
  };
  else if (body.activity === 'experience.assistant.email_draft') data = {
    subject: 'Re: Board pack review', body: 'Hi Ada,\n\nI will review the revised section and confirm by Friday.\n\nRegards',
    rationale: 'Uses only the supplied thread evidence.', safetyFlags: []
  };
  else return sendJson(response, { error: `unsupported test activity ${String(body.activity)}`, retryable: false }, 400);
  return sendJson(response, {
    runtimeProfile: 'experience-management', data, provider: 'terra', providerLabel: 'Terra (Playwright)',
    engine: 'codex', model: 'gpt-5.6-terra', usage: { totalTokens: 222 }, metrics: { latencyMs: 25, queueWaitMs: 1 }
  });
});

await listen(fakeNylas, 5492);
if (!liveKnowledge) await listen(fakeTerra, 5493);
const { app } = await import('../src/app.js'); const { aiJobRunner } = await import('../src/aiJobs.js');
const { stopCodexClients } = await import('../src/codexAppServer.js');
const { bootstrapAdminAccount, currentSessionUser, issueEmailVerificationToken } = await import('../src/auth.js');
const { campaignRunner } = await import('../src/campaigns.js');
const { db } = await import('../src/database.js');
const { esignWorker } = await import('../src/esign.js');
const { getKnowledgeRuntimeStatus } = await import('../src/knowledgeClient.js');
const { knowledgeJobRunner } = await import('../src/knowledgeJobs.js');
const { getTerraStatus } = await import('../src/terraClient.js');
const { saveTutorialProgress, tutorialKeys } = await import('../src/tutorialProgress.js');
const { ensureConfiguredAdministratorEnterprise, ensureExistingSubscriptionsGrandfathered } =
  await import('../src/subscriptionEntitlements.js');

if (db.provider !== e2eDatabaseProvider) {
  throw new Error(`E2E database provider mismatch: expected ${e2eDatabaseProvider}, received ${db.provider}.`);
}

function remapBootstrapSpace(userId: string) {
  const current = db.prepare('SELECT active_space_id FROM users WHERE id=?').get(userId) as { active_space_id: string | null } | undefined;
  if (!current?.active_space_id) throw new Error('The live E2E bootstrap account has no active space.');
  const previous = current.active_space_id;
  if (db.provider === 'postgres') {
    const source = db.prepare(`SELECT name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at
      FROM spaces WHERE id=?`).get(previous) as { name: string; slug: string; created_by_user_id: string;
        personal_for_user_id: string | null; created_at: string; updated_at: string } | undefined;
    if (!source) throw new Error('The live E2E bootstrap space could not be loaded.');
    db.transaction(() => {
      db.prepare('UPDATE spaces SET personal_for_user_id=NULL,slug=? WHERE id=?')
        .run(`${source.slug}-retired-${liveRunId.slice(0, 8)}`, previous);
      db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(liveSpaceId, source.name, source.slug, source.created_by_user_id,
        source.personal_for_user_id, source.created_at, source.updated_at);
      db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
        VALUES (?,?, 'owner', ?, ?)`).run(liveSpaceId, userId, source.created_at, source.updated_at);
      db.prepare('UPDATE users SET active_space_id=?,updated_at=? WHERE id=?')
        .run(liveSpaceId, source.updated_at, userId);
    })();
    ensureExistingSubscriptionsGrandfathered();
    ensureConfiguredAdministratorEnterprise(userId);
    return;
  }
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('UPDATE spaces SET id=? WHERE id=?').run(liveSpaceId, previous);
    db.prepare('UPDATE space_memberships SET space_id=? WHERE space_id=?').run(liveSpaceId, previous);
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(liveSpaceId, userId);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length) throw new Error(`Live E2E space remap violated ${violations.length} foreign keys.`);
}

function assertLiveSpaceInvariant(userId: string) {
  const row = db.prepare(`SELECT u.active_space_id,s.id space_id,m.space_id membership_space_id
    FROM users u
    LEFT JOIN spaces s ON s.id=u.active_space_id
    LEFT JOIN space_memberships m ON m.space_id=u.active_space_id AND m.user_id=u.id
    WHERE u.id=?`).get(userId) as {
      active_space_id: string | null; space_id: string | null; membership_space_id: string | null;
    } | undefined;
  if (row?.active_space_id !== liveSpaceId
    || row.space_id !== liveSpaceId
    || row.membership_space_id !== liveSpaceId) {
    throw new Error(`Live E2E space remap invariant failed: ${JSON.stringify(row || null)}`);
  }
}

function signedKnowledgeHeaders(rawBody: string, requestPath: string) {
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(24).toString('base64url');
  const secret = fs.readFileSync(knowledgeSecretFile, 'utf8').trim();
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${rawBody}`).digest('base64url');
  return { 'content-type': 'application/json', 'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature };
}

async function cleanupLiveKnowledgeTenant() {
  if (!liveKnowledge) return { cleaned: false, live: false };
  const requestPath = '/v1/test/cleanup';
  const rawBody = JSON.stringify({ source: 'knowledge-live-benchmark', spaceId: liveSpaceId,
    confirmation: 'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK' });
  const response = await fetch(`${knowledgeRuntimeBaseUrl}${requestPath}`, {
    method: 'POST', headers: signedKnowledgeHeaders(rawBody, requestPath), body: rawBody,
    signal: AbortSignal.timeout(120_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Live knowledge cleanup failed (${response.status}): ${JSON.stringify(result)}`);
  fs.rmSync(knowledgeStorageDir, { recursive: true, force: true });
  return result;
}

let liveStateDisposed = false;
async function disposeLiveApplicationState() {
  if (!liveKnowledge || liveStateDisposed) return;
  liveStateDisposed = true;
  aiJobRunner.stop(); knowledgeJobRunner.stop();
  await stopCodexClients();
  await Promise.allSettled([campaignRunner.stop(), esignWorker.stop()]);
  try { db.close(); } catch { /* already closed during Playwright teardown */ }
  fs.rmSync(state, { recursive: true, force: true });
}

const bootstrapUserId = bootstrapAdminAccount();
for (const tutorialKey of tutorialKeys) {
  saveTutorialProgress(bootstrapUserId, tutorialKey, {
    version: 1,
    status: 'completed',
    lastStep: null
  });
}

if (liveKnowledge) {
  remapBootstrapSpace(bootstrapUserId);
  assertLiveSpaceInvariant(bootstrapUserId);
  const [knowledge, terra] = await Promise.all([getKnowledgeRuntimeStatus(), getTerraStatus()]);
  if (!knowledge.ready || !terra.ready) {
    throw new Error(`KNOWLEDGE_E2E_LIVE preflight failed: ${JSON.stringify({ knowledge, terra })}`);
  }
  app.post('/__e2e__/knowledge/live-cleanup', async (request, response) => {
    if (!currentSessionUser(request)) return response.status(401).json({ error: 'Authentication required.' });
    try {
      knowledgeJobRunner.stop();
      await knowledgeJobRunner.drain(120_000);
      const result = await cleanupLiveKnowledgeTenant();
      // Playwright may retry the live spec in this same server process. Keep
      // its database and authentication secrets alive, and resume the worker
      // after purging the synthetic runtime tenant. Process shutdown performs
      // the final database close and state-directory removal.
      knowledgeJobRunner.start();
      return response.json(result);
    } catch (error) {
      knowledgeJobRunner.start();
      return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
app.post('/__e2e__/auth/verification-token', (request, response) => {
  const issued = issueEmailVerificationToken(String(request.body?.email || ''), {
    requestId: request.body?.requestId ? String(request.body.requestId) : undefined
  });
  response.setHeader('Cache-Control', 'no-store');
  return issued
    ? response.json({ token: issued.token, expiresAt: issued.expiresAt })
    : response.status(404).json({ error: 'No unverified E2E account exists for that email.' });
});
app.post('/__e2e__/tutorials/reset', (request, response) => {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.' });
  const tutorialKey = String(request.body?.tutorialKey || '');
  if (!(tutorialKeys as readonly string[]).includes(tutorialKey)) {
    return response.status(400).json({ error: 'Unknown tutorial key.' });
  }
  db.prepare('DELETE FROM tutorial_progress WHERE user_id=? AND tutorial_key=?').run(user.id, tutorialKey);
  response.setHeader('Cache-Control', 'no-store');
  return response.json({ tutorialKey, reset: true });
});
aiJobRunner.start(); campaignRunner.start(); esignWorker.start(); knowledgeJobRunner.start();
const server = app.listen(5412, '127.0.0.1', () => console.log('E2E server ready on 5412'));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  aiJobRunner.stop(); knowledgeJobRunner.stop();
  await stopCodexClients();
  await Promise.allSettled([campaignRunner.stop(), esignWorker.stop()]);
  if (liveKnowledge) await cleanupLiveKnowledgeTenant().catch((error) => console.error(error));
  if (liveKnowledge) await disposeLiveApplicationState();
  server.close(() => {
    fakeNylas.close(() => {
      if (liveKnowledge) process.exit(0);
      else fakeTerra.close(() => process.exit(0));
    });
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
