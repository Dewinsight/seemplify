/**
 * Deep-link helpers into the recruiter apps, used when IdP onboarding is retired.
 *
 * - RECRUITER_PORTAL_URL : the candidate/employee-facing portal (recruiter/candidates)
 * - RECRUITER_ADMIN_URL  : the recruiter staff app (recruiter/frontend), for admin links
 */

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

export function recruiterPortalUrl() {
  return trimTrailingSlash(process.env.RECRUITER_PORTAL_URL || '')
}

export function recruiterAdminUrl() {
  return trimTrailingSlash(process.env.RECRUITER_ADMIN_URL || process.env.RECRUITER_PORTAL_URL || '')
}

// Employee-facing "my transitions" dashboard in the candidate portal.
export function recruiterMyTransitionsUrl() {
  const base = recruiterPortalUrl()
  return base ? `${base}/dashboard` : ''
}

// A specific transition in the candidate portal.
export function recruiterOnboardingUrl(id) {
  const base = recruiterPortalUrl()
  if (!base) return ''
  return id ? `${base}/onboarding/${encodeURIComponent(id)}` : `${base}/dashboard`
}

// Admin onboarding workspace in the recruiter staff app.
export function recruiterWorkspaceUrl() {
  const base = recruiterAdminUrl()
  return base ? `${base}/onboarding` : ''
}
