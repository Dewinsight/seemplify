import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import {
  defaultLearningRoleForOrganizationRole,
  normalizeOrganizationLearningAccess,
  normalizeOrganizationLearningRole,
  organizationClaimAllowsLearning
} from '../utils/organizationLearning.js'

const IDP_ORGANIZATION_ROLES = new Set([
  'owner',
  'admin',
  'hr_manager',
  'recruiter',
  'interviewer',
  'staff'
])

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const toIdString = (value) => String(value?._id || value || '').trim()

const normalizeOrganizationRole = (value) => {
  const role = String(value || '').trim().toLowerCase()
  return IDP_ORGANIZATION_ROLES.has(role) ? role : 'staff'
}

const normalizeAppAccess = (raw = {}) => {
  const mode = String(raw?.mode || 'all').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
  const appIds = mode === 'selected'
    ? Array.from(new Set((Array.isArray(raw?.appIds) ? raw.appIds : []).map((value) => String(value || '').trim()).filter(Boolean)))
    : []
  return { mode, appIds }
}

const learningPermissionsFromClaim = (claim = {}) => {
  const permissionsByApp = claim?.authorization?.permissionsByApp || claim?.appPermissions
  if (!permissionsByApp || !Object.prototype.hasOwnProperty.call(permissionsByApp, 'seemplify-learning')) return null
  return new Set(Array.isArray(permissionsByApp['seemplify-learning'])
    ? permissionsByApp['seemplify-learning'].map((value) => String(value || '').trim()).filter(Boolean)
    : [])
}

const learningRoleFromPermissions = (permissions, organizationRole) => {
  if (!(permissions instanceof Set)) return defaultLearningRoleForOrganizationRole(organizationRole)
  if (['platform.manage', 'courses.manage', 'partners.manage', 'sales.manage']
    .some((permission) => permissions.has(permission))) return 'learning_admin'
  if (permissions.has('learners.manage')) return 'learning_manager'
  if (permissions.has('courses.create')) return 'instructor'
  return 'learner'
}

const buildLearningAccess = ({ existingAccess, organizationRole, enabled, idpPermissions = null }) => {
  const current = normalizeOrganizationLearningAccess(existingAccess, organizationRole)
  if (!(idpPermissions instanceof Set) && current.managedBy === 'organization_admin') {
    return {
      enabled,
      role: current.role,
      catalogAccess: current.catalogAccess,
      managedBy: 'organization_admin',
      updatedAt: current.updatedAt || new Date(),
      updatedBy: current.updatedBy || null
    }
  }
  return {
    enabled,
    role: learningRoleFromPermissions(idpPermissions, organizationRole),
    catalogAccess: 'all_available',
    managedBy: 'idp_default',
    updatedAt: new Date(),
    updatedBy: null
  }
}

const findOrganizationByIdpId = async (idpOrganizationId) => {
  const normalizedId = String(idpOrganizationId || '').trim()
  if (!normalizedId) return null
  const filters = [{ idpOrganizationId: normalizedId }]
  if (mongoose.Types.ObjectId.isValid(normalizedId)) filters.push({ _id: normalizedId })
  return Organization.findOne({ $or: filters })
}

const resolveAccountIdentity = async ({ sub, email }) => {
  const normalizedSub = String(sub || '').trim()
  const normalizedEmail = normalizeEmail(email)
  const [byIdpSubject, bySub, byEmail] = await Promise.all([
    normalizedSub ? Account.findOne({ idpSubject: normalizedSub }) : null,
    normalizedSub ? Account.findOne({ sub: normalizedSub }) : null,
    normalizedEmail ? Account.findOne({ email: normalizedEmail }) : null
  ])
  const matches = [byIdpSubject, bySub, byEmail].filter(Boolean)
  const distinctIds = new Set(matches.map((account) => toIdString(account._id)))
  if (distinctIds.size > 1) {
    const error = new Error('This Seemplify identity is already linked to a different Learning account.')
    error.code = 'IDP_SUBJECT_CONFLICT'
    throw error
  }
  const account = matches[0] || null
  if (account?.idpSubject && String(account.idpSubject) !== normalizedSub) {
    const error = new Error('This Learning account is linked to a different Seemplify identity.')
    error.code = 'IDP_SUBJECT_CONFLICT'
    throw error
  }
  return account
}

