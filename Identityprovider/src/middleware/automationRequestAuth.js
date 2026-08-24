import crypto from 'crypto'
import { readFileSync } from 'fs'
import WebhookReadinessNonce from '../models/WebhookReadinessNonce.js'

export const AUTOMATION_AUTHORIZE_PATH = '/api/internal/automation/authorize'
export const AUTOMATION_REQUEST_TTL_MS = 5 * 60_000

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function resolveAutomationHubSecret() {
  const secretFile = String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET_FILE || '').trim()
  if (secretFile) {
    const value = readFileSync(secretFile, 'utf8').trim()
    if (value.length < 24) throw new Error('WORKSPACE_AUTOMATION_HMAC_SECRET_FILE is too short.')
    return value
  }
  const value = String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET || '').trim()
  if (process.env.NODE_ENV === 'production' || value) {
    if (value.length < 24) throw new Error('WORKSPACE_AUTOMATION_HMAC_SECRET must contain at least 24 characters.')
    return value
  }
  return 'workspace-automation-development-secret-only'
}

export function canonicalAutomationRequest({ timestamp, nonce, method = 'POST', path = AUTOMATION_AUTHORIZE_PATH, body = {} }) {
  return `${timestamp}.${nonce}.${method}.${path}.${JSON.stringify(body)}`
}

export function createAutomationRequestVerifier({
  now = () => Date.now(),
  resolveSecret = resolveAutomationHubSecret,
  claimNonce = async (key, expiresAt) => {
    await WebhookReadinessNonce.init()
    try { await WebhookReadinessNonce.create({ key, expiresAt: new Date(expiresAt) }); return true } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  logger = console
} = {}) {
  return async function verifyAutomationRequest(req, res, next) {
    const timestamp = String(req.get('x-seemplify-automation-timestamp') || '')
    const nonce = String(req.get('x-seemplify-automation-nonce') || '')
    const signature = String(req.get('x-seemplify-automation-signature') || '').replace(/^sha256=/, '')
    const timestampMs = Number(timestamp)
    const current = now()
    if (!Number.isFinite(timestampMs) || Math.abs(current - timestampMs) > AUTOMATION_REQUEST_TTL_MS
        || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return res.status(401).json({ allowed: false, code: 'AUTOMATION_AUTH_INVALID' })
    }
    let expected
    try {
      expected = crypto.createHmac('sha256', resolveSecret()).update(canonicalAutomationRequest({ timestamp, nonce, body: req.body || {} })).digest('hex')
    } catch (error) {
      logger.error('Automation request secret unavailable:', error.message)
      return res.status(503).json({ allowed: false, code: 'AUTOMATION_AUTH_UNAVAILABLE' })
    }
    if (!safeEqual(signature, expected)) return res.status(401).json({ allowed: false, code: 'AUTOMATION_AUTH_INVALID' })
    try {
      const claimed = await claimNonce(`automation:${nonce}`, Math.max(current, timestampMs) + AUTOMATION_REQUEST_TTL_MS)
      if (!claimed) return res.status(409).json({ allowed: false, code: 'AUTOMATION_AUTH_REPLAYED' })
    } catch (error) {
      logger.error('Automation replay guard unavailable:', error.message)
      return res.status(503).json({ allowed: false, code: 'AUTOMATION_REPLAY_GUARD_UNAVAILABLE' })
    }
    return next()
  }
}
