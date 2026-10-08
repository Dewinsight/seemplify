import crypto from 'node:crypto'
import fs from 'node:fs'
import { SignJWT } from 'jose'

export function resolveLearningAdminSsoSecret(env = process.env) {
  const configured = String(env.LEARNING_ADMIN_SSO_SECRET || env.OIDC_LEARNING_SECRET || '').trim()
  if (configured) return configured
  try {
    const config = JSON.parse(fs.readFileSync(env.CLIENTS_CONFIG || new URL('../../clients.json', import.meta.url), 'utf8'))
    return String(config.clients?.find(client => client.client_id === 'seemplify-learning')?.client_secret || '').trim()
  } catch {
    return ''
  }
}

export async function buildLearningAdminLaunchUrl(account) {
  if (!account?.hasAdminAccess?.() || (account.isSuperAdmin !== true && account.isSystemAdmin !== true)) {
    throw new Error('Learning administrator launch requires IdP administrator access')
  }
  const sub = String(account.sub || account._id || '').trim()
  const email = String(account.email || '').trim().toLowerCase()
  const secret = resolveLearningAdminSsoSecret()
  if (!sub || !email || secret.length < 32) throw new Error('Learning administrator SSO is not configured')
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    email, name: String(account.profile?.name || email), email_verified: true,
    isSuperAdmin: account.isSuperAdmin === true, isSystemAdmin: true,
    jti: crypto.randomUUID()
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('aiin-idp-admin').setAudience('learning-admin').setSubject(sub)
    .setIssuedAt(now).setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(secret))
  const base = process.env.SEEMPLIFY_LEARNING_URL || 'https://learning.seemplifyai.com'
  const launch = new URL('/auth/idp-admin', base)
  launch.searchParams.set('token', token)
  return launch.toString()
}
