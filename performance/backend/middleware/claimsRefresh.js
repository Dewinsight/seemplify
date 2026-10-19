/**
 * Claims Refresh Middleware for Performance Management
 * Handles automatic refresh of user claims when marked as stale by webhooks
 */

const { Issuer } = require('openid-client')
const { hasRetiredAuthorization } = require('../services/authorizationPolicyVersion')
const {
  sanitizePerformancePrincipal,
  toOrganizationId
} = require('../services/performanceOrganizationAccess')

function resolveCurrentOrganization(userinfo = {}) {
  return userinfo.currentOrganization || userinfo.current_organization || null
}

let cachedClient = null
let cachedIssuerExpiry = null
const ISSUER_CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Get cached OIDC client
 */
async function getOidcClient() {
  const now = Date.now()
  const issuerUrl = process.env.IDP_ISSUER_URL

  if (cachedClient && cachedIssuerExpiry > now) {
    return cachedClient
  }

  console.log('🔍 Discovering OIDC issuer for claims refresh...')
  const issuer = await Issuer.discover(issuerUrl)
  cachedIssuerExpiry = now + ISSUER_CACHE_TTL

  cachedClient = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
  })

  return cachedClient
}

function requireFreshSignIn(res) {
  return res.status(401).json({ success: false, code: 'CLAIMS_REFRESH_REQUIRED', error: 'Sign in again to refresh access permissions.' })
}

/**
 * Middleware to refresh claims if marked as stale by webhook
 */
async function claimsRefreshMiddleware(req, res, next) {
  if (!req.session?.user) {
    return next()
  }

  const outdatedPolicy = hasRetiredAuthorization(req.session.user)
  if (req.session.claimsNeedRefresh || outdatedPolicy) {
    try {
      console.log(`🔄 Refreshing claims for ${req.session.user.email} (triggered by webhook)`)

      const accessToken = req.session.user.accessToken || req.session.accessToken
      if (!accessToken) return requireFreshSignIn(res)
      const client = await getOidcClient()

      if (accessToken) {
        const freshUserinfo = await client.userinfo(accessToken)
        if (hasRetiredAuthorization(freshUserinfo)) return requireFreshSignIn(res)

        req.session.user = sanitizePerformancePrincipal({
          ...req.session.user,
          organizations: freshUserinfo.organizations || [],
          teams: freshUserinfo.teams || [],
          idpTeams: freshUserinfo.teams || [],
          idpTeamPermissions: freshUserinfo.team_permissions || [],
          currentOrganization: resolveCurrentOrganization(freshUserinfo),
          userinfo: freshUserinfo
        }, req.session.currentOrganizationId)
        req.session.currentOrganizationId = toOrganizationId(req.session.user.currentOrganization)

        req.session.claimsNeedRefresh = false
        req.session.claimsLastRefreshed = Date.now()

        console.log(`✅ Claims refreshed for ${req.session.user.email}`)
      }
    } catch (error) {
      console.warn('Claims refresh failed; sign-in is required.')
      return requireFreshSignIn(res)
    }
  }

  next()
}

module.exports = { claimsRefreshMiddleware }
