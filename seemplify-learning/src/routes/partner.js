import express from 'express'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AgentInvite } from '../models/AgentInvite.js'
import { AgentSaleAttribution } from '../models/AgentSaleAttribution.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { requirePartnerAccess, requireRole } from '../middleware/roles.js'
import { emailService } from '../services/emailService.js'
import { logAuditEvent } from '../utils/auditLog.js'
import { resolveLearningRole } from '../utils/learningRoles.js'

const router = express.Router()

const PARTNER_DASHBOARD_ROLES = [
  'super_admin',
  'admin',
  'channel_partner_super',
  'channel_partner_user',
  'partner_super',
  'partner_user'
]

const formatCurrencyAmount = (amountMinor, currencyCode = 'NGN') => {
  const amount = Number.isFinite(Number(amountMinor)) ? Number(amountMinor) : 0
  const major = amount / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currencyCode || 'NGN').toUpperCase()
    }).format(major)
  } catch {
    return `${String(currencyCode || 'NGN').toUpperCase()} ${major.toFixed(2)}`
  }
}

const generateInviteToken = () => crypto.randomBytes(24).toString('hex')

const buildBaseUrl = (req) => {
  const proto = String(req.protocol || 'http').trim()
  const host = String(req.get('host') || '').trim()
  return host ? `${proto}://${host}` : ''
}

const normalizeSection = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  const sections = ['overview', 'agents', 'courses', 'reports', 'commissions', 'settings']
  return sections.includes(normalized) ? normalized : 'overview'
}

const canManageAgents = (role) => ['super_admin', 'admin', 'channel_partner_super', 'channel_partner_user'].includes(role)

const canRemoveAgents = (role) => ['super_admin', 'admin', 'channel_partner_super'].includes(role)

const canApprovePartnerCourses = (role) => ['super_admin', 'admin', 'channel_partner_super', 'partner_super'].includes(role)

const canRecommendAgentPayout = (role) => ['super_admin', 'admin', 'channel_partner_super', 'partner_super'].includes(role)

