import express from 'express'
import { Team } from '../models/Team.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import { getDerivedManagerInfo, hasLineManagerRole } from '../utils/teamManager.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  requireTeamMember,
  requireTeamAdminOrManager
} from '../middleware/permissions.js'
import webhookService from '../services/webhookService.js'

const router = express.Router()

async function findCrossDepartmentTeamMembership(organizationId, accountId, departmentId, excludedTeamId = null) {
  if (!departmentId) return null

  const query = {
    organization: organizationId,
    department: { $ne: departmentId },
    members: {
      $elemMatch: {
        account: accountId,
        status: 'active'
      }
    }
  }

  if (excludedTeamId) {
    query._id = { $ne: excludedTeamId }
  }

  return Team.findOne(query).select('name department').lean()
}

/**
 * Get teams for an organization
 * GET /api/organizations/:orgId/teams
 */
router.get('/organizations/:orgId/teams',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      await req.organization.save()
      const { tree } = req.query

      if (tree === 'true') {
        // Return tree structure
        const teamTree = await Team.buildTeamTree(req.params.orgId)
        return res.json(teamTree)
      }

      // Return flat list
      const teams = await Team.find({ organization: req.params.orgId })
        .populate('manager', 'email profile.name')
        .populate('members.account', 'email profile.name')
        .populate('parentTeam', 'name')
        .sort({ name: 1 })

      res.json(teams.map(team => ({
        id: team._id,
        name: team.name,
        description: team.description,
        department: team.department ? {
          id: team.department,
          name: req.organization.getDepartmentById(team.department)?.name || 'General'
        } : null,
        parentTeam: team.parentTeam ? {
          id: team.parentTeam._id,
          name: team.parentTeam.name
        } : null,
        manager: getDerivedManagerInfo(team),
        memberCount: team.memberCount,
        createdAt: team.createdAt
      })))
    } catch (error) {
      console.error('Get teams error:', error)
      res.status(500).json({ error: 'Failed to get teams' })
    }
  }
)

/**
 * Create team
 * POST /api/organizations/:orgId/teams
 * Requires admin or owner role
 */
router.post('/organizations/:orgId/teams',
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin,
  async (req, res) => {
    try {
      await req.organization.save()
      const { name, description, parentTeamId, departmentId } = req.body

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Team name is required' })
      }

      if (name.length > 100) {
        return res.status(400).json({ error: 'Team name must be 100 characters or less' })
      }

      if (!departmentId) {
        return res.status(400).json({ error: 'Department is required' })
      }

      const department = req.organization.getDepartmentById(departmentId)
      if (!department) {
        return res.status(400).json({ error: 'Invalid department' })
      }

      // Verify parent team belongs to same organization
      if (parentTeamId) {
        const parentTeam = await Team.findById(parentTeamId)
        if (!parentTeam || parentTeam.organization.toString() !== req.params.orgId) {
          return res.status(400).json({ error: 'Invalid parent team' })
        }
        if (parentTeam.department?.toString() !== departmentId.toString()) {
          return res.status(400).json({ error: 'Parent team must belong to the same department' })
        }
      }

      const team = await Team.create({
        organization: req.params.orgId,
        name: name.trim(),
        description: description?.trim(),
        department: departmentId,
        parentTeam: parentTeamId || null,
        manager: null,
        members: []
      })

      console.log('✅ Team created:', team.name, 'in', req.organization.name, 'by', req.user.email)

      res.status(201).json({
        id: team._id,
        name: team.name,
        description: team.description,
        departmentId: team.department,
        parentTeamId: team.parentTeam,
        message: 'Team created successfully'
      })
    } catch (error) {
      console.error('Create team error:', error)
      res.status(500).json({ error: 'Failed to create team' })
    }
  }
)

/**
 * Get team details
 * GET /api/teams/:teamId
 */
