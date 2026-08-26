import express from 'express'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import { Team } from '../models/Team.js'
import { getOrganizationManagedHubApps } from '../config/hubApps.js'
import {
  APP_ACCESS_MODE_SELECTED,
  buildValidAppIdSet,
  normalizeAppAccess
} from '../utils/appAccess.js'
import { buildMemberStructureMap, getMemberStructure } from '../utils/memberStructure.js'
import {
  classifyMemberUpdateError,
  serializeMemberUpdateError
} from '../utils/memberUpdateErrors.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { buildOnboardingStateMap, getMemberOnboardingState } from '../utils/onboardingStatus.js'
import { buildPayrollProfileSyncData, getProfileCompletionForAccount } from '../utils/profileCompletion.js'
import { sendProfileCompletionRemindersForAccounts } from '../jobs/profileCompletionReminders.js'
import { emailService } from '../services/emailService.js'
import webhookService from '../services/webhookService.js'
import { sendWebhook } from '../services/webhookService.js'
import { invalidateClaimsCache } from '../index.js'
import {
  requireAuth,
  requireOrganizationMember,
  requestHasIdentityPermission,
  requireIdentityPermission
} from '../middleware/permissions.js'
import { requireAuthOrAPIToken } from '../middleware/apiAuth.js'
import { resolveOrganizationAuthorization } from '../services/accessControlService.js'

const router = express.Router()

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

function hasText(value = '') {
  return String(value || '').trim().length > 0
}

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeDateValue(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeMailingAddress(input = {}, fallback = {}) {
  return {
    street: normalizeText(input.street ?? fallback.street),
    street2: normalizeText(input.street2 ?? fallback.street2),
    city: normalizeText(input.city ?? fallback.city),
    state: normalizeText(input.state ?? fallback.state),
    zipCode: normalizeText(input.zipCode ?? fallback.zipCode),
    country: normalizeText(input.country ?? fallback.country ?? 'USA') || 'USA'
  }
}

function normalizePhoneNumbers(input = {}, fallback = {}) {
  return {
    mobile: normalizeText(input.mobile ?? fallback.mobile),
    home: normalizeText(input.home ?? fallback.home),
    work: normalizeText(input.work ?? fallback.work)
  }
}

function normalizeEmergencyContact(input = {}, fallback = {}) {
  return {
    name: normalizeText(input.name ?? fallback.name),
    relationship: normalizeText(input.relationship ?? fallback.relationship),
    phone: normalizeText(input.phone ?? fallback.phone),
    email: normalizeText(input.email ?? fallback.email),
    isPrimary: true
  }
}

function emergencyContactHasValues(input = {}) {
  return [
    input.name,
    input.relationship,
    input.phone,
    input.email
  ].some(hasText)
}

function cloneDocument(value = {}) {
  if (!value) return {}
  if (typeof value.toObject === 'function') {
    return value.toObject()
  }
  return JSON.parse(JSON.stringify(value))
}

function buildMongoUpdate(setFields = {}, unsetFields = {}) {
  const update = {}

  if (Object.keys(setFields).length > 0) {
    update.$set = setFields
  }

  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields
  }

  return update
}

async function updateCompletionTracking(account, organizationId) {
  const completion = await getProfileCompletionForAccount(account, { organizationId })
  account.profile = account.profile || {}
  account.profile.completionReminders = {
    ...(account.profile.completionReminders || {}),
    lastMissingSteps: (completion.steps || []).filter(step => !step.complete).map(step => step.key)
  }

  if (completion.complete) {
    account.profile.completionReminders.lastCompletedAt = new Date()
  }

  return completion
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
        .populate('members.account', 'sub email profile.name profile.picture emailVerified createdAt isSuperAdmin authorizationRevision')
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

      const members = (await Promise.all(organization.members
        .filter(m => m.status === 'active')
        .map(async (m) => {
          const structure = getMemberStructure(memberStructure, m.account._id, organization)
          const onboardingState = getMemberOnboardingState(m.account._id, onboardingStateByMember)
          const authorization = await resolveOrganizationAuthorization({
            account: m.account,
            organization,
            member: m
          })
          return {
            departmentId: structure.departmentId,
            departmentName: structure.departmentName,
            teamIds: structure.teamIds,
            teamNames: structure.teamNames,
            id: m.account._id,
            sub: m.account.sub,
            email: m.account.email,
            name: m.account.profile?.name,
            picture: m.account.profile?.picture || null,
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
            authorization,
            ...getMemberAppAccessSummary(m, appNameById, appIdSet)
          }
        })))
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
  requireIdentityPermission('members.view'),
  async (req, res) => {
    try {
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
      const completion = await getProfileCompletionForAccount(member.account, {
        organizationId: req.params.orgId
      })

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
        payrollSync: {
          ...buildPayrollProfileSyncData(member.account),
          profileCompletion: completion
        }
      })
    } catch (error) {
      console.error('Get member payroll sync error:', error)
      res.status(500).json({ error: 'Failed to get member payroll sync data' })
    }
  }
)

