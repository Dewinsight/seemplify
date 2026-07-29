import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-x-client-'));
const keyFile = path.join(root, 'x-key');
fs.writeFileSync(keyFile, Buffer.alloc(32, 7).toString('base64url'));
process.env.X_CREDENTIAL_ENCRYPTION_KEY_FILE = keyFile;
const { buildOAuthAuthorization, normalizedOAuthParameters, oauthPercentEncode } = await import('../src/xClient.js');
const { decryptSecret, encryptSecret, resetSecretKeyCacheForTests } = await import('../src/secureSecrets.js');

after(() => { resetSecretKeyCacheForTests(); fs.rmSync(root, { recursive: true, force: true }); });

test('signs the RFC 5849 HMAC-SHA1 example with RFC 3986 encoding', () => {
  const header = buildOAuthAuthorization({
    method: 'POST', url: 'http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b',
    consumerKey: '9djdj82h48djs9d2', consumerSecret: 'j49sk3j29djd',
    token: 'kkk9d7dh3k39sjv7', tokenSecret: 'dh893hdasih9', nonce: '7d8f3e4a', timestamp: '137131201', includeVersion: false,
    parameters: [['c2', ''], ['a3', '2 q']]
  });
  assert.match(header, /oauth_signature="r6%2FTJjbCOr97%2F%2BUU0NsvSne7s5g%3D"/);
  assert.equal(oauthPercentEncode("Ladies + Gentlemen!*'()~"), 'Ladies%20%2B%20Gentlemen%21%2A%27%28%29~');
  assert.doesNotMatch(header, /j49sk3j29djd|dh893hdasih9/);
});

test('sorts encoded OAuth names and values bytewise rather than by host locale', () => {
  assert.equal(normalizedOAuthParameters([['a~', '1'], ['a!', '2'], ['a', '3'], ['a!', '1']]), 'a=3&a%21=1&a%21=2&a~=1');
});

test('encrypts X secrets with context-bound, non-deterministic AES-GCM envelopes', () => {
  const value = 'not-a-real-x-secret-value'; const context = 'x-app:test:consumer-secret:v1';
  const first = encryptSecret(value, context); const second = encryptSecret(value, context);
  assert.notEqual(first, second); assert.doesNotMatch(first, new RegExp(value));
  assert.equal(decryptSecret(first, context), value);
  assert.throws(() => decryptSecret(first, 'x-app:another-row:consumer-secret:v1'), /could not be decrypted/);
  const parts = first.split('.'); const tag = Buffer.from(parts[2], 'base64url'); tag[0] ^= 1; parts[2] = tag.toString('base64url'); const tampered = parts.join('.');
  assert.throws(() => decryptSecret(tampered, context), /could not be decrypted/);
});
