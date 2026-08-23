import crypto from 'node:crypto'

export const WORKSPACE_CALL_ADMIN_SERVICE = 'identity-provider-admin'
export const WORKSPACE_CALL_ADMIN_ROOT = '/api/internal/admin/calls'

function config(env = process.env) {
  return {
    baseUrl: String(env.MESSAGING_API_URL || 'http://workspace-backend:5009').replace(/\/+$/, ''),
    secret: String(env.MESSAGING_IDP_SERVICE_SECRET || env.INTERNAL_SERVICE_SECRET || '').trim()
  }
}

export function createWorkspaceCallAdminHeaders(path, body, { secret, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
  if (String(secret || '').trim().length < 32) {
    const error = new Error('Workspace call administration is not configured')
    error.code = 'WORKSPACE_CALL_ADMIN_NOT_CONFIGURED'
    throw error
  }
  const timestamp = String(now())
  const nonce = randomBytes(24).toString('base64url')
  const canonical = [timestamp, nonce, WORKSPACE_CALL_ADMIN_SERVICE, 'POST', path, body].join('\n')
  return {
    'content-type': 'application/json',
    'x-seemplify-service': WORKSPACE_CALL_ADMIN_SERVICE,
    'x-seemplify-signature-version': '2',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  }
}

async function request(path, payload = {}, options = {}) {
  const configuration = config(options.env)
  const body = JSON.stringify(payload)
  const response = await (options.fetchImpl || fetch)(`${configuration.baseUrl}${path}`, {
    method: 'POST',
    headers: createWorkspaceCallAdminHeaders(path, body, { secret: configuration.secret, now: options.now, randomBytes: options.randomBytes }),
    body,
    signal: AbortSignal.timeout(options.timeoutMs || 15_000)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(result.message || 'Workspace call administration request failed'))
    error.code = String(result.code || 'WORKSPACE_CALL_ADMIN_REQUEST_FAILED')
    error.statusCode = response.status
    throw error
  }
  return result
}

export const getWorkspaceCallDashboard = (options = {}) => request(`${WORKSPACE_CALL_ADMIN_ROOT}/dashboard`, {}, options)
export const endWorkspaceCall = (callId, options = {}) => request(`${WORKSPACE_CALL_ADMIN_ROOT}/${encodeURIComponent(callId)}/end`, {}, options)
export const endAllWorkspaceCalls = (options = {}) => request(`${WORKSPACE_CALL_ADMIN_ROOT}/end-all`, {}, options)
