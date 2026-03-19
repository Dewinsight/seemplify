import crypto from 'crypto'
import { SignJWT } from 'jose'

const isProduction = process.env.NODE_ENV === 'production'

const RECRUITER_ADMIN_BASE_URL = String(
  process.env.RECRUITER_ADMIN_URL ||
  process.env.SMARTHR_URL ||
  (isProduction ? 'https://app.seemplifyai.com' : 'http://localhost:5000')
)
  .trim()
  .replace(/\/+$/, '')

const RECRUITER_ADMIN_SSO_ISSUER = String(
  process.env.RECRUITER_ADMIN_SSO_ISSUER ||
  process.env.IDP_RECRUITER_ADMIN_SSO_ISSUER ||
  'aiin-idp-admin'
)
  .trim()

const RECRUITER_ADMIN_SSO_AUDIENCE = String(
  process.env.RECRUITER_ADMIN_SSO_AUDIENCE ||
  process.env.IDP_RECRUITER_ADMIN_SSO_AUDIENCE ||
  'recruiter-admin'
)
  .trim()

const parsedTtlSeconds = Number.parseInt(
  process.env.RECRUITER_ADMIN_SSO_TTL_SECONDS ||
  process.env.IDP_RECRUITER_ADMIN_SSO_TTL_SECONDS ||
  '60',
  10
)

const RECRUITER_ADMIN_SSO_TTL_SECONDS = Number.isFinite(parsedTtlSeconds) && parsedTtlSeconds > 0
  ? parsedTtlSeconds
  : 60

const FULL_ADMIN_PERMISSIONS = {
  manageUsers: true,
  manageOrganizations: true,
  manageLicenses: true,
  manageBilling: true,
  viewAnalytics: true,
  systemSettings: true
}

const getRecruiterAdminSsoSecret = () => String(
  process.env.RECRUITER_ADMIN_SSO_SECRET ||
  process.env.IDP_RECRUITER_ADMIN_SSO_SECRET ||
  ''
).trim()

const normalizeAdminIdentity = (account) => {
  if (!account?.hasAdminAccess?.()) {
    throw new Error('Recruiter admin launch requires an IDP system admin or super admin')
  }

  const email = String(account.email || '').trim().toLowerCase()
  if (!email) {
    throw new Error('Recruiter admin launch requires an email address')
  }

  const idpAccountId = String(account.sub || account._id || '').trim()
  if (!idpAccountId) {
    throw new Error('Recruiter admin launch requires a stable IDP account identifier')
  }

  return {
    idpAccountId,
    email,
    name: String(account.profile?.name || email).trim() || email,
    role: account.isSuperAdmin ? 'super_admin' : 'admin',
    permissions: FULL_ADMIN_PERMISSIONS,
    isSuperAdmin: account.isSuperAdmin === true,
    isSystemAdmin: account.isSystemAdmin === true || account.isSuperAdmin === true
  }
}

export const buildRecruiterAdminLaunchUrl = async (account) => {
  const secret = getRecruiterAdminSsoSecret()
  if (!secret) {
    throw new Error('Recruiter admin SSO secret is not configured')
  }

  const identity = normalizeAdminIdentity(account)
  const nowInSeconds = Math.floor(Date.now() / 1000)

  const token = await new SignJWT({
    ...identity,
    jti: crypto.randomUUID()
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(RECRUITER_ADMIN_SSO_ISSUER)
    .setAudience(RECRUITER_ADMIN_SSO_AUDIENCE)
    .setSubject(identity.idpAccountId)
    .setIssuedAt(nowInSeconds)
    .setExpirationTime(nowInSeconds + RECRUITER_ADMIN_SSO_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))

  const launchUrl = new URL('/admin/sso', RECRUITER_ADMIN_BASE_URL)
  launchUrl.searchParams.set('token', token)

  return launchUrl.toString()
}

export default {
  buildRecruiterAdminLaunchUrl
}
