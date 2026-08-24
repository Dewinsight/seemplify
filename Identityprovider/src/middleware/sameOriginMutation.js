const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const header = (req, name) => String(req.get?.(name) || '').trim()

/**
 * Cookie-authenticated JSON mutations must originate from this IdP host.
 * Browsers supply Origin and Sec-Fetch-Site; non-browser callers must use an
 * IdP service endpoint instead of replaying an administrator session cookie.
 */
export function requireSameOriginMutation(req, res, next) {
  if (!MUTATING_METHODS.has(String(req.method || '').toUpperCase())) return next()

  const fetchSite = header(req, 'sec-fetch-site').toLowerCase()
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return res.status(403).json({ error: 'Cross-site access-control changes are not allowed.', code: 'CROSS_SITE_MUTATION' })
  }

  const origin = header(req, 'origin')
  if (!origin) return next()

  const forwardedHost = header(req, 'x-forwarded-host').split(',')[0].trim()
  const requestHost = (forwardedHost || header(req, 'host')).toLowerCase()
  try {
    if (!requestHost || new URL(origin).host.toLowerCase() !== requestHost) {
      return res.status(403).json({ error: 'Access-control change origin is not allowed.', code: 'INVALID_MUTATION_ORIGIN' })
    }
  } catch {
    return res.status(403).json({ error: 'Access-control change origin is not allowed.', code: 'INVALID_MUTATION_ORIGIN' })
  }

  return next()
}
