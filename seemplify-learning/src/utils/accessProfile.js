import mongoose from 'mongoose'
import { Organization } from '../models/Organization.js'
import { DEFAULT_LEARNING_ROLE, normalizeLearningRole } from './learningRoles.js'

const PARTNER_TYPES = new Set(['partner', 'channel_partner'])
const PARTNER_MEMBER_ROLES = new Set(['owner', 'admin', 'partner_admin', 'partner_user'])
const AGENT_MEMBER_ROLE = 'sales_agent'
const PRIVILEGED_DASHBOARDS = new Set(['admin', 'partner', 'agent'])

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const normalizePartnerType = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return PARTNER_TYPES.has(normalized) ? normalized : 'none'
}

const normalizeMemberRole = (value) => String(value || '').trim().toLowerCase()

const resolvePlatformRole = (account) => {
  const learningRole = normalizeLearningRole(account?.learningRole, DEFAULT_LEARNING_ROLE)
  if (account?.isSuperAdmin || learningRole === 'super_admin') return 'super_admin'
  if (account?.isSystemAdmin || learningRole === 'admin') return 'admin'
  return null
}

const resolveBaseLearningRole = (account) => {
  const learningRole = normalizeLearningRole(account?.learningRole, DEFAULT_LEARNING_ROLE)
  if (!['super_admin', 'admin'].includes(learningRole)) return learningRole
  const fallbackRole = normalizeLearningRole(account?.roleMetadata?.previousLearningRole, DEFAULT_LEARNING_ROLE)
  return ['super_admin', 'admin'].includes(fallbackRole) ? DEFAULT_LEARNING_ROLE : fallbackRole
}

const resolvePartnerDashboardRole = ({ partnerType, memberRole }) => {
  if (!PARTNER_TYPES.has(partnerType)) return ''
  if (memberRole === AGENT_MEMBER_ROLE) return 'channel_sales_agent'
  if (['owner', 'admin', 'partner_admin'].includes(memberRole)) {
    return partnerType === 'channel_partner' ? 'channel_partner_super' : 'partner_super'
  }
  if (memberRole === 'partner_user') {
    return partnerType === 'channel_partner' ? 'channel_partner_user' : 'partner_user'
  }
  return ''
}

const buildProfileFromContext = ({
  account,
  organization = null,
  memberRole = '',
  source = 'none'
}) => {
  const platformRole = resolvePlatformRole(account)
  const baseLearningRole = resolveBaseLearningRole(account)
  const normalizedPartnerType = normalizePartnerType(organization?.partnerType)
  const normalizedMemberRole = normalizeMemberRole(memberRole)
  const dashboardRole = resolvePartnerDashboardRole({
    partnerType: normalizedPartnerType,
    memberRole: normalizedMemberRole
  })

  let partnerAccess = null
  let agentAccess = null
  const violations = []

  if (dashboardRole === 'channel_sales_agent') {
    if (platformRole) {
      violations.push('agent_cannot_mix_with_platform_admin')
    } else {
      agentAccess = {
        organizationId: toIdString(organization?._id),
        organizationName: String(organization?.name || '').trim(),
        partnerType: normalizedPartnerType,
        memberRole: normalizedMemberRole,
        dashboardRole
      }
    }
  } else if (dashboardRole) {
    partnerAccess = {
      organizationId: toIdString(organization?._id),
      organizationName: String(organization?.name || '').trim(),
      partnerType: normalizedPartnerType,
      memberRole: normalizedMemberRole,
      dashboardRole
    }
  }

  const availableDashboards = []
  if (platformRole) availableDashboards.push('admin')
  if (partnerAccess) availableDashboards.push('partner')
  if (agentAccess) availableDashboards.push('agent')
  availableDashboards.push('workspace')

  const privilegedDashboardCount = availableDashboards.filter((key) => PRIVILEGED_DASHBOARDS.has(key)).length

  return {
    platformRole,
    baseLearningRole,
    partnerAccess,
    agentAccess,
    availableDashboards,
    hasMultiplePrivilegedDashboards: privilegedDashboardCount > 1,
    privilegedDashboardCount,
    source,
    violations
  }
}

const getOrganizationCandidates = (account) => {
  const candidateIds = []
  const pushId = (value) => {
    const id = toIdString(value)
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return
    if (!candidateIds.includes(id)) candidateIds.push(id)
  }

  pushId(account?.partnerOrganization)
  pushId(account?.currentOrganization)
  ;(Array.isArray(account?.organizations) ? account.organizations : []).forEach((membership) => {
    if (membership?.isActive === false) return
    pushId(membership?.organization)
  })
  return candidateIds
}

