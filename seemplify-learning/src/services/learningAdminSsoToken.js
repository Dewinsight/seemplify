import crypto from 'node:crypto'

export function verifyLearningAdminSsoToken(token, {
  secret = process.env.LEARNING_ADMIN_SSO_SECRET || process.env.OIDC_CLIENT_SECRET,
  now = Math.floor(Date.now() / 1000)
} = {}) {
  const invalid = () => { throw new Error('The Learning administrator launch could not be verified.') }
  if (typeof token !== 'string' || token.length > 8192 || String(secret || '').trim().length < 32) return invalid()
  const parts = token.split('.')
  if (parts.length !== 3) return invalid()
  let header, claims
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch { return invalid() }
  if (header?.alg !== 'HS256' || header?.typ !== 'JWT' || !claims || typeof claims !== 'object') return invalid()
  const signature = Buffer.from(parts[2], 'base64url')
  const expected = crypto.createHmac('sha256', String(secret).trim()).update(`${parts[0]}.${parts[1]}`).digest()
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return invalid()
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== 'aiin-idp-admin' || !audience.includes('learning-admin')
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || claims.exp <= now || claims.iat > now + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > 120
    || (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now))
    || typeof claims.sub !== 'string' || !claims.sub.trim()
    || typeof claims.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(claims.email)
    || typeof claims.jti !== 'string' || !claims.jti.trim() || claims.jti.length > 200
    || claims.email_verified !== true || (claims.isSuperAdmin !== true && claims.isSystemAdmin !== true)) return invalid()
  return claims
}
