const SHA_PATTERN = /^[a-f0-9]{40}$/
const ORGANIZATION_PATTERN = /^[a-f0-9]{24}$/
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@|-]{0,254}$/
const MAX_ACCESS_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Candidate access is an operational, short-lived allow-list, not an identity
 * credential. Only server-resolved subject/organization pairs may be supplied.
 * App assignment, current membership and subscription checks still apply.
 */
export function hasN8nCandidateAccess(context, env = process.env, now = Date.now()) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false
  if (typeof context.subject !== 'string' || !SUBJECT_PATTERN.test(context.subject)) return false
  if (typeof context.organizationId !== 'string' || !ORGANIZATION_PATTERN.test(context.organizationId)) return false
  const raw = env.N8N_CANDIDATE_ACCESS_JSON
  if (typeof raw !== 'string' || raw.length > 65536) return false
  const releaseSha = env.N8N_CANDIDATE_RELEASE_SHA
  if (typeof releaseSha !== 'string' || !SHA_PATTERN.test(releaseSha)) return false

  try {
    const access = JSON.parse(raw)
    if (!access || typeof access !== 'object' || Array.isArray(access)) return false
    if (Object.keys(access).some(key => !['expiresAt', 'releaseSha', 'subjects'].includes(key))) return false
    if (access.releaseSha !== releaseSha) return false
    if (typeof access.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(access.expiresAt)) return false
    const expiresAt = Date.parse(access.expiresAt)
    if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > MAX_ACCESS_WINDOW_MS) return false
    const canonicalExpiry = access.expiresAt.includes('.') ? access.expiresAt : access.expiresAt.replace('Z', '.000Z')
    if (new Date(expiresAt).toISOString() !== canonicalExpiry) return false
    if (!Array.isArray(access.subjects) || access.subjects.length < 1 || access.subjects.length > 100) return false
    if (access.subjects.some(entry => (
      !entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).length !== 2
      || typeof entry.subject !== 'string' || !SUBJECT_PATTERN.test(entry.subject)
      || typeof entry.organizationId !== 'string' || !ORGANIZATION_PATTERN.test(entry.organizationId)
    ))) return false
    return access.subjects.some(entry => entry.subject === context.subject && entry.organizationId === context.organizationId)
  } catch {
    return false
  }
}

/** Build preview context from a verified session and a freshly loaded org. */
export function getN8nCandidateContext(account, organization) {
  if (!account || account.emailVerified !== true || !account._id || !account.sub) return undefined
  const organizationId = organization?._id?.toString()
  const selectedOrganizationId = (account.currentOrganization?._id || account.currentOrganization)?.toString()
  if (!organizationId || organizationId !== selectedOrganizationId || !Array.isArray(organization.members)) return undefined
  const activeMember = organization.members.some(member => (
    member?.status === 'active'
    && (member.account?._id || member.account)?.toString() === account._id.toString()
  ))
  return activeMember ? { subject: account.sub, organizationId } : undefined
}
