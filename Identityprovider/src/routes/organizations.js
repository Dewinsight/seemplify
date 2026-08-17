import express from 'express'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  requireOrganizationOwner,
  rateLimit
} from '../middleware/permissions.js'
import { requireAuthOrAPIToken, requireScopes } from '../middleware/apiAuth.js'
import { invalidateClaimsCache } from '../index.js'
import { subscriptionService } from '../services/subscriptionService.js'
import { deleteOrganizationCascade } from '../services/adminOrganizationManagementService.js'

const router = express.Router()

const requireOrganizationDepartmentManager = (req, res, next) => {
  if (!['owner', 'admin', 'hr_manager'].includes(req.memberRole)) {
    return res.status(403).json({ error: 'Admin, owner, or HR manager role required' })
  }
  next()
}

const serializeBranch = (branch) => ({
  id: branch._id,
  name: branch.name,
  code: branch.code || '',
  address: branch.address || '',
  city: branch.city || '',
  state: branch.state || '',
  country: branch.country || '',
  managerAccount: branch.managerAccount || null,
  isHeadOffice: !!branch.isHeadOffice
})

const invalidateOrganizationMemberClaims = async (organization) => {
  const memberAccountIds = (organization.members || []).map((member) => member.account).filter(Boolean)
  if (!memberAccountIds.length) return
  const accounts = await Account.find({ _id: { $in: memberAccountIds } }).select('sub').lean()
  accounts.forEach((account) => {
    if (account?.sub) invalidateClaimsCache(account.sub)
  })
}

// Helper: allow either session auth or API token with scopes for create
const requireOrgCreateAuth = [
  requireAuthOrAPIToken,
  (req, res, next) => {
    // If authenticated via API token, enforce scopes
    if (req.authMethod === 'token' || req.tokenPayload) {
      return requireScopes(['organizations:write'])(req, res, next)
    }
    // Session-authenticated users continue without scope check
    return next()
  }
]

/**
 * Create a new organization
 * POST /api/organizations
 * Any authenticated user can create an organization
 */
router.post('/',
  ...requireOrgCreateAuth,
  rateLimit({ keyPrefix: 'org-create', maxRequests: 10, windowMs: 24 * 60 * 60 * 1000 }), // 10 per day
  async (req, res) => {
    try {
      const { name, description } = req.body

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Organization name is required' })
      }

      if (name.length > 100) {
        return res.status(400).json({ error: 'Organization name must be 100 characters or less' })
      }

      // Create organization with current user as owner
      const organization = await Organization.create({
        name: name.trim(),
        description: description?.trim(),
        owner: req.user._id,
        members: [{
          account: req.user._id,
          role: 'owner',
          appAccess: {
            mode: 'all',
            appIds: []
          },
          joinedAt: new Date(),
          status: 'active'
        }]
      })

      let trialSubscription = null
      try {
        trialSubscription = await subscriptionService.assignDefaultTrialToOrganization(
          organization._id,
          req.user._id
        )
      } catch (trialError) {
        await Organization.findByIdAndDelete(organization._id).catch(() => {})
        throw trialError
      }

      // Update user's organizations array and set as current organization
      await Account.updateOne(
        { _id: req.user._id },
        {
          $push: {
            organizations: {
              organization: organization._id,
              role: 'owner',
              appAccess: {
                mode: 'all',
                appIds: []
              },
              joinedAt: new Date(),
              isActive: true
            }
          },
          $set: { 
            currentOrganization: organization._id,
            updatedAt: new Date() // Update timestamp for cache invalidation
          }
        }
      )

      // Invalidate claims cache for this user to ensure fresh organization context
      invalidateClaimsCache(req.user.sub)

      console.log('✅ Organization created:', organization.name, 'by', req.user.email)

      const trialWelcome = subscriptionService.buildDefaultTrialWelcomePayload({
        organizationName: organization.name,
        subscription: trialSubscription
      })

      res.status(201).json({
        id: organization._id,
        name: organization.name,
        description: organization.description,
        memberCount: 1,
        role: 'owner',
        assignedPlan: {
          id: trialSubscription?.plan?._id || null,
          name: trialSubscription?.plan?.name || null,
          slug: trialSubscription?.plan?.slug || null,
          isTrial: Boolean(trialSubscription?.plan?.isTrial),
          trialDays: trialSubscription?.plan?.trialDays || null,
          startDate: trialSubscription?.startDate || null,
          endDate: trialSubscription?.endDate || null
        },
        trialWelcome
      })
    } catch (error) {
      console.error('Create organization error:', error)
      res.status(500).json({ error: 'Failed to create organization' })
    }
  }
)

