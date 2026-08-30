import crypto from 'crypto'
import fs from 'fs'
import WebhookReadinessNonce from '../models/WebhookReadinessNonce.js'

const TTL_MS = 5 * 60_000
export const WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION = 'v1'
export const WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_INFO = 'seemplify:workspace-platform-integration:v1'
export const WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_SALT = 'seemplify:workspace-platform-integration:hkdf-salt:v1'

export function deriveWorkspacePlatformIntegrationHmacKey(value) {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(value, 'utf8'),
    Buffer.from(WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_SALT, 'utf8'),
    Buffer.from(WORKSPACE_PLATFORM_INTEGRATION_HMAC_HKDF_INFO, 'utf8'),
    32
  ))
}

export function resolvePlatformIntegrationServiceSecret(service, {
  env = process.env,
  readFileSync = fs.readFileSync
} = {}) {
  const servicePrefix = String(service || '').toUpperCase().replace(/[^A-Z0-9]+/gu, '_')
  const requiresDedicatedSecret = service === 'workspace'
  const dedicatedFile = env[`IDP_${servicePrefix}_PLATFORM_INTEGRATION_HMAC_SECRET_FILE`]
  const file = String(dedicatedFile || (requiresDedicatedSecret ? '' : env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET_FILE) || '').trim()
  const derivationVersion = String(env.IDP_WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION
    || WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION).trim()
  if (requiresDedicatedSecret && derivationVersion !== WORKSPACE_PLATFORM_INTEGRATION_HMAC_DERIVATION_VERSION) {
    throw new Error('Workspace platform integration HMAC derivation version is unsupported.')
  }
  if (env.NODE_ENV === 'production' && !file && !requiresDedicatedSecret) {
    throw new Error('IDP platform integration HMAC secret file is not configured.')
  }
  const value = file
    ? readFileSync(file, 'utf8').trim()
    : String(
      (requiresDedicatedSecret ? env.MESSAGING_OIDC_CLIENT_SECRET : env[`IDP_${servicePrefix}_PLATFORM_INTEGRATION_HMAC_SECRET`])
        || (requiresDedicatedSecret ? '' : env.IDP_PLATFORM_INTEGRATION_HMAC_SECRET)
        || (requiresDedicatedSecret ? '' : env.EXPERIENCE_ADMIN_SSO_SECRET)
        || ''
    ).trim()
  if (value.length >= 32) {
    return requiresDedicatedSecret ? deriveWorkspacePlatformIntegrationHmacKey(value) : value
  }
  if (env.NODE_ENV !== 'production') {
    const developmentValue = requiresDedicatedSecret
      ? 'workspace-identity-development-secret-change-me'
      : 'experience-admin-development-secret-change-me'
    return requiresDedicatedSecret
      ? deriveWorkspacePlatformIntegrationHmacKey(developmentValue)
      : developmentValue
  }
  throw new Error(requiresDedicatedSecret
    ? 'Workspace service authentication is not configured.'
    : 'Experience service authentication is not configured.')
}

export function canonicalPlatformConfigurationRequest({ timestamp, nonce, service, method, path, contentHash = '' }) {
  const base = `${timestamp}\n${nonce}\n${service}\n${method}\n${path}`
  return contentHash ? `${base}\n${contentHash}` : base
}

export function createPlatformIntegrationServiceAuth(allowedServices = ['experience-management'], { requireBodyHash = false } = {}) {
  const allowed = new Set(allowedServices)
  return async function platformIntegrationServiceAuth(req, res, next) {
  const timestamp = String(req.get('x-seemplify-timestamp') || '')
  const nonce = String(req.get('x-seemplify-nonce') || '')
  const service = String(req.get('x-seemplify-service') || '')
  const signature = String(req.get('x-seemplify-signature') || '')
  const timestampMs = Number(timestamp)
  if (!allowed.has(service) || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > TTL_MS
      || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce) || !/^[a-f0-9]{64}$/iu.test(signature)) {
    return res.status(401).json({ error: 'Invalid service authentication.' })
  }
  let expected
  try {
    const contentHash = String(req.get('x-seemplify-content-sha256') || '')
    if (requireBodyHash) {
      const computedHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex')
      if (!/^[a-f0-9]{64}$/iu.test(contentHash)
          || !crypto.timingSafeEqual(Buffer.from(contentHash, 'hex'), Buffer.from(computedHash, 'hex'))) {
        return res.status(401).json({ error: 'Invalid service request content hash.' })
      }
    }
    expected = crypto.createHmac('sha256', resolvePlatformIntegrationServiceSecret(service)).update(canonicalPlatformConfigurationRequest({
      timestamp, nonce, service, method: req.method, path: req.originalUrl.split('?')[0],
      contentHash: requireBodyHash ? contentHash : ''
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
  req.platformIntegrationService = service
  return next()
  }
}

export const requirePlatformIntegrationService = createPlatformIntegrationServiceAuth(['experience-management'])
