import express from 'express'
import { Organization } from '../models/Organization.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin
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
        .populate('members.account', 'sub email profile.name emailVerified createdAt')
        .populate('members.invitedBy', 'email profile.name')
      await organization.save()

      const members = organization.members
        .filter(m => m.status === 'active')
        .map(m => ({
          departmentId: m.department || null,
          departmentName: organization.getDepartmentById(m.department)?.name || '',
          id: m.account._id,
          sub: m.account.sub,
          email: m.account.email,
          name: m.account.profile?.name,
          designation: m.designation || '',
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
        .populate('members.account', 'sub email profile.name emailVerified createdAt')
        .populate('members.invitedBy', 'email profile.name')
      await organization.save()

      const member = organization.members.find(
        m => m.account._id.toString() === req.params.memberId && m.status === 'active'
      )

      if (!member) {
        return res.status(404).json({ error: 'Member not found' })
      }

      res.json({
        departmentId: member.department || null,
        departmentName: organization.getDepartmentById(member.department)?.name || '',
        id: member.account._id,
        sub: member.account.sub,
        email: member.account.email,
        name: member.account.profile?.name,
        designation: member.designation || '',
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
 * Update member details
 * PUT /api/organizations/:orgId/members/:memberId
 * Requires admin or owner role
 */
router.put('/:orgId/members/:memberId',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const body = req.body || {}
      const hasRole = Object.prototype.hasOwnProperty.call(body, 'role')
      const hasDesignation = Object.prototype.hasOwnProperty.call(body, 'designation')
      const hasDepartment = Object.prototype.hasOwnProperty.call(body, 'department')
      const { role, designation, department } = body

      const canManageRole = ['owner', 'admin'].includes(req.memberRole)
      const canManageMemberMetadata = ['owner', 'admin', 'hr_manager'].includes(req.memberRole)

      if (!hasRole && !hasDesignation && !hasDepartment) {
        return res.status(400).json({ error: 'At least one of role, designation, or department is required' })
      }

      if (hasRole && !canManageRole) {
        return res.status(403).json({ error: 'Admin or owner role required to update role' })
      }

      if ((hasDesignation || hasDepartment) && !canManageMemberMetadata) {
        return res.status(403).json({ error: 'Admin, owner, or HR manager role required to update member details' })
      }

      if (hasRole) {
        const validRoles = ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']
        if (!validRoles.includes(role)) {
          return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
        }
      }

      if (hasRole && role === 'owner' && req.memberRole !== 'owner') {
        return res.status(403).json({ error: 'Only owner can assign owner role' })
      }

      try {
        if (hasRole) {
          await req.organization.updateMemberRole(req.params.memberId, role, req.user._id)
        }
        if (hasDesignation) {
          await req.organization.updateMemberDetails(
            req.params.memberId,
            { designation },
            req.user._id
          )
        }
        if (hasDepartment) {
          await req.organization.updateMemberDetails(
            req.params.memberId,
            { department },
            req.user._id
          )
        }
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('Member updated in', req.organization.name, 'by', req.user.email, {
        role: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined
      })

      res.json({
        message: 'Member updated successfully',
        memberId: req.params.memberId,
        newRole: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined,
        department: hasDepartment ? department || null : undefined
      })
    } catch (error) {
      console.error('Update member error:', error)
      res.status(500).json({ error: 'Failed to update member' })
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
      const isSelf = memberId === req.user._id.toString()

      const targetMember = req.organization.members.find(
        m => m.account.toString() === memberId && m.status === 'active'
      )

      if (!targetMember) {
        return res.status(404).json({ error: 'Member not found' })
      }

      if (targetMember.role === 'owner' && req.memberRole !== 'owner' && !isSelf) {
        return res.status(403).json({ error: 'Only owner can remove other owners' })
      }

      try {
        await req.organization.removeMember(memberId)
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('Member removed from', req.organization.name, 'by', req.user.email)

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

      console.log('User left organization:', req.organization.name, 'by', req.user.email)

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
