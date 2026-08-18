import crypto from 'crypto'
import fs from 'fs'
import WebhookReadinessNonce from '../models/WebhookReadinessNonce.js'

const TTL_MS = 5 * 60_000

function serviceSecret() {
  const file = String(process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE || '').trim()
  if (process.env.NODE_ENV === 'production' && !file) {
    throw new Error('IDP platform integration HMAC secret file is not configured.')
  }
  const value = file
    ? fs.readFileSync(file, 'utf8').trim()
    : String(process.env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET || process.env.EXPERIENCE_ADMIN_SSO_SECRET || '').trim()
  if (value.length >= 32) return value
  if (process.env.NODE_ENV !== 'production') return 'experience-admin-development-secret-change-me'
  throw new Error('Experience service authentication is not configured.')
}

export function canonicalPlatformConfigurationRequest({ timestamp, nonce, service, method, path }) {
  return `${timestamp}\n${nonce}\n${service}\n${method}\n${path}`
}

export async function requirePlatformIntegrationService(req, res, next) {
  const timestamp = String(req.get('x-seemplify-timestamp') || '')
  const nonce = String(req.get('x-seemplify-nonce') || '')
  const service = String(req.get('x-seemplify-service') || '')
  const signature = String(req.get('x-seemplify-signature') || '')
  const timestampMs = Number(timestamp)
  if (service !== 'experience-management' || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > TTL_MS
      || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce) || !/^[a-f0-9]{64}$/iu.test(signature)) {
    return res.status(401).json({ error: 'Invalid service authentication.' })
  }
  let expected
  try {
    expected = crypto.createHmac('sha256', serviceSecret()).update(canonicalPlatformConfigurationRequest({
      timestamp, nonce, service, method: req.method, path: req.originalUrl.split('?')[0]
    })).digest('hex')
  } catch (error) {
    console.error('Platform integration service authentication unavailable:', error.message)
    return res.status(503).json({ error: 'Service authentication is unavailable.' })
  }
  const valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  if (!valid) return res.status(401).json({ error: 'Invalid service authentication.' })
  try {
    await WebhookReadinessNonce.init()
    await WebhookReadinessNonce.create({ key: `platform-integration:${service}:${nonce}`, expiresAt: new Date(Date.now() + TTL_MS) })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Service request was already used.' })
    return res.status(503).json({ error: 'Service replay protection is unavailable.' })
  }
  return next()
}
