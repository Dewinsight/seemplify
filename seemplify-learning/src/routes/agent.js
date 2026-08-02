import express from 'express'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AgentSaleAttribution } from '../models/AgentSaleAttribution.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { requireRole } from '../middleware/roles.js'
import { buildAgentReferralCode } from '../utils/agentReferral.js'
import { buildOrganizationSellableCourseFilter, findCourseSellingAssignment } from '../utils/courseSelling.js'

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

const normalizeSection = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  const sections = ['overview', 'courses', 'sales', 'commissions', 'earnings', 'settings']
  return sections.includes(normalized) ? normalized : 'overview'
}

const buildReferralUrl = (req, course, code, organizationId) => {
  const proto = String(req.protocol || 'http').trim()
  const host = String(req.get('host') || '').trim()
  const base = host ? `${proto}://${host}` : ''
  const courseUrl = `/courses/${course._id}${course.slug ? `/${course.slug}` : ''}`
  const params = new URLSearchParams()
  params.set('ref', code)
  if (organizationId) params.set('org', String(organizationId))
  return `${base}${courseUrl}?${params.toString()}`
}

router.use(requireRole(['channel_sales_agent']))

router.get('/', async (req, res) => {
  try {
    const section = normalizeSection(req.query.section)

    const partnerOrgId = String(req.user?.partnerOrganization || '').trim()
    if (!partnerOrgId || !mongoose.Types.ObjectId.isValid(partnerOrgId)) {
      return res.redirect('/simple-lms?error=Agent%20account%20is%20not%20linked%20to%20a%20partner%20organization')
    }

    const [organization, courses, attributions] = await Promise.all([
      Organization.findById(partnerOrgId).lean(),
      SimpleLmsCourse.find(buildOrganizationSellableCourseFilter(partnerOrgId, {
        isActive: true,
        status: 'published',
        visibility: { $in: ['organization_public', 'system_public'] }
      }))
        .sort({ updatedAt: -1 })
        .limit(200)
        .select('title slug summary pricing level banner updatedAt organization sellingOrganizations createdByName')
        .lean(),
      AgentSaleAttribution.find({ agent: req.user._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('payment', 'account amountMinor currency creatorCommissionMinor partnerShareMinor platformShareMinor saleMode metadata paidAt')
        .populate('course', 'title')
        .lean()
    ])

    const totals = attributions.reduce((acc, attribution) => {
      const amount = Number(attribution.commissionAmountMinor || 0)
      acc.totalCommissionMinor += amount
      if (['pending', 'recommended', 'approved'].includes(String(attribution.status || '').trim().toLowerCase())) {
        acc.pendingCommissionMinor += amount
      }
      if (String(attribution.status || '').trim().toLowerCase() === 'paid') {
        acc.paidCommissionMinor += amount
      }
      return acc
    }, {
      totalCommissionMinor: 0,
      pendingCommissionMinor: 0,
      paidCommissionMinor: 0
    })

    const referralCode = buildAgentReferralCode(req.user)
    const enrichedCourses = courses.map((course) => {
      const ownedByOrganization = String(course?.organization || '') === partnerOrgId
      const assignment = ownedByOrganization
        ? null
        : findCourseSellingAssignment(course, partnerOrgId, { onlyActive: true })
      const creatorSharePercent = Number.isFinite(Number(assignment?.creatorSharePercent))
        ? Number(assignment.creatorSharePercent)
        : 70
      const partnerSharePercent = ownedByOrganization
        ? Math.max(0, Math.round((100 - creatorSharePercent) * 100) / 100)
        : Number.isFinite(Number(assignment?.partnerSharePercent))
          ? Number(assignment.partnerSharePercent)
          : 0
      const platformSharePercent = Math.max(0, Math.round((100 - creatorSharePercent - partnerSharePercent) * 100) / 100)
      return {
        ...course,
        saleRelationshipLabel: ownedByOrganization ? 'Owned by your organization' : 'Assigned creator course',
        splitSummary: `${creatorSharePercent}% creator / ${partnerSharePercent}% partner / ${platformSharePercent}% platform`,
        referralUrl: buildReferralUrl(req, course, referralCode, partnerOrgId)
      }
    })

    const attributionRows = (attributions || []).map((entry) => {
      const paymentCurrency = entry.payment?.currency || entry.currency || 'NGN'
      const creatorShareMinor = Number(entry.payment?.creatorCommissionMinor || entry.metadata?.creatorCommissionMinor || 0)
      const partnerGrossShareMinor = Number(entry.payment?.partnerShareMinor || entry.metadata?.partnerShareMinor || 0)
      const platformShareMinor = Number(entry.payment?.platformShareMinor || entry.metadata?.platformShareMinor || 0)
      const partnerNetShareMinor = Math.max(0, Number(entry.metadata?.partnerNetShareMinor || (partnerGrossShareMinor - Number(entry.commissionAmountMinor || 0))))
      return {
        ...entry,
        creatorShareMinor,
        creatorShareDisplay: formatCurrencyAmount(creatorShareMinor, paymentCurrency),
        partnerGrossShareMinor,
        partnerGrossShareDisplay: formatCurrencyAmount(partnerGrossShareMinor, paymentCurrency),
        platformShareMinor,
        platformShareDisplay: formatCurrencyAmount(platformShareMinor, paymentCurrency),
        partnerNetShareMinor,
        partnerNetShareDisplay: formatCurrencyAmount(partnerNetShareMinor, paymentCurrency)
      }
    })

    return res.render('agent-dashboard', {
      title: `${res.locals.brandLearningName || 'Seemplify Learning'} - Agent Dashboard`,
      activePage: 'agent-dashboard',
      activeSection: section,
      user: req.user,
      organization,
      referralCode,
      courses: enrichedCourses,
      attributions: attributionRows,
      totals,
      formatCurrencyAmount,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Agent dashboard render error:', error)
    return res.redirect('/simple-lms?error=Failed%20to%20load%20agent%20dashboard')
  }
})

router.get('/courses', async (req, res) => {
  const params = new URLSearchParams()
  params.set('section', 'courses')
  const query = params.toString()
  return res.redirect(query ? `/agent-dashboard?${query}` : '/agent-dashboard')
})

router.get('/sales', async (req, res) => {
  const params = new URLSearchParams()
  params.set('section', 'sales')
  const query = params.toString()
  return res.redirect(query ? `/agent-dashboard?${query}` : '/agent-dashboard')
})

router.get('/commissions', async (req, res) => {
  const params = new URLSearchParams()
  params.set('section', 'commissions')
  const query = params.toString()
  return res.redirect(query ? `/agent-dashboard?${query}` : '/agent-dashboard')
})

router.get('/earnings', async (req, res) => {
  const params = new URLSearchParams()
  params.set('section', 'earnings')
  const query = params.toString()
  return res.redirect(query ? `/agent-dashboard?${query}` : '/agent-dashboard')
})

router.get('/settings', async (req, res) => {
  const params = new URLSearchParams()
  params.set('section', 'settings')
  const query = params.toString()
  return res.redirect(query ? `/agent-dashboard?${query}` : '/agent-dashboard')
})

router.get('/courses/:courseId/referral', async (req, res) => {
  try {
    const partnerOrgId = String(req.user?.partnerOrganization || '').trim()
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(partnerOrgId)) {
      return res.status(400).json({ error: 'Invalid course selected.', code: 'INVALID_COURSE_ID' })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      ...buildOrganizationSellableCourseFilter(partnerOrgId, {
        isActive: true,
        status: 'published',
        visibility: { $in: ['organization_public', 'system_public'] }
      })
    })
      .select('_id slug title')
      .lean()

    if (!course) {
      return res.status(404).json({ error: 'Course not found in your partner organization.', code: 'COURSE_NOT_FOUND' })
    }

    const referralCode = buildAgentReferralCode(req.user)
    const referralUrl = buildReferralUrl(req, course, referralCode, partnerOrgId)

    return res.json({
      referralCode,
      referralUrl,
      course: {
        id: course._id,
        title: course.title
      }
    })
  } catch (error) {
    console.error('Generate referral link error:', error)
    return res.status(500).json({ error: 'Failed to generate referral link.', code: 'REFERRAL_FAILED' })
  }
})

router.post('/settings/payout', async (req, res) => {
  try {
    const account = await Account.findById(req.user._id)
    if (!account) {
      return res.redirect('/agent-dashboard?section=settings&error=Failed%20to%20save%20payout%20profile')
    }

    account.payoutProfile = {
      ...(account.payoutProfile || {}),
      accountName: String(req.body.accountName || '').trim().slice(0, 200),
      accountNumber: String(req.body.accountNumber || '').trim().slice(0, 64),
      bankName: String(req.body.bankName || '').trim().slice(0, 200),
      bankCode: String(req.body.bankCode || '').trim().slice(0, 80),
      swiftCode: String(req.body.swiftCode || '').trim().slice(0, 80),
      currency: String(req.body.currency || 'NGN').trim().toUpperCase().slice(0, 3) || 'NGN',
      paymentEmail: String(req.body.paymentEmail || '').trim().toLowerCase().slice(0, 320),
      country: String(req.body.country || '').trim().slice(0, 80),
      notes: String(req.body.notes || '').trim().slice(0, 1200),
      updatedAt: new Date()
    }

    await account.save()

    return res.redirect('/agent-dashboard?section=settings&success=Payout%20profile%20updated')
  } catch (error) {
    console.error('Update agent payout profile error:', error)
    return res.redirect('/agent-dashboard?section=settings&error=Failed%20to%20save%20payout%20profile')
  }
})

export default router