router.get('/:teamId',
  requireAuth,
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.teamId)
        .populate('organization', 'name')
        .populate('manager', 'email profile.name')
        .populate('members.account', 'email profile.name')
        .populate('parentTeam', 'name')

      if (!team) {
        return res.status(404).json({ error: 'Team not found' })
      }

      // Verify user is member of organization
      const organization = await Organization.findById(team.organization._id)
      await organization.save()
      if (!organization.isMember(req.user._id)) {
        return res.status(403).json({ error: 'Not a member of this organization' })
      }

      // Get hierarchy path
      const hierarchyPath = await team.getHierarchyPath()

      // Get sub-teams
      const subTeams = await Team.find({ parentTeam: team._id })
        .select('name memberCount')

      res.json({
        id: team._id,
        name: team.name,
        description: team.description,
        department: team.department ? {
          id: team.department,
          name: organization.getDepartmentById(team.department)?.name || 'General'
        } : null,
        organization: {
          id: team.organization._id,
          name: team.organization.name
        },
        parentTeam: team.parentTeam ? {
          id: team.parentTeam._id,
          name: team.parentTeam.name
        } : null,
        hierarchyPath,
        manager: getDerivedManagerInfo(team),
        members: team.members
          .filter(m => m.status === 'active')
          .map(m => ({
            id: m.account._id,
            email: m.account.email,
            name: m.account.profile?.name,
            role: m.role,
            joinedAt: m.joinedAt,
            isManager: m.role === 'line_manager'
          })),
        subTeams: subTeams.map(st => ({
          id: st._id,
          name: st.name,
          memberCount: st.memberCount
        })),
        memberCount: team.memberCount,
        createdAt: team.createdAt
      })
    } catch (error) {
      console.error('Get team error:', error)
      res.status(500).json({ error: 'Failed to get team' })
    }
  }
)

/**
 * Update team
 * PUT /api/teams/:teamId
 * Requires org admin or team manager (with line_manager role)
 */
router.put('/:teamId',
  requireAuth,
  requireTeamAdminOrManager,
  async (req, res) => {
    try {
      await req.organization.save()
      const { name, description, parentTeamId, departmentId } = req.body

      const updates = {}
      if (name !== undefined) {
        if (name.trim().length === 0) {
          return res.status(400).json({ error: 'Team name cannot be empty' })
        }
        if (name.length > 100) {
          return res.status(400).json({ error: 'Team name must be 100 characters or less' })
        }
        updates.name = name.trim()
      }
      if (description !== undefined) {
        updates.description = description?.trim()
      }
      if (departmentId !== undefined) {
        if (!departmentId) {
          return res.status(400).json({ error: 'Department is required' })
        }
        const department = req.organization.getDepartmentById(departmentId)
        if (!department) {
          return res.status(400).json({ error: 'Invalid department' })
        }

        const activeMemberIds = req.team.members
          .filter(member => member.status === 'active')
          .map(member => member.account.toString())

        for (const memberId of activeMemberIds) {
          const conflictingTeam = await findCrossDepartmentTeamMembership(
            req.team.organization,
            memberId,
            departmentId,
            req.team._id
          )

          if (conflictingTeam) {
            return res.status(400).json({
              error: 'Cannot move this team to another department while members belong to teams in a different department'
            })
          }
        }

        updates.department = departmentId
      }
      if (parentTeamId !== undefined) {
        // Verify parent team belongs to same organization
        if (parentTeamId) {
          const parentTeam = await Team.findById(parentTeamId)
          if (!parentTeam || parentTeam.organization.toString() !== req.team.organization.toString()) {
            return res.status(400).json({ error: 'Invalid parent team' })
          }
          const effectiveDepartmentId = (updates.department || req.team.department || '').toString()
          if (parentTeam.department?.toString() !== effectiveDepartmentId) {
            return res.status(400).json({ error: 'Parent team must belong to the same department' })
          }
          // Prevent circular reference
          if (parentTeamId === req.team._id.toString()) {
            return res.status(400).json({ error: 'Team cannot be its own parent' })
          }
        }
        updates.parentTeam = parentTeamId || null
      }

      const team = await Team.findByIdAndUpdate(
        req.params.teamId,
        { $set: updates },
        { new: true }
      )

      if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
        const activeMemberIds = req.team.members
          .filter(member => member.status === 'active')
          .map(member => member.account.toString())

        await Account.updateMany(
          { 'teams.team': team._id },
          { $set: { 'teams.$[membership].department': team.department || null } },
          { arrayFilters: [{ 'membership.team': team._id }] }
        )

        await req.organization.syncMemberDepartmentsFromTeams(activeMemberIds)
      }

      console.log('✅ Team updated:', team.name, 'by', req.user.email)

      res.json({
        id: team._id,
        name: team.name,
        description: team.description,
        departmentId: team.department,
        parentTeamId: team.parentTeam
      })
    } catch (error) {
      console.error('Update team error:', error)
      res.status(500).json({ error: 'Failed to update team' })
    }
  }
)

