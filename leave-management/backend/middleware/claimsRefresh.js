/**
 * Claims Refresh Middleware
 * Handles automatic refresh of user claims when marked as stale by webhooks
 *
 * When a webhook marks a session's claims as needing refresh,
 * this middleware will re-fetch fresh claims from the IdP
 * before processing the request.
 */

const { Issuer } = require('openid-client')

let cachedClient = null
let cachedIssuer = null
let cachedIssuerExpiry = null
const ISSUER_CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Get cached OIDC client
 */
async function getOidcClient() {
  const now = Date.now()
  const issuerUrl = process.env.IDP_ISSUER_URL

  // Return cached client if issuer is still valid
  if (cachedClient && cachedIssuerExpiry > now) {
    return cachedClient
  }

  // Discover and cache issuer
  console.log('🔍 Discovering OIDC issuer for claims refresh...')
  cachedIssuer = await Issuer.discover(issuerUrl)
  cachedIssuerExpiry = now + ISSUER_CACHE_TTL

  cachedClient = new cachedIssuer.Client({
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

  // Check if webhook marked claims as needing refresh
  if (req.session.claimsNeedRefresh) {
    try {
      console.log(`🔄 Refreshing claims for ${req.session.user.email} (triggered by webhook)`)

      const client = await getOidcClient()
      const accessToken = req.session.user.accessToken || req.session.accessToken

      if (accessToken) {
        const freshUserinfo = await client.userinfo(accessToken)

        // Update session with fresh claims
        req.session.user.organizations = freshUserinfo.organizations || []
        req.session.user.teams = freshUserinfo.teams || []
        req.session.user.team_permissions = freshUserinfo.team_permissions || []
        req.session.user.currentOrganization = freshUserinfo.currentOrganization

        // Clear the refresh flag
        req.session.claimsNeedRefresh = false
        req.session.claimsLastRefreshed = Date.now()

        console.log(`✅ Claims refreshed for ${req.session.user.email}`)
      }
    } catch (error) {
      console.error(`⚠️ Failed to refresh claims:`, error.message)
      // Don't block the request, continue with existing claims
    }
  }

  next()
}

/**
 * Periodic claims refresh middleware
 * Refreshes claims every 15 minutes during active use
 */
const CLAIMS_REFRESH_INTERVAL = 15 * 60 * 1000 // 15 minutes

async function periodicClaimsRefreshMiddleware(req, res, next) {
  if (!req.session?.user) {
    return next()
  }

  const lastRefresh = req.session.claimsLastRefreshed || 0
  const now = Date.now()

  if (now - lastRefresh > CLAIMS_REFRESH_INTERVAL) {
    try {
      console.log(`🔄 Periodic claims refresh for ${req.session.user.email}`)

      const client = await getOidcClient()
      const accessToken = req.session.user.accessToken || req.session.accessToken

      if (accessToken) {
        const freshUserinfo = await client.userinfo(accessToken)

        // Update session with fresh claims
        req.session.user.organizations = freshUserinfo.organizations || []
        req.session.user.teams = freshUserinfo.teams || []
        req.session.user.team_permissions = freshUserinfo.team_permissions || []
        req.session.user.currentOrganization = freshUserinfo.currentOrganization

        req.session.claimsLastRefreshed = now
        console.log(`✅ Periodic claims refresh completed for ${req.session.user.email}`)
      }
    } catch (error) {
      console.error(`⚠️ Periodic claims refresh failed:`, error.message)
      // Continue with existing claims
    }
  }

  next()
}

/**
 * Force claims refresh before critical operations
 * Use this for leave approvals, performance reviews, etc.
 */
async function forceClaimsRefresh(req) {
  if (!req.session?.user) {
    return false
  }

  try {
    console.log(`🔄 Force claims refresh for ${req.session.user.email}`)

    const client = await getOidcClient()
    const accessToken = req.session.user.accessToken || req.session.accessToken

    if (accessToken) {
      const freshUserinfo = await client.userinfo(accessToken)

      // Update session with fresh claims
      req.session.user.organizations = freshUserinfo.organizations || []
      req.session.user.teams = freshUserinfo.teams || []
      req.session.user.team_permissions = freshUserinfo.team_permissions || []
      req.session.user.currentOrganization = freshUserinfo.currentOrganization

      req.session.claimsLastRefreshed = Date.now()
      console.log(`✅ Force claims refresh completed for ${req.session.user.email}`)
      return true
    }
  } catch (error) {
    console.error(`⚠️ Force claims refresh failed:`, error.message)
  }

  return false
}

module.exports = {
  claimsRefreshMiddleware,
  periodicClaimsRefreshMiddleware,
  forceClaimsRefresh,
}
