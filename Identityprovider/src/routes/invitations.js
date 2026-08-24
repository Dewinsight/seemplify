import express from 'express'
import { Organization } from '../models/Organization.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import { Account } from '../models/Account.js'
import { Team } from '../models/Team.js'
import { emailService } from '../services/emailService.js'
import { notifyOrgMemberAdded } from '../services/webhookService.js'
import { getOrganizationManagedHubApps } from '../config/hubApps.js'
import {
  APP_ACCESS_MODE_SELECTED,
  buildValidAppIdSet,
  normalizeAppAccess
} from '../utils/appAccess.js'
import {
  requireAuth,
  requireOrganizationMember,
  requestHasIdentityPermission,
  rateLimit
} from '../middleware/permissions.js'
import { authorizationHasPermission, resolveOrganizationAuthorization } from '../services/accessControlService.js'
import { invalidateClaimsCache } from '../index.js'

const router = express.Router()

async function canManageInvitations(account, organization, member) {
  const authorization = await resolveOrganizationAuthorization({ account, organization, member })
  return authorizationHasPermission(authorization, 'identity', 'invitations.manage') ||
    authorizationHasPermission(authorization, 'identity', 'members.invite')
}

function getHubAppMetadata() {
  const apps = getOrganizationManagedHubApps().map(app => ({
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

async function notifyMembershipActivated(user, organization, invitation) {
  await notifyOrgMemberAdded(
    user.sub,
    organization._id.toString(),
    {
      id: organization._id.toString(),
      name: organization.name,
      member: {
        employeeId: invitation.employeeId || user.sub,
        name: user.profile?.name || user.email,
        email: user.email,
        onboardingTemplateId: 'standard'
      }
    },
    invitation.role
  )
}

function getEmployeeIdKey(value = '') {
  return normalizeEmployeeId(value).toLowerCase()
}

async function hasPendingInviteWithEmployeeId(organizationId, employeeId, excludeInvitationId = null) {
  const employeeIdKey = getEmployeeIdKey(employeeId)
  if (!employeeIdKey) return false

  const pendingInvites = await OrganizationInvite.find({
    organization: organizationId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).select('employeeId')

  return pendingInvites.some((invite) => {
    if (excludeInvitationId && invite._id.toString() === excludeInvitationId.toString()) {
      return false
    }

    return getEmployeeIdKey(invite.employeeId) === employeeIdKey
  })
}

function parseInvitationAppAccess(reqBody = {}, validAppIds = null) {
  const appAccessPayload = reqBody.appAccess && typeof reqBody.appAccess === 'object'
    ? reqBody.appAccess
    : {
      mode: reqBody.appAccessMode,
      appIds: reqBody.selectedAppIds
    }

  const normalized = normalizeAppAccess(appAccessPayload, validAppIds)

  if (normalized.mode === APP_ACCESS_MODE_SELECTED && normalized.appIds.length === 0) {
    throw new Error('Select at least one app when using selected apps access')
  }

  return normalized
}

function formatAppAccessHtml(appAccess, appNameById = new Map()) {
  const normalized = normalizeAppAccess(appAccess)
  if (normalized.mode !== APP_ACCESS_MODE_SELECTED) {
    return '<p><strong>App Access:</strong> All apps available to your organization plan</p>'
  }

  const appNames = normalized.appIds.map(appId => appNameById.get(appId) || appId)
  if (appNames.length === 0) {
    return '<p><strong>App Access:</strong> Selected apps only</p>'
  }

  return `<p><strong>App Access:</strong> ${appNames.join(', ')}</p>`
}

// IMPORTANT: Order matters! More specific routes must come before generic ones
// Routes for /api/invitations/* (invitation-specific operations)
// These should be defined first to avoid conflicts with /:orgId/invitations

/**
 * Get user's pending invitations
 * GET /api/invitations/pending
 */
router.get('/pending',
  requireAuth,
  async (req, res) => {
    try {
      const invitations = await OrganizationInvite.find({
        email: req.user.email.toLowerCase(),
        status: 'pending',
        expiresAt: { $gt: new Date() }
      })
        .populate('organization', 'name description')
        .populate('invitedBy', 'email profile.name')
        .sort({ createdAt: -1 })

      res.json(invitations.map(inv => ({
        id: inv._id,
        organization: {
          id: inv.organization._id,
          name: inv.organization.name,
          description: inv.organization.description
        },
        role: inv.role,
        designation: inv.designation || '',
        employeeId: inv.employeeId || '',
        department: inv.department || null,
        team: inv.team || null,
        invitedBy: {
          email: inv.invitedBy?.email,
          name: inv.invitedBy?.profile?.name
        },
        appAccess: normalizeAppAccess(inv.appAccess),
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      })))
    } catch (error) {
      console.error('Get pending invitations error:', error)
      res.status(500).json({ error: 'Failed to get pending invitations' })
    }
  }
)

/**
 * Resend invitation
 * POST /api/invitations/:invitationId/resend
 * Requires admin or owner role in the organization
 */
router.post('/:invitationId/resend',
  requireAuth,
  rateLimit({ keyPrefix: 'resend', maxRequests: 10, windowMs: 60 * 60 * 1000 }), // 10 per hour
  async (req, res) => {
    try {
      const invitation = await OrganizationInvite.findById(req.params.invitationId)
        .populate('organization', 'name')

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Invitation is no longer pending' })
      }

      // Verify user is admin of the organization
      const organization = await Organization.findById(invitation.organization._id)
      const member = organization.members.find(
        m => m.account.toString() === req.user._id.toString() && m.status === 'active'
      )

      if (!member || !await canManageInvitations(req.user, organization, member)) {
        return res.status(403).json({ error: 'Invitation management permission required' })
      }

      // Generate new token
      const { plainToken, tokenHash } = await OrganizationInvite.generateToken()

      // Update invitation with new token and extended expiration
      invitation.tokenHash = tokenHash
      invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await invitation.save()

      // Resend email
      const inviteUrl = `${process.env.ISSUER_URL}/invitations/accept?token=${plainToken}`
      const { appNameById } = getHubAppMetadata()

      try {
        await emailService.sendEmail({
          to: invitation.email,
          // The token is regenerated for every resend, so this key is stable for
          // one reminder event without suppressing a later, deliberate resend.
          idempotencyKey: `organization_invitation_reminder:${invitation._id}:${plainToken.slice(0, 24)}`,
          tag: 'organization_invitation_reminder',
          subject: `Reminder: You're invited to join ${invitation.organization.name}`,
          html: `
            <h2>Reminder: You've been invited to join ${invitation.organization.name}</h2>
            <p>This is a reminder that you have a pending invitation to join this organization on AIIN Identity.</p>
            <p><strong>Role:</strong> ${invitation.role}</p>
            <p><strong>Designation:</strong> ${invitation.designation || 'Not specified'}</p>
            ${invitation.employeeId ? `<p><strong>Employee ID:</strong> ${invitation.employeeId}</p>` : ''}
            ${formatAppAccessHtml(invitation.appAccess, appNameById)}
            <p>Click the link below to accept the invitation:</p>
            <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #60a5fa, #a855f7); color: white; text-decoration: none; border-radius: 8px;">Accept Invitation</a></p>
            <p style="color: #666; font-size: 14px; margin-top: 16px;">
              Or copy and paste this link into your browser:<br>
              <a href="${inviteUrl}" style="color: #60a5fa; word-break: break-all;">${inviteUrl}</a>
            </p>
            <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
          `
        })
        console.log('✅ Invitation email resent to:', invitation.email)
      } catch (emailError) {
        console.error('Failed to resend invitation email:', emailError)
      }

      res.json({ message: 'Invitation resent successfully' })
    } catch (error) {
      console.error('Resend invitation error:', error)
      res.status(500).json({ error: 'Failed to resend invitation' })
    }
  }
)

/**
 * Cancel invitation
 * DELETE /api/invitations/:invitationId
 * Requires admin or owner role in the organization
 */
router.delete('/:invitationId',
  requireAuth,
  async (req, res) => {
    try {
      const invitation = await OrganizationInvite.findById(req.params.invitationId)

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      // Verify user is admin of the organization
      const organization = await Organization.findById(invitation.organization)
      const member = organization.members.find(
        m => m.account.toString() === req.user._id.toString() && m.status === 'active'
      )

      if (!member || !await canManageInvitations(req.user, organization, member)) {
        return res.status(403).json({ error: 'Invitation management permission required' })
      }

      await OrganizationInvite.findByIdAndDelete(req.params.invitationId)

      console.log('✅ Invitation cancelled for:', invitation.email)

      res.json({ message: 'Invitation cancelled successfully' })
    } catch (error) {
      console.error('Cancel invitation error:', error)
      res.status(500).json({ error: 'Failed to cancel invitation' })
    }
  }
)

/**
 * Accept invitation by ID (for logged-in users viewing pending invitations page)
 * POST /api/invitations/accept/:invitationId
 * Verifies user's email matches invitation email
 */
router.post('/accept/:invitationId',
  requireAuth,
  async (req, res) => {
    try {
      const invitation = await OrganizationInvite.findById(req.params.invitationId)
        .populate('organization', 'name')

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      // Verify user's email matches invitation email
      if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: 'This invitation is not for your email address' })
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Invitation is no longer pending' })
      }

      if (invitation.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invitation has expired' })
      }

      // Accept the invitation (handles email verification internally)
      await invitation.accept(req.user._id, req.user.email)

      // Add user to organization
      const organization = await Organization.findById(invitation.organization._id)
      await organization.addMember(
        req.user._id,
        invitation.role,
        invitation.invitedBy,
        normalizeAppAccess(invitation.appAccess),
        {
          designation: invitation.designation,
          employeeId: invitation.employeeId
        }
      )

      if (invitation.team) {
        const team = await Team.findById(invitation.team)
        if (team) {
          await team.addMember(req.user._id, 'member')
        }
      }

      await notifyMembershipActivated(req.user, organization, invitation)

      invalidateClaimsCache(req.user.sub)

      console.log('✅ Invitation accepted:', req.user.email, 'joined', organization.name)

      res.json({
        message: 'Invitation accepted successfully',
        organization: {
          id: organization._id,
          name: organization.name,
          role: invitation.role
        }
      })
    } catch (error) {
      console.error('Accept invitation error:', error)
      res.status(400).json({ error: error.message })
    }
  }
)

/**
 * Accept invitation by token (from email link)
 * POST /api/invitations/:token/accept
 * CRITICAL: Email verification required
 */
router.post('/:token/accept',
  requireAuth,
  async (req, res) => {
    try {
      const { token } = req.params

      // Find pending invitations for user's email
      const pendingInvites = await OrganizationInvite.find({
        email: req.user.email.toLowerCase(),
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }).populate('organization', 'name')

      if (pendingInvites.length === 0) {
        return res.status(404).json({ error: 'No pending invitations found for your email' })
      }

      // Find the matching invitation by verifying token
      let matchedInvite = null
      for (const invite of pendingInvites) {
        const isValid = await invite.verifyToken(token)
        if (isValid) {
          matchedInvite = invite
          break
        }
      }

      if (!matchedInvite) {
        return res.status(400).json({ error: 'Invalid or expired invitation token' })
      }

      // Accept the invitation (handles email verification internally)
      await matchedInvite.accept(req.user._id, req.user.email)

      // Add user to organization
      const organization = await Organization.findById(matchedInvite.organization._id)
      await organization.addMember(
        req.user._id,
        matchedInvite.role,
        matchedInvite.invitedBy,
        normalizeAppAccess(matchedInvite.appAccess),
        {
          designation: matchedInvite.designation,
          employeeId: matchedInvite.employeeId
        }
      )

      if (matchedInvite.team) {
        const team = await Team.findById(matchedInvite.team)
        if (team) {
          await team.addMember(req.user._id, 'member')
        }
      }

      await notifyMembershipActivated(req.user, organization, matchedInvite)

      invalidateClaimsCache(req.user.sub)

      console.log('✅ Invitation accepted:', req.user.email, 'joined', organization.name)

      res.json({
        message: 'Invitation accepted successfully',
        organization: {
          id: organization._id,
          name: organization.name,
          role: matchedInvite.role
        }
      })
    } catch (error) {
      console.error('Accept invitation error:', error)
      res.status(400).json({ error: error.message })
    }
  }
)

/**
 * Reject invitation
 * POST /api/invitations/:token/reject
 * CRITICAL: Email verification required
 */
router.post('/:token/reject',
  requireAuth,
  async (req, res) => {
    try {
      const { token } = req.params

      // Find pending invitations for user's email
      const pendingInvites = await OrganizationInvite.find({
        email: req.user.email.toLowerCase(),
        status: 'pending',
        expiresAt: { $gt: new Date() }
      })

      if (pendingInvites.length === 0) {
        return res.status(404).json({ error: 'No pending invitations found for your email' })
      }

      // Find the matching invitation by verifying token
      let matchedInvite = null
      for (const invite of pendingInvites) {
        const isValid = await invite.verifyToken(token)
        if (isValid) {
          matchedInvite = invite
          break
        }
      }

      if (!matchedInvite) {
        return res.status(400).json({ error: 'Invalid or expired invitation token' })
      }

      // Reject the invitation
      await matchedInvite.reject(req.user._id, req.user.email)

      console.log('✅ Invitation rejected by:', req.user.email)

      res.json({ message: 'Invitation rejected successfully' })
    } catch (error) {
      console.error('Reject invitation error:', error)
      res.status(400).json({ error: error.message })
    }
  }
)

/**
 * Decline invitation by ID (for gatekeeper modal)
 * POST /api/invitations/decline/:invitationId
 */
router.post('/decline/:invitationId',
  requireAuth,
  async (req, res) => {
    try {
      const invitation = await OrganizationInvite.findById(req.params.invitationId)

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      // Verify email matches
      if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: 'This invitation is not for your email' })
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Invitation is no longer pending' })
      }

      // Reject/decline invitation
      await invitation.reject(req.user._id, req.user.email)

      console.log('✅ Invitation declined by:', req.user.email)

      res.json({ message: 'Invitation declined successfully' })
    } catch (error) {
      console.error('Decline invitation error:', error)
      res.status(400).json({ error: error.message })
    }
  }
)

