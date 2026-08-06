import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-mail-client-'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'mail-client.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  PUBLIC_URL: 'http://127.0.0.1:5520',
  EMAIL_MODE: 'send',
  MAIL_API_BASE_URL: 'http://127.0.0.1:5020/',
  MAIL_API_TOKEN: 'mk_test.local-development-secret',
  MAIL_FROM_EMAIL: 'no-reply@example.test',
  MAIL_FROM_NAME: 'Seemplify Experience'
});

const { config } = await import('../src/config.js');
const { MailError, formatMailAddress, isRetryableMailError, mailTransportStatus, resolveMailTransport, sendMail } =
  await import('../src/mailClient.js');

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });

interface Captured { url: string; method: string; headers: Record<string, string>; body: any }

function stubMailService(respond: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  globalThis.fetch = async (url, init) => {
    const captured: Captured = {
      url: String(url),
      method: String(init?.method || 'GET'),
      headers: (init?.headers || {}) as Record<string, string>,
      body: JSON.parse(String(init?.body || '{}'))
    };
    calls.push(captured);
    return respond(captured);
  };
  return calls;
}

function accepted(messageId = 'msg_1') {
  return new Response(JSON.stringify({ status: 'accepted', messageId }), { status: 202, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  config.emailMode = 'send';
  config.mailApiBaseUrl = 'http://127.0.0.1:5020';
  config.mailApiToken = 'mk_test.local-development-secret';
  config.mailFromEmail = 'no-reply@example.test';
  config.mailFromName = 'Seemplify Experience';
  globalThis.fetch = originalFetch;
});

test('posts the documented contract to /v1/messages', async () => {
  const calls = stubMailService(() => accepted('msg_contract'));
  const result = await sendMail({
    to: 'recipient@example.test',
    cc: ['cc@example.test'],
    bcc: 'bcc@example.test',
    replyTo: 'reply@example.test',
    subject: 'Contract check',
    text: 'plain',
    html: '<p>rich</p>',
    tag: 'contract_check',
    headers: { 'X-Seemplify-Correlation': 'contract:1' },
    attachments: [{ name: 'agreement.pdf', contentType: 'application/pdf', data: 'ZmFrZQ==' }],
    idempotencyKey: 'contract-key-1'
  });

  assert.deepEqual(result, { status: 'accepted', messageId: 'msg_contract', mode: 'send', idempotentReplay: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:5020/v1/messages');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer mk_test.local-development-secret');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].headers['Idempotency-Key'], 'contract-key-1');
  assert.deepEqual(calls[0].body, {
    from: 'no-reply@example.test',
    fromName: 'Seemplify Experience',
    to: ['recipient@example.test'],
    subject: 'Contract check',
    cc: ['cc@example.test'],
    bcc: ['bcc@example.test'],
    replyTo: 'reply@example.test',
    text: 'plain',
    html: '<p>rich</p>',
    tag: 'contract_check',
    headers: { 'X-Seemplify-Correlation': 'contract:1' },
    attachments: [{ name: 'agreement.pdf', contentType: 'application/pdf', data: 'ZmFrZQ==' }]
  });
});

test('carries the sender display name separately from plain mailboxes', async () => {
  const calls = stubMailService(() => accepted());
  await sendMail({
    from: formatMailAddress('campaigns@example.test'),
    fromName: 'Équipe Research — Lagos (CX)',
    to: [formatMailAddress('mina@example.test')],
    subject: 'Named',
    text: 'body',
    idempotencyKey: 'named-1'
  });
  assert.equal(calls[0].body.from, 'campaigns@example.test');
  assert.equal(calls[0].body.fromName, 'Équipe Research — Lagos (CX)');
  assert.deepEqual(calls[0].body.to, ['mina@example.test']);
});

test('trailing slashes in the configured base URL do not produce a double slash', async () => {
  config.mailApiBaseUrl = 'http://127.0.0.1:5020//';
  const calls = stubMailService(() => accepted());
  await sendMail({ to: 'a@example.test', subject: 'Slash', text: 'body', idempotencyKey: 'slash-1' });
  assert.equal(calls[0].url, 'http://127.0.0.1:5020/v1/messages');
});

