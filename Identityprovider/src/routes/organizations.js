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

const router = express.Router()

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
          joinedAt: new Date(),
          status: 'active'
        }]
      })

      // Update user's organizations array
      await Account.updateOne(
        { _id: req.user._id },
        {
          $push: {
            organizations: {
              organization: organization._id,
              role: 'owner',
              joinedAt: new Date(),
              isActive: true
            }
          },
          $set: { currentOrganization: organization._id }
        }
      )

      console.log('✅ Organization created:', organization.name, 'by', req.user.email)

      res.status(201).json({
        id: organization._id,
        name: organization.name,
        description: organization.description,
        memberCount: 1,
        role: 'owner'
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

      const organization = await Organization.findByIdAndUpdate(
        req.params.orgId,
        { $set: updates },
        { new: true }
      )

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

      // Remove organization from all members' accounts
      const memberIds = organization.members.map(m => m.account)
      await Account.updateMany(
        { _id: { $in: memberIds } },
        {
          $pull: { organizations: { organization: organization._id } },
          $unset: { currentOrganization: '' }
        }
      )

      // Delete the organization
      await Organization.findByIdAndDelete(req.params.orgId)

      console.log('✅ Organization deleted:', organization.name, 'by', req.user.email)

      res.json({ message: 'Organization deleted successfully' })
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
        { $set: { currentOrganization: req.params.orgId } }
      )

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
