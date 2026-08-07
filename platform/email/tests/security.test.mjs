import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, parseApiKeys, sha256Hex } from '../api/src/security.mjs';
import { loadConfig } from '../api/src/config.mjs';

test('valid bearer authenticates and invalid/revoked bearers do not', () => {
  const keys = parseApiKeys(`recruiter:${sha256Hex('a-valid-secret-value')}:send|read`);
  assert.equal(authenticate('Bearer recruiter.a-valid-secret-value', keys)?.keyId, 'recruiter');
  assert.equal(authenticate('Bearer recruiter.wrong-secret-value', keys), null);
  assert.equal(authenticate('Bearer revoked.a-valid-secret-value', keys), null);
});

test('Dokploy configuration fails closed when sending is omitted', () => {
  const config = loadConfig({
    MAIL_API_DOMAIN: 'seemplifyai.com',
    MAIL_API_BOUNCE_DOMAIN: 'bounce.seemplifyai.com',
    MAIL_API_KEYS: `test:${sha256Hex('a-valid-secret-value')}:send`,
    MAIL_API_ADDRESS_HASH_SALT: '0123456789abcdef',
    MAIL_API_POSTAL_API_KEY: 'postal-key',
  });
  assert.equal(config.sendEnabled, false);
});

test('sending enabled without Postal credentials refuses startup', () => {
  assert.throws(() => loadConfig({
    MAIL_API_DOMAIN: 'seemplifyai.com',
    MAIL_API_BOUNCE_DOMAIN: 'bounce.seemplifyai.com',
    MAIL_API_SEND_ENABLED: 'true',
  }), /POSTAL_API_KEY/);
});
