/**
 * Claims Refresh Middleware for Performance Management
 * Handles automatic refresh of user claims when marked as stale by webhooks
 */

const { Issuer } = require('openid-client')

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

  if (req.session.claimsNeedRefresh) {
    try {
      console.log(`🔄 Refreshing claims for ${req.session.user.email} (triggered by webhook)`)

      const client = await getOidcClient()
      const accessToken = req.session.user.accessToken || req.session.accessToken

      if (accessToken) {
        const freshUserinfo = await client.userinfo(accessToken)

        req.session.user.organizations = freshUserinfo.organizations || []
        req.session.user.teams = freshUserinfo.teams || []
        req.session.user.team_permissions = freshUserinfo.team_permissions || []
        req.session.user.currentOrganization = resolveCurrentOrganization(freshUserinfo)

        req.session.claimsNeedRefresh = false
        req.session.claimsLastRefreshed = Date.now()

        console.log(`✅ Claims refreshed for ${req.session.user.email}`)
      }
    } catch (error) {
      console.error(`⚠️ Failed to refresh claims:`, error.message)
    }
  }

  next()
}

module.exports = { claimsRefreshMiddleware }
