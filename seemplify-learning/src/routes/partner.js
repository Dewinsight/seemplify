import express from 'express'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AgentInvite } from '../models/AgentInvite.js'
import { AgentSaleAttribution } from '../models/AgentSaleAttribution.js'
import { PartnerWithdrawal } from '../models/PartnerWithdrawal.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { AuditLog } from '../models/AuditLog.js'
import { requirePartnerAccess } from '../middleware/roles.js'
import { emailService } from '../services/emailService.js'
import { normalizeSimpleLmsCurrencyCode, parseMajorAmountToMinor } from '../services/simpleLmsCurrencyService.js'
import { logAuditEvent } from '../utils/auditLog.js'
import { resolveAccessProfile } from '../utils/accessProfile.js'

const router = express.Router()

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

const getSectionsForRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase()
  if (normalizedRole === 'channel_partner_super') {
    return ['overview', 'agents', 'courses', 'reports', 'commissions', 'withdrawals', 'settings']
  }
  if (normalizedRole === 'channel_partner_user') {
    return ['overview', 'agents', 'courses', 'reports', 'commissions']
  }
  if (normalizedRole === 'partner_super') {
    return ['overview', 'courses', 'reports', 'commissions', 'withdrawals', 'settings']
  }
  if (normalizedRole === 'partner_user') {
    return ['overview', 'courses', 'reports', 'commissions']
  }
  return ['overview']
}

const normalizeSection = (value, role) => {
  const normalized = String(value || '').trim().toLowerCase()
  const allowedSections = getSectionsForRole(role)
  return allowedSections.includes(normalized) ? normalized : 'overview'
}

const canManageAgents = (role) => ['channel_partner_super', 'channel_partner_user'].includes(role)

const canRemoveAgents = (role) => ['channel_partner_super'].includes(role)

const canApprovePartnerCourses = (role) => ['channel_partner_super', 'partner_super'].includes(role)

const canRecommendAgentPayout = (role) => ['channel_partner_super', 'partner_super'].includes(role)

const canManageAgentCommissionRates = (role) => ['channel_partner_super', 'partner_super'].includes(role)

const canRequestPartnerWithdrawals = (role) => ['channel_partner_super', 'partner_super'].includes(role)

const normalizePartnerWithdrawalStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(normalized) ? normalized : fallback
}

const formatPartnerWithdrawalStatus = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
)

const buildPartnerRevenueExpression = () => ({
  $max: [
    0,
    {
      $subtract: [
        { $ifNull: ['$metadata.platformShareMinor', 0] },
        { $ifNull: ['$commissionAmountMinor', 0] }
      ]
    }
  ]
})

const getPartnerWalletSnapshot = async (orgId) => {
  if (!orgId || !mongoose.Types.ObjectId.isValid(String(orgId))) {
    return {
      totalSalesMinor: 0,
      totalAgentCommissionMinor: 0,
      partnerEarningsMinor: 0,
      paidOutMinor: 0,
      pendingWithdrawalMinor: 0,
      availableBalanceMinor: 0
    }
  }

  const partnerOrgObjectId = new mongoose.Types.ObjectId(String(orgId))
  const [earningsRaw, withdrawalsRaw] = await Promise.all([
    AgentSaleAttribution.aggregate([
      { $match: { partnerOrganization: partnerOrgObjectId } },
      {
        $group: {
          _id: null,
          totalSalesMinor: { $sum: { $ifNull: ['$saleAmountMinor', 0] } },
          totalAgentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
          partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
        }
      }
    ]),
    PartnerWithdrawal.aggregate([
      { $match: { organization: partnerOrgObjectId } },
      {
        $group: {
          _id: null,
          paidOutMinor: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountMinor', 0] } },
          pendingWithdrawalMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved']] }, '$amountMinor', 0] } }
        }
      }
    ])
  ])

  const earnings = earningsRaw[0] || {
    totalSalesMinor: 0,
    totalAgentCommissionMinor: 0,
    partnerEarningsMinor: 0
  }
  const withdrawals = withdrawalsRaw[0] || {
    paidOutMinor: 0,
    pendingWithdrawalMinor: 0
  }
  const partnerEarningsMinor = Math.max(0, Number(earnings.partnerEarningsMinor || 0))
  const paidOutMinor = Math.max(0, Number(withdrawals.paidOutMinor || 0))
  const pendingWithdrawalMinor = Math.max(0, Number(withdrawals.pendingWithdrawalMinor || 0))
  const availableBalanceMinor = Math.max(0, partnerEarningsMinor - paidOutMinor - pendingWithdrawalMinor)

  return {
    totalSalesMinor: Math.max(0, Number(earnings.totalSalesMinor || 0)),
    totalAgentCommissionMinor: Math.max(0, Number(earnings.totalAgentCommissionMinor || 0)),
    partnerEarningsMinor,
    paidOutMinor,
    pendingWithdrawalMinor,
    availableBalanceMinor
  }
}