const pickMemberFromOrganization = ({ account, organization }) => {
  if (!organization || normalizePartnerType(organization.partnerType) === 'none') return null
  const member = (organization.members || []).find((entry) => {
    if (toIdString(entry.account) !== toIdString(account?._id)) return false
    const status = String(entry.status || 'active').trim().toLowerCase()
    return status === 'active'
  })
  if (!member) return null
  const memberRole = normalizeMemberRole(member.role)
  if (!PARTNER_MEMBER_ROLES.has(memberRole) && memberRole !== AGENT_MEMBER_ROLE) return null
  return member
}

export function buildAccessProfileSnapshot(account, context = {}) {
  const organization = context?.organization || null
  const memberRole = context?.memberRole || ''
  return buildProfileFromContext({
    account,
    organization,
    memberRole,
    source: context?.source || 'snapshot'
  })
}

export async function resolveAccessProfile(account, options = {}) {
  if (!account?._id) {
    return buildProfileFromContext({ account: null })
  }

  const candidateIds = getOrganizationCandidates(account)
  const preloadedOrganizations = Array.isArray(options.organizations) ? options.organizations : []
  const organizationsById = new Map(
    preloadedOrganizations
      .map((organization) => [toIdString(organization?._id), organization])
      .filter((entry) => entry[0])
  )

  const missingIds = candidateIds.filter((id) => !organizationsById.has(id))
  if (missingIds.length > 0) {
    const loadedOrganizations = await Organization.find({
      _id: { $in: missingIds },
      partnerType: { $in: ['partner', 'channel_partner'] }
    }).lean()
    loadedOrganizations.forEach((organization) => {
      organizationsById.set(toIdString(organization._id), organization)
    })
  }

  for (const organizationId of candidateIds) {
    const organization = organizationsById.get(organizationId)
    const member = pickMemberFromOrganization({ account, organization })
    if (!organization || !member) continue
    return buildProfileFromContext({
      account,
      organization,
      memberRole: member.role,
      source: 'active_organization'
    })
  }

  const fallbackOrganization = await Organization.findOne({
    partnerType: { $in: ['partner', 'channel_partner'] },
    members: {
      $elemMatch: {
        account: account._id,
        status: 'active',
        role: { $in: ['owner', 'admin', 'partner_admin', 'partner_user', 'sales_agent'] }
      }
    }
  }).lean()

  if (fallbackOrganization) {
    const member = pickMemberFromOrganization({ account, organization: fallbackOrganization })
    if (member) {
      return buildProfileFromContext({
        account,
        organization: fallbackOrganization,
        memberRole: member.role,
        source: 'organization_membership_lookup'
      })
    }
  }

  return buildProfileFromContext({ account, source: 'account_only' })
}

export function getDashboardPathForKey(key) {
  if (key === 'admin') return '/admin'
  if (key === 'partner') return '/partner-dashboard'
  if (key === 'agent') return '/agent-dashboard'
  return '/simple-lms'
}

const getPathname = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized.startsWith('/')) return ''
  const [pathname] = normalized.split(/[?#]/, 1)
  return pathname || ''
}

export function canAccessReturnPath(accessProfile, path) {
  const pathname = getPathname(path)
  if (!pathname) return false
  if (pathname.startsWith('/admin')) return Boolean(accessProfile?.platformRole)
  if (pathname.startsWith('/partner-dashboard')) return Boolean(accessProfile?.partnerAccess)
  if (pathname.startsWith('/agent-dashboard')) return Boolean(accessProfile?.agentAccess)
  return true
}

export function isPrivilegedDashboardRoot(path) {
  const pathname = getPathname(path)
  return ['/admin', '/partner-dashboard', '/agent-dashboard'].includes(pathname)
}

export function getDefaultDashboardPath(accessProfile, fallback = '/simple-lms') {
  if (accessProfile?.platformRole) return '/admin'
  if (accessProfile?.partnerAccess) return '/partner-dashboard'
  if (accessProfile?.agentAccess) return '/agent-dashboard'
  return fallback
}

export function shouldUseWorkspaceChooser(accessProfile, returnTo = '') {
  if (!accessProfile?.hasMultiplePrivilegedDashboards) return false
  if (canAccessReturnPath(accessProfile, returnTo) && !isPrivilegedDashboardRoot(returnTo)) {
    return false
  }
  return true
}