/**
 * Delete team
 * DELETE /api/teams/:teamId
 * Requires org admin
 */
router.delete('/:teamId',
  requireAuth,
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.teamId)
      if (!team) {
        return res.status(404).json({ error: 'Team not found' })
      }

      // Verify org admin
      const organization = await Organization.findById(team.organization)
      await organization.save()
      const member = organization.members.find(
        m => m.account.toString() === req.user._id.toString() && m.status === 'active'
      )

      if (!member || !['owner', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Organization admin or owner role required' })
      }

      // Check for sub-teams
      const subTeams = await Team.find({ parentTeam: team._id })
      if (subTeams.length > 0) {
        return res.status(400).json({
          error: 'Cannot delete team with sub-teams. Delete or reassign sub-teams first.'
        })
      }

      // Remove team from all members' accounts
      const memberIds = team.members.map(m => m.account)
      await Account.updateMany(
        { _id: { $in: memberIds } },
        { $pull: { teams: { team: team._id } } }
      )

      await Team.findByIdAndDelete(req.params.teamId)
      await organization.syncMemberDepartmentsFromTeams(memberIds)

      console.log('✅ Team deleted:', team.name, 'by', req.user.email)

      res.json({ message: 'Team deleted successfully' })
    } catch (error) {
      console.error('Delete team error:', error)
      res.status(500).json({ error: 'Failed to delete team' })
    }
  }
)

/**
 * Add member to team
 * POST /api/teams/:teamId/members
 * Requires org admin or team manager
 */
router.post('/:teamId/members',
  requireAuth,
  requireTeamAdminOrManager,
  async (req, res) => {
    try {
      const { accountId, role = 'member' } = req.body

      if (!accountId) {
        return res.status(400).json({ error: 'Account ID is required' })
      }

      // Validate role
      const validRoles = ['member', 'line_manager', 'team_lead']
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
      }

      // Verify account exists and is member of organization
      const account = await Account.findById(accountId)
      if (!account) {
        return res.status(404).json({ error: 'Account not found' })
      }

      if (!req.organization.isMember(accountId)) {
        return res.status(400).json({ error: 'Account must be a member of the organization' })
      }

      const orgMember = req.organization.members.find(
        m => m.account.toString() === accountId.toString() && m.status === 'active'
      )
      if (!orgMember) {
        return res.status(400).json({ error: 'Account must be an active member of the organization' })
      }

      const conflictingTeam = await findCrossDepartmentTeamMembership(
        req.team.organization,
        accountId,
        req.team.department,
        req.team._id
      )

      if (conflictingTeam) {
        return res.status(400).json({ error: 'Member already belongs to a team in a different department' })
      }

      await req.team.addMember(accountId, role)

      console.log('✅ Member added to team:', req.team.name, 'by', req.user.email)

      // Send webhook notification for team member addition
      const teamData = {
        id: req.team._id.toString(),
        name: req.team.name,
        role: role
      }
      webhookService.notifyTeamMemberAdded(
        account.sub,
        req.team._id.toString(),
        teamData,
        req.team.organization.toString()
      ).catch(err => console.error('Webhook notification failed:', err))

      res.status(201).json({
        message: 'Member added to team successfully',
        memberId: accountId,
        role
      })
    } catch (error) {
      console.error('Add team member error:', error)
      const isValidationError = String(error?.message || '').includes('line manager')
      res.status(isValidationError ? 400 : 500).json({ error: error?.message || 'Failed to add member to team' })
    }
  }
)

/**
 * Remove member from team
 * DELETE /api/teams/:teamId/members/:memberId
 * Requires org admin or team manager
 */
router.delete('/:teamId/members/:memberId',
  requireAuth,
  requireTeamAdminOrManager,
  async (req, res) => {
    try {
      const { memberId } = req.params

      if (!req.team.isMember(memberId)) {
        return res.status(404).json({ error: 'Member not found in team' })
      }

      await req.team.removeMember(memberId)

      console.log('✅ Member removed from team:', req.team.name, 'by', req.user.email)

      // Send webhook notification for team member removal
      const removedAccount = await Account.findById(memberId).select('sub').lean()
      webhookService.notifyTeamMemberRemoved(
        removedAccount?.sub || memberId,
        req.team._id.toString(),
        req.team.organization.toString()
      ).catch(err => console.error('Webhook notification failed:', err))

      res.json({
        message: 'Member removed from team successfully',
        memberId
      })
    } catch (error) {
      console.error('Remove team member error:', error)
      res.status(500).json({ error: 'Failed to remove member from team' })
    }
  }
)