/**
 * Get user's organizations
 * GET /api/organizations
 * Accepts both session auth and Bearer token (for API calls from SmartHR)
 */
router.get('/', requireAuthOrAPIToken, async (req, res) => {
  try {
    const organizations = await Organization.find({
      'members.account': req.user._id,
      'members.status': 'active'
    })
      .populate('owner', 'email profile.name')
      .lean()

    const result = organizations.map(org => {
      const member = org.members.find(
        m => m.account.toString() === req.user._id.toString()
      )
      return {
        id: org._id,
        name: org.name,
        description: org.description,
        role: member?.role,
        memberCount: org.members.filter(m => m.status === 'active').length,
        joinedAt: member?.joinedAt,
        isCurrentOrganization: req.user.currentOrganization?.toString() === org._id.toString()
      }
    })

    res.json(result)
  } catch (error) {
    console.error('Get organizations error:', error)
    res.status(500).json({ error: 'Failed to get organizations' })
  }
})

/**
 * Get organization details
 * GET /api/organizations/:orgId
 * Accepts both session auth and Bearer token (for API calls from SmartHR)
 */
router.get('/:orgId',
  requireAuthOrAPIToken,
  requireOrganizationMember,
  async (req, res) => {
    try {
      await req.organization.save()
      const organization = await Organization.findById(req.params.orgId)
        .populate('owner', 'email profile.name')
        .populate('members.account', 'email profile.name')

      res.json({
        id: organization._id,
        name: organization.name,
        description: organization.description,
        owner: {
          id: organization.owner._id,
          email: organization.owner.email,
          name: organization.owner.profile?.name
        },
        settings: organization.settings,
        memberCount: organization.members.filter(m => m.status === 'active').length,
        yourRole: req.memberRole,
        createdAt: organization.createdAt
      })
    } catch (error) {
      console.error('Get organization error:', error)
      res.status(500).json({ error: 'Failed to get organization' })
    }
  }
)

router.get('/:orgId/departments',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      await req.organization.save()
      res.json({
        departments: (req.organization.departments || []).map((department) => ({
          id: department._id,
          name: department.name,
          description: department.description || '',
          parentDepartment: department.parentDepartment || null,
          headAccount: department.headAccount || null,
          isSystem: !!department.isSystem
        }))
      })
    } catch (error) {
      console.error('Get departments error:', error)
      res.status(500).json({ error: 'Failed to get departments' })
    }
  }
)

router.post('/:orgId/departments',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationDepartmentManager,
  async (req, res) => {
    try {
      const department = await req.organization.addDepartment(req.body || {}, req.user._id)
      res.status(201).json({
        id: department._id,
        name: department.name,
        description: department.description || '',
        parentDepartment: department.parentDepartment || null,
        headAccount: department.headAccount || null
      })
    } catch (error) {
      console.error('Create department error:', error)
      res.status(400).json({ error: error.message || 'Failed to create department' })
    }
  }
)

router.put('/:orgId/departments/:departmentId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationDepartmentManager,
  async (req, res) => {
    try {
      const department = await req.organization.updateDepartment(req.params.departmentId, req.body || {})
      res.json({
        id: department._id,
        name: department.name,
        description: department.description || '',
        parentDepartment: department.parentDepartment || null,
        headAccount: department.headAccount || null
      })
    } catch (error) {
      console.error('Update department error:', error)
      res.status(400).json({ error: error.message || 'Failed to update department' })
    }
  }
)

router.get('/:orgId/branches',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      res.json({ branches: (req.organization.branches || []).map(serializeBranch) })
    } catch (error) {
      console.error('Get branches error:', error)
      res.status(500).json({ error: 'Failed to get branches' })
    }
  }
)

router.post('/:orgId/branches',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationDepartmentManager,
  async (req, res) => {
    try {
      const branch = await req.organization.addBranch(req.body || {})
      await invalidateOrganizationMemberClaims(req.organization)
      res.status(201).json(serializeBranch(branch))
    } catch (error) {
      console.error('Create branch error:', error)
      res.status(400).json({ error: error.message || 'Failed to create branch' })
    }
  }
)

router.put('/:orgId/branches/:branchId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationDepartmentManager,
  async (req, res) => {
    try {
      const branch = await req.organization.updateBranch(req.params.branchId, req.body || {})
      await invalidateOrganizationMemberClaims(req.organization)
      res.json(serializeBranch(branch))
    } catch (error) {
      console.error('Update branch error:', error)
      res.status(400).json({ error: error.message || 'Failed to update branch' })
    }
  }
)

