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
import { Team } from '../models/Team.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import DemoRequest from '../models/DemoRequest.js'
import { buildRecruiterAdminLaunchUrl } from '../services/recruiterAdminSsoService.js'
import { buildExperienceAdminLaunchUrl } from '../services/experienceAdminSsoService.js'
import { getWorkforceOperationsAnalytics } from '../services/adminAnalyticsService.js'
import { emailService } from '../services/emailService.js'
import {
  ADMIN_ORGANIZATION_ACTIONS,
  deleteOrganizationAccounts,
  deleteOrganizationCascade,
  removeMembersFromOrganization
} from '../services/adminOrganizationManagementService.js'
import { invalidateClaimsCache } from '../index.js'

const router = express.Router()
const SIMPLE_LMS_EXTERNAL_BASE_URL = String(
  process.env.SEEMPLIFY_LEARNING_URL ||
  process.env.SIMPLE_LMS_EXTERNAL_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://learning.seemplifyai.com' : 'http://localhost:5012')
)
  .trim()
  .replace(/\/+$/, '')
const SIMPLE_LMS_EXTERNAL_WORKSPACE_URL = SIMPLE_LMS_EXTERNAL_BASE_URL.endsWith('/simple-lms')
  ? SIMPLE_LMS_EXTERNAL_BASE_URL
  : `${SIMPLE_LMS_EXTERNAL_BASE_URL}/simple-lms`

const INVITE_ROLES = ['admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']

function normalizeEmployeeId(value = '') {
  return String(value || '').trim()
}

function buildOrgDetailRedirectPath(organizationId, notice, noticeType = 'success') {
  const params = new URLSearchParams()
  if (notice) params.set('notice', notice)
  if (noticeType) params.set('noticeType', noticeType)
  return `/admin/organizations/${organizationId}?${params.toString()}`
}

function buildOrganizationsRedirectPath(notice, noticeType = 'success') {
  const params = new URLSearchParams()
  if (notice) params.set('notice', notice)
  if (noticeType) params.set('noticeType', noticeType)
  const query = params.toString()
  return query ? `/admin/organizations?${query}` : '/admin/organizations'
}

function buildDemoRequestNotice(query = {}) {
  const errorMap = {
    invalid_status: { type: 'error', message: 'Invalid status selected.' },
    update_failed: { type: 'error', message: 'Failed to update demo request.' }
  }

  if (query.message) {
    return { type: 'success', message: String(query.message) }
  }

  return errorMap[String(query.error || '')] || null
}

function parseBooleanInput(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase())
}

async function invalidateClaimsForAccounts(accountIds = []) {
  const ids = Array.from(new Set(
    accountIds
      .map(id => id?.toString?.() || String(id || '').trim())
      .filter(Boolean)
  ))

  if (ids.length === 0) {
    return
  }

  const accounts = await Account.find({ _id: { $in: ids } })
    .select('sub')
    .lean()

  accounts.forEach((account) => {
    if (account?.sub) {
      invalidateClaimsCache(account.sub)
    }
  })
}

async function hasPendingInviteWithEmployeeId(organizationId, employeeId, excludeInvitationId = null) {
  const normalizedEmployeeId = normalizeEmployeeId(employeeId)
  if (!normalizedEmployeeId) return false

  const pendingInvites = await OrganizationInvite.find({
    organization: organizationId,
    status: 'pending',
    expiresAt: { $gt: new Date() },
    employeeId: { $exists: true, $ne: null }
  }).select('_id employeeId')

  const targetKey = normalizedEmployeeId.toLowerCase()
  return pendingInvites.some((invite) => {
    if (excludeInvitationId && invite._id.toString() === excludeInvitationId.toString()) {
      return false
    }
    return String(invite.employeeId || '').trim().toLowerCase() === targetKey
  })
}

