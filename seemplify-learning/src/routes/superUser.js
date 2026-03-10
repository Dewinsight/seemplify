import express from 'express'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { RoleApprovalRequest } from '../models/RoleApprovalRequest.js'
import { requireRole } from '../middleware/roles.js'
import { logAuditEvent } from '../utils/auditLog.js'
import {
  LEARNING_ROLES,
  PLATFORM_ADMIN_ROLES,
  resolveLearningRole,
  resolvePartnerTypeForIntent
} from '../utils/learningRoles.js'

const router = express.Router()

const sanitizeRole = (value, fallback = 'learner') => {
  const normalized = String(value || '').trim().toLowerCase()
  return LEARNING_ROLES.includes(normalized) ? normalized : fallback
}

const sanitizeOrgName = (value) => String(value || '').trim().slice(0, 160)

const roleToOrgRole = (role) => {
  const normalizedRole = sanitizeRole(role)
  if (['channel_partner_super', 'partner_super'].includes(normalizedRole)) return 'partner_admin'
  if (normalizedRole === 'channel_sales_agent') return 'sales_agent'
  return 'partner_user'
}

const isSuperAdmin = (account) => resolveLearningRole(account) === 'super_admin'

const assertReAuth = async (req) => {
  const currentPassword = String(req.body?.currentPassword || '').trim()
  if (!currentPassword) {
    throw new Error('Current password is required to perform this action.')
  }

  const actingAccount = await Account.findById(req.user._id).select('passwordHash')
  if (!actingAccount || !actingAccount.passwordHash) {
    throw new Error('Unable to validate current password.')
  }

  const isMatch = await bcrypt.compare(currentPassword, actingAccount.passwordHash)
  if (!isMatch) {
    throw new Error('Current password is incorrect.')
  }
}

const createPartnerOrganization = async ({ name, partnerType, ownerId }) => {
  const safeName = sanitizeOrgName(name)
  if (!safeName) return null

  return Organization.create({
    name: safeName,
    description: `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} organization`,
    owner: ownerId,
    partnerType,
    members: [{
      account: ownerId,
      role: 'partner_admin',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      invitedBy: ownerId,
      status: 'active'
    }],
    partnerSettings: {
      partnerStatus: 'active',
      maxAgents: null,
      defaultAgentCommissionRate: 10,
      agentInviteApproval: true
    }
  })
}

const ensurePartnerMembership = async ({ account, organization, orgRole, actingUserId }) => {
  if (!organization) return

  const existingMember = organization.members.find(
    (member) => String(member.account) === String(account._id)
  )

  if (existingMember) {
    existingMember.status = 'active'
    existingMember.role = orgRole
    existingMember.updatedAt = new Date()
    existingMember.updatedBy = actingUserId
  } else {
    organization.members.push({
      account: account._id,
      role: orgRole,
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      invitedBy: actingUserId,
      status: 'active',
      updatedAt: new Date(),
      updatedBy: actingUserId
    })
  }
  await organization.save()

  const existingOrgMembership = Array.isArray(account.organizations)
    ? account.organizations.find((membership) => String(membership.organization) === String(organization._id))
    : null

  if (existingOrgMembership) {
    existingOrgMembership.role = orgRole
    existingOrgMembership.isActive = true
  } else {
    account.organizations = Array.isArray(account.organizations) ? account.organizations : []
    account.organizations.push({
      organization: organization._id,
      role: orgRole,
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
  }

  account.partnerOrganization = organization._id
}

router.use(requireRole(['super_admin']))

router.get('/', async (_req, res) => {
  try {
    const superUsers = await Account.find({ isSuperAdmin: true })
      .select('_id sub email profile learningRole isSuperAdmin isSystemAdmin createdAt updatedAt roleMetadata')
      .sort({ createdAt: 1 })
      .lean()

    return res.json({
      superUsers,
      count: superUsers.length
    })
  } catch (error) {
    console.error('List super users error:', error)
    return res.status(500).json({ error: 'Failed to load super users.', code: 'SUPER_USER_LIST_FAILED' })
  }
})

router.get('/requests', async (req, res) => {
  try {
    const status = String(req.query.status || 'pending').trim().toLowerCase()
    const filter = {}
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      filter.status = status
    }

    const requests = await RoleApprovalRequest.find(filter)
      .populate('account', '_id email profile learningRole partnerOrganization')
      .populate('organization', '_id name partnerType partnerSettings.partnerStatus')
      .populate('reviewedBy', '_id email profile')
      .sort({ createdAt: -1 })
      .lean()

    return res.json({
      requests,
      count: requests.length
    })
  } catch (error) {
    console.error('List role approval requests error:', error)
    return res.status(500).json({ error: 'Failed to load role approval requests.', code: 'ROLE_REQUEST_LIST_FAILED' })
  }
})

router.post('/', async (req, res) => {
  try {
    await assertReAuth(req)

    const email = String(req.body.email || '').trim().toLowerCase()
    const accountId = String(req.body.accountId || '').trim()
    const target = accountId && mongoose.Types.ObjectId.isValid(accountId)
      ? await Account.findById(accountId)
      : await Account.findOne({ email })

    if (!target) {
      return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' })
    }

    if (isSuperAdmin(target)) {
      return res.status(400).json({ error: 'Account is already a super admin.', code: 'ALREADY_SUPER_ADMIN' })
    }

    const previousRole = sanitizeRole(target.learningRole, 'learner')
    target.learningRole = 'super_admin'
    target.isSuperAdmin = true
    target.isSystemAdmin = true
    target.roleMetadata = {
      previousLearningRole: previousRole,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await target.save()

    await logAuditEvent({
      action: 'super_user.create',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        previousRole,
        nextRole: 'super_admin'
      },
      req
    })

    return res.status(201).json({
      success: true,
      superUser: {
        id: target._id,
        email: target.email,
        role: resolveLearningRole(target)
      }
    })
  } catch (error) {
    console.error('Create super user error:', error)
    return res.status(400).json({ error: error.message || 'Failed to create super user.', code: 'SUPER_USER_CREATE_FAILED' })
  }
})

router.put('/:id/promote', async (req, res) => {
  try {
    await assertReAuth(req)

    const targetId = String(req.params.id || '').trim()
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'Invalid account selected.', code: 'INVALID_ACCOUNT_ID' })
    }

    const target = await Account.findById(targetId)
    if (!target) {
      return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' })
    }

    if (isSuperAdmin(target)) {
      return res.status(400).json({ error: 'Account is already a super admin.', code: 'ALREADY_SUPER_ADMIN' })
    }

    const previousRole = sanitizeRole(target.learningRole, 'learner')
    target.learningRole = 'super_admin'
    target.isSuperAdmin = true
    target.isSystemAdmin = true
    target.roleMetadata = {
      previousLearningRole: previousRole,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await target.save()

    await logAuditEvent({
      action: 'super_user.promote',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        previousRole,
        nextRole: 'super_admin'
      },
      req
    })

    return res.json({
      success: true,
      account: {
        id: target._id,
        email: target.email,
        role: resolveLearningRole(target)
      }
    })
  } catch (error) {
    console.error('Promote super user error:', error)
    return res.status(400).json({ error: error.message || 'Failed to promote super user.', code: 'SUPER_USER_PROMOTE_FAILED' })
  }
})

