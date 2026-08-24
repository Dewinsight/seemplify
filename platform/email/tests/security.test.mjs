import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, parseApiKeys, sha256Hex } from '../api/src/security.mjs';
import { loadConfig } from '../api/src/config.mjs';
import { validateMessage, toPostalPayload } from '../api/src/messages.mjs';
import { renderBrandedTransactionalHtml } from '../api/src/brand-template.mjs';
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

test('transactional HTML receives the shared Seemplify frame once', () => {
  const rendered = renderBrandedTransactionalHtml({
    html: '<html><body><h2>Password reset</h2><p>Use the secure link below.</p></body></html>',
    subject: 'Reset your password',
    fromName: 'Seemplify Identity',
    tag: 'password-reset',
  });
  assert.match(rendered, /data-seemplify-email-shell="transactional"/);
  assert.match(rendered, /Seemplify Identity/);
  assert.match(rendered, /Password reset/);
  assert.match(rendered, /seemplifylogo\.png/);
  assert.match(rendered, /People operations, connected\./);
  assert.match(rendered, /background:#0f0e13/);
  assert.doesNotMatch(rendered, /<body[^>]*>[\s\S]*<body/i);

  const preserved = renderBrandedTransactionalHtml({
    html: '<div data-seemplify-preserve-style="true">Complete design</div>',
    subject: 'Preserved',
  });
  assert.doesNotMatch(preserved, /data-seemplify-email-shell="transactional"/);
});

test('Postal payload applies branded HTML without changing plain text', () => {
  const message = validateMessage({
    from: 'no-reply@seemplifyai.com',
    fromName: 'Seemplify Payroll',
    to: 'person@example.com',
    subject: 'Payslip ready',
    text: 'Your payslip is ready.',
    html: '<h2>Your payslip is ready</h2>',
    tag: 'payroll',
  }, { sendingDomains: ['seemplifyai.com'], maxRecipients: 50 });
  const payload = toPostalPayload(message, { recipients: message.allRecipients });
  assert.equal(payload.plain_body, 'Your payslip is ready.');
  assert.match(payload.html_body, /data-seemplify-email-shell="transactional"/);
  assert.match(payload.html_body, /Seemplify Payroll/);
});
