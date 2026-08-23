import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  createWorkspaceCallAdminHeaders,
  endAllWorkspaceCalls,
  getWorkspaceCallDashboard,
  WORKSPACE_CALL_ADMIN_ROOT
} from '../src/services/workspaceCallAdminService.js'

const secret = 'identity-workspace-call-admin-secret-material-12345'

test('Workspace call admin client signs the exact method, path, and body', () => {
  const path = `${WORKSPACE_CALL_ADMIN_ROOT}/dashboard`
  const headers = createWorkspaceCallAdminHeaders(path, '{}', {
    secret,
    now: () => 1787500000000,
    randomBytes: () => Buffer.from('abcdefghijklmnopqrstuvwx')
  })
  const canonical = ['1787500000000', headers['x-seemplify-nonce'], 'identity-provider-admin', 'POST', path, '{}'].join('\n')
  assert.equal(headers['x-seemplify-signature'], crypto.createHmac('sha256', secret).update(canonical).digest('hex'))
})

test('dashboard and end-all use the protected Workspace endpoints', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => url.endsWith('/dashboard') ? { calls: [] } : { endedCalls: 2 } }
  }
  const options = { env: { MESSAGING_API_URL: 'https://workspace-api.test', MESSAGING_IDP_SERVICE_SECRET: secret }, fetchImpl }
  assert.deepEqual(await getWorkspaceCallDashboard(options), { calls: [] })
  assert.deepEqual(await endAllWorkspaceCalls(options), { endedCalls: 2 })
  assert.equal(calls[0].url, `https://workspace-api.test${WORKSPACE_CALL_ADMIN_ROOT}/dashboard`)
  assert.equal(calls[1].url, `https://workspace-api.test${WORKSPACE_CALL_ADMIN_ROOT}/end-all`)
  assert.equal(calls.every((call) => call.options.headers['x-seemplify-service'] === 'identity-provider-admin'), true)
})
