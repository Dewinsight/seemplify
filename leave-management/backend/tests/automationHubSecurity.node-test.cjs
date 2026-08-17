const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { canonical, createVerifier } = require('../services/automationHubSecurity');

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test('Leave signatures are body- and path-bound and replay protected', async () => {
  const now = 1_800_000_000_000; const secret = 'leave-test-secret-with-at-least-24-characters'; const seen = new Set();
  const middleware = createVerifier({ now: () => now, resolveSecret: () => secret, claimNonce: async key => !seen.has(key) && Boolean(seen.add(key)) });
  const requestPath = '/api/automation/actions/leave.record_decision'; const body = { input: { requestId: 'leave-1', decision: 'approved' } }; const timestamp = String(now); const nonce = 'nonce-1234567890123456';
  const signature = crypto.createHmac('sha256', secret).update(canonical({ timestamp, nonce, path: requestPath, body })).digest('hex');
  const req = { body, path: requestPath, originalUrl: requestPath, get: name => ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': `sha256=${signature}` })[name.toLowerCase()] };
  let called = 0; await middleware(req, response(), () => { called += 1; }); assert.equal(called, 1);
  const replay = response(); await middleware(req, replay, () => { called += 1; }); assert.equal(replay.statusCode, 409); assert.equal(called, 1);
  const tampered = response(); await middleware({ ...req, body: { input: { requestId: 'leave-2', decision: 'approved' } } }, tampered, () => { called += 1; }); assert.equal(tampered.statusCode, 401);
});