// Routes for /api/organizations/:orgId/invitations (organization-specific operations)
// These come after the invitation-specific routes to avoid conflicts

/**
 * Get pending invitations for an organization
 * GET /api/organizations/:orgId/invitations
 */
router.get('/:orgId/invitations',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    try {
      const invitations = await OrganizationInvite.find({
        organization: req.params.orgId,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      })
        .populate('invitedBy', 'email profile.name')
        .sort({ createdAt: -1 })

      res.json(invitations.map(inv => ({
        id: inv._id,
        email: inv.email,
        role: inv.role,
        designation: inv.designation || '',
        employeeId: inv.employeeId || '',
        department: inv.department || null,
        team: inv.team || null,
        status: inv.status,
        invitedBy: {
          email: inv.invitedBy?.email,
          name: inv.invitedBy?.profile?.name
        },
        appAccess: normalizeAppAccess(inv.appAccess),
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      })))
    } catch (error) {
      console.error('Get invitations error:', error)
      res.status(500).json({ error: 'Failed to get invitations' })
    }
  }
)

/**
 * Create invitation (send invite to user)
 * POST /api/organizations/:orgId/invitations
 * Requires admin or owner role
 */
router.post('/:orgId/invitations',
  requireAuth,
  requireOrganizationMember,
  rateLimit({ keyPrefix: 'invite', maxRequests: 50, windowMs: 60 * 60 * 1000 }), // 50 per hour
  async (req, res) => {
    try {
      console.log('📧 Creating invitation:', {
        orgId: req.params.orgId,
        orgName: req.organization?.name,
        inviter: req.user?.email,
        body: req.body
      })

      const canInvite = requestHasIdentityPermission(req, 'members.invite') ||
        requestHasIdentityPermission(req, 'invitations.manage')
      if (!canInvite) {
        return res.status(403).json({ error: 'Admin, owner, or HR manager role required' })
      }

      await req.organization.save()

      const {
        email,
        role = 'staff',
        designation: rawDesignation = '',
        employeeId: rawEmployeeId = '',
        department: requestedDepartmentId = null,
        team: teamId = null
      } = req.body
      const { appIdSet, appNameById } = getHubAppMetadata()
      const designation = String(rawDesignation || '').trim()
      const employeeId = normalizeEmployeeId(rawEmployeeId)

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' })
      }

      if (!designation) {
        return res.status(400).json({ error: 'Designation is required' })
      }

      if (!teamId) {
        return res.status(400).json({ error: 'Team is required' })
      }

      const invitedTeam = await Team.findById(teamId).select('name organization department').lean()
      if (!invitedTeam || invitedTeam.organization.toString() !== req.params.orgId) {
        return res.status(400).json({ error: 'Invalid team' })
      }

      const departmentId = invitedTeam.department?.toString() || null
      const department = departmentId ? req.organization.getDepartmentById(departmentId) : null
      if (!department) {
        return res.status(400).json({ error: 'Selected team must belong to a valid department' })
      }

      if (requestedDepartmentId && requestedDepartmentId.toString() !== departmentId) {
        return res.status(400).json({ error: 'Selected team does not belong to the selected department' })
      }

      const normalizedEmail = email.toLowerCase().trim()

      // Validate role
      const validRoles = ['admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
      }
      if (role !== 'staff' && !requestHasIdentityPermission(req, 'roles.assign')) {
        return res.status(403).json({
          error: 'Permission to assign organization roles is required.',
          code: 'ORGANIZATION_PERMISSION_REQUIRED',
          requiredPermission: 'roles.assign'
        })
      }

      let appAccess
      if (requestHasIdentityPermission(req, 'apps.assign')) {
        try {
          appAccess = parseInvitationAppAccess(req.body, appIdSet)
        } catch (validationError) {
          return res.status(400).json({ error: validationError.message })
        }
      } else {
        // Inviting a person does not implicitly grant access to every product.
        // An apps.assign holder can expand this centrally after the member joins.
        appAccess = { mode: APP_ACCESS_MODE_SELECTED, appIds: [] }
      }

      // Check if user is already a member
      // First, find account by email
      const existingAccount = await Account.findOne({ email: normalizedEmail })
      if (existingAccount) {
        // Check if this account is already an active member
        const isMember = req.organization.members.find(
          m => m.account.toString() === existingAccount._id.toString() && m.status === 'active'
        )
        if (isMember) {
          return res.status(400).json({ error: 'User is already a member of this organization' })
        }
      }

      try {
        req.organization.assertActiveEmployeeIdAvailable(employeeId)
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message })
      }

      if (await hasPendingInviteWithEmployeeId(req.params.orgId, employeeId)) {
        return res.status(400).json({ error: 'Employee ID is already pending on another invitation' })
      }

      // Check for existing pending invite
      const existingInvite = await OrganizationInvite.hasPendingInvite(req.params.orgId, normalizedEmail)
      if (existingInvite) {
        return res.status(400).json({ error: 'An invitation is already pending for this email' })
      }

      // Generate secure token
      const { plainToken, tokenHash } = await OrganizationInvite.generateToken()

      // Create invitation (expires in 7 days)
      const invitation = await OrganizationInvite.create({
        organization: req.params.orgId,
        email: normalizedEmail,
        role,
        designation,
        employeeId: employeeId || undefined,
        department: departmentId,
        team: teamId,
        appAccess,
        tokenHash,
        invitedBy: req.user._id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })

      // Send invitation email
      const inviteUrl = `${process.env.ISSUER_URL}/invitations/accept?token=${plainToken}`

      try {
        await emailService.sendEmail({
          to: normalizedEmail,
          idempotencyKey: `organization_invitation:${invitation._id}`,
          tag: 'organization_invitation',
          subject: `You're invited to join ${req.organization.name}`,
          html: `
            <h2>You've been invited to join ${req.organization.name}</h2>
            <p><strong>${req.user.profile?.name || req.user.email}</strong> has invited you to join their organization on AIIN Identity.</p>
            <p><strong>Role:</strong> ${role}</p>
            <p><strong>Designation:</strong> ${designation}</p>
            ${employeeId ? `<p><strong>Employee ID:</strong> ${employeeId}</p>` : ''}
            <p><strong>Department:</strong> ${department.name}</p>
            <p><strong>Team:</strong> ${invitedTeam.name}</p>
            ${formatAppAccessHtml(appAccess, appNameById)}
            <p>Click the link below to accept the invitation:</p>
            <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #60a5fa, #a855f7); color: white; text-decoration: none; border-radius: 8px;">Accept Invitation</a></p>
            <p style="color: #666; font-size: 14px; margin-top: 16px;">
              Or copy and paste this link into your browser:<br>
              <a href="${inviteUrl}" style="color: #60a5fa; word-break: break-all;">${inviteUrl}</a>
            </p>
            <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
            <p style="color: #666; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
          `
        })
        console.log('✅ Invitation email sent to:', normalizedEmail)
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError)
        // Don't fail the request, invitation is still created
      }

      console.log('✅ Invitation created for:', normalizedEmail, 'to', req.organization.name)

      res.status(201).json({
        id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        designation: invitation.designation,
        employeeId: invitation.employeeId || '',
        department: invitation.department,
        team: invitation.team,
        appAccess: normalizeAppAccess(invitation.appAccess),
        expiresAt: invitation.expiresAt,
        message: 'Invitation sent successfully'
      })
    } catch (error) {
      console.error('Create invitation error:', error)
      console.error('Error stack:', error.stack)
      res.status(500).json({ 
        error: 'Failed to create invitation',
        details: error.message 
      })
    }
  }
)

export default router