router.put('/:id/demote', async (req, res) => {
  try {
    await assertReAuth(req)

    const targetId = String(req.params.id || '').trim()
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'Invalid account selected.', code: 'INVALID_ACCOUNT_ID' })
    }

    const superAdminCount = await Account.countDocuments({ isSuperAdmin: true })
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last remaining super admin.', code: 'LAST_SUPER_ADMIN_GUARD' })
    }

    const target = await Account.findById(targetId)
    if (!target) {
      return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' })
    }

    if (!isSuperAdmin(target)) {
      return res.status(400).json({ error: 'Account is not a super admin.', code: 'NOT_SUPER_ADMIN' })
    }

    const fallbackRole = sanitizeRole(target.roleMetadata?.previousLearningRole || 'learner', 'learner')
    target.learningRole = fallbackRole
    target.isSuperAdmin = false
    target.isSystemAdmin = PLATFORM_ADMIN_ROLES.includes(fallbackRole)
    target.roleMetadata = {
      previousLearningRole: fallbackRole,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await target.save()

    await logAuditEvent({
      action: 'super_user.demote',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        restoredRole: fallbackRole
      },
      req
    })

    return res.json({
      success: true,
      account: {
        id: target._id,
        email: target.email,
        role: resolveLearningRole(target)
      }
    })
  } catch (error) {
    console.error('Demote super user error:', error)
    return res.status(400).json({ error: error.message || 'Failed to demote super user.', code: 'SUPER_USER_DEMOTE_FAILED' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await assertReAuth(req)

    const targetId = String(req.params.id || '').trim()
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'Invalid account selected.', code: 'INVALID_ACCOUNT_ID' })
    }

    const superAdminCount = await Account.countDocuments({ isSuperAdmin: true })
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last remaining super admin.', code: 'LAST_SUPER_ADMIN_GUARD' })
    }

    const target = await Account.findById(targetId)
    if (!target) {
      return res.status(404).json({ error: 'Account not found.', code: 'ACCOUNT_NOT_FOUND' })
    }

    if (!isSuperAdmin(target)) {
      return res.status(400).json({ error: 'Account is not a super admin.', code: 'NOT_SUPER_ADMIN' })
    }

    const fallbackRole = sanitizeRole(target.roleMetadata?.previousLearningRole || 'learner', 'learner')
    target.learningRole = fallbackRole
    target.isSuperAdmin = false
    target.isSystemAdmin = PLATFORM_ADMIN_ROLES.includes(fallbackRole)
    target.roleMetadata = {
      previousLearningRole: fallbackRole,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await target.save()

    await logAuditEvent({
      action: 'super_user.delete',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        restoredRole: fallbackRole
      },
      req
    })

    return res.json({ success: true })
  } catch (error) {
    console.error('Delete super user error:', error)
    return res.status(400).json({ error: error.message || 'Failed to remove super admin privileges.', code: 'SUPER_USER_DELETE_FAILED' })
  }
})

