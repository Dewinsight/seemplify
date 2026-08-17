import { Account } from '../models/Account.js'
import AppLaunchActivity from '../models/AppLaunchActivity.js'
import { LmsAccessRequest } from '../models/LmsAccessRequest.js'
import { LmsRole } from '../models/LmsRole.js'
import { Notification } from '../models/Notification.js'
import { OnboardingActivity } from '../models/OnboardingActivity.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { OnboardingTemplate } from '../models/OnboardingTemplate.js'
import { Organization } from '../models/Organization.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import { PerformanceEvaluation } from '../models/PerformanceEvaluation.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { SimpleLmsPermission } from '../models/SimpleLmsPermission.js'
import { SimpleLmsProgram } from '../models/SimpleLmsProgram.js'
import SimpleLmsRequest from '../models/SimpleLmsRequest.js'
import { SimplePerformanceEvaluationConfig } from '../models/SimplePerformanceEvaluationConfig.js'
import Subscription from '../models/Subscription.js'
import SubscriptionRequest from '../models/SubscriptionRequest.js'
import { Team } from '../models/Team.js'
import { selectNextAvailableOrganizationId } from './organizationFallbackService.js'

export const ADMIN_ORGANIZATION_ACTIONS = {
  REMOVE_MEMBERS: 'remove_members',
  DELETE_ACCOUNTS: 'delete_accounts',
  DELETE_ORGANIZATION: 'delete_organization'
}

function toIdString(value) {
  if (!value) return ''
  return value._id?.toString?.() || value.toString()
}

function uniqueIdStrings(values = []) {
  return Array.from(
    new Set(
      values
        .map(value => toIdString(value))
        .filter(Boolean)
    )
  )
}

function getActiveMembers(organization) {
  return (organization?.members || []).filter(member => member.status === 'active')
}

function getActiveOwners(members = []) {
  return members.filter(member => member.role === 'owner')
}

function getActiveAdmins(members = []) {
  return members.filter(member => member.role === 'admin')
}

function findActiveMember(members = [], accountId) {
  const targetId = toIdString(accountId)
  return members.find(member => toIdString(member.account) === targetId && member.status === 'active') || null
}

async function updateAccountOrgRole(accountId, organizationId, role) {
  await Account.updateOne(
    { _id: accountId, 'organizations.organization': organizationId },
    { $set: { 'organizations.$.role': role } }
  )
}

export async function removeOrganizationMembershipsAndAssignFallback(
  accountIds = [],
  organizationId,
  options = {}
) {
  const normalizedAccountIds = uniqueIdStrings(accountIds)
  const removedOrganizationId = toIdString(organizationId)
  const currentAccountQuery = { currentOrganization: organizationId }
  if (!options.includeAllCurrentAccounts) {
    currentAccountQuery._id = { $in: normalizedAccountIds }
  }
  const currentAccounts = await Account.find(currentAccountQuery)
    .select('_id organizations')
    .lean()
  const currentAccountIds = new Set(currentAccounts.map(account => toIdString(account._id)))
  const nonCurrentAccountIds = normalizedAccountIds.filter(accountId => !currentAccountIds.has(accountId))
  const updatedAt = new Date()

  if (nonCurrentAccountIds.length > 0) {
    await Account.updateMany(
      { _id: { $in: nonCurrentAccountIds } },
      {
        $pull: {
          organizations: { organization: organizationId },
          teams: { organization: organizationId }
        },
        $set: { updatedAt }
      }
    )
  }

  const fallbackAssignments = currentAccounts.map((account) => ({
    accountId: toIdString(account._id),
    currentOrganization: selectNextAvailableOrganizationId(
      account.organizations,
      removedOrganizationId
    )
  }))

  if (fallbackAssignments.length > 0) {
    await Account.bulkWrite(fallbackAssignments.map((assignment) => {
      const update = {
        $pull: {
          organizations: { organization: organizationId },
          teams: { organization: organizationId }
        },
        $set: { updatedAt }
      }

      if (assignment.currentOrganization) {
        update.$set.currentOrganization = assignment.currentOrganization
      } else {
        update.$unset = { currentOrganization: '' }
      }

      return {
        updateOne: {
          filter: {
            _id: assignment.accountId,
            currentOrganization: organizationId
          },
          update
        }
      }
    }))
  }

  return fallbackAssignments
}

