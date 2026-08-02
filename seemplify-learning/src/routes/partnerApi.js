import express from 'express'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AgentInvite } from '../models/AgentInvite.js'
import { AgentSaleAttribution } from '../models/AgentSaleAttribution.js'
import { PartnerWithdrawal } from '../models/PartnerWithdrawal.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { requirePartnerAccess, requireRole } from '../middleware/roles.js'
import { emailService } from '../services/emailService.js'
import { normalizeSimpleLmsCurrencyCode, parseMajorAmountToMinor } from '../services/simpleLmsCurrencyService.js'
import { logAuditEvent } from '../utils/auditLog.js'
import { resolveLearningRole } from '../utils/learningRoles.js'

const router = express.Router()

const PARTNER_API_ROLES = [
  'super_admin',
  'admin',
  'channel_partner_super',
  'channel_partner_user',
  'partner_super',
  'partner_user'
]

const buildBaseUrl = (req) => {
  const proto = String(req.protocol || 'http').trim()
  const host = String(req.get('host') || '').trim()
  return host ? `${proto}://${host}` : ''
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const generateInviteToken = () => crypto.randomBytes(24).toString('hex')

const canRemoveAgent = (learningRole) => {
  const role = String(learningRole || '').trim().toLowerCase()
  return ['super_admin', 'admin', 'channel_partner_super'].includes(role)
}

const canManageAgentCommissionRate = (learningRole) => {
  const role = String(learningRole || '').trim().toLowerCase()
  return ['super_admin', 'admin', 'channel_partner_super', 'partner_super'].includes(role)
}

const canRequestPartnerWithdrawal = (learningRole) => {
  const role = String(learningRole || '').trim().toLowerCase()
  return ['super_admin', 'admin', 'channel_partner_super', 'partner_super'].includes(role)
}

const normalizePartnerWithdrawalStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(normalized) ? normalized : fallback
}

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

  const earnings = earningsRaw[0] || { totalSalesMinor: 0, totalAgentCommissionMinor: 0, partnerEarningsMinor: 0 }
  const withdrawals = withdrawalsRaw[0] || { paidOutMinor: 0, pendingWithdrawalMinor: 0 }
  const partnerEarningsMinor = Math.max(0, Number(earnings.partnerEarningsMinor || 0))
  const paidOutMinor = Math.max(0, Number(withdrawals.paidOutMinor || 0))
  const pendingWithdrawalMinor = Math.max(0, Number(withdrawals.pendingWithdrawalMinor || 0))
  return {
    totalSalesMinor: Math.max(0, Number(earnings.totalSalesMinor || 0)),
    totalAgentCommissionMinor: Math.max(0, Number(earnings.totalAgentCommissionMinor || 0)),
    partnerEarningsMinor,
    paidOutMinor,
    pendingWithdrawalMinor,
    availableBalanceMinor: Math.max(0, partnerEarningsMinor - paidOutMinor - pendingWithdrawalMinor)
  }
}

const ensureAgentCap = (organization) => {
  const cap = Number(organization?.partnerSettings?.maxAgents)
  if (!Number.isFinite(cap) || cap <= 0) return

  const activeAgentCount = (organization.members || []).filter((member) => (
    member.status === 'active' && member.role === 'sales_agent'
  )).length

  if (activeAgentCount >= Math.floor(cap)) {
    throw new Error('Agent limit reached for this partner organization.')
  }
}

router.use(requireRole(PARTNER_API_ROLES))

router.get('/:orgId', requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user', 'sales_agent'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const [agentCount, courseCount, attributionSummary, walletSummary] = await Promise.all([
      Account.countDocuments({ partnerOrganization: org._id, learningRole: 'channel_sales_agent' }),
      SimpleLmsCourse.countDocuments({ organization: org._id, isActive: true }),
      AgentSaleAttribution.aggregate([
        { $match: { partnerOrganization: org._id } },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$saleAmountMinor' },
            totalAgentCommissions: { $sum: '$commissionAmountMinor' },
            pendingAgentCommissions: {
              $sum: {
                $cond: [{ $in: ['$status', ['pending', 'recommended', 'approved']] }, '$commissionAmountMinor', 0]
              }
            }
          }
        }
      ]),
      getPartnerWalletSnapshot(org._id)
    ])

    const summary = attributionSummary[0] || {
      totalSales: 0,
      totalAgentCommissions: 0,
      pendingAgentCommissions: 0
    }

    return res.json({
      organization: {
        id: org._id,
        name: org.name,
        partnerType: org.partnerType,
        partnerStatus: org.partnerSettings?.partnerStatus || 'pending',
        settings: org.partnerSettings || {}
      },
      metrics: {
        agentCount,
        courseCount,
        totalSalesMinor: Number(summary.totalSales || 0),
        totalAgentCommissionsMinor: Number(summary.totalAgentCommissions || 0),
        pendingAgentCommissionsMinor: Number(summary.pendingAgentCommissions || 0),
        partnerEarningsMinor: Number(walletSummary.partnerEarningsMinor || 0),
        partnerAvailableBalanceMinor: Number(walletSummary.availableBalanceMinor || 0),
        partnerPendingWithdrawalMinor: Number(walletSummary.pendingWithdrawalMinor || 0)
      }
    })
  } catch (error) {
    console.error('Partner detail API error:', error)
    return res.status(500).json({ error: 'Failed to fetch partner organization details.', code: 'PARTNER_DETAIL_FAILED' })
  }
})

