import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  SHARED_AI_ADMIN_PATH,
  createSharedAIAdminHeaders,
  getSharedAIGatewayAdminDashboard
} from '../src/services/sharedAIGatewayAdminService.js'

test('shared AI admin client signs the exact v2 request contract', () => {
  const secret = 'b'.repeat(64)
  const body = JSON.stringify({ days: 30, status: 'failed' })
  const timestamp = 1_786_968_000_000
  const nonceBytes = Buffer.alloc(24, 7)
  const headers = createSharedAIAdminHeaders(body, {
    secret,
    now: () => timestamp,
    randomBytes: () => nonceBytes
  })
  const canonical = [String(timestamp), nonceBytes.toString('base64url'), 'identity-provider-admin', 'POST', SHARED_AI_ADMIN_PATH, body].join('\n')
  assert.equal(headers['x-seemplify-signature-version'], '2')
  assert.equal(headers['x-seemplify-signature'], crypto.createHmac('sha256', secret).update(canonical).digest('hex'))
});

test('shared AI admin client posts filters internally without exposing its secret', async () => {
  const calls = []
  const result = await getSharedAIGatewayAdminDashboard({ days: 7 }, {
    env: {
      SHARED_AI_ADMIN_BASE_URL: 'http://gateway.internal/',
      AI_GATEWAY_ADMIN_ANALYTICS_SECRET: 'c'.repeat(64)
    },
    now: () => 1_786_968_000_000,
    randomBytes: () => Buffer.alloc(24, 4),
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, async json() { return { totals: { executions: 4 } } } }
    }
  })
  assert.equal(result.totals.executions, 4)
  assert.equal(calls[0].url, `http://gateway.internal${SHARED_AI_ADMIN_PATH}`)
  assert.equal(calls[0].options.body, '{"days":7}')
  assert.equal(JSON.stringify(calls[0]).includes('c'.repeat(64)), false)
});
