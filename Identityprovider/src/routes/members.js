import express from 'express'
import { Organization } from '../models/Organization.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import { Team } from '../models/Team.js'
import { getHubApps } from '../config/hubApps.js'
import {
  APP_ACCESS_MODE_SELECTED,
  buildValidAppIdSet,
  normalizeAppAccess
} from '../utils/appAccess.js'
import { buildMemberStructureMap, getMemberStructure } from '../utils/memberStructure.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { buildOnboardingStateMap, getMemberOnboardingState } from '../utils/onboardingStatus.js'
import { buildPayrollProfileSyncData } from '../utils/profileCompletion.js'
import {
  requireAuth,
  requireOrganizationMember,
  requireOrganizationAdmin
} from '../middleware/permissions.js'
import { requireAuthOrAPIToken } from '../middleware/apiAuth.js'

const router = express.Router()

function getHubAppMetadata() {
  const apps = getHubApps().map(app => ({
    appId: app.appId,
    name: app.name
  }))

  return {
    apps,
    appIdSet: buildValidAppIdSet(apps),
    appNameById: new Map(apps.map(app => [app.appId, app.name]))
  }
}

function normalizeEmployeeId(value = '') {
  return String(value || '').trim()
}

function getEmployeeIdKey(value = '') {
  return normalizeEmployeeId(value).toLowerCase()
}

