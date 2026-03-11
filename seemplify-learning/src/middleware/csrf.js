import crypto from 'crypto'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_SESSION_KEY = 'csrfToken'
const CSRF_COOKIE_NAME = 'seemplify_csrf'

const DEFAULT_EXEMPT_PATH_PREFIXES = [
  '/api/simple-lms/payments/flutterwave/webhook',
  '/api/simple-lms/payments/paystack/webhook'
]

const normalizeHostValue = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''
  const first = normalized.split(',')[0]?.trim() || ''
  return first.replace(/\.$/, '')
}

const extractHostVariants = (value, { isUrl = false } = {}) => {
  const normalized = normalizeHostValue(value)
  if (!normalized) return []

  try {
    const parsed = new URL(isUrl ? normalized : `http://${normalized}`)
    const host = normalizeHostValue(parsed.host)
    const hostname = normalizeHostValue(parsed.hostname)
    const variants = [host, hostname].filter(Boolean)
    return [...new Set(variants)]
  } catch {
    return [normalized]
  }
}

const safeCompare = (a, b) => {
  if (!a || !b) return false
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

const parseHostFromUrl = (value) => {
  return extractHostVariants(value, { isUrl: true })
}

const resolveCsrfTokenFromRequest = (req) => {
  return String(
    req.get('x-csrf-token')
    || req.get('x-xsrf-token')
    || req.body?._csrf
    || req.query?._csrf
    || ''
  ).trim()
}

const isCsrfExemptRequest = (req, exemptPathPrefixes) => {
  const requestPath = String(req.originalUrl || req.path || '').trim().toLowerCase()
  return exemptPathPrefixes.some((prefix) => (
    requestPath.startsWith(String(prefix || '').trim().toLowerCase())
  ))
}

const hasSameOriginHeaders = (req) => {
  const hostCandidates = [
    ...extractHostVariants(req.get('host')),
    ...extractHostVariants(req.get('x-forwarded-host'))
  ]

  if (!hostCandidates.length) return false
  const hostSet = new Set(hostCandidates)

  const originHosts = parseHostFromUrl(req.get('origin'))
  if (originHosts.some((host) => hostSet.has(host))) return true

  const refererHosts = parseHostFromUrl(req.get('referer'))
  return refererHosts.some((host) => hostSet.has(host))
}

const ensureCsrfToken = (req, res) => {
  if (!req.session) return ''
  const existing = String(req.session[CSRF_SESSION_KEY] || '').trim()
  if (existing) {
    res.locals.csrfToken = existing
    res.cookie(CSRF_COOKIE_NAME, existing, {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false
    })
    return existing
  }

  const next = crypto.randomBytes(32).toString('hex')
  req.session[CSRF_SESSION_KEY] = next
  res.locals.csrfToken = next
  res.cookie(CSRF_COOKIE_NAME, next, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false
  })
  return next
}

export const csrfGuard = ({ exemptPathPrefixes = DEFAULT_EXEMPT_PATH_PREFIXES } = {}) => {
  return (req, res, next) => {
    const sessionToken = ensureCsrfToken(req, res)
    const method = String(req.method || 'GET').trim().toUpperCase()

    if (SAFE_METHODS.has(method)) return next()
    if (isCsrfExemptRequest(req, exemptPathPrefixes)) return next()

    if (hasSameOriginHeaders(req)) return next()

    const requestToken = resolveCsrfTokenFromRequest(req)
    if (safeCompare(requestToken, sessionToken)) return next()

    if (String(req.originalUrl || '').startsWith('/api/')) {
      return res.status(403).json({ error: 'CSRF validation failed.', code: 'CSRF_FORBIDDEN' })
    }
    return res.status(403).send('CSRF validation failed.')
  }
}

export default csrfGuard
