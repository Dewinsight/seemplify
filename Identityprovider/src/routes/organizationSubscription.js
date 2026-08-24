import express from 'express'
import { requireAuth, requireOrganizationMember, requireIdentityPermission } from '../middleware/permissions.js'
import { requireAuthOrAPIToken } from '../middleware/apiAuth.js'
import { Organization } from '../models/Organization.js'
import { subscriptionService } from '../services/subscriptionService.js'

const router = express.Router()

/**
 * Organization Subscription API Routes
 * These routes allow organizations to manage their subscriptions
 * Requires authentication and organization membership
 */

/**
 * GET /api/organizations/:orgId/subscription
 * Get current subscription for organization
 */
router.get('/:orgId/subscription',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const subscription = await subscriptionService.getSubscriptionForOrg(req.params.orgId)

      if (!subscription) {
        return res.json({
          hasSubscription: false,
          subscription: null
        })
      }

      // Get effective features and limits
      const [features, limits] = await Promise.all([
        subscriptionService.getEffectiveFeatures(req.params.orgId),
        subscriptionService.getEffectiveLimits(req.params.orgId)
      ])

      res.json({
        hasSubscription: true,
        subscription: {
          id: subscription._id,
          plan: {
            id: subscription.plan._id,
            name: subscription.plan.name,
            slug: subscription.plan.slug
          },
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          daysUntilExpiry: subscription.daysUntilExpiry,
          isExpired: subscription.isExpired,
          isInGracePeriod: subscription.isInGracePeriod,
          formattedPrice: subscription.formattedPrice
        },
        features,
        limits
      })
    } catch (error) {
      console.error('Error fetching organization subscription:', error)
      res.status(500).json({ error: 'Failed to fetch subscription' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/history
 * Get subscription history for organization
 */
router.get('/:orgId/subscription/history',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const subscriptions = await subscriptionService.getAllSubscriptionsForOrg(req.params.orgId)

      res.json({
        subscriptions: subscriptions.map(sub => ({
          id: sub._id,
          plan: sub.plan ? {
            id: sub.plan._id,
            name: sub.plan.name
          } : null,
          status: sub.status,
          billingCycle: sub.billingCycle,
          startDate: sub.startDate,
          endDate: sub.endDate,
          createdAt: sub.createdAt
        }))
      })
    } catch (error) {
      console.error('Error fetching subscription history:', error)
      res.status(500).json({ error: 'Failed to fetch subscription history' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/requests
 * Get subscription requests for organization
 */
router.get('/:orgId/subscription/requests',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const SubscriptionRequest = (await import('../models/SubscriptionRequest.js')).default
      const requests = await SubscriptionRequest.findAllForOrg(req.params.orgId)

      res.json({
        requests: requests.map(req => ({
          id: req._id,
          plan: req.plan ? {
            id: req.plan._id,
            name: req.plan.name
          } : null,
          billingCycle: req.billingCycle,
          requestType: req.requestType,
          requestTypeDisplay: req.requestTypeDisplay,
          status: req.status,
          statusInfo: req.statusInfo,
          formattedPrice: req.formattedPrice,
          message: req.message,
          rejectionReason: req.rejectionReason,
          createdAt: req.createdAt,
          processedAt: req.processedAt
        }))
      })
    } catch (error) {
      console.error('Error fetching subscription requests:', error)
      res.status(500).json({ error: 'Failed to fetch subscription requests' })
    }
  }
)

/**
 * POST /api/organizations/:orgId/subscription/request
 * Create a subscription request
 */
router.post('/:orgId/subscription/request',
  requireAuth,
  requireOrganizationMember,
  requireIdentityPermission('subscriptions.request'),
  async (req, res) => {
    try {
      const { planId, billingCycle, contactInfo, message } = req.body

      // Validate required fields
      if (!planId) {
        return res.status(400).json({ error: 'Plan ID is required' })
      }
      if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
        return res.status(400).json({ error: 'Valid billing cycle (monthly/yearly) is required' })
      }
      if (!contactInfo || !contactInfo.name || !contactInfo.email || !contactInfo.phone) {
        return res.status(400).json({
          error: 'Contact information (name, email, phone) is required'
        })
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(contactInfo.email)) {
        return res.status(400).json({ error: 'Invalid email format' })
      }

      // Validate phone format (basic validation)
      const phoneRegex = /^[\d\s\-+()]{7,20}$/
      if (!phoneRegex.test(contactInfo.phone)) {
        return res.status(400).json({ error: 'Invalid phone number format' })
      }

      const request = await subscriptionService.createSubscriptionRequest(
        {
          organizationId: req.params.orgId,
          planId,
          billingCycle,
          contactInfo,
          message
        },
        req.user
      )

      res.status(201).json({
        message: 'Subscription request submitted successfully',
        request: {
          id: request._id,
          status: request.status,
          requestType: request.requestType,
          createdAt: request.createdAt
        }
      })
    } catch (error) {
      console.error('Error creating subscription request:', error)

      if (error.message === 'Organization not found') {
        return res.status(404).json({ error: 'Organization not found' })
      }
      if (error.message === 'You must be a member of this organization') {
        return res.status(403).json({ error: error.message })
      }
      if (error.message === 'Plan not found or unavailable') {
        return res.status(400).json({ error: error.message })
      }
      if (error.message === 'Plan is not requestable') {
        return res.status(400).json({ error: 'This plan cannot be requested or renewed manually.' })
      }
      if (error.message === 'You already have a pending subscription request') {
        return res.status(400).json({ error: error.message })
      }

      res.status(500).json({ error: 'Failed to create subscription request' })
    }
  }
)

/**
 * DELETE /api/organizations/:orgId/subscription/requests/:requestId
 * Cancel a pending subscription request
 */
router.delete('/:orgId/subscription/requests/:requestId',
  requireAuth,
  requireOrganizationMember,
  requireIdentityPermission('subscriptions.request'),
  async (req, res) => {
    try {
      // First verify the request belongs to this organization
      const request = await (await import('../models/SubscriptionRequest.js')).default
        .findOne({
          _id: req.params.requestId,
          organization: req.params.orgId
        })

      if (!request) {
        return res.status(404).json({ error: 'Request not found' })
      }

      await subscriptionService.cancelRequest(req.params.requestId, req.user._id)

      res.json({ message: 'Subscription request cancelled' })
    } catch (error) {
      console.error('Error cancelling subscription request:', error)

      if (error.message === 'Request not found') {
        return res.status(404).json({ error: 'Request not found' })
      }
      if (error.message === 'You can only cancel your own requests') {
        return res.status(403).json({ error: error.message })
      }
      if (error.message === 'Can only cancel pending requests') {
        return res.status(400).json({ error: error.message })
      }

      res.status(500).json({ error: 'Failed to cancel subscription request' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/access/:appKey
 * Check if organization can access a specific app
 */
router.get('/:orgId/subscription/access/:appKey',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const canAccess = await subscriptionService.canAccessApp(
        req.params.orgId,
        req.params.appKey
      )

      res.json({
        appKey: req.params.appKey,
        hasAccess: canAccess
      })
    } catch (error) {
      console.error('Error checking app access:', error)
      res.status(500).json({ error: 'Failed to check app access' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/features
 * Get effective features for organization
 */
router.get('/:orgId/subscription/features',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const features = await subscriptionService.getEffectiveFeatures(req.params.orgId)
      res.json({ features })
    } catch (error) {
      console.error('Error fetching effective features:', error)
      res.status(500).json({ error: 'Failed to fetch features' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/limits
 * Get effective limits for organization
 */
router.get('/:orgId/subscription/limits',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const limits = await subscriptionService.getEffectiveLimits(req.params.orgId)
      res.json({ limits })
    } catch (error) {
      console.error('Error fetching effective limits:', error)
      res.status(500).json({ error: 'Failed to fetch limits' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/can-add-members
 * Check if organization can add more members
 */
router.get('/:orgId/subscription/can-add-members',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const { Organization } = await import('../models/Organization.js')
      const org = await Organization.findById(req.params.orgId)

      if (!org) {
        return res.status(404).json({ error: 'Organization not found' })
      }

      const currentMemberCount = org.memberCount
      const canAdd = await subscriptionService.canAddMembers(req.params.orgId, currentMemberCount)

      const limits = await subscriptionService.getEffectiveLimits(req.params.orgId)

      res.json({
        canAddMembers: canAdd,
        currentMemberCount,
        maxMembers: limits.maxMembers,
        isUnlimited: limits.maxMembers === null
      })
    } catch (error) {
      console.error('Error checking member limit:', error)
      res.status(500).json({ error: 'Failed to check member limit' })
    }
  }
)

/**
 * GET /api/organizations/:orgId/subscription/verify
 * Verify subscription status for external apps
 * Returns full subscription info for app-side verification
 *
 * Supports both session auth (UI) and Bearer token auth (external apps)
 */
router.get('/:orgId/subscription/verify',
  requireAuthOrAPIToken,
  async (req, res) => {
    res.set('Cache-Control', 'private, no-store')
    try {
      const orgId = req.params.orgId

      // Verify organization membership (works with both session and API token auth)
      const organization = await Organization.findById(orgId)
      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' })
      }

      const member = organization.members.find(
        m => m.account.toString() === req.user._id.toString() && m.status === 'active'
      )

      if (!member) {
        return res.status(403).json({ error: 'Not a member of this organization' })
      }

      // Load the subscription first so legacy future-dated/expired records are
      // reconciled before features and limits are evaluated.
      const subscription = await subscriptionService.getSubscriptionForOrg(orgId)

      if (!subscription) {
        return res.json({
          verified: true,
          hasSubscription: false,
          status: 'none',
          planId: null,
          planName: null,
          features: {
            recruiter: false,
            leaveManagement: false,
            payrollManagement: false,
            performanceManagement: false,
            timeAttendance: false,
            outlineDocs: false,
            aiChat: false,
            lms: false
          },
          limits: {
            maxMembers: 0,
            maxTeams: 0
          },
          expiresAt: null,
          isInGracePeriod: false,
          canAccessApps: []
        })
      }

      const [features, limits] = await Promise.all([
        subscriptionService.getEffectiveFeatures(orgId),
        subscriptionService.getEffectiveLimits(orgId)
      ])

      // Determine which apps the org can access
      const appKeys = ['recruiter', 'leaveManagement', 'payrollManagement', 'performanceManagement', 'timeAttendance', 'outlineDocs', 'aiChat', 'lms']
      const canAccessApps = appKeys.filter(key => features[key] === true)

      // Determine effective status
      let effectiveStatus = subscription.status
      if (subscription.status === 'expired' && subscription.isInGracePeriod) {
        effectiveStatus = 'grace_period'
      }

      res.json({
        verified: true,
        hasSubscription: true,
        status: effectiveStatus,
        planId: subscription.plan?._id?.toString() || null,
        planName: subscription.plan?.name || null,
        billingCycle: subscription.billingCycle,
        features,
        limits,
        expiresAt: subscription.endDate?.toISOString() || null,
        gracePeriodEnd: subscription.gracePeriodEnd?.toISOString() || null,
        isInGracePeriod: subscription.isInGracePeriod || false,
        daysUntilExpiry: subscription.daysUntilExpiry,
        canAccessApps,
        verifiedAt: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error verifying subscription:', error)
      res.status(500).json({
        verified: false,
        error: 'Failed to verify subscription'
      })
    }
  }
)

export default router
