import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { MailError, sendMail } from '../src/services/mailClient.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const environment = {
  NODE_ENV: 'test',
  MAIL_API_BASE_URL: 'http://127.0.0.1:5020/',
  MAIL_API_TOKEN: 'identity.test-secret',
  MAIL_FROM_EMAIL: 'no-reply@seemplifyai.com',
  MAIL_FROM_NAME: 'Seemplify Identity',
  MAIL_TIMEOUT_MS: '5000'
}

test('posts the first-party contract using plain mailbox addresses', async () => {
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ status: 'accepted', messageId: 'postal-1' }), { status: 202 })
  }

  const result = await sendMail({
    from: 'no-reply@seemplifyai.com',
    fromName: 'Seemplify Identity',
    to: 'person@example.com',
    subject: 'Welcome',
    text: 'Welcome.',
    tag: 'welcome',
    idempotencyKey: 'welcome:person-1'
  }, environment)

  assert.equal(result.messageId, 'postal-1')
  assert.equal(captured.url, 'http://127.0.0.1:5020/v1/messages')
  assert.equal(captured.headers.Authorization, 'Bearer identity.test-secret')
  assert.equal(captured.headers['Idempotency-Key'], 'welcome:person-1')
  assert.deepEqual(captured.body, {
    from: 'no-reply@seemplifyai.com',
    fromName: 'Seemplify Identity',
    to: ['person@example.com'],
    subject: 'Welcome',
    text: 'Welcome.',
    tag: 'welcome'
  })
})

test('fails closed without a credential and never reaches the network', async () => {
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('unexpected') }
  await assert.rejects(
    sendMail({ to: 'person@example.com', subject: 'No', text: 'No', idempotencyKey: 'closed-1' }, { ...environment, MAIL_API_TOKEN: '' }),
    (error) => error instanceof MailError && error.code === 'mail_not_configured'
  )
  assert.equal(called, false)
})

test('classifies authentication as permanent and service outages as retryable', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'invalid_key' }), { status: 401 })
  await assert.rejects(
    sendMail({ to: 'person@example.com', subject: 'Auth', text: 'Auth', idempotencyKey: 'auth-1' }, environment),
    (error) => error instanceof MailError && error.permanent && !error.retryable
  )

  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'sending_disabled', message: 'disabled' }), { status: 503 })
  await assert.rejects(
    sendMail({ to: 'person@example.com', subject: 'Later', text: 'Later', idempotencyKey: 'retry-1' }, environment),
    (error) => error instanceof MailError && error.retryable
  )
})

test('rejects display-address input because the API accepts plain mailboxes only', async () => {
  await assert.rejects(
    sendMail({ to: '"Person" <person@example.com>', subject: 'Bad', text: 'Bad', idempotencyKey: 'bad-address' }, environment),
    (error) => error instanceof MailError && error.code === 'invalid_message'
  )
})
