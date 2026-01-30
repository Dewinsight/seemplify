import express from 'express'
import { requireAdminAuth, auditLog, adminRateLimit } from '../middleware/adminAuth.js'
import { subscriptionService } from '../services/subscriptionService.js'

const router = express.Router()

/**
 * Admin Subscription Requests API Routes
 * All routes require system admin authentication
 */

// Apply admin auth to all routes
router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 200, windowMs: 15 * 60 * 1000 }))

/**
 * GET /api/admin/subscription-requests
 * Get all subscription requests with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const { status, organizationId } = req.query
    const filters = {}

    if (status) filters.status = status
    if (organizationId) filters.organizationId = organizationId

    const requests = await subscriptionService.getAllRequests(filters)
    res.json({ requests })
  } catch (error) {
    console.error('Error fetching subscription requests:', error)
    res.status(500).json({ error: 'Failed to fetch subscription requests' })
  }
})

/**
 * GET /api/admin/subscription-requests/pending
 * Get pending subscription requests
 */
router.get('/pending', async (req, res) => {
  try {
    const requests = await subscriptionService.getPendingRequests()
    res.json({ requests })
  } catch (error) {
    console.error('Error fetching pending requests:', error)
    res.status(500).json({ error: 'Failed to fetch pending requests' })
  }
})

/**
 * GET /api/admin/subscription-requests/stats
 * Get subscription request statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const SubscriptionRequest = (await import('../models/SubscriptionRequest.js')).default
    const stats = await SubscriptionRequest.getStats()
    res.json({ stats })
  } catch (error) {
    console.error('Error fetching request stats:', error)
    res.status(500).json({ error: 'Failed to fetch request statistics' })
  }
})

/**
 * GET /api/admin/subscription-requests/:requestId
 * Get subscription request by ID
 */
router.get('/:requestId', async (req, res) => {
  try {
    const request = await subscriptionService.getRequestById(req.params.requestId)
    if (!request) {
      return res.status(404).json({ error: 'Request not found' })
    }
    res.json({ request })
  } catch (error) {
    console.error('Error fetching subscription request:', error)
    res.status(500).json({ error: 'Failed to fetch subscription request' })
  }
})

/**
 * POST /api/admin/subscription-requests/:requestId/approve
 * Approve a subscription request
 */
router.post('/:requestId/approve', auditLog('approve_subscription_request'), async (req, res) => {
  try {
    const {
      notes,
      customStartDate,
      customEndDate,
      customLimits,
      customFeatures
    } = req.body

    const result = await subscriptionService.approveRequest(
      req.params.requestId,
      req.user._id,
      {
        notes,
        customStartDate,
        customEndDate,
        customLimits,
        customFeatures
      }
    )

    res.json({
      message: 'Subscription request approved successfully',
      request: result.request,
      subscription: result.subscription
    })
  } catch (error) {
    console.error('Error approving subscription request:', error)
    if (error.message === 'Request not found') {
      return res.status(404).json({ error: 'Request not found' })
    }
    if (error.message === 'Request is not pending' || error.message === 'Request has expired') {
      return res.status(400).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to approve subscription request' })
  }
})

/**
 * POST /api/admin/subscription-requests/:requestId/reject
 * Reject a subscription request
 */
router.post('/:requestId/reject', auditLog('reject_subscription_request'), async (req, res) => {
  try {
    const { reason, notes } = req.body

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' })
    }

    const request = await subscriptionService.rejectRequest(
      req.params.requestId,
      req.user._id,
      reason,
      notes
    )

    res.json({
      message: 'Subscription request rejected',
      request
    })
  } catch (error) {
    console.error('Error rejecting subscription request:', error)
    if (error.message === 'Request not found') {
      return res.status(404).json({ error: 'Request not found' })
    }
    if (error.message === 'Request is not pending') {
      return res.status(400).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to reject subscription request' })
  }
})

export default router
