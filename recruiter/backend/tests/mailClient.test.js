/**
 * Contract tests for the shared CJS mail client.
 *
 *   node --test tests/mailClient.test.js
 *
 * Intentionally dependency-free (node:test only) so it runs in any of the
 * services that carry a copy of services/mailClient.js.
 */

const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');

const {
    MailError,
    formatMailAddress,
    isMailConfigured,
    isRetryableMailError,
    mailTransportStatus,
    resolveMailTransport,
    sendMail
} = require('../services/mailClient');

const BASE_ENVIRONMENT = {
    MAIL_API_BASE_URL: 'http://127.0.0.1:5020',
    MAIL_API_TOKEN: 'mk_test.local-development-secret',
    MAIL_FROM_EMAIL: 'no-reply@example.test',
    MAIL_FROM_NAME: 'Seemplify Test'
};

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => { globalThis.fetch = originalFetch; });

function environment(overrides = {}) {
    return { ...BASE_ENVIRONMENT, ...overrides };
}

function stubMailService(respond) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({
            url: String(url),
            method: String(init && init.method),
            headers: (init && init.headers) || {},
            body: JSON.parse(String((init && init.body) || '{}'))
        });
        return respond(calls.length);
    };
    return calls;
}

function accepted(messageId) {
    return {
        ok: true,
        status: 202,
        json: async () => ({ status: 'accepted', messageId: messageId || 'msg_1' })
    };
}