router.get('/:orgId/agents', requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const page = Math.max(1, Number(req.query.page || 1))
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 50)))
    const skip = (page - 1) * limit

    const [agents, total] = await Promise.all([
      Account.find({
        partnerOrganization: org._id,
        learningRole: 'channel_sales_agent'
      })
        .select('_id sub email profile createdAt payoutProfile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Account.countDocuments({
        partnerOrganization: org._id,
        learningRole: 'channel_sales_agent'
      })
    ])

    const agentIds = agents.map((agent) => agent._id)
    const salesByAgent = await AgentSaleAttribution.aggregate([
      {
        $match: {
          partnerOrganization: org._id,
          agent: { $in: agentIds }
        }
      },
      {
        $group: {
          _id: '$agent',
          salesCount: { $sum: 1 },
          totalSalesMinor: { $sum: '$saleAmountMinor' },
          totalCommissionMinor: { $sum: '$commissionAmountMinor' }
        }
      }
    ])
    const statsByAgentId = new Map(salesByAgent.map((entry) => [String(entry._id), entry]))
    const commissionOverrideByAgentId = new Map(
      (org.members || [])
        .filter((member) => member.role === 'sales_agent' && member.status === 'active')
        .map((member) => [String(member.account), Number(member.agentCommissionRate)])
    )

    const rows = agents.map((agent) => {
      const stats = statsByAgentId.get(String(agent._id)) || {
        salesCount: 0,
        totalSalesMinor: 0,
        totalCommissionMinor: 0
      }
      const override = commissionOverrideByAgentId.get(String(agent._id))
      return {
        ...agent,
        salesCount: Number(stats.salesCount || 0),
        totalSalesMinor: Number(stats.totalSalesMinor || 0),
        totalCommissionMinor: Number(stats.totalCommissionMinor || 0),
        agentCommissionRate: Number.isFinite(override) ? Math.min(100, Math.max(0, override)) : null
      }
    })

    return res.json({
      agents: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    })
  } catch (error) {
    console.error('Partner agent list API error:', error)
    return res.status(500).json({ error: 'Failed to load agents.', code: 'AGENT_LIST_FAILED' })
  }
})

router.post('/:orgId/agents', requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const learningRole = resolveLearningRole(req.user)
    ensureAgentCap(org)

    const email = normalizeEmail(req.body.email)
    const accountId = String(req.body.accountId || '').trim()

    if (!email && !accountId) {
      return res.status(400).json({ error: 'Agent email or accountId is required.', code: 'VALIDATION_ERROR' })
    }

    const existingAccount = accountId && mongoose.Types.ObjectId.isValid(accountId)
      ? await Account.findById(accountId)
      : await Account.findOne({ email })

    if (existingAccount) {
      if (existingAccount.partnerOrganization && String(existingAccount.partnerOrganization) !== String(org._id)) {
        return res.status(400).json({ error: 'Agent already belongs to a different partner organization.', code: 'AGENT_ORG_CONFLICT' })
      }

      existingAccount.learningRole = 'channel_sales_agent'
      existingAccount.isSuperAdmin = false
      existingAccount.isSystemAdmin = false
      existingAccount.partnerOrganization = org._id

      const membership = Array.isArray(existingAccount.organizations)
        ? existingAccount.organizations.find((entry) => String(entry.organization) === String(org._id))
        : null

      if (membership) {
        membership.role = 'sales_agent'
        membership.isActive = true
      } else {
        existingAccount.organizations = Array.isArray(existingAccount.organizations) ? existingAccount.organizations : []
        existingAccount.organizations.push({
          organization: org._id,
          role: 'sales_agent',
          appAccess: {
            mode: 'all',
            appIds: []
          },
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
          appAccess: {
            mode: 'all',
            appIds: []
          },
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
          mode: 'direct_assign',
          invitedByRole: learningRole
        },
        req
      })

      return res.status(201).json({
        success: true,
        mode: 'direct_assign',
        agent: {
          id: existingAccount._id,
          email: existingAccount.email,
          name: existingAccount.profile?.name || ''
        }
      })
    }

    const token = generateInviteToken()
    const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000))

    const invite = await AgentInvite.create({
      partnerOrganization: org._id,
      invitedBy: req.user._id,
      email,
      token,
      status: 'pending',
      expiresAt,
      metadata: {
        invitedByRole: learningRole
      }
    })

    const inviteLink = `${buildBaseUrl(req)}/register?invite_token=${encodeURIComponent(token)}&return_to=${encodeURIComponent('/agent-dashboard')}`
    await emailService.sendNotificationEmail({
      to: email,
      subject: `${org.name} invited you as a sales agent`,
      html: `<p>You were invited to join <strong>${org.name}</strong> as a sales agent.</p><p>Use this link to complete your registration:</p><p><a href="${inviteLink}">${inviteLink}</a></p><p>This invite expires in 24 hours.</p>`,
      text: `You were invited to join ${org.name} as a sales agent. Use this link within 24 hours: ${inviteLink}`
    })

    await logAuditEvent({
      action: 'agent.invite',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        inviteId: invite._id,
        email,
        expiresAt
      },
      req
    })

    return res.status(201).json({
      success: true,
      mode: 'invite',
      invite: {
        id: invite._id,
        email: invite.email,
        expiresAt: invite.expiresAt
      }
    })
  } catch (error) {
    console.error('Partner add/invite agent API error:', error)
    return res.status(400).json({ error: error.message || 'Failed to add or invite agent.', code: 'AGENT_ADD_FAILED' })
  }
})

