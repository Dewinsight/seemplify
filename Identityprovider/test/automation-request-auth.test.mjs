import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { canonicalAutomationRequest, createAutomationRequestVerifier } from '../src/middleware/automationRequestAuth.js'

function response() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this }, json(value) { this.payload = value; return this } }
}

test('automation request verifier accepts a fresh signed request once', async () => {
  const secret = 'identity-automation-contract-test-secret'
  const timestamp = '1770000000000'
  const nonce = 'fresh-automation-nonce-100'
  const body = { organizationId: 'org-a', userId: 'user-a' }
  const signature = crypto.createHmac('sha256', secret).update(canonicalAutomationRequest({ timestamp, nonce, body })).digest('hex')
  const claims = new Set()
  const verify = createAutomationRequestVerifier({ now: () => Number(timestamp), resolveSecret: () => secret, claimNonce: async key => !claims.has(key) && Boolean(claims.add(key)) })
  const request = { body, get(name) { return ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': `sha256=${signature}` })[name] } }
  let called = false
  await verify(request, response(), () => { called = true })
  assert.equal(called, true)
  const replay = response()
  await verify(request, replay, () => assert.fail('replay must not continue'))
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.payload.code, 'AUTOMATION_AUTH_REPLAYED')
})

test('automation request verifier rejects body tampering and stale requests', async () => {
  const secret = 'identity-automation-contract-test-secret'
  const timestamp = '1770000000000'
  const nonce = 'fresh-automation-nonce-200'
  const signature = crypto.createHmac('sha256', secret).update(canonicalAutomationRequest({ timestamp, nonce, body: { organizationId: 'org-a' } })).digest('hex')
  const tampered = response()
  await createAutomationRequestVerifier({ now: () => Number(timestamp), resolveSecret: () => secret, claimNonce: async () => true })(
    { body: { organizationId: 'org-b' }, get(name) { return ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': signature })[name] } }, tampered, () => assert.fail('tampering must not continue'))
  assert.equal(tampered.statusCode, 401)
  const stale = response()
  await createAutomationRequestVerifier({ now: () => Number(timestamp) + 600_000, resolveSecret: () => secret, claimNonce: async () => true })(
    { body: {}, get(name) { return ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': signature })[name] } }, stale, () => assert.fail('stale request must not continue'))
  assert.equal(stale.statusCode, 401)
})
