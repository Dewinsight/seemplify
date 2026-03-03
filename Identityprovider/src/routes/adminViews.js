import express from 'express'
import { requireAdminAuth, setAdminContext } from '../middleware/adminAuth.js'
import { subscriptionService } from '../services/subscriptionService.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import Plan from '../models/Plan.js'
import Subscription from '../models/Subscription.js'
import SubscriptionRequest from '../models/SubscriptionRequest.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import AppLaunchActivity from '../models/AppLaunchActivity.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'

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
    const { getHubApps, getAllComingSoonCards } = await import('../config/hubApps.js')
    const hubApps = getHubApps()
    const comingSoonCards = getAllComingSoonCards()
    const [plans, totalSystemCourses, publishedSystemCourses, draftSystemCourses] = await Promise.all([
      subscriptionService.getAllPlans(),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'published' }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'draft' })
    ])

    res.render('admin/plans', {
      plans,
      hubApps,
      comingSoonCards,
      simpleLmsStats: {
        total: totalSystemCourses,
        published: publishedSystemCourses,
        draft: draftSystemCourses
      },
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
 * GET /admin/simple-lms
 * Simple LMS (IDP) system course management view
 */
router.get('/simple-lms', async (req, res) => {
  try {
    const statusFilter = String(req.query.status || 'all').trim()
    const queryFilter = String(req.query.q || '').trim()

    const filter = { isSystemCourse: true }
    if (statusFilter !== 'all' && ['draft', 'published', 'archived', 'pending_public_review'].includes(statusFilter)) {
      filter.status = statusFilter
    }
    if (queryFilter) {
      const escaped = queryFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, 'i')
      filter.$or = [
        { title: regex },
        { summary: regex },
        { description: regex },
        { category: regex },
        { tags: regex }
      ]
    }

    const [systemCourses, totalCount, publishedCount, draftCount, archivedCount] = await Promise.all([
      SimpleLmsCourse.find(filter)
        .sort({ updatedAt: -1 })
        .limit(200)
        .populate('createdBy', 'email profile.name')
        .lean(),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'published' }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'draft' }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'archived' })
    ])

    res.render('admin/simple-lms', {
      systemCourses,
      filters: {
        status: statusFilter,
        query: queryFilter
      },
      stats: {
        total: totalCount,
        published: publishedCount,
        draft: draftCount,
        archived: archivedCount
      },
      user: req.user
    })
  } catch (error) {
    console.error('Error loading admin simple LMS view:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load Simple LMS admin workspace'
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
 * GET /admin/organizations/:organizationId
 * Organization detail view
 */
router.get('/organizations/:organizationId', async (req, res) => {
  try {
    const organizationId = req.params.organizationId

    const [organization, subscriptions, requests, onboardingAssignmentsRaw, appLaunchesRaw] = await Promise.all([
      Organization.findById(organizationId)
        .populate('owner', 'email profile.name')
        .populate('members.account', 'email profile.name')
        .populate({
          path: 'activeSubscription',
          populate: [
            { path: 'plan', select: 'name slug pricing' },
            { path: 'approvedBy', select: 'email profile.name' }
          ]
        })
        .populate('currentPlan', 'name slug pricing'),
      Subscription.find({ organization: organizationId })
        .sort({ createdAt: -1 })
        .limit(15)
        .populate('plan', 'name slug pricing')
        .populate('approvedBy', 'email profile.name')
        .populate('cancelledBy', 'email profile.name'),
      SubscriptionRequest.find({ organization: organizationId })
        .sort({ createdAt: -1 })
        .limit(15)
        .populate('plan', 'name slug pricing')
        .populate('requestedBy', 'email profile.name')
        .populate('processedBy', 'email profile.name'),
      OnboardingAssignment.find({ organization: organizationId })
        .sort({ updatedAt: -1 })
        .limit(20)
        .populate('member', 'email profile.name')
        .populate('createdBy', 'email profile.name')
        .populate('template', 'name'),
      AppLaunchActivity.find({ organization: organizationId })
        .sort({ createdAt: -1 })
        .limit(60)
        .populate('account', 'email profile.name')
    ])

    if (!organization) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Organization not found'
      })
    }

    const members = [...(organization.members || [])].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      if (a.role !== b.role) {
        const roleWeight = { owner: 0, admin: 1, hr_manager: 2, recruiter: 3, interviewer: 4, staff: 5 }
        return (roleWeight[a.role] ?? 99) - (roleWeight[b.role] ?? 99)
      }
      const aName = a.account?.profile?.name || a.account?.email || ''
      const bName = b.account?.profile?.name || b.account?.email || ''
      return aName.localeCompare(bName)
    })

    const onboardingAssignments = onboardingAssignmentsRaw.map((assignment) => {
      const assignmentObject = assignment.toObject()
      const allItems = assignmentObject.items || []
      const requiredItems = allItems.filter(item => item.required !== false)
      const progressItems = requiredItems.length > 0 ? requiredItems : allItems
      const completedItems = progressItems.filter(item => item.status === 'completed').length

      return {
        ...assignmentObject,
        completedItems,
        totalItems: progressItems.length,
        badgeStatus: assignmentObject.status === 'in_progress' ? 'pending' : assignmentObject.status
      }
    })

    const onboardingSummary = onboardingAssignments.reduce((acc, assignment) => {
      acc.total += 1
      if (assignment.status === 'pending') acc.pending += 1
      if (assignment.status === 'in_progress') acc.inProgress += 1
      if (assignment.status === 'completed') acc.completed += 1
      if (assignment.status === 'cancelled') acc.cancelled += 1
      return acc
    }, {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0
    })

    const mapLaunchStatusToBadge = (status) => {
      if (typeof status === 'string' && status.startsWith('launched_')) return 'active'
      if (status === 'blocked_subscription') return 'pending'
      if (status === 'no_session') return 'cancelled'
      return 'rejected'
    }

    const appLaunches = appLaunchesRaw.map((launch) => {
      const launchObject = launch.toObject()
      const status = launchObject.status || 'unknown'

      return {
        ...launchObject,
        isSuccessful: typeof status === 'string' && status.startsWith('launched_'),
        badgeStatus: mapLaunchStatusToBadge(status),
        statusLabel: status.replace(/_/g, ' ')
      }
    })

    const appLaunchSummaryMap = new Map()
    for (const launch of appLaunches) {
      const key = launch.appId || 'unknown'
      if (!appLaunchSummaryMap.has(key)) {
        appLaunchSummaryMap.set(key, {
          appId: key,
          appName: launch.appName || launch.appId || 'Unknown App',
          totalLaunches: 0,
          successfulLaunches: 0,
          blockedLaunches: 0,
          failedLaunches: 0,
          lastUsedAt: launch.createdAt
        })
      }

      const summary = appLaunchSummaryMap.get(key)
      summary.totalLaunches += 1
      if (launch.isSuccessful) summary.successfulLaunches += 1
      else if (launch.status === 'blocked_subscription') summary.blockedLaunches += 1
      else summary.failedLaunches += 1

      if (launch.createdAt && (!summary.lastUsedAt || new Date(launch.createdAt) > new Date(summary.lastUsedAt))) {
        summary.lastUsedAt = launch.createdAt
      }
    }

    const appLaunchSummary = Array.from(appLaunchSummaryMap.values())
      .sort((a, b) => b.totalLaunches - a.totalLaunches)

    const activity = [
      ...requests.map(request => ({
        id: request._id,
        type: 'request',
        status: request.status,
        title: `${request.requestTypeDisplay || request.requestType || 'Subscription request'}${request.plan?.name ? ` - ${request.plan.name}` : ''}`,
        actor: request.requestedBy?.profile?.name || request.requestedBy?.email || 'Unknown',
        at: request.createdAt
      })),
      ...subscriptions.map(subscription => ({
        id: subscription._id,
        type: 'subscription',
        status: subscription.status,
        title: `${subscription.plan?.name || 'Subscription'} (${subscription.billingCycle || 'n/a'})`,
        actor: subscription.approvedBy?.profile?.name || subscription.approvedBy?.email || 'System',
        at: subscription.createdAt
      })),
      ...onboardingAssignments.map(assignment => ({
        id: assignment._id,
        type: 'onboarding',
        status: assignment.badgeStatus || 'pending',
        title: `Onboarding for ${assignment.member?.profile?.name || assignment.member?.email || 'Unknown member'}`,
        actor: assignment.createdBy?.profile?.name || assignment.createdBy?.email || 'System',
        at: assignment.updatedAt || assignment.createdAt
      })),
      ...appLaunches.map(launch => ({
        id: launch._id,
        type: 'app_click',
        status: launch.badgeStatus || 'pending',
        title: `${launch.appName || launch.appId || 'Unknown app'} launch`,
        actor: launch.account?.profile?.name || launch.account?.email || 'Unknown user',
        at: launch.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 30)

    res.render('admin/organization-detail', {
      organization,
      members,
      subscriptions,
      requests,
      onboardingAssignments,
      onboardingSummary,
      appLaunches,
      appLaunchSummary,
      activity,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading organization detail:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load organization details'
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