async function sendOrganizationInviteEmail({
  organizationName,
  inviterName,
  email,
  role,
  designation,
  employeeId,
  departmentName,
  teamName,
  inviteUrl,
  isReminder = false
}) {
  const heading = isReminder
    ? `Reminder: You've been invited to join ${organizationName}`
    : `You've been invited to join ${organizationName}`
  const intro = isReminder
    ? 'This is a reminder that you have a pending invitation to join this organization on AIIN Identity.'
    : `<strong>${inviterName}</strong> has invited you to join their organization on AIIN Identity.`

  await emailService.sendEmail({
    to: email,
    subject: heading,
    html: `
      <h2>${heading}</h2>
      <p>${intro}</p>
      <p><strong>Role:</strong> ${role}</p>
      <p><strong>Designation:</strong> ${designation}</p>
      ${employeeId ? `<p><strong>Employee ID:</strong> ${employeeId}</p>` : ''}
      <p><strong>Department:</strong> ${departmentName}</p>
      <p><strong>Team:</strong> ${teamName}</p>
      <p><strong>Access:</strong> All assigned workspace apps</p>
      <p>Click the link below to accept the invitation:</p>
      <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #60a5fa, #a855f7); color: white; text-decoration: none; border-radius: 8px;">Accept Invitation</a></p>
      <p style="color: #666; font-size: 14px; margin-top: 16px;">
        Or copy and paste this link into your browser:<br>
        <a href="${inviteUrl}" style="color: #60a5fa; word-break: break-all;">${inviteUrl}</a>
      </p>
      <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
      ${isReminder ? '' : `<p style="color: #666; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>`}
    `
  })
}

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
    const [stats, recentRequests, workforceAnalytics, demoRequestStats, recentDemoRequests] = await Promise.all([
      subscriptionService.getStats(),
      SubscriptionRequest.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate(['organization', 'plan', 'requestedBy']),
      getWorkforceOperationsAnalytics(),
      DemoRequest.getStats(),
      DemoRequest.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('processedBy', 'email profile.name')
        .lean()
    ])

    res.render('admin/dashboard', {
      stats,
      recentRequests,
      demoRequestStats,
      recentDemoRequests,
      workforceAnalytics,
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

router.get('/demo-requests', async (req, res) => {
  try {
    const status = String(req.query.status || 'all').trim().toLowerCase()
    const search = String(req.query.q || '').trim()
    const filters = {}

    if (status && status !== 'all') {
      filters.status = status
    }

    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } }
      ]
    }

    const [requests, stats] = await Promise.all([
      DemoRequest.find(filters)
        .sort({ createdAt: -1 })
        .populate('processedBy', 'email profile.name')
        .lean(),
      DemoRequest.getStats()
    ])

    res.render('admin/demo-requests', {
      requests,
      stats,
      currentFilter: status,
      currentSearch: search,
      user: req.user
    })
  } catch (error) {
    console.error('Error loading demo requests:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load demo requests'
    })
  }
})

router.get('/demo-requests/:requestId', async (req, res) => {
  try {
    const request = await DemoRequest.findById(req.params.requestId)
      .populate('processedBy', 'email profile.name')

    if (!request) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Demo request not found'
      })
    }

    res.render('admin/demo-request-detail', {
      request,
      notice: buildDemoRequestNotice(req.query),
      user: req.user
    })
  } catch (error) {
    console.error('Error loading demo request detail:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load demo request detail'
    })
  }
})

router.post('/demo-requests/:requestId/update', async (req, res) => {
  try {
    const request = await DemoRequest.findById(req.params.requestId)

    if (!request) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Demo request not found'
      })
    }

    const nextStatus = String(req.body.status || '').trim()
    const adminNotes = String(req.body.adminNotes || '').trim()
    const scheduledForInput = String(req.body.scheduledFor || '').trim()
    const allowedStatuses = new Set(['new', 'contacted', 'scheduled', 'closed', 'spam'])

    if (!allowedStatuses.has(nextStatus)) {
      return res.redirect(`/admin/demo-requests/${request._id}?error=invalid_status`)
    }

    request.status = nextStatus
    request.adminNotes = adminNotes
    request.processedBy = req.user._id
    request.processedAt = new Date()

    if (nextStatus !== 'new' && !request.respondedAt) {
      request.respondedAt = new Date()
    }

    request.scheduledFor = scheduledForInput ? new Date(scheduledForInput) : null

    await request.save()

    return res.redirect(`/admin/demo-requests/${request._id}?message=Demo request updated`)
  } catch (error) {
    console.error('Error updating demo request:', error)
    res.redirect(`/admin/demo-requests/${req.params.requestId}?error=update_failed`)
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
    const plans = await subscriptionService.getAllPlans()

    res.render('admin/plans', {
      plans,
      hubApps,
      comingSoonCards,
      simpleLmsExternalWorkspaceUrl: SIMPLE_LMS_EXTERNAL_WORKSPACE_URL,
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
 * Legacy IDP Simple LMS route. Redirect to external Seemplify Learning app.
 */
router.get('/simple-lms', async (req, res) => {
  try {
    res.redirect(SIMPLE_LMS_EXTERNAL_WORKSPACE_URL)
  } catch (error) {
    console.error('Error redirecting to external Simple LMS workspace:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to open Seemplify Learning workspace'
    })
  }
})

/**
 * GET /admin/recruiter-admin
 * Launch recruiter admin via IDP-issued admin SSO
 */
router.get('/recruiter-admin', async (req, res) => {
  try {
    const launchUrl = await buildRecruiterAdminLaunchUrl(req.user)
    res.redirect(launchUrl)
  } catch (error) {
    console.error('Error launching recruiter admin:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to open recruiter admin'
    })
  }
})

/**
 * GET /admin/experience-admin
 * Launch the application-specific Experience control plane with IdP authority.
 */
router.get('/experience-admin', async (req, res) => {
  try {
    res.redirect(await buildExperienceAdminLaunchUrl(req.user))
  } catch (error) {
    console.error('Error launching Experience admin:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to open Experience Management admin'
    })
  }
})

/**
 * GET /admin/organizations
 * Organizations overview (for subscription management)
 */
router.get('/organizations', async (req, res) => {
  try {
    const notice = typeof req.query.notice === 'string' ? req.query.notice.trim() : ''
    const noticeType = req.query.noticeType === 'error' ? 'error' : 'success'
    const organizations = await Organization.find()
      .populate(['owner', 'activeSubscription', 'currentPlan'])
      .sort({ createdAt: -1 })

    res.render('admin/organizations', {
      organizations,
      notice,
      noticeType,
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
    const notice = typeof req.query.notice === 'string' ? req.query.notice.trim() : ''
    const noticeType = req.query.noticeType === 'error' ? 'error' : 'success'

    const [organization, subscriptions, requests, onboardingAssignmentsRaw, appLaunchesRaw, pendingInvitationsRaw, organizationTeams] = await Promise.all([
      Organization.findById(organizationId)
        .populate('owner', 'email profile.name')
        .populate('members.account', 'email profile.name isSystemAdmin isSuperAdmin')
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
      ,
      OrganizationInvite.find({
        organization: organizationId,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .populate('invitedBy', 'email profile.name')
        .populate('team', 'name'),
      Team.find({ organization: organizationId })
        .select('name department')
        .sort({ name: 1 })
        .lean()
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

    const pendingInvitations = pendingInvitationsRaw.map((invitation) => {
      const invitationObject = invitation.toObject()
      const department = organization.getDepartmentById(invitationObject.department)

      return {
        ...invitationObject,
        departmentName: department?.name || 'Unknown department',
        teamName: invitationObject.team?.name || 'Unknown team'
      }
    })

    const inviteTeams = organizationTeams.map((team) => ({
      id: team._id.toString(),
      name: team.name,
      departmentName: organization.getDepartmentById(team.department)?.name || 'Unknown department'
    }))

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
      pendingInvitations,
      inviteTeams,
      notice,
      noticeType,
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

router.post('/organizations/:organizationId/members/action', async (req, res) => {
  const organizationId = req.params.organizationId

  try {
    const organization = await Organization.findById(organizationId)
      .populate('members.account', 'email profile.name isSystemAdmin isSuperAdmin organizations')

    if (!organization) {
      return res.redirect(buildOrganizationsRedirectPath('Organization not found', 'error'))
    }

    const action = String(req.body.action || '').trim()
    const memberIds = Array.isArray(req.body.memberIds)
      ? req.body.memberIds
      : [req.body.memberIds].filter(Boolean)
    const ownerReplacementId = String(req.body.ownerReplacementId || '').trim()
    const adminReplacementId = String(req.body.adminReplacementId || '').trim()
    const deleteOrganizationIfEmpty = parseBooleanInput(req.body.deleteOrganizationIfEmpty)

    let result

    if (action === ADMIN_ORGANIZATION_ACTIONS.DELETE_ORGANIZATION) {
      result = await deleteOrganizationCascade(organization, { deletedBy: req.user._id })
      await invalidateClaimsForAccounts(result.deletedMemberIds || [])
      return res.redirect(buildOrganizationsRedirectPath(
        `Organization "${organization.name}" was deleted successfully.`
      ))
    }

    if (action === ADMIN_ORGANIZATION_ACTIONS.REMOVE_MEMBERS) {
      result = await removeMembersFromOrganization(organization, {
        memberIds,
        ownerReplacementId,
        adminReplacementId,
        deleteOrganizationIfEmpty,
        updatedBy: req.user._id
      })
    } else if (action === ADMIN_ORGANIZATION_ACTIONS.DELETE_ACCOUNTS) {
      result = await deleteOrganizationAccounts(organization, {
        memberIds,
        ownerReplacementId,
        adminReplacementId,
        deleteOrganizationIfEmpty,
        deletedBy: req.user._id
      })
    } else {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Select a valid member action', 'error'))
    }

    const affectedAccountIds = [
      ...(result.removedMemberIds || []),
      ...(result.deletedAccountIds || []),
      ...(result.promotedAccountIds || []),
      ...(result.deletedMemberIds || [])
    ]
    await invalidateClaimsForAccounts(affectedAccountIds)

    if (result.organizationDeleted) {
      const message = action === ADMIN_ORGANIZATION_ACTIONS.DELETE_ACCOUNTS
        ? `Deleted ${result.deletedAccountIds?.length || 0} account(s) and removed the empty organization.`
        : `Removed ${result.removedMemberIds?.length || 0} member(s) and deleted the empty organization.`
      return res.redirect(buildOrganizationsRedirectPath(message))
    }

    const message = action === ADMIN_ORGANIZATION_ACTIONS.DELETE_ACCOUNTS
      ? `Deleted ${result.deletedAccountIds?.length || 0} account(s) successfully.`
      : `Removed ${result.removedMemberIds?.length || 0} member(s) successfully.`

    return res.redirect(buildOrgDetailRedirectPath(organizationId, message))
  } catch (error) {
    console.error('Admin organization member action error:', error)
    return res.redirect(buildOrgDetailRedirectPath(
      organizationId,
      error.message || 'Failed to complete member action',
      'error'
    ))
  }
})

router.post('/organizations/:organizationId/invitations', async (req, res) => {
  const organizationId = req.params.organizationId

  try {
    const organization = await Organization.findById(organizationId)

    if (!organization) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Organization not found', 'error'))
    }

    const {
      email = '',
      role = 'recruiter',
      designation = '',
      employeeId: rawEmployeeId = '',
      team: teamId = '',
      sendAsReminder: rawSendAsReminder = ''
    } = req.body || {}

    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedRole = String(role || '').trim()
    const normalizedDesignation = String(designation || '').trim()
    const normalizedEmployeeId = normalizeEmployeeId(rawEmployeeId)
    const sendAsReminder = ['1', 'true', 'on', 'yes'].includes(String(rawSendAsReminder || '').trim().toLowerCase())

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'A valid email address is required', 'error'))
    }

    if (!INVITE_ROLES.includes(normalizedRole)) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Please select a valid organization role', 'error'))
    }

    if (!normalizedDesignation) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Designation is required', 'error'))
    }

    if (!teamId) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Please select a team for this invitation', 'error'))
    }

    const invitedTeam = await Team.findById(teamId).select('name organization department').lean()
    if (!invitedTeam || invitedTeam.organization.toString() !== organizationId) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Selected team is invalid for this organization', 'error'))
    }

    const departmentId = invitedTeam.department?.toString() || null
    const department = departmentId ? organization.getDepartmentById(departmentId) : null
    if (!department) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Selected team must belong to a valid department', 'error'))
    }

    const existingAccount = await Account.findOne({ email: normalizedEmail })
    if (existingAccount) {
      const isActiveMember = organization.members.find(
        (member) => member.account.toString() === existingAccount._id.toString() && member.status === 'active'
      )

      if (isActiveMember) {
        return res.redirect(buildOrgDetailRedirectPath(organizationId, 'That user is already an active member of this organization', 'error'))
      }
    }

    try {
      organization.assertActiveEmployeeIdAvailable(normalizedEmployeeId)
    } catch (validationError) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, validationError.message, 'error'))
    }

    if (await hasPendingInviteWithEmployeeId(organizationId, normalizedEmployeeId)) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Employee ID is already pending on another invitation', 'error'))
    }

    const existingInvite = await OrganizationInvite.findOne({
      organization: organizationId,
      email: normalizedEmail,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })

    if (existingInvite && !sendAsReminder) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'An invitation is already pending for this email', 'error'))
    }

    const { plainToken, tokenHash } = await OrganizationInvite.generateToken()
    let invitation

    if (existingInvite) {
      if (await hasPendingInviteWithEmployeeId(organizationId, normalizedEmployeeId, existingInvite._id)) {
        return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Employee ID is already pending on another invitation', 'error'))
      }

      existingInvite.role = normalizedRole
      existingInvite.designation = normalizedDesignation
      existingInvite.employeeId = normalizedEmployeeId || undefined
      existingInvite.department = departmentId
      existingInvite.team = invitedTeam._id
      existingInvite.appAccess = { mode: 'all', appIds: [] }
      existingInvite.invitedBy = req.user._id
      existingInvite.tokenHash = tokenHash
      existingInvite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      invitation = await existingInvite.save()
    } else {
      invitation = await OrganizationInvite.create({
        organization: organizationId,
        email: normalizedEmail,
        role: normalizedRole,
        designation: normalizedDesignation,
        employeeId: normalizedEmployeeId || undefined,
        department: departmentId,
        team: invitedTeam._id,
        appAccess: { mode: 'all', appIds: [] },
        tokenHash,
        invitedBy: req.user._id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    }

    const inviteUrl = `${process.env.ISSUER_URL}/invitations/accept?token=${plainToken}`
    try {
      await sendOrganizationInviteEmail({
        organizationName: organization.name,
        inviterName: req.user.profile?.name || req.user.email,
        email: normalizedEmail,
        role: normalizedRole,
        designation: normalizedDesignation,
        employeeId: normalizedEmployeeId,
        departmentName: department.name,
        teamName: invitedTeam.name,
        inviteUrl,
        isReminder: sendAsReminder
      })
    } catch (emailError) {
      console.error('Admin organization invite email failed:', emailError)
      return res.redirect(buildOrgDetailRedirectPath(
        organizationId,
        `${sendAsReminder ? 'Reminder' : 'Invitation'} created for ${invitation.email}, but the email could not be sent`,
        'error'
      ))
    }

    return res.redirect(buildOrgDetailRedirectPath(
      organizationId,
      `${sendAsReminder ? 'Reminder' : 'Invitation'} sent to ${invitation.email}`
    ))
  } catch (error) {
    console.error('Admin organization invite error:', error)
    return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Failed to send invitation', 'error'))
  }
})

router.post('/organizations/:organizationId/invitations/:invitationId/reminder', async (req, res) => {
  const organizationId = req.params.organizationId

  try {
    const invitation = await OrganizationInvite.findOne({
      _id: req.params.invitationId,
      organization: organizationId
    }).populate('organization', 'name').populate('team', 'name')

    if (!invitation) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Invitation not found', 'error'))
    }

    if (invitation.status !== 'pending' || invitation.expiresAt <= new Date()) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Invitation is no longer pending', 'error'))
    }

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Organization not found', 'error'))
    }

    const department = organization.getDepartmentById(invitation.department)
    if (!department) {
      return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Invitation department could not be resolved', 'error'))
    }

    const { plainToken, tokenHash } = await OrganizationInvite.generateToken()
    invitation.tokenHash = tokenHash
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await invitation.save()

    const inviteUrl = `${process.env.ISSUER_URL}/invitations/accept?token=${plainToken}`

    try {
      await sendOrganizationInviteEmail({
        organizationName: invitation.organization?.name || organization.name,
        inviterName: req.user.profile?.name || req.user.email,
        email: invitation.email,
        role: invitation.role,
        designation: invitation.designation,
        employeeId: invitation.employeeId,
        departmentName: department.name,
        teamName: invitation.team?.name || 'Unknown team',
        inviteUrl,
        isReminder: true
      })
    } catch (emailError) {
      console.error('Admin organization invite reminder failed:', emailError)
      return res.redirect(buildOrgDetailRedirectPath(organizationId, `Failed to send reminder to ${invitation.email}`, 'error'))
    }

    return res.redirect(buildOrgDetailRedirectPath(organizationId, `Reminder sent to ${invitation.email}`))
  } catch (error) {
    console.error('Admin organization invite reminder error:', error)
    return res.redirect(buildOrgDetailRedirectPath(organizationId, 'Failed to send invitation reminder', 'error'))
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