async function hasPendingInviteWithEmployeeId(organizationId, employeeId) {
  const employeeIdKey = getEmployeeIdKey(employeeId)
  if (!employeeIdKey) return false

  const pendingInvites = await OrganizationInvite.find({
    organization: organizationId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).select('employeeId')

  return pendingInvites.some((invite) => getEmployeeIdKey(invite.employeeId) === employeeIdKey)
}

function getMemberAppAccessSummary(member, appNameById = new Map(), validAppIds = null) {
  const appAccess = normalizeAppAccess(member?.appAccess, validAppIds)
  if (appAccess.mode !== APP_ACCESS_MODE_SELECTED) {
    return {
      appAccess,
      appAccessLabel: 'All apps',
      appAccessAppNames: []
    }
  }

  const appAccessAppNames = appAccess.appIds.map(appId => appNameById.get(appId) || appId)
  return {
    appAccess,
    appAccessLabel: appAccessAppNames.length > 0 ? `${appAccessAppNames.length} selected` : 'Selected apps',
    appAccessAppNames
  }
}

function matchesMemberIdentity(memberAccount, requestedId) {
  if (!memberAccount) return false
  return memberAccount._id.toString() === requestedId || memberAccount.sub === requestedId
}

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
      const { appIdSet, appNameById } = getHubAppMetadata()
      const teams = await Team.find({ organization: req.params.orgId })
        .select('name department members.account members.status')
        .lean()
      const onboardingAssignments = await OnboardingAssignment.find({
        organization: req.params.orgId,
        workflowType: 'onboarding'
      })
        .select('member status workflowType updatedAt createdAt completedAt')
        .sort({ updatedAt: -1 })
        .lean()
      const memberStructure = buildMemberStructureMap(organization, teams)
      const onboardingStateByMember = buildOnboardingStateMap({
        members: organization.members.filter(m => m.status === 'active'),
        assignments: onboardingAssignments,
        workflowType: 'onboarding'
      })

      const members = organization.members
        .filter(m => m.status === 'active')
        .map((m) => {
          const structure = getMemberStructure(memberStructure, m.account._id, organization)
          const onboardingState = getMemberOnboardingState(m.account._id, onboardingStateByMember)
          return {
            departmentId: structure.departmentId,
            departmentName: structure.departmentName,
            teamIds: structure.teamIds,
            teamNames: structure.teamNames,
            id: m.account._id,
            sub: m.account.sub,
            email: m.account.email,
            name: m.account.profile?.name,
            designation: m.designation || '',
            employeeId: m.employeeId || '',
            emailVerified: m.account.emailVerified,
            role: m.role,
            joinedAt: m.joinedAt,
            invitedBy: m.invitedBy ? {
              email: m.invitedBy.email,
              name: m.invitedBy.profile?.name
            } : null,
            isOwner: m.account._id.toString() === organization.owner.toString(),
            onboardingStatus: onboardingState.status,
            onboardingStatusSource: onboardingState.source,
            onboardingLatestAssignmentId: onboardingState.latestAssignment?._id || null,
            ...getMemberAppAccessSummary(m, appNameById, appIdSet)
          }
        })
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
      const { appIdSet, appNameById } = getHubAppMetadata()
      const teams = await Team.find({
        organization: req.params.orgId,
        'members.account': req.params.memberId,
        'members.status': 'active'
      })
        .select('name department members.account members.status')
        .lean()
      const onboardingAssignments = await OnboardingAssignment.find({
        organization: req.params.orgId,
        member: req.params.memberId,
        workflowType: 'onboarding'
      })
        .select('member status workflowType updatedAt createdAt completedAt')
        .sort({ updatedAt: -1 })
        .lean()

      const member = organization.members.find(
        m => matchesMemberIdentity(m.account, req.params.memberId) && m.status === 'active'
      )

      if (!member) {
        return res.status(404).json({ error: 'Member not found' })
      }

      const structure = getMemberStructure(buildMemberStructureMap(organization, teams), member.account._id, organization)
      const onboardingStateByMember = buildOnboardingStateMap({
        members: [member],
        assignments: onboardingAssignments,
        workflowType: 'onboarding'
      })
      const onboardingState = getMemberOnboardingState(member.account._id, onboardingStateByMember)

      res.json({
        departmentId: structure.departmentId,
        departmentName: structure.departmentName,
        teamIds: structure.teamIds,
        teamNames: structure.teamNames,
        id: member.account._id,
        sub: member.account.sub,
        email: member.account.email,
        name: member.account.profile?.name,
        designation: member.designation || '',
        employeeId: member.employeeId || '',
        emailVerified: member.account.emailVerified,
        role: member.role,
        joinedAt: member.joinedAt,
        invitedBy: member.invitedBy ? {
          email: member.invitedBy.email,
          name: member.invitedBy.profile?.name
        } : null,
        isOwner: member.account._id.toString() === organization.owner.toString(),
        accountCreatedAt: member.account.createdAt,
        onboardingStatus: onboardingState.status,
        onboardingStatusSource: onboardingState.source,
        onboardingLatestAssignmentId: onboardingState.latestAssignment?._id || null,
        ...getMemberAppAccessSummary(member, appNameById, appIdSet)
      })
    } catch (error) {
      console.error('Get member error:', error)
      res.status(500).json({ error: 'Failed to get member' })
    }
  }
)