async function cleanupOrganizationMemberArtifacts(organizationId, accountIds = []) {
  const normalizedIds = uniqueIdStrings(accountIds)
  if (normalizedIds.length === 0) {
    return
  }

  const teams = await Team.find({
    organization: organizationId,
    $or: [
      { 'members.account': { $in: normalizedIds } },
      { manager: { $in: normalizedIds } }
    ]
  })

  for (const team of teams) {
    team.members = (team.members || []).filter(
      member => !normalizedIds.includes(toIdString(member.account))
    )
    await team.save()
  }

  await Account.updateMany(
    { _id: { $in: normalizedIds } },
    {
      $pull: {
        teams: { organization: organizationId }
      }
    }
  )

  await Promise.all([
    OnboardingActivity.deleteMany({
      organization: organizationId,
      $or: [
        { member: { $in: normalizedIds } },
        { actor: { $in: normalizedIds } }
      ]
    }),
    OnboardingAssignment.deleteMany({
      organization: organizationId,
      member: { $in: normalizedIds }
    }),
    LmsRole.deleteMany({
      organization: organizationId,
      account: { $in: normalizedIds }
    }),
    LmsAccessRequest.deleteMany({
      organization: organizationId,
      requestedBy: { $in: normalizedIds }
    }),
    PerformanceEvaluation.deleteMany({
      organization: organizationId,
      $or: [
        { evaluator: { $in: normalizedIds } },
        { evaluatedMember: { $in: normalizedIds } }
      ]
    }),
    SimpleLmsEnrollment.deleteMany({
      organization: organizationId,
      $or: [
        { enrolledMember: { $in: normalizedIds } },
        { enrolledBy: { $in: normalizedIds } }
      ]
    }),
    SimpleLmsPermission.deleteMany({
      organization: organizationId,
      account: { $in: normalizedIds }
    }),
    SimpleLmsRequest.deleteMany({
      organization: organizationId,
      $or: [
        { requestedBy: { $in: normalizedIds } },
        { targetAccount: { $in: normalizedIds } },
        { notificationRecipient: { $in: normalizedIds } }
      ]
    }),
    AppLaunchActivity.deleteMany({
      organization: organizationId,
      account: { $in: normalizedIds }
    }),
    Notification.updateMany(
      { organization: organizationId },
      {
        $pull: {
          recipients: {
            accountId: { $in: normalizedIds }
          }
        }
      }
    )
  ])
}

function validateReplacementMember(remainingActiveMembers, replacementId, label) {
  if (!replacementId) {
    throw new Error(`${label} is required before continuing.`)
  }

  const replacementMember = findActiveMember(remainingActiveMembers, replacementId)
  if (!replacementMember) {
    throw new Error(`${label} must be an active remaining member of the organization.`)
  }

  return replacementMember
}

function buildMemberSelectionState(organization, memberIds = []) {
  const selectedIds = uniqueIdStrings(memberIds)
  const activeMembers = getActiveMembers(organization)
  const selectedMembers = activeMembers.filter(member => selectedIds.includes(toIdString(member.account)))

  if (selectedMembers.length === 0) {
    throw new Error('Select at least one active member.')
  }

  const remainingActiveMembers = activeMembers.filter(
    member => !selectedIds.includes(toIdString(member.account))
  )

  return {
    activeMembers,
    selectedIds,
    selectedMembers,
    remainingActiveMembers
  }
}

export function buildOrganizationActionRequirements(organization, memberIds = []) {
  const {
    selectedIds,
    selectedMembers,
    remainingActiveMembers
  } = buildMemberSelectionState(organization, memberIds)

  const removingOwner = selectedMembers.some(member => member.role === 'owner')
  const removingAdmin = selectedMembers.some(member => member.role === 'admin')
  const organizationWillBeEmpty = remainingActiveMembers.length === 0
  const ownerReplacementRequired =
    !organizationWillBeEmpty &&
    removingOwner &&
    getActiveOwners(remainingActiveMembers).length === 0
  const adminReplacementRequired =
    !organizationWillBeEmpty &&
    removingAdmin &&
    getActiveAdmins(remainingActiveMembers).length === 0

  return {
    selectedIds,
    selectedMembers,
    remainingActiveMembers,
    organizationWillBeEmpty,
    ownerReplacementRequired,
    adminReplacementRequired
  }
}

