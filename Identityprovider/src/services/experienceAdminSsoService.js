import crypto from 'crypto'
import { SignJWT } from 'jose'

const isProduction = process.env.NODE_ENV === 'production'

function experienceAdminSecret() {
  const value = String(process.env.EXPERIENCE_ADMIN_SSO_SECRET || '').trim()
  if (value) return value
  if (!isProduction) return 'experience-admin-development-secret-change-me'
  throw new Error('Experience administrator SSO secret is not configured')
}

function adminIdentity(account) {
  if (!account?.hasAdminAccess?.()) {
    throw new Error('Experience administrator launch requires IdP administrator access')
  }
  const sub = String(account.sub || account._id || '').trim()
  const email = String(account.email || '').trim().toLowerCase()
  if (!sub || !email) throw new Error('Experience administrator launch requires a stable identity and email')
  return {
    sub,
    email,
    name: String(account.profile?.name || email).trim() || email,
    isSuperAdmin: account.isSuperAdmin === true,
    isSystemAdmin: account.isSystemAdmin === true || account.isSuperAdmin === true
  }
}

export async function buildExperienceAdminLaunchUrl(account) {
  const identity = adminIdentity(account)
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    email: identity.email,
    name: identity.name,
    isSuperAdmin: identity.isSuperAdmin,
    isSystemAdmin: identity.isSystemAdmin,
    jti: crypto.randomUUID()
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('aiin-idp-admin')
    .setAudience('experience-admin')
    .setSubject(identity.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(experienceAdminSecret()))

  const baseUrl = String(process.env.EXPERIENCE_MANAGEMENT_URL
    || (isProduction ? 'https://experience.seemplifyai.com' : 'http://localhost:5410')).replace(/\/+$/, '')
  const launch = new URL('/api/auth/idp-admin', baseUrl)
  launch.searchParams.set('token', token)
  return launch.toString()
}

export default { buildExperienceAdminLaunchUrl }
