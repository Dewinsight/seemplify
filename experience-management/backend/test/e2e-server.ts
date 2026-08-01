import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const state = path.resolve(process.cwd(), '..', '.local-runtime', 'experience-management', 'e2e');
fs.rmSync(state, { recursive: true, force: true }); fs.mkdirSync(state, { recursive: true });
const passwordFile = path.join(state, 'admin-password'); const sessionFile = path.join(state, 'session-secret');
const xKeyFile = path.join(state, 'x-credential-encryption-key');
const nylasKeyFile = path.join(state, 'nylas-credential-encryption-key');
const terraSecretFile = path.join(state, 'terra-secret');
const esignKeyFile = path.join(state, 'esign-encryption-key');
fs.writeFileSync(passwordFile, 'Playwright-Test-Password-2026!'); fs.writeFileSync(sessionFile, 'playwright-session-secret-longer-than-twenty-characters'); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 11).toString('base64url')); fs.writeFileSync(nylasKeyFile, Buffer.alloc(32, 13).toString('base64url')); fs.writeFileSync(terraSecretFile, 'playwright-terra-secret-longer-than-twenty-characters'); fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 12).toString('base64url'));
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: '5412', PUBLIC_URL: 'http://127.0.0.1:5412', DATABASE_PATH: path.join(state, 'e2e.sqlite'), UPLOAD_DIR: path.join(state, 'uploads'),
  ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', AI_WORKER_CONCURRENCY: '1', TERRA_GATEWAY_BASE_URL: 'http://127.0.0.1:5493', TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  ESIGN_STORAGE_DIR: path.join(state, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, ESIGN_WORKER_POLL_MS: '250',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(state, 'no-x-consumer-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(state, 'no-x-consumer-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(state, 'no-x-bearer-token'), X_SEED_ACCESS_TOKEN_FILE: path.join(state, 'no-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(state, 'no-x-token-secret'),
  NYLAS_CLIENT_ID: 'experience-e2e-client', NYLAS_API_KEY: 'experience-e2e-api-key-not-live', NYLAS_API_URI: 'http://127.0.0.1:5492',
  NYLAS_REDIRECT_URI: 'http://127.0.0.1:5412/api/integrations/nylas/callback', NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE: nylasKeyFile
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

await Promise.all([listen(fakeNylas, 5492), listen(fakeTerra, 5493)]);
const { app } = await import('../src/app.js'); const { aiJobRunner } = await import('../src/aiJobs.js');
const { campaignRunner } = await import('../src/campaigns.js');
const { esignWorker } = await import('../src/esign.js');
aiJobRunner.start(); campaignRunner.start(); esignWorker.start();
const server = app.listen(5412, '127.0.0.1', () => console.log('E2E server ready on 5412'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  aiJobRunner.stop(); void campaignRunner.stop(); void esignWorker.stop();
  server.close(() => fakeNylas.close(() => fakeTerra.close(() => process.exit(0))));
});