router.put('/:orgId/members/:memberId/payroll-sync',
  requireAuthOrAPIToken,
  requireOrganizationMember,
  requireIdentityPermission('members.manage'),
  async (req, res) => {
    try {
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

      const body = req.body || {}
      const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
      const hasDesignation = Object.prototype.hasOwnProperty.call(body, 'designation')
      const hasEmployeeId = Object.prototype.hasOwnProperty.call(body, 'employeeId')
      const hasPersonalInfo = body.personalInfo && typeof body.personalInfo === 'object'
      const hasTaxInfo = body.taxInfo && typeof body.taxInfo === 'object'
      const hasBanking = body.banking && typeof body.banking === 'object'
      const hasDependentsDeclaration = body.dependentsDeclaration && typeof body.dependentsDeclaration === 'object'

      if (hasBanking) {
        const payrollUrl = process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007'
        return res.status(410).json({
          error: 'Banking and direct deposit are managed in Payroll.',
          code: 'BANKING_MOVED_TO_PAYROLL',
          location: `${payrollUrl.replace(/\/$/, '')}/banking`
        })
      }

      if (hasDependentsDeclaration) {
        const payrollUrl = process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007'
        return res.status(410).json({
          error: 'Dependents are managed in Payroll for benefits and tax processing.',
          code: 'DEPENDENTS_MOVED_TO_PAYROLL',
          location: `${payrollUrl.replace(/\/$/, '')}/dependents`
        })
      }

      if (hasEmployeeId && await hasPendingInviteWithEmployeeId(req.params.orgId, body.employeeId)) {
        return res.status(400).json({ error: 'Employee ID is already pending on another invitation' })
      }

      if (hasDesignation || hasEmployeeId) {
        const memberSet = {
          'members.$.updatedAt': new Date(),
          'members.$.updatedBy': req.user._id
        }
        const memberUnset = {}

        if (hasDesignation) {
          const nextDesignation = normalizeText(body.designation)
          if (nextDesignation) {
            memberSet['members.$.designation'] = nextDesignation
          } else {
            memberUnset['members.$.designation'] = ''
          }
          member.designation = nextDesignation
        }

        if (hasEmployeeId) {
          const normalizedEmployeeId = normalizeEmployeeId(body.employeeId)
          organization.assertActiveEmployeeIdAvailable(normalizedEmployeeId, member.account._id)
          if (normalizedEmployeeId) {
            memberSet['members.$.employeeId'] = normalizedEmployeeId
          } else {
            memberUnset['members.$.employeeId'] = ''
          }
          member.employeeId = normalizedEmployeeId
        }

        const memberUpdate = buildMongoUpdate(memberSet, memberUnset)
        await Organization.updateOne(
          { _id: req.params.orgId, 'members.account': member.account._id },
          memberUpdate
        )
      }

      const account = member.account
      if (!account) {
        return res.status(404).json({ error: 'Member account not found' })
      }

      const accountSnapshot = cloneDocument(account)
      accountSnapshot.profile = accountSnapshot.profile || {}
      accountSnapshot.profile.personalInfo = accountSnapshot.profile.personalInfo || {}
      const accountUpdateSet = {}

      if (hasName) {
        const normalizedName = normalizeText(body.name)
        accountSnapshot.profile.name = normalizedName
        accountUpdateSet['profile.name'] = normalizedName
      }

      if (hasPersonalInfo) {
        const personalInfo = body.personalInfo || {}
        const currentPersonalInfo = accountSnapshot.profile.personalInfo || {}

        if (Object.prototype.hasOwnProperty.call(personalInfo, 'dateOfBirth')) {
          const normalizedDateOfBirth = normalizeDateValue(personalInfo.dateOfBirth)
          accountSnapshot.profile.personalInfo.dateOfBirth = normalizedDateOfBirth
          accountUpdateSet['profile.personalInfo.dateOfBirth'] = normalizedDateOfBirth
        }

        if (Object.prototype.hasOwnProperty.call(personalInfo, 'mailingAddress')) {
          const normalizedMailingAddress = normalizeMailingAddress(
            personalInfo.mailingAddress || {},
            currentPersonalInfo.mailingAddress || {}
          )
          accountSnapshot.profile.personalInfo.mailingAddress = normalizedMailingAddress
          accountUpdateSet['profile.personalInfo.mailingAddress'] = normalizedMailingAddress
        }

        if (Object.prototype.hasOwnProperty.call(personalInfo, 'phoneNumbers')) {
          const normalizedPhoneNumbers = normalizePhoneNumbers(
            personalInfo.phoneNumbers || {},
            currentPersonalInfo.phoneNumbers || {}
          )
          accountSnapshot.profile.personalInfo.phoneNumbers = normalizedPhoneNumbers
          accountUpdateSet['profile.personalInfo.phoneNumbers'] = normalizedPhoneNumbers
        }

        if (Object.prototype.hasOwnProperty.call(personalInfo, 'emergencyContact')) {
          const normalizedEmergencyContact = normalizeEmergencyContact(
            personalInfo.emergencyContact || {},
            Array.isArray(currentPersonalInfo.emergencyContacts) ? currentPersonalInfo.emergencyContacts[0] : {}
          )

          const emergencyContacts = emergencyContactHasValues(normalizedEmergencyContact)
            ? [normalizedEmergencyContact]
            : []
          accountSnapshot.profile.personalInfo.emergencyContacts = emergencyContacts
          accountUpdateSet['profile.personalInfo.emergencyContacts'] = emergencyContacts
        }
      }

      if (hasTaxInfo) {
        const currentTaxInfo = accountSnapshot.profile.taxInfo || {}
        accountSnapshot.profile.taxInfo = {
          ...currentTaxInfo,
          taxId: normalizeText(body.taxInfo.taxId ?? currentTaxInfo.taxId),
          lastUpdated: new Date()
        }
        accountUpdateSet['profile.taxInfo'] = accountSnapshot.profile.taxInfo
      }

      const completion = await updateCompletionTracking(accountSnapshot, req.params.orgId)
      accountUpdateSet['profile.completionReminders'] = accountSnapshot.profile?.completionReminders || {}

      await Account.updateOne(
        { _id: account._id },
        buildMongoUpdate(accountUpdateSet, {}),
        { runValidators: true }
      )

      const teams = await Team.find({
        organization: req.params.orgId,
        'members.account': account._id,
        'members.status': 'active'
      })
        .select('name department members.account members.status')
        .lean()

      const onboardingAssignments = await OnboardingAssignment.find({
        organization: req.params.orgId,
        member: account._id,
        workflowType: 'onboarding'
      })
        .select('member status workflowType updatedAt createdAt completedAt')
        .sort({ updatedAt: -1 })
        .lean()

      const structure = getMemberStructure(
        buildMemberStructureMap(organization, teams),
        account._id,
        organization
      )
      const updatedMember = organization.members.find(
        entry => entry.status === 'active' && matchesMemberIdentity(entry.account, account._id.toString())
      )
      const onboardingStateByMember = buildOnboardingStateMap({
        members: updatedMember ? [updatedMember] : [],
        assignments: onboardingAssignments,
        workflowType: 'onboarding'
      })
      const onboardingState = getMemberOnboardingState(account._id, onboardingStateByMember)

      res.json({
        departmentId: structure.departmentId,
        departmentName: structure.departmentName,
        teamIds: structure.teamIds,
        teamNames: structure.teamNames,
        id: account._id,
        sub: account.sub,
        email: account.email,
        name: account.profile?.name,
        designation: updatedMember?.designation || '',
        employeeId: updatedMember?.employeeId || '',
        role: updatedMember?.role || 'staff',
        onboardingStatus: onboardingState.status,
        onboardingStatusSource: onboardingState.source,
        onboardingLatestAssignmentId: onboardingState.latestAssignment?._id || null,
        payrollSync: {
          ...buildPayrollProfileSyncData(accountSnapshot),
          profileCompletion: completion
        }
      })
    } catch (error) {
      console.error('Update member payroll sync error:', error)
      if (error?.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Invalid member payroll sync data',
          details: Object.values(error.errors || {})
            .map((entry) => String(entry?.message || '').trim())
            .filter(Boolean)
        })
      }
      res.status(500).json({ error: error.message || 'Failed to update member payroll sync data' })
    }
  }
)

