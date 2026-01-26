import express from 'express'
import { requireAdminAuth, auditLog, adminRateLimit } from '../middleware/adminAuth.js'
import { subscriptionService } from '../services/subscriptionService.js'

const router = express.Router()

/**
 * Admin Subscriptions API Routes
 * All routes require system admin authentication
 */

// Apply admin auth to all routes
router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 200, windowMs: 15 * 60 * 1000 }))

/**
 * GET /api/admin/subscriptions
 * Get all subscriptions with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const { status, organizationId, planId } = req.query
    const filters = {}

    if (status) filters.status = status
    if (organizationId) filters.organizationId = organizationId
    if (planId) filters.planId = planId

    const subscriptions = await subscriptionService.getAllSubscriptions(filters)
    res.json({ subscriptions })
  } catch (error) {
    console.error('Error fetching subscriptions:', error)
    res.status(500).json({ error: 'Failed to fetch subscriptions' })
  }
})

/**
 * GET /api/admin/subscriptions/stats
 * Get subscription statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await subscriptionService.getStats()
    res.json({ stats })
  } catch (error) {
    console.error('Error fetching subscription stats:', error)
    res.status(500).json({ error: 'Failed to fetch subscription statistics' })
  }
})

/**
 * GET /api/admin/subscriptions/:subscriptionId
 * Get subscription by ID
 */
router.get('/:subscriptionId', async (req, res) => {
  try {
    const subscription = await subscriptionService.getSubscriptionById(req.params.subscriptionId)
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.json({ subscription })
  } catch (error) {
    console.error('Error fetching subscription:', error)
    res.status(500).json({ error: 'Failed to fetch subscription' })
  }
})

/**
 * POST /api/admin/subscriptions
 * Create a subscription directly (admin bypass - no request needed)
 */
router.post('/', auditLog('create_subscription_direct'), async (req, res) => {
  try {
    const {
      organizationId,
      planId,
      billingCycle,
      startDate,
      endDate,
      customLimits,
      customFeatures,
      notes
    } = req.body

    // Validate required fields
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required' })
    }
    if (!planId) {
      return res.status(400).json({ error: 'Plan ID is required' })
    }
    if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Valid billing cycle (monthly/yearly) is required' })
    }

    const subscription = await subscriptionService.createSubscriptionDirectly(
      {
        organizationId,
        planId,
        billingCycle,
        startDate,
        endDate,
        customLimits,
        customFeatures,
        notes
      },
      req.user._id
    )

    res.status(201).json({
      message: 'Subscription created successfully',
      subscription
    })
  } catch (error) {
    console.error('Error creating subscription:', error)
    if (error.message === 'Organization not found' || error.message === 'Plan not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to create subscription' })
  }
})

/**
 * POST /api/admin/subscriptions/:subscriptionId/extend
 * Extend a subscription
 */