export async function deleteOrganizationCascade(organization, options = {}) {
  if (!organization) {
    throw new Error('Organization not found')
  }

  const organizationId = toIdString(organization._id || organization)
  const existingOrganization = organization._id ? organization : await Organization.findById(organizationId)
  if (!existingOrganization) {
    throw new Error('Organization not found')
  }

  const memberIds = uniqueIdStrings((existingOrganization.members || []).map(member => member.account))

  const fallbackAssignments = await removeOrganizationMembershipsAndAssignFallback(
    memberIds,
    existingOrganization._id,
    { includeAllCurrentAccounts: true }
  )

  await Promise.all([
    Team.deleteMany({ organization: existingOrganization._id }),
    OrganizationInvite.deleteMany({ organization: existingOrganization._id }),
    Notification.deleteMany({ organization: existingOrganization._id }),
    OnboardingActivity.deleteMany({ organization: existingOrganization._id }),
    OnboardingAssignment.deleteMany({ organization: existingOrganization._id }),
    OnboardingTemplate.deleteMany({ organization: existingOrganization._id }),
    LmsRole.deleteMany({ organization: existingOrganization._id }),
    LmsAccessRequest.deleteMany({ organization: existingOrganization._id }),
    PerformanceEvaluation.deleteMany({ organization: existingOrganization._id }),
    SimpleLmsCourse.deleteMany({ organization: existingOrganization._id }),
    SimpleLmsEnrollment.deleteMany({ organization: existingOrganization._id }),
    SimpleLmsPermission.deleteMany({ organization: existingOrganization._id }),
    SimpleLmsProgram.deleteMany({ organization: existingOrganization._id }),
    SimpleLmsRequest.deleteMany({ organization: existingOrganization._id }),
    SimplePerformanceEvaluationConfig.deleteMany({ organization: existingOrganization._id }),
    AppLaunchActivity.deleteMany({ organization: existingOrganization._id }),
    Subscription.deleteMany({ organization: existingOrganization._id }),
    SubscriptionRequest.deleteMany({ organization: existingOrganization._id })
  ])

  await Organization.findByIdAndDelete(existingOrganization._id)

  return {
    deletedOrganizationId: organizationId,
    deletedMemberIds: memberIds,
    affectedAccountIds: uniqueIdStrings([
      ...memberIds,
      ...fallbackAssignments.map(assignment => assignment.accountId)
    ]),
    fallbackAssignments,
    deletedBy: options.deletedBy || null
  }
}

