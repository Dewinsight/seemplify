'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  SharedAIAccountService, identityFromRequest, INTERNAL_PATH, SERVICE_ID
} = require('../services/sharedAIAccountService');
const { aiRequestContext, getAIRequestContext } = require('../services/aiRequestContext');

function withEnvironment(values, fn) {
  const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  });
  return Promise.resolve().then(fn).finally(() => {
    Object.entries(prior).forEach(([key, value]) => {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    });
  });
}

test('shared Performance AI requests use the v2 service signature and canonical shared path', async () => {
  await withEnvironment({
    SEEMPLIFY_SHARED_AI_URL: 'https://recruiter.example.test',
    PERFORMANCE_AI_SHARED_SECRET: 'performance-secret'
  }, async () => {
    let captured;
    const service = new SharedAIAccountService({ fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ account: { status: 'connected' } }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    } });
    const identity = { sub: 'idp-1', email: 'person@example.com' };
    await service.request('account/status', identity, { identity: { sub: 'forged', email: 'wrong@example.com' } });

    const pathname = `${INTERNAL_PATH}/account/status`;
    const headers = captured.init.headers;
    const canonical = [
      headers['x-seemplify-timestamp'], headers['x-seemplify-nonce'], SERVICE_ID,
      'POST', pathname, captured.init.body
    ].join('\n');
    const expected = crypto.createHmac('sha256', 'performance-secret').update(canonical).digest('hex');

    assert.equal(captured.url, `https://recruiter.example.test${pathname}`);
    assert.equal(headers['x-seemplify-service'], 'performance-management');
    assert.equal(headers['x-seemplify-signature-version'], '2');
    assert.match(headers['x-seemplify-nonce'], /^[A-Za-z0-9_-]{16,128}$/);
    assert.equal(headers['x-seemplify-signature'], expected);
    assert.deepEqual(JSON.parse(captured.init.body).identity, identity);
  });
});

test('deployment health traverses the deployed Performance signer to Recruiter', async () => {
  await withEnvironment({
    SEEMPLIFY_SHARED_AI_URL: 'https://recruiter.example.test',
    PERFORMANCE_AI_SHARED_SECRET: 'performance-secret'
  }, async () => {
    let captured;
    const service = new SharedAIAccountService({ fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true, service: 'seemplify-shared-ai-account' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    } });
    const result = await service.health();
    assert.equal(result.ok, true);
    assert.equal(captured.url, 'https://recruiter.example.test/api/internal/ai/v1/health');
    assert.equal(captured.init.body, '{}');
    const headers = captured.init.headers;
    const canonical = [
      headers['x-seemplify-timestamp'], headers['x-seemplify-nonce'], SERVICE_ID,
      'POST', '/api/internal/ai/v1/health', '{}'
    ].join('\n');
    assert.equal(
      headers['x-seemplify-signature'],
      crypto.createHmac('sha256', 'performance-secret').update(canonical).digest('hex')
    );
  });
});

test('Performance service code carries only its service-bound proxy credential', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'sharedAIAccountService.js'),
    'utf8'
  );
  assert.match(source, /PERFORMANCE_AI_SHARED_SECRET/);
  assert.doesNotMatch(source, /CHATGPT_GATEWAY_SHARED_SECRET|AI_GATEWAY_HMAC_SECRET/);
});

test('shared identity is derived only from the authenticated Performance session and organization', () => {
  const request = {
    body: { identity: { sub: 'forged', email: 'wrong@example.com' } },
    session: {
      user: {
        id: 'product-local-id-that-must-not-leak',
        email: 'PERSON@EXAMPLE.COM', name: 'Person Example',
        organizations: [{ id: 'org-session-3', name: 'Session Org' }],
        userinfo: { sub: 'idp-session-2' }
      }
    },
    currentOrganization: { id: 'org-active-4', name: 'Active Org' }
  };
  assert.deepEqual(identityFromRequest(request), {
    sub: 'idp-session-2', email: 'person@example.com', organizationId: 'org-active-4',
    organizationName: 'Active Org', displayName: 'Person Example'
  });
});

test('shared identity rejects an incomplete session instead of accepting request-body claims', () => {
  assert.throws(
    () => identityFromRequest({ body: { identity: { sub: 'forged', email: 'wrong@example.com' } }, session: {} }),
    (error) => error.code === 'SHARED_AI_IDENTITY_REQUIRED' && error.statusCode === 401
  );
});

test('AI request context resolves identity after authentication middleware populates the session', async () => {
  const request = { cookies: {}, headers: { 'x-request-id': 'late-auth' }, session: {} };
  const context = await new Promise((resolve, reject) => {
    aiRequestContext(request, {}, () => Promise.resolve().then(() => {
      request.session.user = { sub: 'late-subject', email: 'late@example.com' };
      resolve(getAIRequestContext());
    }).catch(reject));
  });
  assert.equal(context.identity.sub, 'late-subject');
  assert.equal(context.identity.email, 'late@example.com');
  assert.equal(context.requestId, 'late-auth');
});