const loadPartnerDashboardData = async ({ orgId }) => {
  const since = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))

  const [
    agentCount,
    courseCount,
    publishedCourseCount,
    pendingDraftCount,
    attributionsSummary,
    topAgentRows,
    recentInvites,
    recentCourses,
    recentAttributions,
    salesTrend
  ] = await Promise.all([
    Account.countDocuments({ partnerOrganization: orgId, learningRole: 'channel_sales_agent' }),
    SimpleLmsCourse.countDocuments({ organization: orgId, isActive: true }),
    SimpleLmsCourse.countDocuments({ organization: orgId, isActive: true, status: 'published' }),
    SimpleLmsCourse.countDocuments({ organization: orgId, isActive: true, status: { $in: ['draft', 'pending_public_review'] } }),
    AgentSaleAttribution.aggregate([
      { $match: { partnerOrganization: new mongoose.Types.ObjectId(orgId) } },
      {
        $group: {
          _id: null,
          totalSalesMinor: { $sum: '$saleAmountMinor' },
          totalCommissionMinor: { $sum: '$commissionAmountMinor' },
          pendingCommissionMinor: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'recommended', 'approved']] }, '$commissionAmountMinor', 0]
            }
          }
        }
      }
    ]),
    AgentSaleAttribution.aggregate([
      { $match: { partnerOrganization: new mongoose.Types.ObjectId(orgId) } },
      {
        $group: {
          _id: '$agent',
          salesCount: { $sum: 1 },
          totalSalesMinor: { $sum: '$saleAmountMinor' },
          totalCommissionMinor: { $sum: '$commissionAmountMinor' }
        }
      },
      { $sort: { totalSalesMinor: -1 } },
      { $limit: 5 }
    ]),
    AgentInvite.find({ partnerOrganization: orgId })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('email status createdAt expiresAt acceptedAt')
      .lean(),
    SimpleLmsCourse.find({ organization: orgId, isActive: true })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select('title status visibility pricing updatedAt createdByName')
      .lean(),
    AgentSaleAttribution.find({ partnerOrganization: orgId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('agent', 'profile email')
      .populate('course', 'title')
      .lean(),
    AgentSaleAttribution.aggregate([
      {
        $match: {
          partnerOrganization: new mongoose.Types.ObjectId(orgId),
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          salesMinor: { $sum: '$saleAmountMinor' },
          commissionsMinor: { $sum: '$commissionAmountMinor' },
          deals: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      { $limit: 30 }
    ])
  ])

  const summary = attributionsSummary[0] || {
    totalSalesMinor: 0,
    totalCommissionMinor: 0,
    pendingCommissionMinor: 0
  }

  const topAgentIds = topAgentRows.map((entry) => entry._id)
  const topAgents = topAgentIds.length > 0
    ? await Account.find({ _id: { $in: topAgentIds } })
      .select('_id profile email')
      .lean()
    : []
  const topAgentMap = new Map(topAgents.map((agent) => [String(agent._id), agent]))

  const topAgentsWithStats = topAgentRows.map((row) => ({
    agent: topAgentMap.get(String(row._id)) || null,
    salesCount: Number(row.salesCount || 0),
    totalSalesMinor: Number(row.totalSalesMinor || 0),
    totalCommissionMinor: Number(row.totalCommissionMinor || 0)
  }))

  return {
    metrics: {
      agentCount,
      courseCount,
      publishedCourseCount,
      pendingDraftCount,
      totalSalesMinor: Number(summary.totalSalesMinor || 0),
      totalCommissionMinor: Number(summary.totalCommissionMinor || 0),
      pendingCommissionMinor: Number(summary.pendingCommissionMinor || 0)
    },
    topAgents: topAgentsWithStats,
    recentInvites,
    recentCourses,
    recentAttributions,
    salesTrend: salesTrend.map((point) => ({
      date: `${point._id.year}-${String(point._id.month).padStart(2, '0')}-${String(point._id.day).padStart(2, '0')}`,
      deals: Number(point.deals || 0),
      salesMinor: Number(point.salesMinor || 0),
      commissionsMinor: Number(point.commissionsMinor || 0)
    }))
  }
}

router.use(requireRole(PARTNER_DASHBOARD_ROLES))
router.use(requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user'], { allowPlatformAdmin: true }))

router.get('/', async (req, res) => {
  try {
    const section = normalizeSection(req.query.section)
    const role = resolveLearningRole(req.user)
    const org = req.partnerOrg

    const dashboardData = await loadPartnerDashboardData({ orgId: org._id })

    const [agentRows, commissionRows, courseRows] = await Promise.all([
      Account.find({ partnerOrganization: org._id, learningRole: 'channel_sales_agent' })
        .select('_id email profile createdAt payoutProfile')
        .sort({ createdAt: -1 })
        .lean(),
      AgentSaleAttribution.find({ partnerOrganization: org._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('agent', 'profile email payoutProfile')
        .populate('course', 'title')
        .lean(),
      SimpleLmsCourse.find({ organization: org._id, isActive: true })
        .sort({ updatedAt: -1 })
        .limit(120)
        .select('title summary status visibility pricing createdByName updatedAt createdBy')
        .lean()
    ])

    return res.render('partner-dashboard', {
      title: `${res.locals.brandLearningName || 'Seemplify Learning'} - Partner Dashboard`,
      activePage: 'partner-dashboard',
      activeSection: section,
      user: req.user,
      learningRole: role,
      organization: org,
      dashboardData,
      agents: agentRows,
      commissions: commissionRows,
      courses: courseRows,
      canManageAgents: canManageAgents(role),
      canRemoveAgents: canRemoveAgents(role),
      canApprovePartnerCourses: canApprovePartnerCourses(role),
      canRecommendAgentPayout: canRecommendAgentPayout(role),
      formatCurrencyAmount,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Partner dashboard render error:', error)
    return res.redirect('/simple-lms?error=Failed%20to%20load%20partner%20dashboard')
  }
})

router.post('/agents/invite', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=agents'
  try {
    const role = resolveLearningRole(req.user)
    if (!canManageAgents(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only channel partners can invite agents.')}`)
    }

    const org = req.partnerOrg
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!email) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Agent email is required.')}`)
    }

    const cap = Number(org?.partnerSettings?.maxAgents)
    if (Number.isFinite(cap) && cap > 0) {
      const currentAgentCount = await Account.countDocuments({ partnerOrganization: org._id, learningRole: 'channel_sales_agent' })
      if (currentAgentCount >= Math.floor(cap)) {
        return res.redirect(`${redirectTo}&error=${encodeURIComponent('Agent limit reached for this organization.')}`)
      }
    }

    const existingAccount = await Account.findOne({ email })
    if (existingAccount) {
      if (existingAccount.partnerOrganization && String(existingAccount.partnerOrganization) !== String(org._id)) {
        return res.redirect(`${redirectTo}&error=${encodeURIComponent('This user belongs to another partner organization.')}`)
      }

      existingAccount.learningRole = 'channel_sales_agent'
      existingAccount.isSystemAdmin = false
      existingAccount.isSuperAdmin = false
      existingAccount.partnerOrganization = org._id

      const existingMembership = Array.isArray(existingAccount.organizations)
        ? existingAccount.organizations.find((entry) => String(entry.organization) === String(org._id))
        : null

      if (existingMembership) {
        existingMembership.role = 'sales_agent'
        existingMembership.isActive = true
      } else {
        existingAccount.organizations = Array.isArray(existingAccount.organizations) ? existingAccount.organizations : []
        existingAccount.organizations.push({
          organization: org._id,
          role: 'sales_agent',
          appAccess: { mode: 'all', appIds: [] },
          joinedAt: new Date(),
          isActive: true
        })
      }
      await existingAccount.save()

      const orgMember = org.members.find((member) => String(member.account) === String(existingAccount._id))
      if (orgMember) {
        orgMember.role = 'sales_agent'
        orgMember.status = 'active'
        orgMember.updatedAt = new Date()
        orgMember.updatedBy = req.user._id
      } else {
        org.members.push({
          account: existingAccount._id,
          role: 'sales_agent',
          appAccess: { mode: 'all', appIds: [] },
          joinedAt: new Date(),
          invitedBy: req.user._id,
          status: 'active'
        })
      }
      await org.save()

      await logAuditEvent({
        action: 'agent.add',
        performedBy: req.user._id,
        targetAccount: existingAccount._id,
        targetOrganization: org._id,
        metadata: {
          mode: 'direct_assign'
        },
        req
      })

      return res.redirect(`${redirectTo}&success=${encodeURIComponent('Agent added successfully.')}`)
    }

    const inviteToken = generateInviteToken()
    const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000))
    const invite = await AgentInvite.create({
      partnerOrganization: org._id,
      invitedBy: req.user._id,
      email,
      token: inviteToken,
      status: 'pending',
      expiresAt
    })

    const inviteLink = `${buildBaseUrl(req)}/register?invite_token=${encodeURIComponent(inviteToken)}&return_to=${encodeURIComponent('/agent-dashboard')}`
    await emailService.sendNotificationEmail({
      to: email,
      subject: `${org.name} invited you as a sales agent`,
      html: `<p>You were invited to join <strong>${org.name}</strong> as a sales agent.</p><p>Complete registration here:</p><p><a href="${inviteLink}">${inviteLink}</a></p><p>This invite expires in 24 hours.</p>`,
      text: `You were invited to join ${org.name} as a sales agent. Use this link within 24 hours: ${inviteLink}`
    })

    await logAuditEvent({
      action: 'agent.invite',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        inviteId: invite._id,
        email,
        expiresAt: invite.expiresAt
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Agent invite sent successfully.')}`)
  } catch (error) {
    console.error('Partner invite agent error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to invite agent.')}`)
  }
})

router.post('/agents/:agentId/remove', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=agents'
  try {
    const role = resolveLearningRole(req.user)
    if (!canRemoveAgents(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only channel partner super users can remove agents.')}`)
    }

    const agentId = String(req.params.agentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid agent selected.')}`)
    }

    const org = req.partnerOrg
    const agent = await Account.findById(agentId)
    if (!agent || String(agent.partnerOrganization || '') !== String(org._id)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Agent not found in this organization.')}`)
    }

    agent.partnerOrganization = null
    if (agent.learningRole === 'channel_sales_agent') {
      agent.learningRole = 'learner'
    }
    agent.isSystemAdmin = false
    agent.isSuperAdmin = false
    agent.organizations = (agent.organizations || []).filter((entry) => String(entry.organization) !== String(org._id))
    await agent.save()

    org.members = (org.members || []).filter((member) => String(member.account) !== String(agent._id))
    await org.save()

    await logAuditEvent({
      action: 'agent.remove',
      performedBy: req.user._id,
      targetAccount: agent._id,
      targetOrganization: org._id,
      metadata: {},
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Agent removed successfully.')}`)
  } catch (error) {
    console.error('Partner remove agent error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to remove agent.')}`)
  }
})

router.post('/courses/:courseId/approve', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=courses'
  try {
    const role = resolveLearningRole(req.user)
    if (!canApprovePartnerCourses(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can approve partner courses.')}`)
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid course selected.')}`)
    }

    const org = req.partnerOrg
    const course = await SimpleLmsCourse.findOne({ _id: courseId, organization: org._id, isActive: true })
    if (!course) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Course not found.')}`)
    }

    course.status = 'published'
    if (String(course.visibility || '').trim().toLowerCase() === 'organization_private') {
      course.visibility = 'organization_public'
    }
    course.publishedAt = course.publishedAt || new Date()
    course.updatedAt = new Date()
    await course.save()

    await logAuditEvent({
      action: 'course.partner_approve',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        courseId: course._id
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Course approved and published.')}`)
  } catch (error) {
    console.error('Partner approve course error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to approve course.')}`)
  }
})

router.post('/courses/:courseId/reject', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=courses'
  try {
    const role = resolveLearningRole(req.user)
    if (!canApprovePartnerCourses(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can review partner courses.')}`)
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid course selected.')}`)
    }

    const org = req.partnerOrg
    const course = await SimpleLmsCourse.findOne({ _id: courseId, organization: org._id, isActive: true })
    if (!course) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Course not found.')}`)
    }

    course.status = 'draft'
    course.reviewedAt = new Date()
    course.reviewedBy = req.user._id
    course.reviewNotes = String(req.body.reviewNotes || '').trim().slice(0, 2000)
    await course.save()

    await logAuditEvent({
      action: 'course.partner_reject',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        courseId: course._id,
        reviewNotes: course.reviewNotes
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Course returned to draft.')}`)
  } catch (error) {
    console.error('Partner reject course error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to reject course.')}`)
  }
})

router.post('/commissions/:attributionId/recommend', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=commissions'
  try {
    const role = resolveLearningRole(req.user)
    if (!canRecommendAgentPayout(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can recommend payouts.')}`)
    }

    const attributionId = String(req.params.attributionId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(attributionId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid commission record selected.')}`)
    }

    const org = req.partnerOrg
    const attribution = await AgentSaleAttribution.findOne({
      _id: attributionId,
      partnerOrganization: org._id
    })
    if (!attribution) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Commission record not found.')}`)
    }

    const status = String(attribution.status || '').trim().toLowerCase()
    if (!['pending', 'rejected'].includes(status)) {
      return res.redirect(`${redirectTo}&info=${encodeURIComponent('This commission entry is already recommended or processed.')}`)
    }

    attribution.status = 'recommended'
    attribution.recommendedBy = req.user._id
    attribution.recommendedAt = new Date()
    await attribution.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: attribution.agent || null,
      targetOrganization: org._id,
      metadata: {
        entity: 'agent_commission',
        attributionId: attribution._id,
        nextStatus: 'recommended'
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Commission recommended for payout review.')}`)
  } catch (error) {
    console.error('Partner recommend commission payout error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to recommend payout.')}`)
  }
})

router.post('/settings', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=settings'
  try {
    const role = resolveLearningRole(req.user)
    if (!['super_admin', 'admin', 'channel_partner_super', 'partner_super'].includes(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can update partner settings.')}`)
    }

    const org = req.partnerOrg
    const maxAgentsRaw = String(req.body.maxAgents || '').trim()
    const maxAgents = maxAgentsRaw ? Math.max(1, Math.round(Number(maxAgentsRaw))) : null
    const defaultRate = Math.min(100, Math.max(0, Number(req.body.defaultAgentCommissionRate || 10)))
    const partnerStatus = ['pending', 'active', 'suspended'].includes(String(req.body.partnerStatus || '').trim().toLowerCase())
      ? String(req.body.partnerStatus).trim().toLowerCase()
      : (org.partnerSettings?.partnerStatus || 'pending')

    org.partnerSettings.maxAgents = Number.isFinite(maxAgents) ? maxAgents : null
    org.partnerSettings.defaultAgentCommissionRate = Number.isFinite(defaultRate) ? defaultRate : 10
    org.partnerSettings.agentInviteApproval = req.body.agentInviteApproval === 'on'
    org.partnerSettings.partnerStatus = partnerStatus

    org.partnerSettings.payoutProfile = {
      ...(org.partnerSettings.payoutProfile || {}),
      accountName: String(req.body.payoutAccountName || '').trim().slice(0, 200),
      accountNumber: String(req.body.payoutAccountNumber || '').trim().slice(0, 64),
      bankName: String(req.body.payoutBankName || '').trim().slice(0, 200),
      bankCode: String(req.body.payoutBankCode || '').trim().slice(0, 80),
      swiftCode: String(req.body.payoutSwiftCode || '').trim().slice(0, 80),
      currency: String(req.body.payoutCurrency || 'NGN').trim().toUpperCase().slice(0, 3) || 'NGN',
      paymentEmail: String(req.body.payoutEmail || '').trim().toLowerCase().slice(0, 320),
      country: String(req.body.payoutCountry || '').trim().slice(0, 80),
      notes: String(req.body.payoutNotes || '').trim().slice(0, 1200),
      updatedAt: new Date()
    }

    await org.save()

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Partner settings updated successfully.')}`)
  } catch (error) {
    console.error('Partner update settings error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to update partner settings.')}`)
  }
})

export default router
