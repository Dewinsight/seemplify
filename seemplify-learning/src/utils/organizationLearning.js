export const ORGANIZATION_LEARNING_ROLES = Object.freeze([
  'learner',
  'instructor',
  'learning_manager',
  'learning_admin'
])

export const ORGANIZATION_CATALOG_ACCESS = Object.freeze([
  'all_available',
  'organization_only',
  'assigned_only'
])

export const COURSE_AUDIENCE_MODES = Object.freeze([
  'all_members',
  'learning_roles',
  'selected_members'
])

const IDP_LEARNING_APP_IDS = new Set(['seemplify-learning', 'learning'])

const ROLE_CAPABILITIES = Object.freeze({
  learner: Object.freeze({
    canCreateCourses: false,
    canAssignCourses: false,
    canManageLearning: false
  }),
  instructor: Object.freeze({
    canCreateCourses: true,
    canAssignCourses: false,
    canManageLearning: false
  }),
  learning_manager: Object.freeze({
    canCreateCourses: true,
    canAssignCourses: true,
    canManageLearning: false
  }),
  learning_admin: Object.freeze({
    canCreateCourses: true,
    canAssignCourses: true,
    canManageLearning: true
  })
})

const toIdString = (value) => String(value?._id || value || '').trim()

export function normalizeOrganizationLearningRole(value, fallback = 'learner') {
  const normalized = String(value || '').trim().toLowerCase()
  return ORGANIZATION_LEARNING_ROLES.includes(normalized) ? normalized : fallback
}

export function normalizeOrganizationCatalogAccess(value, fallback = 'all_available') {
  const normalized = String(value || '').trim().toLowerCase()
  return ORGANIZATION_CATALOG_ACCESS.includes(normalized) ? normalized : fallback
}

export function normalizeCourseAudienceMode(value, fallback = 'all_members') {
  const normalized = String(value || '').trim().toLowerCase()
  return COURSE_AUDIENCE_MODES.includes(normalized) ? normalized : fallback
}

export function defaultLearningRoleForOrganizationRole(value) {
  const role = String(value || '').trim().toLowerCase()
  if (role === 'owner' || role === 'admin') return 'learning_admin'
  if (role === 'hr_manager') return 'learning_manager'
  return 'learner'
}

export function normalizeOrganizationLearningAccess(raw = {}, organizationRole = 'staff') {
  const fallbackRole = defaultLearningRoleForOrganizationRole(organizationRole)
  const role = normalizeOrganizationLearningRole(raw?.role, fallbackRole)
  const capabilities = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.learner

  return {
    enabled: raw?.enabled !== false,
    role,
    catalogAccess: normalizeOrganizationCatalogAccess(raw?.catalogAccess, 'all_available'),
    canCreateCourses: capabilities.canCreateCourses,
    canAssignCourses: capabilities.canAssignCourses,
    canManageLearning: capabilities.canManageLearning,
    managedBy: String(raw?.managedBy || '').trim().toLowerCase() === 'organization_admin'
      ? 'organization_admin'
      : 'idp_default',
    updatedAt: raw?.updatedAt || null,
    updatedBy: raw?.updatedBy || null
  }
}

export function organizationClaimAllowsLearning(claim = {}) {
  const mode = String(claim?.appAccess?.mode || 'all').trim().toLowerCase()
  if (mode !== 'selected') return true
  const appIds = Array.isArray(claim?.appAccess?.appIds) ? claim.appAccess.appIds : []
  return appIds.some((appId) => IDP_LEARNING_APP_IDS.has(String(appId || '').trim().toLowerCase()))
}

export function resolveAccountOrganizationLearningAccess(account) {
  const currentOrganizationId = toIdString(account?.currentOrganization)
  if (!currentOrganizationId) return null
  const membership = (Array.isArray(account?.organizations) ? account.organizations : []).find((entry) => (
    entry?.isActive !== false && toIdString(entry?.organization) === currentOrganizationId
  ))
  if (!membership) return null
  const access = normalizeOrganizationLearningAccess(membership.learningAccess, membership.role)
  return {
    organizationId: currentOrganizationId,
    organizationRole: String(membership.role || 'staff').trim().toLowerCase(),
    ...access
  }
}

export function courseAudienceAllowsMember(course, { accountId, learningRole } = {}) {
  const audience = course?.audience || {}
  const mode = normalizeCourseAudienceMode(audience.mode, 'all_members')
  if (mode === 'all_members') return true

  if (mode === 'learning_roles') {
    const allowedRoles = (Array.isArray(audience.learningRoles) ? audience.learningRoles : [])
      .map((role) => normalizeOrganizationLearningRole(role, ''))
      .filter(Boolean)
    return allowedRoles.includes(normalizeOrganizationLearningRole(learningRole, 'learner'))
  }

  const normalizedAccountId = toIdString(accountId)
  return Boolean(normalizedAccountId) && (Array.isArray(audience.members) ? audience.members : [])
    .some((memberId) => toIdString(memberId) === normalizedAccountId)
}

export function courseIsAvailableToOrganizationMember(course, {
  accountId,
  organizationId,
  learningAccess,
  organizationSettings = {}
} = {}) {
  if (!course || course.isActive === false || String(course.status || '') !== 'published') return false

  const visibility = String(course.visibility || '').trim().toLowerCase()
  const courseOrganizationId = toIdString(course.organization)
  const normalizedOrganizationId = toIdString(organizationId)
  const access = normalizeOrganizationLearningAccess(learningAccess)

  if (visibility === 'organization_private') {
    if (!normalizedOrganizationId || courseOrganizationId !== normalizedOrganizationId) return false
    return courseAudienceAllowsMember(course, {
      accountId,
      learningRole: access.role
    })
  }

  if (access.catalogAccess === 'assigned_only') return false

  if (visibility === 'system_public') {
    return access.catalogAccess === 'all_available'
      && organizationSettings?.allowSystemCourses !== false
  }

  if (visibility === 'organization_public') {
    if (access.catalogAccess === 'organization_only') {
      return Boolean(normalizedOrganizationId) && courseOrganizationId === normalizedOrganizationId
    }
    return organizationSettings?.allowExternalPublicCourses !== false
      || (Boolean(normalizedOrganizationId) && courseOrganizationId === normalizedOrganizationId)
  }

  return false
}

export function sanitizeCourseAudience(raw = {}, validMemberIds = []) {
  const validMemberSet = new Set((validMemberIds || []).map(toIdString).filter(Boolean))
  const mode = normalizeCourseAudienceMode(raw?.mode, 'all_members')
  const learningRoles = Array.from(new Set(
    (Array.isArray(raw?.learningRoles) ? raw.learningRoles : [raw?.learningRoles])
      .map((role) => normalizeOrganizationLearningRole(role, ''))
      .filter(Boolean)
  ))
  const members = Array.from(new Set(
    (Array.isArray(raw?.members) ? raw.members : [raw?.members])
      .map(toIdString)
      .filter((memberId) => validMemberSet.has(memberId))
  ))

  return {
    mode,
    learningRoles: mode === 'learning_roles' ? learningRoles : [],
    members: mode === 'selected_members' ? members : []
  }
}

export function formatOrganizationLearningRole(value) {
  const role = normalizeOrganizationLearningRole(value)
  return {
    learner: 'Learner',
    instructor: 'Instructor',
    learning_manager: 'Learning manager',
    learning_admin: 'Learning admin'
  }[role]
}