router.post('/:subscriptionId/extend', auditLog('extend_subscription'), async (req, res) => {
  try {
    const { days, notes } = req.body

    if (!days || days < 1) {
      return res.status(400).json({ error: 'Valid number of days is required' })
    }

    const subscription = await subscriptionService.extendSubscription(
      req.params.subscriptionId,
      parseInt(days),
      req.user._id,
      notes
    )

    res.json({
      message: `Subscription extended by ${days} days`,
      subscription
    })
  } catch (error) {
    console.error('Error extending subscription:', error)
    if (error.message === 'Subscription not found') {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.status(500).json({ error: 'Failed to extend subscription' })
  }
})

/**
 * POST /api/admin/subscriptions/:subscriptionId/cancel
 * Cancel a subscription
 */
router.post('/:subscriptionId/cancel', auditLog('cancel_subscription'), async (req, res) => {
  try {
    const { reason } = req.body

    const subscription = await subscriptionService.cancelSubscription(
      req.params.subscriptionId,
      reason,
      req.user._id
    )

    res.json({
      message: 'Subscription cancelled',
      subscription
    })
  } catch (error) {
    console.error('Error cancelling subscription:', error)
    if (error.message === 'Subscription not found') {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.status(500).json({ error: 'Failed to cancel subscription' })
  }
})

/**
 * POST /api/admin/subscriptions/:subscriptionId/suspend
 * Suspend a subscription
 */
router.post('/:subscriptionId/suspend', auditLog('suspend_subscription'), async (req, res) => {
  try {
    const { reason } = req.body

    const subscription = await subscriptionService.suspendSubscription(
      req.params.subscriptionId,
      reason
    )

    res.json({
      message: 'Subscription suspended',
      subscription
    })
  } catch (error) {
    console.error('Error suspending subscription:', error)
    if (error.message === 'Subscription not found') {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.status(500).json({ error: 'Failed to suspend subscription' })
  }
})

/**
 * POST /api/admin/subscriptions/:subscriptionId/reactivate
 * Reactivate a suspended subscription
 */
router.post('/:subscriptionId/reactivate', auditLog('reactivate_subscription'), async (req, res) => {
  try {
    const subscription = await subscriptionService.reactivateSubscription(
      req.params.subscriptionId
    )

    res.json({
      message: 'Subscription reactivated',
      subscription
    })
  } catch (error) {
    console.error('Error reactivating subscription:', error)
    if (error.message === 'Subscription not found') {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.status(500).json({ error: 'Failed to reactivate subscription' })
  }
})

/**
 * PUT /api/admin/subscriptions/:subscriptionId/customizations
 * Update subscription custom limits/features
 */
router.put('/:subscriptionId/customizations', auditLog('update_subscription_customizations'), async (req, res) => {
  try {
    const { customLimits, customFeatures, notes } = req.body

    const subscription = await subscriptionService.updateSubscriptionCustomizations(
      req.params.subscriptionId,
      customLimits,
      customFeatures,
      notes
    )

    res.json({
      message: 'Subscription customizations updated',
      subscription
    })
  } catch (error) {
    console.error('Error updating subscription customizations:', error)
    if (error.message === 'Subscription not found') {
      return res.status(404).json({ error: 'Subscription not found' })
    }
    res.status(500).json({ error: 'Failed to update subscription customizations' })
  }
})

/**
 * POST /api/admin/subscriptions/lifecycle/process-expired
 * Process expired subscriptions (cron job endpoint)
 */
router.post('/lifecycle/process-expired', auditLog('process_expired_subscriptions'), async (req, res) => {
  try {
    const count = await subscriptionService.processExpiredSubscriptions()
    res.json({
      message: `Processed ${count} expired subscriptions`,
      processedCount: count
    })
  } catch (error) {
    console.error('Error processing expired subscriptions:', error)
    res.status(500).json({ error: 'Failed to process expired subscriptions' })
  }
})

/**
 * POST /api/admin/subscriptions/lifecycle/process-grace-period
 * Process subscriptions past grace period (cron job endpoint)
 */
router.post('/lifecycle/process-grace-period', auditLog('process_grace_period'), async (req, res) => {
  try {
    const count = await subscriptionService.processGracePeriodEnd()
    res.json({
      message: `Processed ${count} subscriptions past grace period`,
      processedCount: count
    })
  } catch (error) {
    console.error('Error processing grace period:', error)
    res.status(500).json({ error: 'Failed to process grace period subscriptions' })
  }
})

/**
 * POST /api/admin/subscriptions/lifecycle/send-reminders
 * Send renewal reminders (cron job endpoint)
 */
router.post('/lifecycle/send-reminders', auditLog('send_renewal_reminders'), async (req, res) => {
  try {
    const count = await subscriptionService.sendRenewalReminders()
    res.json({
      message: `Sent ${count} renewal reminders`,
      sentCount: count
    })
  } catch (error) {
    console.error('Error sending renewal reminders:', error)
    res.status(500).json({ error: 'Failed to send renewal reminders' })
  }
})

/**
 * POST /api/admin/subscriptions/lifecycle/expire-requests
 * Expire old pending requests (cron job endpoint)
 */
router.post('/lifecycle/expire-requests', auditLog('expire_old_requests'), async (req, res) => {
  try {
    const count = await subscriptionService.expireOldRequests()
    res.json({
      message: `Expired ${count} old requests`,
      expiredCount: count
    })
  } catch (error) {
    console.error('Error expiring old requests:', error)
    res.status(500).json({ error: 'Failed to expire old requests' })
  }
})

export default router