const upsertIdpAccount = async ({ identity, emailVerified = true }) => {
  const sub = String(identity?.sub || '').trim()
  const email = normalizeEmail(identity?.email)
  if (!sub || !email) throw new Error('The identity provider did not return a stable subject and email.')

  let account = await resolveAccountIdentity({ sub, email })
  if (!account) {
    account = new Account({
      sub,
      idpSubject: sub,
      email,
      emailVerified: emailVerified !== false,
      profile: {
        name: String(identity?.name || '').trim(),
        preferred_username: String(identity?.preferred_username || '').trim()
      },
      passwordHash: undefined,
      learningRole: 'learner',
      authentication: {
        passwordEnabled: false,
        seemplifyEnabled: true,
        seemplifyLinkedAt: new Date(),
        lastSeemplifyLoginAt: new Date()
      }
    })
  } else {
    account.idpSubject = account.idpSubject || sub
    account.email = email
    account.emailVerified = emailVerified !== false
    account.profile = account.profile || {}
    if (identity?.name) account.profile.name = String(identity.name).trim()
    if (identity?.preferred_username) account.profile.preferred_username = String(identity.preferred_username).trim()
    account.authentication = account.authentication || {}
    account.authentication.passwordEnabled = Boolean(account.passwordHash)
    account.authentication.seemplifyEnabled = true
    account.authentication.seemplifyLinkedAt = account.authentication.seemplifyLinkedAt || new Date()
    account.authentication.lastSeemplifyLoginAt = new Date()
  }

  await account.save()
  return account
}

const upsertOrganizationMembership = async ({
  account,
  organization,
  organizationRole,
  appAccess,
  enabled,
  idpPermissions = null,
  profile = {}
}) => {
  const normalizedRole = normalizeOrganizationRole(organizationRole)
  const localOrganizationId = toIdString(organization._id)
  const normalizedAppAccess = normalizeAppAccess(appAccess)

  let organizationMember = (organization.members || []).find((entry) => (
    toIdString(entry.account) === toIdString(account._id)
  ))
  const organizationLearningAccess = buildLearningAccess({
    existingAccess: organizationMember?.learningAccess,
    organizationRole: normalizedRole,
    enabled,
    idpPermissions
  })

  if (!organizationMember) {
    organization.members.push({
      account: account._id,
      role: normalizedRole,
      appAccess: normalizedAppAccess,
      learningAccess: organizationLearningAccess,
      status: 'active',
      joinedAt: new Date(),
      idpProfile: {
        designation: String(profile?.designation || '').trim(),
        employeeId: String(profile?.employeeId || '').trim(),
        departmentName: String(profile?.departmentName || '').trim(),
        teamNames: Array.isArray(profile?.teamNames) ? profile.teamNames : [],
        lastSyncedAt: new Date()
      }
    })
    organizationMember = organization.members[organization.members.length - 1]
  } else {
    organizationMember.role = normalizedRole
    organizationMember.appAccess = normalizedAppAccess
    organizationMember.learningAccess = organizationLearningAccess
    organizationMember.status = 'active'
    organizationMember.updatedAt = new Date()
    organizationMember.idpProfile = {
      designation: String(profile?.designation || organizationMember.idpProfile?.designation || '').trim(),
      employeeId: String(profile?.employeeId || organizationMember.idpProfile?.employeeId || '').trim(),
      departmentName: String(profile?.departmentName || organizationMember.idpProfile?.departmentName || '').trim(),
      teamNames: Array.isArray(profile?.teamNames) ? profile.teamNames : (organizationMember.idpProfile?.teamNames || []),
      lastSyncedAt: new Date()
    }
  }

  if (normalizedRole === 'owner') organization.owner = account._id
  await organization.save()

  account.organizations = Array.isArray(account.organizations) ? account.organizations : []
  let accountMembership = account.organizations.find((entry) => (
    toIdString(entry.organization) === localOrganizationId
  ))
  if (!accountMembership) {
    account.organizations.push({
      organization: organization._id,
      role: normalizedRole,
      appAccess: normalizedAppAccess,
      learningAccess: organizationLearningAccess,
      joinedAt: new Date(),
      isActive: true
    })
    accountMembership = account.organizations[account.organizations.length - 1]
  } else {
    accountMembership.role = normalizedRole
    accountMembership.appAccess = normalizedAppAccess
    accountMembership.learningAccess = organizationLearningAccess
    accountMembership.isActive = true
  }
  await account.save()

  return { organizationMember, accountMembership }
}

const upsertIdpOrganization = async ({ claim, ownerAccount }) => {
  const idpOrganizationId = String(claim?.id || '').trim()
  if (!idpOrganizationId) throw new Error('An organization claim is missing its id.')
  let organization = await findOrganizationByIdpId(idpOrganizationId)
  if (!organization) {
    organization = new Organization({
      name: String(claim?.name || `Organization ${idpOrganizationId.slice(-8)}`).trim(),
      idpOrganizationId,
      owner: ownerAccount._id,
      members: [],
      settings: {
        simpleLms: {
          defaultCurrency: 'NGN',
          allowedCurrencies: ['NGN'],
          allowSystemCourses: true,
          allowExternalPublicCourses: true,
          defaultCourseAudience: 'all_members'
        }
      }
    })
  } else {
    organization.idpOrganizationId = organization.idpOrganizationId || idpOrganizationId
    if (claim?.name) organization.name = String(claim.name).trim()
  }
  await organization.save()
  return organization
}