router.put('/:orgId/agents/:agentId/commission-rate', requirePartnerAccess(['owner', 'admin', 'partner_admin'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const learningRole = resolveLearningRole(req.user)
    if (!canManageAgentCommissionRate(learningRole)) {
      return res.status(403).json({ error: 'Only partner super users or platform admins can update agent commission rates.', code: 'AGENT_RATE_FORBIDDEN' })
    }

    const agentId = String(req.params.agentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ error: 'Invalid agent selected.', code: 'INVALID_AGENT_ID' })
    }

    const member = (org.members || []).find((entry) => (
      String(entry.account) === agentId && entry.role === 'sales_agent' && entry.status === 'active'
    ))
    if (!member) {
      return res.status(404).json({ error: 'Agent is not active in this organization.', code: 'AGENT_NOT_FOUND' })
    }

    const rawRate = String(req.body.ratePercent || '').trim()
    let nextRate = null
    if (rawRate) {
      const parsed = Number(rawRate)
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({ error: 'Enter a valid commission percentage.', code: 'INVALID_RATE' })
      }
      nextRate = Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
    }

    const previousRate = Number(member.agentCommissionRate)
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

    return res.json({
      success: true,
      agentId,
      commissionRatePercent: nextRate
    })
  } catch (error) {
    console.error('Partner update agent commission-rate API error:', error)
    return res.status(400).json({ error: error.message || 'Failed to update agent commission rate.', code: 'AGENT_RATE_UPDATE_FAILED' })
  }
})

router.get('/:orgId/withdrawals', requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const rows = await PartnerWithdrawal.find({ organization: org._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('requestedBy', 'email profile')
      .populate('reviewedBy', 'email profile')
      .populate('paidBy', 'email profile')
      .lean()
    const wallet = await getPartnerWalletSnapshot(org._id)
    return res.json({
      wallet,
      withdrawals: rows.map((entry) => ({
        ...entry,
        status: normalizePartnerWithdrawalStatus(entry.status, 'pending')
      }))
    })
  } catch (error) {
    console.error('Partner withdrawals API list error:', error)
    return res.status(500).json({ error: 'Failed to load partner withdrawals.', code: 'PARTNER_WITHDRAWAL_LIST_FAILED' })
  }
})

router.post('/:orgId/withdrawals', requirePartnerAccess(['owner', 'admin', 'partner_admin'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const learningRole = resolveLearningRole(req.user)
    if (!canRequestPartnerWithdrawal(learningRole)) {
      return res.status(403).json({ error: 'Only partner super users or platform admins can request withdrawals.', code: 'PARTNER_WITHDRAWAL_FORBIDDEN' })
    }

    const amountMinor = parseMajorAmountToMinor(req.body.amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return res.status(400).json({ error: 'Enter a valid withdrawal amount.', code: 'INVALID_AMOUNT' })
    }

    const currency = normalizeSimpleLmsCurrencyCode(
      req.body.currency || org?.partnerSettings?.payoutProfile?.currency || 'NGN',
      'NGN'
    )
    const wallet = await getPartnerWalletSnapshot(org._id)
    if (amountMinor > wallet.availableBalanceMinor) {
      return res.status(400).json({
        error: 'Withdrawal exceeds available partner balance.',
        code: 'INSUFFICIENT_BALANCE',
        availableBalanceMinor: wallet.availableBalanceMinor
      })
    }

    const payoutProfile = org?.partnerSettings?.payoutProfile || {}
    const withdrawal = await PartnerWithdrawal.create({
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
        withdrawalId: withdrawal._id,
        amountMinor: withdrawal.amountMinor,
        currency
      },
      req
    })

    return res.status(201).json({
      success: true,
      withdrawal
    })
  } catch (error) {
    console.error('Partner withdrawal create API error:', error)
    return res.status(400).json({ error: error.message || 'Failed to create partner withdrawal request.', code: 'PARTNER_WITHDRAWAL_CREATE_FAILED' })
  }
})

