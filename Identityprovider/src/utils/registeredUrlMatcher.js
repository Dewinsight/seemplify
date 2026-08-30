function parseRegisteredUrl(value) {
  if (typeof value !== 'string' || !value) return null

  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return parsed
  } catch {
    return null
  }
}

function hostnameMatches(candidateHostname, registeredHostname) {
  const candidateLabels = candidateHostname.toLowerCase().split('.')
  const registeredLabels = registeredHostname.toLowerCase().split('.')
  if (candidateLabels.length !== registeredLabels.length) return false
  if (registeredLabels.filter((label) => label === '*').length !== 1) return false

  return registeredLabels.every((label, index) => {
    if (label === '*') return Boolean(candidateLabels[index])
    return label === candidateLabels[index]
  })
}

/**
 * Match a requested URL against an exact registered URL or a registered URL
 * with whole-label hostname wildcards. Scheme, credentials, port, path, query,
 * and fragment remain exact so a wildcard can never consume a URL separator or
 * broaden a callback path.
 */
export function matchesRegisteredUrl(requestedUrl, registeredPatterns = []) {
  const requested = parseRegisteredUrl(requestedUrl)
  if (!requested || !Array.isArray(registeredPatterns)) return false

  return registeredPatterns.some((pattern) => {
    const registered = parseRegisteredUrl(pattern)
    if (!registered) return false

    if (!pattern.includes('*')) {
      return registered.href === requested.href
    }
    if (!registered.hostname.includes('*')) return false

    // Exactly one complete hostname label may be a wildcard. Reject use in
    // every other URL component and partial-label forms such as tenant-*.
    if (
      registered.hostname.split('.').some((label) => label.includes('*') && label !== '*') ||
      registered.protocol.includes('*') ||
      registered.username.includes('*') ||
      registered.password.includes('*') ||
      registered.port.includes('*') ||
      registered.pathname.includes('*') ||
      registered.search.includes('*') ||
      registered.hash.includes('*')
    ) return false

    return registered.protocol === requested.protocol &&
      registered.username === requested.username &&
      registered.password === requested.password &&
      registered.port === requested.port &&
      registered.pathname === requested.pathname &&
      registered.search === requested.search &&
      registered.hash === requested.hash &&
      hostnameMatches(requested.hostname, registered.hostname)
  })
}
