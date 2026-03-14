
import express from 'express'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import multer from 'multer'
import crypto from 'crypto'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { SimpleLmsProgram } from '../models/SimpleLmsProgram.js'
import { SimpleLmsPayment } from '../models/SimpleLmsPayment.js'
import { SimpleLmsWithdrawal } from '../models/SimpleLmsWithdrawal.js'
import { PartnerWithdrawal } from '../models/PartnerWithdrawal.js'
import { SimpleLmsCommissionSetting } from '../models/SimpleLmsCommissionSetting.js'
import { SimpleLmsPlatformSetting } from '../models/SimpleLmsPlatformSetting.js'
import { AgentSaleAttribution } from '../models/AgentSaleAttribution.js'
import { RoleApprovalRequest } from '../models/RoleApprovalRequest.js'
import { AuditLog } from '../models/AuditLog.js'
import { AdminInvite } from '../models/AdminInvite.js'
import { logAuditEvent } from '../utils/auditLog.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../services/cloudinaryService.js'
import { emailService } from '../services/emailService.js'
import {
  createFlutterwavePaymentLink,
  getFlutterwavePublicKey,
  getFlutterwaveWebhookHash,
  isFlutterwaveConfigured,
  verifyFlutterwaveTransaction
} from '../services/flutterwaveService.js'
import {
  getPaystackPublicKey,
  getPaystackSecretKey,
  initializePaystackTransaction,
  isPaystackConfigured,
  verifyPaystackTransaction
} from '../services/paystackService.js'
import {
  encryptCredentialValue,
  getLastFour,
  hasEncryptedCredential,
  isCredentialEncryptionConfigured,
  maskKey
} from '../services/credentialEncryptionService.js'
import { getSimpleLmsCurrencyCatalog, normalizeSimpleLmsCurrencyCode, parseMajorAmountToMinor } from '../services/simpleLmsCurrencyService.js'
import { addSessionCartCourseId, clearSessionCart, getSessionCartCourseIds, hasSessionCartCourse, removeSessionCartCourseId, setSessionCartCourseIds } from '../utils/simpleLmsCart.js'
import { buildAgentReferralCode, normalizeAgentReferralCode } from '../utils/agentReferral.js'
import { buildAccessProfileSnapshot, resolveAccessProfile } from '../utils/accessProfile.js'
import {
  createPartnerApprovalRequest,
  sanitizePartnerOrganizationName
} from '../utils/partnerRoleRequests.js'
import {
  LEARNING_ROLES,
  canRoleCreateCourses,
  isPlatformAdminRole,
  resolveLearningRole as resolveLearningRoleFromAccount
} from '../utils/learningRoles.js'

const pageRouter = express.Router()
const adminPageRouter = express.Router()
const apiRouter = express.Router()
const reportsApiRouter = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
})
const lessonMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }
})

const ROLES = LEARNING_ROLES
const VIEW_MODES = ['overview', 'settings', 'catalog', 'cart', 'my-learning', 'course-studio', 'program-studio', 'admin']
const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed']
const SORT_OPTIONS = ['newest', 'popular', 'title_asc', 'duration_desc']
const PUBLIC_VISIBILITY_VALUES = ['organization_public', 'system_public']
const DEFAULT_SIMPLE_LMS_CURRENCY_CODE = 'NGN'
const PROGRAM_VISIBILITY_VALUES = ['organization_public']
const PAYMENT_PROVIDERS = ['flutterwave', 'paystack']
const PAYMENT_STATUSES = ['initiated', 'pending', 'successful', 'failed', 'cancelled', 'refunded']
const WITHDRAWAL_STATUSES = ['pending', 'approved', 'paid', 'rejected', 'cancelled']
const SETTINGS_TABS = ['profile', 'creator', 'payments']
const CREATOR_SETTINGS_SECTIONS = ['defaults', 'actions', 'payout', 'performance', 'wallet', 'withdrawals']
const ADMIN_SECTIONS = ['overview', 'courses', 'approvals', 'partners', 'super-users', 'audit-log', 'creators', 'users', 'commission', 'payments', 'settings', 'analytics']
const PAYMENT_PROVIDER_SESSION_KEY = 'simpleLmsPreferredPaymentProvider'
const REAUTH_MAX_ATTEMPTS_PER_HOUR = 5
const CREDENTIAL_UPDATE_MAX_PER_HOUR = 5
const PAYMENT_PROVIDER_COPY = Object.freeze({
  flutterwave: {
    label: 'Flutterwave',
    description: 'Card, bank transfer, and USSD'
  },
  paystack: {
    label: 'Paystack',
    description: 'Card, bank transfer, and USSD'
  }
})

const ADMIN_INVITE_ROLES = Object.freeze(['admin', 'super_admin'])
const ADMIN_INVITE_STATUSES = Object.freeze(['pending', 'registered', 'accepted', 'expired', 'revoked'])
const COURSE_REVIEW_DECISIONS = Object.freeze(['none', 'pending', 'approved', 'changes_requested', 'denied'])

const PARTNER_SUPER_ROLES = ['channel_partner_super', 'partner_super']
const PARTNER_USER_ROLES = ['channel_partner_user', 'partner_user']
const PARTNER_DASHBOARD_ROLES = [...PARTNER_SUPER_ROLES, ...PARTNER_USER_ROLES]

const LEVEL_LABELS = Object.freeze({
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Mixed'
})

const PLATFORM_SETTING_DEFAULTS = Object.freeze({
  defaultCurrency: 'NGN',
  defaultPaymentMode: 'free',
  defaultCourseVisibility: 'private',
  defaultCourseStatus: 'draft',
  requirePublicReviewForCreators: true,
  allowExternalMediaEmbeds: true,
  allowAudioLessons: true,
  minCoursePriceMinor: 0,
  maxCoursePriceMinor: 50000000,
  analyticsLookbackDays: 30,
  cartExpiryDays: 30,
  featuredRefreshHours: 24,
  maxChaptersPerCourse: 25,
  maxLessonsPerChapter: 60,
  allowCourseComments: true,
  requireCourseThumbnail: false,
  enableWishlist: true,
  autoApproveSystemCourses: true,
  homepageFeaturedCourseLimit: 8,
  maintenanceMode: false,
  maintenanceMessage: '',
  creatorSubmissionGuidelines: ''
})

const PAYMENT_GATEWAY_DEFAULTS = Object.freeze({
  flutterwave: {
    enabled: true
  },
  paystack: {
    enabled: false
  },
  defaultProvider: 'flutterwave'
})

const CREATOR_SETTING_DEFAULTS = Object.freeze({
  defaultCategory: '',
  defaultLevel: 'mixed',
  defaultVisibility: 'private',
  defaultPaymentMode: 'free',
  defaultCurrency: 'NGN',
  preferredLessonDurationMinutes: 12,
  autoLoadSampleCurriculum: false,
  autoGenerateCourseSlug: true,
  defaultLessonMediaType: 'video',
  autoSaveDraftMinutes: 5,
  publishNotifyByEmail: true,
  showSalesDashboard: true,
  showCreatorTips: true
})

let activeSimpleLmsCurrencyCodes = [DEFAULT_SIMPLE_LMS_CURRENCY_CODE]
let activeSimpleLmsDefaultCurrencyCode = DEFAULT_SIMPLE_LMS_CURRENCY_CODE

const getActiveCurrencyCatalog = async ({ forceRefresh = false } = {}) => {
  const catalog = await getSimpleLmsCurrencyCatalog({ forceRefresh })
  const codes = Array.isArray(catalog?.codes) && catalog.codes.length > 0
    ? catalog.codes
    : [DEFAULT_SIMPLE_LMS_CURRENCY_CODE]
  activeSimpleLmsCurrencyCodes = codes
  activeSimpleLmsDefaultCurrencyCode = normalizeSimpleLmsCurrencyCode(
    catalog?.defaultCurrencyCode || DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
    DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
    codes
  )
  const currencies = Array.isArray(catalog?.currencies) && catalog.currencies.length > 0
    ? catalog.currencies
    : [
      {
        code: DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
        name: 'Nigerian Naira',
        symbol: 'NGN',
        decimals: 2,
        isDefault: true,
        isActive: true
      }
    ]
  return {
    currencies,
    codes: activeSimpleLmsCurrencyCodes,
    defaultCurrencyCode: activeSimpleLmsDefaultCurrencyCode
  }
}

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const resolveRole = (account) => {
  return resolveLearningRoleFromAccount(account)
}

const humanizeToken = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase())
}

const normalizeCourseReviewDecision = (value, fallback = 'none') => {
  const normalized = String(value || '').trim().toLowerCase()
  return COURSE_REVIEW_DECISIONS.includes(normalized) ? normalized : fallback
}

const formatCourseReviewDecision = (value) => {
  const normalized = normalizeCourseReviewDecision(value)
  if (normalized === 'changes_requested') return 'Changes Requested'
  if (normalized === 'denied') return 'Denied'
  if (normalized === 'approved') return 'Approved'
  if (normalized === 'pending') return 'Pending Review'
  return 'No Review'
}

const isPlatformAuditRole = (role) => ['admin', 'super_admin'].includes(String(role || '').trim().toLowerCase())

const formatAuditMetadataValue = (value) => {
  if (value === null || value === undefined) return '-'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => formatAuditMetadataValue(entry))
      .filter(Boolean)
    return items.length > 0 ? items.join(', ') : '-'
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-'
  if (typeof value === 'string') return value.trim() || '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value || '-')
}

const flattenAuditMetadata = (value, prefix = '', depth = 0, maxPairs = 24) => {
  if (!value || typeof value !== 'object') {
    return prefix ? [{ key: prefix, label: humanizeToken(prefix), value: formatAuditMetadataValue(value) }] : []
  }

  if (Array.isArray(value) || depth >= 2) {
    return prefix ? [{ key: prefix, label: humanizeToken(prefix), value: formatAuditMetadataValue(value) }] : []
  }

  const pairs = []
  for (const [rawKey, childValue] of Object.entries(value)) {
    if (pairs.length >= maxPairs) break
    const key = prefix ? `${prefix}.${rawKey}` : rawKey
    if (childValue && typeof childValue === 'object' && !Array.isArray(childValue) && depth < 1) {
      const nestedPairs = flattenAuditMetadata(childValue, key, depth + 1, maxPairs - pairs.length)
      pairs.push(...nestedPairs)
      continue
    }
    pairs.push({
      key,
      label: humanizeToken(key),
      value: formatAuditMetadataValue(childValue)
    })
  }

  return pairs
}

const resolveAuditAccessContext = (account) => {
  if (!account) {
    return {
      organization: null,
      memberRole: ''
    }
  }

  const organization = account?.partnerOrganization && typeof account.partnerOrganization === 'object'
    ? account.partnerOrganization
    : null
  const organizationId = toIdString(organization?._id || account?.partnerOrganization || account?.currentOrganization)
  const activeMembership = Array.isArray(account?.organizations)
    ? account.organizations.find((entry) => (
      entry?.isActive !== false && toIdString(entry.organization) === organizationId
    ))
    : null

  let memberRole = String(activeMembership?.role || '').trim().toLowerCase()
  if (!memberRole) {
    const normalizedLearningRole = String(account?.learningRole || '').trim().toLowerCase()
    if (normalizedLearningRole === 'channel_sales_agent') {
      memberRole = 'sales_agent'
    } else if (['partner_super', 'channel_partner_super'].includes(normalizedLearningRole)) {
      memberRole = 'partner_admin'
    } else if (['partner_user', 'channel_partner_user'].includes(normalizedLearningRole)) {
      memberRole = 'partner_user'
    }
  }

  return {
    organization,
    memberRole
  }
}

const buildAuditRoleLabel = (account) => {
  const { organization, memberRole } = resolveAuditAccessContext(account)
  const accessProfile = buildAccessProfileSnapshot(account, {
    organization,
    memberRole,
    source: 'audit_snapshot'
  })

  const labels = []
  if (accessProfile.platformRole) {
    labels.push(humanizeToken(accessProfile.platformRole))
  }
  if (accessProfile.partnerAccess?.dashboardRole) {
    const orgName = String(accessProfile.partnerAccess.organizationName || '').trim()
    labels.push(orgName
      ? `${humanizeToken(accessProfile.partnerAccess.dashboardRole)} @ ${orgName}`
      : humanizeToken(accessProfile.partnerAccess.dashboardRole)
    )
  } else if (accessProfile.agentAccess?.dashboardRole) {
    const orgName = String(accessProfile.agentAccess.organizationName || '').trim()
    labels.push(orgName
      ? `${humanizeToken(accessProfile.agentAccess.dashboardRole)} @ ${orgName}`
      : humanizeToken(accessProfile.agentAccess.dashboardRole)
    )
  }
  if (labels.length === 0) {
    labels.push(humanizeToken(accessProfile.baseLearningRole || resolveRole(account) || 'unknown'))
  }
  return labels.join(' + ')
}

const hasPlatformAuditMetadata = (metadata = {}) => {
  const candidateRoles = [
    metadata?.requestedRole,
    metadata?.previousRole,
    metadata?.nextRole,
    metadata?.fromRole,
    metadata?.toRole,
    metadata?.restoredRole
  ]
  return candidateRoles.some((role) => isPlatformAuditRole(role)) || Boolean(metadata?.inviteId)
}

const isPlatformAuditEntry = (entry) => {
  const action = String(entry?.action || '').trim().toLowerCase()
  const actorRole = resolveRole(entry?.performedBy)
  const targetRole = resolveRole(entry?.targetAccount)

  if (isPlatformAuditRole(actorRole) || isPlatformAuditRole(targetRole)) return true
  if (action.startsWith('admin.') || action.startsWith('super_user.') || action.startsWith('payment.gateway.')) return true
  if (action === 'role.change' && hasPlatformAuditMetadata(entry?.metadata || {})) return true
  if (action.startsWith('security.') && hasPlatformAuditMetadata(entry?.metadata || {})) return true
  return false
}

const buildAuditHeadline = ({ action, metadata = {}, targetAccountName = '', targetOrganizationName = '' }) => {
  switch (action) {
    case 'admin.invite':
      return `Sent ${humanizeToken(metadata.requestedRole || 'admin')} invite to ${metadata.email || targetAccountName || 'a new account'}`
    case 'admin.invite.verify_sent':
      return `Sent verification code to ${targetAccountName || metadata.registrationEmail || 'the invited account'}`
    case 'admin.invite.accepted':
      return `Activated ${humanizeToken(metadata.requestedRole || 'admin')} access for ${targetAccountName || metadata.email || 'the invited account'}`
    case 'admin.invite.revoked':
      return `Revoked ${humanizeToken(metadata.requestedRole || 'admin')} invite for ${metadata.email || targetAccountName || 'the invited account'}`
    case 'super_user.promote':
      return `Promoted ${targetAccountName || 'the selected account'} to Super Admin`
    case 'super_user.demote':
      return `Removed Super Admin access from ${targetAccountName || 'the selected account'}`
    case 'role.change':
      return `Changed ${targetAccountName || 'account'} from ${humanizeToken(metadata.fromRole || metadata.previousRole || 'learner')} to ${humanizeToken(metadata.toRole || metadata.nextRole || metadata.restoredRole || 'updated role')}`
    case 'security.email_verification_requested':
      return `Requested email verification for ${targetAccountName || metadata.registrationEmail || 'the invited account'}`
    case 'security.email_verification_completed':
      return `Completed email verification for ${targetAccountName || metadata.registrationEmail || 'the invited account'}`
    case 'security.password_reset_requested':
      return `Requested password reset for ${targetAccountName || 'the admin account'}`
    case 'security.password_reset_completed':
      return `Completed password reset for ${targetAccountName || 'the admin account'}`
    case 'reports.export':
      return `Exported ${humanizeToken(metadata.reportType || 'platform')} report`
    case 'payment.gateway.provider_toggled':
      return `${metadata.enabled === false ? 'Disabled' : 'Updated'} payment provider ${humanizeToken(metadata.provider || metadata.providerKey || 'provider')}`
    case 'payment.gateway.default_changed':
      return `Changed default payment provider to ${humanizeToken(metadata.provider || metadata.defaultProvider || 'provider')}`
    case 'payment.gateway.credential_updated':
      return `Updated payment provider credentials for ${humanizeToken(metadata.provider || metadata.providerKey || 'provider')}`
    case 'payment.gateway.reauth_failed':
      return `Payment provider re-authorization failed for ${humanizeToken(metadata.provider || metadata.providerKey || 'provider')}`
    case 'payment.gateway.reauth_blocked':
      return `Blocked payment provider re-authorization for ${humanizeToken(metadata.provider || metadata.providerKey || 'provider')}`
    default:
      if (targetAccountName) return `${humanizeToken(action)} for ${targetAccountName}`
      if (targetOrganizationName) return `${humanizeToken(action)} for ${targetOrganizationName}`
      return humanizeToken(action)
  }
}

const buildAuditNarrative = ({
  action,
  metadata = {},
  performedByName = 'System',
  performedByRoleLabel = 'Unknown',
  targetAccountName = '',
  targetOrganizationName = ''
}) => {
  const actorCopy = `${performedByName} (${performedByRoleLabel})`
  switch (action) {
    case 'admin.invite':
      return `${actorCopy} sent an invitation for ${metadata.email || 'a new account'} to join the admin workspace as ${humanizeToken(metadata.requestedRole || 'admin')}.`
    case 'admin.invite.verify_sent':
      return `${actorCopy} triggered a verification code for ${targetAccountName || metadata.registrationEmail || 'the invited account'} so the invite could be completed.`
    case 'admin.invite.accepted':
      return `${actorCopy} completed the invitation flow and activated ${humanizeToken(metadata.requestedRole || 'admin')} access.`
    case 'admin.invite.revoked':
      return `${actorCopy} revoked a pending admin invitation before it was fully accepted.`
    case 'super_user.promote':
      return `${actorCopy} granted Super Admin privileges to ${targetAccountName || 'the target account'}.`
    case 'super_user.demote':
      return `${actorCopy} removed Super Admin privileges and restored the fallback role for ${targetAccountName || 'the target account'}.`
    case 'role.change':
      return `${actorCopy} changed the account role from ${humanizeToken(metadata.fromRole || metadata.previousRole || 'learner')} to ${humanizeToken(metadata.toRole || metadata.nextRole || metadata.restoredRole || 'updated role')}.`
    case 'reports.export':
      return `${actorCopy} exported a ${humanizeToken(metadata.reportType || 'platform')} report from the admin console.`
    default:
      if (targetOrganizationName) {
        return `${actorCopy} executed ${humanizeToken(action).toLowerCase()} against ${targetOrganizationName}.`
      }
      if (targetAccountName) {
        return `${actorCopy} executed ${humanizeToken(action).toLowerCase()} against ${targetAccountName}.`
      }
      return `${actorCopy} executed ${humanizeToken(action).toLowerCase()} in the admin console.`
  }
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const createAdminInviteToken = () => crypto.randomBytes(24).toString('hex')
const normalizeAdminInviteRole = (value, fallback = 'admin') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ADMIN_INVITE_ROLES.includes(normalized) ? normalized : fallback
}
const formatAdminInviteStatus = (value) => String(value || '').trim().toLowerCase().replace(/_/g, ' ')
const buildBaseUrl = (req) => {
  const proto = String(req.protocol || 'http').trim()
  const host = String(req.get('host') || '').trim()
  return host ? `${proto}://${host}` : ''
}
const resolveAdminInviteRoleCopy = (role) => normalizeAdminInviteRole(role) === 'super_admin' ? 'super admin' : 'admin'

const resolveAccountFromSessionIdentifier = async (identifier) => {
  const normalized = String(identifier || '').trim()
  if (!normalized) return null

  const accountBySub = await Account.findOne({ sub: normalized })
  if (accountBySub) return accountBySub

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    return Account.findById(normalized)
  }

  return null
}

const canManagePlatform = (role) => isPlatformAdminRole(role)
const isSuperAdminRole = (role) => String(role || '').trim().toLowerCase() === 'super_admin'
const canCreateCourses = (role) => canRoleCreateCourses(role)
const isPartnerDashboardRole = (role) => PARTNER_DASHBOARD_ROLES.includes(String(role || '').trim().toLowerCase())
const isPartnerSuperRole = (role) => PARTNER_SUPER_ROLES.includes(String(role || '').trim().toLowerCase())
const isPartnerUserRole = (role) => PARTNER_USER_ROLES.includes(String(role || '').trim().toLowerCase())

const getReferralSessionStore = (req, { create = false } = {}) => {
  if (!req.session) return {}
  const current = req.session.simpleLmsAgentReferrals
  if (current && typeof current === 'object') return current
  if (!create) return {}
  req.session.simpleLmsAgentReferrals = {}
  return req.session.simpleLmsAgentReferrals
}

const setReferralCodeForCourse = (req, courseId, referralCode) => {
  const normalizedCourseId = toIdString(courseId)
  const normalizedCode = normalizeAgentReferralCode(referralCode)
  if (!normalizedCourseId || !normalizedCode || !req.session) return
  const store = getReferralSessionStore(req, { create: true })
  store[normalizedCourseId] = normalizedCode
}

const getReferralCodeForCourse = (req, courseId) => {
  const normalizedCourseId = toIdString(courseId)
  if (!normalizedCourseId) return ''
  const store = getReferralSessionStore(req)
  return normalizeAgentReferralCode(store[normalizedCourseId] || '')
}

const clearReferralCodeForCourse = (req, courseId) => {
  const normalizedCourseId = toIdString(courseId)
  if (!normalizedCourseId || !req.session) return
  const store = getReferralSessionStore(req)
  if (!store[normalizedCourseId]) return
  delete store[normalizedCourseId]
  req.session.simpleLmsAgentReferrals = store
}

const resolveAgentForReferral = async ({ course, referralCode }) => {
  const normalizedCode = normalizeAgentReferralCode(referralCode)
  if (!normalizedCode) return null

  const partnerOrgId = toIdString(course?.organization)
  if (!partnerOrgId || !mongoose.Types.ObjectId.isValid(partnerOrgId)) return null

  const candidates = await Account.find({
    partnerOrganization: partnerOrgId,
    learningRole: 'channel_sales_agent'
  })
    .select('_id sub email partnerOrganization')
    .limit(1000)
    .lean()

  return candidates.find((candidate) => buildAgentReferralCode(candidate) === normalizedCode) || null
}

const resolveAgentCommissionRate = ({ organization, agentId }) => {
  const defaultRate = Number(organization?.partnerSettings?.defaultAgentCommissionRate)
  const normalizedDefaultRate = Number.isFinite(defaultRate) ? Math.min(100, Math.max(0, defaultRate)) : 10

  const member = (organization?.members || []).find((entry) => (
    String(entry.account) === String(agentId) && entry.role === 'sales_agent' && entry.status === 'active'
  ))
  if (!member) return normalizedDefaultRate

  const override = Number(member.agentCommissionRate)
  if (!Number.isFinite(override)) return normalizedDefaultRate
  return Math.min(100, Math.max(0, override))
}

const resolveAgentReferralForCheckout = async ({ req, course }) => {
  if (!course?._id) return null

  const explicitRef = normalizeAgentReferralCode(req.body?.ref || req.query?.ref || '')
  const sessionRef = getReferralCodeForCourse(req, course._id)
  const referralCode = explicitRef || sessionRef
  if (!referralCode) return null

  const agent = await resolveAgentForReferral({ course, referralCode })
  if (!agent?._id) return null

  const buyerAccountId = toIdString(req.user?._id)
  if (buyerAccountId && buyerAccountId === toIdString(agent._id)) {
    // Block self-referrals so agents cannot earn commission on their own purchases.
    clearReferralCodeForCourse(req, course._id)
    return null
  }

  setReferralCodeForCourse(req, course._id, referralCode)

  const organization = await Organization.findById(course.organization)
    .select('_id partnerType partnerSettings members')
    .lean()
  if (!organization || organization.partnerType === 'none') return null

  const rate = resolveAgentCommissionRate({
    organization,
    agentId: agent._id
  })

  return {
    code: referralCode,
    agentId: agent._id,
    partnerOrganization: organization._id,
    commissionRatePercent: rate
  }
}

const createOrUpdateAgentAttributionForPayment = async ({ payment, course }) => {
  if (!payment?._id || !course?._id) return null
  if (String(payment.status || '').trim().toLowerCase() !== 'successful') return null

  const existing = await AgentSaleAttribution.findOne({ payment: payment._id })
  if (existing) return existing

  const referral = payment.metadata?.agentReferral || {}
  const agentId = toIdString(referral.agentId)
  const partnerOrganizationId = toIdString(referral.partnerOrganization || course.organization)
  const referralCode = normalizeAgentReferralCode(referral.code)

  if (!agentId || !mongoose.Types.ObjectId.isValid(agentId)) return null
  if (!partnerOrganizationId || !mongoose.Types.ObjectId.isValid(partnerOrganizationId)) return null

  const [agent, organization] = await Promise.all([
    Account.findById(agentId).select('_id learningRole partnerOrganization').lean(),
    Organization.findById(partnerOrganizationId).select('_id partnerType partnerSettings members').lean()
  ])
  if (!agent || String(agent.learningRole || '').trim().toLowerCase() !== 'channel_sales_agent') return null
  if (toIdString(payment.account) === toIdString(agent._id)) return null
  if (!organization || organization.partnerType === 'none') return null
  if (String(agent.partnerOrganization || '') !== String(partnerOrganizationId)) return null
  if (String(course.organization || '') !== String(partnerOrganizationId)) return null

  const commissionRatePercent = Number.isFinite(Number(referral.commissionRatePercent))
    ? Math.min(100, Math.max(0, Number(referral.commissionRatePercent)))
    : resolveAgentCommissionRate({ organization, agentId: agent._id })

  const platformShareMinor = Math.max(0, Number(payment.platformShareMinor || 0))
  const commissionAmountMinor = Math.max(0, Math.round((platformShareMinor * commissionRatePercent) / 100))

  return AgentSaleAttribution.create({
    payment: payment._id,
    agent: agent._id,
    partnerOrganization: organization._id,
    course: course._id,
    commissionRatePercent,
    commissionAmountMinor,
    saleAmountMinor: Math.max(0, Number(payment.amountMinor || 0)),
    currency: String(payment.currency || 'NGN').trim().toUpperCase().slice(0, 3) || 'NGN',
    status: 'pending',
    referralCode,
    attributedAt: new Date(),
    metadata: {
      txRef: payment.txRef || '',
      provider: payment.provider || 'flutterwave',
      providerTxId: payment.providerTxId || '',
      flutterwaveTxId: payment.flutterwaveTxId || '',
      platformShareMinor
    }
  })
}

const markPaymentSuccessful = async ({ payment, course, paidAt = new Date() }) => {
  const commissionSettings = await getCommissionSettings()
  const creatorId = course?.createdBy || payment.creatorAccount
  const commissionRate = resolveCommissionRate({
    settings: commissionSettings,
    creatorId,
    courseId: course?._id || payment.course
  })
  const split = splitCommission({
    amountMinor: payment.amountMinor,
    ratePercent: commissionRate
  })

  payment.status = 'successful'
  payment.paidAt = payment.paidAt || paidAt
  payment.creatorAccount = creatorId || payment.creatorAccount || null
  payment.creatorCommissionRate = commissionRate
  payment.creatorCommissionMinor = split.creatorCommissionMinor
  payment.platformShareMinor = split.platformShareMinor
  await payment.save()

  await createOrUpdateEnrollment({
    courseId: course._id,
    learnerId: payment.account,
    actorId: payment.account,
    assignmentType: 'self',
    source: 'self_enroll'
  })

  await createOrUpdateAgentAttributionForPayment({
    payment,
    course
  })
}

const parseJsonInput = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const slugifyValue = (value, fallback = 'item') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

const normalizeCurrencyCode = (value, fallback = DEFAULT_SIMPLE_LMS_CURRENCY_CODE, allowedCodes = activeSimpleLmsCurrencyCodes) => {
  return normalizeSimpleLmsCurrencyCode(value, fallback, allowedCodes)
}

const normalizeCreatorSettings = (raw = {}, currencyCodes = activeSimpleLmsCurrencyCodes) => {
  const defaultLevel = LEVELS.includes(String(raw?.defaultLevel || '').trim().toLowerCase())
    ? String(raw.defaultLevel).trim().toLowerCase()
    : CREATOR_SETTING_DEFAULTS.defaultLevel

  const defaultVisibility = ['private', 'public'].includes(String(raw?.defaultVisibility || '').trim().toLowerCase())
    ? String(raw.defaultVisibility).trim().toLowerCase()
    : CREATOR_SETTING_DEFAULTS.defaultVisibility

  const defaultPaymentMode = ['free', 'paid'].includes(String(raw?.defaultPaymentMode || '').trim().toLowerCase())
    ? String(raw.defaultPaymentMode).trim().toLowerCase()
    : CREATOR_SETTING_DEFAULTS.defaultPaymentMode

  const defaultLessonMediaType = ['video', 'audio', 'document'].includes(String(raw?.defaultLessonMediaType || '').trim().toLowerCase())
    ? String(raw.defaultLessonMediaType).trim().toLowerCase()
    : CREATOR_SETTING_DEFAULTS.defaultLessonMediaType

  return {
    defaultCategory: String(raw?.defaultCategory || '').trim().slice(0, 120),
    defaultLevel,
    defaultVisibility,
    defaultPaymentMode,
    defaultCurrency: normalizeCurrencyCode(raw?.defaultCurrency, CREATOR_SETTING_DEFAULTS.defaultCurrency, currencyCodes),
    preferredLessonDurationMinutes: Math.min(600, Math.max(1, Math.round(Number(raw?.preferredLessonDurationMinutes || CREATOR_SETTING_DEFAULTS.preferredLessonDurationMinutes)))),
    autoLoadSampleCurriculum: Boolean(raw?.autoLoadSampleCurriculum),
    autoGenerateCourseSlug: raw?.autoGenerateCourseSlug !== false,
    defaultLessonMediaType,
    autoSaveDraftMinutes: Math.min(30, Math.max(1, Math.round(Number(raw?.autoSaveDraftMinutes || CREATOR_SETTING_DEFAULTS.autoSaveDraftMinutes)))),
    publishNotifyByEmail: raw?.publishNotifyByEmail !== false,
    showSalesDashboard: raw?.showSalesDashboard !== false,
    showCreatorTips: raw?.showCreatorTips !== false
  }
}

const normalizePlatformSettings = (raw = {}, currencyCodes = activeSimpleLmsCurrencyCodes) => {
  const defaultPaymentMode = ['free', 'paid'].includes(String(raw?.defaultPaymentMode || '').trim().toLowerCase())
    ? String(raw.defaultPaymentMode).trim().toLowerCase()
    : PLATFORM_SETTING_DEFAULTS.defaultPaymentMode

  const defaultCourseVisibility = ['private', 'public', 'marketplace'].includes(String(raw?.defaultCourseVisibility || '').trim().toLowerCase())
    ? String(raw.defaultCourseVisibility).trim().toLowerCase()
    : PLATFORM_SETTING_DEFAULTS.defaultCourseVisibility

  const defaultCourseStatus = ['draft', 'published'].includes(String(raw?.defaultCourseStatus || '').trim().toLowerCase())
    ? String(raw.defaultCourseStatus).trim().toLowerCase()
    : PLATFORM_SETTING_DEFAULTS.defaultCourseStatus

  const minCoursePriceMinor = Math.max(0, Math.round(Number(raw?.minCoursePriceMinor ?? PLATFORM_SETTING_DEFAULTS.minCoursePriceMinor)))
  let maxCoursePriceMinor = Math.max(minCoursePriceMinor, Math.round(Number(raw?.maxCoursePriceMinor ?? PLATFORM_SETTING_DEFAULTS.maxCoursePriceMinor)))
  if (!Number.isFinite(maxCoursePriceMinor) || maxCoursePriceMinor <= 0) {
    maxCoursePriceMinor = PLATFORM_SETTING_DEFAULTS.maxCoursePriceMinor
  }

  return {
    defaultCurrency: normalizeCurrencyCode(raw?.defaultCurrency, PLATFORM_SETTING_DEFAULTS.defaultCurrency, currencyCodes),
    defaultPaymentMode,
    defaultCourseVisibility,
    defaultCourseStatus,
    requirePublicReviewForCreators: raw?.requirePublicReviewForCreators !== false,
    allowExternalMediaEmbeds: raw?.allowExternalMediaEmbeds !== false,
    allowAudioLessons: raw?.allowAudioLessons !== false,
    minCoursePriceMinor,
    maxCoursePriceMinor,
    analyticsLookbackDays: Math.min(365, Math.max(7, Math.round(Number(raw?.analyticsLookbackDays ?? PLATFORM_SETTING_DEFAULTS.analyticsLookbackDays)))),
    cartExpiryDays: Math.min(365, Math.max(1, Math.round(Number(raw?.cartExpiryDays ?? PLATFORM_SETTING_DEFAULTS.cartExpiryDays)))),
    featuredRefreshHours: Math.min(168, Math.max(1, Math.round(Number(raw?.featuredRefreshHours ?? PLATFORM_SETTING_DEFAULTS.featuredRefreshHours)))),
    maxChaptersPerCourse: Math.min(100, Math.max(1, Math.round(Number(raw?.maxChaptersPerCourse ?? PLATFORM_SETTING_DEFAULTS.maxChaptersPerCourse)))),
    maxLessonsPerChapter: Math.min(200, Math.max(1, Math.round(Number(raw?.maxLessonsPerChapter ?? PLATFORM_SETTING_DEFAULTS.maxLessonsPerChapter)))),
    allowCourseComments: raw?.allowCourseComments !== false,
    requireCourseThumbnail: Boolean(raw?.requireCourseThumbnail),
    enableWishlist: raw?.enableWishlist !== false,
    autoApproveSystemCourses: raw?.autoApproveSystemCourses !== false,
    homepageFeaturedCourseLimit: Math.min(24, Math.max(1, Math.round(Number(raw?.homepageFeaturedCourseLimit ?? PLATFORM_SETTING_DEFAULTS.homepageFeaturedCourseLimit)))),
    maintenanceMode: Boolean(raw?.maintenanceMode),
    maintenanceMessage: String(raw?.maintenanceMessage || '').trim().slice(0, 500),
    creatorSubmissionGuidelines: String(raw?.creatorSubmissionGuidelines || '').trim().slice(0, 3000)
  }
}

const formatCurrencyAmount = (amountMinor, currencyCode) => {
  const amount = Number.isFinite(Number(amountMinor))
    ? Math.max(0, Math.round(Number(amountMinor)))
    : 0
  const major = amount / 100
  const currency = normalizeCurrencyCode(currencyCode)

  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(major)
  } catch {
    return `${currency} ${major.toFixed(2)}`
  }
}

const generateTxRef = () => {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `sl_${Date.now()}_${randomPart}`
}

const normalizeCommissionRate = (value, fallback = 70) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
}

const splitCommission = ({ amountMinor = 0, ratePercent = 70 }) => {
  const amount = Math.max(0, Math.round(Number(amountMinor || 0)))
  const normalizedRate = normalizeCommissionRate(ratePercent, 70)
  const creatorCommissionMinor = Math.max(0, Math.round((amount * normalizedRate) / 100))
  const platformShareMinor = Math.max(0, amount - creatorCommissionMinor)
  return {
    creatorCommissionMinor,
    platformShareMinor
  }
}

const parseAmountToMinor = (value) => parseMajorAmountToMinor(value)

const normalizeWithdrawalStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase()
  return WITHDRAWAL_STATUSES.includes(normalized) ? normalized : fallback
}

const formatWithdrawalStatusLabel = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
)

const hasValidPayoutProfile = (profile = {}) => {
  const accountName = String(profile.accountName || '').trim()
  const accountNumber = String(profile.accountNumber || '').trim()
  const bankName = String(profile.bankName || '').trim()
  const paymentEmail = String(profile.paymentEmail || '').trim()
  if (paymentEmail) return true
  return Boolean(accountName && accountNumber && bankName)
}

const buildPartnerRevenueExpression = () => ({
  $max: [
    0,
    {
      $subtract: [
        { $ifNull: ['$metadata.platformShareMinor', 0] },
        { $ifNull: ['$commissionAmountMinor', 0] }
      ]
    }
  ]
})

const getPartnerWalletSnapshot = async (organizationId) => {
  const normalizedOrgId = String(organizationId || '').trim()
  if (!mongoose.Types.ObjectId.isValid(normalizedOrgId)) {
    return {
      totalSalesMinor: 0,
      totalAgentCommissionMinor: 0,
      partnerEarningsMinor: 0,
      paidOutMinor: 0,
      pendingWithdrawalMinor: 0,
      availableBalanceMinor: 0
    }
  }

  const organizationObjectId = new mongoose.Types.ObjectId(normalizedOrgId)
  const [earningsRaw, withdrawalsRaw] = await Promise.all([
    AgentSaleAttribution.aggregate([
      { $match: { partnerOrganization: organizationObjectId } },
      {
        $group: {
          _id: null,
          totalSalesMinor: { $sum: { $ifNull: ['$saleAmountMinor', 0] } },
          totalAgentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
          partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
        }
      }
    ]),
    PartnerWithdrawal.aggregate([
      { $match: { organization: organizationObjectId } },
      {
        $group: {
          _id: null,
          paidOutMinor: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountMinor', 0] } },
          pendingWithdrawalMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved']] }, '$amountMinor', 0] } }
        }
      }
    ])
  ])

  const earnings = earningsRaw[0] || { totalSalesMinor: 0, totalAgentCommissionMinor: 0, partnerEarningsMinor: 0 }
  const withdrawals = withdrawalsRaw[0] || { paidOutMinor: 0, pendingWithdrawalMinor: 0 }
  const partnerEarningsMinor = Math.max(0, Number(earnings.partnerEarningsMinor || 0))
  const paidOutMinor = Math.max(0, Number(withdrawals.paidOutMinor || 0))
  const pendingWithdrawalMinor = Math.max(0, Number(withdrawals.pendingWithdrawalMinor || 0))
  return {
    totalSalesMinor: Math.max(0, Number(earnings.totalSalesMinor || 0)),
    totalAgentCommissionMinor: Math.max(0, Number(earnings.totalAgentCommissionMinor || 0)),
    partnerEarningsMinor,
    paidOutMinor,
    pendingWithdrawalMinor,
    availableBalanceMinor: Math.max(0, partnerEarningsMinor - paidOutMinor - pendingWithdrawalMinor)
  }
}

const getCreatorWalletSnapshot = async (creatorId) => {
  const normalizedCreatorId = String(creatorId || '').trim()
  if (!mongoose.Types.ObjectId.isValid(normalizedCreatorId)) {
    return {
      soldMinor: 0,
      soldCount: 0,
      earningsMinor: 0,
      paidOutMinor: 0,
      outstandingWithdrawalMinor: 0,
      availableBalanceMinor: 0
    }
  }

  const creatorObjectId = new mongoose.Types.ObjectId(normalizedCreatorId)
  const [earningsRaw, withdrawalsRaw] = await Promise.all([
    SimpleLmsPayment.aggregate([
      { $match: { status: 'successful', creatorAccount: creatorObjectId } },
      {
        $group: {
          _id: null,
          soldMinor: { $sum: '$amountMinor' },
          soldCount: { $sum: 1 },
          earningsMinor: { $sum: '$creatorCommissionMinor' }
        }
      }
    ]),
    SimpleLmsWithdrawal.aggregate([
      { $match: { creatorAccount: creatorObjectId } },
      {
        $group: {
          _id: null,
          paidOutMinor: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountMinor', 0] } },
          outstandingWithdrawalMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved']] }, '$amountMinor', 0] } }
        }
      }
    ])
  ])

  const earnings = earningsRaw[0] || { soldMinor: 0, soldCount: 0, earningsMinor: 0 }
  const withdrawals = withdrawalsRaw[0] || { paidOutMinor: 0, outstandingWithdrawalMinor: 0 }
  const soldMinor = Math.max(0, Number(earnings.soldMinor || 0))
  const soldCount = Math.max(0, Number(earnings.soldCount || 0))
  const earningsMinor = Math.max(0, Number(earnings.earningsMinor || 0))
  const paidOutMinor = Math.max(0, Number(withdrawals.paidOutMinor || 0))
  const outstandingWithdrawalMinor = Math.max(0, Number(withdrawals.outstandingWithdrawalMinor || 0))
  const availableBalanceMinor = Math.max(0, earningsMinor - paidOutMinor - outstandingWithdrawalMinor)

  return {
    soldMinor,
    soldCount,
    earningsMinor,
    paidOutMinor,
    outstandingWithdrawalMinor,
    availableBalanceMinor
  }
}

const getCommissionSettings = async () => {
  const settings = await SimpleLmsCommissionSetting.findOne({}).lean()
  if (settings) {
    return {
      globalRatePercent: normalizeCommissionRate(settings.globalRatePercent, 70),
      accountOverrides: Array.isArray(settings.accountOverrides) ? settings.accountOverrides : [],
      courseOverrides: Array.isArray(settings.courseOverrides) ? settings.courseOverrides : []
    }
  }
  return {
    globalRatePercent: 70,
    accountOverrides: [],
    courseOverrides: []
  }
}

const getPlatformSettings = async (currencyCodes = activeSimpleLmsCurrencyCodes) => {
  const raw = await SimpleLmsPlatformSetting.findOne({}).lean()
  if (!raw) return normalizePlatformSettings(PLATFORM_SETTING_DEFAULTS, currencyCodes)
  return normalizePlatformSettings(raw, currencyCodes)
}

const normalizePaymentProvider = (value, fallback = PAYMENT_GATEWAY_DEFAULTS.defaultProvider) => {
  const normalized = String(value || '').trim().toLowerCase()
  return PAYMENT_PROVIDERS.includes(normalized) ? normalized : fallback
}

const normalizePaymentGatewaySettings = (raw = {}) => {
  const flutterwaveEnabled = raw?.flutterwave?.enabled !== false
  const paystackEnabled = Boolean(raw?.paystack?.enabled)
  let safeFlutterwaveEnabled = flutterwaveEnabled
  let safePaystackEnabled = paystackEnabled

  if (!safeFlutterwaveEnabled && !safePaystackEnabled) {
    safeFlutterwaveEnabled = true
  }

  let defaultProvider = normalizePaymentProvider(raw?.defaultProvider, PAYMENT_GATEWAY_DEFAULTS.defaultProvider)
  if ((defaultProvider === 'flutterwave' && !safeFlutterwaveEnabled)
    || (defaultProvider === 'paystack' && !safePaystackEnabled)) {
    defaultProvider = safePaystackEnabled ? 'paystack' : 'flutterwave'
  }

  return {
    flutterwave: {
      enabled: safeFlutterwaveEnabled,
      secretKey: raw?.flutterwave?.secretKey || {},
      publicKey: raw?.flutterwave?.publicKey || {},
      webhookHash: raw?.flutterwave?.webhookHash || {}
    },
    paystack: {
      enabled: safePaystackEnabled,
      secretKey: raw?.paystack?.secretKey || {},
      publicKey: raw?.paystack?.publicKey || {}
    },
    defaultProvider
  }
}

const getPaymentGatewaySettings = async () => {
  const raw = await SimpleLmsPlatformSetting.findOne({})
    .select('paymentGateways')
    .lean()
  return normalizePaymentGatewaySettings(raw?.paymentGateways || PAYMENT_GATEWAY_DEFAULTS)
}

const getCredentialMetaForDisplay = ({ storedCredential, envValue = '' }) => {
  const fromEnv = String(envValue || '').trim()
  const stored = hasEncryptedCredential(storedCredential)
  const resolvedLastFour = stored
    ? String(storedCredential?.lastFour || '').trim().slice(-4) || getLastFour(fromEnv)
    : getLastFour(fromEnv)
  const configured = stored || Boolean(fromEnv)
  return {
    configured,
    source: stored ? 'database' : (fromEnv ? 'env' : 'missing'),
    lastFour: resolvedLastFour,
    masked: configured ? maskKey(resolvedLastFour) : 'Not set',
    updatedAt: storedCredential?.updatedAt || null,
    updatedBy: storedCredential?.updatedBy || null
  }
}

const resolveSelectedPaymentProvider = ({ req, checkoutState }) => {
  const requestedProvider = normalizePaymentProvider(
    req.body?.provider || req.query?.provider || req.body?.paymentProvider || req.query?.paymentProvider,
    ''
  )
  const sessionPreferredProvider = normalizePaymentProvider(req.session?.[PAYMENT_PROVIDER_SESSION_KEY] || '', '')

  const selectableProviders = checkoutState.providerOptions
    .filter((provider) => provider.canCheckout)
    .map((provider) => provider.key)

  const preferredCandidates = [
    requestedProvider,
    sessionPreferredProvider,
    checkoutState.defaultProvider
  ].filter(Boolean)

  const selectedProvider = preferredCandidates.find((provider) => selectableProviders.includes(provider))
    || selectableProviders[0]
    || ''

  if (selectedProvider && req.session) {
    req.session[PAYMENT_PROVIDER_SESSION_KEY] = selectedProvider
  }

  return selectedProvider
}

const buildPaymentGatewayCheckoutState = async ({ req }) => {
  const [settings, flutterwavePublicKey, paystackPublicKey, flutterwaveConfigured, paystackConfigured] = await Promise.all([
    getPaymentGatewaySettings(),
    getFlutterwavePublicKey(),
    getPaystackPublicKey(),
    isFlutterwaveConfigured(),
    isPaystackConfigured()
  ])

  const flutterwaveCredentials = {
    secretKey: getCredentialMetaForDisplay({
      storedCredential: settings.flutterwave.secretKey,
      envValue: process.env.FLUTTERWAVE_SECRET_KEY
    }),
    publicKey: getCredentialMetaForDisplay({
      storedCredential: settings.flutterwave.publicKey,
      envValue: process.env.FLUTTERWAVE_PUBLIC_KEY
    }),
    webhookHash: getCredentialMetaForDisplay({
      storedCredential: settings.flutterwave.webhookHash,
      envValue: process.env.FLUTTERWAVE_WEBHOOK_HASH
    })
  }
  const paystackCredentials = {
    secretKey: getCredentialMetaForDisplay({
      storedCredential: settings.paystack.secretKey,
      envValue: process.env.PAYSTACK_SECRET_KEY
    }),
    publicKey: getCredentialMetaForDisplay({
      storedCredential: settings.paystack.publicKey,
      envValue: process.env.PAYSTACK_PUBLIC_KEY
    })
  }

  const providerOptions = PAYMENT_PROVIDERS.map((providerKey) => {
    const isFlutterwaveProvider = providerKey === 'flutterwave'
    const configured = isFlutterwaveProvider ? flutterwaveConfigured : paystackConfigured
    const enabled = isFlutterwaveProvider ? settings.flutterwave.enabled : settings.paystack.enabled
    const label = PAYMENT_PROVIDER_COPY[providerKey]?.label || providerKey
    const description = PAYMENT_PROVIDER_COPY[providerKey]?.description || ''
    const keyMeta = isFlutterwaveProvider ? flutterwaveCredentials : paystackCredentials
    const canCheckout = enabled && configured
    return {
      key: providerKey,
      label,
      description,
      enabled,
      configured,
      canCheckout,
      reason: !enabled
        ? 'Disabled by admin'
        : (!configured ? 'Missing API credentials' : ''),
      publicKey: isFlutterwaveProvider ? flutterwavePublicKey : paystackPublicKey,
      credentials: keyMeta
    }
  })

  const enabledProviders = providerOptions.filter((provider) => provider.enabled).map((provider) => provider.key)
  const availableProviders = providerOptions.filter((provider) => provider.canCheckout).map((provider) => provider.key)
  const defaultProvider = normalizePaymentProvider(settings.defaultProvider, PAYMENT_GATEWAY_DEFAULTS.defaultProvider)

  const selectedProvider = resolveSelectedPaymentProvider({
    req,
    checkoutState: {
      providerOptions,
      defaultProvider
    }
  })

  return {
    defaultProvider,
    selectedProvider,
    providerOptions,
    enabledProviders,
    availableProviders,
    hasAvailableProvider: availableProviders.length > 0,
    requiresSelection: availableProviders.length > 1
  }
}

const buildPaymentGatewaySettingsResponse = async ({ req, includeCredentialMeta = true } = {}) => {
  const checkoutState = await buildPaymentGatewayCheckoutState({ req })
  const flutterwaveProvider = checkoutState.providerOptions.find((entry) => entry.key === 'flutterwave') || {}
  const paystackProvider = checkoutState.providerOptions.find((entry) => entry.key === 'paystack') || {}

  const result = {
    defaultProvider: checkoutState.defaultProvider,
    selectedProvider: checkoutState.selectedProvider,
    requiresSelection: checkoutState.requiresSelection,
    hasAvailableProvider: checkoutState.hasAvailableProvider,
    providers: {
      flutterwave: {
        enabled: flutterwaveProvider.enabled === true,
        configured: flutterwaveProvider.configured === true,
        statusLabel: flutterwaveProvider.configured ? 'Configured' : 'Missing keys',
        reason: flutterwaveProvider.reason || '',
        label: flutterwaveProvider.label || PAYMENT_PROVIDER_COPY.flutterwave.label
      },
      paystack: {
        enabled: paystackProvider.enabled === true,
        configured: paystackProvider.configured === true,
        statusLabel: paystackProvider.configured ? 'Configured' : 'Missing keys',
        reason: paystackProvider.reason || '',
        label: paystackProvider.label || PAYMENT_PROVIDER_COPY.paystack.label,
        webhookPath: '/api/simple-lms/payments/paystack/webhook'
      }
    }
  }

  if (includeCredentialMeta) {
    result.providers.flutterwave.credentials = {
      secretKey: flutterwaveProvider?.credentials?.secretKey || getCredentialMetaForDisplay({}),
      publicKey: flutterwaveProvider?.credentials?.publicKey || getCredentialMetaForDisplay({}),
      webhookHash: flutterwaveProvider?.credentials?.webhookHash || getCredentialMetaForDisplay({})
    }
    result.providers.paystack.credentials = {
      secretKey: paystackProvider?.credentials?.secretKey || getCredentialMetaForDisplay({}),
      publicKey: paystackProvider?.credentials?.publicKey || getCredentialMetaForDisplay({})
    }
  }

  return result
}

const parseBooleanFlag = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'on', 'yes', 'enabled'].includes(normalized)) return true
  if (['false', '0', 'off', 'no', 'disabled'].includes(normalized)) return false
  return fallback
}

const parseCredentialInput = (value) => {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized || null
}

const signaturesMatch = (left, right) => {
  const normalizedLeft = String(left || '').trim()
  const normalizedRight = String(right || '').trim()
  if (!normalizedLeft || !normalizedRight) return false
  const leftBuffer = Buffer.from(normalizedLeft, 'utf8')
  const rightBuffer = Buffer.from(normalizedRight, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const applyPaymentGatewaySettingsUpdate = async ({ req, payload = {} }) => {
  const role = resolveRole(req.user)
  ensureSuperAdminForPaymentSettings(role)

  const settingsDoc = await SimpleLmsPlatformSetting.findOne({}) || new SimpleLmsPlatformSetting({})
  const currentSettings = normalizePaymentGatewaySettings(settingsDoc.paymentGateways || PAYMENT_GATEWAY_DEFAULTS)

  const nextFlutterwaveEnabled = parseBooleanFlag(payload.flutterwaveEnabled, currentSettings.flutterwave.enabled)
  const nextPaystackEnabled = parseBooleanFlag(payload.paystackEnabled, currentSettings.paystack.enabled)
  if (!nextFlutterwaveEnabled && !nextPaystackEnabled) {
    const error = new Error('At least one payment provider must remain enabled.')
    error.statusCode = 400
    throw error
  }

  let nextDefaultProvider = normalizePaymentProvider(payload.defaultProvider, currentSettings.defaultProvider)
  if (nextDefaultProvider === 'flutterwave' && !nextFlutterwaveEnabled) {
    nextDefaultProvider = 'paystack'
  }
  if (nextDefaultProvider === 'paystack' && !nextPaystackEnabled) {
    nextDefaultProvider = 'flutterwave'
  }

  settingsDoc.paymentGateways = settingsDoc.paymentGateways || {}
  settingsDoc.paymentGateways.flutterwave = settingsDoc.paymentGateways.flutterwave || {}
  settingsDoc.paymentGateways.paystack = settingsDoc.paymentGateways.paystack || {}

  const providerToggleChanges = []
  if (currentSettings.flutterwave.enabled !== nextFlutterwaveEnabled) {
    providerToggleChanges.push({
      provider: 'flutterwave',
      from: currentSettings.flutterwave.enabled,
      to: nextFlutterwaveEnabled
    })
  }
  if (currentSettings.paystack.enabled !== nextPaystackEnabled) {
    providerToggleChanges.push({
      provider: 'paystack',
      from: currentSettings.paystack.enabled,
      to: nextPaystackEnabled
    })
  }

  const defaultProviderChanged = currentSettings.defaultProvider !== nextDefaultProvider

  settingsDoc.paymentGateways.flutterwave.enabled = nextFlutterwaveEnabled
  settingsDoc.paymentGateways.paystack.enabled = nextPaystackEnabled
  settingsDoc.paymentGateways.defaultProvider = nextDefaultProvider

  const credentialChanges = []
  const credentialInputMap = [
    {
      provider: 'flutterwave',
      keyType: 'secretKey',
      input: parseCredentialInput(payload.flutterwaveSecretKey ?? payload.credentials?.flutterwave?.secretKey)
    },
    {
      provider: 'flutterwave',
      keyType: 'publicKey',
      input: parseCredentialInput(payload.flutterwavePublicKey ?? payload.credentials?.flutterwave?.publicKey)
    },
    {
      provider: 'flutterwave',
      keyType: 'webhookHash',
      input: parseCredentialInput(payload.flutterwaveWebhookHash ?? payload.credentials?.flutterwave?.webhookHash)
    },
    {
      provider: 'paystack',
      keyType: 'secretKey',
      input: parseCredentialInput(payload.paystackSecretKey ?? payload.credentials?.paystack?.secretKey)
    },
    {
      provider: 'paystack',
      keyType: 'publicKey',
      input: parseCredentialInput(payload.paystackPublicKey ?? payload.credentials?.paystack?.publicKey)
    }
  ]

  const hasCredentialInput = credentialInputMap.some((entry) => Boolean(entry.input))
  if (hasCredentialInput) {
    if (!isCredentialEncryptionConfigured()) {
      const error = new Error('CREDENTIALS_ENCRYPTION_KEY must be configured before saving API keys.')
      error.statusCode = 400
      throw error
    }
    await assertPaymentCredentialUpdateRateLimit({ accountId: req.user?._id })
    await verifyPaymentSettingsReauth({
      req,
      password: payload.password || payload.currentPassword
    })
  }

  for (const entry of credentialInputMap) {
    if (!entry.input) continue
    const gatewayNode = settingsDoc.paymentGateways[entry.provider] || {}
    const currentCredential = gatewayNode[entry.keyType] || {}
    const oldLastFour = getCredentialMetaForDisplay({ storedCredential: currentCredential }).lastFour

    const encryptedCredential = encryptCredentialValue(entry.input)
    encryptedCredential.updatedBy = req.user._id
    encryptedCredential.updatedAt = new Date()
    settingsDoc.paymentGateways[entry.provider][entry.keyType] = encryptedCredential

    credentialChanges.push({
      provider: entry.provider,
      keyType: entry.keyType,
      oldLastFour,
      newLastFour: encryptedCredential.lastFour
    })
  }

  settingsDoc.updatedBy = req.user._id
  settingsDoc.updatedAt = new Date()
  await settingsDoc.save()

  for (const toggleChange of providerToggleChanges) {
    await logAuditEvent({
      action: 'payment.gateway.provider_toggled',
      performedBy: req.user._id,
      metadata: {
        provider: toggleChange.provider,
        enabled: toggleChange.to,
        previousEnabled: toggleChange.from
      },
      req
    })
  }

  if (defaultProviderChanged) {
    await logAuditEvent({
      action: 'payment.gateway.default_changed',
      performedBy: req.user._id,
      metadata: {
        previousDefault: currentSettings.defaultProvider,
        defaultProvider: nextDefaultProvider
      },
      req
    })
  }

  for (const credentialChange of credentialChanges) {
    await logAuditEvent({
      action: 'payment.gateway.credential_updated',
      performedBy: req.user._id,
      metadata: {
        provider: credentialChange.provider,
        keyType: credentialChange.keyType,
        change: `${maskKey(credentialChange.oldLastFour)} -> ${maskKey(credentialChange.newLastFour)}`
      },
      req
    })
  }

  return buildPaymentGatewaySettingsResponse({ req })
}

const resolveCommissionRate = ({ settings, creatorId, courseId }) => {
  const globalRate = normalizeCommissionRate(settings?.globalRatePercent, 70)
  const normalizedCreatorId = toIdString(creatorId)
  const normalizedCourseId = toIdString(courseId)

  const courseOverride = (settings?.courseOverrides || [])
    .find((entry) => toIdString(entry?.course) === normalizedCourseId)
  if (courseOverride) {
    return normalizeCommissionRate(courseOverride.ratePercent, globalRate)
  }

  const accountOverride = (settings?.accountOverrides || [])
    .find((entry) => toIdString(entry?.account) === normalizedCreatorId)
  if (accountOverride) {
    return normalizeCommissionRate(accountOverride.ratePercent, globalRate)
  }

  return globalRate
}

const isCoursePaidContent = (course) => {
  const paymentMode = String(course?.pricing?.paymentMode || '').trim().toLowerCase()
  const amount = Number.isFinite(Number(course?.pricing?.amount)) ? Number(course.pricing.amount) : 0
  return paymentMode === 'paid' && amount > 0
}

const buildAppBaseUrl = (req) => {
  const requestBaseUrl = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '')
  const forceConfiguredBase = String(process.env.APP_BASE_URL_FORCE || '').trim().toLowerCase() === 'true'
  const configured = String(process.env.APP_BASE_URL || '').trim()
  if (forceConfiguredBase && configured) return configured.replace(/\/+$/, '')
  return requestBaseUrl
}

const parseTags = (value) => String(value || '')
  .split(',')
  .map(tag => tag.trim())
  .filter(Boolean)

const normalizeVisibility = (value, role) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'marketplace') {
    return canManagePlatform(role) ? 'system_public' : 'organization_public'
  }
  if (normalized === 'public') return 'organization_public'
  return 'organization_private'
}

const visibilityToDisplay = (value) => {
  if (value === 'system_public') return 'Marketplace'
  if (value === 'organization_public') return 'Public'
  return 'Private'
}

const normalizeSort = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return SORT_OPTIONS.includes(normalized) ? normalized : 'newest'
}

const mapSortToMongo = (sortKey) => {
  switch (sortKey) {
    case 'popular':
      return { enrollmentCount: -1, updatedAt: -1 }
    case 'title_asc':
      return { title: 1, updatedAt: -1 }
    case 'duration_desc':
      return { estimatedDurationMinutes: -1, updatedAt: -1 }
    default:
      return { updatedAt: -1 }
  }
}

const requirePageAuth = async (req, res, next) => {
  const sub = String(req.session?.accountId || '').trim()
  if (!sub) {
    return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
  }
  const account = await resolveAccountFromSessionIdentifier(sub)
  if (!account) {
    return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
  }
  req.user = account
  req.learningRole = resolveRole(account)
  req.accessProfile = await resolveAccessProfile(account)
  res.locals.user = account
  res.locals.learningRole = req.learningRole
  res.locals.accessProfile = req.accessProfile
  return next()
}

const requireAdminPageAuth = async (req, res, next) => {
  const sub = String(req.session?.accountId || '').trim()
  if (!sub) {
    return res.redirect(`/admin/login?return_to=${encodeURIComponent(req.originalUrl || '/admin')}`)
  }
  const account = await resolveAccountFromSessionIdentifier(sub)
  if (!account) {
    return res.redirect(`/admin/login?return_to=${encodeURIComponent(req.originalUrl || '/admin')}`)
  }
  const role = resolveRole(account)
  if (!canManagePlatform(role)) {
    return res.redirect('/login?error=Admin%20access%20is%20required')
  }
  req.user = account
  req.learningRole = role
  req.accessProfile = await resolveAccessProfile(account)
  res.locals.user = account
  res.locals.learningRole = role
  res.locals.accessProfile = req.accessProfile
  return next()
}

const requireApiAuth = async (req, res, next) => {
  const sub = String(req.session?.accountId || '').trim()
  if (!sub) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  const account = await resolveAccountFromSessionIdentifier(sub)
  if (!account) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.user = account
  req.learningRole = resolveRole(account)
  req.accessProfile = await resolveAccessProfile(account)
  res.locals.user = account
  res.locals.learningRole = req.learningRole
  res.locals.accessProfile = req.accessProfile
  return next()
}

const assertCurrentPassword = async ({ accountId, password }) => {
  const currentPassword = String(password || '').trim()
  if (!currentPassword) {
    throw new Error('Current password is required.')
  }
  const account = await Account.findById(accountId).select('_id passwordHash')
  if (!account?.passwordHash) {
    throw new Error('Unable to validate your current password.')
  }
  const isMatch = await bcrypt.compare(currentPassword, account.passwordHash)
  if (!isMatch) {
    throw new Error('Current password is incorrect.')
  }
}

const ensureSuperAdminForPaymentSettings = (role) => {
  if (!isSuperAdminRole(role)) {
    const error = new Error('Only super admins can manage payment gateway settings.')
    error.statusCode = 403
    throw error
  }
}

const countRecentAuditEvents = async ({ accountId, action, lookbackMs = 60 * 60 * 1000 }) => {
  if (!accountId || !action) return 0
  return AuditLog.countDocuments({
    performedBy: accountId,
    action,
    createdAt: { $gte: new Date(Date.now() - lookbackMs) }
  })
}

const assertPaymentCredentialUpdateRateLimit = async ({ accountId }) => {
  const changesInWindow = await countRecentAuditEvents({
    accountId,
    action: 'payment.gateway.credential_updated'
  })
  if (changesInWindow >= CREDENTIAL_UPDATE_MAX_PER_HOUR) {
    const error = new Error('Credential update limit reached. Try again in one hour.')
    error.statusCode = 429
    throw error
  }
}

const assertPaymentReauthAllowed = async ({ accountId }) => {
  const failedAttempts = await countRecentAuditEvents({
    accountId,
    action: 'payment.gateway.reauth_failed'
  })
  if (failedAttempts >= REAUTH_MAX_ATTEMPTS_PER_HOUR) {
    const error = new Error('Too many failed confirmations. Payment settings are locked for one hour.')
    error.statusCode = 429
    throw error
  }
}

const verifyPaymentSettingsReauth = async ({ req, password }) => {
  await assertPaymentReauthAllowed({ accountId: req.user?._id })
  const candidatePassword = String(password || '').trim()
  if (!candidatePassword) {
    const error = new Error('Password confirmation is required.')
    error.statusCode = 401
    throw error
  }

  const account = await Account.findById(req.user?._id).select('_id passwordHash')
  const isMatch = Boolean(account?.passwordHash) && await bcrypt.compare(candidatePassword, account.passwordHash)
  if (isMatch) return true

  const failedAttempts = await countRecentAuditEvents({
    accountId: req.user?._id,
    action: 'payment.gateway.reauth_failed'
  })
  const nextFailedCount = failedAttempts + 1

  await logAuditEvent({
    action: 'payment.gateway.reauth_failed',
    performedBy: req.user?._id,
    metadata: {
      failedAttemptCount: nextFailedCount
    },
    req
  })

  if (nextFailedCount >= REAUTH_MAX_ATTEMPTS_PER_HOUR) {
    await logAuditEvent({
      action: 'payment.gateway.reauth_blocked',
      performedBy: req.user?._id,
      metadata: {
        failedAttemptCount: nextFailedCount,
        lockoutMinutes: 60
      },
      req
    })
  }

  const error = new Error('Password confirmation failed.')
  error.statusCode = 401
  throw error
}

const ownsCourseRecord = ({ accountId, course }) => (
  Boolean(course) && toIdString(course.createdBy) === toIdString(accountId)
)

const courseBelongsToPartnerOrganization = ({ course, partnerOrganizationId = null }) => {
  const normalizedPartnerOrg = toIdString(partnerOrganizationId)
  const courseOrgId = toIdString(course?.organization)
  return Boolean(normalizedPartnerOrg) && normalizedPartnerOrg === courseOrgId
}

const canManageCourse = ({ role, accountId, course, partnerOrganizationId = null }) => {
  if (!course) return false
  if (canManagePlatform(role)) return true
  if (ownsCourseRecord({ accountId, course })) return true

  const normalizedRole = String(role || '').trim().toLowerCase()
  if (isPartnerSuperRole(normalizedRole)) {
    return courseBelongsToPartnerOrganization({ course, partnerOrganizationId })
  }

  return false
}

const canEditCourse = ({ accountId, course }) => ownsCourseRecord({ accountId, course })

const canDuplicateCourse = ({ role, accountId, course }) => (
  canCreateCourses(role) && canEditCourse({ accountId, course })
)

const canArchiveCourse = ({ role, accountId, course, partnerOrganizationId = null }) => {
  if (!course) return false
  if (canManagePlatform(role)) return true
  if (ownsCourseRecord({ accountId, course })) return true

  const normalizedRole = String(role || '').trim().toLowerCase()
  if (isPartnerSuperRole(normalizedRole)) {
    return courseBelongsToPartnerOrganization({ course, partnerOrganizationId })
  }

  return false
}

const canRestoreCourse = ({ role, accountId, course, partnerOrganizationId = null }) => (
  canArchiveCourse({ role, accountId, course, partnerOrganizationId })
)

const canAssignCourse = ({ role, accountId, course, partnerOrganizationId = null }) => (
  canArchiveCourse({ role, accountId, course, partnerOrganizationId })
)

const canDeleteCourse = ({ role }) => isSuperAdminRole(role)

const buildCourseActionPermissions = ({
  role,
  accountId,
  course,
  partnerOrganizationId = null,
  programReferenceCount = 0,
  successfulPaymentCount = 0
}) => {
  const isArchived = String(course?.status || '').trim().toLowerCase() === 'archived' || course?.isActive === false
  const enrollmentCount = Math.max(0, Number(course?.enrollmentCount || 0))
  const deleteRestrictions = []
  if (enrollmentCount > 0) {
    deleteRestrictions.push(`${enrollmentCount} enrollment${enrollmentCount === 1 ? '' : 's'}`)
  }
  if (successfulPaymentCount > 0) {
    deleteRestrictions.push(`${successfulPaymentCount} successful payment${successfulPaymentCount === 1 ? '' : 's'}`)
  }
  if (programReferenceCount > 0) {
    deleteRestrictions.push(`${programReferenceCount} program reference${programReferenceCount === 1 ? '' : 's'}`)
  }

  const baseDeleteAccess = canDeleteCourse({ role })

  return {
    isOwnedByCurrentUser: ownsCourseRecord({ accountId, course }),
    canEdit: canEditCourse({ accountId, course }),
    canDuplicate: canDuplicateCourse({ role, accountId, course }),
    canArchive: !isArchived && canArchiveCourse({ role, accountId, course, partnerOrganizationId }),
    canRestore: isArchived && canRestoreCourse({ role, accountId, course, partnerOrganizationId }),
    canAssign: canAssignCourse({ role, accountId, course, partnerOrganizationId }),
    canDelete: baseDeleteAccess && deleteRestrictions.length === 0,
    deleteBlockedReason: baseDeleteAccess && deleteRestrictions.length > 0
      ? `Permanent delete is blocked because this course has ${deleteRestrictions.join(' and ')}.`
      : '',
    programReferenceCount,
    successfulPaymentCount
  }
}

const parseDateBoundary = (value, boundary = 'start') => {
  const candidate = String(value || '').trim()
  if (!candidate) return null
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) return null
  if (boundary === 'end') {
    parsed.setHours(23, 59, 59, 999)
  } else {
    parsed.setHours(0, 0, 0, 0)
  }
  return parsed
}

const resolveReportWindow = (query = {}, fallbackLookbackDays = 30) => {
  const fallback = Number.isFinite(Number(fallbackLookbackDays))
    ? Math.min(365, Math.max(1, Math.round(Number(fallbackLookbackDays))))
    : 30
  const lookbackCandidate = Number(query.lookbackDays || query.lookback || fallback)
  const lookbackDays = Number.isFinite(lookbackCandidate)
    ? Math.min(365, Math.max(1, Math.round(lookbackCandidate)))
    : fallback
  const to = parseDateBoundary(query.to || query.endDate || '', 'end') || new Date()
  const from = parseDateBoundary(query.from || query.startDate || '', 'start')
    || new Date(to.getTime() - (lookbackDays * 24 * 60 * 60 * 1000))
  if (from.getTime() <= to.getTime()) {
    return { from, to, lookbackDays }
  }
  return { from: to, to: from, lookbackDays }
}

const parseObjectIdFilter = (value) => {
  const normalized = String(value || '').trim()
  return mongoose.Types.ObjectId.isValid(normalized)
    ? normalized
    : ''
}

const resolveReportPartnerOrganizationId = ({ role, user, query = {} }) => {
  const normalizedRole = String(role || '').trim().toLowerCase()
  if (canManagePlatform(normalizedRole)) {
    return parseObjectIdFilter(query.partnerOrganization || query.organization || query.orgId || '')
  }
  if (isPartnerDashboardRole(normalizedRole) || normalizedRole === 'channel_sales_agent') {
    return parseObjectIdFilter(user?.partnerOrganization || '')
  }
  return ''
}

const toIsoDateInput = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const resolveReportsContext = ({ req, fallbackLookbackDays = 30 } = {}) => {
  const role = resolveRole(req.user)
  const partnerOrganizationId = resolveReportPartnerOrganizationId({
    role,
    user: req.user,
    query: req.query || {}
  })
  const window = resolveReportWindow(req.query || {}, fallbackLookbackDays)
  const agentId = parseObjectIdFilter(req.query?.agentId || '')
  const courseId = parseObjectIdFilter(req.query?.courseId || '')
  return {
    role,
    accountId: req.user?._id,
    partnerOrganizationId,
    from: window.from,
    to: window.to,
    lookbackDays: window.lookbackDays,
    agentId,
    courseId
  }
}

const resolveCsvFilename = (prefix = 'report', from, to) => {
  const start = toIsoDateInput(from).replace(/-/g, '')
  const end = toIsoDateInput(to).replace(/-/g, '')
  const safePrefix = String(prefix || 'report')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'report'
  if (start && end) return `${safePrefix}-${start}-${end}.csv`
  const today = toIsoDateInput(new Date()).replace(/-/g, '')
  return `${safePrefix}-${today}.csv`
}

const shouldExportCsv = (req) => {
  return String(req.query?.format || '').trim().toLowerCase() === 'csv'
}

const csvEscape = (value) => {
  const normalized = value === null || value === undefined ? '' : String(value)
  if (!/[",\r\n]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '""')}"`
}

const toCsv = (headers = [], rows = []) => {
  const headerRow = headers.map((header) => csvEscape(header)).join(',')
  const dataRows = rows.map((row) => row.map((value) => csvEscape(value)).join(','))
  return [headerRow, ...dataRows].join('\n')
}

const buildSalesReportData = async ({
  role,
  accountId,
  partnerOrganizationId = '',
  agentId = '',
  courseId = '',
  from,
  to
}) => {
  const normalizedRole = String(role || '').trim().toLowerCase()
  const accountObjectId = mongoose.Types.ObjectId.isValid(String(accountId || ''))
    ? new mongoose.Types.ObjectId(String(accountId))
    : null
  const courseObjectId = mongoose.Types.ObjectId.isValid(String(courseId || ''))
    ? new mongoose.Types.ObjectId(String(courseId))
    : null
  const agentObjectId = mongoose.Types.ObjectId.isValid(String(agentId || ''))
    ? new mongoose.Types.ObjectId(String(agentId))
    : null
  const baseDateMatch = {}
  if (from || to) {
    baseDateMatch.$gte = from || undefined
    baseDateMatch.$lte = to || undefined
  }

  if (normalizedRole === 'channel_sales_agent' || isPartnerDashboardRole(normalizedRole)) {
    const match = {}
    if (Object.keys(baseDateMatch).length > 0) {
      match.createdAt = baseDateMatch
    }
    if (normalizedRole === 'channel_sales_agent') {
      if (!accountObjectId) return { rows: [], summary: { saleCount: 0, grossSalesMinor: 0 }, scope: 'agent' }
      match.agent = accountObjectId
    } else {
      const orgId = String(partnerOrganizationId || '').trim()
      if (!mongoose.Types.ObjectId.isValid(orgId)) {
        return { rows: [], summary: { saleCount: 0, grossSalesMinor: 0 }, scope: 'partner' }
      }
      match.partnerOrganization = new mongoose.Types.ObjectId(orgId)
      if (agentObjectId) {
        match.agent = agentObjectId
      }
    }
    if (courseObjectId) {
      match.course = courseObjectId
    }

    const rowsRaw = await AgentSaleAttribution.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          saleCount: { $sum: 1 },
          grossSalesMinor: { $sum: { $ifNull: ['$saleAmountMinor', 0] } },
          agentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
          partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
        }
      },
      { $sort: { _id: 1 } }
    ])

    const rows = (rowsRaw || []).map((entry) => ({
      date: String(entry?._id || ''),
      saleCount: Math.max(0, Number(entry?.saleCount || 0)),
      grossSalesMinor: Math.max(0, Number(entry?.grossSalesMinor || 0)),
      agentCommissionMinor: Math.max(0, Number(entry?.agentCommissionMinor || 0)),
      partnerEarningsMinor: Math.max(0, Number(entry?.partnerEarningsMinor || 0))
    }))
    const summary = rows.reduce((acc, row) => ({
      saleCount: acc.saleCount + row.saleCount,
      grossSalesMinor: acc.grossSalesMinor + row.grossSalesMinor,
      agentCommissionMinor: acc.agentCommissionMinor + row.agentCommissionMinor,
      partnerEarningsMinor: acc.partnerEarningsMinor + row.partnerEarningsMinor
    }), { saleCount: 0, grossSalesMinor: 0, agentCommissionMinor: 0, partnerEarningsMinor: 0 })

    return {
      rows,
      summary,
      scope: normalizedRole === 'channel_sales_agent' ? 'agent' : 'partner'
    }
  }

  const paymentMatch = { status: 'successful' }
  if (Object.keys(baseDateMatch).length > 0) {
    paymentMatch.paidAt = baseDateMatch
  }
  if (courseObjectId) {
    paymentMatch.course = courseObjectId
  }
  if (!canManagePlatform(normalizedRole)) {
    if (normalizedRole === 'learner') {
      if (!accountObjectId) return { rows: [], summary: { saleCount: 0, grossSalesMinor: 0 }, scope: 'learner' }
      paymentMatch.account = accountObjectId
    } else {
      if (!accountObjectId) return { rows: [], summary: { saleCount: 0, grossSalesMinor: 0 }, scope: 'creator' }
      paymentMatch.creatorAccount = accountObjectId
    }
  } else if (agentObjectId) {
    const attributedPayments = await AgentSaleAttribution.find({ agent: agentObjectId })
      .select('payment')
      .lean()
    const paymentIds = attributedPayments
      .map((entry) => toIdString(entry.payment))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
    if (paymentIds.length === 0) {
      return {
        rows: [],
        summary: { saleCount: 0, grossSalesMinor: 0, creatorCommissionMinor: 0, platformShareMinor: 0 },
        scope: 'platform'
      }
    }
    paymentMatch._id = { $in: paymentIds }
  }

  const rowsRaw = await SimpleLmsPayment.aggregate([
    { $match: paymentMatch },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$paidAt'
          }
        },
        saleCount: { $sum: 1 },
        grossSalesMinor: { $sum: { $ifNull: ['$amountMinor', 0] } },
        creatorCommissionMinor: { $sum: { $ifNull: ['$creatorCommissionMinor', 0] } },
        platformShareMinor: { $sum: { $ifNull: ['$platformShareMinor', 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ])

  const rows = (rowsRaw || []).map((entry) => ({
    date: String(entry?._id || ''),
    saleCount: Math.max(0, Number(entry?.saleCount || 0)),
    grossSalesMinor: Math.max(0, Number(entry?.grossSalesMinor || 0)),
    creatorCommissionMinor: Math.max(0, Number(entry?.creatorCommissionMinor || 0)),
    platformShareMinor: Math.max(0, Number(entry?.platformShareMinor || 0))
  }))
  const summary = rows.reduce((acc, row) => ({
    saleCount: acc.saleCount + row.saleCount,
    grossSalesMinor: acc.grossSalesMinor + row.grossSalesMinor,
    creatorCommissionMinor: acc.creatorCommissionMinor + row.creatorCommissionMinor,
    platformShareMinor: acc.platformShareMinor + row.platformShareMinor
  }), { saleCount: 0, grossSalesMinor: 0, creatorCommissionMinor: 0, platformShareMinor: 0 })

  return {
    rows,
    summary,
    scope: canManagePlatform(normalizedRole) ? 'platform' : (normalizedRole === 'learner' ? 'learner' : 'creator')
  }
}

const buildCommissionReportData = async ({
  role,
  accountId,
  partnerOrganizationId = '',
  agentId = '',
  courseId = '',
  from,
  to
}) => {
  const normalizedRole = String(role || '').trim().toLowerCase()
  const accountObjectId = mongoose.Types.ObjectId.isValid(String(accountId || ''))
    ? new mongoose.Types.ObjectId(String(accountId))
    : null
  const courseObjectId = mongoose.Types.ObjectId.isValid(String(courseId || ''))
    ? new mongoose.Types.ObjectId(String(courseId))
    : null
  const agentObjectId = mongoose.Types.ObjectId.isValid(String(agentId || ''))
    ? new mongoose.Types.ObjectId(String(agentId))
    : null
  const dateRange = {}
  if (from || to) {
    dateRange.$gte = from || undefined
    dateRange.$lte = to || undefined
  }

  if (normalizedRole === 'channel_sales_agent' || isPartnerDashboardRole(normalizedRole)) {
    const match = {}
    if (Object.keys(dateRange).length > 0) {
      match.createdAt = dateRange
    }
    if (normalizedRole === 'channel_sales_agent') {
      if (!accountObjectId) return { rows: [], summary: { agentCommissionMinor: 0 }, scope: 'agent' }
      match.agent = accountObjectId
    } else {
      const orgId = String(partnerOrganizationId || '').trim()
      if (!mongoose.Types.ObjectId.isValid(orgId)) return { rows: [], summary: { agentCommissionMinor: 0 }, scope: 'partner' }
      match.partnerOrganization = new mongoose.Types.ObjectId(orgId)
      if (agentObjectId) {
        match.agent = agentObjectId
      }
    }
    if (courseObjectId) {
      match.course = courseObjectId
    }

    const rowsRaw = await AgentSaleAttribution.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          saleCount: { $sum: 1 },
          agentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
          partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
        }
      },
      { $sort: { _id: 1 } }
    ])

    const rows = (rowsRaw || []).map((entry) => ({
      date: String(entry?._id || ''),
      saleCount: Math.max(0, Number(entry?.saleCount || 0)),
      agentCommissionMinor: Math.max(0, Number(entry?.agentCommissionMinor || 0)),
      partnerEarningsMinor: Math.max(0, Number(entry?.partnerEarningsMinor || 0))
    }))
    const summary = rows.reduce((acc, row) => ({
      saleCount: acc.saleCount + row.saleCount,
      agentCommissionMinor: acc.agentCommissionMinor + row.agentCommissionMinor,
      partnerEarningsMinor: acc.partnerEarningsMinor + row.partnerEarningsMinor
    }), { saleCount: 0, agentCommissionMinor: 0, partnerEarningsMinor: 0 })

    return {
      rows,
      summary,
      scope: normalizedRole === 'channel_sales_agent' ? 'agent' : 'partner'
    }
  }

  const paymentMatch = { status: 'successful' }
  if (Object.keys(dateRange).length > 0) {
    paymentMatch.paidAt = dateRange
  }
  if (courseObjectId) {
    paymentMatch.course = courseObjectId
  }
  if (!canManagePlatform(normalizedRole)) {
    if (!accountObjectId) return { rows: [], summary: { creatorCommissionMinor: 0, platformShareMinor: 0 }, scope: 'creator' }
    paymentMatch.creatorAccount = accountObjectId
  } else if (agentObjectId) {
    const attributedPayments = await AgentSaleAttribution.find({ agent: agentObjectId })
      .select('payment')
      .lean()
    const paymentIds = attributedPayments
      .map((entry) => toIdString(entry.payment))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
    if (paymentIds.length === 0) {
      return {
        rows: [],
        summary: {
          saleCount: 0,
          creatorCommissionMinor: 0,
          platformShareMinor: 0,
          agentCommissionMinor: 0,
          partnerEarningsMinor: 0
        },
        scope: 'platform'
      }
    }
    paymentMatch._id = { $in: paymentIds }
  }

  const [creatorRowsRaw, agentRowsRaw] = await Promise.all([
    SimpleLmsPayment.aggregate([
      { $match: paymentMatch },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$paidAt'
            }
          },
          saleCount: { $sum: 1 },
          creatorCommissionMinor: { $sum: { $ifNull: ['$creatorCommissionMinor', 0] } },
          platformShareMinor: { $sum: { $ifNull: ['$platformShareMinor', 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    canManagePlatform(normalizedRole)
      ? AgentSaleAttribution.aggregate([
        {
          $match: Object.keys(dateRange).length > 0
            ? { createdAt: dateRange }
            : {}
        },
        ...(agentObjectId || courseObjectId
          ? [{
              $match: {
                ...(agentObjectId ? { agent: agentObjectId } : {}),
                ...(courseObjectId ? { course: courseObjectId } : {})
              }
            }]
          : []),
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            },
            agentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
            partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
          }
        },
        { $sort: { _id: 1 } }
      ])
      : Promise.resolve([])
  ])

  const agentByDate = new Map(
    (agentRowsRaw || []).map((entry) => ([
      String(entry?._id || ''),
      {
        agentCommissionMinor: Math.max(0, Number(entry?.agentCommissionMinor || 0)),
        partnerEarningsMinor: Math.max(0, Number(entry?.partnerEarningsMinor || 0))
      }
    ]))
  )

  const rows = (creatorRowsRaw || []).map((entry) => {
    const date = String(entry?._id || '')
    const agentMetrics = agentByDate.get(date) || { agentCommissionMinor: 0, partnerEarningsMinor: 0 }
    return {
      date,
      saleCount: Math.max(0, Number(entry?.saleCount || 0)),
      creatorCommissionMinor: Math.max(0, Number(entry?.creatorCommissionMinor || 0)),
      platformShareMinor: Math.max(0, Number(entry?.platformShareMinor || 0)),
      agentCommissionMinor: agentMetrics.agentCommissionMinor,
      partnerEarningsMinor: agentMetrics.partnerEarningsMinor
    }
  })

  const summary = rows.reduce((acc, row) => ({
    saleCount: acc.saleCount + row.saleCount,
    creatorCommissionMinor: acc.creatorCommissionMinor + row.creatorCommissionMinor,
    platformShareMinor: acc.platformShareMinor + row.platformShareMinor,
    agentCommissionMinor: acc.agentCommissionMinor + row.agentCommissionMinor,
    partnerEarningsMinor: acc.partnerEarningsMinor + row.partnerEarningsMinor
  }), {
    saleCount: 0,
    creatorCommissionMinor: 0,
    platformShareMinor: 0,
    agentCommissionMinor: 0,
    partnerEarningsMinor: 0
  })

  return {
    rows,
    summary,
    scope: canManagePlatform(normalizedRole) ? 'platform' : 'creator'
  }
}

const buildChurnMetrics = async ({ from, to, partnerOrganizationId = '' } = {}) => {
  const dateRange = {}
  if (from || to) {
    dateRange.$gte = from || undefined
    dateRange.$lte = to || undefined
  }
  const orgFilter = mongoose.Types.ObjectId.isValid(String(partnerOrganizationId || ''))
    ? { partnerOrganization: new mongoose.Types.ObjectId(String(partnerOrganizationId)) }
    : {}

  const [activeAgents, removedAgents, firstSaleRows, courseIds] = await Promise.all([
    Account.countDocuments({
      learningRole: 'channel_sales_agent',
      ...orgFilter
    }),
    AuditLog.countDocuments({
      action: 'agent.remove',
      ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {}),
      ...(orgFilter.partnerOrganization ? { targetOrganization: orgFilter.partnerOrganization } : {})
    }),
    AgentSaleAttribution.aggregate([
      {
        $match: {
          ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {}),
          ...(orgFilter.partnerOrganization ? { partnerOrganization: orgFilter.partnerOrganization } : {})
        }
      },
      {
        $group: {
          _id: '$agent',
          firstSaleAt: { $min: '$createdAt' }
        }
      }
    ]),
    orgFilter.partnerOrganization
      ? SimpleLmsCourse.find({ organization: orgFilter.partnerOrganization }).select('_id').lean()
      : Promise.resolve([])
  ])

  const firstSaleAgentIds = (firstSaleRows || [])
    .map((entry) => toIdString(entry?._id))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
  const firstSaleAgents = firstSaleAgentIds.length > 0
    ? await Account.find({ _id: { $in: firstSaleAgentIds } }).select('_id createdAt').lean()
    : []
  const createdAtByAgentId = new Map(firstSaleAgents.map((entry) => [toIdString(entry._id), entry.createdAt || null]))

  const timeToFirstSaleDays = (firstSaleRows || [])
    .map((entry) => {
      const firstSaleAt = entry?.firstSaleAt ? new Date(entry.firstSaleAt) : null
      const createdAt = createdAtByAgentId.get(toIdString(entry?._id))
      if (!firstSaleAt || !createdAt) return null
      const start = new Date(createdAt)
      if (Number.isNaN(start.getTime()) || Number.isNaN(firstSaleAt.getTime())) return null
      const diffMs = Math.max(0, firstSaleAt.getTime() - start.getTime())
      return diffMs / (24 * 60 * 60 * 1000)
    })
    .filter((value) => Number.isFinite(value))

  const averageTimeToFirstSaleDays = timeToFirstSaleDays.length > 0
    ? Math.round((timeToFirstSaleDays.reduce((sum, value) => sum + value, 0) / timeToFirstSaleDays.length) * 10) / 10
    : 0

  const enrollmentMatch = {}
  if (orgFilter.partnerOrganization) {
    const scopedCourseIds = (courseIds || [])
      .map((course) => toIdString(course?._id))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
    if (scopedCourseIds.length === 0) {
      return {
        activeAgents,
        removedAgents,
        agentAttritionRatePercent: 0,
        averageTimeToFirstSaleDays,
        activeEnrollments: 0,
        atRiskEnrollments: 0,
        learnerDropOffRatePercent: 0
      }
    }
    enrollmentMatch.course = { $in: scopedCourseIds }
  }

  const inactivityThreshold = new Date((to || new Date()).getTime() - (14 * 24 * 60 * 60 * 1000))
  const [activeEnrollments, atRiskEnrollments] = await Promise.all([
    SimpleLmsEnrollment.countDocuments({
      ...enrollmentMatch,
      status: 'active'
    }),
    SimpleLmsEnrollment.countDocuments({
      ...enrollmentMatch,
      status: 'active',
      progressPercent: { $lt: 30 },
      $or: [
        { lastActivityAt: { $lte: inactivityThreshold } },
        { lastActivityAt: { $exists: false } }
      ]
    })
  ])

  const agentBase = Math.max(1, Number(activeAgents || 0) + Number(removedAgents || 0))
  const enrollmentBase = Math.max(1, Number(activeEnrollments || 0))
  return {
    activeAgents: Math.max(0, Number(activeAgents || 0)),
    removedAgents: Math.max(0, Number(removedAgents || 0)),
    agentAttritionRatePercent: Math.round((Math.max(0, Number(removedAgents || 0)) / agentBase) * 1000) / 10,
    averageTimeToFirstSaleDays,
    activeEnrollments: Math.max(0, Number(activeEnrollments || 0)),
    atRiskEnrollments: Math.max(0, Number(atRiskEnrollments || 0)),
    learnerDropOffRatePercent: Math.round((Math.max(0, Number(atRiskEnrollments || 0)) / enrollmentBase) * 1000) / 10
  }
}

const decorateSalesReportRows = (rows = [], currency = 'NGN') => {
  return (rows || []).map((entry) => ({
    ...entry,
    grossSalesDisplay: formatCurrencyAmount(entry.grossSalesMinor || 0, currency),
    creatorCommissionDisplay: formatCurrencyAmount(entry.creatorCommissionMinor || 0, currency),
    platformShareDisplay: formatCurrencyAmount(entry.platformShareMinor || 0, currency),
    agentCommissionDisplay: formatCurrencyAmount(entry.agentCommissionMinor || 0, currency),
    partnerEarningsDisplay: formatCurrencyAmount(entry.partnerEarningsMinor || 0, currency)
  }))
}

const decorateCommissionReportRows = (rows = [], currency = 'NGN') => {
  return (rows || []).map((entry) => ({
    ...entry,
    creatorCommissionDisplay: formatCurrencyAmount(entry.creatorCommissionMinor || 0, currency),
    platformShareDisplay: formatCurrencyAmount(entry.platformShareMinor || 0, currency),
    agentCommissionDisplay: formatCurrencyAmount(entry.agentCommissionMinor || 0, currency),
    partnerEarningsDisplay: formatCurrencyAmount(entry.partnerEarningsMinor || 0, currency)
  }))
}

const buildSalesCsvRows = (rows = [], currency = 'NGN') => {
  const decoratedRows = decorateSalesReportRows(rows, currency)
  return toCsv(
    [
      'Date',
      'Sale Count',
      'Gross Sales (minor)',
      'Gross Sales',
      'Creator Commission (minor)',
      'Creator Commission',
      'Platform Share (minor)',
      'Platform Share',
      'Agent Commission (minor)',
      'Agent Commission',
      'Partner Earnings (minor)',
      'Partner Earnings'
    ],
    decoratedRows.map((entry) => ([
      entry.date || '',
      Number(entry.saleCount || 0),
      Number(entry.grossSalesMinor || 0),
      entry.grossSalesDisplay || '',
      Number(entry.creatorCommissionMinor || 0),
      entry.creatorCommissionDisplay || '',
      Number(entry.platformShareMinor || 0),
      entry.platformShareDisplay || '',
      Number(entry.agentCommissionMinor || 0),
      entry.agentCommissionDisplay || '',
      Number(entry.partnerEarningsMinor || 0),
      entry.partnerEarningsDisplay || ''
    ]))
  )
}

const buildCommissionCsvRows = (rows = [], currency = 'NGN') => {
  const decoratedRows = decorateCommissionReportRows(rows, currency)
  return toCsv(
    [
      'Date',
      'Sale Count',
      'Creator Commission (minor)',
      'Creator Commission',
      'Platform Share (minor)',
      'Platform Share',
      'Agent Commission (minor)',
      'Agent Commission',
      'Partner Earnings (minor)',
      'Partner Earnings'
    ],
    decoratedRows.map((entry) => ([
      entry.date || '',
      Number(entry.saleCount || 0),
      Number(entry.creatorCommissionMinor || 0),
      entry.creatorCommissionDisplay || '',
      Number(entry.platformShareMinor || 0),
      entry.platformShareDisplay || '',
      Number(entry.agentCommissionMinor || 0),
      entry.agentCommissionDisplay || '',
      Number(entry.partnerEarningsMinor || 0),
      entry.partnerEarningsDisplay || ''
    ]))
  )
}

const buildReportWindowPayload = ({ from, to, lookbackDays }) => ({
  from: toIsoDateInput(from),
  to: toIsoDateInput(to),
  lookbackDays: Math.max(1, Number(lookbackDays || 30))
})

const handleSalesReportRequest = async (req, res, { forceCsv = false } = {}) => {
  try {
    const context = resolveReportsContext({ req, fallbackLookbackDays: 30 })
    const currency = normalizeSimpleLmsCurrencyCode(req.query.currency || 'NGN', 'NGN')
    const report = await buildSalesReportData(context)
    const rows = decorateSalesReportRows(report.rows, currency)
    const summary = {
      ...report.summary,
      grossSalesDisplay: formatCurrencyAmount(report.summary?.grossSalesMinor || 0, currency),
      creatorCommissionDisplay: formatCurrencyAmount(report.summary?.creatorCommissionMinor || 0, currency),
      platformShareDisplay: formatCurrencyAmount(report.summary?.platformShareMinor || 0, currency),
      agentCommissionDisplay: formatCurrencyAmount(report.summary?.agentCommissionMinor || 0, currency),
      partnerEarningsDisplay: formatCurrencyAmount(report.summary?.partnerEarningsMinor || 0, currency)
    }
    const window = buildReportWindowPayload(context)

    if (forceCsv || shouldExportCsv(req)) {
      const csv = buildSalesCsvRows(report.rows, currency)
      await logAuditEvent({
        action: 'reports.export',
        performedBy: req.user?._id,
        targetOrganization: context.partnerOrganizationId || null,
        metadata: {
          reportType: 'sales',
          format: 'csv',
          scope: report.scope,
          window,
          filters: {
            agentId: context.agentId,
            courseId: context.courseId,
            partnerOrganizationId: context.partnerOrganizationId
          }
        },
        req
      })
      return res
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${resolveCsvFilename('sales-report', context.from, context.to)}"`)
        .send(csv)
    }

    return res.json({
      reportType: 'sales',
      scope: report.scope,
      window,
      filters: {
        agentId: context.agentId,
        courseId: context.courseId,
        partnerOrganizationId: context.partnerOrganizationId
      },
      currency,
      rows,
      summary
    })
  } catch (error) {
    console.error('Sales report API error:', error)
    return res.status(500).json({ error: 'Failed to load sales report.', code: 'REPORT_SALES_FAILED' })
  }
}

const handleCommissionReportRequest = async (req, res, { forceCsv = false } = {}) => {
  try {
    const context = resolveReportsContext({ req, fallbackLookbackDays: 30 })
    const currency = normalizeSimpleLmsCurrencyCode(req.query.currency || 'NGN', 'NGN')
    const report = await buildCommissionReportData(context)
    const rows = decorateCommissionReportRows(report.rows, currency)
    const summary = {
      ...report.summary,
      creatorCommissionDisplay: formatCurrencyAmount(report.summary?.creatorCommissionMinor || 0, currency),
      platformShareDisplay: formatCurrencyAmount(report.summary?.platformShareMinor || 0, currency),
      agentCommissionDisplay: formatCurrencyAmount(report.summary?.agentCommissionMinor || 0, currency),
      partnerEarningsDisplay: formatCurrencyAmount(report.summary?.partnerEarningsMinor || 0, currency)
    }
    const window = buildReportWindowPayload(context)

    if (forceCsv || shouldExportCsv(req)) {
      const csv = buildCommissionCsvRows(report.rows, currency)
      await logAuditEvent({
        action: 'reports.export',
        performedBy: req.user?._id,
        targetOrganization: context.partnerOrganizationId || null,
        metadata: {
          reportType: 'commissions',
          format: 'csv',
          scope: report.scope,
          window,
          filters: {
            agentId: context.agentId,
            courseId: context.courseId,
            partnerOrganizationId: context.partnerOrganizationId
          }
        },
        req
      })
      return res
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${resolveCsvFilename('commission-report', context.from, context.to)}"`)
        .send(csv)
    }

    return res.json({
      reportType: 'commissions',
      scope: report.scope,
      window,
      filters: {
        agentId: context.agentId,
        courseId: context.courseId,
        partnerOrganizationId: context.partnerOrganizationId
      },
      currency,
      rows,
      summary
    })
  } catch (error) {
    console.error('Commission report API error:', error)
    return res.status(500).json({ error: 'Failed to load commission report.', code: 'REPORT_COMMISSIONS_FAILED' })
  }
}

const handleChurnReportRequest = async (req, res) => {
  try {
    const context = resolveReportsContext({ req, fallbackLookbackDays: 30 })
    const normalizedRole = String(context.role || '').trim().toLowerCase()
    const churnMetrics = await buildChurnMetrics({
      from: context.from,
      to: context.to,
      partnerOrganizationId: canManagePlatform(normalizedRole) ? context.partnerOrganizationId : context.partnerOrganizationId
    })
    return res.json({
      reportType: 'churn',
      scope: canManagePlatform(normalizedRole)
        ? (context.partnerOrganizationId ? 'partner' : 'platform')
        : (isPartnerDashboardRole(normalizedRole) ? 'partner' : normalizedRole),
      window: buildReportWindowPayload(context),
      filters: {
        partnerOrganizationId: context.partnerOrganizationId
      },
      metrics: churnMetrics
    })
  } catch (error) {
    console.error('Churn report API error:', error)
    return res.status(500).json({ error: 'Failed to load churn report.', code: 'REPORT_CHURN_FAILED' })
  }
}

const mountReportRoutes = (router, prefix = '/reports') => {
  const pathFor = (path) => `${prefix}${path}`
  router.get(pathFor('/sales'), (req, res) => handleSalesReportRequest(req, res))
  router.get(pathFor('/daily-sales'), (req, res) => handleSalesReportRequest(req, res))
  router.get(pathFor('/sales/export'), (req, res) => handleSalesReportRequest(req, res, { forceCsv: true }))
  router.get(pathFor('/commissions'), (req, res) => handleCommissionReportRequest(req, res))
  router.get(pathFor('/commissions/export'), (req, res) => handleCommissionReportRequest(req, res, { forceCsv: true }))
  router.get(pathFor('/churn'), handleChurnReportRequest)
}

const normalizePaymentStatusFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'all') return 'all'
  return PAYMENT_STATUSES.includes(normalized) ? normalized : 'all'
}

const buildAdminPaymentsReturnTo = ({
  status = 'all',
  currency = 'all',
  dateFrom = '',
  dateTo = '',
  search = '',
  basePath = '/simple-lms?view=admin'
} = {}) => {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('paymentStatus', status)
  if (currency && currency !== 'all') params.set('paymentCurrency', currency)
  if (dateFrom) params.set('paymentFrom', dateFrom)
  if (dateTo) params.set('paymentTo', dateTo)
  if (search) params.set('paymentSearch', search)
  const queryString = params.toString()
  return queryString ? `${basePath}${basePath.includes('?') ? '&' : '?'}${queryString}` : basePath
}

const buildAdminCreatorReturnTo = ({
  creatorId = '',
  basePath = '/admin/courses'
} = {}) => {
  const params = new URLSearchParams()
  const normalizedCreatorId = String(creatorId || '').trim()
  if (normalizedCreatorId && mongoose.Types.ObjectId.isValid(normalizedCreatorId)) {
    params.set('creatorId', normalizedCreatorId)
  }
  const queryString = params.toString()
  return queryString ? `${basePath}${basePath.includes('?') ? '&' : '?'}${queryString}` : basePath
}

const buildAdminCoursesReturnTo = ({
  creatorId = '',
  status = 'all',
  visibility = 'all',
  courseType = 'all',
  paymentMode = 'all',
  search = '',
  basePath = '/admin/courses'
} = {}) => {
  const params = new URLSearchParams()
  const normalizedCreatorId = String(creatorId || '').trim()
  if (normalizedCreatorId && mongoose.Types.ObjectId.isValid(normalizedCreatorId)) {
    params.set('creatorId', normalizedCreatorId)
  }
  const normalizedStatus = String(status || '').trim().toLowerCase()
  if (normalizedStatus && normalizedStatus !== 'all') params.set('courseStatus', normalizedStatus)
  const normalizedVisibility = String(visibility || '').trim().toLowerCase()
  if (normalizedVisibility && normalizedVisibility !== 'all') params.set('courseVisibility', normalizedVisibility)
  const normalizedType = String(courseType || '').trim().toLowerCase()
  if (normalizedType && normalizedType !== 'all') params.set('courseType', normalizedType)
  const normalizedPaymentMode = String(paymentMode || '').trim().toLowerCase()
  if (normalizedPaymentMode && normalizedPaymentMode !== 'all') params.set('coursePayment', normalizedPaymentMode)
  const normalizedSearch = String(search || '').trim()
  if (normalizedSearch) params.set('courseSearch', normalizedSearch)
  const queryString = params.toString()
  return queryString ? `${basePath}${basePath.includes('?') ? '&' : '?'}${queryString}` : basePath
}

const canManageProgram = ({ role, accountId, program }) => {
  if (!program) return false
  if (canManagePlatform(role)) return true
  return toIdString(program.createdBy) === toIdString(accountId)
}

const parseViewMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'studio' || normalized === 'course-studio' || normalized === 'manage') return 'course-studio'
  if (normalized === 'program-studio' || normalized === 'pathways') return 'program-studio'
  if (normalized === 'checkout') return 'cart'
  return VIEW_MODES.includes(normalized) ? normalized : 'overview'
}

const parseSettingsTab = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return SETTINGS_TABS.includes(normalized) ? normalized : 'profile'
}

const parseCreatorSettingsSection = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return CREATOR_SETTINGS_SECTIONS.includes(normalized) ? normalized : 'defaults'
}

const parsePartnerApplicationIntent = (value, fallback = 'partner') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (['partner', 'channel_partner'].includes(normalized)) return normalized
  return fallback
}

const DIRECT_ROLE_UPDATE_VALUES = Object.freeze([
  'learner',
  'creator',
  'admin',
  'super_admin'
])

const PARTNER_MEMBER_ASSIGNMENT_VALUES = Object.freeze([
  'partner_user',
  'partner_super',
  'channel_partner_user',
  'channel_partner_super'
])

const resolvePartnerTypeForLearningRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase()
  if (['channel_partner_user', 'channel_partner_super'].includes(normalized)) return 'channel_partner'
  if (['partner_user', 'partner_super'].includes(normalized)) return 'partner'
  return 'none'
}

const isDirectPartnerRoleUpdate = (role) => PARTNER_MEMBER_ASSIGNMENT_VALUES.includes(String(role || '').trim().toLowerCase())

const parseAdminSection = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return ADMIN_SECTIONS.includes(normalized) ? normalized : 'overview'
}

const parseCourseStatus = (value, fallback = 'draft') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ['draft', 'published', 'archived', 'pending_public_review'].includes(normalized) ? normalized : fallback
}

const parseProgramStatus = (value, fallback = 'draft') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ['draft', 'published', 'archived'].includes(normalized) ? normalized : fallback
}

const normalizeProgramVisibility = (value, fallback = 'organization_private') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'public' || normalized === 'organization_public') return 'organization_public'
  if (normalized === 'private' || normalized === 'organization_private') return 'organization_private'
  return fallback
}

const getLessonMediaUrl = (lesson) => String(
  lesson?.media?.url
  || lesson?.videoUrl
  || lesson?.mediaUrl
  || lesson?.audioUrl
  || ''
).trim()

const getLessonDurationMinutes = (lesson) => {
  const directMinutes = Number(lesson?.durationMinutes)
  if (Number.isFinite(directMinutes) && directMinutes > 0) {
    return Math.max(0, Math.round(directMinutes))
  }
  const durationSeconds = Number(lesson?.media?.durationSeconds)
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.max(1, Math.ceil(durationSeconds / 60))
  }
  return 0
}

const flattenCourseLessons = (course) => {
  const entries = []
  ;(course?.chapters || []).forEach((chapter, chapterIndex) => {
    const chapterKey = String(chapter?.key || '')
    const chapterOrder = Number.isFinite(Number(chapter?.order)) ? Number(chapter.order) : chapterIndex + 1
    const chapterTitle = String(chapter?.title || '').trim() || `Chapter ${chapterOrder}`
    ;(chapter?.lessons || []).forEach((lesson, lessonIndex) => {
      const lessonKey = String(lesson?.key || '').trim()
      if (!lessonKey) return
      const lessonOrder = Number.isFinite(Number(lesson?.order)) ? Number(lesson.order) : lessonIndex + 1
      entries.push({
        chapterKey,
        chapterOrder,
        chapterTitle,
        lessonKey,
        lessonOrder,
        title: String(lesson?.title || 'Lesson'),
        description: String(lesson?.description || ''),
        content: String(lesson?.content || ''),
        videoUrl: getLessonMediaUrl(lesson),
        media: lesson?.media && typeof lesson.media === 'object'
          ? {
            provider: String(lesson.media.provider || '').trim().toLowerCase(),
            url: String(lesson.media.url || '').trim(),
            publicId: String(lesson.media.publicId || '').trim(),
            resourceType: String(lesson.media.resourceType || '').trim().toLowerCase(),
            format: String(lesson.media.format || '').trim().toLowerCase(),
            bytes: Number.isFinite(Number(lesson.media.bytes)) ? Number(lesson.media.bytes) : 0,
            width: Number.isFinite(Number(lesson.media.width)) ? Number(lesson.media.width) : 0,
            height: Number.isFinite(Number(lesson.media.height)) ? Number(lesson.media.height) : 0,
            durationSeconds: Number.isFinite(Number(lesson.media.durationSeconds)) ? Number(lesson.media.durationSeconds) : 0,
            sourceLabel: String(lesson.media.sourceLabel || '').trim()
          }
          : null,
        durationMinutes: getLessonDurationMinutes(lesson),
        resources: Array.isArray(lesson?.resources) ? lesson.resources : [],
        quizQuestions: Array.isArray(lesson?.quizQuestions) ? lesson.quizQuestions : []
      })
    })
  })
  return entries
}

const calculateProgress = ({ lessons, completedLessonKeys = [] }) => {
  const lessonKeys = lessons.map(lesson => lesson.lessonKey)
  const completedSet = new Set((completedLessonKeys || []).map(key => String(key)))
  const completedCount = lessonKeys.filter(key => completedSet.has(key)).length
  const lessonCount = lessonKeys.length
  const progressPercent = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0
  const nextLesson = lessons.find(entry => !completedSet.has(entry.lessonKey)) || lessons[0] || null
  return {
    completedSet,
    completedCount,
    lessonCount,
    progressPercent,
    nextLessonKey: nextLesson ? nextLesson.lessonKey : null,
    isCompleted: lessonCount > 0 && completedCount >= lessonCount
  }
}

const MEDIA_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.weba'])
const MEDIA_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.m3u8'])

const getPathExtension = (pathname = '') => {
  const value = String(pathname || '').toLowerCase().split('?')[0].split('#')[0]
  const lastDot = value.lastIndexOf('.')
  if (lastDot < 0) return ''
  return value.slice(lastDot)
}

const toDropboxRawUrl = (parsedUrl) => {
  try {
    const copy = new URL(parsedUrl.toString())
    copy.searchParams.delete('dl')
    copy.searchParams.set('raw', '1')
    return copy.toString()
  } catch {
    return parsedUrl.toString()
  }
}

const extractGoogleDriveFileId = (parsedUrl) => {
  const idParam = parsedUrl.searchParams.get('id')
  if (idParam) return idParam

  const parts = parsedUrl.pathname.split('/').filter(Boolean)
  const dIndex = parts.findIndex(part => part === 'd')
  if (dIndex >= 0 && parts[dIndex + 1]) {
    return parts[dIndex + 1]
  }

  if (parts[0] === 'file' && parts[1] === 'd' && parts[2]) {
    return parts[2]
  }

  return ''
}

const resolveLessonMedia = (rawLessonMedia) => {
  if (rawLessonMedia && typeof rawLessonMedia === 'object' && !Array.isArray(rawLessonMedia)) {
    const mediaUrl = String(rawLessonMedia.url || '').trim()
    if (mediaUrl) {
      const mediaType = normalizeLessonMediaResourceType(rawLessonMedia.resourceType, 'video')
      const sourceLabel = String(rawLessonMedia.sourceLabel || '').trim()
        || (mediaType === 'audio' ? 'Cloudinary Audio' : 'Cloudinary Video')
      return {
        kind: mediaType === 'audio' ? 'audio' : 'video',
        rawUrl: mediaUrl,
        directUrl: mediaUrl,
        embedUrl: '',
        sourceLabel,
        durationSeconds: Number.isFinite(Number(rawLessonMedia.durationSeconds))
          ? Math.max(0, Number(rawLessonMedia.durationSeconds))
          : 0,
        bytes: Number.isFinite(Number(rawLessonMedia.bytes)) ? Math.max(0, Number(rawLessonMedia.bytes)) : 0
      }
    }
  }

  const value = String(rawLessonMedia || '').trim()
  if (!value) {
    return {
      kind: 'none',
      rawUrl: '',
      directUrl: '',
      embedUrl: '',
      sourceLabel: ''
    }
  }

  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    const extension = getPathExtension(parsed.pathname)

    if (hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v')
      if (videoId) {
        return {
          kind: 'embed',
          rawUrl: value,
          directUrl: value,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          sourceLabel: 'YouTube'
        }
      }
    }

    if (hostname.includes('youtube.com') && parsed.pathname.includes('/embed/')) {
      return {
        kind: 'embed',
        rawUrl: value,
        directUrl: value,
        embedUrl: value,
        sourceLabel: 'YouTube'
      }
    }

    if (hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0]
      if (videoId) {
        return {
          kind: 'embed',
          rawUrl: value,
          directUrl: value,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          sourceLabel: 'YouTube'
        }
      }
    }

    if (hostname.includes('vimeo.com')) {
      const vimeoId = parsed.pathname.split('/').filter(Boolean).find(part => /^\d+$/.test(part))
      if (vimeoId) {
        return {
          kind: 'embed',
          rawUrl: value,
          directUrl: value,
          embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
          sourceLabel: 'Vimeo'
        }
      }
    }

    if (hostname.includes('player.vimeo.com')) {
      return {
        kind: 'embed',
        rawUrl: value,
        directUrl: value,
        embedUrl: value,
        sourceLabel: 'Vimeo'
      }
    }

    if (hostname.includes('drive.google.com')) {
      const fileId = extractGoogleDriveFileId(parsed)
      if (fileId) {
        return {
          kind: 'embed',
          rawUrl: value,
          directUrl: value,
          embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
          sourceLabel: 'Google Drive'
        }
      }
    }

    if (hostname.includes('docs.google.com')) {
      return {
        kind: 'embed',
        rawUrl: value,
        directUrl: value,
        embedUrl: value,
        sourceLabel: 'Google'
      }
    }

    if (hostname.includes('loom.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean)
      const shareIndex = parts.findIndex((part) => part === 'share')
      const embedIndex = parts.findIndex((part) => part === 'embed')
      const loomId = (shareIndex >= 0 && parts[shareIndex + 1])
        ? parts[shareIndex + 1]
        : ((embedIndex >= 0 && parts[embedIndex + 1]) ? parts[embedIndex + 1] : '')
      if (loomId) {
        return {
          kind: 'embed',
          rawUrl: value,
          directUrl: value,
          embedUrl: `https://www.loom.com/embed/${loomId}`,
          sourceLabel: 'Loom'
        }
      }
    }

    if (hostname.includes('dropbox.com')) {
      const directDropboxUrl = toDropboxRawUrl(parsed)
      if (MEDIA_AUDIO_EXTENSIONS.has(extension)) {
        return {
          kind: 'audio',
          rawUrl: value,
          directUrl: directDropboxUrl,
          embedUrl: '',
          sourceLabel: 'Dropbox Audio'
        }
      }
      if (MEDIA_VIDEO_EXTENSIONS.has(extension)) {
        return {
          kind: 'video',
          rawUrl: value,
          directUrl: directDropboxUrl,
          embedUrl: '',
          sourceLabel: 'Dropbox Video'
        }
      }
      return {
        kind: 'link',
        rawUrl: value,
        directUrl: directDropboxUrl,
        embedUrl: '',
        sourceLabel: 'Dropbox'
      }
    }

    if (MEDIA_AUDIO_EXTENSIONS.has(extension)) {
      return {
        kind: 'audio',
        rawUrl: value,
        directUrl: value,
        embedUrl: '',
        sourceLabel: 'Audio'
      }
    }

    if (MEDIA_VIDEO_EXTENSIONS.has(extension)) {
      return {
        kind: 'video',
        rawUrl: value,
        directUrl: value,
        embedUrl: '',
        sourceLabel: 'Video'
      }
    }

    if (parsed.pathname.includes('/embed/')) {
      return {
        kind: 'embed',
        rawUrl: value,
        directUrl: value,
        embedUrl: value,
        sourceLabel: parsed.hostname
      }
    }
  } catch {
    return {
      kind: 'link',
      rawUrl: value,
      directUrl: value,
      embedUrl: '',
      sourceLabel: 'External Link'
    }
  }

  return {
    kind: 'link',
    rawUrl: value,
    directUrl: value,
    embedUrl: '',
    sourceLabel: 'External Link'
  }
}

const resolveVideoEmbedUrl = (rawUrl) => resolveLessonMedia(rawUrl).embedUrl

const decorateCourse = (course) => {
  const paymentMode = course?.pricing?.paymentMode === 'paid' ? 'paid' : 'free'
  const amount = Number.isFinite(Number(course?.pricing?.amount)) ? Math.max(0, Number(course.pricing.amount)) : 0
  const currency = normalizeCurrencyCode(course?.pricing?.currency)
  const displayPrice = paymentMode === 'paid' && amount > 0 ? formatCurrencyAmount(amount, currency) : 'Free'
  const publicCourseUrl = `/courses/${course._id}${course.slug ? `/${course.slug}` : ''}`
  const previewCourseUrl = `/simple-lms/courses/${course._id}/preview`
  const isPubliclyAvailable = (
    course?.isActive !== false
    && String(course?.status || '').trim().toLowerCase() === 'published'
    && PUBLIC_VISIBILITY_VALUES.includes(String(course?.visibility || '').trim().toLowerCase())
  )
  const storedReviewDecision = normalizeCourseReviewDecision(course?.reviewDecision, '')
  const reviewDecision = storedReviewDecision || (
    String(course?.status || '').trim().toLowerCase() === 'pending_public_review'
      ? 'pending'
      : ((course?.reviewedAt || String(course?.reviewNotes || '').trim()) ? 'changes_requested' : 'none')
  )
  const reviewedByName = String(
    course?.reviewedBy?.profile?.name
    || course?.reviewedBy?.email
    || ''
  ).trim()

  return {
    ...course,
    createdById: toIdString(course?.createdBy),
    levelLabel: LEVEL_LABELS[course?.level] || 'Mixed',
    summaryText: String(course?.summary || '').trim() || String(course?.description || '').trim() || 'No summary yet.',
    displayPrice,
    visibilityDisplay: visibilityToDisplay(course?.visibility),
    lessonCount: Number.isFinite(Number(course?.lessonCount)) ? Number(course.lessonCount) : 0,
    estimatedDurationMinutes: Number.isFinite(Number(course?.estimatedDurationMinutes)) ? Number(course.estimatedDurationMinutes) : 0,
    publicCourseUrl,
    previewCourseUrl,
    isPubliclyAvailable,
    courseUrl: isPubliclyAvailable ? publicCourseUrl : previewCourseUrl,
    authorName: String(course?.createdByName || '').trim() || 'Learning Team',
    reviewDecision,
    reviewDecisionLabel: formatCourseReviewDecision(reviewDecision),
    reviewHasFeedback: reviewDecision !== 'none' || Boolean(String(course?.reviewNotes || '').trim()),
    reviewNeedsCreatorAction: ['changes_requested', 'denied'].includes(reviewDecision),
    reviewedByName
  }
}

const buildCourseDetailViewModel = (course) => {
  const decorated = decorateCourse(course)
  return {
    ...decorated,
    previewSummary: decorated.summaryText,
    requiresPayment: isCoursePaidContent(course)
  }
}

const mapCourseChaptersForDetail = (course) => (
  Array.isArray(course?.chapters)
    ? course.chapters.map((chapter, chapterIndex) => ({
      key: String(chapter?.key || `chapter-${chapterIndex + 1}`),
      title: String(chapter?.title || `Chapter ${chapterIndex + 1}`),
      description: String(chapter?.description || ''),
      lessons: Array.isArray(chapter?.lessons)
        ? chapter.lessons.map((lesson, lessonIndex) => ({
          key: String(lesson?.key || `lesson-${lessonIndex + 1}`),
          title: String(lesson?.title || `Lesson ${lessonIndex + 1}`),
          durationMinutes: Number.isFinite(Number(lesson?.durationMinutes))
            ? Math.max(0, Number(lesson.durationMinutes))
            : 0
        }))
        : []
    }))
    : []
)

const refreshCourseMetrics = async (courseId) => {
  const [enrollmentCount, completionCount] = await Promise.all([
    SimpleLmsEnrollment.countDocuments({ course: courseId }),
    SimpleLmsEnrollment.countDocuments({ course: courseId, status: 'completed' })
  ])
  await SimpleLmsCourse.updateOne({ _id: courseId }, { $set: { enrollmentCount, completionCount } })
}

const createOrUpdateEnrollment = async ({
  courseId,
  learnerId,
  actorId,
  assignmentType = 'self',
  source = 'self_enroll',
  programId = null
}) => {
  const filter = {
    course: courseId,
    enrolledMember: learnerId
  }

  const existing = await SimpleLmsEnrollment.findOne(filter)
  if (existing) {
    let hasChange = false
    if (programId && !existing.program) {
      existing.program = programId
      hasChange = true
    }
    if (assignmentType && existing.assignmentType !== assignmentType) {
      existing.assignmentType = assignmentType
      hasChange = true
    }
    if (source && existing.source !== source) {
      existing.source = source
      hasChange = true
    }
    if (hasChange) {
      existing.lastActivityAt = new Date()
      await existing.save()
    }
    return {
      enrollment: existing,
      created: false
    }
  }

  const enrollment = await SimpleLmsEnrollment.create({
    organization: null,
    course: courseId,
    program: programId || null,
    enrolledMember: learnerId,
    enrolledBy: actorId || learnerId,
    assignmentType,
    source,
    status: 'assigned',
    completedLessonKeys: []
  })

  await refreshCourseMetrics(courseId)
  return {
    enrollment,
    created: true
  }
}

const redirectWithMessage = ({ res, path = '/simple-lms', success = '', error = '', info = '' }) => {
  const params = new URLSearchParams()
  if (success) params.set('success', success)
  if (error) params.set('error', error)
  if (info) params.set('info', info)
  const query = params.toString()
  const [basePath, hashSuffixRaw = ''] = String(path || '/simple-lms').split('#')
  const hashSuffix = hashSuffixRaw ? `#${hashSuffixRaw}` : ''
  return res.redirect(query ? `${basePath}${basePath.includes('?') ? '&' : '?'}${query}${hashSuffix}` : `${basePath}${hashSuffix}`)
}

const normalizeLessonMediaResourceType = (value, fallback = 'video') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (['video', 'audio', 'raw', 'link'].includes(normalized)) return normalized
  return fallback
}

const sanitizeLessonMediaInput = (input) => {
  if (!input || typeof input !== 'object') return null

  const url = String(input.url || '').trim().slice(0, 2000)
  const publicId = String(input.publicId || '').trim().slice(0, 400)
  const resourceType = normalizeLessonMediaResourceType(input.resourceType, 'video')
  const provider = String(input.provider || '').trim().toLowerCase() === 'external' ? 'external' : 'cloudinary'

  if (!url && !publicId) return null

  return {
    provider,
    url,
    publicId,
    resourceType,
    format: String(input.format || '').trim().toLowerCase().slice(0, 40),
    bytes: Number.isFinite(Number(input.bytes)) ? Math.max(0, Math.round(Number(input.bytes))) : 0,
    width: Number.isFinite(Number(input.width)) ? Math.max(0, Math.round(Number(input.width))) : 0,
    height: Number.isFinite(Number(input.height)) ? Math.max(0, Math.round(Number(input.height))) : 0,
    durationSeconds: Number.isFinite(Number(input.durationSeconds))
      ? Math.max(0, Number(input.durationSeconds))
      : 0,
    sourceLabel: String(input.sourceLabel || '').trim().slice(0, 120)
  }
}

const sanitizeQuizChoices = (choicesInput = [], correctIndexInput = -1) => {
  const choices = Array.isArray(choicesInput)
    ? choicesInput
      .map(choice => {
        if (choice && typeof choice === 'object') {
          return {
            text: String(choice.text || '').trim(),
            isCorrect: Boolean(choice.isCorrect)
          }
        }
        return {
          text: String(choice || '').trim(),
          isCorrect: false
        }
      })
      .filter(choice => choice.text)
    : []

  const hasExplicitCorrectChoice = choices.some(choice => choice.isCorrect)
  const parsedCorrectIndex = Number.parseInt(correctIndexInput, 10)
  if (!hasExplicitCorrectChoice && Number.isInteger(parsedCorrectIndex) && parsedCorrectIndex >= 0 && parsedCorrectIndex < choices.length) {
    choices[parsedCorrectIndex].isCorrect = true
  }
  if (choices.length > 0 && !choices.some(choice => choice.isCorrect)) {
    choices[0].isCorrect = true
  }
  return choices.slice(0, 6)
}

const sanitizeChaptersInput = (input, { allowExternalLessonMedia = true } = {}) => {
  const chaptersInput = Array.isArray(input) ? input : []
  const chapters = []

  chaptersInput.forEach((rawChapter, chapterIndex) => {
    const chapterTitle = String(rawChapter?.title || '').trim()
    if (!chapterTitle) return

    const chapterKey = String(rawChapter?.key || slugifyValue(chapterTitle, `chapter-${chapterIndex + 1}`)).slice(0, 80)
    const rawLessons = Array.isArray(rawChapter?.lessons) ? rawChapter.lessons : []
    const lessons = []

    rawLessons.forEach((rawLesson, lessonIndex) => {
      const lessonTitle = String(rawLesson?.title || '').trim()
      if (!lessonTitle) return

      const lessonKey = String(rawLesson?.key || `${chapterKey}-lesson-${lessonIndex + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)

      const resources = Array.isArray(rawLesson?.resources)
        ? rawLesson.resources
          .map(resource => ({
            label: String(resource?.label || '').trim().slice(0, 120),
            url: String(resource?.url || '').trim().slice(0, 2000),
            type: ['link', 'file', 'document'].includes(resource?.type) ? resource.type : 'link'
          }))
          .filter(resource => resource.label && resource.url)
        : []

      const rawQuestions = Array.isArray(rawLesson?.quizQuestions) ? rawLesson.quizQuestions : []
      const quizQuestions = rawQuestions
        .map(question => {
          const prompt = String(question?.prompt || '').trim().slice(0, 1000)
          if (!prompt) return null
          const choices = sanitizeQuizChoices(question?.choices, question?.correctIndex)
          if (choices.length < 2) return null
          return {
            prompt,
            choices,
            explanation: String(question?.explanation || '').trim().slice(0, 2000)
          }
        })
        .filter(Boolean)

      const media = sanitizeLessonMediaInput(rawLesson?.media)
      const externalMediaUrl = allowExternalLessonMedia
        ? String(rawLesson?.mediaUrl || rawLesson?.videoUrl || rawLesson?.audioUrl || '').trim().slice(0, 2000)
        : ''
      const mediaUrl = String(media?.url || externalMediaUrl).trim().slice(0, 2000)
      const derivedDurationMinutes = Number(media?.durationSeconds) > 0
        ? Math.max(1, Math.ceil(Number(media.durationSeconds) / 60))
        : 0

      lessons.push({
        key: lessonKey || `${chapterKey}-lesson-${lessonIndex + 1}`,
        title: lessonTitle.slice(0, 200),
        description: String(rawLesson?.description || '').trim().slice(0, 3000),
        videoUrl: mediaUrl,
        media,
        content: String(rawLesson?.content || '').trim().slice(0, 40000),
        durationMinutes: derivedDurationMinutes > 0
          ? derivedDurationMinutes
          : (Number.isFinite(Number(rawLesson?.durationMinutes)) ? Math.max(0, Math.round(Number(rawLesson.durationMinutes))) : 0),
        resources,
        quizQuestions,
        order: lessonIndex + 1
      })
    })

    chapters.push({
      key: chapterKey,
      title: chapterTitle.slice(0, 200),
      description: String(rawChapter?.description || '').trim().slice(0, 3000),
      order: chapterIndex + 1,
      lessons
    })
  })

  return chapters
}

const parseCoursePayload = ({
  body,
  role,
  existingCourse = null,
  studioContext = '',
  creatorSettings = CREATOR_SETTING_DEFAULTS,
  platformSettings = PLATFORM_SETTING_DEFAULTS,
  currencyCodes = activeSimpleLmsCurrencyCodes
}) => {
  const title = String(body.title || '').trim()
  if (!title) {
    throw new Error('Course title is required.')
  }

  const normalizedCreatorSettings = normalizeCreatorSettings(creatorSettings, currencyCodes)
  const normalizedPlatformSettings = normalizePlatformSettings(platformSettings, currencyCodes)
  const level = LEVELS.includes(String(body.level || '').trim())
    ? String(body.level).trim()
    : (existingCourse?.level || normalizedCreatorSettings.defaultLevel || 'mixed')
  const normalizedRole = String(role || '').trim().toLowerCase()
  const roleIsPartnerSuper = isPartnerSuperRole(normalizedRole)
  const roleIsPartnerUser = isPartnerUserRole(normalizedRole)
  const roleIsPartner = roleIsPartnerSuper || roleIsPartnerUser

  const requestedStatus = parseCourseStatus(
    body.status || existingCourse?.status || normalizedPlatformSettings.defaultCourseStatus || 'draft',
    'draft'
  )
  const requiresApproval = !canManagePlatform(role)
    && !roleIsPartner
    && normalizedPlatformSettings.requirePublicReviewForCreators

  let status = (requestedStatus === 'published' && requiresApproval)
    ? 'pending_public_review'
    : requestedStatus

  // Partner users can only submit draft courses for partner-super review.
  if (roleIsPartnerUser) {
    status = 'draft'
  }
  const visibilityInput = body.visibility
    || existingCourse?.visibility
    || normalizedCreatorSettings.defaultVisibility
    || normalizedPlatformSettings.defaultCourseVisibility
  const visibility = normalizeVisibility(visibilityInput, role)
  const chapters = sanitizeChaptersInput(parseJsonInput(body.chaptersJson, []), {
    allowExternalLessonMedia: Boolean(existingCourse)
  })
  const limitedChapters = chapters
    .slice(0, normalizedPlatformSettings.maxChaptersPerCourse)
    .map((chapter) => ({
      ...chapter,
      lessons: Array.isArray(chapter.lessons)
        ? chapter.lessons.slice(0, normalizedPlatformSettings.maxLessonsPerChapter)
        : []
    }))
  const bannerPayload = parseJsonInput(body.bannerPayload, {})
  const bannerFromFields = {
    url: String(body.bannerUrl || '').trim().slice(0, 2000),
    publicId: String(body.bannerPublicId || '').trim().slice(0, 400),
    width: Number.isFinite(Number(body.bannerWidth)) ? Number(body.bannerWidth) : undefined,
    height: Number.isFinite(Number(body.bannerHeight)) ? Number(body.bannerHeight) : undefined
  }
  const effectiveBannerPayload = (
    bannerPayload
    && typeof bannerPayload === 'object'
    && (String(bannerPayload.url || '').trim() || String(bannerPayload.publicId || '').trim())
  )
    ? bannerPayload
    : bannerFromFields
  const hasBannerFromPayload = Boolean(String(effectiveBannerPayload?.url || '').trim())
  const hasExistingBanner = Boolean(existingCourse?.banner?.url)
  if (normalizedPlatformSettings.requireCourseThumbnail && !hasBannerFromPayload && !hasExistingBanner) {
    throw new Error('Course banner is required by platform settings.')
  }
  const paymentModeInput = String(
    body.paymentMode
    || existingCourse?.pricing?.paymentMode
    || normalizedCreatorSettings.defaultPaymentMode
    || normalizedPlatformSettings.defaultPaymentMode
  ).trim().toLowerCase()
  const paymentMode = paymentModeInput === 'paid' ? 'paid' : 'free'
  const existingAmountMajor = Number(existingCourse?.pricing?.amount || 0) / 100
  const amountInputValue = (
    body.amount !== undefined
    && body.amount !== null
    && String(body.amount).trim() !== ''
  )
    ? body.amount
    : existingAmountMajor
  const legacyAmountMinorValue = (
    body.amountMinor !== undefined
    && body.amountMinor !== null
    && String(body.amountMinor).trim() !== ''
  )
    ? body.amountMinor
    : null
  let amount = paymentMode === 'paid'
    ? (
      legacyAmountMinorValue !== null
        ? Math.max(0, Math.round(Number(legacyAmountMinorValue)))
        : parseAmountToMinor(amountInputValue)
    )
    : 0
  amount = Math.max(normalizedPlatformSettings.minCoursePriceMinor, Math.min(amount, normalizedPlatformSettings.maxCoursePriceMinor))
  const currency = normalizeCurrencyCode(
    body.currency,
    existingCourse?.pricing?.currency
      || normalizedCreatorSettings.defaultCurrency
      || normalizedPlatformSettings.defaultCurrency
      || activeSimpleLmsDefaultCurrencyCode
      || DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
    currencyCodes
  )
  const category = String(body.category || '').trim().slice(0, 120)
  const slugSource = String(body.slug || existingCourse?.slug || title).trim()
  const slug = slugifyValue(slugSource, 'course')
  const normalizedStudioContext = String(studioContext || body.studioContext || '').trim().toLowerCase()

  const payload = {
    title: title.slice(0, 200),
    slug,
    summary: String(body.summary || '').trim().slice(0, 600),
    description: String(body.description || '').trim().slice(0, 16000),
    category: category || (existingCourse ? existingCourse.category : normalizedCreatorSettings.defaultCategory || ''),
    level,
    tags: parseTags(body.tags),
    status,
    visibility,
    chapters: limitedChapters,
    pricing: {
      paymentMode,
      amount,
      currency
    }
  }

  if (requestedStatus === 'published' && status === 'pending_public_review') {
    payload.submittedForPublicReviewAt = new Date()
    payload.reviewDecision = 'pending'
    payload.reviewedAt = null
    payload.reviewedBy = null
    payload.reviewNotes = ''
    payload.approvedPublicAt = null
    payload.approvedPublicBy = null
  }

  if (effectiveBannerPayload && typeof effectiveBannerPayload === 'object' && String(effectiveBannerPayload.url || '').trim()) {
    payload.banner = {
      url: String(effectiveBannerPayload.url || '').trim().slice(0, 2000),
      publicId: String(effectiveBannerPayload.publicId || '').trim().slice(0, 400),
      width: Number.isFinite(Number(effectiveBannerPayload.width)) ? Number(effectiveBannerPayload.width) : undefined,
      height: Number.isFinite(Number(effectiveBannerPayload.height)) ? Number(effectiveBannerPayload.height) : undefined
    }
  } else if (existingCourse?.banner?.url) {
    payload.banner = existingCourse.banner
  }

  if (status === 'published') {
    payload.publishedAt = existingCourse?.publishedAt || new Date()
    payload.archivedAt = null
    payload.isActive = true
  }
  if (status === 'archived') {
    payload.archivedAt = new Date()
    payload.isActive = false
  }
  if (status === 'draft') {
    payload.archivedAt = null
    payload.isActive = true
  }
  if (status === 'pending_public_review') {
    payload.archivedAt = null
    payload.isActive = true
    payload.publishedAt = null
  }

  if (canManagePlatform(role)) {
    if (normalizedStudioContext === 'admin' && !existingCourse) {
      payload.isSystemCourse = true
    } else if (normalizedStudioContext === 'creator' && !existingCourse) {
      payload.isSystemCourse = false
    } else if (body.isSystemCourse === true || body.isSystemCourse === 'on') {
      payload.isSystemCourse = true
    } else if (body.isSystemCourse === false || body.isSystemCourse === 'off') {
      payload.isSystemCourse = false
    } else if (existingCourse) {
      payload.isSystemCourse = Boolean(existingCourse.isSystemCourse)
    } else {
      payload.isSystemCourse = false
    }
  } else if (existingCourse) {
    payload.isSystemCourse = Boolean(existingCourse.isSystemCourse)
  } else {
    payload.isSystemCourse = false
  }

  return payload
}

const sanitizeProgramStepsInput = (input) => {
  const stepsInput = Array.isArray(input) ? input : []
  const steps = []
  const seenCourseIds = new Set()

  stepsInput.forEach((rawStep, stepIndex) => {
    const courseId = String(rawStep?.courseId || rawStep?.course || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) return
    if (seenCourseIds.has(courseId)) return
    seenCourseIds.add(courseId)
    steps.push({
      course: new mongoose.Types.ObjectId(courseId),
      order: stepIndex + 1,
      required: rawStep?.required !== false && rawStep?.required !== 'false'
    })
  })

  return steps
}

const parseProgramPayload = ({ body, existingProgram = null }) => {
  const name = String(body.name || '').trim()
  if (!name) {
    throw new Error('Program name is required.')
  }

  const status = parseProgramStatus(body.status || existingProgram?.status || 'draft', 'draft')
  const visibility = normalizeProgramVisibility(body.visibility, existingProgram?.visibility || 'organization_private')
  const steps = sanitizeProgramStepsInput(parseJsonInput(body.stepsJson, []))
  if (steps.length === 0) {
    throw new Error('Program pathway must include at least one course.')
  }

  const bannerPayload = parseJsonInput(body.bannerPayload, {})
  const payload = {
    name: name.slice(0, 200),
    description: String(body.description || '').trim().slice(0, 8000),
    objective: String(body.objective || '').trim().slice(0, 2000),
    tags: parseTags(body.tags),
    status,
    visibility,
    steps
  }

  if (bannerPayload && typeof bannerPayload === 'object' && String(bannerPayload.url || '').trim()) {
    payload.banner = {
      url: String(bannerPayload.url || '').trim().slice(0, 2000),
      publicId: String(bannerPayload.publicId || '').trim().slice(0, 400)
    }
  } else if (existingProgram?.banner?.url) {
    payload.banner = existingProgram.banner
  }

  return payload
}

const decorateProgram = (program, courseLookupMap = new Map()) => {
  const steps = Array.isArray(program?.steps)
    ? program.steps
      .map((step, index) => {
        const courseId = toIdString(step?.course?._id || step?.course)
        const course = step?.course && typeof step.course === 'object'
          ? decorateCourse(step.course)
          : (courseLookupMap.get(courseId) || null)
        const titleSnapshot = String(step?.titleSnapshot || '').trim()
        return {
          ...step,
          order: Number(step?.order || index + 1),
          required: step?.required !== false,
          courseId,
          course,
          courseTitle: course?.title || titleSnapshot || 'Untitled Course'
        }
      })
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : []

  const visibilityDisplay = program?.visibility === 'organization_public' ? 'Public' : 'Private'
  return {
    ...program,
    steps,
    totalSteps: steps.length,
    requiredSteps: steps.filter(step => step.required).length,
    visibilityDisplay
  }
}

const sanitizeInternalPath = (value, fallback = '/simple-lms?view=catalog') => {
  const candidate = String(value || '').trim()
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }
  return candidate
}

const resolveAdminReturnPath = (req, fallback = '/simple-lms?view=admin') => (
  sanitizeInternalPath(req.body?.returnTo || req.query?.returnTo || fallback, fallback)
)

const resolveCourseStudioReturnPath = (req, fallback = '/simple-lms/studio/courses') => (
  sanitizeInternalPath(req.body?.returnTo || req.query?.returnTo || fallback, fallback)
)

const buildStudioEditCoursePath = (value, courseId, fallback = '/simple-lms/studio/courses') => {
  const basePath = sanitizeInternalPath(value || fallback, fallback)
  const [pathWithoutHash] = String(basePath).split('#')
  const separator = pathWithoutHash.includes('?') ? '&' : '?'
  return `${pathWithoutHash}${separator}editCourse=${encodeURIComponent(String(courseId || '').trim())}#edit-course`
}

const sendCourseReviewNotification = async ({
  req,
  res,
  course,
  decision,
  notes = ''
}) => {
  try {
    const createdById = toIdString(course?.createdBy)
    if (!mongoose.Types.ObjectId.isValid(createdById)) return

    const creator = await Account.findById(createdById)
      .select('email profile.name')
      .lean()

    const to = String(creator?.email || course?.createdByEmail || '').trim().toLowerCase()
    if (!to) return

    const creatorName = String(creator?.profile?.name || course?.createdByName || 'Creator').trim() || 'Creator'
    const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'
    const normalizedDecision = normalizeCourseReviewDecision(decision)
    const decisionLabel = formatCourseReviewDecision(normalizedDecision)
    const feedbackText = String(notes || '').trim()
    const appBaseUrl = buildAppBaseUrl(req)
    const editPath = buildStudioEditCoursePath('/simple-lms/studio/courses', course?._id, '/simple-lms/studio/courses')
    const previewPath = `/simple-lms/courses/${encodeURIComponent(String(course?._id || '').trim())}/preview`
    const editUrl = `${appBaseUrl}${editPath}`
    const previewUrl = `${appBaseUrl}${previewPath}`

    let subject = `${learningName}: course review update`
    let intro = `There is an update on your course "${String(course?.title || 'Untitled Course').trim() || 'Untitled Course'}".`
    if (normalizedDecision === 'approved') {
      subject = `${learningName}: course approved`
      intro = `Your course "${String(course?.title || 'Untitled Course').trim() || 'Untitled Course'}" has been approved and published.`
    } else if (normalizedDecision === 'changes_requested') {
      subject = `${learningName}: changes requested for your course`
      intro = `Changes were requested for your course "${String(course?.title || 'Untitled Course').trim() || 'Untitled Course'}".`
    } else if (normalizedDecision === 'denied') {
      subject = `${learningName}: course submission denied`
      intro = `Your course submission "${String(course?.title || 'Untitled Course').trim() || 'Untitled Course'}" was denied.`
    }

    await emailService.sendNotificationEmail({
      to,
      subject,
      html: `
        <p>Hello ${creatorName},</p>
        <p>${intro}</p>
        <p><strong>Decision:</strong> ${decisionLabel}</p>
        ${feedbackText ? `<p><strong>Reviewer note:</strong><br>${String(feedbackText).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>` : ''}
        <p><a href="${editUrl}">Open Course Studio</a> to review the course and make updates.</p>
        <p>You can also preview the current course version here: <a href="${previewUrl}">${previewUrl}</a></p>
      `,
      text: [
        `Hello ${creatorName},`,
        '',
        intro,
        `Decision: ${decisionLabel}`,
        feedbackText ? `Reviewer note: ${feedbackText}` : '',
        `Open Course Studio: ${editUrl}`,
        `Preview course: ${previewUrl}`
      ].filter(Boolean).join('\n')
    })
  } catch (error) {
    console.error('Course review notification email error:', error)
  }
}

const findPublicCourseForLearning = async (courseId) => {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null
  return SimpleLmsCourse.findOne({
    _id: courseId,
    isActive: true,
    status: 'published',
    visibility: { $in: PUBLIC_VISIBILITY_VALUES }
  }).lean()
}

const getRemainingPayableCartCount = async ({ req, accountId }) => {
  const cartCourseIds = getSessionCartCourseIds(req)
  if (!Array.isArray(cartCourseIds) || cartCourseIds.length === 0) return 0
  const validCourseIds = cartCourseIds.filter((courseId) => mongoose.Types.ObjectId.isValid(courseId))
  if (validCourseIds.length === 0) {
    clearSessionCart(req)
    return 0
  }

  const [cartCourses, successfulPayments] = await Promise.all([
    SimpleLmsCourse.find({
      _id: { $in: validCourseIds },
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    })
      .select('_id pricing')
      .lean(),
    SimpleLmsPayment.find({
      account: accountId,
      course: { $in: validCourseIds },
      status: 'successful'
    })
      .select('course')
      .lean()
  ])

  const paidCourseIds = new Set((successfulPayments || []).map((entry) => toIdString(entry.course)))
  const courseMap = new Map((cartCourses || []).map((course) => [toIdString(course._id), course]))
  const remainingPayableCourseIds = validCourseIds.filter((courseId) => {
    const course = courseMap.get(courseId)
    if (!course) return false
    if (!isCoursePaidContent(course)) return false
    return !paidCourseIds.has(courseId)
  })

  setSessionCartCourseIds(req, remainingPayableCourseIds)
  return remainingPayableCourseIds.length
}

const resolveCartWorkspaceState = async ({ req, accountId }) => {
  const cartCourseIds = getSessionCartCourseIds(req)
  if (!Array.isArray(cartCourseIds) || cartCourseIds.length === 0) {
    return {
      cartCourses: [],
      cartSummary: {
        itemCount: 0,
        totalsByCurrency: [],
        hasItems: false
      }
    }
  }

  const validCourseIds = cartCourseIds.filter((courseId) => mongoose.Types.ObjectId.isValid(courseId))
  if (validCourseIds.length !== cartCourseIds.length) {
    setSessionCartCourseIds(req, validCourseIds)
  }
  if (validCourseIds.length === 0) {
    return {
      cartCourses: [],
      cartSummary: {
        itemCount: 0,
        totalsByCurrency: [],
        hasItems: false
      }
    }
  }

  const [cartCoursesRaw, successfulPayments] = await Promise.all([
    SimpleLmsCourse.find({
      _id: { $in: validCourseIds },
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    }).lean(),
    SimpleLmsPayment.find({
      account: accountId,
      course: { $in: validCourseIds },
      status: 'successful'
    })
      .select('course')
      .lean()
  ])

  const paidCourseIds = new Set((successfulPayments || []).map((entry) => toIdString(entry.course)))
  const cartRawMap = new Map((cartCoursesRaw || []).map((course) => [toIdString(course._id), course]))
  const cartCourses = validCourseIds
    .map((courseId) => cartRawMap.get(courseId))
    .filter(Boolean)
    .map((course) => {
      const decoratedCourse = decorateCourse(course)
      const courseId = toIdString(course._id)
      const requiresPayment = isCoursePaidContent(course)
      const isPaid = paidCourseIds.has(courseId)
      return {
        ...decoratedCourse,
        requiresPayment,
        isPaid,
        canStart: !requiresPayment || isPaid
      }
    })
    .filter((course) => course.requiresPayment && !course.isPaid)

  const cleanedCartCourseIds = cartCourses.map((course) => toIdString(course._id))
  setSessionCartCourseIds(req, cleanedCartCourseIds)

  const cartTotalsByCurrencyMap = new Map()
  for (const course of cartCourses) {
    const currency = normalizeCurrencyCode(course?.pricing?.currency || 'NGN')
    const existing = cartTotalsByCurrencyMap.get(currency) || 0
    const amountMinor = Math.max(0, Math.round(Number(course?.pricing?.amount || 0)))
    cartTotalsByCurrencyMap.set(currency, existing + amountMinor)
  }
  const cartTotalsByCurrency = Array.from(cartTotalsByCurrencyMap.entries()).map(([currency, amountMinor]) => ({
    currency,
    amountMinor,
    amountDisplay: formatCurrencyAmount(amountMinor, currency)
  }))

  return {
    cartCourses,
    cartSummary: {
      itemCount: cartCourses.length,
      totalsByCurrency: cartTotalsByCurrency,
      hasItems: cartCourses.length > 0
    }
  }
}

const initiateCoursePaymentCheckout = async ({
  req,
  res,
  course,
  fallbackPath = '/simple-lms?view=catalog',
  nextPath = null,
  checkoutContext = 'direct',
  allowProviderPrompt = true
}) => {
  if (!course || !course._id) {
    return redirectWithMessage({
      res,
      path: fallbackPath,
      error: 'Course not found or unavailable.'
    })
  }

  if (!isCoursePaidContent(course)) {
    removeSessionCartCourseId(req, course._id)
    return res.redirect(`/simple-lms/take/${course._id}`)
  }

  const existingSuccessfulPayment = await SimpleLmsPayment.findOne({
    account: req.user._id,
    course: course._id,
    status: 'successful'
  })
    .select('_id')
    .lean()

  if (existingSuccessfulPayment) {
    removeSessionCartCourseId(req, course._id)
    return redirectWithMessage({
      res,
      path: `/simple-lms/take/${course._id}`,
      success: 'Payment already completed for this course.'
    })
  }

  const checkoutState = await buildPaymentGatewayCheckoutState({ req })
  if (!checkoutState.hasAvailableProvider) {
    return redirectWithMessage({
      res,
      path: fallbackPath,
      error: 'No payment gateway is currently available. Contact an admin.'
    })
  }

  const normalizedCheckoutContext = String(checkoutContext || '').trim().toLowerCase() === 'cart'
    ? 'cart'
    : 'direct'
  const finalNextPath = sanitizeInternalPath(nextPath, `/simple-lms/take/${course._id}`)
  const finalFallbackPath = sanitizeInternalPath(fallbackPath, '/simple-lms?view=catalog')

  const requestedProvider = normalizePaymentProvider(
    req.body?.provider || req.query?.provider || req.body?.paymentProvider || req.query?.paymentProvider,
    ''
  )
  const hasRequestedProvider = Boolean(requestedProvider)
  if (allowProviderPrompt && checkoutState.requiresSelection && !hasRequestedProvider) {
    return res.render('simple-lms-payment-checkout', {
      title: 'Complete Purchase',
      user: req.user,
      activePage: 'simple-lms',
      activeLmsView: 'workspace',
      course: decorateCourse(course),
      checkoutContext: normalizedCheckoutContext,
      checkoutProviders: checkoutState.providerOptions,
      selectedProvider: checkoutState.selectedProvider || checkoutState.defaultProvider,
      fallbackPath: finalFallbackPath,
      nextPath: finalNextPath,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  }

  const selectedProvider = hasRequestedProvider
    ? requestedProvider
    : checkoutState.selectedProvider
  if (!checkoutState.availableProviders.includes(selectedProvider)) {
    return redirectWithMessage({
      res,
      path: finalFallbackPath,
      error: 'Selected payment gateway is unavailable.'
    })
  }
  if (req.session) {
    req.session[PAYMENT_PROVIDER_SESSION_KEY] = selectedProvider
  }

  const agentReferral = await resolveAgentReferralForCheckout({ req, course })

  const recentPendingPayment = await SimpleLmsPayment.findOne({
    account: req.user._id,
    course: course._id,
    provider: selectedProvider,
    status: { $in: ['initiated', 'pending'] },
    checkoutUrl: { $exists: true, $nin: ['', null] },
    createdAt: { $gte: new Date(Date.now() - (30 * 60 * 1000)) }
  })
    .sort({ createdAt: -1 })
    .lean()

  if (recentPendingPayment?.checkoutUrl) {
    await SimpleLmsPayment.updateOne(
      { _id: recentPendingPayment._id },
      {
        $set: {
          metadata: {
            ...(recentPendingPayment.metadata || {}),
            nextPath: finalNextPath,
            fallbackPath: finalFallbackPath,
            checkoutContext: normalizedCheckoutContext,
            ...(agentReferral
              ? {
                  agentReferral: {
                    code: agentReferral.code,
                    agentId: agentReferral.agentId,
                    partnerOrganization: agentReferral.partnerOrganization,
                    commissionRatePercent: agentReferral.commissionRatePercent
                  }
                }
              : {})
          }
        }
      }
    )
    return res.redirect(recentPendingPayment.checkoutUrl)
  }

  const txRef = generateTxRef()
  const amountMinor = Math.max(0, Math.round(Number(course?.pricing?.amount || 0)))
  const currency = normalizeCurrencyCode(course?.pricing?.currency || 'NGN')
  const paymentMetadata = {
    nextPath: finalNextPath,
    fallbackPath: finalFallbackPath,
    checkoutContext: normalizedCheckoutContext,
    provider: selectedProvider
  }
  if (agentReferral) {
    paymentMetadata.agentReferral = {
      code: agentReferral.code,
      agentId: agentReferral.agentId,
      partnerOrganization: agentReferral.partnerOrganization,
      commissionRatePercent: agentReferral.commissionRatePercent
    }
  }

  const payment = await SimpleLmsPayment.create({
    account: req.user._id,
    course: course._id,
    creatorAccount: course.createdBy || null,
    txRef,
    amountMinor,
    currency,
    provider: selectedProvider,
    status: 'initiated',
    customerEmail: req.user.email || '',
    customerName: req.user.profile?.name || req.user.email || 'Learner',
    metadata: paymentMetadata
  })

  try {
    let checkoutUrl = ''
    let initResponse = null
    if (selectedProvider === 'paystack') {
      const callbackUrl = `${buildAppBaseUrl(req)}/simple-lms/payments/paystack/callback`
      const checkout = await initializePaystackTransaction({
        reference: txRef,
        amountMinor,
        currency,
        callbackUrl,
        customerEmail: req.user.email || '',
        metadata: {
          courseId: toIdString(course._id),
          accountId: toIdString(req.user._id),
          txRef
        }
      })
      checkoutUrl = checkout.authorizationUrl
      initResponse = checkout.raw
      payment.paystackReference = checkout.reference || txRef
      payment.paystackStatus = 'pending'
      payment.providerTxId = payment.providerTxId || checkout.accessCode || ''
    } else {
      const redirectUrl = `${buildAppBaseUrl(req)}/simple-lms/payments/flutterwave/callback`
      const checkout = await createFlutterwavePaymentLink({
        txRef,
        amountMinor,
        currency,
        redirectUrl,
        customerEmail: req.user.email || '',
        customerName: req.user.profile?.name || req.user.email || 'Learner',
        title: `Course Payment - ${course.title}`,
        description: `Payment for ${course.title}`
      })
      checkoutUrl = checkout.link
      initResponse = checkout.raw
      payment.flutterwaveStatus = 'pending'
    }

    payment.checkoutUrl = checkoutUrl
    payment.status = 'pending'
    payment.metadata = {
      ...(payment.metadata || {}),
      nextPath: finalNextPath,
      fallbackPath: finalFallbackPath,
      checkoutContext: normalizedCheckoutContext,
      provider: selectedProvider,
      initResponse
    }
    await payment.save()

    return res.redirect(checkoutUrl)
  } catch (error) {
    payment.status = 'failed'
    if (selectedProvider === 'paystack') {
      payment.paystackStatus = 'init_error'
    } else {
      payment.flutterwaveStatus = 'init_error'
    }
    payment.metadata = {
      ...(payment.metadata || {}),
      nextPath: finalNextPath,
      fallbackPath: finalFallbackPath,
      checkoutContext: normalizedCheckoutContext,
      provider: selectedProvider,
      initError: String(error?.message || 'Failed to initialize payment')
    }
    await payment.save()

    return redirectWithMessage({
      res,
      path: finalFallbackPath,
      error: error.message || 'Failed to initialize payment checkout.'
    })
  }
}

pageRouter.get('/take/:courseId', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.redirect('/courses')
    }

    const course = await findPublicCourseForLearning(courseId)

    if (!course) return res.redirect('/courses')

    if (isCoursePaidContent(course)) {
      const hasSuccessfulPayment = await SimpleLmsPayment.exists({
        account: req.user._id,
        course: course._id,
        status: 'successful'
      })
      if (!hasSuccessfulPayment) {
        return res.redirect(
          `/simple-lms/courses/${course._id}/pay?next=${encodeURIComponent(`/simple-lms/take/${course._id}`)}`
        )
      }
    }

    const enrollmentResult = await createOrUpdateEnrollment({
      courseId: course._id,
      learnerId: req.user._id,
      actorId: req.user._id,
      assignmentType: 'self',
      source: 'self_enroll'
    })
    const enrollment = enrollmentResult.enrollment

    const lessons = flattenCourseLessons(course)
    const firstLessonKey = lessons[0]?.lessonKey || ''
    if (!firstLessonKey) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        success: `Course ready: ${course.title}`
      })
    }

    return res.redirect(`/simple-lms/learn/${enrollment._id}/${encodeURIComponent(firstLessonKey)}?success=${encodeURIComponent(`Course ready: ${course.title}`)}`)
  } catch (error) {
    console.error('Take course error:', error)
    return redirectWithMessage({
      res,
      path: '/courses',
      error: 'Failed to start this course.'
    })
  }
})

const handleCoursePayRequest = async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    const course = await findPublicCourseForLearning(courseId)
    const referralCode = normalizeAgentReferralCode(req.body?.ref || req.query?.ref || '')
    if (course?._id && referralCode) {
      setReferralCodeForCourse(req, course._id, referralCode)
    }
    const defaultFallback = '/simple-lms?view=catalog'
    const publicFallback = course
      ? `/courses/${course._id}${course.slug ? `/${course.slug}` : ''}`
      : '/courses'
    const requestedFallback = req.body?.fallback || req.body?.returnTo || req.query?.fallback || req.query?.returnTo
    const fallbackPath = sanitizeInternalPath(
      requestedFallback,
      req.method === 'GET' ? publicFallback : defaultFallback
    )
    const nextPathInput = req.body?.next || req.query?.next || `/simple-lms/take/${courseId}`
    const nextPath = sanitizeInternalPath(nextPathInput, `/simple-lms/take/${courseId}`)
    const checkoutContext = String(req.body?.checkoutContext || req.query?.checkoutContext || '').trim().toLowerCase() === 'cart'
      ? 'cart'
      : 'direct'

    return initiateCoursePaymentCheckout({
      req,
      res,
      course,
      fallbackPath,
      nextPath,
      checkoutContext
    })
  } catch (error) {
    console.error('Create payment error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
      error: 'Could not start payment for this course.'
    })
  }
}

pageRouter.get('/courses/:courseId/pay', requirePageAuth, handleCoursePayRequest)
pageRouter.post('/courses/:courseId/pay', requirePageAuth, handleCoursePayRequest)

pageRouter.get('/courses/:courseId/preview', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    const role = resolveRole(req.user)
    const defaultReturnTo = canManagePlatform(role) ? '/admin/courses' : '/simple-lms/studio/courses'
    const returnTo = sanitizeInternalPath(req.query.returnTo || req.query.return_to || defaultReturnTo, defaultReturnTo)

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected for preview.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId)
      .select('title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdBy createdByName createdByEmail chapters updatedAt status visibility isActive')
      .lean()

    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    const managesCourse = canManageCourse({
      role,
      accountId: req.user._id,
      course,
      partnerOrganizationId: req.user.partnerOrganization
    })

    const enrollmentExists = managesCourse
      ? true
      : await SimpleLmsEnrollment.exists({
        course: course._id,
        enrolledMember: req.user._id
      })

    if (!managesCourse && !enrollmentExists) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have access to preview this course.'
      })
    }

    const requiresPayment = isCoursePaidContent(course)
    const hasSuccessfulPayment = requiresPayment
      ? Boolean(await SimpleLmsPayment.exists({
        account: req.user._id,
        course: course._id,
        status: 'successful'
      }))
      : false
    const isEnrolled = Boolean(enrollmentExists)
    const courseIsPublished = String(course.status || '').trim().toLowerCase() === 'published'
    const canStartNow = courseIsPublished && (!requiresPayment || hasSuccessfulPayment || isEnrolled)
    const previewCourse = buildCourseDetailViewModel(course)

    const previewEditUrl = canEditCourse({
      accountId: req.user._id,
      course
    })
      ? (canManagePlatform(role)
          ? `/admin/courses?editCourse=${course._id}#edit-course`
          : `/simple-lms/studio/courses?editCourse=${course._id}`)
      : ''

    return res.render('public-course-detail', {
      title: `${previewCourse.title} - Preview`,
      user: req.user,
      activePage: 'simple-lms',
      course: previewCourse,
      chapters: mapCourseChaptersForDetail(course),
      relatedCourses: [],
      inCart: false,
      cartCount: getSessionCartCourseIds(req).length,
      canStartNow,
      isEnrolled,
      hasSuccessfulPayment,
      previewMode: true,
      previewStatusLabel: String(course.status || 'draft').replace(/_/g, ' '),
      previewVisibilityLabel: previewCourse.visibilityDisplay,
      previewReturnTo: returnTo,
      previewEditUrl,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Course preview load error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms/studio/courses',
      error: 'Failed to open course preview.'
    })
  }
})

pageRouter.post('/cart/checkout', requirePageAuth, async (req, res) => {
  try {
    const returnTo = sanitizeInternalPath(
      req.body?.returnTo || req.body?.fallback || '/simple-lms/cart',
      '/simple-lms/cart'
    )
    const cartCourseIds = getSessionCartCourseIds(req)
    if (cartCourseIds.length === 0) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Your cart is empty.'
      })
    }

    const cartCourses = await SimpleLmsCourse.find({
      _id: { $in: cartCourseIds },
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    })
      .select('_id title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdByName createdByEmail')
      .lean()

    const successfulPayments = await SimpleLmsPayment.find({
      account: req.user._id,
      course: { $in: cartCourseIds },
      status: 'successful'
    })
      .select('course')
      .lean()

    const purchasedCourseIds = new Set(successfulPayments.map((entry) => toIdString(entry.course)))
    const courseMap = new Map(cartCourses.map((course) => [toIdString(course._id), course]))
    const validPendingCartIds = cartCourseIds.filter((courseId) => {
      const course = courseMap.get(courseId)
      return Boolean(course) && isCoursePaidContent(course) && !purchasedCourseIds.has(courseId)
    })
    if (validPendingCartIds.length !== cartCourseIds.length) {
      setSessionCartCourseIds(req, validPendingCartIds)
    }

    const firstPayableCourse = cartCourseIds
      .map((courseId) => courseMap.get(courseId))
      .find((course) => {
        if (!course || !isCoursePaidContent(course)) return false
        return !purchasedCourseIds.has(toIdString(course._id))
      })

    if (!firstPayableCourse) {
      clearSessionCart(req)
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'No payable courses remain in your cart.'
      })
    }

    return initiateCoursePaymentCheckout({
      req,
      res,
      course: firstPayableCourse,
      fallbackPath: returnTo,
      nextPath: returnTo,
      checkoutContext: 'cart'
    })
  } catch (error) {
    console.error('Cart checkout error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms/cart',
      error: 'Could not start cart checkout.'
    })
  }
})

pageRouter.post('/cart/add', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.body?.courseId || req.body?.course || '').trim()
    const returnTo = sanitizeInternalPath(req.body?.returnTo || req.body?.next || '/simple-lms?view=catalog', '/simple-lms?view=catalog')
    const referralCode = normalizeAgentReferralCode(req.body?.ref || req.query?.ref || '')
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected for cart.'
      })
    }

    const course = await findPublicCourseForLearning(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not available.'
      })
    }

    if (!isCoursePaidContent(course)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'This course is free. Start learning directly.'
      })
    }

    const isAlreadyPaid = await SimpleLmsPayment.exists({
      account: req.user._id,
      course: course._id,
      status: 'successful'
    })
    if (isAlreadyPaid) {
      removeSessionCartCourseId(req, course._id)
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Course already purchased.'
      })
    }

    if (hasSessionCartCourse(req, course._id)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Course already in your cart.'
      })
    }

    if (referralCode) {
      setReferralCodeForCourse(req, course._id, referralCode)
    }
    addSessionCartCourseId(req, course._id)
    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Course added to cart.'
    })
  } catch (error) {
    console.error('Add to cart error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
      error: 'Failed to add course to cart.'
    })
  }
})

pageRouter.post('/cart/remove/:courseId', requirePageAuth, async (req, res) => {
  const courseId = String(req.params.courseId || '').trim()
  const returnTo = sanitizeInternalPath(req.body?.returnTo || req.body?.next || '/simple-lms/cart', '/simple-lms/cart')
  removeSessionCartCourseId(req, courseId)
  return redirectWithMessage({
    res,
    path: returnTo,
    success: 'Course removed from cart.'
  })
})

pageRouter.post('/cart/clear', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || req.body?.next || '/simple-lms/cart', '/simple-lms/cart')
  clearSessionCart(req)
  return redirectWithMessage({
    res,
    path: returnTo,
    success: 'Cart cleared.'
  })
})

const buildPaymentCallbackContext = ({ payment }) => {
  const courseId = toIdString(payment?.course?._id || payment?.course)
  const nextPath = sanitizeInternalPath(payment?.metadata?.nextPath, `/simple-lms/take/${courseId}`)
  const fallbackPath = sanitizeInternalPath(payment?.metadata?.fallbackPath, '/simple-lms?view=catalog')
  const checkoutContext = String(payment?.metadata?.checkoutContext || '').trim().toLowerCase() === 'cart'
    ? 'cart'
    : 'direct'
  return {
    nextPath,
    fallbackPath,
    checkoutContext
  }
}

const redirectAfterPaymentCallback = async ({ req, res, payment, defaultMessage }) => {
  const callbackContext = buildPaymentCallbackContext({ payment })
  if (callbackContext.checkoutContext !== 'cart') {
    return redirectWithMessage({
      res,
      path: callbackContext.nextPath,
      success: defaultMessage
    })
  }

  const remainingPayableCount = await getRemainingPayableCartCount({ req, accountId: req.user._id })
  if (remainingPayableCount > 0) {
    return redirectWithMessage({
      res,
      path: '/simple-lms/cart',
      success: `${defaultMessage} ${remainingPayableCount} item(s) remaining in your cart.`
    })
  }
  return redirectWithMessage({
    res,
    path: '/simple-lms?view=my-learning',
    success: `${defaultMessage} Your cart is clear.`
  })
}

const verifyFlutterwavePaymentRecord = async ({ payment, transactionId, callbackStatus = '' }) => {
  const verification = await verifyFlutterwaveTransaction(transactionId)
  const verifiedData = verification?.data || {}
  const verifiedStatus = String(verifiedData?.status || '').toLowerCase()
  const verifiedTxRef = String(verifiedData?.tx_ref || '').trim()
  const verifiedCurrency = normalizeCurrencyCode(verifiedData?.currency || payment.currency)
  const verifiedAmountMajor = Number(verifiedData?.amount || 0)
  const expectedAmountMajor = Number(payment.amountMinor || 0) / 100
  const amountMatches = Math.abs(verifiedAmountMajor - expectedAmountMajor) < 0.01
  const txRefMatches = verifiedTxRef === payment.txRef
  const statusMatches = verifiedStatus === 'successful'
  const currencyMatches = verifiedCurrency === payment.currency

  payment.flutterwaveTxId = String(verifiedData?.id || transactionId)
  payment.providerTxId = payment.flutterwaveTxId
  payment.flutterwaveStatus = verifiedStatus || callbackStatus || 'unknown'
  payment.verificationPayload = verification
  payment.verifiedAt = new Date()

  return {
    success: statusMatches && txRefMatches && amountMatches && currencyMatches,
    paidAt: verifiedData?.created_at ? new Date(verifiedData.created_at) : new Date()
  }
}

const verifyPaystackPaymentRecord = async ({ payment, reference }) => {
  const verification = await verifyPaystackTransaction(reference)
  const verifiedData = verification?.data || {}
  const verifiedStatus = String(verifiedData?.status || '').trim().toLowerCase()
  const verifiedReference = String(verifiedData?.reference || reference || '').trim()
  const verifiedCurrency = normalizeCurrencyCode(verifiedData?.currency || payment.currency)
  const verifiedAmountMinor = Math.max(0, Math.round(Number(verifiedData?.amount || 0)))
  const expectedAmountMinor = Math.max(0, Math.round(Number(payment.amountMinor || 0)))
  const amountMatches = verifiedAmountMinor === expectedAmountMinor
  const referenceMatches = verifiedReference === payment.txRef || verifiedReference === payment.paystackReference
  const statusMatches = verifiedStatus === 'success'
  const currencyMatches = verifiedCurrency === payment.currency

  payment.paystackReference = verifiedReference || payment.paystackReference || payment.txRef
  payment.paystackStatus = verifiedStatus || 'unknown'
  payment.providerTxId = String(verifiedData?.id || payment.providerTxId || verifiedReference)
  payment.verificationPayload = verification
  payment.verifiedAt = new Date()

  return {
    success: statusMatches && referenceMatches && amountMatches && currencyMatches,
    paidAt: verifiedData?.paid_at ? new Date(verifiedData.paid_at) : new Date()
  }
}

pageRouter.get('/payments/flutterwave/callback', requirePageAuth, async (req, res) => {
  try {
    const txRef = String(req.query.tx_ref || '').trim()
    const status = String(req.query.status || '').trim().toLowerCase()
    const transactionId = String(req.query.transaction_id || '').trim()

    if (!txRef) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Payment callback is missing transaction reference.'
      })
    }

    const payment = await SimpleLmsPayment.findOne({
      txRef,
      account: req.user._id,
      provider: 'flutterwave'
    })
      .populate('course')

    if (!payment || !payment.course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Payment record not found.'
      })
    }
    const { fallbackPath } = buildPaymentCallbackContext({ payment })

    if (payment.status === 'successful') {
      await createOrUpdateAgentAttributionForPayment({
        payment,
        course: payment.course
      })
      removeSessionCartCourseId(req, payment.course._id)
      clearReferralCodeForCourse(req, payment.course._id)
      return redirectAfterPaymentCallback({
        req,
        res,
        payment,
        defaultMessage: 'Payment already verified.'
      })
    }

    if (!transactionId || (status && !['successful', 'completed'].includes(status))) {
      payment.status = status === 'cancelled' ? 'cancelled' : 'failed'
      payment.flutterwaveStatus = status || 'failed'
      payment.providerTxId = payment.providerTxId || payment.flutterwaveTxId || ''
      payment.verifiedAt = new Date()
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment was not completed.'
      })
    }

    const verificationResult = await verifyFlutterwavePaymentRecord({
      payment,
      transactionId,
      callbackStatus: status
    })

    if (!verificationResult.success) {
      payment.status = 'failed'
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment verification failed.'
      })
    }

    await markPaymentSuccessful({
      payment,
      course: payment.course,
      paidAt: verificationResult.paidAt || new Date()
    })
    removeSessionCartCourseId(req, payment.course._id)
    clearReferralCodeForCourse(req, payment.course._id)

    return redirectAfterPaymentCallback({
      req,
      res,
      payment,
      defaultMessage: 'Payment verified. Course unlocked.'
    })
  } catch (error) {
    console.error('Flutterwave callback error:', error)
    return redirectWithMessage({
      res,
      path: '/courses',
      error: 'Failed to verify payment.'
    })
  }
})
pageRouter.get('/learn/:enrollmentId/:lessonKey?', requirePageAuth, async (req, res) => {
  try {
    const enrollmentId = String(req.params.enrollmentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'Invalid learning record.'
      })
    }

    const enrollment = await SimpleLmsEnrollment.findById(enrollmentId)
      .populate('course')
      .lean()
    if (!enrollment || !enrollment.course || !enrollment.course.isActive) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'Learning record not found.'
      })
    }

    const role = resolveRole(req.user)
    const ownsEnrollment = toIdString(enrollment.enrolledMember) === toIdString(req.user._id)
    if (!ownsEnrollment && !canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'You cannot open this learning record.'
      })
    }

    const lessons = flattenCourseLessons(enrollment.course)
    if (lessons.length === 0) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'This course has no lessons yet.'
      })
    }

    const progress = calculateProgress({
      lessons,
      completedLessonKeys: enrollment.completedLessonKeys || []
    })

    const requestedLessonKey = String(req.params.lessonKey || '').trim()
    const currentLesson = lessons.find(entry => entry.lessonKey === requestedLessonKey)
      || lessons.find(entry => entry.lessonKey === progress.nextLessonKey)
      || lessons[0]

    const currentIndex = lessons.findIndex(entry => entry.lessonKey === currentLesson.lessonKey)
    const previousLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null
    const nextLesson = currentIndex >= 0 && currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null
    const latestAttempt = (enrollment.quizAttempts || [])
      .filter(attempt => String(attempt.lessonKey) === currentLesson.lessonKey)
      .sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime())[0] || null

    const lessonMedia = resolveLessonMedia(currentLesson.media || currentLesson.videoUrl)
    const chapterSections = (enrollment.course.chapters || []).map((chapter, chapterIndex) => {
      const chapterNumber = Number.isFinite(Number(chapter?.order)) ? Number(chapter.order) : chapterIndex + 1
      const chapterTitle = String(chapter?.title || '').trim() || `Chapter ${chapterNumber}`
      const lessonsInChapter = (chapter?.lessons || [])
        .map((lesson, lessonIndex) => {
          const lessonKey = String(lesson?.key || '').trim()
          const lessonNumber = Number.isFinite(Number(lesson?.order)) ? Number(lesson.order) : lessonIndex + 1
          const lessonQuizQuestions = Array.isArray(lesson?.quizQuestions) ? lesson.quizQuestions : []
          return {
            key: lessonKey,
            title: String(lesson?.title || `Lesson ${lessonNumber}`),
            durationMinutes: Number.isFinite(Number(lesson?.durationMinutes)) ? Number(lesson.durationMinutes) : 0,
            lessonNumber,
            quizQuestions: lessonQuizQuestions
              .map((question) => ({
                prompt: String(question?.prompt || '').trim(),
                choices: Array.isArray(question?.choices)
                  ? question.choices
                    .map((choice) => ({
                      text: String(choice?.text || '').trim()
                    }))
                    .filter((choice) => choice.text)
                  : []
              }))
              .filter((question) => question.prompt && question.choices.length > 1)
          }
        })
        .filter((lesson) => lesson.key)

      const quizLessons = lessonsInChapter
        .filter((lesson) => Array.isArray(lesson.quizQuestions) && lesson.quizQuestions.length > 0)
        .map((lesson) => ({
          key: lesson.key,
          title: lesson.title,
          lessonNumber: lesson.lessonNumber,
          quizQuestions: lesson.quizQuestions
        }))

      return {
        key: String(chapter?.key || `chapter-${chapterNumber}`),
        chapterNumber,
        title: chapterTitle,
        lessons: lessonsInChapter,
        quizLessons
      }
    })

    return res.render('simple-lms-player', {
      title: `${enrollment.course.title} - Learning Player`,
      user: req.user,
      activePage: 'simple-lms',
      role,
      enrollment,
      course: decorateCourse(enrollment.course),
      lessons,
      currentLesson,
      embedUrl: lessonMedia.embedUrl,
      lessonMedia,
      chapterSections,
      completedSet: progress.completedSet,
      progress,
      previousLesson,
      nextLesson,
      latestAttempt,
      success: String(req.query.success || ''),
      error: String(req.query.error || '')
    })
  } catch (error) {
    console.error('Load learning player error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=my-learning',
      error: 'Failed to load lesson player.'
    })
  }
})

pageRouter.post('/enrollments/:enrollmentId/lessons/:lessonKey/complete', requirePageAuth, async (req, res) => {
  try {
    const enrollmentId = String(req.params.enrollmentId || '').trim()
    const lessonKey = String(req.params.lessonKey || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId) || !lessonKey) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'Invalid lesson completion request.'
      })
    }

    const enrollment = await SimpleLmsEnrollment.findById(enrollmentId)
      .populate('course')
    if (!enrollment || !enrollment.course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'Learning record not found.'
      })
    }

    if (toIdString(enrollment.enrolledMember) !== toIdString(req.user._id)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'You can only update your own progress.'
      })
    }

    const lessons = flattenCourseLessons(enrollment.course)
    if (!lessons.find(entry => entry.lessonKey === lessonKey)) {
      return redirectWithMessage({
        res,
        path: `/simple-lms/learn/${enrollment._id}`,
        error: 'Lesson not found.'
      })
    }

    const completedSet = new Set((enrollment.completedLessonKeys || []).map(key => String(key)))
    completedSet.add(lessonKey)
    enrollment.completedLessonKeys = Array.from(completedSet)

    const progress = calculateProgress({
      lessons,
      completedLessonKeys: enrollment.completedLessonKeys
    })

    enrollment.progressPercent = progress.progressPercent
    enrollment.status = progress.isCompleted ? 'completed' : 'in_progress'
    enrollment.lastActivityAt = new Date()
    if (progress.isCompleted) {
      enrollment.completedAt = new Date()
    } else {
      enrollment.completedAt = null
    }
    await enrollment.save()
    await refreshCourseMetrics(enrollment.course._id)

    const targetLesson = req.body.next === '1' && progress.nextLessonKey
      ? progress.nextLessonKey
      : lessonKey

    return redirectWithMessage({
      res,
      path: `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(targetLesson)}`,
      success: progress.isCompleted
        ? 'Course completed. Excellent work.'
        : 'Lesson marked as complete.'
    })
  } catch (error) {
    console.error('Complete lesson error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=my-learning',
      error: 'Failed to update lesson progress.'
    })
  }
})

pageRouter.post('/enrollments/:enrollmentId/lessons/:lessonKey/quiz', requirePageAuth, async (req, res) => {
  try {
    const expectsJson = String(req.query.format || '').trim().toLowerCase() === 'json'
      || String(req.get('accept') || '').toLowerCase().includes('application/json')
      || String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest'
    const quizError = ({ path, error, status = 400 }) => {
      if (expectsJson) {
        return res.status(status).json({
          ok: false,
          error
        })
      }
      return redirectWithMessage({
        res,
        path,
        error
      })
    }

    const enrollmentId = String(req.params.enrollmentId || '').trim()
    const lessonKey = String(req.params.lessonKey || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId) || !lessonKey) {
      return quizError({
        path: '/simple-lms?view=my-learning',
        error: 'Invalid quiz submission request.'
      })
    }

    const enrollment = await SimpleLmsEnrollment.findById(enrollmentId)
      .populate('course')
    if (!enrollment || !enrollment.course) {
      return quizError({
        path: '/simple-lms?view=my-learning',
        error: 'Learning record not found.',
        status: 404
      })
    }
    if (toIdString(enrollment.enrolledMember) !== toIdString(req.user._id)) {
      return quizError({
        path: '/simple-lms?view=my-learning',
        error: 'You can only submit quizzes for your own lessons.',
        status: 403
      })
    }

    const lessons = flattenCourseLessons(enrollment.course)
    const lesson = lessons.find(entry => entry.lessonKey === lessonKey)
    if (!lesson) {
      return quizError({
        path: `/simple-lms/learn/${enrollment._id}`,
        error: 'Lesson not found.',
        status: 404
      })
    }

    const questions = lesson.quizQuestions || []
    if (questions.length === 0) {
      return quizError({
        path: `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(lessonKey)}`,
        error: 'No quiz is available for this lesson.',
        status: 404
      })
    }

    const answers = questions.map((_, index) => {
      const raw = req.body[`answer_${index}`]
      const parsed = Number.parseInt(String(raw ?? '-1'), 10)
      return Number.isInteger(parsed) ? parsed : -1
    })

    let score = 0
    const questionResults = questions.map((question, questionIndex) => {
      const choices = Array.isArray(question?.choices) ? question.choices : []
      const correctIndex = choices.findIndex(choice => Boolean(choice?.isCorrect))
      const selectedIndex = answers[questionIndex]
      const isCorrect = correctIndex >= 0 && selectedIndex === correctIndex
      if (isCorrect) {
        score += 1
      }
      return {
        questionIndex,
        selectedIndex,
        correctIndex,
        isCorrect
      }
    })

    const maxScore = questions.length
    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0

    const currentAttempts = Array.isArray(enrollment.quizAttempts) ? enrollment.quizAttempts : []
    const filteredAttempts = currentAttempts.filter(attempt => String(attempt.lessonKey) !== lessonKey)
    filteredAttempts.push({
      lessonKey,
      score,
      maxScore,
      answers,
      attemptedAt: new Date()
    })

    enrollment.quizAttempts = filteredAttempts.slice(-60)
    enrollment.latestQuizScore = percentage
    enrollment.lastActivityAt = new Date()
    if (enrollment.status === 'assigned') {
      enrollment.status = 'in_progress'
    }
    await enrollment.save()

    if (expectsJson) {
      return res.json({
        ok: true,
        lessonKey,
        score,
        maxScore,
        percentage,
        passed: percentage >= 70,
        questionResults
      })
    }

    return redirectWithMessage({
      res,
      path: `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(lessonKey)}`,
      success: `Quiz submitted. Score: ${score}/${maxScore} (${percentage}%).`
    })
  } catch (error) {
    console.error('Submit quiz error:', error)
    const expectsJson = String(req.query.format || '').trim().toLowerCase() === 'json'
      || String(req.get('accept') || '').toLowerCase().includes('application/json')
      || String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest'
    if (expectsJson) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to submit quiz.'
      })
    }
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=my-learning',
      error: 'Failed to submit quiz.'
    })
  }
})
pageRouter.post('/courses/create', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to create courses.'
      })
    }

    const normalizedRole = String(role || '').trim().toLowerCase()
    const partnerOwnedCourse = isPartnerDashboardRole(normalizedRole)
    const partnerOrganizationId = toIdString(req.user?.partnerOrganization)
    if (partnerOwnedCourse && !mongoose.Types.ObjectId.isValid(partnerOrganizationId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization context is required before creating courses.'
      })
    }

    const currencyCatalog = await getActiveCurrencyCatalog()
    const platformSettings = await getPlatformSettings(currencyCatalog.codes)
    const payload = parseCoursePayload({
      body: req.body,
      role,
      studioContext: req.body?.studioContext || '',
      creatorSettings: req.user.creatorSettings || CREATOR_SETTING_DEFAULTS,
      platformSettings,
      currencyCodes: currencyCatalog.codes
    })
    const studioContext = String(req.body?.studioContext || '').trim().toLowerCase()
    const createAsSystemCourse = canManagePlatform(role) && studioContext === 'admin'
    const createdCourse = await SimpleLmsCourse.create({
      ...payload,
      organization: partnerOwnedCourse ? partnerOrganizationId : null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Course Creator',
      createdByEmail: req.user.email || '',
      isSystemCourse: createAsSystemCourse
    })

    req.user.learningProfile = req.user.learningProfile || {}
    req.user.learningProfile.registrationIntent =
      req.user.learningProfile.registrationIntent || 'teach'
    req.user.learningProfile.intentSource =
      req.user.learningProfile.intentSource || 'course_studio'
    req.user.learningProfile.instructorActivatedAt =
      req.user.learningProfile.instructorActivatedAt || new Date()
    req.user.learningProfile.instructorOnboardingCompleted = true
    req.user.learningProfile.firstCourseCreatedAt =
      req.user.learningProfile.firstCourseCreatedAt || new Date()
    req.user.learningProfile.firstCourse =
      req.user.learningProfile.firstCourse || createdCourse._id
    await req.user.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: createdCourse.status === 'pending_public_review'
        ? 'Course submitted for admin approval.'
        : 'Course created successfully.'
    })
  } catch (error) {
    console.error('Create course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error.message || 'Failed to create course.'
    })
  }
})

pageRouter.post('/courses/:courseId/update', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    if (!canEditCourse({
      role,
      accountId: req.user._id,
      course
    })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to update this course.'
      })
    }

    const currencyCatalog = await getActiveCurrencyCatalog()
    const platformSettings = await getPlatformSettings(currencyCatalog.codes)
    const payload = parseCoursePayload({
      body: req.body,
      role,
      existingCourse: course,
      studioContext: req.body?.studioContext || '',
      creatorSettings: req.user.creatorSettings || CREATOR_SETTING_DEFAULTS,
      platformSettings,
      currencyCodes: currencyCatalog.codes
    })

    Object.assign(course, payload)
    await course.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: course.status === 'pending_public_review'
        ? 'Course update submitted for admin approval.'
        : 'Course updated successfully.'
    })
  } catch (error) {
    console.error('Update course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error.message || 'Failed to update course.'
    })
  }
})

pageRouter.post('/courses/:courseId/duplicate', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const role = resolveRole(req.user)
    const normalizedRole = String(role || '').trim().toLowerCase()
    const partnerOwnedCourse = isPartnerDashboardRole(normalizedRole)
    const partnerOrganizationId = toIdString(req.user?.partnerOrganization)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to duplicate courses.'
      })
    }
    if (partnerOwnedCourse && !mongoose.Types.ObjectId.isValid(partnerOrganizationId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization context is required before duplicating courses.'
      })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const sourceCourse = await SimpleLmsCourse.findById(courseId).lean()
    if (!sourceCourse) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    if (!canDuplicateCourse({
      role,
      accountId: req.user._id,
      course: sourceCourse
    })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to duplicate this course.'
      })
    }

    const titleSuffixRaw = String(req.body?.titleSuffix || 'Copy').trim().slice(0, 40)
    const titleSuffix = titleSuffixRaw || 'Copy'
    const sourceTitle = String(sourceCourse.title || 'Untitled Course').trim() || 'Untitled Course'
    const duplicateTitle = `${sourceTitle} (${titleSuffix})`.slice(0, 200)
    const studioContext = String(req.body?.studioContext || '').trim().toLowerCase()
    const duplicateAsSystemCourse = canManagePlatform(role)
      && (studioContext === 'admin' || req.body?.isSystemCourse === 'on')
    const sourceVisibility = String(sourceCourse.visibility || '').trim().toLowerCase()
    const duplicateVisibility = (() => {
      if (['organization_private', 'organization_public', 'system_public'].includes(sourceVisibility)) {
        if (sourceVisibility === 'system_public' && !canManagePlatform(role)) {
          return 'organization_public'
        }
        return sourceVisibility
      }
      return normalizeVisibility(sourceCourse.visibility, role)
    })()
    const duplicatePayload = {
      organization: partnerOwnedCourse ? partnerOrganizationId : null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Course Creator',
      createdByEmail: req.user.email || '',
      title: duplicateTitle,
      summary: String(sourceCourse.summary || '').trim().slice(0, 600),
      description: String(sourceCourse.description || '').trim().slice(0, 16000),
      category: String(sourceCourse.category || '').trim().slice(0, 120),
      level: LEVELS.includes(String(sourceCourse.level || '').trim()) ? String(sourceCourse.level).trim() : 'mixed',
      tags: parseTags(Array.isArray(sourceCourse.tags) ? sourceCourse.tags.join(',') : ''),
      banner: sourceCourse?.banner?.url
        ? {
          url: String(sourceCourse.banner.url || '').trim().slice(0, 2000),
          publicId: String(sourceCourse.banner.publicId || '').trim().slice(0, 400),
          width: Number.isFinite(Number(sourceCourse.banner.width)) ? Number(sourceCourse.banner.width) : undefined,
          height: Number.isFinite(Number(sourceCourse.banner.height)) ? Number(sourceCourse.banner.height) : undefined
        }
        : {},
      pricing: {
        paymentMode: sourceCourse?.pricing?.paymentMode === 'paid' ? 'paid' : 'free',
        amount: sourceCourse?.pricing?.paymentMode === 'paid'
          ? Math.max(0, Math.round(Number(sourceCourse?.pricing?.amount || 0)))
          : 0,
        currency: normalizeCurrencyCode(sourceCourse?.pricing?.currency || 'NGN')
      },
      visibility: duplicateVisibility,
      status: 'draft',
      isSystemCourse: duplicateAsSystemCourse,
      requiresPublicReview: sourceCourse.requiresPublicReview !== false,
      publishedWithoutReview: false,
      publishedAt: null,
      submittedForPublicReviewAt: null,
      approvedPublicAt: null,
      approvedPublicBy: null,
      reviewDecision: 'none',
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: '',
      archivedAt: null,
      chapters: sanitizeChaptersInput(Array.isArray(sourceCourse.chapters) ? sourceCourse.chapters : []),
      enrollmentCount: 0,
      completionCount: 0,
      isActive: true
    }
    const duplicatedCourse = await SimpleLmsCourse.create(duplicatePayload)
    const studioPath = sanitizeInternalPath(String(req.body?.studioPath || '').trim(), returnTo)
    const destinationPath = buildStudioEditCoursePath(studioPath, duplicatedCourse._id, returnTo)

    return redirectWithMessage({
      res,
      path: destinationPath,
      success: `Course duplicated into studio: ${duplicatedCourse.title}.`
    })
  } catch (error) {
    console.error('Duplicate course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to duplicate course.'
    })
  }
})

pageRouter.post('/courses/:courseId/archive', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    if (!canArchiveCourse({
      role,
      accountId: req.user._id,
      course,
      partnerOrganizationId: req.user.partnerOrganization
    })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to archive this course.'
      })
    }

    course.status = 'archived'
    course.isActive = false
    course.archivedAt = new Date()
    await course.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Course archived.'
    })
  } catch (error) {
    console.error('Archive course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to archive course.'
    })
  }
})

pageRouter.post('/courses/:courseId/restore', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    if (!canRestoreCourse({
      role,
      accountId: req.user._id,
      course,
      partnerOrganizationId: req.user.partnerOrganization
    })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to restore this course.'
      })
    }

    course.status = 'draft'
    course.isActive = true
    course.archivedAt = null
    await course.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Course restored to draft.'
    })
  } catch (error) {
    console.error('Restore course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to restore course.'
    })
  }
})

pageRouter.post('/courses/:courseId/delete', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req, '/admin/courses')
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    if (!canDeleteCourse({ role })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can permanently delete courses.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    const [enrollmentCount, successfulPaymentCount, programReferenceCount] = await Promise.all([
      SimpleLmsEnrollment.countDocuments({ course: course._id }),
      SimpleLmsPayment.countDocuments({ course: course._id, status: 'successful' }),
      SimpleLmsProgram.countDocuments({ 'steps.course': course._id })
    ])

    const blockingReasons = []
    if (enrollmentCount > 0) {
      blockingReasons.push(`${enrollmentCount} enrollment${enrollmentCount === 1 ? '' : 's'}`)
    }
    if (successfulPaymentCount > 0) {
      blockingReasons.push(`${successfulPaymentCount} successful payment${successfulPaymentCount === 1 ? '' : 's'}`)
    }
    if (programReferenceCount > 0) {
      blockingReasons.push(`${programReferenceCount} program reference${programReferenceCount === 1 ? '' : 's'}`)
    }
    if (blockingReasons.length > 0) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: `Permanent delete is blocked because this course has ${blockingReasons.join(' and ')}. Archive it instead.`
      })
    }

    await SimpleLmsCourse.deleteOne({ _id: course._id })

    await logAuditEvent({
      action: 'course.delete',
      performedBy: req.user._id,
      targetAccount: course.createdBy || null,
      metadata: {
        courseId: toIdString(course._id),
        courseTitle: course.title || 'Untitled Course',
        organizationId: toIdString(course.organization)
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Course permanently deleted.'
    })
  } catch (error) {
    console.error('Delete course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to delete course.'
    })
  }
})

const reviewCourseSubmission = async ({
  req,
  res,
  course,
  decision,
  reviewNotes
}) => {
  const normalizedDecision = normalizeCourseReviewDecision(decision)
  const notes = String(reviewNotes || '').trim().slice(0, 3000)

  if (!['approved', 'changes_requested', 'denied'].includes(normalizedDecision)) {
    throw new Error('Invalid review decision.')
  }
  if (String(course?.status || '').trim().toLowerCase() !== 'pending_public_review') {
    throw new Error('Only courses pending public review can be reviewed.')
  }
  if (normalizedDecision !== 'approved' && !notes) {
    throw new Error(normalizedDecision === 'denied'
      ? 'A denial reason is required.'
      : 'A change request message is required.')
  }

  const now = new Date()
  course.reviewDecision = normalizedDecision
  course.reviewedAt = now
  course.reviewedBy = req.user._id
  course.reviewNotes = notes

  if (normalizedDecision === 'approved') {
    course.status = 'published'
    course.isActive = true
    course.publishedAt = course.publishedAt || now
    course.approvedPublicAt = now
    course.approvedPublicBy = req.user._id
  } else {
    course.status = 'draft'
    course.isActive = true
    course.publishedAt = null
    course.approvedPublicAt = null
    course.approvedPublicBy = null
  }

  await course.save()

  await logAuditEvent({
    action: `course.review.${normalizedDecision}`,
    performedBy: req.user._id,
    targetAccount: course.createdBy || null,
    metadata: {
      courseId: course._id,
      courseTitle: course.title,
      decision: normalizedDecision,
      reviewNotes: notes
    },
    req
  })

  await sendCourseReviewNotification({
    req,
    res,
    course,
    decision: normalizedDecision,
    notes
  })

  return normalizedDecision
}

pageRouter.post('/courses/:courseId/approve-public', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can approve public courses.'
      })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    await reviewCourseSubmission({
      req,
      res,
      course,
      decision: 'approved',
      reviewNotes: req.body.reviewNotes
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Course approved and published: ${course.title}.`
    })
  } catch (error) {
    console.error('Approve course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to approve this course.'
    })
  }
})

pageRouter.post('/courses/:courseId/review-public', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can review public course submissions.'
      })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    const decision = normalizeCourseReviewDecision(req.body?.decision, 'changes_requested')
    await reviewCourseSubmission({
      req,
      res,
      course,
      decision,
      reviewNotes: req.body.reviewNotes
    })

    const successMessage = decision === 'denied'
      ? `Course denied: ${course.title}.`
      : `Changes requested for course: ${course.title}.`

    return redirectWithMessage({
      res,
      path: returnTo,
      success: successMessage
    })
  } catch (error) {
    console.error('Review course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to review this course submission.'
    })
  }
})

pageRouter.post('/courses/:courseId/reject-public', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can review public course submissions.'
      })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Course not found.'
      })
    }

    const decision = normalizeCourseReviewDecision(req.body?.decision, 'changes_requested')
    await reviewCourseSubmission({
      req,
      res,
      course,
      decision,
      reviewNotes: req.body.reviewNotes
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: decision === 'denied'
        ? `Course denied: ${course.title}.`
        : `Changes requested for course: ${course.title}.`
    })
  } catch (error) {
    console.error('Reject course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to review this course submission.'
    })
  }
})

pageRouter.post('/courses/:courseId/assign', requirePageAuth, async (req, res) => {
  const returnTo = resolveCourseStudioReturnPath(req)
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to assign courses.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId).lean()
    if (!course || !canAssignCourse({
      role,
      accountId: req.user._id,
      course,
      partnerOrganizationId: req.user.partnerOrganization
    })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You cannot assign this course.'
      })
    }

    const targetAccountId = String(req.body.targetAccountId || '').trim()
    const targetEmail = String(req.body.targetEmail || '').trim().toLowerCase()
    let targetAccount = null

    if (mongoose.Types.ObjectId.isValid(targetAccountId)) {
      targetAccount = await Account.findById(targetAccountId).select('_id email profile.name').lean()
    } else if (targetEmail) {
      targetAccount = await Account.findOne({ email: targetEmail }).select('_id email profile.name').lean()
    }

    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Target learner not found. Select an account or use a valid email.'
      })
    }

    await createOrUpdateEnrollment({
      courseId: course._id,
      learnerId: targetAccount._id,
      actorId: req.user._id,
      assignmentType: 'member',
      source: 'manual'
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Course assigned to ${targetAccount.profile?.name || targetAccount.email}.`
    })
  } catch (error) {
    console.error('Assign course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to assign course.'
    })
  }
})

pageRouter.post('/programs/create', requirePageAuth, async (req, res) => {
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You do not have permission to create programs.'
      })
    }

    const payload = parseProgramPayload({ body: req.body })
    const stepCourseIds = payload.steps.map(step => step.course)
    const courses = await SimpleLmsCourse.find({ _id: { $in: stepCourseIds } })
      .select('_id title')
      .lean()
    if (courses.length !== payload.steps.length) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'One or more pathway courses are invalid.'
      })
    }

    const titleById = new Map(courses.map(course => [toIdString(course._id), course.title]))
    payload.steps = payload.steps.map((step, index) => ({
      ...step,
      order: index + 1,
      titleSnapshot: titleById.get(toIdString(step.course)) || 'Course'
    }))

    await SimpleLmsProgram.create({
      ...payload,
      organization: null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Program Creator'
    })

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      success: 'Program created successfully.'
    })
  } catch (error) {
    console.error('Create program error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      error: error.message || 'Failed to create program.'
    })
  }
})

pageRouter.post('/programs/:programId/update', requirePageAuth, async (req, res) => {
  try {
    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Invalid program selected.'
      })
    }

    const role = resolveRole(req.user)
    const program = await SimpleLmsProgram.findById(programId)
    if (!program) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Program not found.'
      })
    }

    if (!canManageProgram({ role, accountId: req.user._id, program })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You do not have permission to update this program.'
      })
    }

    const payload = parseProgramPayload({ body: req.body, existingProgram: program })
    const stepCourseIds = payload.steps.map(step => step.course)
    const courses = await SimpleLmsCourse.find({ _id: { $in: stepCourseIds } })
      .select('_id title')
      .lean()
    if (courses.length !== payload.steps.length) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'One or more pathway courses are invalid.'
      })
    }

    const titleById = new Map(courses.map(course => [toIdString(course._id), course.title]))
    payload.steps = payload.steps.map((step, index) => ({
      ...step,
      order: index + 1,
      titleSnapshot: titleById.get(toIdString(step.course)) || 'Course'
    }))

    Object.assign(program, payload)
    await program.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      success: 'Program updated successfully.'
    })
  } catch (error) {
    console.error('Update program error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      error: error.message || 'Failed to update program.'
    })
  }
})

pageRouter.post('/programs/:programId/archive', requirePageAuth, async (req, res) => {
  try {
    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Invalid program selected.'
      })
    }

    const role = resolveRole(req.user)
    const program = await SimpleLmsProgram.findById(programId)
    if (!program) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Program not found.'
      })
    }

    if (!canManageProgram({ role, accountId: req.user._id, program })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You do not have permission to archive this program.'
      })
    }

    program.status = 'archived'
    await program.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      success: 'Program archived.'
    })
  } catch (error) {
    console.error('Archive program error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      error: 'Failed to archive program.'
    })
  }
})

pageRouter.post('/programs/:programId/restore', requirePageAuth, async (req, res) => {
  try {
    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Invalid program selected.'
      })
    }

    const role = resolveRole(req.user)
    const program = await SimpleLmsProgram.findById(programId)
    if (!program) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Program not found.'
      })
    }

    if (!canManageProgram({ role, accountId: req.user._id, program })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You do not have permission to restore this program.'
      })
    }

    program.status = 'draft'
    await program.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      success: 'Program restored to draft.'
    })
  } catch (error) {
    console.error('Restore program error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      error: 'Failed to restore program.'
    })
  }
})

pageRouter.post('/programs/:programId/enroll', requirePageAuth, async (req, res) => {
  try {
    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Invalid program selected.'
      })
    }

    const program = await SimpleLmsProgram.findOne({
      _id: programId,
      status: 'published',
      visibility: { $in: PROGRAM_VISIBILITY_VALUES }
    })
      .lean()
    if (!program) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Program not found or unavailable.'
      })
    }

    const orderedSteps = (program.steps || [])
      .map((step) => ({
        courseId: toIdString(step.course),
        required: step.required !== false,
        order: Number(step.order || 0)
      }))
      .filter((step) => mongoose.Types.ObjectId.isValid(step.courseId))
      .sort((a, b) => a.order - b.order)

    if (orderedSteps.length === 0) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'This program has no valid courses yet.'
      })
    }

    const courses = await SimpleLmsCourse.find({
      _id: { $in: orderedSteps.map(step => step.courseId) },
      isActive: true
    })
      .select('_id status visibility')
      .lean()

    const availableCourseIds = new Set(
      courses
        .filter((course) => course.status === 'published' && PUBLIC_VISIBILITY_VALUES.includes(course.visibility))
        .map((course) => toIdString(course._id))
    )

    let createdCount = 0
    for (const step of orderedSteps) {
      if (!availableCourseIds.has(step.courseId)) continue
      const result = await createOrUpdateEnrollment({
        courseId: step.courseId,
        learnerId: req.user._id,
        actorId: req.user._id,
        assignmentType: 'program',
        source: 'program_assignment',
        programId: program._id
      })
      if (result.created) createdCount += 1
    }

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=my-learning',
      success: createdCount > 0
        ? `Program added to your learning path: ${program.name}.`
        : `Program already in your learning path: ${program.name}.`
    })
  } catch (error) {
    console.error('Program enroll error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
      error: 'Failed to enroll in program.'
    })
  }
})

pageRouter.post('/programs/:programId/assign', requirePageAuth, async (req, res) => {
  try {
    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Invalid program selected.'
      })
    }

    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You do not have permission to assign programs.'
      })
    }

    const program = await SimpleLmsProgram.findById(programId).lean()
    if (!program || !canManageProgram({ role, accountId: req.user._id, program })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'You cannot assign this program.'
      })
    }

    const targetAccountId = String(req.body.targetAccountId || '').trim()
    const targetEmail = String(req.body.targetEmail || '').trim().toLowerCase()
    let targetAccount = null

    if (mongoose.Types.ObjectId.isValid(targetAccountId)) {
      targetAccount = await Account.findById(targetAccountId).select('_id email profile.name').lean()
    } else if (targetEmail) {
      targetAccount = await Account.findOne({ email: targetEmail }).select('_id email profile.name').lean()
    }

    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=program-studio',
        error: 'Target learner not found. Select an account or use a valid email.'
      })
    }

    const orderedSteps = (program.steps || [])
      .map((step) => ({
        courseId: toIdString(step.course),
        order: Number(step.order || 0)
      }))
      .filter((step) => mongoose.Types.ObjectId.isValid(step.courseId))
      .sort((a, b) => a.order - b.order)

    let assignedCount = 0
    for (const step of orderedSteps) {
      const result = await createOrUpdateEnrollment({
        courseId: step.courseId,
        learnerId: targetAccount._id,
        actorId: req.user._id,
        assignmentType: 'program',
        source: 'program_assignment',
        programId: program._id
      })
      if (result.created) assignedCount += 1
    }

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      success: assignedCount > 0
        ? `Program assigned to ${targetAccount.profile?.name || targetAccount.email}.`
        : `Program already assigned to ${targetAccount.profile?.name || targetAccount.email}.`
    })
  } catch (error) {
    console.error('Assign program error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=program-studio',
      error: 'Failed to assign program.'
    })
  }
})

pageRouter.post('/accounts/:accountId/role', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update roles.'
      })
    }

    const accountId = String(req.params.accountId || '').trim()
    const nextRole = String(req.body.role || '').trim().toLowerCase()
    if (!mongoose.Types.ObjectId.isValid(accountId) || !DIRECT_ROLE_UPDATE_VALUES.includes(nextRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid role update request.'
      })
    }

    const target = await Account.findById(accountId)
    if (!target) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Account not found.'
      })
    }

    if (nextRole === 'super_admin' && actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can assign super admin role.'
      })
    }

    const currentTargetRole = resolveRole(target)
    if (target.isSuperAdmin && nextRole !== 'super_admin') {
      const superAdminCount = await Account.countDocuments({
        $or: [{ isSuperAdmin: true }, { learningRole: 'super_admin' }]
      })
      if (superAdminCount <= 1) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'At least one super admin must remain in the system.'
        })
      }
    }

    const accessProfile = await resolveAccessProfile(target)
    if ((nextRole === 'admin' || nextRole === 'super_admin') && accessProfile?.agentAccess) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Sales agents cannot also hold platform admin access.'
      })
    }

    const previousRole = LEARNING_ROLES.includes(currentTargetRole) ? currentTargetRole : 'learner'
    applyPlatformRoleUpdate({
      account: target,
      nextRole,
      actorId: req.user._id
    })
    await target.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: target._id,
      targetOrganization: target.partnerOrganization || null,
      metadata: {
        source: 'admin_users_page',
        fromRole: previousRole,
        toRole: nextRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Role updated successfully.'
    })
  } catch (error) {
    console.error('Role update error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to update role.'
    })
  }
})

const mapLearningRoleToPartnerMemberRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase()
  if (['channel_partner_super', 'partner_super'].includes(normalized)) return 'partner_admin'
  if (normalized === 'channel_sales_agent') return 'sales_agent'
  return 'partner_user'
}

const resolvePartnerDashboardRoleFromOrgMembership = ({ organization, memberRole }) => {
  const partnerType = String(organization?.partnerType || '').trim().toLowerCase()
  const normalizedMemberRole = String(memberRole || '').trim().toLowerCase()
  if (partnerType === 'channel_partner') {
    return ['owner', 'admin', 'partner_admin'].includes(normalizedMemberRole)
      ? 'channel_partner_super'
      : 'channel_partner_user'
  }
  if (partnerType === 'partner') {
    return ['owner', 'admin', 'partner_admin'].includes(normalizedMemberRole)
      ? 'partner_super'
      : 'partner_user'
  }
  return ''
}

const resolveNonPlatformRole = (account, fallback = 'learner') => {
  const currentRole = String(account?.learningRole || '').trim().toLowerCase()
  if (['learner', 'creator', 'partner_user', 'partner_super', 'channel_partner_user', 'channel_partner_super', 'channel_sales_agent'].includes(currentRole)) {
    return currentRole
  }
  const previousRole = String(account?.roleMetadata?.previousLearningRole || '').trim().toLowerCase()
  if (['learner', 'creator', 'partner_user', 'partner_super', 'channel_partner_user', 'channel_partner_super', 'channel_sales_agent'].includes(previousRole)) {
    return previousRole
  }
  return fallback
}

const resolveNonPartnerFallbackRole = (account, fallback = 'learner') => {
  const previousRole = String(account?.roleMetadata?.previousLearningRole || '').trim().toLowerCase()
  if (['learner', 'creator'].includes(previousRole)) return previousRole
  const currentRole = String(account?.learningRole || '').trim().toLowerCase()
  if (['learner', 'creator'].includes(currentRole)) return currentRole
  return fallback
}

const updateAccountRoleMetadata = ({ account, previousLearningRole, actorId }) => {
  account.roleMetadata = {
    ...(account.roleMetadata || {}),
    previousLearningRole,
    lastUpdatedAt: new Date(),
    lastUpdatedBy: actorId || null
  }
}

const applyPlatformRoleUpdate = ({ account, nextRole, actorId }) => {
  const normalizedNextRole = String(nextRole || '').trim().toLowerCase()
  const previousLearningRole = resolveNonPlatformRole(account)
  if (normalizedNextRole === 'admin' || normalizedNextRole === 'super_admin') {
    account.isSystemAdmin = true
    account.isSuperAdmin = normalizedNextRole === 'super_admin'
    if (!['admin', 'super_admin'].includes(String(account.learningRole || '').trim().toLowerCase())) {
      account.learningRole = resolveNonPlatformRole(account)
    } else {
      account.learningRole = previousLearningRole
    }
    updateAccountRoleMetadata({
      account,
      previousLearningRole,
      actorId
    })
    return
  }

  account.learningRole = normalizedNextRole
  account.isSystemAdmin = false
  account.isSuperAdmin = false
  updateAccountRoleMetadata({
    account,
    previousLearningRole: normalizedNextRole,
    actorId
  })
}

const assertPartnerAccessCompatibility = async ({
  account,
  organization,
  nextRole
}) => {
  const nextPartnerType = resolvePartnerTypeForLearningRole(nextRole)
  if (nextPartnerType === 'none') {
    throw new Error('A partner role is required for this operation.')
  }

  const orgPartnerType = String(organization?.partnerType || '').trim().toLowerCase()
  if (orgPartnerType !== nextPartnerType) {
    throw new Error('Selected role does not match the partner organization type.')
  }

  const accessProfile = await resolveAccessProfile(account)
  if (accessProfile?.agentAccess) {
    throw new Error('Sales agents cannot be promoted into partner management access.')
  }

  const currentPartnerOrganizationId = String(accessProfile?.partnerAccess?.organizationId || '').trim()
  const targetOrganizationId = toIdString(organization?._id)
  if (currentPartnerOrganizationId && currentPartnerOrganizationId !== targetOrganizationId) {
    throw new Error('This account is already linked to another partner organization. Remove that membership first.')
  }

  const currentPartnerType = String(accessProfile?.partnerAccess?.partnerType || '').trim().toLowerCase()
  if (currentPartnerType && currentPartnerType !== orgPartnerType) {
    throw new Error('Accounts cannot mix partner and channel partner memberships.')
  }
}

const upsertOrganizationMemberRecord = ({ organization, accountId, memberRole, actorId }) => {
  const existingMember = Array.isArray(organization.members)
    ? organization.members.find((entry) => toIdString(entry.account) === toIdString(accountId))
    : null

  if (existingMember) {
    existingMember.role = memberRole
    existingMember.status = 'active'
    existingMember.updatedAt = new Date()
    existingMember.updatedBy = actorId || accountId
    return existingMember
  }

  organization.members = Array.isArray(organization.members) ? organization.members : []
  organization.members.push({
    account: accountId,
    role: memberRole,
    appAccess: {
      mode: 'all',
      appIds: []
    },
    joinedAt: new Date(),
    invitedBy: actorId || accountId,
    status: 'active',
    updatedAt: new Date(),
    updatedBy: actorId || accountId
  })
  return organization.members[organization.members.length - 1]
}

const upsertAccountOrganizationMembership = ({ account, organizationId, memberRole }) => {
  const existingMembership = Array.isArray(account.organizations)
    ? account.organizations.find((entry) => toIdString(entry.organization) === toIdString(organizationId))
    : null

  if (existingMembership) {
    existingMembership.role = memberRole
    existingMembership.isActive = true
    return existingMembership
  }

  account.organizations = Array.isArray(account.organizations) ? account.organizations : []
  account.organizations.push({
    organization: organizationId,
    role: memberRole,
    appAccess: { mode: 'all', appIds: [] },
    joinedAt: new Date(),
    isActive: true
  })
  return account.organizations[account.organizations.length - 1]
}

const ensurePartnerOrganizationForRoleAssignment = async ({
  account,
  nextRole,
  organizationName,
  actorId,
  organization: existingOrganization = null
}) => {
  const partnerType = resolvePartnerTypeForLearningRole(nextRole)
  if (partnerType === 'none') return null

  const normalizedOrgName = sanitizePartnerOrganizationName(organizationName)
  const orgRole = mapLearningRoleToPartnerMemberRole(nextRole)
  let organization = existingOrganization || null
  const organizationId = toIdString(account?.partnerOrganization)

  if (!organization && organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
    organization = await Organization.findById(organizationId)
  }

  if (!organization) {
    if (!normalizedOrgName) {
      throw new Error('Organization name is required when assigning a partner role.')
    }

    organization = await Organization.create({
      name: normalizedOrgName,
      description: `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} organization`,
      owner: account._id,
      partnerType,
      members: [{
        account: account._id,
        role: orgRole,
        appAccess: {
          mode: 'all',
          appIds: []
        },
        joinedAt: new Date(),
        invitedBy: actorId || account._id,
        status: 'active',
        updatedAt: new Date(),
        updatedBy: actorId || account._id
      }],
      partnerSettings: {
        partnerStatus: 'active',
        maxAgents: null,
        defaultAgentCommissionRate: 10,
        agentInviteApproval: true
      }
    })
  } else {
    const currentPartnerType = String(organization.partnerType || 'partner').trim().toLowerCase()
    if (currentPartnerType && currentPartnerType !== partnerType) {
      throw new Error('This account is linked to a different partner organization type. Update the organization first or use a different account.')
    }
    if (normalizedOrgName) {
      organization.name = normalizedOrgName
    }
    organization.description = `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} organization`
    organization.partnerType = partnerType
    organization.partnerSettings = {
      ...(organization.partnerSettings || {}),
      partnerStatus: 'active',
      maxAgents: organization.partnerSettings?.maxAgents ?? null,
      defaultAgentCommissionRate: organization.partnerSettings?.defaultAgentCommissionRate ?? 10,
      agentInviteApproval: organization.partnerSettings?.agentInviteApproval ?? true
    }
  }

  await assertPartnerAccessCompatibility({
    account,
    organization,
    nextRole
  })
  upsertOrganizationMemberRecord({
    organization,
    accountId: account._id,
    memberRole: orgRole,
    actorId
  })
  await organization.save()

  const previousLearningRole = resolveNonPlatformRole(account)
  upsertAccountOrganizationMembership({
    account,
    organizationId: organization._id,
    memberRole: orgRole
  })
  account.partnerOrganization = organization._id
  account.currentOrganization = organization._id
  account.learningRole = nextRole
  updateAccountRoleMetadata({
    account,
    previousLearningRole: isDirectPartnerRoleUpdate(previousLearningRole) ? resolveNonPartnerFallbackRole(account) : previousLearningRole,
    actorId
  })
  return organization
}

const removePartnerOrganizationMembership = async ({
  account,
  organization,
  actorId
}) => {
  organization.members = (organization.members || []).filter((member) => (
    toIdString(member.account) !== toIdString(account._id)
  ))
  await organization.save()

  account.organizations = (account.organizations || []).filter((entry) => (
    toIdString(entry.organization) !== toIdString(organization._id)
  ))
  if (toIdString(account.partnerOrganization) === toIdString(organization._id)) {
    account.partnerOrganization = null
  }
  if (toIdString(account.currentOrganization) === toIdString(organization._id)) {
    account.currentOrganization = null
  }

  const remainingPartnerMembership = (account.organizations || []).find((entry) => Boolean(entry?.isActive))
  if (!remainingPartnerMembership) {
    account.learningRole = resolveNonPartnerFallbackRole(account)
  }
  updateAccountRoleMetadata({
    account,
    previousLearningRole: resolveNonPartnerFallbackRole(account),
    actorId
  })
}

pageRouter.post('/admin/super-users/invite', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/super-users', '/admin/super-users')
  try {
    const actorRole = resolveRole(req.user)
    if (actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can send admin invites.'
      })
    }

    await assertCurrentPassword({
      accountId: req.user._id,
      password: req.body?.currentPassword
    })

    const email = normalizeEmail(req.body?.email || '')
    const requestedRole = normalizeAdminInviteRole(req.body?.requestedRole || 'admin')
    const notes = String(req.body?.notes || '').trim().slice(0, 1200)

    if (!email) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invite email is required.'
      })
    }

    const existingAccount = await Account.findOne({ email }).select('_id learningRole isSystemAdmin isSuperAdmin').lean()
    if (existingAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'That email already belongs to an account. Use direct promotion or role assignment instead.'
      })
    }

    const existingInvite = await AdminInvite.findOne({
      email,
      status: { $in: ['pending', 'registered'] }
    }).sort({ createdAt: -1 })

    if (existingInvite) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'An active invite already exists for that email address.'
      })
    }

    const invite = await AdminInvite.create({
      email,
      invitedBy: req.user._id,
      requestedRole,
      token: createAdminInviteToken(),
      status: 'pending',
      expiresAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)),
      notes,
      metadata: {
        source: 'admin_console'
      }
    })

    const registerUrl = `${buildBaseUrl(req)}${appendQuery('/register', {
      admin_invite_token: invite.token,
      return_to: '/admin',
      source: 'admin_invite'
    })}`
    const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'
    const roleCopy = resolveAdminInviteRoleCopy(requestedRole)
    await emailService.sendNotificationEmail({
      to: email,
      subject: `${learningName} ${roleCopy} invitation`,
      html: `<p>Hello,</p><p>You were invited to join <strong>${learningName}</strong> as a <strong>${roleCopy}</strong>.</p><p>Complete your registration here:</p><p><a href="${registerUrl}">${registerUrl}</a></p><p>This invite expires in 7 days.</p>`,
      text: `You were invited to join ${learningName} as a ${roleCopy}. Complete registration here within 7 days: ${registerUrl}`
    })

    await logAuditEvent({
      action: 'admin.invite',
      performedBy: req.user._id,
      metadata: {
        inviteId: invite._id,
        email,
        requestedRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Invite sent to ${email}.`
    })
  } catch (error) {
    console.error('Invite admin user error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to send admin invite.'
    })
  }
})

pageRouter.post('/admin/super-users/invites/:inviteId/revoke', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/super-users', '/admin/super-users')
  try {
    const actorRole = resolveRole(req.user)
    if (actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can revoke admin invites.'
      })
    }

    await assertCurrentPassword({
      accountId: req.user._id,
      password: req.body?.currentPassword
    })

    const inviteId = String(req.params.inviteId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(inviteId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid invite selected.'
      })
    }

    const invite = await AdminInvite.findById(inviteId)
    if (!invite) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invite not found.'
      })
    }

    if (!['pending', 'registered'].includes(String(invite.status || '').trim().toLowerCase())) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Invite can no longer be revoked.'
      })
    }

    invite.status = 'revoked'
    invite.otpHash = ''
    invite.otpExpiresAt = null
    await invite.save()

    await logAuditEvent({
      action: 'admin.invite.revoked',
      performedBy: req.user._id,
      metadata: {
        inviteId: invite._id,
        email: invite.email,
        requestedRole: invite.requestedRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Admin invite revoked.'
    })
  } catch (error) {
    console.error('Revoke admin invite error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to revoke admin invite.'
    })
  }
})

pageRouter.post('/admin/super-users/promote', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/super-users', '/admin/super-users')
  try {
    const actorRole = resolveRole(req.user)
    if (actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can promote super users.'
      })
    }

    await assertCurrentPassword({
      accountId: req.user._id,
      password: req.body?.currentPassword
    })

    const accountId = String(req.body?.targetAccountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select an account to promote.'
      })
    }

    const target = await Account.findById(accountId)
    if (!target) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Account not found.'
      })
    }
    if (resolveRole(target) === 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Account is already a super admin.'
      })
    }

    const targetAccessProfile = await resolveAccessProfile(target)
    if (targetAccessProfile?.agentAccess) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Sales agents cannot also hold super admin access.'
      })
    }

    const previousRole = String(resolveRole(target) || 'learner').trim().toLowerCase()
    applyPlatformRoleUpdate({
      account: target,
      nextRole: 'super_admin',
      actorId: req.user._id
    })
    await target.save()

    await logAuditEvent({
      action: 'super_user.promote',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        previousRole,
        nextRole: 'super_admin'
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Super admin privileges granted.'
    })
  } catch (error) {
    console.error('Promote super user (bulk route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to promote super user.'
    })
  }
})

pageRouter.get('/payments/paystack/callback', requirePageAuth, async (req, res) => {
  try {
    const reference = String(req.query.reference || req.query.trxref || '').trim()
    const status = String(req.query.status || '').trim().toLowerCase()
    if (!reference) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Payment callback is missing transaction reference.'
      })
    }

    const payment = await SimpleLmsPayment.findOne({
      account: req.user._id,
      provider: 'paystack',
      $or: [
        { txRef: reference },
        { paystackReference: reference }
      ]
    }).populate('course')

    if (!payment || !payment.course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Payment record not found.'
      })
    }

    const { fallbackPath } = buildPaymentCallbackContext({ payment })
    if (payment.status === 'successful') {
      await createOrUpdateAgentAttributionForPayment({
        payment,
        course: payment.course
      })
      removeSessionCartCourseId(req, payment.course._id)
      clearReferralCodeForCourse(req, payment.course._id)
      return redirectAfterPaymentCallback({
        req,
        res,
        payment,
        defaultMessage: 'Payment already verified.'
      })
    }

    if (status && ['failed', 'abandoned', 'cancelled'].includes(status)) {
      payment.status = status === 'cancelled' ? 'cancelled' : 'failed'
      payment.paystackStatus = status
      payment.paystackReference = payment.paystackReference || reference
      payment.verifiedAt = new Date()
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment was not completed.'
      })
    }

    const verificationResult = await verifyPaystackPaymentRecord({
      payment,
      reference
    })

    if (!verificationResult.success) {
      payment.status = 'failed'
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment verification failed.'
      })
    }

    await markPaymentSuccessful({
      payment,
      course: payment.course,
      paidAt: verificationResult.paidAt || new Date()
    })
    removeSessionCartCourseId(req, payment.course._id)
    clearReferralCodeForCourse(req, payment.course._id)

    return redirectAfterPaymentCallback({
      req,
      res,
      payment,
      defaultMessage: 'Payment verified. Course unlocked.'
    })
  } catch (error) {
    console.error('Paystack callback error:', error)
    return redirectWithMessage({
      res,
      path: '/courses',
      error: 'Failed to verify payment.'
    })
  }
})

pageRouter.post('/admin/super-users/:accountId/promote', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/super-users', '/admin/super-users')
  try {
    const actorRole = resolveRole(req.user)
    if (actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can promote super users.'
      })
    }

    await assertCurrentPassword({
      accountId: req.user._id,
      password: req.body?.currentPassword
    })

    const accountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid account selected.'
      })
    }

    const target = await Account.findById(accountId)
    if (!target) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Account not found.'
      })
    }
    if (resolveRole(target) === 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Account is already a super admin.'
      })
    }

    const previousRole = String(target.learningRole || 'learner').trim().toLowerCase()
    target.learningRole = 'super_admin'
    target.isSuperAdmin = true
    target.isSystemAdmin = true
    target.roleMetadata = {
      previousLearningRole: LEARNING_ROLES.includes(previousRole) ? previousRole : 'learner',
      lastUpdatedAt: new Date(),
      lastUpdatedBy: req.user._id
    }
    await target.save()

    await logAuditEvent({
      action: 'super_user.promote',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        previousRole,
        nextRole: 'super_admin'
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Super admin privileges granted.'
    })
  } catch (error) {
    console.error('Promote super user (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to promote super user.'
    })
  }
})

pageRouter.post('/admin/super-users/:accountId/demote', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/super-users', '/admin/super-users')
  try {
    const actorRole = resolveRole(req.user)
    if (actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only super admins can demote super users.'
      })
    }

    await assertCurrentPassword({
      accountId: req.user._id,
      password: req.body?.currentPassword
    })

    const accountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid account selected.'
      })
    }

    const target = await Account.findById(accountId)
    if (!target) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Account not found.'
      })
    }
    if (resolveRole(target) !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'Account is not a super admin.'
      })
    }
    if (toIdString(target._id) === toIdString(req.user._id)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You cannot demote yourself from this page.'
      })
    }

    const superAdminCount = await Account.countDocuments({ isSuperAdmin: true })
    if (superAdminCount <= 1) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Cannot demote the last remaining super admin.'
      })
    }

    const fallbackRole = resolveNonPlatformRole(target, 'learner')
    target.learningRole = fallbackRole
    target.isSuperAdmin = false
    target.isSystemAdmin = false
    updateAccountRoleMetadata({
      account: target,
      previousLearningRole: fallbackRole,
      actorId: req.user._id
    })
    await target.save()

    await logAuditEvent({
      action: 'super_user.demote',
      performedBy: req.user._id,
      targetAccount: target._id,
      metadata: {
        restoredRole: fallbackRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Super admin privileges revoked.'
    })
  } catch (error) {
    console.error('Demote super user (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to demote super user.'
    })
  }
})

pageRouter.post('/admin/role-requests/:requestId/approve', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can approve role requests.'
      })
    }

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid role request selected.'
      })
    }

    const roleRequest = await RoleApprovalRequest.findById(requestId)
    if (!roleRequest || String(roleRequest.status || '').trim().toLowerCase() !== 'pending') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Pending role request not found.'
      })
    }

    const approvedRoleRaw = String(req.body?.approvedRole || roleRequest.requestedRole || '').trim().toLowerCase()
    if (!PARTNER_MEMBER_ASSIGNMENT_VALUES.includes(approvedRoleRaw)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid approved role selected.'
      })
    }

    const targetAccount = await Account.findById(roleRequest.account)
    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Target account was not found.'
      })
    }
    const previousTargetRole = resolveRole(targetAccount)

    let organization = null
    const roleRequestOrgId = toIdString(roleRequest.organization)
    if (roleRequestOrgId && mongoose.Types.ObjectId.isValid(roleRequestOrgId)) {
      organization = await Organization.findById(roleRequestOrgId)
    }
    organization = await ensurePartnerOrganizationForRoleAssignment({
      account: targetAccount,
      nextRole: approvedRoleRaw,
      organizationName: roleRequest.organizationName || '',
      actorId: req.user._id,
      organization
    })
    if (organization?._id) {
      roleRequest.organization = organization._id
    }
    await targetAccount.save()

    roleRequest.status = 'approved'
    roleRequest.reviewedBy = req.user._id
    roleRequest.reviewedAt = new Date()
    roleRequest.reviewNotes = String(req.body?.notes || '').trim().slice(0, 3000)
    await roleRequest.save()

    await logAuditEvent({
      action: 'approval.request.approve',
      performedBy: req.user._id,
      targetAccount: targetAccount._id,
      targetOrganization: organization?._id || null,
      metadata: {
        requestId: roleRequest._id,
        approvedRole: approvedRoleRaw
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Role request approved successfully.'
    })
  } catch (error) {
    console.error('Approve role request (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to approve role request.'
    })
  }
})

pageRouter.post('/admin/role-requests/:requestId/reject', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can reject role requests.'
      })
    }

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid role request selected.'
      })
    }

    const roleRequest = await RoleApprovalRequest.findById(requestId)
    if (!roleRequest || String(roleRequest.status || '').trim().toLowerCase() !== 'pending') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Pending role request not found.'
      })
    }

    roleRequest.status = 'rejected'
    roleRequest.reviewedBy = req.user._id
    roleRequest.reviewedAt = new Date()
    roleRequest.reviewNotes = String(req.body?.notes || '').trim().slice(0, 3000)
    await roleRequest.save()

    await logAuditEvent({
      action: 'approval.request.reject',
      performedBy: req.user._id,
      targetAccount: roleRequest.account || null,
      targetOrganization: roleRequest.organization || null,
      metadata: {
        requestId: roleRequest._id,
        notes: roleRequest.reviewNotes
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Role request rejected.'
    })
  } catch (error) {
    console.error('Reject role request (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to reject role request.'
    })
  }
})

pageRouter.post('/admin/partners/:organizationId/status', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update partner status.'
      })
    }

    const organizationId = String(req.params.organizationId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid partner organization selected.'
      })
    }
    const nextStatus = String(req.body?.partnerStatus || req.body?.status || '').trim().toLowerCase()
    if (!['pending', 'active', 'suspended'].includes(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid partner status selected.'
      })
    }

    const organization = await Organization.findById(organizationId)
    if (!organization || organization.partnerType === 'none') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization not found.'
      })
    }

    organization.partnerSettings = organization.partnerSettings || {}
    organization.partnerSettings.partnerStatus = nextStatus
    await organization.save()

    await logAuditEvent({
      action: nextStatus === 'active' ? 'partner.activate' : (nextStatus === 'suspended' ? 'partner.suspend' : 'partner.create'),
      performedBy: req.user._id,
      targetOrganization: organization._id,
      metadata: {
        partnerType: organization.partnerType,
        status: nextStatus
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Partner status updated successfully.'
    })
  } catch (error) {
    console.error('Update partner status (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to update partner status.'
    })
  }
})

pageRouter.post('/admin/partners/:organizationId/members', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can manage partner members.'
      })
    }

    const organizationId = String(req.params.organizationId || '').trim()
    const requestedRole = String(req.body?.role || '').trim().toLowerCase()
    const accountId = String(req.body?.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid organization member.'
      })
    }
    if (!PARTNER_MEMBER_ASSIGNMENT_VALUES.includes(requestedRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid partner role.'
      })
    }

    const organization = await Organization.findById(organizationId)
    if (!organization || organization.partnerType === 'none') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization not found.'
      })
    }

    const targetAccount = await Account.findById(accountId)
    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Target account not found.'
      })
    }

    await ensurePartnerOrganizationForRoleAssignment({
      account: targetAccount,
      nextRole: requestedRole,
      organizationName: organization.name,
      actorId: req.user._id,
      organization
    })
    await targetAccount.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: targetAccount._id,
      targetOrganization: organization._id,
      metadata: {
        source: 'partner_member_add',
        toRole: requestedRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Partner member added successfully.'
    })
  } catch (error) {
    console.error('Add partner member error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to add partner member.'
    })
  }
})

pageRouter.post('/admin/partners/:organizationId/members/:accountId/role', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can manage partner members.'
      })
    }

    const organizationId = String(req.params.organizationId || '').trim()
    const accountId = String(req.params.accountId || '').trim()
    const requestedRole = String(req.body?.role || '').trim().toLowerCase()
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid partner member selected.'
      })
    }
    if (!PARTNER_MEMBER_ASSIGNMENT_VALUES.includes(requestedRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid partner role.'
      })
    }

    const organization = await Organization.findById(organizationId)
    if (!organization || organization.partnerType === 'none') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization not found.'
      })
    }

    const targetAccount = await Account.findById(accountId)
    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Target account not found.'
      })
    }

    const member = (organization.members || []).find((entry) => toIdString(entry.account) === accountId)
    if (!member) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'That account is not currently a member of this organization.'
      })
    }
    if (String(member.role || '').trim().toLowerCase() === 'sales_agent') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Sales agents must be managed from the channel partner dashboard.'
      })
    }

    const previousRole = resolvePartnerDashboardRoleFromOrgMembership({
      organization,
      memberRole: member.role
    })
    await ensurePartnerOrganizationForRoleAssignment({
      account: targetAccount,
      nextRole: requestedRole,
      organizationName: organization.name,
      actorId: req.user._id,
      organization
    })
    await targetAccount.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: targetAccount._id,
      targetOrganization: organization._id,
      metadata: {
        source: 'partner_member_update',
        fromRole: previousRole,
        toRole: requestedRole
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Partner member role updated successfully.'
    })
  } catch (error) {
    console.error('Update partner member role error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to update partner member role.'
    })
  }
})

pageRouter.post('/admin/partners/:organizationId/members/:accountId/remove', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can manage partner members.'
      })
    }

    const organizationId = String(req.params.organizationId || '').trim()
    const accountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid partner member selected.'
      })
    }

    const organization = await Organization.findById(organizationId)
    if (!organization || organization.partnerType === 'none') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner organization not found.'
      })
    }
    if (toIdString(organization.owner) === accountId) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Transfer organization ownership before removing the owner.'
      })
    }

    const targetAccount = await Account.findById(accountId)
    if (!targetAccount) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Target account not found.'
      })
    }

    const member = (organization.members || []).find((entry) => toIdString(entry.account) === accountId)
    if (!member) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'That account is not currently a member of this organization.'
      })
    }

    await removePartnerOrganizationMembership({
      account: targetAccount,
      organization,
      actorId: req.user._id
    })
    await targetAccount.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: targetAccount._id,
      targetOrganization: organization._id,
      metadata: {
        source: 'partner_member_remove',
        fromRole: resolvePartnerDashboardRoleFromOrgMembership({
          organization,
          memberRole: member.role
        }),
        toRole: 'removed'
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Partner member removed successfully.'
    })
  } catch (error) {
    console.error('Remove partner member error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to remove partner member.'
    })
  }
})

pageRouter.post('/admin/agent-commissions/:attributionId/status', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin/partners', '/admin/partners')
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update agent payout statuses.'
      })
    }

    const attributionId = String(req.params.attributionId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(attributionId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid agent commission record selected.'
      })
    }
    const nextStatus = String(req.body?.status || '').trim().toLowerCase()
    if (!['approved', 'paid', 'rejected'].includes(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid commission status selected.'
      })
    }

    const attribution = await AgentSaleAttribution.findById(attributionId)
    if (!attribution) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Agent commission record not found.'
      })
    }
    const currentStatus = String(attribution.status || '').trim().toLowerCase()

    if (nextStatus === 'approved') {
      if (!['recommended', 'pending'].includes(currentStatus)) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'Only pending or recommended commissions can be approved.'
        })
      }
      attribution.status = 'approved'
      attribution.approvedBy = req.user._id
      attribution.approvedAt = new Date()
    } else if (nextStatus === 'paid') {
      if (!['approved', 'recommended'].includes(currentStatus)) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'Only approved commissions can be marked paid.'
        })
      }
      attribution.status = 'paid'
      attribution.approvedBy = attribution.approvedBy || req.user._id
      attribution.approvedAt = attribution.approvedAt || new Date()
      attribution.paidBy = req.user._id
      attribution.paidAt = new Date()
      attribution.transactionRef = String(req.body?.transactionRef || '').trim().slice(0, 160)
    } else {
      if (!['pending', 'recommended', 'approved'].includes(currentStatus)) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'Only open commissions can be rejected.'
        })
      }
      attribution.status = 'rejected'
    }

    attribution.metadata = {
      ...(attribution.metadata || {}),
      adminNote: String(req.body?.adminNotes || '').trim().slice(0, 3000)
    }
    await attribution.save()

    await logAuditEvent({
      action: 'role.change',
      performedBy: req.user._id,
      targetAccount: attribution.agent || null,
      targetOrganization: attribution.partnerOrganization || null,
      metadata: {
        entity: 'agent_commission',
        attributionId: attribution._id,
        fromStatus: currentStatus,
        toStatus: attribution.status,
        transactionRef: attribution.transactionRef || ''
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Agent commission status updated.'
    })
  } catch (error) {
    console.error('Update agent commission status (page route) error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to update agent commission status.'
    })
  }
})

pageRouter.post('/commission/global', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update commission settings.'
      })
    }

    const globalRatePercent = normalizeCommissionRate(req.body.globalRatePercent, 70)
    const settings = await SimpleLmsCommissionSetting.findOne({}) || new SimpleLmsCommissionSetting({})
    settings.globalRatePercent = globalRatePercent
    settings.updatedBy = req.user._id
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Global creator commission set to ${globalRatePercent}%.`
    })
  } catch (error) {
    console.error('Update global commission error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update global commission.'
    })
  }
})

pageRouter.post('/commission/account', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update commission settings.'
      })
    }

    const accountId = String(req.body.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid account.'
      })
    }

    const ratePercent = normalizeCommissionRate(req.body.ratePercent, 70)
    const settings = await SimpleLmsCommissionSetting.findOne({}) || new SimpleLmsCommissionSetting({})
    const existingIndex = (settings.accountOverrides || []).findIndex((entry) => toIdString(entry.account) === accountId)

    if (existingIndex >= 0) {
      settings.accountOverrides[existingIndex].ratePercent = ratePercent
    } else {
      settings.accountOverrides.push({
        account: new mongoose.Types.ObjectId(accountId),
        ratePercent
      })
    }

    settings.updatedBy = req.user._id
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Account commission override saved at ${ratePercent}%.`
    })
  } catch (error) {
    console.error('Update account commission error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update account commission override.'
    })
  }
})

pageRouter.post('/commission/account/remove', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update commission settings.'
      })
    }

    const accountId = String(req.body.accountId || '').trim()
    const settings = await SimpleLmsCommissionSetting.findOne({})
    if (!settings) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'No commission settings found.'
      })
    }

    settings.accountOverrides = (settings.accountOverrides || [])
      .filter((entry) => toIdString(entry.account) !== accountId)
    settings.updatedBy = req.user._id
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Account commission override removed.'
    })
  } catch (error) {
    console.error('Remove account commission error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to remove account commission override.'
    })
  }
})

pageRouter.post('/commission/course', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update commission settings.'
      })
    }

    const courseId = String(req.body.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid course.'
      })
    }

    const ratePercent = normalizeCommissionRate(req.body.ratePercent, 70)
    const settings = await SimpleLmsCommissionSetting.findOne({}) || new SimpleLmsCommissionSetting({})
    const existingIndex = (settings.courseOverrides || []).findIndex((entry) => toIdString(entry.course) === courseId)

    if (existingIndex >= 0) {
      settings.courseOverrides[existingIndex].ratePercent = ratePercent
    } else {
      settings.courseOverrides.push({
        course: new mongoose.Types.ObjectId(courseId),
        ratePercent
      })
    }

    settings.updatedBy = req.user._id
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Course commission override saved at ${ratePercent}%.`
    })
  } catch (error) {
    console.error('Update course commission error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update course commission override.'
    })
  }
})

pageRouter.post('/commission/course/remove', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update commission settings.'
      })
    }

    const courseId = String(req.body.courseId || '').trim()
    const settings = await SimpleLmsCommissionSetting.findOne({})
    if (!settings) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'No commission settings found.'
      })
    }

    settings.courseOverrides = (settings.courseOverrides || [])
      .filter((entry) => toIdString(entry.course) !== courseId)
    settings.updatedBy = req.user._id
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Course commission override removed.'
    })
  } catch (error) {
    console.error('Remove course commission error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to remove course commission override.'
    })
  }
})

pageRouter.post('/settings/profile', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=profile',
    '/simple-lms?view=settings&settingsTab=profile'
  )
  try {
    const displayName = String(req.body.displayName || req.user.profile?.name || '').trim().slice(0, 120)
    const requestedEmail = String(req.body.email || req.user.email || '').trim().toLowerCase().slice(0, 320)
    if (!requestedEmail) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Email address is required.'
      })
    }

    if (requestedEmail !== String(req.user.email || '').trim().toLowerCase()) {
      const existingEmailUser = await Account.exists({
        _id: { $ne: req.user._id },
        email: requestedEmail
      })
      if (existingEmailUser) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'That email address is already in use.'
        })
      }
      req.user.email = requestedEmail
    }

    req.user.profile = req.user.profile || {}
    req.user.profile.name = displayName
    await req.user.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Profile updated successfully.'
    })
  } catch (error) {
    console.error('Update profile settings error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update profile settings.'
    })
  }
})

pageRouter.post('/settings/partner-application', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=profile',
    '/simple-lms?view=settings&settingsTab=profile'
  )
  try {
    const role = resolveRole(req.user)
    if (canManagePlatform(role) || role === 'channel_sales_agent') {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'This account cannot submit a partner application from settings.'
      })
    }

    if (isPartnerDashboardRole(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        info: 'This account already has partner dashboard access.'
      })
    }

    const intent = parsePartnerApplicationIntent(req.body.intent || req.body.partnerIntent || 'partner')
    const organizationName = sanitizePartnerOrganizationName(
      req.body.organizationName || req.body.organization_name || ''
    )

    if (!organizationName) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Organization name is required for partner applications.'
      })
    }

    await createPartnerApprovalRequest({
      account: req.user,
      intent,
      source: 'settings_partner_application',
      organizationName,
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Your partner application has been submitted for admin approval.'
    })
  } catch (error) {
    console.error('Create partner application from settings error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to submit partner application.'
    })
  }
})

pageRouter.post('/settings/creator', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=creator',
    '/simple-lms?view=settings&settingsTab=creator'
  )
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to update creator settings.'
      })
    }

    const currencyCatalog = await getActiveCurrencyCatalog()
    const payload = normalizeCreatorSettings({
      defaultCategory: req.body.defaultCategory,
      defaultLevel: req.body.defaultLevel,
      defaultVisibility: req.body.defaultVisibility,
      defaultPaymentMode: req.body.defaultPaymentMode,
      defaultCurrency: req.body.defaultCurrency,
      preferredLessonDurationMinutes: req.body.preferredLessonDurationMinutes,
      autoLoadSampleCurriculum: req.body.autoLoadSampleCurriculum === 'on',
      autoGenerateCourseSlug: req.body.autoGenerateCourseSlug === 'on',
      defaultLessonMediaType: req.body.defaultLessonMediaType,
      autoSaveDraftMinutes: req.body.autoSaveDraftMinutes,
      publishNotifyByEmail: req.body.publishNotifyByEmail === 'on',
      showSalesDashboard: req.body.showSalesDashboard === 'on',
      showCreatorTips: req.body.showCreatorTips === 'on'
    }, currencyCatalog.codes)

    req.user.creatorSettings = {
      ...(req.user.creatorSettings || {}),
      ...payload,
      updatedAt: new Date()
    }
    await req.user.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Creator studio settings saved.'
    })
  } catch (error) {
    console.error('Update creator settings error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update creator settings.'
    })
  }
})

pageRouter.post('/settings/platform', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update platform settings.'
      })
    }

    const currencyCatalog = await getActiveCurrencyCatalog()
    const currentPlatformSettings = await getPlatformSettings(currencyCatalog.codes)
    const parseCheckboxValue = (value) => (
      Array.isArray(value)
        ? value.includes('on')
        : String(value || '').toLowerCase() === 'on'
    )
    const pickValue = (field) => (
      req.body?.[field] !== undefined
        ? req.body[field]
        : currentPlatformSettings[field]
    )
    const pickBoolean = (field) => (
      req.body?.[field] !== undefined
        ? parseCheckboxValue(req.body[field])
        : Boolean(currentPlatformSettings[field])
    )

    const normalized = normalizePlatformSettings({
      defaultCurrency: pickValue('defaultCurrency'),
      defaultPaymentMode: pickValue('defaultPaymentMode'),
      defaultCourseVisibility: pickValue('defaultCourseVisibility'),
      defaultCourseStatus: pickValue('defaultCourseStatus'),
      requirePublicReviewForCreators: pickBoolean('requirePublicReviewForCreators'),
      allowExternalMediaEmbeds: pickBoolean('allowExternalMediaEmbeds'),
      allowAudioLessons: pickBoolean('allowAudioLessons'),
      minCoursePriceMinor: pickValue('minCoursePriceMinor'),
      maxCoursePriceMinor: pickValue('maxCoursePriceMinor'),
      analyticsLookbackDays: pickValue('analyticsLookbackDays'),
      cartExpiryDays: pickValue('cartExpiryDays'),
      featuredRefreshHours: pickValue('featuredRefreshHours'),
      maxChaptersPerCourse: pickValue('maxChaptersPerCourse'),
      maxLessonsPerChapter: pickValue('maxLessonsPerChapter'),
      allowCourseComments: pickBoolean('allowCourseComments'),
      requireCourseThumbnail: pickBoolean('requireCourseThumbnail'),
      enableWishlist: pickBoolean('enableWishlist'),
      autoApproveSystemCourses: pickBoolean('autoApproveSystemCourses'),
      homepageFeaturedCourseLimit: pickValue('homepageFeaturedCourseLimit'),
      maintenanceMode: pickBoolean('maintenanceMode'),
      maintenanceMessage: pickValue('maintenanceMessage'),
      creatorSubmissionGuidelines: pickValue('creatorSubmissionGuidelines')
    }, currencyCatalog.codes)

    const settings = await SimpleLmsPlatformSetting.findOne({}) || new SimpleLmsPlatformSetting({})
    Object.assign(settings, normalized, { updatedBy: req.user._id })
    await settings.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Platform settings updated.'
    })
  } catch (error) {
    console.error('Update platform settings error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update platform settings.'
    })
  }
})

pageRouter.post('/settings/payment-gateways', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    await applyPaymentGatewaySettingsUpdate({
      req,
      payload: req.body || {}
    })
    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Payment gateway settings updated.'
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    const errorMessage = error?.message || 'Failed to update payment gateway settings.'
    return redirectWithMessage({
      res,
      path: returnTo,
      error: statusCode === 403
        ? 'Only super admins can manage payment gateway settings.'
        : errorMessage
    })
  }
})

pageRouter.post('/admin/payments/:paymentId/reverify', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(req.body?.returnTo || '/admin', '/admin')
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can re-verify payments.'
      })
    }

    const paymentId = String(req.params.paymentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid payment record.'
      })
    }

    const payment = await SimpleLmsPayment.findById(paymentId)
      .populate('course')
    if (!payment || !payment.course) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Payment record not found.'
      })
    }
    if (String(payment.status || '').trim().toLowerCase() === 'successful') {
      await createOrUpdateAgentAttributionForPayment({
        payment,
        course: payment.course
      })
      return redirectWithMessage({
        res,
        path: returnTo,
        success: 'Payment is already verified.'
      })
    }

    const provider = normalizePaymentProvider(payment.provider, 'flutterwave')
    const manualReference = String(req.body?.reference || req.body?.transactionId || '').trim()
    let verificationResult = { success: false, paidAt: new Date() }

    if (provider === 'paystack') {
      const reference = manualReference || payment.paystackReference || payment.txRef
      if (!reference) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'Paystack reference is required for re-verification.'
        })
      }
      verificationResult = await verifyPaystackPaymentRecord({
        payment,
        reference
      })
    } else {
      const transactionId = manualReference || payment.providerTxId || payment.flutterwaveTxId || ''
      if (!transactionId) {
        return redirectWithMessage({
          res,
          path: returnTo,
          error: 'Provider transaction ID is required for re-verification.'
        })
      }
      verificationResult = await verifyFlutterwavePaymentRecord({
        payment,
        transactionId
      })
    }

    if (!verificationResult.success) {
      payment.status = 'failed'
      await payment.save()
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Payment verification mismatch. Record kept as failed.'
      })
    }

    await markPaymentSuccessful({
      payment,
      course: payment.course,
      paidAt: payment.paidAt || verificationResult.paidAt || new Date()
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Payment verified and enrollment unlocked.'
    })
  } catch (error) {
    console.error('Admin payment re-verification error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: error?.message || 'Failed to re-verify payment.'
    })
  }
})

pageRouter.get('/cart', requirePageAuth, async (req, res) => {
  try {
    const [cartState, paymentCheckout] = await Promise.all([
      resolveCartWorkspaceState({
        req,
        accountId: req.user._id
      }),
      buildPaymentGatewayCheckoutState({ req })
    ])
    const { cartCourses, cartSummary } = cartState
    res.locals.simpleLmsCartCount = cartSummary.itemCount
    const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'

    return res.render('simple-lms-cart', {
      title: `${learningName} - Cart`,
      user: req.user,
      activePage: 'simple-lms',
      activeLmsView: 'workspace',
      cartCourses,
      cartSummary,
      paymentCheckout,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Simple LMS cart load error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms',
      error: 'Failed to load cart.'
    })
  }
})

pageRouter.get('/checkout/course/:courseId', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    const course = await findPublicCourseForLearning(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Course not available for checkout.'
      })
    }

    const fallbackPath = sanitizeInternalPath(req.query?.fallback || '/simple-lms?view=catalog', '/simple-lms?view=catalog')
    const nextPath = sanitizeInternalPath(req.query?.next || `/simple-lms/take/${courseId}`, `/simple-lms/take/${courseId}`)
    const checkoutContext = String(req.query?.checkoutContext || '').trim().toLowerCase() === 'cart'
      ? 'cart'
      : 'direct'

    return initiateCoursePaymentCheckout({
      req,
      res,
      course,
      fallbackPath,
      nextPath,
      checkoutContext,
      allowProviderPrompt: true
    })
  } catch (error) {
    console.error('Course checkout page error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
      error: 'Failed to start checkout.'
    })
  }
})

const renderWorkspacePage = async (
  req,
  res,
  { forcedViewMode = '', adminPortal = false, studioPortal = false, studioContext = '', adminSection = '' } = {}
) => {
  try {
    const role = resolveRole(req.user)
    const currencyCatalog = await getActiveCurrencyCatalog()
    const viewMode = forcedViewMode || parseViewMode(req.query.view)
    const resolvedStudioContext = String(
      studioContext || (adminPortal ? 'admin' : 'creator')
    ).trim().toLowerCase() === 'admin'
      ? 'admin'
      : 'creator'
    const selectedAdminSection = adminPortal
      ? parseAdminSection(adminSection || req.query.section || req.path.split('/').filter(Boolean).pop())
      : 'overview'
    const adminBasePath = adminPortal
      ? (selectedAdminSection === 'overview' ? '/admin' : `/admin/${selectedAdminSection}`)
      : '/simple-lms?view=admin'

    if (!adminPortal && viewMode === 'admin') {
      const params = new URLSearchParams(req.query || {})
      params.delete('view')
      const queryString = params.toString()
      return res.redirect(queryString ? `/admin?${queryString}` : '/admin')
    }

    if (!studioPortal && viewMode === 'course-studio') {
      const params = new URLSearchParams(req.query || {})
      params.delete('view')
      const queryString = params.toString()
      return res.redirect(queryString ? `/simple-lms/studio/courses?${queryString}` : '/simple-lms/studio/courses')
    }

    if (adminPortal && !canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms',
        error: 'Only admins can open the admin portal.'
      })
    }
    if (!adminPortal && viewMode === 'cart') {
      const params = new URLSearchParams(req.query || {})
      params.delete('view')
      const queryString = params.toString()
      return res.redirect(queryString ? `/simple-lms/cart?${queryString}` : '/simple-lms/cart')
    }
    const settingsTab = parseSettingsTab(req.query.settingsTab || req.query.tab)
    const creatorSection = settingsTab === 'creator'
      ? parseCreatorSettingsSection(req.query.creatorSection || req.query.creatorTab || req.query.creatorView)
      : 'defaults'
    const query = String(req.query.q || '').trim()
    const categoryFilter = String(req.query.category || '').trim()
    const levelFilter = String(req.query.level || '').trim().toLowerCase()
    const sortFilter = normalizeSort(req.query.sort)
    const editCourseId = String(req.query.editCourse || req.query.edit || '').trim()
    const editProgramId = String(req.query.editProgram || '').trim()
    const sessionCartCourseIds = getSessionCartCourseIds(req)
    const paymentStatusFilter = normalizePaymentStatusFilter(req.query.paymentStatus)
    const paymentCurrencyFilter = (() => {
      const normalized = String(req.query.paymentCurrency || '').trim().toUpperCase()
      if (!normalized || normalized === 'ALL') return 'all'
      return currencyCatalog.codes.includes(normalized) ? normalized : 'all'
    })()
    const paymentFromFilter = String(req.query.paymentFrom || '').trim().slice(0, 32)
    const paymentToFilter = String(req.query.paymentTo || '').trim().slice(0, 32)
    const paymentSearchFilter = String(req.query.paymentSearch || '').trim().slice(0, 200)
    const parsedPaymentFrom = parseDateBoundary(paymentFromFilter, 'start')
    const parsedPaymentTo = parseDateBoundary(paymentToFilter, 'end')
    const creatorFilterCandidate = String(req.query.creatorId || '').trim()
    const adminCreatorFilterId = canManagePlatform(role) && mongoose.Types.ObjectId.isValid(creatorFilterCandidate)
      ? creatorFilterCandidate
      : ''
    const adminCourseStatusFilter = (() => {
      const normalized = String(req.query.courseStatus || '').trim().toLowerCase()
      if (!normalized || normalized === 'all') return 'all'
      return ['draft', 'published', 'archived', 'pending_public_review'].includes(normalized)
        ? normalized
        : 'all'
    })()
    const adminCourseVisibilityFilter = (() => {
      const normalized = String(req.query.courseVisibility || '').trim().toLowerCase()
      if (!normalized || normalized === 'all') return 'all'
      return ['organization_private', 'organization_public', 'system_public'].includes(normalized)
        ? normalized
        : 'all'
    })()
    const adminCourseTypeFilter = (() => {
      const normalized = String(req.query.courseType || '').trim().toLowerCase()
      if (!normalized || normalized === 'all') return 'all'
      return ['system', 'creator'].includes(normalized) ? normalized : 'all'
    })()
    const adminCoursePaymentFilter = (() => {
      const normalized = String(req.query.coursePayment || '').trim().toLowerCase()
      if (!normalized || normalized === 'all') return 'all'
      return ['free', 'paid'].includes(normalized) ? normalized : 'all'
    })()
    const adminCourseSearchFilter = String(req.query.courseSearch || '').trim().slice(0, 200)
    const adminCourseComposeMode = (() => {
      const normalized = String(req.query.compose || req.query.courseCompose || '').trim().toLowerCase()
      return ['1', 'true', 'yes', 'new', 'create'].includes(normalized) ? 'create' : 'manage'
    })()
    const adminPaymentFilter = {}
    if (canManagePlatform(role)) {
      if (paymentStatusFilter !== 'all') adminPaymentFilter.status = paymentStatusFilter
      if (paymentCurrencyFilter !== 'all') adminPaymentFilter.currency = paymentCurrencyFilter
      if (parsedPaymentFrom || parsedPaymentTo) {
        adminPaymentFilter.createdAt = {}
        if (parsedPaymentFrom) adminPaymentFilter.createdAt.$gte = parsedPaymentFrom
        if (parsedPaymentTo) adminPaymentFilter.createdAt.$lte = parsedPaymentTo
      }
    }
    const adminPaymentsReturnTo = buildAdminPaymentsReturnTo({
      status: paymentStatusFilter,
      currency: paymentCurrencyFilter,
      dateFrom: paymentFromFilter,
      dateTo: paymentToFilter,
      search: paymentSearchFilter,
      basePath: adminBasePath
    })
    const adminCoursesReturnTo = buildAdminCoursesReturnTo({
      creatorId: adminCreatorFilterId,
      status: adminCourseStatusFilter,
      visibility: adminCourseVisibilityFilter,
      courseType: adminCourseTypeFilter,
      paymentMode: adminCoursePaymentFilter,
      search: adminCourseSearchFilter,
      basePath: '/admin/courses'
    })
    const adminCreatorsReturnTo = buildAdminCreatorReturnTo({
      creatorId: adminCreatorFilterId,
      basePath: '/admin/creators'
    })

    const catalogFilter = {
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    }
    if (query) {
      const safeQuery = escapeRegExp(query)
      catalogFilter.$or = [
        { title: { $regex: safeQuery, $options: 'i' } },
        { summary: { $regex: safeQuery, $options: 'i' } },
        { description: { $regex: safeQuery, $options: 'i' } },
        { category: { $regex: safeQuery, $options: 'i' } }
      ]
    }
    if (categoryFilter) catalogFilter.category = categoryFilter
    if (LEVELS.includes(levelFilter)) catalogFilter.level = levelFilter

    const programCatalogFilter = {
      status: 'published',
      visibility: { $in: PROGRAM_VISIBILITY_VALUES }
    }
    if (query) {
      const safeQuery = escapeRegExp(query)
      programCatalogFilter.$or = [
        { name: { $regex: safeQuery, $options: 'i' } },
        { description: { $regex: safeQuery, $options: 'i' } },
        { objective: { $regex: safeQuery, $options: 'i' } }
      ]
    }

    const isCreatorStudioContext = studioPortal && resolvedStudioContext === 'creator'
    const partnerOrgId = toIdString(req.user?.partnerOrganization)
    const partnerScopedFilter = (baseFilter = {}) => {
      if (!partnerOrgId) return { ...baseFilter, createdBy: req.user._id }
      if (isPartnerSuperRole(role)) return { ...baseFilter, organization: partnerOrgId }
      if (isPartnerUserRole(role)) return { ...baseFilter, organization: partnerOrgId, createdBy: req.user._id }
      return { ...baseFilter, createdBy: req.user._id }
    }

    const managedFilter = canManagePlatform(role) && !isCreatorStudioContext
      ? {}
      : partnerScopedFilter({})
    const managedProgramFilter = canManagePlatform(role) && !isCreatorStudioContext
      ? {}
      : partnerScopedFilter({})

    const [catalogRaw, managedRaw, myEnrollmentsRaw, categoriesRaw, totalAccounts, totalCreators, completedEnrollments, adminAccountsRaw, totalPublishedCourses, catalogProgramsRaw, managedProgramsRaw, totalPublishedPrograms, assignableAccountsRaw, myPaymentsRaw, adminPaymentsRaw, pendingReviewCoursesRaw, commissionSettingsRaw, platformSettingsRaw, paymentGatewaySettingsRaw, creatorEarningsAggregateRaw, creatorWithdrawalAggregateRaw, creatorWithdrawalRequestsRaw, adminWithdrawalRequestsRaw, partnerOrganizationsRaw, roleApprovalRequestsRaw, superUsersRaw, adminInvitesRaw, auditLogEntriesRaw, agentPayoutRowsRaw] = await Promise.all([
      SimpleLmsCourse.find(catalogFilter)
        .sort(mapSortToMongo(sortFilter))
        .limit(240)
        .lean(),
      canCreateCourses(role)
        ? SimpleLmsCourse.find({ ...managedFilter })
          .populate('reviewedBy', 'email profile.name')
          .sort({ updatedAt: -1 })
          .limit(240)
          .lean()
        : Promise.resolve([]),
      SimpleLmsEnrollment.find({ enrolledMember: req.user._id })
        .populate('course')
        .populate('program')
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsCourse.distinct('category', {
        isActive: true,
        status: 'published',
        visibility: { $in: PUBLIC_VISIBILITY_VALUES },
        category: { $exists: true, $nin: ['', null] }
      }),
      Account.countDocuments({}),
      SimpleLmsCourse.distinct('createdBy', { isActive: true })
        .then((ids) => Array.isArray(ids) ? ids.length : 0),
      SimpleLmsEnrollment.countDocuments({ status: 'completed' }),
      canManagePlatform(role)
        ? Account.find({})
          .select('email profile.name learningRole isSystemAdmin isSuperAdmin createdAt payoutProfile partnerOrganization currentOrganization organizations roleMetadata')
          .populate('partnerOrganization', 'name partnerType partnerSettings.partnerStatus')
          .sort({ createdAt: -1 })
          .limit(500)
          .lean()
        : Promise.resolve([]),
      SimpleLmsCourse.countDocuments({
        isActive: true,
        status: 'published',
        visibility: { $in: PUBLIC_VISIBILITY_VALUES }
      }),
      SimpleLmsProgram.find(programCatalogFilter)
        .sort({ updatedAt: -1 })
        .limit(180)
        .lean(),
      canCreateCourses(role)
        ? SimpleLmsProgram.find(managedProgramFilter)
          .sort({ updatedAt: -1 })
          .limit(180)
          .lean()
        : Promise.resolve([]),
      SimpleLmsProgram.countDocuments({
        status: 'published',
        visibility: { $in: PROGRAM_VISIBILITY_VALUES }
      }),
      canCreateCourses(role)
        ? Account.find({})
          .select('email profile.name')
          .sort({ createdAt: -1 })
          .limit(300)
          .lean()
        : Promise.resolve([]),
      SimpleLmsPayment.find({
        account: req.user._id,
        status: 'successful'
      })
        .select('course amountMinor currency paidAt txRef provider providerTxId flutterwaveTxId paystackReference')
        .populate('course', 'title')
        .sort({ paidAt: -1, createdAt: -1 })
        .lean(),
      canManagePlatform(role)
        ? SimpleLmsPayment.find(adminPaymentFilter)
          .populate('account', 'email profile.name')
          .populate('course', 'title')
          .sort({ createdAt: -1 })
          .limit(500)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? SimpleLmsCourse.find({
          status: 'pending_public_review',
          isActive: true
        })
          .populate('createdBy', 'email profile.name')
          .sort({ submittedForPublicReviewAt: -1, updatedAt: -1 })
          .limit(200)
          .lean()
        : Promise.resolve([]),
      getCommissionSettings(),
      getPlatformSettings(currencyCatalog.codes),
      buildPaymentGatewaySettingsResponse({ req, includeCredentialMeta: isSuperAdminRole(role) }),
      canCreateCourses(role)
        ? SimpleLmsPayment.aggregate([
          {
            $match: canManagePlatform(role)
              ? { status: 'successful', creatorAccount: { $ne: null } }
              : { status: 'successful', creatorAccount: req.user._id }
          },
          {
            $group: {
              _id: '$creatorAccount',
              soldMinor: { $sum: '$amountMinor' },
              saleCount: { $sum: 1 },
              earningsMinor: { $sum: '$creatorCommissionMinor' },
              platformShareMinor: { $sum: '$platformShareMinor' }
            }
          }
        ])
        : Promise.resolve([]),
      canCreateCourses(role)
        ? SimpleLmsWithdrawal.aggregate([
          {
            $match: canManagePlatform(role)
              ? {}
              : { creatorAccount: req.user._id }
          },
          {
            $group: {
              _id: '$creatorAccount',
              requestCount: { $sum: 1 },
              requestedMinor: { $sum: '$amountMinor' },
              pendingMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved']] }, '$amountMinor', 0] } },
              approvedMinor: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amountMinor', 0] } },
              paidMinor: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountMinor', 0] } },
              rejectedMinor: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, '$amountMinor', 0] } },
              cancelledMinor: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, '$amountMinor', 0] } },
              latestRequestedAt: { $max: '$requestedAt' }
            }
          }
        ])
        : Promise.resolve([]),
      canCreateCourses(role)
        ? SimpleLmsWithdrawal.find({ creatorAccount: req.user._id })
          .populate('reviewedBy', 'email profile.name')
          .populate('paidBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(120)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? SimpleLmsWithdrawal.find({})
          .populate('creatorAccount', 'email profile.name payoutProfile')
          .populate('reviewedBy', 'email profile.name')
          .populate('paidBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(400)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? Organization.find({
          partnerType: { $in: ['channel_partner', 'partner'] }
        })
          .populate('owner', 'email profile.name learningRole isSystemAdmin isSuperAdmin partnerOrganization currentOrganization organizations roleMetadata')
          .populate('members.account', 'email profile.name learningRole isSystemAdmin isSuperAdmin partnerOrganization currentOrganization organizations roleMetadata')
          .sort({ updatedAt: -1 })
          .limit(300)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? RoleApprovalRequest.find({})
          .populate('account', 'email profile.name')
          .populate('organization', 'name partnerType partnerSettings.partnerStatus')
          .populate('reviewedBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(300)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? Account.find({ isSuperAdmin: true })
          .select('_id email profile.name roleMetadata createdAt updatedAt')
          .sort({ createdAt: 1 })
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? AdminInvite.find({})
          .populate('invitedBy', 'email profile.name')
          .populate('registeredAccount', 'email profile.name emailVerified')
          .populate('acceptedBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(300)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? AuditLog.find({})
          .populate('performedBy', 'email profile.name learningRole isSystemAdmin isSuperAdmin partnerOrganization currentOrganization organizations roleMetadata')
          .populate('performedBy.partnerOrganization', 'name partnerType partnerSettings.partnerStatus')
          .populate('targetAccount', 'email profile.name learningRole isSystemAdmin isSuperAdmin partnerOrganization currentOrganization organizations roleMetadata')
          .populate('targetAccount.partnerOrganization', 'name partnerType partnerSettings.partnerStatus')
          .populate('targetOrganization', 'name partnerType')
          .sort({ createdAt: -1 })
          .limit(600)
          .lean()
        : Promise.resolve([]),
      canManagePlatform(role)
        ? AgentSaleAttribution.find({
          status: { $in: ['pending', 'recommended', 'approved'] }
        })
          .populate('agent', 'email profile.name payoutProfile')
          .populate('course', 'title')
          .populate('partnerOrganization', 'name partnerType')
          .populate('recommendedBy', 'email profile.name')
          .populate('approvedBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(500)
          .lean()
        : Promise.resolve([])
    ])

    const [partnerWithdrawalRequestsRaw, partnerWithdrawalAggregateRaw, partnerRevenueAggregateRaw] = canManagePlatform(role)
      ? await Promise.all([
        PartnerWithdrawal.find({})
          .populate('organization', 'name partnerType partnerSettings')
          .populate('requestedBy', 'email profile.name')
          .populate('reviewedBy', 'email profile.name')
          .populate('paidBy', 'email profile.name')
          .sort({ createdAt: -1 })
          .limit(400)
          .lean(),
        PartnerWithdrawal.aggregate([
          {
            $group: {
              _id: '$organization',
              requestCount: { $sum: 1 },
              pendingMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'approved']] }, '$amountMinor', 0] } },
              paidMinor: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountMinor', 0] } },
              latestRequestedAt: { $max: '$createdAt' }
            }
          }
        ]),
        AgentSaleAttribution.aggregate([
          {
            $group: {
              _id: '$partnerOrganization',
              totalSalesMinor: { $sum: { $ifNull: ['$saleAmountMinor', 0] } },
              totalAgentCommissionMinor: { $sum: { $ifNull: ['$commissionAmountMinor', 0] } },
              partnerEarningsMinor: { $sum: buildPartnerRevenueExpression() }
            }
          }
        ])
      ])
      : [[], [], []]

    const [latestPartnerRoleRequestRaw, currentPartnerOrganizationRaw] = await Promise.all([
      RoleApprovalRequest.findOne({
        account: req.user._id,
        requestType: 'partner_role_activation'
      })
        .populate('organization', 'name partnerType partnerSettings.partnerStatus')
        .populate('reviewedBy', 'email profile.name')
        .sort({ createdAt: -1 })
        .lean(),
      mongoose.Types.ObjectId.isValid(String(req.user?.partnerOrganization || ''))
        ? Organization.findById(req.user.partnerOrganization)
          .select('name partnerType partnerSettings.partnerStatus')
          .lean()
        : Promise.resolve(null)
    ])

    const myEnrollments = myEnrollmentsRaw
      .filter(entry => entry.course && entry.course.isActive)
      .map((entry) => {
        const lessons = flattenCourseLessons(entry.course)
        const progress = calculateProgress({ lessons, completedLessonKeys: entry.completedLessonKeys || [] })
        const completedDurationMinutes = lessons
          .filter((lesson) => progress.completedSet.has(lesson.lessonKey))
          .reduce((sum, lesson) => sum + Math.max(0, Number(lesson.durationMinutes || 0)), 0)
        const totalDurationMinutes = lessons
          .reduce((sum, lesson) => sum + Math.max(0, Number(lesson.durationMinutes || 0)), 0)
        const fallbackEstimatedDuration = Math.max(0, Number(entry.course?.estimatedDurationMinutes || 0))
        return {
          ...entry,
          course: decorateCourse(entry.course),
          lessonCount: progress.lessonCount,
          completedCount: progress.completedCount,
          completedDurationMinutes,
          totalDurationMinutes: totalDurationMinutes > 0 ? totalDurationMinutes : fallbackEstimatedDuration,
          progressPercent: Number.isFinite(Number(entry.progressPercent)) ? Number(entry.progressPercent) : progress.progressPercent,
          nextLessonKey: progress.nextLessonKey,
          isCompleted: progress.isCompleted,
          lastActivityAt: entry.lastActivityAt || entry.updatedAt || entry.createdAt || new Date()
        }
      })

    const programStepCourseIds = new Set()
    const allProgramSources = [...catalogProgramsRaw, ...managedProgramsRaw]
    allProgramSources.forEach((program) => {
      ;(program.steps || []).forEach((step) => {
        const courseId = toIdString(step?.course)
        if (mongoose.Types.ObjectId.isValid(courseId)) {
          programStepCourseIds.add(courseId)
        }
      })
    })

    const programCoursesRaw = programStepCourseIds.size > 0
      ? await SimpleLmsCourse.find({
        _id: { $in: Array.from(programStepCourseIds) },
        isActive: true
      }).lean()
      : []

    const programCourseMap = new Map(
      programCoursesRaw.map(course => [toIdString(course._id), decorateCourse(course)])
    )

    const enrolledCourseIds = new Set(myEnrollments.map(item => toIdString(item.course?._id)))
    const paidCourseIds = new Set((myPaymentsRaw || []).map((payment) => toIdString(payment.course)))
    const cartCoursesRaw = sessionCartCourseIds.length > 0
      ? await SimpleLmsCourse.find({
        _id: { $in: sessionCartCourseIds.filter((courseId) => mongoose.Types.ObjectId.isValid(courseId)) },
        isActive: true,
        status: 'published',
        visibility: { $in: PUBLIC_VISIBILITY_VALUES }
      }).lean()
      : []

    const cartRawMap = new Map(cartCoursesRaw.map((course) => [toIdString(course._id), course]))
    const cartCoursesBase = sessionCartCourseIds
      .map((courseId) => cartRawMap.get(courseId))
      .filter(Boolean)
      .map((course) => {
        const decoratedCourse = decorateCourse(course)
        const courseId = toIdString(course._id)
        const requiresPayment = isCoursePaidContent(course)
        const isPaid = paidCourseIds.has(courseId)
        const isEnrolled = enrolledCourseIds.has(courseId)
        return {
          ...decoratedCourse,
          requiresPayment,
          isPaid,
          isEnrolled,
          canStart: !requiresPayment || isPaid || isEnrolled
        }
      })
      .filter((course) => course.requiresPayment && !course.isPaid)

    const cleanedCartCourseIds = cartCoursesBase.map((course) => toIdString(course._id))
    setSessionCartCourseIds(req, cleanedCartCourseIds)
    const cartCourseIdSet = new Set(cleanedCartCourseIds)

    const cartTotalsByCurrencyMap = new Map()
    for (const course of cartCoursesBase) {
      const currency = normalizeCurrencyCode(course?.pricing?.currency || 'NGN')
      const existing = cartTotalsByCurrencyMap.get(currency) || 0
      const amountMinor = Math.max(0, Math.round(Number(course?.pricing?.amount || 0)))
      cartTotalsByCurrencyMap.set(currency, existing + amountMinor)
    }
    const cartTotalsByCurrency = Array.from(cartTotalsByCurrencyMap.entries()).map(([currency, amountMinor]) => ({
      currency,
      amountMinor,
      amountDisplay: formatCurrencyAmount(amountMinor, currency)
    }))
    const cartSummary = {
      itemCount: cartCoursesBase.length,
      totalsByCurrency: cartTotalsByCurrency,
      hasItems: cartCoursesBase.length > 0
    }

    const catalogCourses = catalogRaw.map((course) => {
      const decoratedCourse = decorateCourse(course)
      const courseId = toIdString(course._id)
      const requiresPayment = isCoursePaidContent(course)
      const isPaid = paidCourseIds.has(courseId)
      const isEnrolled = enrolledCourseIds.has(courseId)
      return {
        ...decoratedCourse,
        requiresPayment,
        isPaid,
        isEnrolled,
        isInCart: cartCourseIdSet.has(courseId),
        canStart: !requiresPayment || isPaid || isEnrolled
      }
    })
    const recommendedCourses = catalogCourses.filter(course => !course.isEnrolled).slice(0, 8)
    const inProgressEnrollments = myEnrollments
      .filter((entry) => !entry.isCompleted)
      .sort((a, b) => {
        const bTime = new Date(b.lastActivityAt || b.updatedAt || b.createdAt || Date.now()).getTime()
        const aTime = new Date(a.lastActivityAt || a.updatedAt || a.createdAt || Date.now()).getTime()
        return bTime - aTime
      })
    const continueLearningCards = inProgressEnrollments
      .map((entry) => {
        const estimatedDuration = Math.max(0, Number(entry.totalDurationMinutes || entry.course?.estimatedDurationMinutes || 0))
        const completedDuration = Math.max(0, Number(entry.completedDurationMinutes || 0))
        const remainingMinutes = estimatedDuration > 0
          ? Math.max(0, Math.round(estimatedDuration - completedDuration))
          : 0
        const resumePath = entry.nextLessonKey
          ? `/simple-lms/learn/${entry._id}/${encodeURIComponent(entry.nextLessonKey)}`
          : '/simple-lms?view=my-learning'
        return {
          ...entry,
          resumePath,
          remainingMinutes,
          activityAt: entry.lastActivityAt || entry.updatedAt || entry.createdAt || new Date()
        }
      })
      .slice(0, 2)

    const inProgressCourseIdSet = new Set(inProgressEnrollments.map((entry) => toIdString(entry.course?._id)))
    let recommendedLearningCards = catalogCourses
      .filter((course) => !inProgressCourseIdSet.has(toIdString(course._id)))
      .slice(0, 3)
    if (recommendedLearningCards.length === 0) {
      recommendedLearningCards = catalogCourses.slice(0, 3)
    }

    const lessonsCompletedTotal = myEnrollments.reduce((sum, enrollment) => sum + Math.max(0, Number(enrollment.completedCount || 0)), 0)
    const hoursLearnedMinutes = myEnrollments.reduce((sum, enrollment) => sum + Math.max(0, Number(enrollment.completedDurationMinutes || 0)), 0)
    const hoursLearned = Math.round((hoursLearnedMinutes / 60) * 10) / 10
    const activityDaySet = new Set(
      myEnrollments
        .map((enrollment) => {
          const value = enrollment.lastActivityAt || enrollment.updatedAt || enrollment.createdAt
          if (!value) return ''
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) return ''
          return date.toISOString().slice(0, 10)
        })
        .filter(Boolean)
    )
    const today = new Date()
    let currentStreakDays = 0
    for (let i = 0; i < 60; i += 1) {
      const probeDate = new Date(today)
      probeDate.setHours(0, 0, 0, 0)
      probeDate.setDate(probeDate.getDate() - i)
      const probeKey = probeDate.toISOString().slice(0, 10)
      if (!activityDaySet.has(probeKey)) break
      currentStreakDays += 1
    }
    if (currentStreakDays <= 0 && inProgressEnrollments.length > 0) {
      currentStreakDays = 1
    }
    const workspaceStats = {
      coursesEnrolled: myEnrollments.length,
      coursesInProgress: inProgressEnrollments.length,
      lessonsCompleted: lessonsCompletedTotal,
      hoursLearned,
      currentStreakDays
    }

    const managedCourseIdList = managedRaw.map((course) => course._id).filter(Boolean)
    const managedCourseProgramReferenceRaw = isSuperAdminRole(role) && managedCourseIdList.length > 0
      ? await SimpleLmsProgram.aggregate([
        { $match: { 'steps.course': { $in: managedCourseIdList } } },
        { $unwind: '$steps' },
        { $match: { 'steps.course': { $in: managedCourseIdList } } },
        {
          $group: {
            _id: '$steps.course',
            count: { $sum: 1 }
          }
        }
      ])
      : []
    const managedCoursePaymentReferenceRaw = isSuperAdminRole(role) && managedCourseIdList.length > 0
      ? await SimpleLmsPayment.aggregate([
        {
          $match: {
            course: { $in: managedCourseIdList },
            status: 'successful'
          }
        },
        {
          $group: {
            _id: '$course',
            count: { $sum: 1 }
          }
        }
      ])
      : []
    const programReferenceCountByCourseId = new Map(
      (managedCourseProgramReferenceRaw || []).map((entry) => [
        toIdString(entry?._id),
        Math.max(0, Number(entry?.count || 0))
      ])
    )
    const successfulPaymentCountByCourseId = new Map(
      (managedCoursePaymentReferenceRaw || []).map((entry) => [
        toIdString(entry?._id),
        Math.max(0, Number(entry?.count || 0))
      ])
    )
    const decorateManagedCourseForActor = (course) => {
      const decoratedCourse = decorateCourse(course)
      return {
        ...decoratedCourse,
        ...buildCourseActionPermissions({
          role,
          accountId: req.user._id,
          course: decoratedCourse,
          partnerOrganizationId: req.user.partnerOrganization,
          programReferenceCount: programReferenceCountByCourseId.get(toIdString(decoratedCourse._id)) || 0,
          successfulPaymentCount: successfulPaymentCountByCourseId.get(toIdString(decoratedCourse._id)) || 0
        })
      }
    }
    const managedCourses = managedRaw.map((course) => decorateManagedCourseForActor(course))
    const catalogProgramsDecorated = catalogProgramsRaw.map(program => decorateProgram(program, programCourseMap))
    const managedPrograms = managedProgramsRaw.map(program => decorateProgram(program, programCourseMap))

    let editingCourse = null
    if (editCourseId && mongoose.Types.ObjectId.isValid(editCourseId) && canCreateCourses(role)) {
      const candidate = managedCourses.find((course) => toIdString(course._id) === editCourseId)
      if (candidate?.canEdit) {
        editingCourse = candidate
      }
    }

    let editingProgram = null
    if (editProgramId && mongoose.Types.ObjectId.isValid(editProgramId) && canCreateCourses(role)) {
      const candidate = managedProgramsRaw.find(program => toIdString(program._id) === editProgramId)
      if (candidate) {
        editingProgram = decorateProgram(candidate, programCourseMap)
      }
    }

    const myProgramsMap = new Map()
    myEnrollments.forEach((entry) => {
      const programId = toIdString(entry.program?._id || entry.program)
      if (!programId || !mongoose.Types.ObjectId.isValid(programId)) return

      const rawProgram = entry.program && typeof entry.program === 'object'
        ? entry.program
        : managedProgramsRaw.find(item => toIdString(item._id) === programId)
          || catalogProgramsRaw.find(item => toIdString(item._id) === programId)

      if (!rawProgram) return

      const existing = myProgramsMap.get(programId) || {
        program: decorateProgram(rawProgram, programCourseMap),
        totalCourses: 0,
        completedCourses: 0,
        nextEnrollmentId: '',
        nextLessonKey: '',
        lastActivityAt: null
      }

      existing.totalCourses += 1
      if (entry.isCompleted) {
        existing.completedCourses += 1
      } else if (!existing.nextEnrollmentId) {
        existing.nextEnrollmentId = toIdString(entry._id)
        existing.nextLessonKey = String(entry.nextLessonKey || '')
      }

      const activityTs = new Date(entry.lastActivityAt || entry.updatedAt || Date.now()).getTime()
      if (!existing.lastActivityAt || activityTs > existing.lastActivityAt) {
        existing.lastActivityAt = activityTs
      }

      myProgramsMap.set(programId, existing)
    })

    const myPrograms = Array.from(myProgramsMap.values())
      .map((item) => ({
        ...item,
        progressPercent: item.totalCourses > 0
          ? Math.round((item.completedCourses / item.totalCourses) * 100)
          : 0,
        nextEnrollmentId: item.nextEnrollmentId || '',
        nextLessonKey: item.nextLessonKey || ''
      }))
      .sort((a, b) => Number(b.lastActivityAt || 0) - Number(a.lastActivityAt || 0))

    const enrolledProgramIds = new Set(myPrograms.map(item => toIdString(item.program?._id)))
    const catalogPrograms = catalogProgramsDecorated.map((program) => ({
      ...program,
      isEnrolled: enrolledProgramIds.has(toIdString(program._id))
    }))
    const recommendedPrograms = catalogPrograms.filter(program => !program.isEnrolled).slice(0, 6)

    const adminAccounts = adminAccountsRaw.map((account) => {
      const partnerOrganizationId = toIdString(account.partnerOrganization)
      const membership = Array.isArray(account.organizations)
        ? account.organizations.find((entry) => (
          entry?.isActive !== false && toIdString(entry.organization) === partnerOrganizationId
        ))
        : null
      const snapshotMemberRole = membership?.role || (
        partnerOrganizationId && isDirectPartnerRoleUpdate(account.learningRole)
          ? mapLearningRoleToPartnerMemberRole(account.learningRole)
          : ''
      )
      const accessProfileSnapshot = buildAccessProfileSnapshot(account, {
        organization: account.partnerOrganization || null,
        memberRole: snapshotMemberRole
      })
      const accessDisplayRole = accessProfileSnapshot.platformRole
        || accessProfileSnapshot.partnerAccess?.dashboardRole
        || accessProfileSnapshot.agentAccess?.dashboardRole
        || accessProfileSnapshot.baseLearningRole
      return {
        ...account,
        accessProfile: accessProfileSnapshot,
        resolvedRole: accessDisplayRole,
        roleSelectValue: accessProfileSnapshot.platformRole || accessProfileSnapshot.baseLearningRole,
        displayName: account.profile?.name || account.email || 'User',
        partnerOrganizationName: account.partnerOrganization?.name || '',
        partnerOrganizationType: String(account.partnerOrganization?.partnerType || '').trim().toLowerCase(),
        partnerOrganizationStatus: String(account.partnerOrganization?.partnerSettings?.partnerStatus || '').trim().toLowerCase(),
        partnerDashboardRole: accessProfileSnapshot.partnerAccess?.dashboardRole || '',
        agentDashboardRole: accessProfileSnapshot.agentAccess?.dashboardRole || '',
        platformRole: accessProfileSnapshot.platformRole || ''
      }
    })

    const roleBreakdown = {
      super_admin: adminAccounts.filter(account => account.platformRole === 'super_admin').length,
      admin: adminAccounts.filter(account => account.platformRole === 'admin').length,
      creator: adminAccounts.filter(account => account.roleSelectValue === 'creator').length,
      learner: adminAccounts.filter(account => account.roleSelectValue === 'learner').length,
      channel_partner_super: adminAccounts.filter(account => account.partnerDashboardRole === 'channel_partner_super').length,
      channel_partner_user: adminAccounts.filter(account => account.partnerDashboardRole === 'channel_partner_user').length,
      partner_super: adminAccounts.filter(account => account.partnerDashboardRole === 'partner_super').length,
      partner_user: adminAccounts.filter(account => account.partnerDashboardRole === 'partner_user').length,
      channel_sales_agent: adminAccounts.filter(account => account.agentDashboardRole === 'channel_sales_agent').length
    }

    const studioCourseMap = new Map()
    for (const course of [...managedCourses, ...catalogCourses]) {
      studioCourseMap.set(toIdString(course._id), course)
    }
    const studioCourses = Array.from(studioCourseMap.values())
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))

    const assignableAccounts = assignableAccountsRaw.map((account) => ({
      ...account,
      displayName: account.profile?.name || account.email || 'Learner'
    }))

    const myPayments = (myPaymentsRaw || []).map((payment) => ({
      ...payment,
      courseTitle: payment.course?.title || toIdString(payment.course),
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency),
      provider: normalizePaymentProvider(payment.provider, 'flutterwave'),
      providerLabel: PAYMENT_PROVIDER_COPY[normalizePaymentProvider(payment.provider, 'flutterwave')]?.label || 'Flutterwave',
      providerReference: payment.providerTxId || payment.flutterwaveTxId || payment.paystackReference || ''
    }))

    const creatorSalesRaw = managedCourseIdList.length > 0
      ? await SimpleLmsPayment.find({
        status: 'successful',
        course: { $in: managedCourseIdList }
      })
        .populate('account', 'email profile.name')
        .populate('course', 'title createdBy')
        .sort({ paidAt: -1, createdAt: -1 })
        .limit(400)
        .lean()
      : []
    const creatorSaleAttributionRaw = creatorSalesRaw.length > 0
      ? await AgentSaleAttribution.find({
        payment: { $in: creatorSalesRaw.map((payment) => payment._id) }
      })
        .select('payment commissionAmountMinor agent')
        .populate('agent', 'email profile.name')
        .lean()
      : []
    const creatorSaleAttributionByPaymentId = new Map(
      creatorSaleAttributionRaw
        .map((entry) => {
          const paymentId = toIdString(entry.payment)
          if (!paymentId) return null
          return [paymentId, entry]
        })
        .filter(Boolean)
    )

    const commissionSettings = {
      globalRatePercent: normalizeCommissionRate(commissionSettingsRaw?.globalRatePercent, 70),
      accountOverrides: Array.isArray(commissionSettingsRaw?.accountOverrides) ? commissionSettingsRaw.accountOverrides : [],
      courseOverrides: Array.isArray(commissionSettingsRaw?.courseOverrides) ? commissionSettingsRaw.courseOverrides : []
    }
    const platformSettings = normalizePlatformSettings(platformSettingsRaw || PLATFORM_SETTING_DEFAULTS, currencyCatalog.codes)
    const paymentGatewaySettings = paymentGatewaySettingsRaw || await buildPaymentGatewaySettingsResponse({ req })
    const canManagePaymentGateways = isSuperAdminRole(role)
    const creatorSettings = normalizeCreatorSettings(req.user.creatorSettings || CREATOR_SETTING_DEFAULTS, currencyCatalog.codes)

    const creatorSales = creatorSalesRaw.map((payment) => {
      const creatorId = toIdString(payment.creatorAccount || payment.course?.createdBy || '')
      const defaultRate = resolveCommissionRate({
        settings: commissionSettings,
        creatorId,
        courseId: payment.course?._id || payment.course
      })
      const hasStoredRate = Number.isFinite(Number(payment.creatorCommissionRate))
      const finalRate = hasStoredRate
        ? normalizeCommissionRate(payment.creatorCommissionRate, defaultRate)
        : defaultRate
      const split = splitCommission({
        amountMinor: payment.amountMinor,
        ratePercent: finalRate
      })
      const creatorCommissionMinor = hasStoredRate
        ? Math.max(0, Math.round(Number(payment.creatorCommissionMinor || 0)))
        : split.creatorCommissionMinor
      const platformShareMinor = hasStoredRate
        ? Math.max(0, Math.round(Number(payment.platformShareMinor || 0)))
        : split.platformShareMinor
      const attribution = creatorSaleAttributionByPaymentId.get(toIdString(payment._id))
      const agentCommissionMinor = Math.max(0, Math.round(Number(attribution?.commissionAmountMinor || 0)))
      const netPlatformMinor = Math.max(0, platformShareMinor - agentCommissionMinor)

      return {
        ...payment,
        creatorId,
        buyerName: payment.account?.profile?.name || payment.account?.email || 'Learner',
        buyerEmail: payment.account?.email || '',
        courseTitle: payment.course?.title || 'Course',
        amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency),
        creatorCommissionRateDisplay: `${finalRate}%`,
        creatorCommissionMinor,
        creatorCommissionDisplay: formatCurrencyAmount(creatorCommissionMinor, payment.currency),
        platformShareMinor,
        platformShareDisplay: formatCurrencyAmount(platformShareMinor, payment.currency),
        agentName: attribution?.agent?.profile?.name || attribution?.agent?.email || '',
        agentCommissionMinor,
        agentCommissionDisplay: formatCurrencyAmount(agentCommissionMinor, payment.currency),
        netPlatformMinor,
        netPlatformDisplay: formatCurrencyAmount(netPlatformMinor, payment.currency)
      }
    })
    const creatorSalesTraceById = new Map()
    creatorSales.forEach((sale) => {
      const creatorId = String(sale.creatorId || '').trim()
      if (!creatorId) return
      const existing = creatorSalesTraceById.get(creatorId) || []
      existing.push(sale)
      creatorSalesTraceById.set(creatorId, existing)
    })
    creatorSalesTraceById.forEach((entries, creatorId) => {
      entries.sort((left, right) => new Date(right.paidAt || right.createdAt || 0).getTime() - new Date(left.paidAt || left.createdAt || 0).getTime())
      creatorSalesTraceById.set(creatorId, entries)
    })

    const myManagedCourseIdSet = new Set(
      managedRaw
        .filter((course) => toIdString(course.createdBy) === toIdString(req.user._id))
        .map((course) => toIdString(course._id))
    )
    const effectiveManagedCourseIds = myManagedCourseIdSet

    const myCreatorSales = creatorSales
      .filter((sale) => effectiveManagedCourseIds.has(toIdString(sale.course?._id || sale.course)))
      .slice(0, 120)

    const creatorStats = {
      saleCount: myCreatorSales.length,
      uniqueLearnerCount: new Set(myCreatorSales.map((sale) => toIdString(sale.account?._id || sale.account))).size,
      grossMinor: myCreatorSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.amountMinor || 0)), 0),
      commissionMinor: myCreatorSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.creatorCommissionMinor || 0)), 0),
      platformShareMinor: myCreatorSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.platformShareMinor || 0)), 0),
      enrollmentCount: managedCourses
        .filter((course) => effectiveManagedCourseIds.has(toIdString(course._id)))
        .reduce((sum, course) => sum + Math.max(0, Number(course.enrollmentCount || 0)), 0),
      completionCount: managedCourses
        .filter((course) => effectiveManagedCourseIds.has(toIdString(course._id)))
        .reduce((sum, course) => sum + Math.max(0, Number(course.completionCount || 0)), 0)
    }
    creatorStats.grossDisplay = formatCurrencyAmount(creatorStats.grossMinor, 'NGN')
    creatorStats.commissionDisplay = formatCurrencyAmount(creatorStats.commissionMinor, 'NGN')
    creatorStats.platformShareDisplay = formatCurrencyAmount(creatorStats.platformShareMinor, 'NGN')
    creatorStats.avgOrderMinor = creatorStats.saleCount > 0
      ? Math.round(creatorStats.grossMinor / creatorStats.saleCount)
      : 0
    creatorStats.avgOrderDisplay = formatCurrencyAmount(creatorStats.avgOrderMinor, 'NGN')
    creatorStats.conversionRatePercent = creatorStats.enrollmentCount > 0
      ? Math.round((creatorStats.saleCount / Math.max(1, creatorStats.enrollmentCount)) * 100)
      : 0
    creatorStats.completionRatePercent = creatorStats.enrollmentCount > 0
      ? Math.round((creatorStats.completionCount / Math.max(1, creatorStats.enrollmentCount)) * 100)
      : 0

    const creatorEarningsById = new Map(
      (creatorEarningsAggregateRaw || [])
        .map((entry) => {
          const creatorId = toIdString(entry?._id)
          if (!creatorId) return null
          return [creatorId, {
            saleCount: Math.max(0, Number(entry?.saleCount || 0)),
            soldMinor: Math.max(0, Number(entry?.soldMinor || 0)),
            earningsMinor: Math.max(0, Number(entry?.earningsMinor || 0)),
            platformShareMinor: Math.max(0, Number(entry?.platformShareMinor || 0))
          }]
        })
        .filter(Boolean)
    )
    const creatorWithdrawalsById = new Map(
      (creatorWithdrawalAggregateRaw || [])
        .map((entry) => {
          const creatorId = toIdString(entry?._id)
          if (!creatorId) return null
          return [creatorId, {
            requestCount: Math.max(0, Number(entry?.requestCount || 0)),
            requestedMinor: Math.max(0, Number(entry?.requestedMinor || 0)),
            pendingMinor: Math.max(0, Number(entry?.pendingMinor || 0)),
            approvedMinor: Math.max(0, Number(entry?.approvedMinor || 0)),
            paidMinor: Math.max(0, Number(entry?.paidMinor || 0)),
            rejectedMinor: Math.max(0, Number(entry?.rejectedMinor || 0)),
            cancelledMinor: Math.max(0, Number(entry?.cancelledMinor || 0)),
            latestRequestedAt: entry?.latestRequestedAt || null
          }]
        })
        .filter(Boolean)
    )

    const myCreatorId = toIdString(req.user._id)
    const myCreatorEarnings = creatorEarningsById.get(myCreatorId) || {
      saleCount: creatorStats.saleCount,
      soldMinor: creatorStats.grossMinor,
      earningsMinor: creatorStats.commissionMinor,
      platformShareMinor: creatorStats.platformShareMinor
    }
    const myCreatorWithdrawals = creatorWithdrawalsById.get(myCreatorId) || {
      requestCount: 0,
      requestedMinor: 0,
      pendingMinor: 0,
      approvedMinor: 0,
      paidMinor: 0,
      rejectedMinor: 0,
      cancelledMinor: 0,
      latestRequestedAt: null
    }
    const creatorWalletSummary = {
      soldMinor: myCreatorEarnings.soldMinor,
      soldCount: myCreatorEarnings.saleCount,
      earningsMinor: myCreatorEarnings.earningsMinor,
      pendingWithdrawalMinor: myCreatorWithdrawals.pendingMinor,
      paidOutMinor: myCreatorWithdrawals.paidMinor,
      availableBalanceMinor: Math.max(0, myCreatorEarnings.earningsMinor - myCreatorWithdrawals.paidMinor - myCreatorWithdrawals.pendingMinor),
      requestCount: myCreatorWithdrawals.requestCount,
      latestRequestedAt: myCreatorWithdrawals.latestRequestedAt || null
    }
    creatorWalletSummary.soldDisplay = formatCurrencyAmount(creatorWalletSummary.soldMinor, req.user?.payoutProfile?.currency || 'NGN')
    creatorWalletSummary.earningsDisplay = formatCurrencyAmount(creatorWalletSummary.earningsMinor, req.user?.payoutProfile?.currency || 'NGN')
    creatorWalletSummary.pendingWithdrawalDisplay = formatCurrencyAmount(creatorWalletSummary.pendingWithdrawalMinor, req.user?.payoutProfile?.currency || 'NGN')
    creatorWalletSummary.paidOutDisplay = formatCurrencyAmount(creatorWalletSummary.paidOutMinor, req.user?.payoutProfile?.currency || 'NGN')
    creatorWalletSummary.availableBalanceDisplay = formatCurrencyAmount(creatorWalletSummary.availableBalanceMinor, req.user?.payoutProfile?.currency || 'NGN')
    creatorStats.availableBalanceMinor = creatorWalletSummary.availableBalanceMinor
    creatorStats.availableBalanceDisplay = creatorWalletSummary.availableBalanceDisplay
    creatorStats.pendingWithdrawalDisplay = creatorWalletSummary.pendingWithdrawalDisplay
    creatorStats.paidOutDisplay = creatorWalletSummary.paidOutDisplay

    const creatorWithdrawalRequests = (creatorWithdrawalRequestsRaw || []).map((request) => ({
      ...request,
      creatorId: toIdString(request.creatorAccount),
      amountDisplay: formatCurrencyAmount(request.amountMinor, request.currency),
      statusLabel: formatWithdrawalStatusLabel(request.status),
      reviewerName: request.reviewedBy?.profile?.name || request.reviewedBy?.email || '',
      paidByName: request.paidBy?.profile?.name || request.paidBy?.email || '',
      canCancel: ['pending', 'approved'].includes(String(request.status || '').trim().toLowerCase())
    }))
    const adminWithdrawalRequests = (adminWithdrawalRequestsRaw || []).map((request) => {
      const creatorId = toIdString(request.creatorAccount?._id || request.creatorAccount)
      const creatorCurrency = request.currency || request.creatorAccount?.payoutProfile?.currency || 'NGN'
      const withdrawalStats = creatorWithdrawalsById.get(creatorId) || {
        requestCount: 0,
        requestedMinor: 0,
        pendingMinor: 0,
        approvedMinor: 0,
        paidMinor: 0,
        rejectedMinor: 0,
        cancelledMinor: 0,
        latestRequestedAt: null
      }
      const earningsStats = creatorEarningsById.get(creatorId) || {
        saleCount: 0,
        soldMinor: 0,
        earningsMinor: 0,
        platformShareMinor: 0
      }
      const normalizedStatus = String(request.status || '').trim().toLowerCase()
      const currentRequestReservedMinor = ['pending', 'approved'].includes(normalizedStatus)
        ? Math.max(0, Number(request.amountMinor || 0))
        : 0
      const availableBeforeCurrentRequestMinor = Math.max(
        0,
        Number(earningsStats.earningsMinor || 0)
          - Math.max(0, Number(withdrawalStats.pendingMinor || 0) - currentRequestReservedMinor)
          - Math.max(0, Number(withdrawalStats.paidMinor || 0))
      )
      const remainingAfterRequestMinor = Math.max(
        0,
        availableBeforeCurrentRequestMinor - Math.max(0, Number(request.amountMinor || 0))
      )
      const traceRows = (creatorSalesTraceById.get(creatorId) || [])
        .slice(0, 8)
        .map((sale) => ({
          paidAt: sale.paidAt || sale.createdAt || null,
          courseTitle: sale.courseTitle || 'Course',
          buyerName: sale.buyerName || sale.buyerEmail || 'Learner',
          amountDisplay: sale.amountDisplay,
          creatorCommissionRateDisplay: sale.creatorCommissionRateDisplay,
          creatorCommissionDisplay: sale.creatorCommissionDisplay,
          platformShareDisplay: sale.platformShareDisplay,
          agentCommissionDisplay: sale.agentCommissionDisplay,
          netPlatformDisplay: sale.netPlatformDisplay,
          agentName: sale.agentName || ''
        }))

      return {
        ...request,
        creatorId,
        creatorName: request.creatorAccount?.profile?.name || request.creatorAccount?.email || 'Creator',
        creatorEmail: request.creatorAccount?.email || '',
        amountDisplay: formatCurrencyAmount(request.amountMinor, creatorCurrency),
        statusLabel: formatWithdrawalStatusLabel(request.status),
        reviewerName: request.reviewedBy?.profile?.name || request.reviewedBy?.email || '',
        paidByName: request.paidBy?.profile?.name || request.paidBy?.email || '',
        canApprove: normalizedStatus === 'pending',
        canReject: ['pending', 'approved'].includes(normalizedStatus),
        canMarkPaid: ['pending', 'approved'].includes(normalizedStatus),
        creatorEarningsDisplay: formatCurrencyAmount(earningsStats.earningsMinor || 0, creatorCurrency),
        creatorSoldDisplay: formatCurrencyAmount(earningsStats.soldMinor || 0, creatorCurrency),
        creatorPendingWithdrawalDisplay: formatCurrencyAmount(withdrawalStats.pendingMinor || 0, creatorCurrency),
        creatorPaidWithdrawalDisplay: formatCurrencyAmount(withdrawalStats.paidMinor || 0, creatorCurrency),
        availableBeforeCurrentRequestDisplay: formatCurrencyAmount(availableBeforeCurrentRequestMinor, creatorCurrency),
        remainingAfterRequestDisplay: formatCurrencyAmount(remainingAfterRequestMinor, creatorCurrency),
        salesTraceCount: (creatorSalesTraceById.get(creatorId) || []).length,
        salesTraceRows: traceRows
      }
    })
    const partnerWithdrawalRequests = (partnerWithdrawalRequestsRaw || []).map((request) => {
      const status = normalizeWithdrawalStatus(request.status, 'pending')
      return {
        ...request,
        organizationId: toIdString(request.organization?._id || request.organization),
        organizationName: request.organization?.name || 'Partner Organization',
        partnerType: request.organization?.partnerType || 'partner',
        requestedByName: request.requestedBy?.profile?.name || request.requestedBy?.email || 'Partner User',
        requestedByEmail: request.requestedBy?.email || '',
        amountDisplay: formatCurrencyAmount(
          request.amountMinor,
          request.currency || request.organization?.partnerSettings?.payoutProfile?.currency || 'NGN'
        ),
        statusLabel: formatWithdrawalStatusLabel(status),
        reviewerName: request.reviewedBy?.profile?.name || request.reviewedBy?.email || '',
        paidByName: request.paidBy?.profile?.name || request.paidBy?.email || '',
        canApprove: status === 'pending',
        canReject: ['pending', 'approved'].includes(status),
        canMarkPaid: ['approved'].includes(status)
      }
    })
    const orgCourseStatsMap = new Map()
    managedCourses.forEach((course) => {
      const orgId = toIdString(course.organization)
      if (!orgId) return
      const existing = orgCourseStatsMap.get(orgId) || {
        totalCourses: 0,
        publishedCourses: 0,
        draftCourses: 0
      }
      const normalizedStatus = String(course.status || '').trim().toLowerCase()
      existing.totalCourses += 1
      if (normalizedStatus === 'published') {
        existing.publishedCourses += 1
      } else if (normalizedStatus === 'draft' || normalizedStatus === 'pending_public_review') {
        existing.draftCourses += 1
      }
      orgCourseStatsMap.set(orgId, existing)
    })
    const orgAgentStatsMap = new Map()
    adminAccounts
      .filter((account) => account.resolvedRole === 'channel_sales_agent')
      .forEach((account) => {
        const orgId = toIdString(account.partnerOrganization)
        if (!orgId) return
        const existing = orgAgentStatsMap.get(orgId) || 0
        orgAgentStatsMap.set(orgId, existing + 1)
      })
    const orgAttributionStatsMap = new Map()
    ;(agentPayoutRowsRaw || []).forEach((entry) => {
      const orgId = toIdString(entry.partnerOrganization?._id || entry.partnerOrganization)
      if (!orgId) return
      const existing = orgAttributionStatsMap.get(orgId) || {
        pendingCommissionMinor: 0,
        recommendedCommissionMinor: 0,
        approvedCommissionMinor: 0
      }
      const status = String(entry.status || '').trim().toLowerCase()
      const amount = Math.max(0, Number(entry.commissionAmountMinor || 0))
      if (status === 'pending') existing.pendingCommissionMinor += amount
      if (status === 'recommended') existing.recommendedCommissionMinor += amount
      if (status === 'approved') existing.approvedCommissionMinor += amount
      orgAttributionStatsMap.set(orgId, existing)
    })
    const partnerWithdrawalStatsMap = new Map(
      (partnerWithdrawalAggregateRaw || [])
        .map((entry) => {
          const orgId = toIdString(entry?._id)
          if (!orgId) return null
          return [orgId, {
            requestCount: Math.max(0, Number(entry.requestCount || 0)),
            pendingMinor: Math.max(0, Number(entry.pendingMinor || 0)),
            paidMinor: Math.max(0, Number(entry.paidMinor || 0)),
            latestRequestedAt: entry.latestRequestedAt || null
          }]
        })
        .filter(Boolean)
    )
    const partnerRevenueStatsMap = new Map(
      (partnerRevenueAggregateRaw || [])
        .map((entry) => {
          const orgId = toIdString(entry?._id)
          if (!orgId) return null
          return [orgId, {
            totalSalesMinor: Math.max(0, Number(entry.totalSalesMinor || 0)),
            totalAgentCommissionMinor: Math.max(0, Number(entry.totalAgentCommissionMinor || 0)),
            partnerEarningsMinor: Math.max(0, Number(entry.partnerEarningsMinor || 0))
          }]
        })
        .filter(Boolean)
    )
    const partnerOrganizations = (partnerOrganizationsRaw || []).map((organization) => {
      const orgId = toIdString(organization._id)
      const courseStats = orgCourseStatsMap.get(orgId) || { totalCourses: 0, publishedCourses: 0, draftCourses: 0 }
      const attributionStats = orgAttributionStatsMap.get(orgId) || {
        pendingCommissionMinor: 0,
        recommendedCommissionMinor: 0,
        approvedCommissionMinor: 0
      }
      const withdrawalStats = partnerWithdrawalStatsMap.get(orgId) || {
        requestCount: 0,
        pendingMinor: 0,
        paidMinor: 0,
        latestRequestedAt: null
      }
      const partnerRevenueStats = partnerRevenueStatsMap.get(orgId) || {
        totalSalesMinor: 0,
        totalAgentCommissionMinor: 0,
        partnerEarningsMinor: 0
      }
      const availableWithdrawalMinor = Math.max(
        0,
        Number(partnerRevenueStats.partnerEarningsMinor || 0)
          - Number(withdrawalStats.pendingMinor || 0)
          - Number(withdrawalStats.paidMinor || 0)
      )
      const payoutCurrency = normalizeCurrencyCode(organization?.partnerSettings?.payoutProfile?.currency || 'NGN')
      const status = String(organization?.partnerSettings?.partnerStatus || 'pending').trim().toLowerCase()
      const ownerName = organization?.owner?.profile?.name || organization?.owner?.email || ''
      const members = (Array.isArray(organization?.members) ? organization.members : [])
        .filter((member) => String(member?.status || 'active').trim().toLowerCase() === 'active')
        .filter((member) => String(member?.role || '').trim().toLowerCase() !== 'sales_agent')
        .map((member) => {
          const account = member?.account || null
          const accessProfile = buildAccessProfileSnapshot(account, {
            organization,
            memberRole: member.role
          })
          return {
            id: toIdString(account?._id),
            displayName: account?.profile?.name || account?.email || 'Member',
            email: account?.email || '',
            memberRole: String(member?.role || '').trim().toLowerCase(),
            memberRoleLabel: resolvePartnerDashboardRoleFromOrgMembership({
              organization,
              memberRole: member.role
            }) || String(member?.role || '').trim().toLowerCase(),
            platformRole: accessProfile.platformRole || '',
            baseLearningRole: accessProfile.baseLearningRole || 'learner'
          }
        })
        .sort((left, right) => String(left.displayName || '').localeCompare(String(right.displayName || '')))
      return {
        ...organization,
        ownerName,
        members,
        partnerStatus: ['pending', 'active', 'suspended'].includes(status) ? status : 'pending',
        agentCount: Number(orgAgentStatsMap.get(orgId) || 0),
        totalCourses: Number(courseStats.totalCourses || 0),
        publishedCourses: Number(courseStats.publishedCourses || 0),
        draftCourses: Number(courseStats.draftCourses || 0),
        pendingCommissionMinor: Number(attributionStats.pendingCommissionMinor || 0),
        recommendedCommissionMinor: Number(attributionStats.recommendedCommissionMinor || 0),
        approvedCommissionMinor: Number(attributionStats.approvedCommissionMinor || 0),
        pendingCommissionDisplay: formatCurrencyAmount(attributionStats.pendingCommissionMinor || 0, 'NGN'),
        recommendedCommissionDisplay: formatCurrencyAmount(attributionStats.recommendedCommissionMinor || 0, 'NGN'),
        approvedCommissionDisplay: formatCurrencyAmount(attributionStats.approvedCommissionMinor || 0, 'NGN'),
        partnerRevenueMinor: partnerRevenueStats.partnerEarningsMinor,
        partnerRevenueDisplay: formatCurrencyAmount(partnerRevenueStats.partnerEarningsMinor || 0, payoutCurrency),
        partnerSalesDisplay: formatCurrencyAmount(partnerRevenueStats.totalSalesMinor || 0, payoutCurrency),
        partnerAgentCommissionDisplay: formatCurrencyAmount(partnerRevenueStats.totalAgentCommissionMinor || 0, payoutCurrency),
        partnerWithdrawalPendingMinor: withdrawalStats.pendingMinor,
        partnerWithdrawalPendingDisplay: formatCurrencyAmount(withdrawalStats.pendingMinor || 0, payoutCurrency),
        partnerWithdrawalPaidMinor: withdrawalStats.paidMinor,
        partnerWithdrawalPaidDisplay: formatCurrencyAmount(withdrawalStats.paidMinor || 0, payoutCurrency),
        partnerWithdrawalRequestCount: withdrawalStats.requestCount,
        partnerWithdrawalAvailableMinor: availableWithdrawalMinor,
        partnerWithdrawalAvailableDisplay: formatCurrencyAmount(availableWithdrawalMinor, payoutCurrency),
        partnerWithdrawalLatestRequestedAt: withdrawalStats.latestRequestedAt || null
      }
    })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

    const roleApprovalRequests = (roleApprovalRequestsRaw || []).map((request) => ({
      ...request,
      accountName: request.account?.profile?.name || request.account?.email || 'User',
      accountEmail: request.account?.email || '',
      organizationName: request.organization?.name || request.organizationName || '',
      partnerType: request.partnerType || request.organization?.partnerType || 'partner',
      reviewedByName: request.reviewedBy?.profile?.name || request.reviewedBy?.email || ''
    }))

    const superAdminIdSet = new Set((superUsersRaw || []).map((entry) => toIdString(entry._id)).filter(Boolean))
    const userIdByRoleMetadata = new Set(
      (superUsersRaw || [])
        .map((entry) => toIdString(entry.roleMetadata?.lastUpdatedBy))
        .filter(Boolean)
    )
    const superUserActorIds = Array.from(userIdByRoleMetadata).filter((id) => !superAdminIdSet.has(id))
    const superUserActors = superUserActorIds.length > 0
      ? await Account.find({ _id: { $in: superUserActorIds } })
        .select('_id email profile.name')
        .lean()
      : []
    const superUserActorById = new Map(superUserActors.map((entry) => [toIdString(entry._id), entry]))
    const superUserAccounts = (superUsersRaw || []).map((entry) => {
      const actorId = toIdString(entry.roleMetadata?.lastUpdatedBy)
      const promotedBy = actorId
        ? (superUserActorById.get(actorId)
            || (superUsersRaw || []).find((candidate) => toIdString(candidate._id) === actorId)
            || null)
        : null
      return {
        ...entry,
        displayName: entry.profile?.name || entry.email || 'Super Admin',
        promotedByName: promotedBy?.profile?.name || promotedBy?.email || '',
        promotedAt: entry.roleMetadata?.lastUpdatedAt || entry.updatedAt || entry.createdAt
      }
    })
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())

    const adminInviteRows = (adminInvitesRaw || []).map((entry) => ({
      ...entry,
      requestedRoleLabel: resolveAdminInviteRoleCopy(entry.requestedRole),
      statusLabel: formatAdminInviteStatus(entry.status),
      invitedByName: entry.invitedBy?.profile?.name || entry.invitedBy?.email || '',
      registeredAccountName: entry.registeredAccount?.profile?.name || entry.registeredAccount?.email || '',
      acceptedByName: entry.acceptedBy?.profile?.name || entry.acceptedBy?.email || '',
      canRevoke: ['pending', 'registered'].includes(String(entry.status || '').trim().toLowerCase())
    }))

    const auditLogEntries = (auditLogEntriesRaw || [])
      .filter((entry) => isPlatformAuditEntry(entry))
      .slice(0, 300)
      .map((entry) => {
        const performedByName = entry.performedBy?.profile?.name || entry.performedBy?.email || 'System'
        const performedByEmail = entry.performedBy?.email || ''
        const performedByRole = resolveRole(entry.performedBy)
        const performedByRoleLabel = buildAuditRoleLabel(entry.performedBy)
        const targetAccountName = entry.targetAccount?.profile?.name || entry.targetAccount?.email || ''
        const targetAccountEmail = entry.targetAccount?.email || ''
        const targetAccountRole = resolveRole(entry.targetAccount)
        const targetAccountRoleLabel = targetAccountName ? buildAuditRoleLabel(entry.targetAccount) : ''
        const targetOrganizationName = entry.targetOrganization?.name || ''
        const metadataPairs = flattenAuditMetadata(entry.metadata || {})
        const action = String(entry.action || '').trim().toLowerCase()
        const headline = buildAuditHeadline({
          action,
          metadata: entry.metadata || {},
          targetAccountName,
          targetOrganizationName
        })
        const narrative = buildAuditNarrative({
          action,
          metadata: entry.metadata || {},
          performedByName,
          performedByRoleLabel,
          targetAccountName,
          targetOrganizationName
        })

        return {
          ...entry,
          action,
          actionLabel: humanizeToken(action),
          headline,
          narrative,
          metadataPairs,
          metadataPreview: metadataPairs.slice(0, 4),
          performedByName,
          performedByEmail,
          performedByRole,
          performedByRoleLabel,
          targetAccountName,
          targetAccountEmail,
          targetAccountRole,
          targetAccountRoleLabel,
          targetOrganizationName,
          targetOrganizationType: humanizeToken(entry.targetOrganization?.partnerType || ''),
          performedById: toIdString(entry.performedBy?._id),
          targetAccountId: toIdString(entry.targetAccount?._id),
          eventId: toIdString(entry._id)
        }
      })

    const agentPayoutRows = (agentPayoutRowsRaw || []).map((entry) => ({
      ...entry,
      agentName: entry.agent?.profile?.name || entry.agent?.email || 'Agent',
      agentEmail: entry.agent?.email || '',
      courseTitle: entry.course?.title || 'Course',
      organizationName: entry.partnerOrganization?.name || '',
      amountDisplay: formatCurrencyAmount(entry.commissionAmountMinor || 0, entry.currency || 'NGN'),
      saleAmountDisplay: formatCurrencyAmount(entry.saleAmountMinor || 0, entry.currency || 'NGN'),
      statusLabel: String(entry.status || '').replace(/_/g, ' '),
      recommendedByName: entry.recommendedBy?.profile?.name || entry.recommendedBy?.email || '',
      approvedByName: entry.approvedBy?.profile?.name || entry.approvedBy?.email || '',
      canApprove: String(entry.status || '').trim().toLowerCase() === 'recommended',
      canMarkPaid: ['recommended', 'approved'].includes(String(entry.status || '').trim().toLowerCase()),
      canReject: ['pending', 'recommended', 'approved'].includes(String(entry.status || '').trim().toLowerCase())
    }))

    const canSubmitPartnerApplication = !canManagePlatform(role)
      && !isPartnerDashboardRole(role)
      && String(role || '').trim().toLowerCase() !== 'channel_sales_agent'
    const partnerApplicationState = {
      canSubmit: canSubmitPartnerApplication,
      currentOrganization: currentPartnerOrganizationRaw
        ? {
            name: currentPartnerOrganizationRaw.name || '',
            partnerType: currentPartnerOrganizationRaw.partnerType || 'partner',
            status: String(currentPartnerOrganizationRaw.partnerSettings?.partnerStatus || 'pending').trim().toLowerCase()
          }
        : null,
      latestRequest: latestPartnerRoleRequestRaw
        ? {
            id: toIdString(latestPartnerRoleRequestRaw._id),
            status: String(latestPartnerRoleRequestRaw.status || 'pending').trim().toLowerCase(),
            statusLabel: String(latestPartnerRoleRequestRaw.status || 'pending').replace(/_/g, ' '),
            registrationIntent: latestPartnerRoleRequestRaw.registrationIntent || 'partner',
            organizationName: latestPartnerRoleRequestRaw.organization?.name || latestPartnerRoleRequestRaw.organizationName || '',
            requestedRole: latestPartnerRoleRequestRaw.requestedRole || '',
            reviewedByName: latestPartnerRoleRequestRaw.reviewedBy?.profile?.name || latestPartnerRoleRequestRaw.reviewedBy?.email || '',
            reviewNotes: latestPartnerRoleRequestRaw.reviewNotes || '',
            createdAt: latestPartnerRoleRequestRaw.createdAt || null,
            reviewedAt: latestPartnerRoleRequestRaw.reviewedAt || null
          }
        : null
    }

    let adminPayments = (adminPaymentsRaw || []).map((payment) => ({
      ...payment,
      learnerName: payment.account?.profile?.name || payment.account?.email || 'Learner',
      learnerEmail: payment.account?.email || '',
      courseTitle: payment.course?.title || 'Course',
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency),
      creatorCommissionDisplay: formatCurrencyAmount(payment.creatorCommissionMinor || 0, payment.currency),
      platformShareDisplay: formatCurrencyAmount(payment.platformShareMinor || 0, payment.currency),
      statusLabel: String(payment.status || '').replace(/_/g, ' '),
      provider: normalizePaymentProvider(payment.provider, 'flutterwave'),
      providerLabel: PAYMENT_PROVIDER_COPY[normalizePaymentProvider(payment.provider, 'flutterwave')]?.label || 'Flutterwave',
      providerReference: payment.providerTxId || payment.flutterwaveTxId || payment.paystackReference || ''
    }))

    if (paymentSearchFilter) {
      const needle = paymentSearchFilter.toLowerCase()
      adminPayments = adminPayments.filter((payment) => {
        const haystack = [
          payment.txRef,
          payment.provider,
          payment.providerLabel,
          payment.providerReference,
          payment.flutterwaveTxId,
          payment.paystackReference,
          payment.learnerName,
          payment.learnerEmail,
          payment.courseTitle,
          payment.statusLabel
        ]
          .map((entry) => String(entry || '').toLowerCase())
          .join(' ')
        return haystack.includes(needle)
      })
    }

    const paymentStats = {
      totalCount: adminPayments.length,
      successfulCount: adminPayments.filter(payment => payment.status === 'successful').length,
      pendingCount: adminPayments.filter(payment => payment.status === 'pending' || payment.status === 'initiated').length,
      failedCount: adminPayments.filter(payment => ['failed', 'cancelled'].includes(payment.status)).length,
      revenueMinor: adminPayments
        .filter(payment => payment.status === 'successful')
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.amountMinor || 0)), 0),
      creatorPayoutMinor: adminPayments
        .filter(payment => payment.status === 'successful')
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.creatorCommissionMinor || 0)), 0)
    }
    paymentStats.successRatePercent = paymentStats.totalCount > 0
      ? Math.round((paymentStats.successfulCount / paymentStats.totalCount) * 100)
      : 0
    paymentStats.averageOrderMinor = paymentStats.successfulCount > 0
      ? Math.round(paymentStats.revenueMinor / paymentStats.successfulCount)
      : 0
    paymentStats.averageOrderDisplay = formatCurrencyAmount(paymentStats.averageOrderMinor, 'NGN')
    paymentStats.creatorPayoutRatePercent = paymentStats.revenueMinor > 0
      ? Math.round((paymentStats.creatorPayoutMinor / paymentStats.revenueMinor) * 100)
      : 0

    const categoryInsightsMap = new Map()
    for (const course of catalogCourses) {
      const key = String(course?.category || 'Uncategorized').trim() || 'Uncategorized'
      const existing = categoryInsightsMap.get(key) || {
        category: key,
        publishedCourseCount: 0,
        paidCourseCount: 0,
        enrollmentCount: 0,
        completionCount: 0
      }
      existing.publishedCourseCount += 1
      if (course?.requiresPayment) existing.paidCourseCount += 1
      existing.enrollmentCount += Math.max(0, Number(course?.enrollmentCount || 0))
      existing.completionCount += Math.max(0, Number(course?.completionCount || 0))
      categoryInsightsMap.set(key, existing)
    }
    const categoryInsights = Array.from(categoryInsightsMap.values())
      .map((entry) => ({
        ...entry,
        completionRatePercent: entry.enrollmentCount > 0
          ? Math.round((entry.completionCount / Math.max(1, entry.enrollmentCount)) * 100)
          : 0
      }))
      .sort((a, b) => (b.enrollmentCount - a.enrollmentCount) || (b.publishedCourseCount - a.publishedCourseCount))
      .slice(0, 10)

    const analyticsLookbackDays = Math.min(365, Math.max(7, Number(platformSettings.analyticsLookbackDays || 30)))
    const now = new Date()
    const periodStart = new Date(now.getTime() - (analyticsLookbackDays * 24 * 60 * 60 * 1000))
    const previousPeriodStart = new Date(periodStart.getTime() - (analyticsLookbackDays * 24 * 60 * 60 * 1000))
    const growthPercent = (currentValue, previousValue) => {
      const current = Math.max(0, Number(currentValue || 0))
      const previous = Math.max(0, Number(previousValue || 0))
      if (previous <= 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    const [currentEnrollmentCount, previousEnrollmentCount, currentCompletionCount, previousCompletionCount, currentPaymentsRaw, previousPaymentsRaw, topCoursesByEnrollmentsRaw, topCoursesByRevenueRaw, topCreatorsByRevenueRaw] = await Promise.all([
      SimpleLmsEnrollment.countDocuments({ createdAt: { $gte: periodStart } }),
      SimpleLmsEnrollment.countDocuments({ createdAt: { $gte: previousPeriodStart, $lt: periodStart } }),
      SimpleLmsEnrollment.countDocuments({ status: 'completed', completedAt: { $gte: periodStart } }),
      SimpleLmsEnrollment.countDocuments({ status: 'completed', completedAt: { $gte: previousPeriodStart, $lt: periodStart } }),
      SimpleLmsPayment.aggregate([
        { $match: { status: 'successful', paidAt: { $gte: periodStart } } },
        { $group: { _id: null, grossMinor: { $sum: '$amountMinor' }, creatorMinor: { $sum: '$creatorCommissionMinor' }, platformMinor: { $sum: '$platformShareMinor' }, count: { $sum: 1 } } }
      ]),
      SimpleLmsPayment.aggregate([
        { $match: { status: 'successful', paidAt: { $gte: previousPeriodStart, $lt: periodStart } } },
        { $group: { _id: null, grossMinor: { $sum: '$amountMinor' }, creatorMinor: { $sum: '$creatorCommissionMinor' }, platformMinor: { $sum: '$platformShareMinor' }, count: { $sum: 1 } } }
      ]),
      SimpleLmsEnrollment.aggregate([
        { $match: { createdAt: { $gte: periodStart } } },
        { $group: { _id: '$course', enrollmentCount: { $sum: 1 }, completionCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
        { $sort: { enrollmentCount: -1 } },
        { $limit: 8 }
      ]),
      SimpleLmsPayment.aggregate([
        { $match: { status: 'successful', paidAt: { $gte: periodStart } } },
        { $group: { _id: '$course', revenueMinor: { $sum: '$amountMinor' }, saleCount: { $sum: 1 } } },
        { $sort: { revenueMinor: -1 } },
        { $limit: 8 }
      ]),
      SimpleLmsPayment.aggregate([
        { $match: { status: 'successful', paidAt: { $gte: periodStart } } },
        { $group: { _id: '$creatorAccount', revenueMinor: { $sum: '$amountMinor' }, creatorCommissionMinor: { $sum: '$creatorCommissionMinor' }, saleCount: { $sum: 1 } } },
        { $sort: { revenueMinor: -1 } },
        { $limit: 8 }
      ])
    ])

    const currentPayments = currentPaymentsRaw[0] || { grossMinor: 0, creatorMinor: 0, platformMinor: 0, count: 0 }
    const previousPayments = previousPaymentsRaw[0] || { grossMinor: 0, creatorMinor: 0, platformMinor: 0, count: 0 }

    const accountById = new Map(adminAccounts.map((account) => [toIdString(account._id), account]))
    const accountNameById = new Map(adminAccounts.map((account) => [toIdString(account._id), account.displayName]))
    const accountEmailById = new Map(adminAccounts.map((account) => [toIdString(account._id), account.email || '']))
    const courseNameById = new Map([...managedCourses, ...catalogCourses, ...(pendingReviewCoursesRaw || []).map(decorateCourse)]
      .map((course) => [toIdString(course._id), course.title || 'Course']))

    const creatorSalesByCourse = new Map()
    myCreatorSales.forEach((sale) => {
      const courseId = toIdString(sale.course?._id || sale.course)
      if (!courseId) return
      const existing = creatorSalesByCourse.get(courseId) || {
        saleCount: 0,
        grossMinor: 0,
        commissionMinor: 0
      }
      existing.saleCount += 1
      existing.grossMinor += Math.max(0, Number(sale.amountMinor || 0))
      existing.commissionMinor += Math.max(0, Number(sale.creatorCommissionMinor || 0))
      creatorSalesByCourse.set(courseId, existing)
    })

    const creatorCourseInsights = managedCourses
      .filter((course) => effectiveManagedCourseIds.has(toIdString(course._id)))
      .map((course) => {
        const courseId = toIdString(course._id)
        const saleStats = creatorSalesByCourse.get(courseId) || { saleCount: 0, grossMinor: 0, commissionMinor: 0 }
        const completionRate = course.enrollmentCount > 0
          ? Math.round((Math.max(0, Number(course.completionCount || 0)) / Math.max(1, Number(course.enrollmentCount || 0))) * 100)
          : 0
        return {
          courseId,
          title: course.title,
          enrollmentCount: Math.max(0, Number(course.enrollmentCount || 0)),
          completionCount: Math.max(0, Number(course.completionCount || 0)),
          completionRate,
          saleCount: saleStats.saleCount,
          grossDisplay: formatCurrencyAmount(saleStats.grossMinor, course.pricing?.currency || 'NGN'),
          commissionDisplay: formatCurrencyAmount(saleStats.commissionMinor, course.pricing?.currency || 'NGN')
        }
      })
      .sort((a, b) => b.enrollmentCount - a.enrollmentCount)
      .slice(0, 12)

    const analytics = {
      lookbackDays: analyticsLookbackDays,
      enrollmentTrend: {
        current: currentEnrollmentCount,
        previous: previousEnrollmentCount,
        growthPercent: growthPercent(currentEnrollmentCount, previousEnrollmentCount)
      },
      completionTrend: {
        current: currentCompletionCount,
        previous: previousCompletionCount,
        growthPercent: growthPercent(currentCompletionCount, previousCompletionCount)
      },
      paymentTrend: {
        currentCount: Math.max(0, Number(currentPayments.count || 0)),
        previousCount: Math.max(0, Number(previousPayments.count || 0)),
        grossDisplay: formatCurrencyAmount(currentPayments.grossMinor, 'NGN'),
        previousGrossDisplay: formatCurrencyAmount(previousPayments.grossMinor, 'NGN'),
        growthPercent: growthPercent(currentPayments.grossMinor, previousPayments.grossMinor)
      },
      topCoursesByEnrollments: (topCoursesByEnrollmentsRaw || []).map((entry) => ({
        courseId: toIdString(entry._id),
        title: courseNameById.get(toIdString(entry._id)) || 'Course',
        enrollmentCount: Math.max(0, Number(entry.enrollmentCount || 0)),
        completionCount: Math.max(0, Number(entry.completionCount || 0))
      })),
      topCoursesByRevenue: (topCoursesByRevenueRaw || []).map((entry) => ({
        courseId: toIdString(entry._id),
        title: courseNameById.get(toIdString(entry._id)) || 'Course',
        saleCount: Math.max(0, Number(entry.saleCount || 0)),
        revenueDisplay: formatCurrencyAmount(entry.revenueMinor, 'NGN')
      })),
      topCreatorsByRevenue: (topCreatorsByRevenueRaw || []).map((entry) => {
        const accountId = toIdString(entry._id)
        return {
          accountId,
          creatorName: accountNameById.get(accountId) || accountEmailById.get(accountId) || 'Unassigned',
          saleCount: Math.max(0, Number(entry.saleCount || 0)),
          revenueDisplay: formatCurrencyAmount(entry.revenueMinor, 'NGN'),
          commissionDisplay: formatCurrencyAmount(entry.creatorCommissionMinor, 'NGN')
        }
      }),
      categoryInsights
    }

    const reportWindow = resolveReportWindow({
      from: req.query.reportFrom || req.query.from || '',
      to: req.query.reportTo || req.query.to || '',
      lookbackDays: req.query.reportLookbackDays || req.query.lookbackDays || analyticsLookbackDays
    }, analyticsLookbackDays)
    const reportPartnerOrganizationId = canManagePlatform(role)
      ? parseObjectIdFilter(req.query.reportPartnerOrganization || req.query.partnerOrganization || '')
      : ''
    const reportAgentId = canManagePlatform(role)
      ? parseObjectIdFilter(req.query.reportAgentId || req.query.agentId || '')
      : ''
    const reportCourseId = parseObjectIdFilter(req.query.reportCourseId || req.query.courseId || '')

    const defaultDailySalesReport = {
      scope: 'platform',
      rows: [],
      summary: {
        saleCount: 0,
        grossSalesMinor: 0,
        creatorCommissionMinor: 0,
        platformShareMinor: 0,
        agentCommissionMinor: 0,
        partnerEarningsMinor: 0
      }
    }
    const defaultCommissionReport = {
      scope: 'platform',
      rows: [],
      summary: {
        saleCount: 0,
        creatorCommissionMinor: 0,
        platformShareMinor: 0,
        agentCommissionMinor: 0,
        partnerEarningsMinor: 0
      }
    }
    const defaultChurnMetrics = {
      activeAgents: 0,
      removedAgents: 0,
      agentAttritionRatePercent: 0,
      averageTimeToFirstSaleDays: 0,
      activeEnrollments: 0,
      atRiskEnrollments: 0,
      learnerDropOffRatePercent: 0
    }
    const [dailySalesReportRaw, commissionReportRaw, churnMetrics] = canManagePlatform(role)
      ? await Promise.all([
          buildSalesReportData({
            role,
            accountId: req.user?._id,
            partnerOrganizationId: reportPartnerOrganizationId,
            agentId: reportAgentId,
            courseId: reportCourseId,
            from: reportWindow.from,
            to: reportWindow.to
          }),
          buildCommissionReportData({
            role,
            accountId: req.user?._id,
            partnerOrganizationId: reportPartnerOrganizationId,
            agentId: reportAgentId,
            courseId: reportCourseId,
            from: reportWindow.from,
            to: reportWindow.to
          }),
          buildChurnMetrics({
            from: reportWindow.from,
            to: reportWindow.to,
            partnerOrganizationId: reportPartnerOrganizationId
          })
        ])
      : [defaultDailySalesReport, defaultCommissionReport, defaultChurnMetrics]
    const reportCurrency = 'NGN'
    const dailySalesReport = {
      ...dailySalesReportRaw,
      rows: decorateSalesReportRows(dailySalesReportRaw.rows, reportCurrency),
      summary: {
        ...dailySalesReportRaw.summary,
        grossSalesDisplay: formatCurrencyAmount(dailySalesReportRaw.summary?.grossSalesMinor || 0, reportCurrency),
        creatorCommissionDisplay: formatCurrencyAmount(dailySalesReportRaw.summary?.creatorCommissionMinor || 0, reportCurrency),
        platformShareDisplay: formatCurrencyAmount(dailySalesReportRaw.summary?.platformShareMinor || 0, reportCurrency),
        agentCommissionDisplay: formatCurrencyAmount(dailySalesReportRaw.summary?.agentCommissionMinor || 0, reportCurrency),
        partnerEarningsDisplay: formatCurrencyAmount(dailySalesReportRaw.summary?.partnerEarningsMinor || 0, reportCurrency)
      }
    }
    const commissionReport = {
      ...commissionReportRaw,
      rows: decorateCommissionReportRows(commissionReportRaw.rows, reportCurrency),
      summary: {
        ...commissionReportRaw.summary,
        creatorCommissionDisplay: formatCurrencyAmount(commissionReportRaw.summary?.creatorCommissionMinor || 0, reportCurrency),
        platformShareDisplay: formatCurrencyAmount(commissionReportRaw.summary?.platformShareMinor || 0, reportCurrency),
        agentCommissionDisplay: formatCurrencyAmount(commissionReportRaw.summary?.agentCommissionMinor || 0, reportCurrency),
        partnerEarningsDisplay: formatCurrencyAmount(commissionReportRaw.summary?.partnerEarningsMinor || 0, reportCurrency)
      }
    }
    const reportFilters = {
      from: toIsoDateInput(reportWindow.from),
      to: toIsoDateInput(reportWindow.to),
      lookbackDays: reportWindow.lookbackDays,
      partnerOrganizationId: reportPartnerOrganizationId,
      agentId: reportAgentId,
      courseId: reportCourseId
    }

    const commissionAccountOverrides = (commissionSettings.accountOverrides || []).map((entry) => {
      const accountId = toIdString(entry.account)
      return {
        accountId,
        ratePercent: normalizeCommissionRate(entry.ratePercent, commissionSettings.globalRatePercent),
        accountName: accountNameById.get(accountId) || accountEmailById.get(accountId) || accountId
      }
    })

    const commissionCourseOverrides = (commissionSettings.courseOverrides || []).map((entry) => {
      const courseId = toIdString(entry.course)
      return {
        courseId,
        ratePercent: normalizeCommissionRate(entry.ratePercent, commissionSettings.globalRatePercent),
        courseTitle: courseNameById.get(courseId) || courseId
      }
    })

    const commissionOverrideByAccountId = new Map(
      commissionAccountOverrides.map((entry) => [entry.accountId, entry.ratePercent])
    )
    const creatorIdentityById = new Map()
    managedCourses.forEach((course) => {
      const creatorId = toIdString(course.createdById || course.createdBy)
      if (!creatorId) return
      creatorIdentityById.set(creatorId, {
        creatorName: course.createdByName || course.authorName || accountNameById.get(creatorId) || '',
        creatorEmail: course.createdByEmail || accountEmailById.get(creatorId) || ''
      })
    })

    const creatorCoursesById = new Map()
    managedCourses.forEach((course) => {
      const creatorId = toIdString(course.createdById || course.createdBy)
      if (!creatorId) return
      const normalizedStatus = String(course.status || 'draft').trim().toLowerCase()
      const existing = creatorCoursesById.get(creatorId) || {
        totalCourses: 0,
        publishedCourses: 0,
        draftCourses: 0,
        pendingCourses: 0,
        archivedCourses: 0,
        activeCourses: 0,
        inactiveCourses: 0,
        enrollmentCount: 0,
        completionCount: 0,
        courses: []
      }
      existing.totalCourses += 1
      if (normalizedStatus === 'published') {
        existing.publishedCourses += 1
      } else if (normalizedStatus === 'pending_public_review') {
        existing.pendingCourses += 1
      } else if (normalizedStatus === 'archived') {
        existing.archivedCourses += 1
      } else {
        existing.draftCourses += 1
      }
      if (course.isActive !== false) {
        existing.activeCourses += 1
      } else {
        existing.inactiveCourses += 1
      }
      existing.enrollmentCount += Math.max(0, Number(course.enrollmentCount || 0))
      existing.completionCount += Math.max(0, Number(course.completionCount || 0))
      existing.courses.push({
        courseId: toIdString(course._id),
        title: course.title || 'Untitled Course',
        status: normalizedStatus || 'draft',
        enrollmentCount: Math.max(0, Number(course.enrollmentCount || 0)),
        completionCount: Math.max(0, Number(course.completionCount || 0)),
        updatedAt: course.updatedAt || course.createdAt || null
      })
      creatorCoursesById.set(creatorId, existing)
    })

    const creatorSalesById = new Map()
    creatorSales.forEach((sale) => {
      const creatorId = toIdString(sale.creatorId || sale.creatorAccount || sale.course?.createdBy)
      if (!creatorId) return
      const existing = creatorSalesById.get(creatorId) || {
        saleCount: 0,
        grossMinor: 0,
        creatorCommissionMinor: 0,
        platformShareMinor: 0,
        uniqueLearnerIds: new Set()
      }
      existing.saleCount += 1
      existing.grossMinor += Math.max(0, Number(sale.amountMinor || 0))
      existing.creatorCommissionMinor += Math.max(0, Number(sale.creatorCommissionMinor || 0))
      existing.platformShareMinor += Math.max(0, Number(sale.platformShareMinor || 0))
      const learnerId = toIdString(sale.account?._id || sale.account)
      if (learnerId) existing.uniqueLearnerIds.add(learnerId)
      creatorSalesById.set(creatorId, existing)
    })

    const creatorCandidateIds = new Set()
    adminAccounts.forEach((account) => {
      if (account.resolvedRole === 'creator') {
        const accountId = toIdString(account._id)
        if (accountId) creatorCandidateIds.add(accountId)
      }
    })
    for (const creatorId of creatorCoursesById.keys()) creatorCandidateIds.add(creatorId)
    for (const creatorId of creatorSalesById.keys()) creatorCandidateIds.add(creatorId)
    for (const creatorId of creatorEarningsById.keys()) creatorCandidateIds.add(creatorId)
    for (const creatorId of creatorWithdrawalsById.keys()) creatorCandidateIds.add(creatorId)
    for (const creatorId of commissionOverrideByAccountId.keys()) creatorCandidateIds.add(creatorId)

    const creatorAdminRows = Array.from(creatorCandidateIds)
      .filter(Boolean)
      .map((creatorId) => {
        const account = accountById.get(creatorId)
        const identity = creatorIdentityById.get(creatorId) || {}
        const courseStats = creatorCoursesById.get(creatorId) || {
          totalCourses: 0,
          publishedCourses: 0,
          draftCourses: 0,
          pendingCourses: 0,
          archivedCourses: 0,
          activeCourses: 0,
          inactiveCourses: 0,
          enrollmentCount: 0,
          completionCount: 0,
          courses: []
        }
        const salesStats = creatorSalesById.get(creatorId) || {
          saleCount: 0,
          grossMinor: 0,
          creatorCommissionMinor: 0,
          platformShareMinor: 0,
          uniqueLearnerIds: new Set()
        }
        const hasAggregateEarnings = creatorEarningsById.has(creatorId)
        const aggregateEarnings = creatorEarningsById.get(creatorId) || {
          saleCount: 0,
          soldMinor: 0,
          earningsMinor: 0,
          platformShareMinor: 0
        }
        const aggregateWithdrawals = creatorWithdrawalsById.get(creatorId) || {
          requestCount: 0,
          requestedMinor: 0,
          pendingMinor: 0,
          approvedMinor: 0,
          paidMinor: 0,
          rejectedMinor: 0,
          cancelledMinor: 0,
          latestRequestedAt: null
        }
        const saleCount = hasAggregateEarnings
          ? aggregateEarnings.saleCount
          : Math.max(0, Number(salesStats.saleCount || 0))
        const grossMinor = hasAggregateEarnings
          ? aggregateEarnings.soldMinor
          : Math.max(0, Number(salesStats.grossMinor || 0))
        const creatorCommissionMinor = hasAggregateEarnings
          ? aggregateEarnings.earningsMinor
          : Math.max(0, Number(salesStats.creatorCommissionMinor || 0))
        const platformShareMinor = hasAggregateEarnings
          ? aggregateEarnings.platformShareMinor
          : Math.max(0, Number(salesStats.platformShareMinor || 0))
        const availableBalanceMinor = Math.max(0, creatorCommissionMinor - aggregateWithdrawals.paidMinor - aggregateWithdrawals.pendingMinor)
        const payoutProfile = account?.payoutProfile || {}
        const payoutAccountNumber = String(payoutProfile.accountNumber || '').trim()
        const hasCommissionOverride = commissionOverrideByAccountId.has(creatorId)
        const commissionRatePercent = hasCommissionOverride
          ? normalizeCommissionRate(commissionOverrideByAccountId.get(creatorId), commissionSettings.globalRatePercent)
          : commissionSettings.globalRatePercent
        const topCourses = (courseStats.courses || [])
          .slice()
          .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
          .slice(0, 3)
        const enrollmentCount = Math.max(0, Number(courseStats.enrollmentCount || 0))
        const completionCount = Math.max(0, Number(courseStats.completionCount || 0))
        return {
          creatorId,
          creatorName: account?.displayName || identity.creatorName || accountNameById.get(creatorId) || accountEmailById.get(creatorId) || 'Creator',
          creatorEmail: account?.email || identity.creatorEmail || accountEmailById.get(creatorId) || '',
          resolvedRole: account?.resolvedRole || 'creator',
          totalCourses: Math.max(0, Number(courseStats.totalCourses || 0)),
          publishedCourses: Math.max(0, Number(courseStats.publishedCourses || 0)),
          draftCourses: Math.max(0, Number(courseStats.draftCourses || 0)),
          pendingCourses: Math.max(0, Number(courseStats.pendingCourses || 0)),
          archivedCourses: Math.max(0, Number(courseStats.archivedCourses || 0)),
          activeCourses: Math.max(0, Number(courseStats.activeCourses || 0)),
          inactiveCourses: Math.max(0, Number(courseStats.inactiveCourses || 0)),
          enrollmentCount,
          completionCount,
          completionRatePercent: enrollmentCount > 0
            ? Math.round((completionCount / Math.max(1, enrollmentCount)) * 100)
            : 0,
          saleCount,
          uniqueLearnerCount: salesStats.uniqueLearnerIds instanceof Set ? salesStats.uniqueLearnerIds.size : 0,
          grossMinor,
          grossDisplay: formatCurrencyAmount(grossMinor, payoutProfile.currency || 'NGN'),
          creatorCommissionMinor,
          creatorCommissionDisplay: formatCurrencyAmount(creatorCommissionMinor, payoutProfile.currency || 'NGN'),
          platformShareMinor,
          platformShareDisplay: formatCurrencyAmount(platformShareMinor, payoutProfile.currency || 'NGN'),
          withdrawalRequestCount: aggregateWithdrawals.requestCount,
          pendingWithdrawalMinor: aggregateWithdrawals.pendingMinor,
          pendingWithdrawalDisplay: formatCurrencyAmount(aggregateWithdrawals.pendingMinor, payoutProfile.currency || 'NGN'),
          paidWithdrawalMinor: aggregateWithdrawals.paidMinor,
          paidWithdrawalDisplay: formatCurrencyAmount(aggregateWithdrawals.paidMinor, payoutProfile.currency || 'NGN'),
          availableBalanceMinor,
          availableBalanceDisplay: formatCurrencyAmount(availableBalanceMinor, payoutProfile.currency || 'NGN'),
          latestWithdrawalAt: aggregateWithdrawals.latestRequestedAt || null,
          payoutCurrency: payoutProfile.currency || 'NGN',
          payoutBankName: String(payoutProfile.bankName || '').trim(),
          payoutAccountName: String(payoutProfile.accountName || '').trim(),
          payoutAccountNumber,
          payoutAccountMasked: payoutAccountNumber ? `****${payoutAccountNumber.slice(-4)}` : '',
          payoutPaymentEmail: String(payoutProfile.paymentEmail || '').trim(),
          hasPayoutProfile: hasValidPayoutProfile(payoutProfile),
          commissionRatePercent,
          hasCommissionOverride,
          commissionOverrideRatePercent: hasCommissionOverride
            ? normalizeCommissionRate(commissionOverrideByAccountId.get(creatorId), commissionSettings.globalRatePercent)
            : null,
          topCourses,
          coursesPath: `/admin/courses?creatorId=${encodeURIComponent(creatorId)}`,
          creatorPath: `/admin/creators/${encodeURIComponent(creatorId)}`
        }
      })
      .sort((a, b) => {
        if (b.totalCourses !== a.totalCourses) return b.totalCourses - a.totalCourses
        if (b.grossMinor !== a.grossMinor) return b.grossMinor - a.grossMinor
        return String(a.creatorName || '').localeCompare(String(b.creatorName || ''))
      })

    const visibleCreatorAdminRows = adminCreatorFilterId
      ? creatorAdminRows.filter((creator) => creator.creatorId === adminCreatorFilterId)
      : creatorAdminRows
    const visibleAdminWithdrawalRequests = adminCreatorFilterId
      ? adminWithdrawalRequests.filter((request) => request.creatorId === adminCreatorFilterId)
      : adminWithdrawalRequests
    let filteredManagedCourses = adminCreatorFilterId
      ? managedCourses.filter((course) => toIdString(course.createdById || course.createdBy) === adminCreatorFilterId)
      : managedCourses
    if (adminCourseStatusFilter !== 'all') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => String(course.status || '').trim().toLowerCase() === adminCourseStatusFilter)
    }
    if (adminCourseVisibilityFilter !== 'all') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => String(course.visibility || '').trim().toLowerCase() === adminCourseVisibilityFilter)
    }
    if (adminCourseTypeFilter === 'system') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => Boolean(course.isSystemCourse))
    } else if (adminCourseTypeFilter === 'creator') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => !Boolean(course.isSystemCourse))
    }
    if (adminCoursePaymentFilter === 'paid') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => isCoursePaidContent(course))
    } else if (adminCoursePaymentFilter === 'free') {
      filteredManagedCourses = filteredManagedCourses.filter((course) => !isCoursePaidContent(course))
    }
    if (adminCourseSearchFilter) {
      const needle = adminCourseSearchFilter.toLowerCase()
      filteredManagedCourses = filteredManagedCourses.filter((course) => (
        [
          course.title,
          course.summary,
          course.description,
          course.category,
          course.createdByName,
          course.createdByEmail
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ')
          .includes(needle)
      ))
    }

    const pendingReviewCourses = (pendingReviewCoursesRaw || []).map((course) => ({
      ...decorateCourse(course),
      creatorName: course.createdBy?.profile?.name || course.createdByName || course.createdByEmail || 'Author',
      creatorEmail: course.createdBy?.email || course.createdByEmail || '',
      submittedAt: course.submittedForPublicReviewAt || course.updatedAt || course.createdAt
    }))
    const approvalQueueCourses = pendingReviewCourses
      .slice()
      .sort((a, b) => {
        const bTime = new Date(b.submittedAt || 0).getTime()
        const aTime = new Date(a.submittedAt || 0).getTime()
        return bTime - aTime
      })
    const recentCourseReviewDecisions = canManagePlatform(role)
      ? managedCourses
        .filter((course) => {
          const reviewDecision = normalizeCourseReviewDecision(course.reviewDecision)
          return ['approved', 'changes_requested', 'denied'].includes(reviewDecision) && course.reviewedAt
        })
        .map((course) => ({
          ...course,
          creatorName: course.createdByName || course.authorName || 'Author',
          creatorEmail: course.createdByEmail || '',
          submittedAt: course.submittedForPublicReviewAt || course.updatedAt || course.createdAt,
          reviewedAt: course.reviewedAt || course.updatedAt || course.createdAt
        }))
        .sort((a, b) => {
          const bTime = new Date(b.reviewedAt || 0).getTime()
          const aTime = new Date(a.reviewedAt || 0).getTime()
          return bTime - aTime
        })
        .slice(0, 8)
      : []

    const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'
    const templateName = studioPortal
      ? 'course-studio'
      : (adminPortal
          ? 'admin-dashboard'
          : (viewMode === 'settings'
              ? 'simple-lms-settings'
              : (viewMode === 'overview' ? 'simple-lms-workspace' : 'simple-lms')))

    return res.render(templateName, {
      title: studioPortal
        ? `${learningName} - ${resolvedStudioContext === 'admin' ? 'Admin Course Studio' : 'Creator Studio'}`
        : (adminPortal
            ? `${learningName} - Admin`
            : `${learningName} - ${viewMode === 'settings' ? 'Settings' : 'Workspace'}`),
      user: req.user,
      activePage: adminPortal ? 'admin' : 'simple-lms',
      role,
      viewMode,
      adminSection: selectedAdminSection,
      adminReturnTo: adminBasePath,
      adminPortal,
      studioPortal,
      studioContext: resolvedStudioContext,
      creatorStudioPath: '/simple-lms/studio/courses',
      adminStudioPath: '/admin/courses?compose=create',
      courseStudioReturnTo: resolvedStudioContext === 'admin' ? '/admin/courses' : '/simple-lms/studio/courses',
      settingsTab,
      creatorSection,
      canCreateCourses: canCreateCourses(role),
      canManagePlatform: canManagePlatform(role),
      filters: {
        query,
        category: categoryFilter,
        level: LEVELS.includes(levelFilter) ? levelFilter : '',
        sort: sortFilter
      },
      levels: LEVELS,
      sortOptions: SORT_OPTIONS,
      categories: (categoriesRaw || []).map(item => String(item || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      catalogCourses,
      cartCourses: cartCoursesBase,
      cartSummary,
      recommendedCourses,
      catalogPrograms,
      recommendedPrograms,
      managedCourses,
      adminCourses: filteredManagedCourses,
      managedPrograms,
      myEnrollments,
      myPrograms,
      editingCourse,
      editingProgram,
      studioCourses,
      assignableAccounts,
      adminAccounts,
      creatorAdminRows,
      visibleCreatorAdminRows,
      adminWithdrawalRequests: visibleAdminWithdrawalRequests,
      myPayments,
      myCreatorSales,
      creatorStats,
      creatorWalletSummary,
      creatorWithdrawalRequests,
      creatorCourseInsights,
      creatorSettings,
      partnerApplicationState,
      payoutProfile: req.user.payoutProfile || {},
      adminPayments,
      adminPaymentFilters: {
        status: paymentStatusFilter,
        currency: paymentCurrencyFilter,
        dateFrom: paymentFromFilter,
        dateTo: paymentToFilter,
        search: paymentSearchFilter,
        returnTo: adminPaymentsReturnTo
      },
      adminCourseFilters: {
        creatorId: adminCreatorFilterId,
        status: adminCourseStatusFilter,
        visibility: adminCourseVisibilityFilter,
        type: adminCourseTypeFilter,
        paymentMode: adminCoursePaymentFilter,
        search: adminCourseSearchFilter,
        composeMode: adminCourseComposeMode,
        returnTo: adminCoursesReturnTo
      },
      adminCreatorFilters: {
        creatorId: adminCreatorFilterId,
        returnTo: adminCreatorsReturnTo
      },
      paymentStatuses: PAYMENT_STATUSES,
      paymentCurrencies: currencyCatalog.codes,
      supportedCurrencies: currencyCatalog.currencies,
      defaultCurrencyCode: currencyCatalog.defaultCurrencyCode,
      paymentStats: {
        ...paymentStats,
        revenueDisplay: formatCurrencyAmount(paymentStats.revenueMinor, 'NGN'),
        creatorPayoutDisplay: formatCurrencyAmount(paymentStats.creatorPayoutMinor, 'NGN')
      },
      analytics,
      reportFilters,
      dailySalesReport,
      commissionReport,
      churnMetrics,
      platformSettings,
      paymentGatewaySettings,
      canManagePaymentGateways,
      credentialsEncryptionConfigured: isCredentialEncryptionConfigured(),
      flutterwave: {
        enabled: Boolean(paymentGatewaySettings?.providers?.flutterwave?.configured),
        publicKey: ''
      },
      pendingReviewCourses,
      approvalQueueCourses,
      recentCourseReviewDecisions,
      partnerOrganizations,
      partnerWithdrawalRequests,
      roleApprovalRequests,
      superUserAccounts,
      adminInviteRows,
      auditLogEntries,
      agentPayoutRows,
      commissionSettings: {
        globalRatePercent: commissionSettings.globalRatePercent,
        accountOverrides: commissionAccountOverrides,
        courseOverrides: commissionCourseOverrides
      },
      continueLearningCards,
      recommendedLearningCards,
      workspaceStats,
      roleBreakdown,
      stats: {
        publishedCourseCount: totalPublishedCourses,
        publishedProgramCount: totalPublishedPrograms,
        learnerCount: totalAccounts,
        creatorCount: totalCreators,
        completionCount: completedEnrollments,
        myEnrollmentCount: myEnrollments.length,
        myPaidCourseCount: myPayments.length,
        cartItemCount: cartSummary.itemCount
      },
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    const pageLabel = studioPortal
      ? `${studioContext === 'admin' ? 'admin' : 'creator'} studio`
      : (adminPortal ? 'admin portal' : 'workspace')
    console.error(`Simple LMS ${pageLabel} load error:`, error)
    return redirectWithMessage({
      res,
      path: studioPortal
        ? (studioContext === 'admin' ? '/admin/courses' : '/simple-lms/studio/courses')
        : (adminPortal ? '/admin' : '/simple-lms'),
      error: studioPortal
        ? 'Failed to load course studio.'
        : (adminPortal ? 'Failed to load admin portal.' : 'Failed to load workspace.')
    })
  }
}

pageRouter.get('/studio/courses', requirePageAuth, async (req, res) => (
  renderWorkspacePage(req, res, {
    forcedViewMode: 'course-studio',
    studioPortal: true,
    studioContext: 'creator'
  })
))

pageRouter.get('/', requirePageAuth, async (req, res) => renderWorkspacePage(req, res))

const renderAdminPortalSection = (section = 'overview') => async (req, res) => (
  renderWorkspacePage(req, res, {
    forcedViewMode: 'admin',
    adminPortal: true,
    adminSection: section
  })
)

adminPageRouter.get('/', requireAdminPageAuth, renderAdminPortalSection('overview'))
adminPageRouter.get('/courses', requireAdminPageAuth, renderAdminPortalSection('courses'))
adminPageRouter.get('/approvals', requireAdminPageAuth, renderAdminPortalSection('approvals'))
adminPageRouter.get('/partners', requireAdminPageAuth, renderAdminPortalSection('partners'))
adminPageRouter.get('/super-users', requireAdminPageAuth, renderAdminPortalSection('super-users'))
adminPageRouter.get('/audit-log', requireAdminPageAuth, renderAdminPortalSection('audit-log'))
adminPageRouter.get('/creators', requireAdminPageAuth, renderAdminPortalSection('creators'))
adminPageRouter.get('/creators/:creatorId', requireAdminPageAuth, (req, res) => {
  const creatorId = String(req.params.creatorId || '').trim()
  if (!mongoose.Types.ObjectId.isValid(creatorId)) {
    return redirectWithMessage({
      res,
      path: '/admin/creators',
      error: 'Invalid creator selected.'
    })
  }

  return res.redirect(`/admin/creators?creatorId=${encodeURIComponent(creatorId)}`)
})
adminPageRouter.get('/users', requireAdminPageAuth, renderAdminPortalSection('users'))
adminPageRouter.get('/commission', requireAdminPageAuth, renderAdminPortalSection('commission'))
adminPageRouter.get('/payments', requireAdminPageAuth, renderAdminPortalSection('payments'))
adminPageRouter.get('/settings', requireAdminPageAuth, renderAdminPortalSection('settings'))
adminPageRouter.get('/analytics', requireAdminPageAuth, renderAdminPortalSection('analytics'))

adminPageRouter.get('/course-studio', requireAdminPageAuth, async (req, res) => {
  const params = new URLSearchParams(req.query || {})
  if (!params.has('compose') && !params.has('editCourse')) {
    params.set('compose', 'create')
  }
  const queryString = params.toString()
  const targetHash = params.has('editCourse') ? '#edit-course' : '#create-course'
  return res.redirect(queryString ? `/admin/courses?${queryString}${targetHash}` : `/admin/courses${targetHash}`)
})

apiRouter.post('/payments/flutterwave/webhook', async (req, res) => {
  try {
    const configuredHash = await getFlutterwaveWebhookHash()
    if (configuredHash) {
      const receivedHash = String(req.headers['verif-hash'] || '').trim()
      if (!signaturesMatch(receivedHash, configuredHash)) {
        return res.status(401).json({ error: 'Invalid webhook signature.' })
      }
    }

    const event = String(req.body?.event || '').trim()
    const payload = req.body?.data || {}
    if (event !== 'charge.completed' || !payload) {
      return res.json({ ok: true })
    }

    const txRef = String(payload.tx_ref || '').trim()
    const transactionId = String(payload.id || '').trim()
    if (!txRef || !transactionId) {
      return res.json({ ok: true })
    }

    const payment = await SimpleLmsPayment.findOne({
      txRef,
      provider: 'flutterwave'
    })
    if (!payment) {
      return res.json({ ok: true })
    }
    if (String(payment.status || '').trim().toLowerCase() === 'successful') {
      const courseForAttribution = await SimpleLmsCourse.findById(payment.course)
        .select('_id organization createdBy')
        .lean()
      if (courseForAttribution?._id) {
        await createOrUpdateAgentAttributionForPayment({
          payment,
          course: courseForAttribution
        })
      }
      return res.json({ ok: true })
    }

    const verificationResult = await verifyFlutterwavePaymentRecord({
      payment,
      transactionId
    })
    if (!verificationResult.success) {
      payment.status = 'failed'
      await payment.save()
      return res.json({ ok: true })
    }

    const courseForCommission = await SimpleLmsCourse.findById(payment.course)
      .select('_id organization createdBy')
    if (!courseForCommission?._id) {
      payment.status = 'failed'
      await payment.save()
      return res.json({ ok: true })
    }

    await markPaymentSuccessful({
      payment,
      course: courseForCommission,
      paidAt: verificationResult.paidAt || new Date()
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('Flutterwave webhook error:', error)
    return res.status(500).json({ error: 'Webhook processing failed.' })
  }
})

apiRouter.post('/payments/paystack/webhook', async (req, res) => {
  try {
    const secretKey = await getPaystackSecretKey()
    if (!secretKey) {
      return res.status(401).json({ error: 'Paystack webhook secret is not configured.' })
    }
    const payloadString = req.rawBody || JSON.stringify(req.body || {})
    const expectedSignature = crypto
      .createHmac('sha512', secretKey)
      .update(payloadString)
      .digest('hex')
    const receivedSignature = String(req.headers['x-paystack-signature'] || '').trim()
    if (!signaturesMatch(receivedSignature, expectedSignature)) {
      return res.status(401).json({ error: 'Invalid webhook signature.' })
    }

    const event = String(req.body?.event || '').trim()
    const payload = req.body?.data || {}
    if (event !== 'charge.success' || !payload) {
      return res.json({ ok: true })
    }

    const reference = String(payload.reference || '').trim()
    if (!reference) {
      return res.json({ ok: true })
    }

    const payment = await SimpleLmsPayment.findOne({
      provider: 'paystack',
      $or: [
        { txRef: reference },
        { paystackReference: reference }
      ]
    })
    if (!payment) {
      return res.json({ ok: true })
    }
    if (String(payment.status || '').trim().toLowerCase() === 'successful') {
      const courseForAttribution = await SimpleLmsCourse.findById(payment.course)
        .select('_id organization createdBy')
        .lean()
      if (courseForAttribution?._id) {
        await createOrUpdateAgentAttributionForPayment({
          payment,
          course: courseForAttribution
        })
      }
      return res.json({ ok: true })
    }

    const verificationResult = await verifyPaystackPaymentRecord({
      payment,
      reference
    })
    if (!verificationResult.success) {
      payment.status = 'failed'
      await payment.save()
      return res.json({ ok: true })
    }

    const courseForCommission = await SimpleLmsCourse.findById(payment.course)
      .select('_id organization createdBy')
    if (!courseForCommission?._id) {
      payment.status = 'failed'
      await payment.save()
      return res.json({ ok: true })
    }

    await markPaymentSuccessful({
      payment,
      course: courseForCommission,
      paidAt: verificationResult.paidAt || new Date()
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('Paystack webhook error:', error)
    return res.status(500).json({ error: 'Webhook processing failed.' })
  }
})

pageRouter.post('/withdrawals/request', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=creator',
    '/simple-lms?view=settings&settingsTab=creator'
  )
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only creators can request withdrawals.'
      })
    }

    const amountMinor = parseAmountToMinor(req.body.amount)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Enter a valid withdrawal amount.'
      })
    }

    if (!hasValidPayoutProfile(req.user.payoutProfile || {})) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Please complete your payout profile first.'
      })
    }

    const walletSnapshot = await getCreatorWalletSnapshot(req.user._id)
    if (amountMinor > walletSnapshot.availableBalanceMinor) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: `Withdrawal exceeds available balance (${formatCurrencyAmount(walletSnapshot.availableBalanceMinor, req.user?.payoutProfile?.currency || 'NGN')}).`
      })
    }

    const payoutProfile = req.user.payoutProfile || {}
    const currencyCatalog = await getActiveCurrencyCatalog()
    const currency = normalizeCurrencyCode(
      req.body.currency,
      payoutProfile.currency || currencyCatalog.defaultCurrencyCode || DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
      currencyCatalog.codes
    )
    await SimpleLmsWithdrawal.create({
      creatorAccount: req.user._id,
      amountMinor,
      currency,
      status: 'pending',
      requestedAt: new Date(),
      notes: String(req.body.notes || '').trim().slice(0, 1200),
      payoutProfileSnapshot: {
        accountName: String(payoutProfile.accountName || '').trim().slice(0, 200),
        accountNumber: String(payoutProfile.accountNumber || '').trim().slice(0, 64),
        bankName: String(payoutProfile.bankName || '').trim().slice(0, 200),
        bankCode: String(payoutProfile.bankCode || '').trim().slice(0, 80),
        swiftCode: String(payoutProfile.swiftCode || '').trim().slice(0, 80),
        paymentEmail: String(payoutProfile.paymentEmail || '').trim().toLowerCase().slice(0, 320),
        country: String(payoutProfile.country || '').trim().slice(0, 80),
        notes: String(payoutProfile.notes || '').trim().slice(0, 1200)
      }
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Withdrawal request submitted for admin review.'
    })
  } catch (error) {
    console.error('Create withdrawal request error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to submit withdrawal request.'
    })
  }
})

pageRouter.post('/withdrawals/:withdrawalId/cancel', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=creator',
    '/simple-lms?view=settings&settingsTab=creator'
  )
  try {
    const withdrawalId = String(req.params.withdrawalId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid withdrawal request selected.'
      })
    }

    const role = resolveRole(req.user)
    const withdrawal = await SimpleLmsWithdrawal.findById(withdrawalId)
    if (!withdrawal) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Withdrawal request not found.'
      })
    }

    const isOwner = toIdString(withdrawal.creatorAccount) === toIdString(req.user._id)
    if (!isOwner && !canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to cancel this withdrawal request.'
      })
    }

    const status = normalizeWithdrawalStatus(withdrawal.status, 'pending')
    if (!['pending', 'approved'].includes(status)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only pending or approved withdrawal requests can be cancelled.'
      })
    }

    withdrawal.status = 'cancelled'
    withdrawal.reviewedBy = req.user._id
    withdrawal.reviewedAt = new Date()
    const cancelNote = String(req.body.cancelNote || '').trim().slice(0, 300)
    if (cancelNote) {
      withdrawal.adminNotes = [withdrawal.adminNotes, `Cancelled: ${cancelNote}`]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 3000)
    }
    await withdrawal.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Withdrawal request cancelled.'
    })
  } catch (error) {
    console.error('Cancel withdrawal request error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to cancel withdrawal request.'
    })
  }
})

pageRouter.post('/admin/withdrawals/:withdrawalId/status', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req, '/admin/creators')
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update withdrawal requests.'
      })
    }

    const withdrawalId = String(req.params.withdrawalId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid withdrawal request selected.'
      })
    }

    const nextStatus = normalizeWithdrawalStatus(req.body.status, '')
    if (!['approved', 'rejected', 'paid', 'cancelled'].includes(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid withdrawal status.'
      })
    }

    const withdrawal = await SimpleLmsWithdrawal.findById(withdrawalId)
    if (!withdrawal) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Withdrawal request not found.'
      })
    }

    const currentStatus = normalizeWithdrawalStatus(withdrawal.status, 'pending')
    const allowedTransitions = {
      pending: new Set(['approved', 'rejected', 'paid', 'cancelled']),
      approved: new Set(['paid', 'rejected', 'cancelled']),
      paid: new Set(),
      rejected: new Set(),
      cancelled: new Set()
    }
    if (currentStatus !== nextStatus && !allowedTransitions[currentStatus]?.has(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: `Cannot move withdrawal from ${formatWithdrawalStatusLabel(currentStatus)} to ${formatWithdrawalStatusLabel(nextStatus)}.`
      })
    }

    withdrawal.status = nextStatus
    withdrawal.reviewedBy = req.user._id
    withdrawal.reviewedAt = new Date()
    withdrawal.adminNotes = String(req.body.adminNotes || '').trim().slice(0, 3000)

    if (nextStatus === 'paid') {
      withdrawal.paidAt = new Date()
      withdrawal.paidBy = req.user._id
      withdrawal.transactionRef = String(req.body.transactionRef || '').trim().slice(0, 120)
    } else if (currentStatus !== 'paid') {
      withdrawal.paidAt = null
      withdrawal.paidBy = null
      withdrawal.transactionRef = ''
    }

    await withdrawal.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Withdrawal request marked as ${formatWithdrawalStatusLabel(nextStatus)}.`
    })
  } catch (error) {
    console.error('Update admin withdrawal status error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update withdrawal request.'
    })
  }
})

pageRouter.post('/admin/partner-withdrawals/:withdrawalId/status', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req, '/admin/partners')
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can update partner withdrawal requests.'
      })
    }

    const withdrawalId = String(req.params.withdrawalId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Invalid partner withdrawal selected.'
      })
    }

    const nextStatus = normalizeWithdrawalStatus(req.body.status, '')
    if (!['approved', 'rejected', 'paid', 'cancelled'].includes(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Select a valid partner withdrawal status.'
      })
    }

    const withdrawal = await PartnerWithdrawal.findById(withdrawalId)
    if (!withdrawal) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Partner withdrawal request not found.'
      })
    }

    const currentStatus = normalizeWithdrawalStatus(withdrawal.status, 'pending')
    const allowedTransitions = {
      pending: new Set(['approved', 'rejected', 'paid', 'cancelled']),
      approved: new Set(['paid', 'rejected', 'cancelled']),
      paid: new Set(),
      rejected: new Set(),
      cancelled: new Set()
    }
    if (currentStatus !== nextStatus && !allowedTransitions[currentStatus]?.has(nextStatus)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: `Cannot move partner withdrawal from ${formatWithdrawalStatusLabel(currentStatus)} to ${formatWithdrawalStatusLabel(nextStatus)}.`
      })
    }

    withdrawal.status = nextStatus
    withdrawal.reviewedBy = req.user._id
    withdrawal.reviewedAt = new Date()
    withdrawal.adminNotes = String(req.body.adminNotes || '').trim().slice(0, 3000)

    if (nextStatus === 'paid') {
      withdrawal.paidAt = new Date()
      withdrawal.paidBy = req.user._id
      withdrawal.transactionRef = String(req.body.transactionRef || '').trim().slice(0, 120)
    } else if (currentStatus !== 'paid') {
      withdrawal.paidAt = null
      withdrawal.paidBy = null
      withdrawal.transactionRef = ''
    }

    await withdrawal.save()

    await logAuditEvent({
      action: nextStatus === 'approved'
        ? 'partner.withdrawal.approve'
        : (nextStatus === 'paid'
            ? 'partner.withdrawal.paid'
            : 'partner.withdrawal.reject'),
      performedBy: req.user._id,
      targetOrganization: withdrawal.organization || null,
      metadata: {
        withdrawalId: withdrawal._id,
        previousStatus: currentStatus,
        nextStatus,
        transactionRef: withdrawal.transactionRef || ''
      },
      req
    })

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Partner withdrawal request marked as ${formatWithdrawalStatusLabel(nextStatus)}.`
    })
  } catch (error) {
    console.error('Update partner withdrawal status error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to update partner withdrawal request.'
    })
  }
})

pageRouter.post('/profile/payout', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=payments',
    '/simple-lms?view=settings&settingsTab=payments'
  )
  try {
    const currencyCatalog = await getActiveCurrencyCatalog()
    req.user.payoutProfile = req.user.payoutProfile || {}
    req.user.payoutProfile.accountName = String(req.body.accountName || '').trim().slice(0, 200)
    req.user.payoutProfile.accountNumber = String(req.body.accountNumber || '').trim().slice(0, 64)
    req.user.payoutProfile.bankName = String(req.body.bankName || '').trim().slice(0, 200)
    req.user.payoutProfile.bankCode = String(req.body.bankCode || '').trim().slice(0, 80)
    req.user.payoutProfile.swiftCode = String(req.body.swiftCode || '').trim().slice(0, 80)
    req.user.payoutProfile.currency = normalizeCurrencyCode(
      req.body.currency,
      req.user.payoutProfile.currency || currencyCatalog.defaultCurrencyCode || DEFAULT_SIMPLE_LMS_CURRENCY_CODE,
      currencyCatalog.codes
    )
    req.user.payoutProfile.paymentEmail = String(req.body.paymentEmail || '').trim().toLowerCase().slice(0, 320)
    req.user.payoutProfile.country = String(req.body.country || '').trim().slice(0, 80)
    req.user.payoutProfile.notes = String(req.body.notes || '').trim().slice(0, 1200)
    req.user.payoutProfile.updatedAt = new Date()
    await req.user.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: 'Payout details saved.'
    })
  } catch (error) {
    console.error('Update payout profile error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to save payout details.'
    })
  }
})

apiRouter.use(requireApiAuth)
reportsApiRouter.use(requireApiAuth)

mountReportRoutes(apiRouter, '/reports')
mountReportRoutes(reportsApiRouter, '')

apiRouter.get('/workspace', async (_req, res) => res.redirect('/simple-lms'))

apiRouter.get('/admin/payment-settings', async (req, res) => {
  try {
    const role = resolveRole(req.user)
    ensureSuperAdminForPaymentSettings(role)
    const settings = await buildPaymentGatewaySettingsResponse({ req })
    return res.json({
      settings,
      encryptionConfigured: isCredentialEncryptionConfigured()
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    return res.status(statusCode).json({
      error: statusCode === 403
        ? 'Only super admins can access payment gateway settings.'
        : (error?.message || 'Failed to load payment gateway settings.')
    })
  }
})

apiRouter.put('/admin/payment-settings', async (req, res) => {
  try {
    const role = resolveRole(req.user)
    ensureSuperAdminForPaymentSettings(role)
    const settings = await applyPaymentGatewaySettingsUpdate({
      req,
      payload: req.body || {}
    })
    return res.json({
      message: 'Payment gateway settings updated.',
      settings
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    return res.status(statusCode).json({
      error: statusCode === 403
        ? 'Only super admins can manage payment gateway settings.'
        : (error?.message || 'Failed to update payment gateway settings.')
    })
  }
})

apiRouter.post('/upload/banner', upload.single('banner'), async (req, res) => {
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return res.status(403).json({ error: 'You do not have permission to upload banners.' })
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No banner file uploaded.' })
    }

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured for banner uploads.' })
    }

    const uploadResult = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${slugifyValue(req.file.originalname || 'banner', 'banner')}`,
      folder: 'seemplify-learning/course-banners',
      resourceType: 'image'
    })

    return res.json({
      message: 'Banner uploaded successfully.',
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height
    })
  } catch (error) {
    console.error('Banner upload error:', error)
    return res.status(500).json({ error: 'Failed to upload banner.' })
  }
})

apiRouter.post('/upload/lesson-media', lessonMediaUpload.single('media'), async (req, res) => {
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return res.status(403).json({ error: 'You do not have permission to upload lesson media.' })
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No lesson media file uploaded.' })
    }

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured for lesson uploads.' })
    }

    const mimeType = String(req.file.mimetype || '').trim().toLowerCase()
    const normalizedResourceType = mimeType.startsWith('audio/')
      ? 'audio'
      : (mimeType.startsWith('video/') ? 'video' : 'raw')

    const uploadResult = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${slugifyValue(req.file.originalname || 'lesson-media', 'lesson-media')}`,
      folder: 'seemplify-learning/lesson-media',
      resourceType: normalizedResourceType === 'raw' ? 'raw' : 'video'
    })

    const durationSeconds = Number.isFinite(Number(uploadResult.duration))
      ? Math.max(0, Number(uploadResult.duration))
      : 0
    const durationMinutes = durationSeconds > 0 ? Math.max(1, Math.ceil(durationSeconds / 60)) : 0
    const lessonMedia = {
      provider: 'cloudinary',
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      resourceType: normalizedResourceType,
      format: String(uploadResult.format || '').trim().toLowerCase(),
      bytes: Number.isFinite(Number(uploadResult.bytes)) ? Number(uploadResult.bytes) : 0,
      width: Number.isFinite(Number(uploadResult.width)) ? Number(uploadResult.width) : 0,
      height: Number.isFinite(Number(uploadResult.height)) ? Number(uploadResult.height) : 0,
      durationSeconds,
      sourceLabel: normalizedResourceType === 'audio' ? 'Cloudinary Audio' : 'Cloudinary Video'
    }

    return res.json({
      message: 'Lesson media uploaded successfully.',
      lessonMedia,
      durationMinutes
    })
  } catch (error) {
    console.error('Lesson media upload error:', error)
    return res.status(500).json({ error: 'Failed to upload lesson media.' })
  }
})

apiRouter.post('/courses/:courseId/enroll', async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    }).lean()

    if (!course) {
      return res.status(404).json({ error: 'Course not found or unavailable.' })
    }

    if (isCoursePaidContent(course)) {
      const hasSuccessfulPayment = await SimpleLmsPayment.exists({
        account: req.user._id,
        course: course._id,
        status: 'successful'
      })
      if (!hasSuccessfulPayment) {
        return res.status(402).json({
          error: 'Payment required before enrollment.',
          requiresPayment: true
        })
      }
    }

    const enrollmentResult = await createOrUpdateEnrollment({
      courseId: course._id,
      learnerId: req.user._id,
      actorId: req.user._id,
      assignmentType: 'self',
      source: 'self_enroll'
    })
    const enrollment = enrollmentResult.enrollment

    const lessons = flattenCourseLessons(course)
    const firstLessonKey = lessons[0]?.lessonKey || ''
    return res.json({
      message: 'Enrollment successful.',
      alreadyEnrolled: !enrollmentResult.created,
      redirectUrl: firstLessonKey
        ? `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(firstLessonKey)}`
        : '/simple-lms?view=my-learning'
    })
  } catch (error) {
    console.error('Enroll API error:', error)
    return res.status(500).json({ error: 'Failed to enroll in course.' })
  }
})

apiRouter.post('/enrollments/:enrollmentId/viewed', async (req, res) => {
  try {
    const enrollmentId = String(req.params.enrollmentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: 'Invalid enrollment id.' })
    }

    const enrollment = await SimpleLmsEnrollment.findOne({
      _id: enrollmentId,
      enrolledMember: req.user._id
    })

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' })
    }

    enrollment.lastViewedAt = new Date()
    enrollment.lastActivityAt = enrollment.lastActivityAt || new Date()
    await enrollment.save()

    return res.json({ message: 'Enrollment marked as viewed.' })
  } catch (error) {
    console.error('Viewed API error:', error)
    return res.status(500).json({ error: 'Failed to mark enrollment viewed.' })
  }
})

export {
  pageRouter as simpleLmsRouter,
  adminPageRouter as simpleLmsAdminRouter,
  apiRouter as simpleLmsApiRouter,
  reportsApiRouter as simpleLmsReportsApiRouter
}
export default pageRouter

