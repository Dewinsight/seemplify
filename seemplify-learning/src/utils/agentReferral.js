export const normalizeAgentReferralCode = (value) => (
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64)
)

export const buildAgentReferralCode = (account) => {
  const explicitCode = normalizeAgentReferralCode(account?.agentReferralCode || '')
  if (explicitCode) return explicitCode

  const sub = normalizeAgentReferralCode(account?.sub || '')
  if (sub.length >= 8) return sub.slice(-8)

  const id = normalizeAgentReferralCode(account?._id || '')
  return id.slice(-8) || 'AGENT'
}