const parseDateBoundary = (value, boundary = 'start') => {
  const candidate = String(value || '').trim()
  if (!candidate) return null
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) return null
  if (boundary === 'end') {
    parsed.setHours(23, 59, 59, 999)
  } else {
    parsed.setHours(0, 0, 0, 0)
  }
  return parsed
}

const resolvePartnerDashboardRole = (req) => (
  String(req.accessProfile?.partnerAccess?.dashboardRole || '').trim().toLowerCase()
)

const resolveNonAgentFallbackRole = (account) => {
  const previousRole = String(account?.roleMetadata?.previousLearningRole || '').trim().toLowerCase()
  if (['learner', 'creator'].includes(previousRole)) return previousRole
  const currentRole = String(account?.learningRole || '').trim().toLowerCase()
  if (['learner', 'creator'].includes(currentRole)) return currentRole
  return 'learner'
}

const resolveReportWindow = (query = {}, fallbackLookbackDays = 30) => {
  const fallback = Number.isFinite(Number(fallbackLookbackDays))
    ? Math.min(365, Math.max(1, Math.round(Number(fallbackLookbackDays))))
    : 30
  const lookbackCandidate = Number(query.reportLookbackDays || query.lookbackDays || query.lookback || fallback)
  const lookbackDays = Number.isFinite(lookbackCandidate)
    ? Math.min(365, Math.max(1, Math.round(lookbackCandidate)))
    : fallback
  const to = parseDateBoundary(query.reportTo || query.to || query.endDate || '', 'end') || new Date()
  const from = parseDateBoundary(query.reportFrom || query.from || query.startDate || '', 'start')
    || new Date(to.getTime() - (lookbackDays * 24 * 60 * 60 * 1000))
  if (from.getTime() <= to.getTime()) {
    return { from, to, lookbackDays }
  }
  return { from: to, to: from, lookbackDays }
}

const toIsoDateInput = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const parseObjectIdFilter = (value) => {
  const normalized = String(value || '').trim()
  return mongoose.Types.ObjectId.isValid(normalized) ? normalized : ''
}

