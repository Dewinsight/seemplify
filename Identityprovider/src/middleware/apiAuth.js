import { Account } from '../models/Account.js'

/**
 * API Authentication Middleware for external service calls (e.g., SmartHR)
 *
 * Validates OAuth 2.0 access tokens for API calls.
 * Uses the OIDC provider's internal AccessToken model (works with opaque tokens).
 *
 * CRITICAL SECURITY REQUIREMENTS:
 * - Token must be valid and not expired
 * - Token must contain user identity (accountId)
 * - Required scopes must be present
 */

// Provider instance (set during initialization in index.js)
let providerInstance = null

export const setProviderInstance = (provider) => {
  providerInstance = provider
  console.log('✅ Provider instance set for API auth')
}

/**
 * Validate API Token using OIDC provider's AccessToken model
 * Works with opaque tokens issued by oidc-provider
 */
export const validateAPIToken = async (req, res, next) => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  const token = authHeader.substring(7)

  try {
    if (!providerInstance) {
      throw new Error('OIDC provider not initialized')
    }

    // Find the AccessToken using the provider's model
    // This works with opaque tokens (default for oidc-provider)
    const accessToken = await providerInstance.AccessToken.find(token)
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    // Check if token is expired
    if (accessToken.isExpired) {
      return res.status(401).json({ error: 'Token expired' })
    }

    // Extract user ID (accountId in oidc-provider)
    const userId = accessToken.accountId
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token: missing account ID' })
    }

    // Load user account
    const account = await Account.findOne({ sub: userId })
    if (!account) {
      return res.status(401).json({ error: 'User account not found' })
    }

    // Attach to request
    req.user = account
    req.tokenPayload = {
      sub: userId,
      scope: accessToken.scope,
      client_id: accessToken.clientId
    }
    req.authMethod = 'token'

    console.log('✅ API token validated for:', account.email)

    next()
  } catch (error) {
    console.error('API token validation error:', error.message)
    return res.status(401).json({
      error: 'Invalid or expired token',
      details: error.message
    })
  }
}

/**
 * Require specific scopes in the token
 * Usage: requireScopes(['organizations:write', 'email'])
 */
export const requireScopes = (requiredScopes) => {
  return (req, res, next) => {
    const tokenScopes = req.tokenPayload?.scope?.split(' ') || []

    for (const scope of requiredScopes) {
      if (!tokenScopes.includes(scope)) {
        return res.status(403).json({
          error: `Missing required scope: ${scope}`
        })
      }
    }

    next()
  }
}

/**
 * Simple API key authentication for service-to-service calls
 * Uses X-API-Key header
 */
export const validateAPIKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key']

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' })
  }

  // Validate against configured API keys
  const validApiKeys = (process.env.API_KEYS || '').split(',').filter(Boolean)

  if (validApiKeys.length === 0) {
    console.warn('⚠️ No API keys configured - API key auth disabled')
    return res.status(500).json({ error: 'API authentication not configured' })
  }

  if (!validApiKeys.includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid API key' })
  }

  next()
}

/**
 * Combined auth: Accept either session auth or API token
 * Useful for endpoints that need to work with both UI and API
 */
export const requireAuthOrAPIToken = async (req, res, next) => {
  // Check for session auth first
  if (req.session && req.session.accountId) {
    try {
      const account = await Account.findOne({ sub: req.session.accountId })
      if (account) {
        req.user = account
        req.authMethod = 'session'
        return next()
      }
    } catch (error) {
      console.error('Session auth check error:', error)
    }
  }

  // Fall back to API token
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return validateAPIToken(req, res, next)
  }

  // No valid auth found
  return res.status(401).json({ error: 'Authentication required' })
}

export default {
  validateAPIToken,
  requireScopes,
  validateAPIKey,
  requireAuthOrAPIToken,
  setProviderInstance
}
