import crypto from 'node:crypto'

export const SHARED_AI_ADMIN_SERVICE_ID = 'identity-provider-admin'
export const SHARED_AI_ADMIN_PATH = '/api/internal/ai-admin/v1/dashboard'

function configuration(env = process.env) {
  return {
    baseUrl: String(env.SHARED_AI_ADMIN_BASE_URL || 'http://recruiter-backend:5001').replace(/\/+$/, ''),
    secret: String(env.AI_GATEWAY_ADMIN_ANALYTICS_SECRET || '').trim()
  }
}

export function createSharedAIAdminHeaders(body, { secret, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
  if (String(secret || '').trim().length < 32) {
    const error = new Error('Shared AI admin analytics is not configured')
    error.code = 'SHARED_AI_ADMIN_NOT_CONFIGURED'
    throw error
  }
  const timestamp = String(now())
  const nonce = randomBytes(24).toString('base64url')
  const canonical = [timestamp, nonce, SHARED_AI_ADMIN_SERVICE_ID, 'POST', SHARED_AI_ADMIN_PATH, body].join('\n')
  return {
    'content-type': 'application/json',
    'x-seemplify-service': SHARED_AI_ADMIN_SERVICE_ID,
    'x-seemplify-signature-version': '2',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  }
}

export async function getSharedAIGatewayAdminDashboard(filters = {}, options = {}) {
  const config = configuration(options.env)
  const body = JSON.stringify(filters)
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(`${config.baseUrl}${SHARED_AI_ADMIN_PATH}`, {
    method: 'POST',
    headers: createSharedAIAdminHeaders(body, {
      secret: config.secret,
      now: options.now,
      randomBytes: options.randomBytes
    }),
    body,
    signal: AbortSignal.timeout(options.timeoutMs || 20_000)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(result.message || 'Shared AI analytics could not be loaded'))
    error.code = String(result.code || 'SHARED_AI_ADMIN_REQUEST_FAILED')
    error.statusCode = response.status
    throw error
  }
  return result
}
