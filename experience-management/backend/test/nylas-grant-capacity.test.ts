import assert from 'node:assert/strict';
import { after, test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://127.0.0.1:5497',
  NYLAS_CLIENT_ID: 'capacity-test-client',
  NYLAS_API_KEY: 'capacity-test-api-key-not-live',
  NYLAS_API_URI: 'http://nylas-capacity.test',
  NYLAS_REDIRECT_URI: 'http://127.0.0.1:5497/api/integrations/nylas/callback'
});
delete process.env.IDP_PLATFORM_CONFIGURATION_URL;

const originalFetch = globalThis.fetch;
const calls: Array<{ method: string; url: URL; body: any }> = [];
let tokenAttempts = 0;

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ method, url, body });
  if (url.pathname === '/v3/connect/token' && method === 'POST') {
    tokenAttempts += 1;
    if (tokenAttempts === 1) {
      return new Response(JSON.stringify({
        error: {
          type: 'invalid_request_error',
          message: 'Maximum number of grants reached for Organization authentication'
        }
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return Response.json({ data: {
      grant_id: 'grant-new-002', email: 'new@example.test', provider: 'google'
    } });
  }
  if (url.pathname === '/v3/grants' && method === 'GET') {
    return Response.json({ data: [{
      id: 'grant-oldest-001', email: 'oldest@example.test', provider: 'microsoft', created_at: 1_700_000_000
    }] });
  }
  if (url.pathname === '/v3/grants/grant-oldest-001' && method === 'DELETE') {
    return Response.json({ data: { id: 'grant-oldest-001' } });
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
};

const { exchangeNylasCodeWithOldestGrantRotation } = await import('../src/nylasClient.js');

after(() => { globalThis.fetch = originalFetch; });

test('removes the oldest Nylas grant and retries once when grant capacity is full', async () => {
  let removedGrantId = '';
  const grant = await exchangeNylasCodeWithOldestGrantRotation(
    'oauth-code-capacity-test',
    'google',
    (removed) => { removedGrantId = removed.grantId; }
  );

  assert.equal(tokenAttempts, 2);
  assert.equal(removedGrantId, 'grant-oldest-001');
  assert.equal(grant.grantId, 'grant-new-002');
  const lookup = calls.find((call) => call.method === 'GET' && call.url.pathname === '/v3/grants')!;
  assert.deepEqual(Object.fromEntries(lookup.url.searchParams), {
    limit: '1', offset: '0', sort_by: 'created_at', order_by: 'asc'
  });
  assert.ok(calls.some((call) => call.method === 'DELETE'
    && call.url.pathname === '/v3/grants/grant-oldest-001'));
});