function failure(status, body) {
    return { ok: false, status, json: async () => body || {} };
}

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
    }, environment());

    assert.deepEqual(result, { status: 'accepted', messageId: 'msg_contract', idempotentReplay: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:5020/v1/messages');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer mk_test.local-development-secret');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.equal(calls[0].headers['Idempotency-Key'], 'contract-key-1');
    assert.deepEqual(calls[0].body, {
        from: 'no-reply@example.test',
        fromName: 'Seemplify Test',
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

test('a trailing slash on the base URL does not produce a double slash', async () => {
    const calls = stubMailService(() => accepted());
    await sendMail(
        { to: 'a@example.test', subject: 'Slash', text: 'body', idempotencyKey: 'slash-1' },
        environment({ MAIL_API_BASE_URL: 'http://127.0.0.1:5020//' })
    );
    assert.equal(calls[0].url, 'http://127.0.0.1:5020/v1/messages');
});

test('fails closed when the base URL, token or sender is missing', async () => {
    const calls = stubMailService(() => accepted());
    const unconfigured = (error) => error instanceof MailError && error.code === 'mail_not_configured' && error.permanent;

    for (const missing of ['MAIL_API_BASE_URL', 'MAIL_API_TOKEN', 'MAIL_FROM_EMAIL']) {
        const broken = environment({ [missing]: '', NODE_ENV: 'production' });
        // SENDER_EMAIL / SENDER_NAME are legacy fallbacks and must not rescue a
        // missing sender when the primary variable is cleared.
        delete broken.SENDER_EMAIL;
        await assert.rejects(
            sendMail({ to: 'a@example.test', subject: 'Closed', text: 'body', idempotencyKey: `closed-${missing}` }, broken),
            unconfigured
        );
        assert.equal(isMailConfigured(broken), false);
    }

    assert.equal(calls.length, 0, 'an unconfigured transport must never reach the network');
});

test('127.0.0.1 is a development default only', () => {
    const withoutUrl = environment({ MAIL_API_BASE_URL: '' });
    assert.equal(resolveMailTransport({ ...withoutUrl, NODE_ENV: 'development' }).baseUrl, 'http://127.0.0.1:5020');
    assert.throws(() => resolveMailTransport({ ...withoutUrl, NODE_ENV: 'production' }), MailError);
});

test('classifies 401 and 403 as permanent configuration faults', async () => {
    for (const status of [401, 403]) {
        stubMailService(() => failure(status, { code: 'invalid_key' }));
        const error = await sendMail(
            { to: 'a@example.test', subject: 'Auth', text: 'body', idempotencyKey: `auth-${status}` },
            environment()
        ).then(() => null, (caught) => caught);
        assert.ok(error instanceof MailError);
        assert.equal(error.status, status);
        assert.equal(error.permanent, true);
        assert.equal(isRetryableMailError(error), false);
        assert.doesNotMatch(error.message, /local-development-secret/, 'the bearer token must never appear in an error message');
    }
});

test('classifies 429, 5xx, sending_disabled and transport faults as retryable', async () => {
    for (const status of [429, 500, 502, 503]) {
        stubMailService(() => failure(status, { code: status === 503 ? 'sending_disabled' : 'busy', message: 'try later' }));
        const error = await sendMail(
            { to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: `retry-${status}` },
            environment()
        ).then(() => null, (caught) => caught);
        assert.ok(error instanceof MailError, `HTTP ${status} should raise a MailError`);
        assert.equal(error.retryable, true, `HTTP ${status} should be retryable`);
    }

    globalThis.fetch = async () => { throw new Error('socket hang up'); };
    const networkError = await sendMail(
        { to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: 'retry-network' },
        environment()
    ).then(() => null, (caught) => caught);
    assert.equal(networkError.code, 'network_error');
    assert.equal(networkError.retryable, true);

    globalThis.fetch = async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; };
    const timeout = await sendMail(
        { to: 'a@example.test', subject: 'Retry', text: 'body', idempotencyKey: 'retry-timeout' },
        environment()
    ).then(() => null, (caught) => caught);
    assert.equal(timeout.code, 'timeout');
    assert.equal(timeout.retryable, true);
});

test('treats 409 as a completed idempotent replay rather than a failure', async () => {
    stubMailService(() => ({ ok: false, status: 409, json: async () => ({ status: 'duplicate' }) }));
    const withoutId = await sendMail(
        { to: 'a@example.test', subject: 'Replay', text: 'body', idempotencyKey: 'replay-1' },
        environment()
    );
    assert.deepEqual(withoutId, { status: 'accepted', messageId: 'idempotent:replay-1', idempotentReplay: true });

    stubMailService(() => ({ ok: false, status: 409, json: async () => ({ status: 'duplicate', messageId: 'msg_original' }) }));
    const withId = await sendMail(
        { to: 'a@example.test', subject: 'Replay', text: 'body', idempotencyKey: 'replay-2' },
        environment()
    );
    assert.equal(withId.messageId, 'msg_original');
    assert.equal(withId.idempotentReplay, true);
});

test('rejects other 4xx as permanent', async () => {
    stubMailService(() => failure(422, { code: 'invalid_recipient', message: 'unroutable' }));
    const error = await sendMail(
        { to: 'a@example.test', subject: 'Bad', text: 'body', idempotencyKey: 'bad-1' },
        environment()
    ).then(() => null, (caught) => caught);
    assert.equal(error.code, 'invalid_recipient');
    assert.equal(error.permanent, true);
});

test('rejects header injection before any request is made', async () => {
    const calls = stubMailService(() => accepted());
    const invalid = (error) => error instanceof MailError && error.code === 'invalid_message';

    await assert.rejects(sendMail(
        { to: 'victim@example.test\r\nBcc: attacker@example.test', subject: 'ok', text: 'b', idempotencyKey: 'i1' }, environment()), invalid);
    await assert.rejects(sendMail(
        { to: 'victim@example.test', subject: 'ok\r\nBcc: attacker@example.test', text: 'b', idempotencyKey: 'i2' }, environment()), invalid);
    await assert.rejects(sendMail(
        { to: 'victim@example.test', subject: 'ok', text: 'b', idempotencyKey: 'i3', headers: { 'X-Bad': 'a\r\nBcc: attacker@example.test' } }, environment()), invalid);
    await assert.rejects(sendMail(
        { to: 'victim@example.test', subject: 'ok', text: 'b', idempotencyKey: 'bad\r\nkey' }, environment()), invalid);
    // A comma-separated pair would smuggle a second recipient past the service.
    await assert.rejects(sendMail(
        { to: 'victim@example.test, attacker@example.test', subject: 'ok', text: 'b', idempotencyKey: 'i4' }, environment()), invalid);

    assert.equal(calls.length, 0, 'an unsafe message must never reach the network');
});

test('requires an idempotency key, a recipient and a body', async () => {
    const calls = stubMailService(() => accepted());
    await assert.rejects(sendMail({ to: 'a@example.test', subject: 's', text: 'b', idempotencyKey: '  ' }, environment()),
        (error) => /idempotency key is required/i.test(error.message));
    await assert.rejects(sendMail({ to: [], subject: 's', text: 'b', idempotencyKey: 'k1' }, environment()),
        (error) => /recipient is required/i.test(error.message));
    await assert.rejects(sendMail({ to: 'a@example.test', subject: 's', idempotencyKey: 'k2' }, environment()),
        (error) => /text or HTML body is required/i.test(error.message));
    assert.equal(calls.length, 0);
});

test('validates bare mailboxes and reports readiness without exposing the credential', () => {
    assert.equal(formatMailAddress('  a@example.test  '), 'a@example.test');
    assert.throws(() => formatMailAddress('"Mina" <a@example.test>'), MailError);
    assert.throws(() => formatMailAddress(''), MailError);

    const ready = mailTransportStatus(environment());
    assert.equal(ready.configured, true);
    assert.equal(ready.baseUrl, 'http://127.0.0.1:5020');
    assert.doesNotMatch(JSON.stringify(ready), /local-development-secret/);

    const missing = mailTransportStatus(environment({ MAIL_API_TOKEN: '' }));
    assert.equal(missing.configured, false);
    assert.match(String(missing.reason), /MAIL_API_TOKEN/);
});