export async function removeMembersFromOrganization(organization, options = {}) {
  if (!organization?._id) {
    throw new Error('Organization not found')
  }

  const {
    memberIds = [],
    ownerReplacementId = '',
    adminReplacementId = '',
    deleteOrganizationIfEmpty = false,
    updatedBy = null
  } = options

  const selectionState = buildOrganizationActionRequirements(organization, memberIds)
  const {
    selectedIds,
    selectedMembers,
    remainingActiveMembers,
    organizationWillBeEmpty,
    ownerReplacementRequired: initialOwnerReplacementRequired
  } = selectionState

  if (organizationWillBeEmpty && !deleteOrganizationIfEmpty) {
    throw new Error('This action would leave the organization empty. Enable organization deletion to continue.')
  }

  const normalizedOwnerReplacementId = toIdString(ownerReplacementId)
  const normalizedAdminReplacementId = toIdString(adminReplacementId)
  const removingAdmin = selectedMembers.some(member => member.role === 'admin')

  const ownerReplacementRequired =
    !organizationWillBeEmpty &&
    initialOwnerReplacementRequired

  if (ownerReplacementRequired) {
    validateReplacementMember(remainingActiveMembers, normalizedOwnerReplacementId, 'Owner replacement')
  }

  const projectedRoleByAccountId = new Map(
    remainingActiveMembers.map(member => [toIdString(member.account), member.role])
  )

  if (ownerReplacementRequired) {
    projectedRoleByAccountId.set(normalizedOwnerReplacementId, 'owner')
  }

  const adminReplacementRequired =
    !organizationWillBeEmpty &&
    removingAdmin &&
    Array.from(projectedRoleByAccountId.values()).filter(role => role === 'admin').length === 0

  if (adminReplacementRequired) {
    validateReplacementMember(remainingActiveMembers, normalizedAdminReplacementId, 'Admin replacement')
  }

  if (
    ownerReplacementRequired &&
    adminReplacementRequired &&
    normalizedOwnerReplacementId &&
    normalizedOwnerReplacementId === normalizedAdminReplacementId
  ) {
    throw new Error('Choose different members for owner replacement and admin replacement.')
  }

  if (adminReplacementRequired) {
    const projectedOwnerCountAfterAdminReplacement = Array.from(projectedRoleByAccountId.entries())
      .filter(([accountId, role]) => {
        if (accountId === normalizedAdminReplacementId) {
          return false
        }
        return role === 'owner'
      })
      .length

    const replacementCurrentRole = projectedRoleByAccountId.get(normalizedAdminReplacementId)
    if (replacementCurrentRole === 'owner' && projectedOwnerCountAfterAdminReplacement === 0) {
      throw new Error('Choose an admin replacement who is not the last remaining owner.')
    }
  }

  const promotedAccountIds = []

  if (ownerReplacementRequired) {
    const replacementMember = findActiveMember(organization.members, normalizedOwnerReplacementId)
    replacementMember.role = 'owner'
    replacementMember.updatedAt = new Date()
    replacementMember.updatedBy = updatedBy || undefined
    organization.owner = replacementMember.account
    promotedAccountIds.push(normalizedOwnerReplacementId)
  }

  if (adminReplacementRequired) {
    const replacementMember = findActiveMember(organization.members, normalizedAdminReplacementId)
    replacementMember.role = 'admin'
    replacementMember.updatedAt = new Date()
    replacementMember.updatedBy = updatedBy || undefined
    promotedAccountIds.push(normalizedAdminReplacementId)
  }

  for (const department of organization.departments || []) {
    if (selectedIds.includes(toIdString(department.headAccount))) {
      department.headAccount = null
    }
  }

  organization.members = (organization.members || []).filter(
    member => !selectedIds.includes(toIdString(member.account))
  )

  await organization.save()

  if (ownerReplacementRequired) {
    await updateAccountOrgRole(normalizedOwnerReplacementId, organization._id, 'owner')
  }

  if (adminReplacementRequired) {
    await updateAccountOrgRole(normalizedAdminReplacementId, organization._id, 'admin')
  }

  const fallbackAssignments = await removeOrganizationMembershipsAndAssignFallback(
    selectedIds,
    organization._id
  )

  await cleanupOrganizationMemberArtifacts(organization._id, selectedIds)

  if (organizationWillBeEmpty && deleteOrganizationIfEmpty) {
    const deletionResult = await deleteOrganizationCascade(organization, { deletedBy: updatedBy })
    const combinedFallbackAssignments = [
      ...fallbackAssignments,
      ...(deletionResult.fallbackAssignments || [])
    ]
    return {
      action: ADMIN_ORGANIZATION_ACTIONS.REMOVE_MEMBERS,
      removedMemberIds: selectedIds,
      promotedAccountIds: uniqueIdStrings(promotedAccountIds),
      organizationDeleted: true,
      ...deletionResult,
      fallbackAssignments: combinedFallbackAssignments
    }
  }

  return {
    action: ADMIN_ORGANIZATION_ACTIONS.REMOVE_MEMBERS,
    removedMemberIds: selectedIds,
    promotedAccountIds: uniqueIdStrings(promotedAccountIds),
    fallbackAssignments,
    organizationDeleted: false,
    organizationId: toIdString(organization._id)
  }
}

