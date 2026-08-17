import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, parseApiKeys, sha256Hex } from '../api/src/security.mjs';
import { loadConfig } from '../api/src/config.mjs';
import { validateMessage } from '../api/src/messages.mjs';
import { validIdempotencyKey } from '../api/src/app.mjs';

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

test('idempotency keys accept existing app namespaces without allowing header injection', () => {
  assert.equal(validIdempotencyKey('ai_interview_invite:invitation-123'), true);
  assert.equal(validIdempotencyKey('attendance:org:user:2026-08-17:clock_in'), true);
  assert.equal(validIdempotencyKey('mail-audit-safe_key.123'), true);
  assert.equal(validIdempotencyKey('unsafe\r\nX-Injected: yes'), false);
  assert.equal(validIdempotencyKey('short'), false);
});

test('multi-domain sender allowlist is normalized and keeps the primary domain', () => {
  const config = loadConfig({
    MAIL_API_DOMAIN: 'seemplifyai.com',
    MAIL_API_ALLOWED_DOMAINS: 'AIInNigeria.com, dewinsight.com, aiinnigeria.com',
    MAIL_API_BOUNCE_DOMAIN: 'bounce.seemplifyai.com',
    MAIL_API_KEYS: `test:${sha256Hex('a-valid-secret-value')}:send`,
  });
  assert.deepEqual(config.allowedDomains, ['seemplifyai.com', 'aiinnigeria.com', 'dewinsight.com']);
});

test('message validation accepts approved domains and rejects unapproved domains', () => {
  const options = { sendingDomains: ['seemplifyai.com', 'aiinnigeria.com'], maxRecipients: 50 };
  const message = validateMessage({
    from: 'no-reply@aiinnigeria.com',
    to: 'person@example.com',
    subject: 'Approved sender',
    text: 'Hello',
  }, options);
  assert.equal(message.from, 'no-reply@aiinnigeria.com');

  assert.throws(() => validateMessage({
    from: 'no-reply@unapproved.example',
    to: 'person@example.com',
    subject: 'Blocked sender',
    text: 'Hello',
  }, options), (error) => error.status === 403 && error.code === 'from_domain_not_allowed');
});
