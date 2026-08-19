const INTERACTION_UID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeInteractionUid(value) {
  const uid = String(value || '').trim()
  return INTERACTION_UID_PATTERN.test(uid) ? uid : ''
}

export function buildEmailVerificationPath({ accountId, email = '', interactionUid = '', error = '' } = {}) {
  const normalizedAccountId = String(accountId || '').trim()
  if (!normalizedAccountId) throw new TypeError('accountId is required')

  const params = new URLSearchParams()
  if (email) params.set('email', String(email))

  const normalizedInteractionUid = normalizeInteractionUid(interactionUid)
  if (normalizedInteractionUid) params.set('interaction_uid', normalizedInteractionUid)
  if (error) params.set('error', String(error))

  const query = params.toString()
  const pathname = `/verify-email/${encodeURIComponent(normalizedAccountId)}`
  return query ? `${pathname}?${query}` : pathname
}

export function buildInteractionVerificationPath(interactionUid) {
  const uid = normalizeInteractionUid(interactionUid)
  return uid ? `/interaction/${encodeURIComponent(uid)}/verify-email` : ''
}

export function isMatchingLoginInteraction(routeUid, details) {
  const expectedUid = normalizeInteractionUid(routeUid)
  const actualUid = normalizeInteractionUid(details?.uid)
  return Boolean(expectedUid) && expectedUid === actualUid && details?.prompt?.name === 'login'
}

export function getInteractionSignupCredentialError({ email, password, confirmPassword } = {}) {
  const normalizedEmail = String(email || '').trim()
  const normalizedPassword = String(password || '')
  if (!BASIC_EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 320) return 'invalid_email'
  if (normalizedPassword.length < 8) return 'weak_password'
  if (normalizedPassword !== String(confirmPassword || '')) return 'passwords_mismatch'
  return ''
}

export function getEmailVerificationErrorCode(reason) {
  const message = String(reason || '').toLowerCase()
  if (message.includes('expired') || message.includes('no otp')) return 'expired_code'
  if (message.includes('too many')) return 'too_many_attempts'
  if (message.includes('locked')) return 'account_locked'
  if (message.includes('already verified')) return 'already_verified'
  return 'invalid_code'
}
