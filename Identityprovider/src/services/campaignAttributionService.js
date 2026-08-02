import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'

export const ATTRIBUTION_QUERY_PARAM = 'sa_ct'
export const ATTRIBUTION_COOKIE = 'seemplify-attribution'
export const VISITOR_COOKIE = 'seemplify-visitor'
export const SESSION_COOKIE = 'seemplify-session'

function getSecret() {
  return String(
    process.env.MARKETING_ATTRIBUTION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.OIDC_COOKIE_SECRET ||
    'seemplify-dev-attribution-secret'
  )
}

function getSecretKey() {
  return new TextEncoder().encode(getSecret())
}

export function createVisitorId() {
  return crypto.randomUUID()
}

export function createSessionId() {
  return crypto.randomUUID()
}

export function isSeemplifyOwnedUrl(input = '') {
  if (!input) return false

  try {
    const url = new URL(input, 'https://seemplifyai.com')
    return /(^|\.)seemplifyai\.com$/i.test(url.hostname) || /^localhost$/i.test(url.hostname)
  } catch {
    return false
  }
}

export function normalizeUtmFields(input = {}) {
  return {
    source: String(input.source || input.utmSource || input.utm_source || '').trim(),
    medium: String(input.medium || input.utmMedium || input.utm_medium || '').trim(),
    campaign: String(input.campaign || input.utmCampaign || input.utm_campaign || '').trim(),
    term: String(input.term || input.utmTerm || input.utm_term || '').trim(),
    content: String(input.content || input.utmContent || input.utm_content || '').trim()
  }
}

export function buildAttributionTouch({
  sourceType = 'unknown',
  source = '',
  channel = '',
  campaignId = null,
  batchId = null,
  recipientId = null,
  campaignName = '',
  brevoCampaignId = null,
  brevoMessageId = '',
  signedToken = '',
  visitorId = '',
  sessionId = '',
  email = '',
  landingPage = '',
  referrer = '',
  metadata = {},
  utm = {},
  occurredAt = new Date()
} = {}) {
  return {
    sourceType,
    source,
    channel,
    campaignId,
    batchId,
    recipientId,
    campaignName,
    brevoCampaignId,
    brevoMessageId,
    signedToken,
    visitorId,
    sessionId,
    email,
    landingPage,
    referrer,
    metadata,
    utm: normalizeUtmFields(utm),
    occurredAt
  }
}

export async function createCampaignAttributionToken({
  campaignId,
  batchId,
  recipientId,
  email,
  campaignName = ''
} = {}) {
  const payload = {}
  if (campaignId) payload.campaignId = String(campaignId)
  if (batchId) payload.batchId = String(batchId)
  if (recipientId) payload.recipientId = String(recipientId)
  if (email) payload.email = String(email).trim().toLowerCase()
  if (campaignName) payload.campaignName = String(campaignName).trim()

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('120d')
    .sign(getSecretKey())
}

export async function verifyCampaignAttributionToken(token) {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(String(token), getSecretKey())
    return payload
  } catch {
    return null
  }
}

export function withCampaignTrackingParams(urlInput, {
  token,
  utmSource,
  utmMedium,
  utmCampaign
}) {
  const url = new URL(urlInput, 'https://seemplifyai.com')

  if (token) {
    url.searchParams.set(ATTRIBUTION_QUERY_PARAM, token)
  }
  if (utmSource) url.searchParams.set('utm_source', utmSource)
  if (utmMedium) url.searchParams.set('utm_medium', utmMedium)
  if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign)

  if (url.origin === 'https://seemplifyai.com') {
    return url.pathname + url.search + url.hash
  }

  return url.toString()
}

export async function resolveRequestAttribution(req, body = {}) {
  const queryToken = String(req.query?.[ATTRIBUTION_QUERY_PARAM] || body?.[ATTRIBUTION_QUERY_PARAM] || '').trim()
  const cookieToken = String(req.cookies?.[ATTRIBUTION_COOKIE] || body?.attributionToken || '').trim()
  const signedToken = queryToken || cookieToken || ''
  const verifiedToken = signedToken ? await verifyCampaignAttributionToken(signedToken) : null

  const visitorId = String(
    body?.visitorId ||
    req.cookies?.[VISITOR_COOKIE] ||
    req.headers['x-seemplify-visitor-id'] ||
    ''
  ).trim() || createVisitorId()

  const sessionId = String(
    body?.sessionId ||
    req.cookies?.[SESSION_COOKIE] ||
    req.headers['x-seemplify-session-id'] ||
    ''
  ).trim() || createSessionId()

  return {
    signedToken,
    verifiedToken,
    visitorId,
    sessionId,
    utm: normalizeUtmFields({
      ...req.query,
      ...body
    })
  }
}