router.post('/:orgId/members/profile-reminders',
  requireAuth,
  requireOrganizationMember,
  requireIdentityPermission('notifications.send'),
  async (req, res) => {
    try {
      if (!emailService.isConfigured()) {
        return res.status(503).json({ error: 'Email service is not configured' })
      }

      const organization = await Organization.findById(req.params.orgId)
        .select('name members.account members.status')
        .populate('members.account', 'email profile')

      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' })
      }

      const accounts = organization.members
        .filter((member) => member.status === 'active' && member.account?.email)
        .map((member) => member.account)

      const result = await sendProfileCompletionRemindersForAccounts(accounts, {
        organizationId: req.params.orgId,
        organizationName: organization.name,
        respectCooldown: false,
        throwOnUnconfigured: true
      })

      if (result.sentCount === 0 && result.failedCount > 0) {
        return res.status(500).json({
          error: `Failed to send profile reminders${result.failedCount > 1 ? ` to ${result.failedCount} members` : ''}`
        })
      }

      const message = result.sentCount > 0
        ? `Sent ${result.sentCount} profile reminder${result.sentCount === 1 ? '' : 's'} to members with incomplete profiles${result.failedCount > 0 ? `. ${result.failedCount} failed` : ''}.`
        : 'No active members with incomplete profiles were found.'

      res.json({
        message,
        ...result
      })
    } catch (error) {
      console.error('Send profile reminders error:', error)
      res.status(500).json({ error: error.message || 'Failed to send profile reminders' })
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
      const hasBranch = Object.prototype.hasOwnProperty.call(body, 'branch')
      const { role, designation, employeeId, appAccess, branch } = body

      const canManageRole = requestHasIdentityPermission(req, 'roles.assign')
      const canManageMemberMetadata = requestHasIdentityPermission(req, 'members.manage')
      const canManageAppAccess = requestHasIdentityPermission(req, 'apps.assign')

      if (!hasRole && !hasDesignation && !hasEmployeeId && !hasDepartment && !hasBranch && !hasAppAccess) {
        return res.status(400).json({ error: 'At least one member field is required' })
      }

      if (hasRole && !canManageRole) {
        return res.status(403).json({ error: 'Admin or owner role required to update role' })
      }

      if ((hasDesignation || hasEmployeeId || hasDepartment || hasBranch) && !canManageMemberMetadata) {
        return res.status(403).json({ error: 'Admin, owner, or HR manager role required to update member details' })
      }

      if (hasAppAccess && !canManageAppAccess) {
        return res.status(403).json({ error: 'Product assignment permission is required to update app access' })
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

      if (hasRole && role === 'owner' && !requestHasIdentityPermission(req, 'owner.transfer')) {
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

      const targetAccount = (hasRole || hasAppAccess)
        ? await Account.findById(req.params.memberId).select('sub email').lean()
        : null
      const targetMember = req.organization.members.find(member => (
        member.account?.toString() === req.params.memberId
      ))

      if ((hasRole || hasAppAccess) && (!targetAccount || !targetMember)) {
        return res.status(404).json({
          error: 'This member could not be found in the organization.',
          code: 'MEMBER_NOT_FOUND'
        })
      }

      try {
        if (hasRole) {
          const previousRole = targetMember?.role || null
          await webhookService.runAuthorizationMutationWithWebhook({
            event: 'organization.member.role_changed',
            data: {
              userId: targetAccount?.sub,
              subject: targetAccount?.sub,
              email: targetAccount?.email,
              organizationId: req.organization._id.toString(),
              memberId: targetMember?._id?.toString(),
              accountId: req.params.memberId,
              oldRole: previousRole,
              newRole: role,
              changedBy: req.user._id.toString(),
              action: 'role_changed'
            },
            mutation: (session) => req.organization.updateMemberRole(
              req.params.memberId,
              role,
              req.user._id,
              session ? { session } : undefined
            )
          })
          if (targetAccount?.sub) invalidateClaimsCache(targetAccount.sub)
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
        if (hasBranch) {
          await req.organization.updateMemberDetails(
            req.params.memberId,
            { branch: branch || null },
            req.user._id
          )
        }
        if (hasAppAccess) {
          await webhookService.runAuthorizationMutationWithWebhook({
            event: 'organization.member.app_access_changed',
            data: {
              userId: targetAccount?.sub,
              organizationId: req.organization._id.toString(),
              memberId: targetMember?._id?.toString(),
              accountId: req.params.memberId,
              subject: targetAccount?.sub,
              email: targetAccount?.email,
              appAccess: normalizedAppAccess,
              changedBy: req.user._id.toString(),
              action: 'app_access_changed'
            },
            mutation: (session) => req.organization.updateMemberDetails(
              req.params.memberId,
              { appAccess: normalizedAppAccess },
              req.user._id,
              session ? { session } : undefined
            )
          })
          if (targetAccount?.sub) invalidateClaimsCache(targetAccount.sub)
        }
      } catch (err) {
        const classified = classifyMemberUpdateError(err)
        const requestId = req.get('x-request-id') || req.id || null
        console.error('Member update mutation failed', {
          organizationId: req.params.orgId,
          memberId: req.params.memberId,
          attemptedFields: Object.keys(body).filter(field => [
            'role',
            'designation',
            'employeeId',
            'appAccess',
            'branch'
          ].includes(field)),
          requestId,
          error: serializeMemberUpdateError(err)
        })
        return res.status(classified.status).json({
          error: classified.publicMessage,
          code: classified.code,
          ...(requestId ? { requestId } : {})
        })
      }

      console.log('Member updated in', req.organization.name, 'by', req.user.email, {
        role: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined,
        employeeId: hasEmployeeId ? normalizedEmployeeId : undefined
      })
      const updatedMemberEntry = req.organization.members.find(
        member => member.account.toString() === req.params.memberId
      )
      const updatedAccount = await Account.findById(req.params.memberId).select('sub email profile').lean()
      await sendWebhook('organization.member.updated', {
        eventId: `member-update:${req.organization._id}:${req.params.memberId}:${Date.now()}`,
        userId: req.params.memberId,
        idpSubject: updatedAccount?.sub,
        email: updatedAccount?.email,
        name: updatedAccount?.profile?.name,
        organizationId: req.organization._id.toString(),
        role: updatedMemberEntry?.role,
        employeeId: updatedMemberEntry?.employeeId,
        departmentId: updatedMemberEntry?.department?.toString?.() || updatedMemberEntry?.department,
        appAccess: updatedMemberEntry?.appAccess,
        effectiveAt: new Date().toISOString()
      })

      res.json({
        message: 'Member updated successfully',
        memberId: req.params.memberId,
        newRole: hasRole ? role : undefined,
        designation: hasDesignation ? String(designation || '').trim() : undefined,
        employeeId: hasEmployeeId ? normalizedEmployeeId : undefined,
        branch: hasBranch ? (branch || null) : undefined,
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
  requireIdentityPermission('members.remove'),
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

      if (targetMember.role === 'owner' && !requestHasIdentityPermission(req, 'owner.transfer') && !isSelf) {
        return res.status(403).json({ error: 'Only owner can remove other owners' })
      }

      const targetAccount = await Account.findById(memberId).select('sub email').lean()

      try {
        await webhookService.runAuthorizationMutationWithWebhook({
          event: 'organization.member.removed',
          data: {
            userId: targetAccount?.sub,
            subject: targetAccount?.sub,
            email: targetAccount?.email,
            accountId: memberId,
            memberId: targetMember._id?.toString(),
            organizationId: req.organization._id.toString(),
            action: 'removed'
          },
          mutation: (session) => req.organization.removeMember(
            memberId,
            session ? { session } : undefined
          )
        })
      } catch (err) {
        const classified = classifyMemberUpdateError(err)
        const requestId = req.get('x-request-id') || req.id || null
        console.error('Member removal mutation failed', {
          organizationId: req.params.orgId,
          memberId,
          requestId,
          error: serializeMemberUpdateError(err)
        })
        return res.status(classified.status).json({
          error: classified.publicMessage,
          code: classified.code,
          ...(requestId ? { requestId } : {})
        })
      }
      console.log('Member removed from', req.organization.name, 'by', req.user.email)

      if (targetAccount?.sub) invalidateClaimsCache(targetAccount.sub)

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

      const leavingAccount = await Account.findById(memberId).select('sub email').lean()

      try {
        await webhookService.runAuthorizationMutationWithWebhook({
          event: 'organization.member.removed',
          data: {
            userId: leavingAccount?.sub,
            subject: leavingAccount?.sub,
            email: leavingAccount?.email,
            accountId: memberId,
            memberId: member._id?.toString(),
            organizationId: req.organization._id.toString(),
            action: 'removed'
          },
          mutation: (session) => req.organization.removeMember(
            memberId,
            session ? { session } : undefined
          )
        })
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }

      console.log('User left organization:', req.organization.name, 'by', req.user.email)
      if (leavingAccount?.sub) invalidateClaimsCache(leavingAccount.sub)

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
