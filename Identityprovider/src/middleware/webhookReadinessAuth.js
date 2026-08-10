import crypto from 'crypto'
import WebhookReadinessNonce from '../models/WebhookReadinessNonce.js'

const READINESS_PATH = '/api/internal/webhook-readiness'
const NONCE_TTL_MS = 5 * 60_000

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function createMongoWebhookReadinessNonceClaimer({
  nonceModel = WebhookReadinessNonce
} = {}) {
  let nonceIndexReady

  return async (key, expiresAt) => {
    try {
      // autoIndex may be disabled in production. Cross-replica replay safety
      // depends on the unique key index, so verify/build indexes once per
      // process and fail closed if Mongo cannot provide that guarantee.
      nonceIndexReady ||= nonceModel.init()
      await nonceIndexReady
      await nonceModel.create({ key, expiresAt: new Date(expiresAt) })
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  }
}

const claimMongoNonce = createMongoWebhookReadinessNonceClaimer()

export function createWebhookReadinessVerifier({
  now = () => Date.now(),
  resolveSecret,
  claimNonce = claimMongoNonce,
  logger = console
} = {}) {
  if (typeof resolveSecret !== 'function') {
    throw new TypeError('resolveSecret must be provided')
  }

  return async function verifyWebhookReadinessRequest(req, res, next) {
    const timestamp = String(req.get('x-seemplify-timestamp') || '')
    const nonce = String(req.get('x-seemplify-nonce') || '')
    const signature = String(req.get('x-seemplify-signature') || '')
    const timestampMs = Number(timestamp)
    const currentTime = now()

    if (!Number.isFinite(timestampMs)
        || Math.abs(currentTime - timestampMs) > NONCE_TTL_MS
        || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
        || !/^[a-f0-9]{64}$/i.test(signature)) {
      return res.status(401).json({ code: 'WEBHOOK_READINESS_AUTH_INVALID' })
    }

    const body = JSON.stringify(req.body || {})
    const canonical = [timestamp, nonce, 'POST', READINESS_PATH, body].join('\n')
    const expected = crypto.createHmac('sha256', resolveSecret()).update(canonical).digest('hex')
    if (!timingSafeEqual(signature, expected)) {
      return res.status(401).json({ code: 'WEBHOOK_READINESS_AUTH_INVALID' })
    }

    let claimed
    try {
      // The timestamp may be up to five minutes in the future. Keep the claim
      // until that signed timestamp's full acceptance window ends; expiring it
      // relative to this replica's current time would reopen a replay window.
      claimed = await claimNonce(
        `webhook-readiness:${nonce}`,
        Math.max(currentTime, timestampMs) + NONCE_TTL_MS
      )
    } catch (error) {
      logger.error('Webhook readiness replay guard unavailable:', error.message)
      return res.status(503).json({ code: 'WEBHOOK_READINESS_REPLAY_GUARD_UNAVAILABLE' })
    }

    if (!claimed) {
      return res.status(409).json({ code: 'WEBHOOK_READINESS_REPLAYED' })
    }

    return next()
  }
}

export { NONCE_TTL_MS, READINESS_PATH, timingSafeEqual }
