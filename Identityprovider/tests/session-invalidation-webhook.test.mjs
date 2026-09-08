import assert from 'node:assert/strict'
import test from 'node:test'
import { Account } from '../src/models/Account.js'
import { forceUserLogout } from '../src/services/webhookService.js'

test('force logout preserves the account id and sends its distinct canonical Identity subject', async (t) => {
  const previous = Object.fromEntries(['NODE_ENV', 'IDP_WEBHOOK_OUTBOX_ENABLED', 'IDP_WEBHOOK_SECRET']
    .map(key => [key, process.env[key]]))
  Object.assign(process.env, {
    NODE_ENV: 'test', IDP_WEBHOOK_OUTBOX_ENABLED: 'false',
    IDP_WEBHOOK_SECRET: 'test-only-webhook-signing-secret',
  })
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  t.mock.method(Account, 'findById', (id) => {
    assert.equal(id, '000000000000000000000001')
    return { select: fields => {
      assert.equal(fields, 'sub')
      return { lean: async () => ({ sub: 'identity-subject-independent-of-account-id' }) }
    } }
  })
  const payloads = []
  const destinations = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    destinations.push(String(_url))
    const payload = JSON.parse(options.body)
    payloads.push(payload)
    return new Response(JSON.stringify({ received: true, event: payload.event, eventId: payload.eventId }), { status: 202 })
  })
  await forceUserLogout('000000000000000000000001', 'organization_membership_deactivated')
  assert.ok(destinations.includes(process.env.MESSAGING_WEBHOOK_URL || 'http://localhost:3333/api/webhooks/idp'))
  for (const payload of payloads) {
    assert.equal(payload.event, 'user.session.invalidate')
    assert.deepEqual(payload.data, {
      userId: '000000000000000000000001',
      idpSubject: 'identity-subject-independent-of-account-id',
      reason: 'organization_membership_deactivated',
      action: 'force_logout',
    })
  }
})

test('force logout fails visibly when the account subject cannot be resolved', async (t) => {
  t.mock.method(Account, 'findById', () => ({ select: () => ({ lean: async () => null }) }))
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected delivery') })
  await assert.rejects(forceUserLogout('000000000000000000000001'), /Identity subject is required/)
  assert.equal(fetch.mock.callCount(), 0)
})