export async function syncIdpUserAndOrganizations(userinfo = {}) {
  const account = await upsertIdpAccount({
    identity: userinfo,
    emailVerified: userinfo.email_verified !== false
  })
  const organizationClaims = Array.isArray(userinfo.organizations) ? userinfo.organizations : []
  const allowedClaims = organizationClaims.filter((claim) => {
    if (!organizationClaimAllowsLearning(claim)) return false
    const permissions = learningPermissionsFromClaim(claim)
    return permissions === null || permissions.has('workspace.access') || permissions.has('platform.manage')
  })
  if (organizationClaims.length > 0 && allowedClaims.length === 0) {
    const error = new Error('Your organisation has not assigned Seemplify Learning to this account.')
    error.code = 'IDP_LEARNING_ACCESS_DENIED'
    throw error
  }

  const localOrganizationByIdpId = new Map()
  for (const claim of allowedClaims) {
    const organization = await upsertIdpOrganization({ claim, ownerAccount: account })
    await upsertOrganizationMembership({
      account,
      organization,
      organizationRole: claim.role,
      appAccess: claim.appAccess,
      enabled: true,
      idpPermissions: learningPermissionsFromClaim(claim),
      profile: claim
    })
    localOrganizationByIdpId.set(String(claim.id), organization)
  }

  const currentIdpOrganizationId = String(
    userinfo.current_organization?.id
    || userinfo.currentOrganization?.id
    || ''
  ).trim()
  const selectedOrganization = localOrganizationByIdpId.get(currentIdpOrganizationId)
    || localOrganizationByIdpId.values().next().value
    || null
  if (selectedOrganization?._id) {
    account.currentOrganization = selectedOrganization._id
    await account.save()
  }

  return {
    account,
    organizations: Array.from(localOrganizationByIdpId.values()),
    currentOrganization: selectedOrganization
  }
}

export async function syncIdpOrganizationMembers({ organization, remoteMembers = [] }) {
  const results = { created: 0, updated: 0, skipped: [] }
  for (const member of Array.isArray(remoteMembers) ? remoteMembers : []) {
    try {
      const existing = await resolveAccountIdentity({ sub: member?.sub, email: member?.email })
      const account = await upsertIdpAccount({
        identity: {
          sub: member?.sub,
          email: member?.email,
          name: member?.name,
          preferred_username: member?.email ? String(member.email).split('@')[0] : ''
        },
        emailVerified: member?.emailVerified !== false
      })
      const enabled = organizationClaimAllowsLearning(member)
      await upsertOrganizationMembership({
        account,
        organization,
        organizationRole: member?.role,
        appAccess: member?.appAccess,
        enabled: enabled && (() => {
          const permissions = learningPermissionsFromClaim(member)
          return permissions === null || permissions.has('workspace.access') || permissions.has('platform.manage')
        })(),
        idpPermissions: learningPermissionsFromClaim(member),
        profile: member
      })
      if (existing) results.updated += 1
      else results.created += 1
    } catch (error) {
      results.skipped.push({
        email: normalizeEmail(member?.email),
        reason: error.message || 'Failed to synchronize member.'
      })
    }
  }
  return results
}

export async function updateMemberLearningAccess({ organization, accountId, role, catalogAccess, updatedBy }) {
  if (organization.idpOrganizationId) {
    const error = new Error('Learning roles for this organisation are managed by Seemplify Identity. Update the member permission matrix in the IdP.')
    error.code = 'IDP_ACCESS_CONTROL_REQUIRED'
    throw error
  }
  const member = (organization.members || []).find((entry) => (
    entry.status === 'active' && toIdString(entry.account) === toIdString(accountId)
  ))
  if (!member) throw new Error('Staff member was not found in this organisation.')
  if (member.learningAccess?.enabled === false) {
    throw new Error('Assign Seemplify Learning to this staff member in the IdP before changing Learning access.')
  }

  const currentAccess = normalizeOrganizationLearningAccess(member.learningAccess, member.role)
  const nextRole = normalizeOrganizationLearningRole(role, currentAccess.role)
  if (currentAccess.role === 'learning_admin' && nextRole !== 'learning_admin') {
    const otherLearningAdminExists = (organization.members || []).some((entry) => (
      entry.status === 'active'
      && toIdString(entry.account) !== toIdString(accountId)
      && normalizeOrganizationLearningAccess(entry.learningAccess, entry.role).enabled
      && normalizeOrganizationLearningAccess(entry.learningAccess, entry.role).role === 'learning_admin'
    ))
    if (!otherLearningAdminExists) {
      throw new Error('Assign another Learning admin before changing the last Learning admin role.')
    }
  }

  const access = normalizeOrganizationLearningAccess({
    role: nextRole,
    catalogAccess,
    enabled: true,
    managedBy: 'organization_admin',
    updatedAt: new Date(),
    updatedBy
  }, member.role)
  member.learningAccess = access
  member.updatedAt = new Date()
  member.updatedBy = updatedBy
  await organization.save()

  await Account.updateOne(
    { _id: accountId, 'organizations.organization': organization._id },
    {
      $set: {
        'organizations.$.learningAccess': access
      }
    }
  )
  return access
}

export { findOrganizationByIdpId, learningPermissionsFromClaim, learningRoleFromPermissions, normalizeOrganizationRole }
