/**
 * IDP Subscription Service
 *
 * Verifies subscription access with the Identity Provider
 * Used to check if an organization has access to Payroll Management
 */

const { getIdentityProviderIssuerUrl } = require('../config/identityProvider')

const IDP_URL = getIdentityProviderIssuerUrl('http://localhost:4000')
const FEATURE_KEY = 'payrollManagement'

/**
 * Verify subscription access for an organization
 *
 * @param {string} orgId - Organization ID from IDP
 * @param {string} accessToken - User's access token
 * @param {string} featureKey - Feature to check (defaults to payrollManagement)
 * @returns {Promise<{allowed: boolean, reason?: string, subscription?: object}>}
 */
async function verifySubscriptionAccess(orgId, accessToken, featureKey = FEATURE_KEY) {
  if (!orgId) {
    return { allowed: false, reason: 'no_organization' }
  }

  try {
    const response = await fetch(
      `${IDP_URL}/api/organizations/${orgId}/subscription/verify`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.ok) {
      console.error(`[SubscriptionService] IDP returned ${response.status} for org ${orgId}`)
      // If we can't verify, we fail closed for security
      return { allowed: false, reason: 'verification_failed', status: response.status }
    }

    const data = await response.json()

    // No subscription at all
    if (!data.hasSubscription) {
      console.log(`[SubscriptionService] Org ${orgId} has no subscription`)
      return {
        allowed: false,
        reason: 'no_subscription',
        subscribeUrl: `${IDP_URL}/plans`
      }
    }

    // Subscription exists but not active
    if (data.status !== 'active' && data.status !== 'grace_period') {
      console.log(`[SubscriptionService] Org ${orgId} subscription status: ${data.status}`)
      return {
        allowed: false,
        reason: 'subscription_inactive',
        status: data.status,
        subscribeUrl: `${IDP_URL}/subscription`
      }
    }

    // Check specific feature access
    if (featureKey && data.features && !data.features[featureKey]) {
      console.log(`[SubscriptionService] Org ${orgId} does not have feature: ${featureKey}`)
      return {
        allowed: false,
        reason: 'feature_not_included',
        feature: featureKey,
        planName: data.planName,
        subscribeUrl: `${IDP_URL}/plans`
      }
    }

    // All checks passed
    console.log(`[SubscriptionService] Org ${orgId} has access to ${featureKey}`)
    return {
      allowed: true,
      subscription: {
        planId: data.planId,
        planName: data.planName,
        status: data.status,
        expiresAt: data.expiresAt,
        isInGracePeriod: data.isInGracePeriod,
        features: data.features,
        limits: data.limits
      }
    }
  } catch (error) {
    console.error('[SubscriptionService] Error verifying subscription:', error.message)
    // Fail closed - if we can't verify, don't allow access
    return {
      allowed: false,
      reason: 'verification_error',
      error: error.message
    }
  }
}

/**
 * Get the IDP subscription required URL for redirects
 *
 * @param {string} appName - Name of the app (e.g., 'payroll-management')
 * @param {string} orgId - Organization ID
 * @param {string} reason - Reason for denial
 * @returns {string} URL to redirect to
 */
function getSubscriptionRequiredUrl(appName, orgId, reason) {
  const params = new URLSearchParams({
    app: appName,
    org: orgId || '',
    reason: reason || 'no_subscription'
  })
  return `${IDP_URL}/subscription-required?${params.toString()}`
}

/**
 * Get the IDP plans page URL
 * @returns {string}
 */
function getPlansUrl() {
  return `${IDP_URL}/plans`
}

/**
 * Get the IDP subscription page URL
 * @returns {string}
 */
function getSubscriptionUrl() {
  return `${IDP_URL}/subscription`
}

module.exports = {
  verifySubscriptionAccess,
  getSubscriptionRequiredUrl,
  getPlansUrl,
  getSubscriptionUrl,
  FEATURE_KEY,
  IDP_URL
}