test('fails closed when the base URL, token or sender is missing', async () => {
  const calls = stubMailService(() => accepted());
  const unconfigured = (error: unknown) => error instanceof MailError && error.code === 'mail_not_configured' && error.permanent;
  const restore = () => {
    config.mailApiBaseUrl = 'http://127.0.0.1:5020';
    config.mailApiToken = 'mk_test.local-development-secret';
    config.mailFromEmail = 'no-reply@example.test';
  };

  config.mailApiBaseUrl = '';
  await assert.rejects(sendMail({ to: 'a@example.test', subject: 'Closed', text: 'body', idempotencyKey: 'closed-url' }), unconfigured);
  restore();
  config.mailApiToken = '';
  await assert.rejects(sendMail({ to: 'a@example.test', subject: 'Closed', text: 'body', idempotencyKey: 'closed-token' }), unconfigured);
  restore();
  config.mailFromEmail = '';
  await assert.rejects(sendMail({ to: 'a@example.test', subject: 'Closed', text: 'body', idempotencyKey: 'closed-from' }), unconfigured);
  restore();

  assert.equal(calls.length, 0, 'an unconfigured transport must never reach the network');
});

test('classifies 401 and 403 as permanent configuration faults', async () => {
  for (const status of [401, 403]) {
    stubMailService(() => new Response(JSON.stringify({ code: 'invalid_key' }), { status, headers: { 'content-type': 'application/json' } }));
    const error = await sendMail({ to: 'a@example.test', subject: 'Auth', text: 'body', idempotencyKey: `auth-${status}` })
      .then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof MailError);
    assert.equal(error.status, status);
    assert.equal(error.permanent, true);
    assert.equal(isRetryableMailError(error), false);
    assert.doesNotMatch(error.message, /local-development-secret/, 'the bearer token must never appear in an error message');
  }
});

test('classifies 429, 5xx, sending_disabled and transport faults as retryable', async () => {
  for (const status of [429, 500, 502, 503]) {
    stubMailService(() => new Response(JSON.stringify({ code: status === 503 ? 'sending_disabled' : 'busy', message: 'try later' }), {
      status, headers: { 'content-type': 'application/json' }
    }));
    const error = await sendMail({ to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: `retry-${status}` })
      .then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof MailError, `HTTP ${status} should raise a MailError`);
    assert.equal(error.retryable, true, `HTTP ${status} should be retryable`);
  }

  globalThis.fetch = async () => { throw new Error('socket hang up'); };
  const networkError = await sendMail({ to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: 'retry-network' })
    .then(() => null, (caught: unknown) => caught);
  assert.ok(networkError instanceof MailError);
  assert.equal(networkError.code, 'network_error');
  assert.equal(networkError.retryable, true);

  globalThis.fetch = async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; };
  const timeout = await sendMail({ to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: 'retry-timeout' })
    .then(() => null, (caught: unknown) => caught);
  assert.ok(timeout instanceof MailError);
  assert.equal(timeout.code, 'timeout');
  assert.equal(timeout.retryable, true);
});

test('treats 409 as a completed idempotent replay rather than a failure', async () => {
  stubMailService(() => new Response(JSON.stringify({ status: 'duplicate' }), { status: 409, headers: { 'content-type': 'application/json' } }));
  const withoutId = await sendMail({ to: 'a@example.test', subject: 'Replay', text: 'body', idempotencyKey: 'replay-1' });
  assert.deepEqual(withoutId, { status: 'accepted', messageId: 'idempotent:replay-1', mode: 'send', idempotentReplay: true });

  stubMailService(() => new Response(JSON.stringify({ status: 'duplicate', messageId: 'msg_original' }), { status: 409, headers: { 'content-type': 'application/json' } }));
  const withId = await sendMail({ to: 'a@example.test', subject: 'Replay', text: 'body', idempotencyKey: 'replay-2' });
  assert.equal(withId.messageId, 'msg_original');
  assert.equal(withId.idempotentReplay, true);
});