const buildPartnerSalesReportData = async ({
  orgId,
  from,
  to,
  agentId = '',
  courseId = ''
}) => {
  const match = {
    partnerOrganization: new mongoose.Types.ObjectId(String(orgId))
  }
  const dateRange = {}
  if (from || to) {
    dateRange.$gte = from || undefined
    dateRange.$lte = to || undefined
    match.createdAt = dateRange
  }
  if (mongoose.Types.ObjectId.isValid(String(agentId || ''))) {
    match.agent = new mongoose.Types.ObjectId(String(agentId))
  }
  if (mongoose.Types.ObjectId.isValid(String(courseId || ''))) {
    match.course = new mongoose.Types.ObjectId(String(courseId))
  }

  const rowsRaw = await AgentSaleAttribution.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt'
          }
        },
        saleCount: { $sum: 1 },
        grossSalesMinor: { $sum: { $ifNull: ['$saleAmountMinor', 0] } },
        agentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
        partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
      }
    },
    { $sort: { _id: 1 } }
  ])

  const rows = (rowsRaw || []).map((entry) => ({
    date: String(entry?._id || ''),
    saleCount: Math.max(0, Number(entry?.saleCount || 0)),
    grossSalesMinor: Math.max(0, Number(entry?.grossSalesMinor || 0)),
    agentCommissionMinor: Math.max(0, Number(entry?.agentCommissionMinor || 0)),
    partnerEarningsMinor: Math.max(0, Number(entry?.partnerEarningsMinor || 0))
  }))
  const summary = rows.reduce((acc, row) => ({
    saleCount: acc.saleCount + row.saleCount,
    grossSalesMinor: acc.grossSalesMinor + row.grossSalesMinor,
    agentCommissionMinor: acc.agentCommissionMinor + row.agentCommissionMinor,
    partnerEarningsMinor: acc.partnerEarningsMinor + row.partnerEarningsMinor
  }), {
    saleCount: 0,
    grossSalesMinor: 0,
    agentCommissionMinor: 0,
    partnerEarningsMinor: 0
  })
  return { rows, summary, scope: 'partner' }
}

const buildPartnerChurnMetrics = async ({ orgId, from, to }) => {
  const organizationId = new mongoose.Types.ObjectId(String(orgId))
  const dateRange = {}
  if (from || to) {
    dateRange.$gte = from || undefined
    dateRange.$lte = to || undefined
  }

  const [activeAgents, removedAgents, firstSaleRows, courseRows] = await Promise.all([
    Account.countDocuments({
      learningRole: 'channel_sales_agent',
      partnerOrganization: organizationId
    }),
    AuditLog.countDocuments({
      action: 'agent.remove',
      targetOrganization: organizationId,
      ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {})
    }),
    AgentSaleAttribution.aggregate([
      {
        $match: {
          partnerOrganization: organizationId,
          ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {})
        }
      },
      {
        $group: {
          _id: '$agent',
          firstSaleAt: { $min: '$createdAt' }
        }
      }
    ]),
    SimpleLmsCourse.find({ organization: organizationId }).select('_id').lean()
  ])

  const firstSaleAgentIds = (firstSaleRows || [])
    .map((entry) => String(entry?._id || ''))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
  const firstSaleAgents = firstSaleAgentIds.length > 0
    ? await Account.find({ _id: { $in: firstSaleAgentIds } }).select('_id createdAt').lean()
    : []
  const createdAtByAgentId = new Map(firstSaleAgents.map((entry) => [String(entry._id), entry.createdAt || null]))
  const timeToFirstSaleDays = (firstSaleRows || [])
    .map((entry) => {
      const firstSaleAt = entry?.firstSaleAt ? new Date(entry.firstSaleAt) : null
      const createdAt = createdAtByAgentId.get(String(entry?._id || ''))
      if (!firstSaleAt || !createdAt) return null
      const createdDate = new Date(createdAt)
      if (Number.isNaN(firstSaleAt.getTime()) || Number.isNaN(createdDate.getTime())) return null
      return Math.max(0, (firstSaleAt.getTime() - createdDate.getTime()) / (24 * 60 * 60 * 1000))
    })
    .filter((value) => Number.isFinite(value))
  const averageTimeToFirstSaleDays = timeToFirstSaleDays.length > 0
    ? Math.round((timeToFirstSaleDays.reduce((sum, value) => sum + value, 0) / timeToFirstSaleDays.length) * 10) / 10
    : 0

  const courseIds = (courseRows || [])
    .map((course) => String(course?._id || ''))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id))
  if (courseIds.length === 0) {
    return {
      activeAgents: Math.max(0, Number(activeAgents || 0)),
      removedAgents: Math.max(0, Number(removedAgents || 0)),
      agentAttritionRatePercent: 0,
      averageTimeToFirstSaleDays,
      activeEnrollments: 0,
      atRiskEnrollments: 0,
      learnerDropOffRatePercent: 0
    }
  }

  const inactivityThreshold = new Date((to || new Date()).getTime() - (14 * 24 * 60 * 60 * 1000))
  const [activeEnrollments, atRiskEnrollments] = await Promise.all([
    SimpleLmsEnrollment.countDocuments({
      course: { $in: courseIds },
      status: 'active'
    }),
    SimpleLmsEnrollment.countDocuments({
      course: { $in: courseIds },
      status: 'active',
      progressPercent: { $lt: 30 },
      $or: [
        { lastActivityAt: { $lte: inactivityThreshold } },
        { lastActivityAt: { $exists: false } }
      ]
    })
  ])

  const agentBase = Math.max(1, Number(activeAgents || 0) + Number(removedAgents || 0))
  const enrollmentBase = Math.max(1, Number(activeEnrollments || 0))
  return {
    activeAgents: Math.max(0, Number(activeAgents || 0)),
    removedAgents: Math.max(0, Number(removedAgents || 0)),
    agentAttritionRatePercent: Math.round((Math.max(0, Number(removedAgents || 0)) / agentBase) * 1000) / 10,
    averageTimeToFirstSaleDays,
    activeEnrollments: Math.max(0, Number(activeEnrollments || 0)),
    atRiskEnrollments: Math.max(0, Number(atRiskEnrollments || 0)),
    learnerDropOffRatePercent: Math.round((Math.max(0, Number(atRiskEnrollments || 0)) / enrollmentBase) * 1000) / 10
  }
}

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

