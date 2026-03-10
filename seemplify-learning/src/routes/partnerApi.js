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
    const [agentCount, courseCount, attributionSummary] = await Promise.all([
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
      ])
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
        pendingAgentCommissionsMinor: Number(summary.pendingAgentCommissions || 0)
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

    const rows = agents.map((agent) => {
      const stats = statsByAgentId.get(String(agent._id)) || {
        salesCount: 0,
        totalSalesMinor: 0,
        totalCommissionMinor: 0
      }
      return {
        ...agent,
        salesCount: Number(stats.salesCount || 0),
        totalSalesMinor: Number(stats.totalSalesMinor || 0),
        totalCommissionMinor: Number(stats.totalCommissionMinor || 0)
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
