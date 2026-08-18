const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

process.env.TURN_AUTH_SECRET = 'turn-test-secret';
process.env.TURN_TTL = '86400';

const { generateTurnCredentials } = require('./server');

test('TURN credentials use a future expiry timestamp and matching HMAC', () => {
  const nowSeconds = 2_000_000_000;
  const result = generateTurnCredentials(nowSeconds);
  const expectedUsername = '2000086400:seemplify';
  const expectedCredential = crypto
    .createHmac('sha1', process.env.TURN_AUTH_SECRET)
    .update(expectedUsername)
    .digest('base64');

  assert.equal(result.username, expectedUsername);
  assert.equal(result.credential, expectedCredential);
});