router.get('/:orgId/members/:memberId/payroll-sync',
  requireAuthOrAPIToken,
  requireOrganizationMember,
  async (req, res) => {
    try {
      if (!['owner', 'admin', 'hr_manager'].includes(req.memberRole)) {
        return res.status(403).json({ error: 'Admin, owner, or HR manager role required' })
      }

      const organization = await Organization.findById(req.params.orgId)
        .populate('members.account', 'sub email profile')

      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' })
      }

      const member = organization.members.find(
        entry => entry.status === 'active' && matchesMemberIdentity(entry.account, req.params.memberId)
      )

      if (!member) {
        return res.status(404).json({ error: 'Member not found' })
      }

      const teams = await Team.find({
        organization: req.params.orgId,
        'members.account': member.account._id,
        'members.status': 'active'
      })
        .select('name department members.account members.status')
        .lean()

      const onboardingAssignments = await OnboardingAssignment.find({
        organization: req.params.orgId,
        member: member.account._id,
        workflowType: 'onboarding'
      })
        .select('member status workflowType updatedAt createdAt completedAt')
        .sort({ updatedAt: -1 })
        .lean()

      const structure = getMemberStructure(
        buildMemberStructureMap(organization, teams),
        member.account._id,
        organization
      )
      const onboardingStateByMember = buildOnboardingStateMap({
        members: [member],
        assignments: onboardingAssignments,
        workflowType: 'onboarding'
      })
      const onboardingState = getMemberOnboardingState(member.account._id, onboardingStateByMember)

      res.json({
        departmentId: structure.departmentId,
        departmentName: structure.departmentName,
        teamIds: structure.teamIds,
        teamNames: structure.teamNames,
        id: member.account._id,
        sub: member.account.sub,
        email: member.account.email,
        name: member.account.profile?.name,
        designation: member.designation || '',
        employeeId: member.employeeId || '',
        role: member.role,
        onboardingStatus: onboardingState.status,
        onboardingStatusSource: onboardingState.source,
        onboardingLatestAssignmentId: onboardingState.latestAssignment?._id || null,
        payrollSync: buildPayrollProfileSyncData(member.account)
      })
    } catch (error) {
      console.error('Get member payroll sync error:', error)
      res.status(500).json({ error: 'Failed to get member payroll sync data' })
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
      const hasEmployeeId = Object.prototype.hasOwnProperty.call(body, 'employeeId')
      const hasAppAccess = Object.prototype.hasOwnProperty.call(body, 'appAccess')
      const hasDepartment = Object.prototype.hasOwnProperty.call(body, 'department')
      const { role, designation, employeeId, appAccess } = body

      const canManageRole = ['owner', 'admin'].includes(req.memberRole)
      const canManageMemberMetadata = ['owner', 'admin', 'hr_manager'].includes(req.memberRole)

      if (!hasRole && !hasDesignation && !hasEmployeeId && !hasDepartment && !hasAppAccess) {
        return res.status(400).json({ error: 'At least one of role, designation, employeeId, or appAccess is required' })
      }

      if (hasRole && !canManageRole) {
        return res.status(403).json({ error: 'Admin or owner role required to update role' })
      }

      if ((hasDesignation || hasEmployeeId || hasDepartment || hasAppAccess) && !canManageMemberMetadata) {
        return res.status(403).json({ error: 'Admin, owner, or HR manager role required to update member details' })
      }

      if (hasDepartment) {
        return res.status(400).json({ error: 'Department is derived from active team assignments' })
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

      let normalizedAppAccess
      if (hasAppAccess) {
        const { appIdSet } = getHubAppMetadata()
        normalizedAppAccess = normalizeAppAccess(appAccess, appIdSet)
        if (normalizedAppAccess.mode === APP_ACCESS_MODE_SELECTED && normalizedAppAccess.appIds.length === 0) {
          return res.status(400).json({ error: 'Select at least one app when using selected apps access' })
        }
      }

      const normalizedEmployeeId = normalizeEmployeeId(employeeId)
      if (hasEmployeeId && await hasPendingInviteWithEmployeeId(req.params.orgId, normalizedEmployeeId)) {
        return res.status(400).json({ error: 'Employee ID is already pending on another invitation' })
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
        if (hasEmployeeId) {
          await req.organization.updateMemberDetails(
            req.params.memberId,
            { employeeId: normalizedEmployeeId },
            req.user._id
          )
        }
        if (hasAppAccess) {
          await req.organization.updateMemberDetails(
            req.params.memberId,
            { appAccess: normalizedAppAccess },
            req.user._id
          )
        }
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('Member updated in', req.organization.name, 'by', req.user.email, {
        role: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined,
        employeeId: hasEmployeeId ? normalizedEmployeeId : undefined
      })

      res.json({
        message: 'Member updated successfully',
        memberId: req.params.memberId,
        newRole: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined,
        employeeId: hasEmployeeId ? normalizedEmployeeId : undefined,
        appAccess: hasAppAccess ? normalizedAppAccess : undefined
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
