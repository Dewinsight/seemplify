const DAY_SECONDS = 24 * 60 * 60
export const WORKSPACE_REFRESH_TTL_SECONDS = 30 * DAY_SECONDS

const workspaceClient = (client, token) => (
  ['messaging', 'messaging-local'].includes(client?.clientId || token?.clientId)
)

export function workspaceOidcAccountSessionAllowed(ctx, account, token) {
  if (!token || !workspaceClient(ctx?.oidc?.client, token)) return true
  const invalidBefore = new Date(account?.security?.sessionInvalidBefore || 0).getTime()
  if (!Number.isFinite(invalidBefore) || invalidBefore <= 0) return true
  // authTime/iiat retain the original sign-in time through refresh rotation.
  // Access tokens carry iat, allowing userinfo to reject them after Hub logout.
  const issuedAt = Number(token.authTime || token.iiat || token.iat)
  return Number.isFinite(issuedAt) && issuedAt > 0 && issuedAt * 1000 > invalidBefore
}

// Keep the existing oidc-provider 8.x defaults for all other products. Workspace
// refresh credentials are held by its backend, including the loopback PKCE client.
function refreshTokenTtl(ctx, token, client) {
  if (workspaceClient(client, token)) return WORKSPACE_REFRESH_TTL_SECONDS
  if (
    ctx?.oidc?.entities?.RotatedRefreshToken
    && client?.applicationType === 'web'
    && client?.clientAuthMethod === 'none'
    && !token.isSenderConstrained()
  ) {
    return ctx.oidc.entities.RotatedRefreshToken.remainingTTL
  }
  return 14 * DAY_SECONDS
}

async function rotateRefreshToken(ctx) {
  const { RefreshToken: token, Client: client, Grant: grant } = ctx.oidc.entities
  if (workspaceClient(client, token)) {
    // The provider checks account, expiry and prior consumption before this hook.
    // Extend the existing grant alongside the new refresh token; otherwise its
    // original expiry would silently cap an actively used Workspace session.
    // Never recreate an expired grant or modify its scopes/authorization.
    if (!grant || grant.isExpired || token.isExpired || token.consumed) return false
    const expiresAt = Math.floor(Date.now() / 1000) + WORKSPACE_REFRESH_TTL_SECONDS
    if (grant.exp < expiresAt) {
      grant.exp = expiresAt
      await grant.save()
    }
    return true
  }
  if (token.totalLifetime() >= 365.25 * DAY_SECONDS) return false
  if (client.clientAuthMethod === 'none' && !token.isSenderConstrained()) return true
  return token.ttlPercentagePassed() >= 70
}

export const workspaceOidcSessionPolicy = {
  ttl: {
    RefreshToken: refreshTokenTtl,
    Grant: (ctx, grant, client) => workspaceClient(client, grant)
      ? WORKSPACE_REFRESH_TTL_SECONDS
      : 14 * DAY_SECONDS,
  },
  rotateRefreshToken,
}
