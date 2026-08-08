/**
 * Accept only an internal absolute-path redirect.
 *
 * A leading `//` (including after URL decoding) is protocol-relative and can
 * leave the Identity Provider origin when passed to `res.redirect`. Backslash
 * variants are rejected as well because browsers may normalize them to `/`.
 */
export function normalizeInternalReturnTo(value) {
  if (typeof value !== 'string') return ''

  const candidate = value.trim()
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return ''
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return ''

  let decoded = candidate
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch (_) {
    return ''
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//')) return ''
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return ''

  try {
    const base = new URL('https://idp.internal')
    const parsed = new URL(candidate, base)
    if (parsed.origin !== base.origin) return ''
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    return ''
  }
}

export function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function serializeForInlineScript(value = '') {
  return JSON.stringify(String(value ?? ''))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function renderInternalReturnToInput(value) {
  const safeReturnTo = normalizeInternalReturnTo(value)
  if (!safeReturnTo) return ''
  return `<input type="hidden" name="return_to" value="${escapeHtmlAttribute(safeReturnTo)}" />`
}