async function validateAccountsForDeletion(accounts = [], organizationId, currentAdminId) {
  for (const account of accounts) {
    if (!account) {
      throw new Error('One or more selected accounts no longer exist.')
    }

    if (toIdString(account._id) === toIdString(currentAdminId)) {
      throw new Error('You cannot delete the account currently signed into the admin panel.')
    }

    if (account.isSystemAdmin || account.isSuperAdmin) {
      throw new Error(`Delete blocked for ${account.email}: system admin accounts must be managed from the admin users page.`)
    }

    const activeOrgIds = uniqueIdStrings(
      (account.organizations || [])
        .filter(membership => membership.isActive !== false)
        .map(membership => membership.organization)
    )

    if (activeOrgIds.length > 1 || (activeOrgIds.length === 1 && activeOrgIds[0] !== toIdString(organizationId))) {
      throw new Error(`Delete blocked for ${account.email}: remove the user from other organizations before deleting the account.`)
    }
  }
}

async function cleanupDeletedAccountArtifacts(accountIds = []) {
  const normalizedIds = uniqueIdStrings(accountIds)
  if (normalizedIds.length === 0) {
    return
  }

  await Promise.all([
    AppLaunchActivity.deleteMany({ account: { $in: normalizedIds } }),
    LmsAccessRequest.deleteMany({ requestedBy: { $in: normalizedIds } }),
    LmsRole.deleteMany({ account: { $in: normalizedIds } }),
    Notification.updateMany(
      {},
      {
        $pull: {
          recipients: {
            accountId: { $in: normalizedIds }
          }
        }
      }
    ),
    OnboardingActivity.deleteMany({
      $or: [
        { member: { $in: normalizedIds } },
        { actor: { $in: normalizedIds } }
      ]
    }),
    OnboardingAssignment.deleteMany({ member: { $in: normalizedIds } }),
    OrganizationInvite.deleteMany({
      $or: [
        { invitedBy: { $in: normalizedIds } },
        { acceptedBy: { $in: normalizedIds } },
        { rejectedBy: { $in: normalizedIds } }
      ]
    }),
    PerformanceEvaluation.deleteMany({
      $or: [
        { evaluator: { $in: normalizedIds } },
        { evaluatedMember: { $in: normalizedIds } }
      ]
    }),
    SimpleLmsEnrollment.deleteMany({
      $or: [
        { enrolledMember: { $in: normalizedIds } },
        { enrolledBy: { $in: normalizedIds } }
      ]
    }),
    SimpleLmsPermission.deleteMany({ account: { $in: normalizedIds } }),
    SimpleLmsRequest.deleteMany({
      $or: [
        { requestedBy: { $in: normalizedIds } },
        { targetAccount: { $in: normalizedIds } },
        { notificationRecipient: { $in: normalizedIds } }
      ]
    }),
    SimplePerformanceEvaluationConfig.updateMany(
      { updatedBy: { $in: normalizedIds } },
      {
        $unset: {
          updatedBy: ''
        }
      }
    ),
    SubscriptionRequest.deleteMany({
      requestedBy: { $in: normalizedIds }
    })
  ])
}

export async function deleteOrganizationAccounts(organization, options = {}) {
  const {
    memberIds = [],
    ownerReplacementId = '',
    adminReplacementId = '',
    deleteOrganizationIfEmpty = false,
    deletedBy = null
  } = options

  const selectedIds = uniqueIdStrings(memberIds)
  if (selectedIds.length === 0) {
    throw new Error('Select at least one account to delete.')
  }

  const accounts = await Account.find({ _id: { $in: selectedIds } })
  if (accounts.length !== selectedIds.length) {
    throw new Error('One or more selected accounts no longer exist.')
  }
  await validateAccountsForDeletion(accounts, organization?._id, deletedBy)

  const removalResult = await removeMembersFromOrganization(organization, {
    memberIds: selectedIds,
    ownerReplacementId,
    adminReplacementId,
    deleteOrganizationIfEmpty,
    updatedBy: deletedBy
  })

  await cleanupDeletedAccountArtifacts(selectedIds)
  await Account.deleteMany({ _id: { $in: selectedIds } })

  return {
    action: ADMIN_ORGANIZATION_ACTIONS.DELETE_ACCOUNTS,
    deletedAccountIds: selectedIds,
    promotedAccountIds: removalResult.promotedAccountIds || [],
    organizationDeleted: removalResult.organizationDeleted === true,
    deletedOrganizationId: removalResult.deletedOrganizationId || null,
    removedMemberIds: removalResult.removedMemberIds || selectedIds
  }
}
