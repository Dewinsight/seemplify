/**
 * Claims Refresh Middleware for Performance Management
 * Handles automatic refresh of user claims when marked as stale by webhooks
 */

const { Issuer } = require('openid-client')
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

/**
 * Middleware to refresh claims if marked as stale by webhook
 */
async function claimsRefreshMiddleware(req, res, next) {
  if (!req.session?.user) {
    return next()
  }

  const organizations = req.session.user.organizations || []
  const outdatedPolicy = organizations.some(org => org.authorization?.schemaVersion && org.authorization.schemaVersion < 4)
  if (req.session.claimsNeedRefresh || outdatedPolicy) {
    try {
      console.log(`🔄 Refreshing claims for ${req.session.user.email} (triggered by webhook)`)

      const client = await getOidcClient()
      const accessToken = req.session.user.accessToken || req.session.accessToken

      if (!accessToken && outdatedPolicy) return res.status(401).json({ success: false, code: 'CLAIMS_REFRESH_REQUIRED', error: 'Sign in again to refresh access permissions' })
      if (accessToken) {
        const freshUserinfo = await client.userinfo(accessToken)
        // During a rolling deploy an old IdP may still issue the retired matrix.
        // Do not authorize a request with those privileges after refresh either.
        if (outdatedPolicy && (freshUserinfo.organizations || []).some(org =>
          org.authorization?.schemaVersion && org.authorization.schemaVersion < 4)) {
          return res.status(401).json({ success: false, code: 'CLAIMS_REFRESH_REQUIRED', error: 'Access policy is updating. Sign in again shortly.' })
        }

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
      console.error(`⚠️ Failed to refresh claims:`, error.message)
      if (outdatedPolicy) return res.status(401).json({ success: false, code: 'CLAIMS_REFRESH_REQUIRED', error: 'Sign in again to refresh access permissions' })
    }
  }

  next()
}

module.exports = { claimsRefreshMiddleware }
