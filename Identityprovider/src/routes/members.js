import express from 'express'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  requireOrganizationOwner
} from '../middleware/permissions.js'
import { requireAuthOrAPIToken } from '../middleware/apiAuth.js'

const router = express.Router()

/**
 * Get organization members
 * GET /api/organizations/:orgId/members
 * Accepts both session auth and Bearer token (for API calls from SmartHR)
 */
router.get('/:orgId/members',
  requireAuthOrAPIToken,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const organization = await Organization.findById(req.params.orgId)
        .populate('members.account', 'email profile.name emailVerified createdAt')
        .populate('members.invitedBy', 'email profile.name')

      const members = organization.members
        .filter(m => m.status === 'active')
        .map(m => ({
          id: m.account._id,
          email: m.account.email,
          name: m.account.profile?.name,
          emailVerified: m.account.emailVerified,
          role: m.role,
          joinedAt: m.joinedAt,
          invitedBy: m.invitedBy ? {
            email: m.invitedBy.email,
            name: m.invitedBy.profile?.name
          } : null,
          isOwner: m.account._id.toString() === organization.owner.toString()
        }))
        .sort((a, b) => {
          // Sort by role priority: owner > admin > hr_manager > recruiter > interviewer > staff
          const rolePriority = { owner: 0, admin: 1, hr_manager: 2, recruiter: 3, interviewer: 4, staff: 5 }
          return (rolePriority[a.role] || 6) - (rolePriority[b.role] || 6)
        })

      res.json({
        organizationId: organization._id,
        organizationName: organization.name,
        memberCount: members.length,
        ownerCount: organization.getOwnerCount(),
        yourRole: req.memberRole,
        members
      })
    } catch (error) {
      console.error('Get members error:', error)
      res.status(500).json({ error: 'Failed to get members' })
    }
  }
)

/**
 * Get single member details
 * GET /api/organizations/:orgId/members/:memberId
 * Accepts both session auth and Bearer token (for API calls from SmartHR)
 */
router.get('/:orgId/members/:memberId',
  requireAuthOrAPIToken,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const organization = await Organization.findById(req.params.orgId)
        .populate('members.account', 'email profile.name emailVerified createdAt')
        .populate('members.invitedBy', 'email profile.name')

      const member = organization.members.find(
        m => m.account._id.toString() === req.params.memberId && m.status === 'active'
      )

      if (!member) {
        return res.status(404).json({ error: 'Member not found' })
      }

      res.json({
        id: member.account._id,
        email: member.account.email,
        name: member.account.profile?.name,
        emailVerified: member.account.emailVerified,
        role: member.role,
        joinedAt: member.joinedAt,
        invitedBy: member.invitedBy ? {
          email: member.invitedBy.email,
          name: member.invitedBy.profile?.name
        } : null,
        isOwner: member.account._id.toString() === organization.owner.toString(),
        accountCreatedAt: member.account.createdAt
      })
    } catch (error) {
      console.error('Get member error:', error)
      res.status(500).json({ error: 'Failed to get member' })
    }
  }
)

/**
 * Update member role
 * PUT /api/organizations/:orgId/members/:memberId
 * Requires admin or owner role
 */
router.put('/:orgId/members/:memberId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      const { role } = req.body

      if (!role) {
        return res.status(400).json({ error: 'Role is required' })
      }

      const validRoles = ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
      }

      // Only owner can assign owner role
      if (role === 'owner' && req.memberRole !== 'owner') {
        return res.status(403).json({ error: 'Only owner can assign owner role' })
      }

      try {
        await req.organization.updateMemberRole(req.params.memberId, role, req.user._id)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('✅ Member role updated to', role, 'in', req.organization.name, 'by', req.user.email)

      res.json({
        message: 'Member role updated successfully',
        memberId: req.params.memberId,
        newRole: role
      })
    } catch (error) {
      console.error('Update member role error:', error)
      res.status(500).json({ error: 'Failed to update member role' })
    }
  }
)

/**
 * Remove member from organization
 * DELETE /api/organizations/:orgId/members/:memberId
 * Requires admin or owner role
 */
router.delete('/:orgId/members/:memberId',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      const memberId = req.params.memberId

      // Users can remove themselves
      const isSelf = memberId === req.user._id.toString()

      // Get target member
      const targetMember = req.organization.members.find(
        m => m.account.toString() === memberId && m.status === 'active'
      )

      if (!targetMember) {
        return res.status(404).json({ error: 'Member not found' })
      }

      // Only owner can remove other owners
      if (targetMember.role === 'owner' && req.memberRole !== 'owner' && !isSelf) {
        return res.status(403).json({ error: 'Only owner can remove other owners' })
      }

      try {
        await req.organization.removeMember(memberId)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('✅ Member removed from', req.organization.name, 'by', req.user.email)

      res.json({
        message: 'Member removed successfully',
        memberId
      })
    } catch (error) {
      console.error('Remove member error:', error)
      res.status(500).json({ error: 'Failed to remove member' })
    }
  }
)

/**
 * Leave organization (self-removal)
 * POST /api/organizations/:orgId/leave
 */
router.post('/:orgId/leave',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const memberId = req.user._id.toString()
      const member = req.organization.members.find(
        m => m.account.toString() === memberId && m.status === 'active'
      )

      if (!member) {
        return res.status(404).json({ error: 'You are not a member of this organization' })
      }

      // Check if user is the last owner
      if (member.role === 'owner' && req.organization.getOwnerCount() === 1) {
        return res.status(400).json({
          error: 'Cannot leave as the last owner. Transfer ownership first or delete the organization.'
        })
      }

      try {
        await req.organization.removeMember(memberId)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('✅ User left organization:', req.organization.name, 'by', req.user.email)

      res.json({
        message: 'Successfully left the organization',
        organizationId: req.organization._id
      })
    } catch (error) {
      console.error('Leave organization error:', error)
      res.status(500).json({ error: 'Failed to leave organization' })
    }
  }
)

export default router
