export const LEARNING_ROLES = Object.freeze([
  'super_admin',
  'admin',
  'creator',
  'learner',
  'channel_partner_super',
  'channel_partner_user',
  'channel_sales_agent',
  'partner_super',
  'partner_user'
])

export const DEFAULT_LEARNING_ROLE = 'learner'

export const REGISTRATION_INTENTS = Object.freeze([
  'learn',
  'teach',
  'partner',
  'channel_partner',
  'unknown'
])

export const ACTIVE_REGISTRATION_INTENTS = Object.freeze([
  'learn',
  'teach',
  'partner',
  'channel_partner'
])

export const PARTNER_REGISTRATION_INTENTS = Object.freeze([
  'partner',
  'channel_partner'
])

export const PLATFORM_ADMIN_ROLES = Object.freeze([
  'super_admin',
  'admin'
])

export const PARTNER_DASHBOARD_ROLES = Object.freeze([
  'channel_partner_super',
  'channel_partner_user',
  'partner_super',
  'partner_user'
])

export const CHANNEL_PARTNER_DASHBOARD_ROLES = Object.freeze([
  'channel_partner_super',
  'channel_partner_user'
])

export const PARTNER_SUPER_ROLES = Object.freeze([
  'channel_partner_super',
  'partner_super'
])

export const AGENT_DASHBOARD_ROLES = Object.freeze([
  'channel_sales_agent'
])

export const ORGANIZATION_MEMBER_ROLES = Object.freeze([
  'owner',
  'admin',
  'hr_manager',
  'recruiter',
  'interviewer',
  'staff',
  'partner_admin',
  'partner_user',
  'sales_agent'
])

export const PARTNER_ORGANIZATION_MEMBER_ROLES = Object.freeze([
  'owner',
  'admin',
  'partner_admin',
  'partner_user',
  'sales_agent'
])

export const PARTNER_TYPES = Object.freeze([
  'none',
  'channel_partner',
  'partner'
])

export const PARTNER_STATUS_VALUES = Object.freeze([
  'pending',
  'active',
  'suspended'
])

export const INTENT_DEFAULT_ROLE_MAP = Object.freeze({
  learn: 'learner',
  teach: 'learner',
  partner: 'learner',
  channel_partner: 'learner'
})

export const INTENT_APPROVAL_ROLE_MAP = Object.freeze({
  partner: 'partner_user',
  channel_partner: 'channel_partner_user'
})

export const INTENT_PARTNER_TYPE_MAP = Object.freeze({
  partner: 'partner',
  channel_partner: 'channel_partner'
})

export function normalizeLearningRole(value, fallback = DEFAULT_LEARNING_ROLE) {
  const normalized = String(value || '').trim().toLowerCase()
  return LEARNING_ROLES.includes(normalized) ? normalized : fallback
}

export function normalizeRegistrationIntent(value, fallback = 'learn') {
  const normalized = String(value || '').trim().toLowerCase()
  return REGISTRATION_INTENTS.includes(normalized) ? normalized : fallback
}

export function normalizePartnerType(value, fallback = 'none') {
  const normalized = String(value || '').trim().toLowerCase()
  return PARTNER_TYPES.includes(normalized) ? normalized : fallback
}

export function resolveLearningRole(account) {
  if (!account) return DEFAULT_LEARNING_ROLE
  if (account.isSuperAdmin) return 'super_admin'
  if (account.isSystemAdmin) return 'admin'
  return normalizeLearningRole(account.learningRole, DEFAULT_LEARNING_ROLE)
}

export function isPlatformAdminRole(role) {
  const normalizedRole = normalizeLearningRole(role)
  return PLATFORM_ADMIN_ROLES.includes(normalizedRole)
}

export function isPartnerDashboardRole(role) {
  const normalizedRole = normalizeLearningRole(role)
  return PARTNER_DASHBOARD_ROLES.includes(normalizedRole)
}

export function isAgentRole(role) {
  const normalizedRole = normalizeLearningRole(role)
  return AGENT_DASHBOARD_ROLES.includes(normalizedRole)
}

export function canRoleCreateCourses(role) {
  const normalizedRole = normalizeLearningRole(role)
  return normalizedRole !== 'channel_sales_agent'
}

export function getPostLoginRedirect(role, fallback = '/simple-lms') {
  const normalizedRole = normalizeLearningRole(role)
  if (PLATFORM_ADMIN_ROLES.includes(normalizedRole)) return '/admin'
  if (isAgentRole(normalizedRole)) return '/agent-dashboard'
  if (isPartnerDashboardRole(normalizedRole)) return '/partner-dashboard'
  return fallback
}

export function isPartnerRegistrationIntent(intent) {
  const normalizedIntent = normalizeRegistrationIntent(intent, 'learn')
  return PARTNER_REGISTRATION_INTENTS.includes(normalizedIntent)
}

export function resolveRequestedRoleForIntent(intent) {
  const normalizedIntent = normalizeRegistrationIntent(intent, 'learn')
  return INTENT_APPROVAL_ROLE_MAP[normalizedIntent] || null
}

export function resolvePartnerTypeForIntent(intent) {
  const normalizedIntent = normalizeRegistrationIntent(intent, 'learn')
  return INTENT_PARTNER_TYPE_MAP[normalizedIntent] || 'none'
}