router.put('/requests/:requestId/approve', async (req, res) => {
  try {
    await assertReAuth(req)

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: 'Invalid request selected.', code: 'INVALID_REQUEST_ID' })
    }

    const roleRequest = await RoleApprovalRequest.findById(requestId)
    if (!roleRequest || roleRequest.status !== 'pending') {
      return res.status(404).json({ error: 'Pending role request not found.', code: 'ROLE_REQUEST_NOT_FOUND' })
    }

    const targetAccount = await Account.findById(roleRequest.account)
    if (!targetAccount) {
      return res.status(404).json({ error: 'Target account not found.', code: 'ACCOUNT_NOT_FOUND' })
    }

    const approvedRole = sanitizeRole(req.body?.approvedRole || roleRequest.requestedRole, roleRequest.requestedRole)
    if (!LEARNING_ROLES.includes(approvedRole)) {
      return res.status(400).json({ error: 'Invalid approved role.', code: 'INVALID_APPROVED_ROLE' })
    }

    let organization = null
    if (roleRequest.organization && mongoose.Types.ObjectId.isValid(String(roleRequest.organization))) {
      organization = await Organization.findById(roleRequest.organization)
    }

    if (!organization) {
      const partnerType = roleRequest.partnerType || resolvePartnerTypeForIntent(roleRequest.registrationIntent)
      organization = await createPartnerOrganization({
        name: roleRequest.organizationName,
        partnerType,
        ownerId: targetAccount._id
      })
    }

    if (organization) {
      organization.partnerType = roleRequest.partnerType || organization.partnerType || 'partner'
      if (organization.partnerSettings) {
        organization.partnerSettings.partnerStatus = 'active'
      }
      await ensurePartnerMembership({
        account: targetAccount,
        organization,
        orgRole: roleToOrgRole(approvedRole),
        actingUserId: req.user._id
      })
    }

    targetAccount.learningRole = approvedRole
    targetAccount.isSuperAdmin = false
    targetAccount.isSystemAdmin = PLATFORM_ADMIN_ROLES.includes(approvedRole)
    targetAccount.roleMetadata = {
      previousLearningRole: approvedRole,
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await targetAccount.save()

    roleRequest.status = 'approved'
    roleRequest.reviewedBy = req.user._id
    roleRequest.reviewedAt = new Date()
    roleRequest.reviewNotes = String(req.body?.notes || '').trim().slice(0, 3000)
    if (organization?._id) {
      roleRequest.organization = organization._id
    }
    await roleRequest.save()

    await logAuditEvent({
      action: 'approval.request.approve',
      performedBy: req.user._id,
      targetAccount: targetAccount._id,
      targetOrganization: organization?._id || null,
      metadata: {
        requestId: roleRequest._id,
        approvedRole
      },
      req
    })

    return res.json({
      success: true,
      request: roleRequest,
      account: {
        id: targetAccount._id,
        email: targetAccount.email,
        role: resolveLearningRole(targetAccount)
      },
      organization: organization
        ? {
            id: organization._id,
            name: organization.name,
            partnerType: organization.partnerType
          }
        : null
    })
  } catch (error) {
    console.error('Approve role request error:', error)
    return res.status(400).json({ error: error.message || 'Failed to approve role request.', code: 'ROLE_REQUEST_APPROVE_FAILED' })
  }
})

router.put('/requests/:requestId/reject', async (req, res) => {
  try {
    await assertReAuth(req)

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: 'Invalid request selected.', code: 'INVALID_REQUEST_ID' })
    }

    const roleRequest = await RoleApprovalRequest.findById(requestId)
    if (!roleRequest || roleRequest.status !== 'pending') {
      return res.status(404).json({ error: 'Pending role request not found.', code: 'ROLE_REQUEST_NOT_FOUND' })
    }

    roleRequest.status = 'rejected'
    roleRequest.reviewedBy = req.user._id
    roleRequest.reviewedAt = new Date()
    roleRequest.reviewNotes = String(req.body?.notes || '').trim().slice(0, 3000)
    await roleRequest.save()

    await logAuditEvent({
      action: 'approval.request.reject',
      performedBy: req.user._id,
      targetAccount: roleRequest.account,
      targetOrganization: roleRequest.organization || null,
      metadata: {
        requestId: roleRequest._id,
        notes: roleRequest.reviewNotes
      },
      req
    })

    return res.json({ success: true, request: roleRequest })
  } catch (error) {
    console.error('Reject role request error:', error)
    return res.status(400).json({ error: error.message || 'Failed to reject role request.', code: 'ROLE_REQUEST_REJECT_FAILED' })
  }
})

export default router