router.delete('/:orgId/branches/:branchId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationDepartmentManager,
  async (req, res) => {
    try {
      await req.organization.removeBranch(req.params.branchId)
      await invalidateOrganizationMemberClaims(req.organization)
      res.json({ message: 'Branch deleted successfully' })
    } catch (error) {
      console.error('Delete branch error:', error)
      res.status(400).json({ error: error.message || 'Failed to delete branch' })
    }
  }
)

/**
 * Update organization
 * PUT /api/organizations/:orgId
 * Requires admin or owner role
 */
router.put('/:orgId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      const { name, description, settings } = req.body

      const updates = {}
      if (name !== undefined) {
        if (name.trim().length === 0) {
          return res.status(400).json({ error: 'Organization name cannot be empty' })
        }
        if (name.length > 100) {
          return res.status(400).json({ error: 'Organization name must be 100 characters or less' })
        }
        updates.name = name.trim()
      }
      if (description !== undefined) {
        updates.description = description?.trim()
      }
      if (settings !== undefined) {
        updates.settings = {
          ...req.organization.settings,
          ...settings
        }
      }

      const organization = req.organization

      if (updates.name !== undefined) {
        organization.name = updates.name
      }
      if (updates.description !== undefined) {
        organization.description = updates.description
      }
      if (updates.settings !== undefined) {
        organization.settings = updates.settings
      }

      await organization.save()

      const memberAccountIds = Array.isArray(organization.members)
        ? organization.members.map(member => member.account).filter(Boolean)
        : []

      if (memberAccountIds.length > 0) {
        const memberAccounts = await Account.find({ _id: { $in: memberAccountIds } })
          .select('sub')
          .lean()

        memberAccounts.forEach((account) => {
          if (account?.sub) {
            invalidateClaimsCache(account.sub)
          }
        })
      }

      console.log('✅ Organization updated:', organization.name, 'by', req.user.email)

      res.json({
        id: organization._id,
        name: organization.name,
        description: organization.description,
        settings: organization.settings
      })
    } catch (error) {
      console.error('Update organization error:', error)
      res.status(500).json({ error: 'Failed to update organization' })
    }
  }
)

/**
 * Delete organization
 * DELETE /api/organizations/:orgId
 * Requires owner role
 */
router.delete('/:orgId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationOwner,
  async (req, res) => {
    try {
      const organization = req.organization
      const result = await deleteOrganizationCascade(organization, { deletedBy: req.user._id })
      await invalidateOrganizationMemberClaims(organization)
      const currentUserFallback = (result.fallbackAssignments || []).find(
        assignment => assignment.accountId === req.user._id.toString()
      )?.currentOrganization || null

      if (req.session) {
        req.session.currentOrganization = currentUserFallback
      }

      const fallbackOrganization = currentUserFallback
        ? await Organization.findById(currentUserFallback).select('name').lean()
        : null

      console.log('✅ Organization deleted:', organization.name, 'by', req.user.email)

      res.json({
        message: 'Organization deleted successfully',
        currentOrganization: fallbackOrganization
          ? { id: fallbackOrganization._id, name: fallbackOrganization.name }
          : null
      })
    } catch (error) {
      console.error('Delete organization error:', error)
      res.status(500).json({ error: 'Failed to delete organization' })
    }
  }
)

/**
 * Switch current organization
 * POST /api/organizations/:orgId/switch
 */
router.post('/:orgId/switch',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      await Account.updateOne(
        { _id: req.user._id },
        { 
          $set: { 
            currentOrganization: req.params.orgId,
            updatedAt: new Date() // Update timestamp for cache invalidation
          } 
        }
      )

      // Invalidate claims cache for this user to ensure fresh organization context
      invalidateClaimsCache(req.user.sub)

      console.log('✅ Switched to organization:', req.organization.name, 'by', req.user.email)

      res.json({
        message: 'Switched organization successfully',
        currentOrganization: {
          id: req.organization._id,
          name: req.organization.name
        }
      })
    } catch (error) {
      console.error('Switch organization error:', error)
      res.status(500).json({ error: 'Failed to switch organization' })
    }
  }
)

/**
 * Transfer ownership
 * POST /api/organizations/:orgId/transfer-ownership
 * Requires owner role
 */
router.post('/:orgId/transfer-ownership',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationOwner,
  async (req, res) => {
    try {
      const { newOwnerId } = req.body

      if (!newOwnerId) {
        return res.status(400).json({ error: 'New owner ID is required' })
      }

      await req.organization.transferOwnership(newOwnerId, req.user._id)

      console.log('✅ Ownership transferred in', req.organization.name, 'by', req.user.email)

      res.json({
        message: 'Ownership transferred successfully',
        newOwnerId
      })
    } catch (error) {
      console.error('Transfer ownership error:', error)
      res.status(400).json({ error: error.message })
    }
  }
)

export default router