router.use(requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user']))

router.get('/', async (req, res) => {
  try {
    const role = resolvePartnerDashboardRole(req)
    const availableSections = getSectionsForRole(role)
    const section = normalizeSection(req.query.section, role)
    const org = req.partnerOrg
    const reportWindow = resolveReportWindow(req.query || {}, 30)
    const reportAgentId = parseObjectIdFilter(req.query.reportAgentId || req.query.agentId || '')
    const reportCourseId = parseObjectIdFilter(req.query.reportCourseId || req.query.courseId || '')

    const dashboardData = await loadPartnerDashboardData({ orgId: org._id })

    const [agentRows, commissionRows, courseRows, partnerWithdrawalRows, partnerWalletSummary, partnerSalesReportRaw, partnerChurnMetrics] = await Promise.all([
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
        .lean(),
      PartnerWithdrawal.find({ organization: org._id })
        .sort({ createdAt: -1 })
        .limit(120)
        .populate('requestedBy', 'email profile')
        .populate('reviewedBy', 'email profile')
        .populate('paidBy', 'email profile')
        .lean(),
      getPartnerWalletSnapshot(org._id),
      buildPartnerSalesReportData({
        orgId: org._id,
        from: reportWindow.from,
        to: reportWindow.to,
        agentId: reportAgentId,
        courseId: reportCourseId
      }),
      buildPartnerChurnMetrics({
        orgId: org._id,
        from: reportWindow.from,
        to: reportWindow.to
      })
    ])

    const agentRowsDecorated = (agentRows || []).map((agent) => {
      const member = (org.members || []).find((entry) => String(entry.account) === String(agent._id))
      const override = Number(member?.agentCommissionRate)
      return {
        ...agent,
        agentCommissionRate: Number.isFinite(override) ? Math.min(100, Math.max(0, override)) : null
      }
    })

    const payoutCurrency = normalizeSimpleLmsCurrencyCode(
      org?.partnerSettings?.payoutProfile?.currency || 'NGN',
      'NGN'
    )
    const partnerWallet = {
      ...partnerWalletSummary,
      totalSalesDisplay: formatCurrencyAmount(partnerWalletSummary.totalSalesMinor, payoutCurrency),
      totalAgentCommissionDisplay: formatCurrencyAmount(partnerWalletSummary.totalAgentCommissionMinor, payoutCurrency),
      partnerEarningsDisplay: formatCurrencyAmount(partnerWalletSummary.partnerEarningsMinor, payoutCurrency),
      paidOutDisplay: formatCurrencyAmount(partnerWalletSummary.paidOutMinor, payoutCurrency),
      pendingWithdrawalDisplay: formatCurrencyAmount(partnerWalletSummary.pendingWithdrawalMinor, payoutCurrency),
      availableBalanceDisplay: formatCurrencyAmount(partnerWalletSummary.availableBalanceMinor, payoutCurrency)
    }

    const partnerSalesReport = {
      ...partnerSalesReportRaw,
      rows: (partnerSalesReportRaw.rows || []).map((entry) => ({
        ...entry,
        grossSalesDisplay: formatCurrencyAmount(entry.grossSalesMinor || 0, payoutCurrency),
        agentCommissionDisplay: formatCurrencyAmount(entry.agentCommissionMinor || 0, payoutCurrency),
        partnerEarningsDisplay: formatCurrencyAmount(entry.partnerEarningsMinor || 0, payoutCurrency)
      })),
      summary: {
        ...partnerSalesReportRaw.summary,
        grossSalesDisplay: formatCurrencyAmount(partnerSalesReportRaw.summary?.grossSalesMinor || 0, payoutCurrency),
        agentCommissionDisplay: formatCurrencyAmount(partnerSalesReportRaw.summary?.agentCommissionMinor || 0, payoutCurrency),
        partnerEarningsDisplay: formatCurrencyAmount(partnerSalesReportRaw.summary?.partnerEarningsMinor || 0, payoutCurrency)
      }
    }
    const reportFilters = {
      from: toIsoDateInput(reportWindow.from),
      to: toIsoDateInput(reportWindow.to),
      lookbackDays: reportWindow.lookbackDays,
      agentId: reportAgentId,
      courseId: reportCourseId
    }

    const partnerWithdrawals = (partnerWithdrawalRows || []).map((entry) => {
      const status = normalizePartnerWithdrawalStatus(entry.status, 'pending')
      return {
        ...entry,
        status,
        statusLabel: formatPartnerWithdrawalStatus(status),
        requestedByName: entry.requestedBy?.profile?.name || entry.requestedBy?.email || 'Partner Admin',
        reviewedByName: entry.reviewedBy?.profile?.name || entry.reviewedBy?.email || '',
        paidByName: entry.paidBy?.profile?.name || entry.paidBy?.email || '',
        amountDisplay: formatCurrencyAmount(entry.amountMinor, entry.currency || payoutCurrency),
        canCancel: ['pending', 'approved'].includes(status)
      }
    })

    return res.render('partner-dashboard', {
      title: `${res.locals.brandLearningName || 'Seemplify Learning'} - Partner Dashboard`,
      activePage: 'partner-dashboard',
      activeSection: section,
      availableSections,
      user: req.user,
      learningRole: role,
      organization: org,
      dashboardData,
      agents: agentRowsDecorated,
      commissions: commissionRows,
      courses: courseRows,
      partnerWithdrawals,
      partnerWallet,
      reportFilters,
      partnerSalesReport,
      partnerChurnMetrics,
      canManageAgents: canManageAgents(role),
      canRemoveAgents: canRemoveAgents(role),
      canApprovePartnerCourses: canApprovePartnerCourses(role),
      canRecommendAgentPayout: canRecommendAgentPayout(role),
      canManageAgentCommissionRates: canManageAgentCommissionRates(role),
      canRequestPartnerWithdrawals: canRequestPartnerWithdrawals(role),
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
    const role = resolvePartnerDashboardRole(req)
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
      const existingAccessProfile = await resolveAccessProfile(existingAccount)
      const linkedOrganizationId = String(
        existingAccessProfile?.partnerAccess?.organizationId
        || existingAccessProfile?.agentAccess?.organizationId
        || existingAccount.partnerOrganization
        || ''
      ).trim()

      if (existingAccessProfile?.platformRole || existingAccessProfile?.partnerAccess) {
        return res.redirect(`${redirectTo}&error=${encodeURIComponent('This account already has platform or partner dashboard access and cannot also become an agent.')}`)
      }
      if (existingAccessProfile?.agentAccess && linkedOrganizationId && linkedOrganizationId !== String(org._id)) {
        return res.redirect(`${redirectTo}&error=${encodeURIComponent('This user already belongs to another channel partner organization.')}`)
      }

      const previousLearningRole = resolveNonAgentFallbackRole(existingAccount)
      existingAccount.learningRole = 'channel_sales_agent'
      existingAccount.partnerOrganization = org._id
      existingAccount.currentOrganization = org._id
      existingAccount.roleMetadata = {
        ...(existingAccount.roleMetadata || {}),
        previousLearningRole,
        lastUpdatedAt: new Date(),
        lastUpdatedBy: req.user._id
      }

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
    const role = resolvePartnerDashboardRole(req)
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
    if (String(agent.currentOrganization || '') === String(org._id)) {
      agent.currentOrganization = null
    }
    if (agent.learningRole === 'channel_sales_agent') {
      agent.learningRole = resolveNonAgentFallbackRole(agent)
    }
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

router.post('/agents/:agentId/commission-rate', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=agents'
  try {
    const role = resolvePartnerDashboardRole(req)
    if (!canManageAgentCommissionRates(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can update per-agent commission rates.')}`)
    }

    const agentId = String(req.params.agentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid agent selected.')}`)
    }

    const org = req.partnerOrg
    const member = (org.members || []).find((entry) => (
      String(entry.account) === agentId && entry.role === 'sales_agent' && entry.status === 'active'
    ))
    if (!member) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Agent is not active in this organization.')}`)
    }

    const rawRate = String(req.body.ratePercent || '').trim()
    const previousRate = Number(member.agentCommissionRate)
    let nextRate = null
    if (rawRate) {
      const parsed = Number(rawRate)
      if (!Number.isFinite(parsed)) {
        return res.redirect(`${redirectTo}&error=${encodeURIComponent('Enter a valid commission percentage.')}`)
      }
      nextRate = Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
    }

    member.agentCommissionRate = nextRate
    member.updatedAt = new Date()
    member.updatedBy = req.user._id
    await org.save()

    await logAuditEvent({
      action: 'agent.commission_rate_update',
      performedBy: req.user._id,
      targetAccount: member.account,
      targetOrganization: org._id,
      metadata: {
        previousRate: Number.isFinite(previousRate) ? Math.min(100, Math.max(0, previousRate)) : null,
        nextRate
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent(nextRate === null ? 'Agent commission override cleared.' : 'Agent commission rate updated.')}`)
  } catch (error) {
    console.error('Partner agent commission-rate update error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to update agent commission rate.')}`)
  }
})

router.post('/withdrawals/request', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=withdrawals'
  try {
    const role = resolvePartnerDashboardRole(req)
    if (!canRequestPartnerWithdrawals(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only partner super users can request organization withdrawals.')}`)
    }

    const org = req.partnerOrg
    const amountMinor = parseMajorAmountToMinor(req.body.amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Enter a valid withdrawal amount.')}`)
    }

    const currency = normalizeSimpleLmsCurrencyCode(
      req.body.currency || org?.partnerSettings?.payoutProfile?.currency || 'NGN',
      'NGN'
    )
    const walletSnapshot = await getPartnerWalletSnapshot(org._id)
    if (amountMinor > walletSnapshot.availableBalanceMinor) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent(`Withdrawal exceeds available partner balance (${formatCurrencyAmount(walletSnapshot.availableBalanceMinor, currency)}).`)}`)
    }

    const payoutProfile = org?.partnerSettings?.payoutProfile || {}
    await PartnerWithdrawal.create({
      organization: org._id,
      requestedBy: req.user._id,
      amountMinor: Math.round(amountMinor),
      currency,
      status: 'pending',
      requestedAt: new Date(),
      notes: String(req.body.notes || '').trim().slice(0, 1200),
      payoutProfileSnapshot: {
        accountName: String(payoutProfile.accountName || '').trim().slice(0, 200),
        accountNumber: String(payoutProfile.accountNumber || '').trim().slice(0, 64),
        bankName: String(payoutProfile.bankName || '').trim().slice(0, 200),
        bankCode: String(payoutProfile.bankCode || '').trim().slice(0, 80),
        swiftCode: String(payoutProfile.swiftCode || '').trim().slice(0, 80),
        paymentEmail: String(payoutProfile.paymentEmail || '').trim().toLowerCase().slice(0, 320),
        country: String(payoutProfile.country || '').trim().slice(0, 80),
        notes: String(payoutProfile.notes || '').trim().slice(0, 1200)
      }
    })

    await logAuditEvent({
      action: 'partner.withdrawal.request',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        amountMinor: Math.round(amountMinor),
        currency
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Partner withdrawal request submitted for admin review.')}`)
  } catch (error) {
    console.error('Partner withdrawal request error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to submit withdrawal request.')}`)
  }
})

router.post('/withdrawals/:withdrawalId/cancel', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=withdrawals'
  try {
    const role = resolvePartnerDashboardRole(req)
    const org = req.partnerOrg
    const withdrawalId = String(req.params.withdrawalId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Invalid withdrawal request selected.')}`)
    }

    const withdrawal = await PartnerWithdrawal.findOne({
      _id: withdrawalId,
      organization: org._id
    })
    if (!withdrawal) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Withdrawal request not found.')}`)
    }

    const currentStatus = normalizePartnerWithdrawalStatus(withdrawal.status, 'pending')
    if (!['pending', 'approved'].includes(currentStatus)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('Only pending or approved requests can be cancelled.')}`)
    }

    const isRequester = String(withdrawal.requestedBy || '') === String(req.user._id)
    if (!isRequester && !canRequestPartnerWithdrawals(role)) {
      return res.redirect(`${redirectTo}&error=${encodeURIComponent('You do not have permission to cancel this withdrawal request.')}`)
    }

    const cancelNote = String(req.body.cancelNote || '').trim().slice(0, 3000)
    withdrawal.status = 'cancelled'
    withdrawal.reviewedBy = req.user._id
    withdrawal.reviewedAt = new Date()
    if (cancelNote) {
      const previousAdminNotes = String(withdrawal.adminNotes || '').trim()
      withdrawal.adminNotes = previousAdminNotes
        ? `${previousAdminNotes}\nCancelled: ${cancelNote}`.slice(0, 3000)
        : `Cancelled: ${cancelNote}`
    }
    await withdrawal.save()

    await logAuditEvent({
      action: 'partner.withdrawal.cancel',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        withdrawalId: withdrawal._id,
        status: withdrawal.status
      },
      req
    })

    return res.redirect(`${redirectTo}&success=${encodeURIComponent('Partner withdrawal request cancelled.')}`)
  } catch (error) {
    console.error('Partner withdrawal cancel error:', error)
    return res.redirect(`${redirectTo}&error=${encodeURIComponent(error.message || 'Failed to cancel withdrawal request.')}`)
  }
})

router.post('/courses/:courseId/approve', async (req, res) => {
  const redirectTo = '/partner-dashboard?section=courses'
  try {
    const role = resolvePartnerDashboardRole(req)
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
    const role = resolvePartnerDashboardRole(req)
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
    const role = resolvePartnerDashboardRole(req)
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
    const role = resolvePartnerDashboardRole(req)
    if (!['channel_partner_super', 'partner_super'].includes(role)) {
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