/**
 * Update team member role
 * PUT /api/teams/:teamId/members/:memberId
 * Requires org admin or team manager
 */
router.put('/:teamId/members/:memberId',
  requireAuth,
  requireTeamAdminOrManager,
  async (req, res) => {
    try {
      const { memberId } = req.params
      const { role } = req.body

      if (!role) {
        return res.status(400).json({ error: 'Role is required' })
      }

      const validRoles = ['member', 'line_manager', 'team_lead']
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
      }

      if (!req.team.isMember(memberId)) {
        return res.status(404).json({ error: 'Member not found in team' })
      }

      // Get old role before updating
      const member = req.team.members.find(m => m.account.toString() === memberId)
      const oldRole = member?.role || 'member'

      await req.team.updateMemberRole(memberId, role)

      console.log('✅ Team member role updated to', role, 'in', req.team.name, 'by', req.user.email)

      // Send webhook notification for role change
      const targetAccount = await Account.findById(memberId).select('sub').lean()
      webhookService.notifyTeamRoleChanged(
        targetAccount?.sub || memberId,
        req.team._id.toString(),
        oldRole,
        role,
        req.team.organization.toString()
      ).catch(err => console.error('Webhook notification failed:', err))

      res.json({
        message: 'Team member role updated successfully',
        memberId,
        newRole: role
      })
    } catch (error) {
      console.error('Update team member role error:', error)
      const isValidationError = String(error?.message || '').includes('line manager')
      res.status(isValidationError ? 400 : 500).json({ error: error?.message || 'Failed to update team member role' })
    }
  }
)

/**
 * Team manager is derived from the member with the line_manager role.
 * Manual manager assignment is deprecated.
 */
router.post('/:teamId/manager',
  requireAuth,
  async (req, res) => {
    return res.status(410).json({
      error: 'Team manager is derived from the member with the line_manager role'
    })

    // Team manager is derived from the line_manager role.

      console.log('✅ Team manager set for', team.name, 'by', req.user.email)
  }
)

/**
 * Get team hierarchy (all sub-teams)
 * GET /api/teams/:teamId/hierarchy
 */
router.get('/:teamId/hierarchy',
  requireAuth,
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.teamId)
        .populate('organization', 'name')

      if (!team) {
        return res.status(404).json({ error: 'Team not found' })
      }

      // Verify org membership
      const organization = await Organization.findById(team.organization._id)
      if (!organization.isMember(req.user._id)) {
        return res.status(403).json({ error: 'Not a member of this organization' })
      }

      const descendants = await team.getAllDescendantTeams()
      const hierarchyPath = await team.getHierarchyPath()

      res.json({
        team: {
          id: team._id,
          name: team.name,
          hierarchyPath
        },
        subTeams: descendants.map(t => ({
          id: t._id,
          name: t.name,
          parentTeamId: t.parentTeam,
          memberCount: t.memberCount
        }))
      })
    } catch (error) {
      console.error('Get team hierarchy error:', error)
      res.status(500).json({ error: 'Failed to get team hierarchy' })
    }
  }
)

/**
 * Get direct reports (team members + sub-team members)
 * GET /api/teams/:teamId/reports
 * Requires team manager (with line_manager role)
 */
router.get('/:teamId/reports',
  requireAuth,
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.teamId)
        .populate('organization', 'name')

      if (!team) {
        return res.status(404).json({ error: 'Team not found' })
      }

      if (!hasLineManagerRole(team, req.user._id)) {
        return res.status(403).json({ error: 'Line manager role required' })
      }

      const reportIds = await team.getDirectReports()
      const reports = await Account.find({
        _id: { $in: reportIds }
      }).select('email profile.name')

      res.json({
        teamId: team._id,
        teamName: team.name,
        directReports: reports.map(r => ({
          id: r._id,
          email: r.email,
          name: r.profile?.name
        })),
        totalReports: reports.length
      })
    } catch (error) {
      console.error('Get direct reports error:', error)
      res.status(500).json({ error: 'Failed to get direct reports' })
    }
  }
)

export default router