router.post('/:orgId/withdrawals/:withdrawalId/cancel', requirePartnerAccess(['owner', 'admin', 'partner_admin', 'partner_user'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const learningRole = resolveLearningRole(req.user)
    const withdrawalId = String(req.params.withdrawalId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return res.status(400).json({ error: 'Invalid withdrawal selected.', code: 'INVALID_WITHDRAWAL_ID' })
    }

    const withdrawal = await PartnerWithdrawal.findOne({
      _id: withdrawalId,
      organization: org._id
    })
    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal request not found.', code: 'WITHDRAWAL_NOT_FOUND' })
    }

    const status = normalizePartnerWithdrawalStatus(withdrawal.status, 'pending')
    if (!['pending', 'approved'].includes(status)) {
      return res.status(400).json({ error: 'Only pending or approved withdrawals can be cancelled.', code: 'WITHDRAWAL_CANCEL_FORBIDDEN' })
    }

    const isRequester = String(withdrawal.requestedBy || '') === String(req.user._id)
    if (!isRequester && !canRequestPartnerWithdrawal(learningRole)) {
      return res.status(403).json({ error: 'You do not have permission to cancel this withdrawal.', code: 'WITHDRAWAL_CANCEL_FORBIDDEN' })
    }

    withdrawal.status = 'cancelled'
    withdrawal.reviewedBy = req.user._id
    withdrawal.reviewedAt = new Date()
    const cancelNote = String(req.body.cancelNote || '').trim().slice(0, 3000)
    if (cancelNote) {
      const existingNotes = String(withdrawal.adminNotes || '').trim()
      withdrawal.adminNotes = existingNotes
        ? `${existingNotes}\nCancelled: ${cancelNote}`.slice(0, 3000)
        : `Cancelled: ${cancelNote}`
    }
    await withdrawal.save()

    await logAuditEvent({
      action: 'partner.withdrawal.cancel',
      performedBy: req.user._id,
      targetOrganization: org._id,
      metadata: {
        withdrawalId: withdrawal._id
      },
      req
    })

    return res.json({ success: true })
  } catch (error) {
    console.error('Partner withdrawal cancel API error:', error)
    return res.status(400).json({ error: error.message || 'Failed to cancel partner withdrawal request.', code: 'PARTNER_WITHDRAWAL_CANCEL_FAILED' })
  }
})

router.delete('/:orgId/agents/:agentId', requirePartnerAccess(['owner', 'admin', 'partner_admin'], { allowPlatformAdmin: true }), async (req, res) => {
  try {
    const org = req.partnerOrg
    const learningRole = resolveLearningRole(req.user)
    if (!canRemoveAgent(learningRole)) {
      return res.status(403).json({ error: 'Only channel partner super users or platform admins can remove agents.', code: 'AGENT_REMOVE_FORBIDDEN' })
    }

    const agentId = String(req.params.agentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ error: 'Invalid agent selected.', code: 'INVALID_AGENT_ID' })
    }

    const agent = await Account.findById(agentId)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.', code: 'AGENT_NOT_FOUND' })
    }

    if (String(agent.partnerOrganization || '') !== String(org._id)) {
      return res.status(400).json({ error: 'Agent is not linked to this partner organization.', code: 'AGENT_ORG_MISMATCH' })
    }

    agent.partnerOrganization = null
    if (agent.learningRole === 'channel_sales_agent') {
      agent.learningRole = 'learner'
    }
    agent.isSuperAdmin = false
    agent.isSystemAdmin = false
    if (Array.isArray(agent.organizations)) {
      agent.organizations = agent.organizations.filter((entry) => String(entry.organization) !== String(org._id))
    }
    await agent.save()

    org.members = (org.members || []).filter((member) => String(member.account) !== String(agent._id))
    await org.save()

    await logAuditEvent({
      action: 'agent.remove',
      performedBy: req.user._id,
      targetAccount: agent._id,
      targetOrganization: org._id,
      metadata: {
        removedByRole: learningRole
      },
      req
    })

    return res.json({ success: true })
  } catch (error) {
    console.error('Partner remove agent API error:', error)
    return res.status(400).json({ error: error.message || 'Failed to remove agent.', code: 'AGENT_REMOVE_FAILED' })
  }
})

export default router
