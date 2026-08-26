(function exposeInvitationRecipientParser(globalScope) {
  const EMAIL_CANDIDATE_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi
  const DEFAULT_RECIPIENT_LIMIT = 50

  function decodeNumericEntities(value) {
    return value.replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (match, hexValue, decimalValue) => {
      const codePoint = Number.parseInt(hexValue || decimalValue, hexValue ? 16 : 10)
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return match
      }
    })
  }

  function normalizePastedText(value) {
    return decodeNumericEntities(String(value || ''))
      .replace(/&commat;|&at;/gi, '@')
      .replace(/&period;/gi, '.')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\\@/g, '@')
      .normalize('NFKC')
  }

  function isValidEmail(value) {
    const email = String(value || '').trim()
    if (!email || email.length > 254) return false

    const separatorIndex = email.lastIndexOf('@')
    if (separatorIndex <= 0 || separatorIndex === email.length - 1) return false

    const localPart = email.slice(0, separatorIndex)
    const domain = email.slice(separatorIndex + 1)
    if (localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
      return false
    }

    const labels = domain.split('.')
    if (labels.length < 2 || labels.some(label => (
      !label ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-') ||
      !/^[a-z0-9-]+$/i.test(label)
    ))) {
      return false
    }

    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
  }

  function extractEmailAddresses(value, options = {}) {
    const configuredLimit = Number.parseInt(options.limit, 10)
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : DEFAULT_RECIPIENT_LIMIT
    const normalizedText = normalizePastedText(value)
    const candidates = normalizedText.match(EMAIL_CANDIDATE_PATTERN) || []
    const seen = new Set()
    const emails = []
    let duplicateCount = 0
    let truncatedCount = 0

    for (const candidate of candidates) {
      const email = candidate.toLowerCase()
      if (!isValidEmail(email)) continue
      if (seen.has(email)) {
        duplicateCount += 1
        continue
      }
      seen.add(email)
      if (emails.length >= limit) {
        truncatedCount += 1
        continue
      }
      emails.push(email)
    }

    return {
      emails,
      duplicateCount,
      truncatedCount,
      limit
    }
  }

  globalScope.InvitationRecipientParser = Object.freeze({
    DEFAULT_RECIPIENT_LIMIT,
    extractEmailAddresses,
    isValidEmail,
    normalizePastedText
  })
})(globalThis)
