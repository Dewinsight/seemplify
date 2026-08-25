import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  normalizeRelayEvent,
  normalizeRelayIdentity,
  pushDeliveryOptionsFor,
  verifyRelayRequest
} from '../src/services/browserNotificationRelayService.js'
import BrowserRelayNonce from '../src/models/BrowserRelayNonce.js'

test('relay identities require an authoritative Identity subject', () => {
  assert.deepEqual(normalizeRelayIdentity({ idpSubject: 'account:123', organizationId: 'org-1' }), {
    idpSubject: 'account:123', organizationId: 'org-1'
  })
  assert.throws(() => normalizeRelayIdentity({ userId: '507f1f77bcf86cd799439011' }), /Identity subject/)
})

test('relay events accept only bounded first-party deep links', () => {
  const event = normalizeRelayEvent({ version: 1, eventId: 'call:123:ringing', kind: 'direct_call', deepLink: '/messaging?callId=123' })
  assert.equal(event.deepLink, '/messaging?callId=123')
  assert.throws(() => normalizeRelayEvent({ version: 1, eventId: 'call:123:ringing', kind: 'direct_call', deepLink: 'https://evil.example' }), /relative deep links/)
})

test('push delivery keeps live calls ephemeral and durable activity available for an offline phone', () => {
  assert.deepEqual(pushDeliveryOptionsFor({ kind: 'direct_call' }), { TTL: 45, urgency: 'high' })
  assert.deepEqual(pushDeliveryOptionsFor({ kind: 'direct_message' }), { TTL: 86400, urgency: 'high' })
  assert.deepEqual(pushDeliveryOptionsFor({ kind: 'mention' }), { TTL: 86400, urgency: 'high' })
  assert.deepEqual(pushDeliveryOptionsFor({ kind: 'missed_call' }), { TTL: 86400, urgency: 'high' })
  assert.deepEqual(pushDeliveryOptionsFor({ kind: 'channel_message' }), { TTL: 3600, urgency: 'normal' })
})

test('relay HMAC verification claims each nonce exactly once', async () => {
  const originalCreate = BrowserRelayNonce.create
  const claimed = new Set()
  BrowserRelayNonce.create = async ({ nonce }) => {
    if (claimed.has(nonce)) throw Object.assign(new Error('duplicate'), { code: 11000 })
    claimed.add(nonce)
  }
  try {
    const body = { version: 1, identity: { idpSubject: 'account:123' }, event: { eventId: 'event:123' } }
    const timestamp = '1787000000000'
    const nonce = 'nonce-abcdefghijklmnop'
    const secret = 'test-secret-with-enough-entropy'
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}.${JSON.stringify(body)}`).digest('base64url')
    const req = { body, get: (name) => ({
      'x-seemplify-key-id': 'workspace-v1',
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': signature
    })[name] }
    const env = { SEEMPLIFY_NOTIFICATION_RELAY_KEY_ID: 'workspace-v1', SEEMPLIFY_NOTIFICATION_RELAY_HMAC_KEY: secret }
    await verifyRelayRequest(req, env, Number(timestamp))
    await assert.rejects(() => verifyRelayRequest(req, env, Number(timestamp)), /already used/)
  } finally {
    BrowserRelayNonce.create = originalCreate
  }
})
