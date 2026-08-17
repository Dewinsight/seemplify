const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { canonical, createVerifier } = require('../services/automationHubSecurity');

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test('Time verifier rejects expired signatures', async () => {
  const now = 1_800_000_000_000; const secret = 'time-test-secret-with-at-least-24-characters'; const timestamp = String(now - 600_000); const nonce = 'nonce-1234567890123456'; const requestPath = '/api/automation/actions/time.block_expected_absence'; const body = { input: {} };
  const signature = crypto.createHmac('sha256', secret).update(canonical({ timestamp, nonce, path: requestPath, body })).digest('hex');
  const request = { body, path: requestPath, originalUrl: requestPath, get: name => ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': `sha256=${signature}` })[name.toLowerCase()] };
  const result = response(); let called = false;
  await createVerifier({ now: () => now, resolveSecret: () => secret, claimNonce: async () => true })(request, result, () => { called = true; });
  assert.equal(result.statusCode, 401); assert.equal(called, false);
});
