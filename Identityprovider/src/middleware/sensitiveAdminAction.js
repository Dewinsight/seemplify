function header(req, name) {
  return String(req.get?.(name) || '').trim()
}

export function requireSensitiveAdminAction(expectedAction) {
  const requiredAction = String(expectedAction || '').trim()
  if (!requiredAction) throw new TypeError('A sensitive admin action name is required.')

  return (req, res, next) => {
    if (header(req, 'x-seemplify-admin-action') !== requiredAction) {
      return res.status(400).json({ error: 'Explicit admin action confirmation is required.' })
    }

    const fetchSite = header(req, 'sec-fetch-site').toLowerCase()
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
      return res.status(403).json({ error: 'Cross-site admin actions are not allowed.' })
    }

    const origin = header(req, 'origin')
    const forwardedHost = header(req, 'x-forwarded-host').split(',')[0].trim()
    const requestHost = (forwardedHost || header(req, 'host')).toLowerCase()
    if (origin) {
      try {
        if (!requestHost || new URL(origin).host.toLowerCase() !== requestHost) {
          return res.status(403).json({ error: 'Admin action origin is not allowed.' })
        }
      } catch {
        return res.status(403).json({ error: 'Admin action origin is not allowed.' })
      }
    }

    return next()
  }
}

export function disableSecretResponseCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return next()
}