test('rejects 4xx other than 409 as permanent', async () => {
  stubMailService(() => new Response(JSON.stringify({ code: 'invalid_recipient', message: 'unroutable' }), { status: 422, headers: { 'content-type': 'application/json' } }));
  const error = await sendMail({ to: 'a@example.test', subject: 'Bad', text: 'body', idempotencyKey: 'bad-1' })
    .then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof MailError);
  assert.equal(error.code, 'invalid_recipient');
  assert.equal(error.permanent, true);
});

test('rejects header injection in addresses, subjects and headers before any request', async () => {
  const calls = stubMailService(() => accepted());
  const injections = [
    { to: 'victim@example.test\r\nBcc: attacker@example.test', subject: 'ok' },
    { to: 'victim@example.test', subject: 'ok\r\nBcc: attacker@example.test' }
  ];
  for (const [index, injection] of injections.entries()) {
    await assert.rejects(
      sendMail({ ...injection, text: 'body', idempotencyKey: `inject-${index}` }),
      (error: unknown) => error instanceof MailError && error.code === 'invalid_message'
    );
  }
  await assert.rejects(
    sendMail({ to: 'victim@example.test', subject: 'ok', text: 'body', idempotencyKey: 'inject-header', headers: { 'X-Bad': 'a\r\nBcc: attacker@example.test' } }),
    (error: unknown) => error instanceof MailError && error.code === 'invalid_message'
  );
  await assert.rejects(
    sendMail({ to: 'victim@example.test', subject: 'ok', text: 'body', idempotencyKey: 'inject\r\nkey' }),
    (error: unknown) => error instanceof MailError && error.code === 'invalid_message'
  );
  assert.equal(calls.length, 0, 'an unsafe message must never reach the network');
});

test('requires an idempotency key, a recipient and a body', async () => {
  const calls = stubMailService(() => accepted());
  await assert.rejects(sendMail({ to: 'a@example.test', subject: 's', text: 'b', idempotencyKey: '  ' }),
    (error: unknown) => error instanceof MailError && /idempotency key is required/i.test(error.message));
  await assert.rejects(sendMail({ to: [], subject: 's', text: 'b', idempotencyKey: 'k1' }),
    (error: unknown) => error instanceof MailError && /recipient is required/i.test(error.message));
  await assert.rejects(sendMail({ to: 'a@example.test', subject: 's', idempotencyKey: 'k2' }),
    (error: unknown) => error instanceof MailError && /text or HTML body is required/i.test(error.message));
  assert.equal(calls.length, 0);
});

test('log mode short-circuits before any network call', async () => {
  config.emailMode = 'log';
  const calls = stubMailService(() => accepted());
  const result = await sendMail({ to: 'a@example.test', subject: 'Logged', text: 'body', idempotencyKey: 'log-1' });
  assert.equal(result.mode, 'log');
  assert.equal(result.status, 'accepted');
  assert.equal(calls.length, 0);
});

test('validates plain mailboxes and rejects display-address syntax', () => {
  assert.equal(formatMailAddress('a@example.test'), 'a@example.test');
  assert.throws(() => formatMailAddress('"Mina Test" <a@example.test>'), MailError);
  assert.throws(() => formatMailAddress('victim@example.test, attacker@example.test'), MailError);
  assert.throws(() => formatMailAddress(''), MailError);
});

test('reports transport readiness without exposing the credential', () => {
  const ready = mailTransportStatus();
  assert.equal(ready.configured, true);
  assert.equal(ready.baseUrl, 'http://127.0.0.1:5020');
  assert.doesNotMatch(JSON.stringify(ready), /local-development-secret/);

  config.mailApiToken = '';
  const missing = mailTransportStatus();
  assert.equal(missing.configured, false);
  assert.match(String(missing.reason), /MAIL_API_TOKEN/);
  assert.throws(() => resolveMailTransport(), MailError);
});
