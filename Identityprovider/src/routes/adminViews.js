import express from 'express'
import { requireAdminAuth, setAdminContext } from '../middleware/adminAuth.js'
import { subscriptionService } from '../services/subscriptionService.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import Plan from '../models/Plan.js'
import SubscriptionRequest from '../models/SubscriptionRequest.js'

const router = express.Router()

/**
 * Admin View Routes
 * These routes render the admin panel views
 */

// Apply admin auth and context to all routes
router.use(requireAdminAuth)
router.use(setAdminContext)

/**
 * GET /admin
 * Admin dashboard
 */
router.get('/', async (req, res) => {
  try {
    const stats = await subscriptionService.getStats()
    const recentRequests = await SubscriptionRequest.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate(['organization', 'plan', 'requestedBy'])

    res.render('admin/dashboard', {
      stats,
      recentRequests,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading admin dashboard:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load admin dashboard'
    })
  }
})

/**
 * GET /admin/plans
 * Plans management view
 */
router.get('/plans', async (req, res) => {
  try {
    const plans = await subscriptionService.getAllPlans()

    res.render('admin/plans', {
      plans,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading plans:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load plans'
    })
  }
})

/**
 * GET /admin/requests
 * Subscription requests view
 */
router.get('/requests', async (req, res) => {
  try {
    const { status } = req.query
    const filters = status ? { status } : {}

    const requests = await subscriptionService.getAllRequests(filters)
    const stats = await SubscriptionRequest.getStats()

    res.render('admin/requests', {
      requests,
      stats,
      currentFilter: status || 'all',
      user: req.user
    })
  } catch (error) {
    console.error('Error loading requests:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load subscription requests'
    })
  }
})

/**
 * GET /admin/requests/:requestId
 * Single subscription request detail view
 */
router.get('/requests/:requestId', async (req, res) => {
  try {
    const request = await subscriptionService.getRequestById(req.params.requestId)

    if (!request) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Subscription request not found'
      })
    }

    res.render('admin/request-detail', {
      request,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading request:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load subscription request'
    })
  }
})

/**
 * GET /admin/subscriptions
 * Subscriptions management view
 */
router.get('/subscriptions', async (req, res) => {
  try {
    const { status } = req.query
    const filters = status ? { status } : {}

    const subscriptions = await subscriptionService.getAllSubscriptions(filters)
    const organizations = await Organization.find().select('_id name').sort({ name: 1 })
    const plans = await Plan.find({ isActive: true }).sort({ displayOrder: 1 })

    res.render('admin/subscriptions', {
      subscriptions,
      organizations,
      plans,
      currentFilter: status || 'all',
      user: req.user
    })
  } catch (error) {
    console.error('Error loading subscriptions:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load subscriptions'
    })
  }
})

/**
 * GET /admin/organizations
 * Organizations overview (for subscription management)
 */
router.get('/organizations', async (req, res) => {
  try {
    const organizations = await Organization.find()
      .populate(['owner', 'activeSubscription', 'currentPlan'])
      .sort({ createdAt: -1 })

    res.render('admin/organizations', {
      organizations,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading organizations:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load organizations'
    })
  }
})

/**
 * GET /admin/subscriptions/lifecycle/run
 * Run lifecycle jobs manually
 */
router.get('/subscriptions/lifecycle/run', async (req, res) => {
  try {
    const [expiredCount, gracePeriodCount, reminderCount, expiredRequestsCount] = await Promise.all([
      subscriptionService.processExpiredSubscriptions(),
      subscriptionService.processGracePeriodEnd(),
      subscriptionService.sendRenewalReminders(),
      subscriptionService.expireOldRequests()
    ])

    // Redirect back to dashboard with success message
    res.redirect('/admin?lifecycle=success&expired=' + expiredCount + '&grace=' + gracePeriodCount + '&reminders=' + reminderCount + '&requests=' + expiredRequestsCount)
  } catch (error) {
    console.error('Error running lifecycle jobs:', error)
    res.redirect('/admin?lifecycle=error')
  }
})

/**
 * GET /admin/users
 * Admin users management view
 */
router.get('/users', async (req, res) => {
  try {
    const admins = await Account.find({
      $or: [{ isSystemAdmin: true }, { isSuperAdmin: true }]
    }).select('email profile isSystemAdmin isSuperAdmin createdAt').sort({ createdAt: -1 })

    res.render('admin/users', {
      admins,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading admin users:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load admin users'
    })
  }
})

export default router
