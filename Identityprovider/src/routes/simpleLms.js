import express from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { MongoAdapter } from '../adapter/mongoAdapter.js'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Notification } from '../models/Notification.js'
import { emailService } from '../services/emailService.js'
import { uploadBufferToCloudinary } from '../services/cloudinaryService.js'
import { subscriptionService } from '../services/subscriptionService.js'
import { resolveOrganizationAuthorization } from '../services/accessControlService.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsProgram } from '../models/SimpleLmsProgram.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { SimpleLmsRequest } from '../models/SimpleLmsRequest.js'
import { SimpleLmsPermission } from '../models/SimpleLmsPermission.js'
import {
  SIMPLE_LMS_ORG_MANAGER_ROLES,
  getSimpleLmsAccessScope,
  getOrganizationMembersWithTeamContext,
  toIdString,
  slugifyValue,
  calculateProgress,
  extractLessonKeys
} from '../utils/simpleLms.js'

const pageRouter = express.Router()
const apiRouter = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
})

const VALID_VIEW_MODES = new Set(['overview', 'catalog', 'my-learning', 'manage', 'course-studio', 'program-studio', 'requests'])
const SUPPORTED_SIMPLE_LMS_CURRENCIES = Object.freeze([
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'GHS', name: 'Ghanaian Cedi' },
  { code: 'ZAR', name: 'South African Rand' }
])
const SUPPORTED_SIMPLE_LMS_CURRENCY_CODES = new Set(
  SUPPORTED_SIMPLE_LMS_CURRENCIES.map(currency => currency.code)
)

const htmlEscape = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const parseJsonInput = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const normalizeCurrencyCode = (value, fallback = 'NGN') => {
  const normalized = String(value || '').trim().toUpperCase().slice(0, 3)
  if (SUPPORTED_SIMPLE_LMS_CURRENCY_CODES.has(normalized)) {
    return normalized
  }
  if (fallback === undefined || fallback === null || fallback === '') {
    return ''
  }
  const fallbackCurrency = String(fallback || '').trim().toUpperCase().slice(0, 3)
  if (SUPPORTED_SIMPLE_LMS_CURRENCY_CODES.has(fallbackCurrency)) {
    return fallbackCurrency
  }
  return 'NGN'
}

const normalizeCurrencyList = (currenciesInput = []) => {
  const source = Array.isArray(currenciesInput) ? currenciesInput : [currenciesInput]
  const normalized = []
  source.forEach((value) => {
    const code = normalizeCurrencyCode(value, '')
    if (!code) return
    if (!normalized.includes(code)) {
      normalized.push(code)
    }
  })
  return normalized
}

const getSimpleLmsCurrencySettings = (organization) => {
  const simpleLmsSettings = organization?.settings?.simpleLms || {}
  const defaultCurrency = normalizeCurrencyCode(simpleLmsSettings.defaultCurrency, 'NGN')
  const allowedCurrencies = normalizeCurrencyList(simpleLmsSettings.allowedCurrencies || [])
  if (!allowedCurrencies.includes(defaultCurrency)) {
    allowedCurrencies.unshift(defaultCurrency)
  }

  return {
    defaultCurrency,
    allowedCurrencies: allowedCurrencies.length > 0 ? allowedCurrencies : [defaultCurrency]
  }
}

const formatCurrencyAmount = (amountMinor, currency) => {
  const normalizedCurrency = normalizeCurrencyCode(currency, 'NGN')
  const amount = Number.isFinite(Number(amountMinor)) ? Number(amountMinor) : 0
  const majorAmount = amount / 100

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency
    }).format(majorAmount)
  } catch {
    return `${normalizedCurrency} ${majorAmount.toFixed(2)}`
  }
}

const decorateCoursePricing = (course, currencySettings) => {
  if (!course) return course

  const paymentMode = course?.pricing?.paymentMode === 'paid' ? 'paid' : 'free'
  const amount = Number.isFinite(Number(course?.pricing?.amount))
    ? Math.max(0, Math.round(Number(course.pricing.amount)))
    : 0
  const currency = normalizeCurrencyCode(
    course?.pricing?.currency,
    currencySettings?.defaultCurrency || 'NGN'
  )
  const displayPrice = paymentMode === 'paid' && amount > 0
    ? formatCurrencyAmount(amount, currency)
    : 'Free'

  return {
    ...course,
    pricing: {
      ...(course.pricing || {}),
      paymentMode,
      amount,
      currency
    },
    displayPrice
  }
}

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
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

const sanitizeChaptersInput = (input) => {
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

      const lessonKey = String(
        rawLesson?.key ||
        `${chapterKey}-lesson-${lessonIndex + 1}`
      )
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

      const rawQuestions = Array.isArray(rawLesson?.quizQuestions)
        ? rawLesson.quizQuestions
        : []
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

      lessons.push({
        key: lessonKey || `${chapterKey}-lesson-${lessonIndex + 1}`,
        title: lessonTitle.slice(0, 200),
        description: String(rawLesson?.description || '').trim().slice(0, 3000),
        videoUrl: String(rawLesson?.videoUrl || '').trim().slice(0, 2000),
        content: String(rawLesson?.content || '').trim().slice(0, 40000),
        durationMinutes: Number.isFinite(Number(rawLesson?.durationMinutes))
          ? Math.max(0, Math.round(Number(rawLesson.durationMinutes)))
          : 0,
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

const getMetadataValue = (metadata, key, fallback = null) => {
  if (!metadata) return fallback
  if (typeof metadata.get === 'function') {
    const mapValue = metadata.get(key)
    return mapValue === undefined ? fallback : mapValue
  }
  if (Object.prototype.hasOwnProperty.call(metadata, key)) {
    return metadata[key]
  }
  return fallback
}

const isPlatformAdmin = (account) => Boolean(account?.isSystemAdmin || account?.isSuperAdmin)

const canManageOrganizationData = (memberRole) => SIMPLE_LMS_ORG_MANAGER_ROLES.includes(memberRole)

const hasLmsPermission = (orgContext, permissionId) => (
  orgContext?.lmsPermissions instanceof Set && orgContext.lmsPermissions.has(permissionId)
)

const hasOrganizationWideLmsScope = (orgContext) => [
  'edit_any_course',
  'delete_any_course',
  'manage_course_content',
  'manage_enrollments',
  'view_enrollments',
  'view_student_progress',
  'view_analytics',
  'view_all_analytics',
  'manage_lms_settings',
  'manage_user_roles'
].some(permissionId => hasLmsPermission(orgContext, permissionId))

const requireLmsPermission = (res, orgContext, permissionId, message) => {
  if (hasLmsPermission(orgContext, permissionId)) return true
  res.status(403).json({
    error: message || `The IdP has not granted ${permissionId}.`,
    code: 'IDP_PERMISSION_REQUIRED',
    permission: `lms:${permissionId}`
  })
  return false
}

const rejectIdpManagedLmsPermission = (req, res) => res.status(409).json({
  error: 'Publishing permissions are managed in the IdP permission matrix.',
  code: 'IDP_ACCESS_CONTROL_REQUIRED',
  manageUrl: toIdString(req.user?.currentOrganization)
    ? `/organizations/${toIdString(req.user.currentOrganization)}/access-control`
    : '/organizations'
})

async function getSessionFromCookies(req) {
  try {
    const sessionCookie = req.cookies?._session
    if (!sessionCookie) return null

    const adapter = new MongoAdapter('Session')
    const sessionData = await adapter.find(sessionCookie)
    if (!sessionData?.accountId) return null

    return Account.findOne({ sub: sessionData.accountId })
  } catch (error) {
    console.error('Simple LMS session cookie lookup failed:', error.message)
    return null
  }
}

async function resolveAuthenticatedAccount(req) {
  if (req.session?.accountId) {
    const account = await Account.findOne({ sub: req.session.accountId })
    if (account) {
      return account
    }
  }

  const cookieAccount = await getSessionFromCookies(req)
  if (cookieAccount) {
    req.session = req.session || {}
    req.session.accountId = cookieAccount.sub
    return cookieAccount
  }

  return null
}

const requirePageAuth = async (req, res, next) => {
  const account = await resolveAuthenticatedAccount(req)
  if (!account) {
    return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
  }
  req.user = account
  next()
}

const requireApiAuth = async (req, res, next) => {
  const account = await resolveAuthenticatedAccount(req)
  if (!account) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.user = account
  next()
}

const hasCurrentOrganizationActiveSubscription = async (account) => {
  const organizationId = toIdString(account?.currentOrganization)
  if (!organizationId) {
    return true
  }

  const subscription = await subscriptionService.getSubscriptionForOrg(organizationId)
  if (!subscription || subscription.status !== 'active' || !subscription.endDate) {
    return false
  }

  return new Date(subscription.endDate).getTime() >= Date.now()
}

const requirePageSubscriptionAccess = async (req, res, next) => {
  if (await hasCurrentOrganizationActiveSubscription(req.user)) {
    return next()
  }

  return res.redirect('/?subscription=locked')
}

const requireApiSubscriptionAccess = async (req, res, next) => {
  if (await hasCurrentOrganizationActiveSubscription(req.user)) {
    return next()
  }

  return res.status(403).json({
    error: 'Simple LMS is locked until another plan is approved for the current organization.',
    requiresPlanRequest: true
  })
}

const resolveCurrentOrganizationContext = async (account) => {
  const organizationId = toIdString(account?.currentOrganization)
  if (!organizationId) {
    return { error: 'Select an organization before using Simple LMS.' }
  }

  const organization = await Organization.findById(organizationId)
    .select('name members departments accessControl settings')
    .lean()
  if (!organization) {
    return { error: 'Organization not found for current session.' }
  }

  const memberRecord = (organization.members || []).find(member => (
    member.status === 'active' &&
    toIdString(member.account) === toIdString(account._id)
  ))
  if (!memberRecord) {
    return { error: 'You are not an active member of the current organization.' }
  }

  const authorization = await resolveOrganizationAuthorization({
    account,
    organization,
    member: memberRecord
  })
  const lmsPermissions = new Set(authorization?.permissionsByApp?.lms || [])

  if (!authorization || !Object.prototype.hasOwnProperty.call(authorization.permissionsByApp || {}, 'lms')) {
    return { error: 'Simple LMS access is not assigned by the IdP for this organization.' }
  }

  return {
    organizationId,
    organizationName: organization.name || 'Organization',
    memberRole: memberRecord.role,
    organization,
    authorization,
    lmsPermissions
  }
}

const getLmsPlanAccess = async (organizationId) => {
  const [subscription, features, limits] = await Promise.all([
    subscriptionService.getSubscriptionForOrg(organizationId),
    subscriptionService.getEffectiveFeatures(organizationId),
    subscriptionService.getEffectiveLimits(organizationId)
  ])

  const maxSystemCourses = Object.prototype.hasOwnProperty.call(limits || {}, 'maxSystemCourses')
    ? limits.maxSystemCourses
    : null

  return {
    hasLmsFeature: Boolean(features?.lms),
    planName: subscription?.plan?.name || null,
    maxSystemCourses
  }
}

const buildAssignableMembers = ({ orgMembers, scope, accountId }) => {
  if (scope.canManageOrganization) {
    return orgMembers
      .filter(member => member.accountId !== toIdString(accountId))
      .map(member => ({
        ...member,
        canAssign: true
      }))
  }

  const manageableSet = scope.manageableMemberIdSet
  return orgMembers
    .filter(member => manageableSet.has(member.accountId))
    .map(member => ({
      ...member,
      canAssign: true
    }))
}

const canManageCourse = ({
  course,
  accountId,
  memberRole,
  scope,
  platformAdmin,
  lmsPermissions = null,
  ownPermission = 'edit_own_courses',
  anyPermission = 'edit_any_course'
}) => {
  if (!course) return false
  if (platformAdmin && course.isSystemCourse) return true

  if (course.organization && toIdString(course.organization) !== toIdString(scope.organizationId)) {
    return false
  }

  if (lmsPermissions instanceof Set) {
    return lmsPermissions.has(anyPermission) || (
      toIdString(course.createdBy) === toIdString(accountId) && lmsPermissions.has(ownPermission)
    )
  }

  if (canManageOrganizationData(memberRole)) {
    return true
  }

  return toIdString(course.createdBy) === toIdString(accountId)
}

const createNotification = async ({
  organizationId,
  senderId,
  recipient,
  subject,
  html,
  text
}) => {
  if (!recipient?._id || !recipient?.email || !organizationId || !senderId) {
    return
  }

  try {
    await Notification.create({
      organization: organizationId,
      sentBy: senderId,
      targetType: 'member',
      targetId: recipient._id,
      subject,
      htmlContent: html,
      textContent: text,
      status: 'completed',
      recipientCount: 1,
      sentCount: 1,
      failedCount: 0,
      recipients: [{
        accountId: recipient._id,
        email: recipient.email,
        status: 'sent',
        sentAt: new Date()
      }],
      completedAt: new Date()
    })
  } catch (error) {
    console.error('Simple LMS notification record failed:', error.message)
  }

  try {
    await emailService.sendNotificationEmail({
      to: recipient.email,
      toName: recipient.profile?.name || recipient.email,
      subject,
      html,
      text
    })
  } catch (error) {
    console.error('Simple LMS notification email failed:', error.message)
  }
}

const markSimpleLmsDashboardViewed = async ({ accountId, organizationId }) => {
  const accountIdStr = toIdString(accountId)
  const organizationIdStr = toIdString(organizationId)
  if (!accountIdStr || !organizationIdStr) return

  try {
    await Account.updateOne(
      { _id: accountIdStr },
      {
        $set: {
          [`notificationViews.simpleLmsByOrganization.${organizationIdStr}`]: new Date()
        }
      }
    )
  } catch (error) {
    console.error('Failed to mark Simple LMS notification as viewed:', error.message)
  }
}

const buildAssignableMemberIds = ({
  targetType,
  targetMemberId,
  targetTeamId,
  accountId,
  scope,
  orgMembers,
  teams
}) => {
  const accountIdStr = toIdString(accountId)
  const memberIdSet = new Set()

  if (targetType === 'self') {
    memberIdSet.add(accountIdStr)
    return Array.from(memberIdSet)
  }

  if (targetType === 'member') {
    const normalizedMemberId = toIdString(targetMemberId)
    if (!normalizedMemberId) {
      throw new Error('Select a member to assign.')
    }
    if (!scope.canManageOrganization && !scope.manageableMemberIdSet.has(normalizedMemberId)) {
      throw new Error('You do not have permission to assign this member.')
    }
    memberIdSet.add(normalizedMemberId)
    return Array.from(memberIdSet)
  }

  if (targetType === 'team') {
    const normalizedTeamId = toIdString(targetTeamId)
    if (!normalizedTeamId) {
      throw new Error('Select a team to assign.')
    }
    if (!scope.canManageOrganization && !scope.manageableTeamIds.has(normalizedTeamId)) {
      throw new Error('You do not have permission to assign this team.')
    }

    const teamAccountIds = new Set()
    for (const team of teams) {
      if (toIdString(team._id) !== normalizedTeamId) continue
      for (const member of team.members || []) {
        if (member.status !== 'active') continue
        const memberId = toIdString(member.account)
        if (!memberId) continue
        teamAccountIds.add(memberId)
      }
    }

    for (const memberId of teamAccountIds) {
      if (!scope.canManageOrganization && !scope.manageableMemberIdSet.has(memberId)) {
        continue
      }
      memberIdSet.add(memberId)
    }

    if (memberIdSet.size === 0) {
      throw new Error('No assignable members found in this team.')
    }

    return Array.from(memberIdSet)
  }

  if (targetType === 'organization') {
    if (!scope.canManageOrganization) {
      throw new Error('The IdP has not granted organization-wide learning assignment.')
    }
    orgMembers.forEach(member => memberIdSet.add(member.accountId))
    return Array.from(memberIdSet)
  }

  throw new Error('Unsupported assignment target type.')
}

const assignCourseToMembers = async ({
  organizationId,
  course,
  memberIds,
  assignedBy,
  assignmentType,
  assignedTeam,
  dueAt,
  source,
  programId = null
}) => {
  const normalizedMemberIds = Array.from(new Set((memberIds || []).map(id => toIdString(id)).filter(Boolean)))
  if (normalizedMemberIds.length === 0) {
    return { assignedCount: 0, updatedCount: 0 }
  }

  let assignedCount = 0
  let updatedCount = 0

  for (const memberId of normalizedMemberIds) {
    const existing = await SimpleLmsEnrollment.findOne({
      organization: organizationId,
      course: course._id,
      enrolledMember: memberId
    })

    if (!existing) {
      await SimpleLmsEnrollment.create({
        organization: organizationId,
        course: course._id,
        program: programId,
        enrolledMember: memberId,
        enrolledBy: assignedBy,
        assignmentType,
        assignedTeam: assignedTeam || null,
        source,
        dueAt: dueAt || null,
        assignedAt: new Date(),
        status: 'assigned',
        progressPercent: 0,
        completedLessonKeys: []
      })
      assignedCount += 1
      continue
    }

    existing.enrolledBy = assignedBy
    existing.assignmentType = assignmentType
    existing.assignedTeam = assignedTeam || null
    existing.source = source
    if (dueAt) {
      existing.dueAt = dueAt
    }
    if (!existing.program && programId) {
      existing.program = programId
    }
    await existing.save()
    updatedCount += 1
  }

  return { assignedCount, updatedCount }
}

const notifySystemAdminsForRequest = async ({
  organizationId,
  senderId,
  subject,
  html,
  text
}) => {
  const admins = await Account.findSystemAdmins()
    .select('email profile.name')
    .lean()

  await Promise.all(
    admins.map((admin) => createNotification({
      organizationId,
      senderId,
      recipient: admin,
      subject,
      html,
      text
    }))
  )
}

const sendRequestDecisionNotification = async ({
  request,
  recipient,
  decidedBy,
  approved
}) => {
  if (!recipient) return

  const statusLabel = approved ? 'approved' : 'rejected'
  const reviewer = decidedBy?.profile?.name || decidedBy?.email || 'Reviewer'
  const subject = `Simple LMS request ${statusLabel}`
  const html = `
    <p>Your Simple LMS request has been <strong>${htmlEscape(statusLabel)}</strong>.</p>
    <p><strong>Request:</strong> ${htmlEscape(request.title || request.requestType)}<br>
    <strong>Reviewed by:</strong> ${htmlEscape(reviewer)}</p>
    <p><a href="/simple-lms?view=requests">Open Simple LMS requests</a></p>
  `
  const text = [
    `Your Simple LMS request has been ${statusLabel}.`,
    `Request: ${request.title || request.requestType}`,
    `Reviewed by: ${reviewer}`,
    '',
    'Open Simple LMS: /simple-lms?view=requests'
  ].join('\n')

  await createNotification({
    organizationId: request.organization,
    senderId: decidedBy?._id,
    recipient,
    subject,
    html,
    text
  })
}

const parseViewMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'builder') return 'course-studio'
  return VALID_VIEW_MODES.has(normalized) ? normalized : 'overview'
}

const parseDueDate = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

pageRouter.get('/', requirePageAuth, requirePageSubscriptionAccess, async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }
    if (!hasLmsPermission(orgContext, 'view_courses')) {
      return res.status(403).send('Simple LMS access has not been granted by your organization administrator.')
    }

    await markSimpleLmsDashboardViewed({
      accountId: req.user._id,
      organizationId: orgContext.organizationId
    })

    const [scope, planAccess, publishWithoutReviewAllowed] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole,
        canManageOrganization: hasOrganizationWideLmsScope(orgContext)
      }),
      getLmsPlanAccess(orgContext.organizationId),
      Promise.resolve(hasLmsPermission(orgContext, 'publish_courses'))
    ])

    const canManageOrg = hasLmsPermission(orgContext, 'edit_any_course') ||
      hasLmsPermission(orgContext, 'manage_enrollments') ||
      hasLmsPermission(orgContext, 'manage_lms_settings')
    const hasHierarchyScope = scope.manageableMembers.length > 0
    const canCreateCourses = hasLmsPermission(orgContext, 'create_courses')
    const canAssignCourses = hasLmsPermission(orgContext, 'manage_enrollments')
    const canReviewOrgRequests = hasLmsPermission(orgContext, 'manage_enrollments') ||
      hasLmsPermission(orgContext, 'publish_courses')
    const canReviewPlatformRequests = isPlatformAdmin(req.user)
    const canPublishWithoutReview = publishWithoutReviewAllowed || canReviewPlatformRequests
    const currencySettings = getSimpleLmsCurrencySettings(orgContext.organization)

    const [orgMembersResult, myEnrollments, marketplaceCourses, ownedCourses, organizationCourses, programs, myRequests, orgRequestQueue, platformRequestQueue, publishPermissions, approvedSystemCourseRequests] = await Promise.all([
      getOrganizationMembersWithTeamContext({ organizationId: orgContext.organizationId }),
      SimpleLmsEnrollment.find({
        organization: orgContext.organizationId,
        enrolledMember: req.user._id
      })
        .populate('course', 'title summary banner status visibility lessonCount estimatedDurationMinutes isSystemCourse chapters pricing')
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsCourse.find({
        status: 'published',
        visibility: { $in: ['organization_public', 'system_public'] },
        isActive: true
      })
        .sort({ updatedAt: -1 })
        .limit(120)
        .lean(),
      SimpleLmsCourse.find({
        organization: orgContext.organizationId,
        createdBy: req.user._id,
        isActive: true
      })
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsCourse.find({
        organization: orgContext.organizationId,
        isActive: true,
        ...(canManageOrg ? {} : {
          $or: [
            { status: 'published' },
            { createdBy: req.user._id }
          ]
        })
      })
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsProgram.find({ organization: orgContext.organizationId })
        .populate('steps.course', 'title status visibility')
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsRequest.find({
        organization: orgContext.organizationId,
        requestedBy: req.user._id
      })
        .populate('course', 'title visibility status')
        .sort({ createdAt: -1 })
        .lean(),
      Promise.resolve([]),
      canReviewPlatformRequests
        ? SimpleLmsRequest.find({
          requestType: { $in: ['system_course_access', 'public_course_publish'] },
          status: 'pending'
        })
          .populate('requestedBy', 'email profile.name')
          .populate('organization', 'name')
          .populate('course', 'title visibility status isSystemCourse')
          .sort({ createdAt: -1 })
          .lean()
        : Promise.resolve([]),
      Promise.resolve([]),
      SimpleLmsRequest.countDocuments({
        organization: orgContext.organizationId,
        requestType: 'system_course_access',
        status: 'approved'
      })
    ])

    let managedEnrollments = []
    if (canAssignCourses && scope.manageableMemberIdSet.size > 0) {
      managedEnrollments = await SimpleLmsEnrollment.find({
        organization: orgContext.organizationId,
        enrolledMember: { $in: Array.from(scope.manageableMemberIdSet) }
      })
        .populate('course', 'title summary banner status visibility lessonCount pricing')
        .populate('enrolledMember', 'email profile.name')
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean()
    }

    const orgMembers = orgMembersResult.members || []
    const assignableMembers = buildAssignableMembers({
      orgMembers,
      scope: {
        ...scope,
        organizationId: orgContext.organizationId
      },
      accountId: req.user._id
    })
    const teamOptions = (scope.teams || [])
      .filter((team) => (
        canManageOrg ||
        scope.manageableTeamIds.has(toIdString(team._id))
      ))
      .map(team => ({
        id: toIdString(team._id),
        name: team.name || 'Team'
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const myEnrollmentCards = myEnrollments.map((enrollment) => ({
      ...enrollment,
      course: decorateCoursePricing(enrollment.course, currencySettings),
      progressPercent: Number.isFinite(Number(enrollment.progressPercent))
        ? Number(enrollment.progressPercent)
        : 0,
      lastActivityAt: enrollment.lastActivityAt || enrollment.updatedAt
    }))

    const managedEnrollmentCards = managedEnrollments.map((enrollment) => ({
      ...enrollment,
      course: decorateCoursePricing(enrollment.course, currencySettings),
      progressPercent: Number.isFinite(Number(enrollment.progressPercent))
        ? Number(enrollment.progressPercent)
        : 0,
      memberName: enrollment.enrolledMember?.profile?.name || enrollment.enrolledMember?.email || 'Member'
    }))
    const marketplaceCourseCards = (marketplaceCourses || [])
      .map((course) => decorateCoursePricing(course, currencySettings))
    const ownedCourseCards = (ownedCourses || [])
      .map((course) => decorateCoursePricing(course, currencySettings))
    const organizationCourseCards = (organizationCourses || [])
      .map((course) => decorateCoursePricing(course, currencySettings))

    const requestedViewMode = parseViewMode(req.query.view)

    res.render('simple-lms', {
      user: req.user,
      activePage: 'simple-lms',
      organizationName: orgContext.organizationName,
      viewMode: requestedViewMode,
      canManageOrg,
      canCreateCourses,
      canAssignCourses,
      canReviewOrgRequests,
      canReviewPlatformRequests,
      canPublishWithoutReview,
      hasHierarchyScope,
      planAccess,
      currencySettings,
      supportedCurrencies: SUPPORTED_SIMPLE_LMS_CURRENCIES,
      approvedSystemCourseRequests,
      orgMembers,
      assignableMembers,
      teamOptions,
      myEnrollments: myEnrollmentCards,
      managedEnrollments: managedEnrollmentCards,
      marketplaceCourses: marketplaceCourseCards,
      ownedCourses: ownedCourseCards,
      organizationCourses: organizationCourseCards,
      programs,
      myRequests,
      orgRequestQueue,
      platformRequestQueue,
      publishPermissions,
      scopeSummary: {
        manageableMembers: scope.manageableMembers.length,
        manageableTeams: scope.manageableTeamIds.size
      },
      success: String(req.query.success || ''),
      error: String(req.query.error || '')
    })
  } catch (error) {
    console.error('Simple LMS workspace load error:', error)
    res.redirect('/?error=Failed to load Simple LMS workspace')
  }
})

apiRouter.use(requireApiAuth, requireApiSubscriptionAccess)

apiRouter.get('/workspace', async (req, res) => {
  return res.redirect('/simple-lms')
})

apiRouter.post('/upload/banner', upload.single('banner'), async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'create_courses', 'The IdP has not granted course creation.')) return

    const scope = await getSimpleLmsAccessScope({
      organizationId: orgContext.organizationId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole
    })
    const canCreateCourses = hasLmsPermission(orgContext, 'create_courses')
    if (!canCreateCourses) {
      return res.status(403).json({ error: 'You do not have permission to upload LMS course banners.' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Banner image file is required.' })
    }
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed.' })
    }
    const uploadResult = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      folder: `seemplify/simple-lms/${orgContext.organizationId}/banners`,
      resourceType: 'image'
    })

    res.json({
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      provider: uploadResult.storageProvider || 'cloudinary',
      storageKey: uploadResult.storageKey || uploadResult.public_id,
      storageContainer: uploadResult.storageContainer || null,
      width: uploadResult.width,
      height: uploadResult.height
    })
  } catch (error) {
    console.error('Simple LMS banner upload failed:', error)
    res.status(500).json({ error: 'Failed to upload banner image.' })
  }
})

apiRouter.put('/settings/currency', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'manage_lms_settings', 'The IdP has not granted LMS settings management.')) return

    const defaultCurrency = normalizeCurrencyCode(req.body.defaultCurrency, '')
    if (!defaultCurrency) {
      return res.status(400).json({ error: 'Select a valid default currency.' })
    }

    const allowedCurrenciesInput = req.body.allowedCurrencies ?? req.body['allowedCurrencies[]']
    const allowedCurrenciesRaw = Array.isArray(allowedCurrenciesInput)
      ? allowedCurrenciesInput
      : (allowedCurrenciesInput !== undefined ? [allowedCurrenciesInput] : [])
    const allowedCurrencies = normalizeCurrencyList(allowedCurrenciesRaw)
    if (!allowedCurrencies.includes(defaultCurrency)) {
      allowedCurrencies.unshift(defaultCurrency)
    }

    await Organization.updateOne(
      { _id: orgContext.organizationId },
      {
        $set: {
          'settings.simpleLms.defaultCurrency': defaultCurrency,
          'settings.simpleLms.allowedCurrencies': allowedCurrencies
        }
      }
    )

    res.json({
      message: 'Simple LMS currency settings updated.',
      currencySettings: {
        defaultCurrency,
        allowedCurrencies
      }
    })
  } catch (error) {
    console.error('Simple LMS currency settings update error:', error)
    res.status(500).json({ error: 'Failed to update currency settings.' })
  }
})

apiRouter.post('/courses', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'create_courses', 'The IdP has not granted course creation.')) return

    const [scope, planAccess, hasPublishWithoutReview] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole
      }),
      getLmsPlanAccess(orgContext.organizationId),
      Promise.resolve(hasLmsPermission(orgContext, 'publish_courses'))
    ])

    if (!planAccess.hasLmsFeature) {
      return res.status(403).json({ error: 'Simple LMS is not available on your current subscription plan.' })
    }

    const creatorCanCreate = hasLmsPermission(orgContext, 'create_courses')
    if (!creatorCanCreate) {
      return res.status(403).json({ error: 'You do not have permission to create LMS courses.' })
    }

    const title = String(req.body.title || '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Course title is required.' })
    }

    const chapters = sanitizeChaptersInput(parseJsonInput(req.body.chapters, []))
    const banner = parseJsonInput(req.body.banner, {})
    const requestedVisibility = String(req.body.visibility || 'organization_private').trim()
    const requestedStatus = String(req.body.status || 'draft').trim()
    const tags = normalizeStringList(req.body.tags).slice(0, 20)
    const currencySettings = getSimpleLmsCurrencySettings(orgContext.organization)

    const platformAdmin = isPlatformAdmin(req.user)
    const wantsSystemCourse = requestedVisibility === 'system_public' || req.body.isSystemCourse === true || req.body.isSystemCourse === 'true'
    let visibility = 'organization_private'
    let status = ['published', 'draft'].includes(requestedStatus) ? requestedStatus : 'draft'
    let isSystemCourse = false
    let requiresPublicReview = true
    let pendingPublicReview = false

    if (wantsSystemCourse) {
      if (!platformAdmin) {
        return res.status(403).json({ error: 'Only platform admins can publish system-wide courses.' })
      }
      isSystemCourse = true
      visibility = 'system_public'
      status = 'published'
      requiresPublicReview = false
    } else if (requestedVisibility === 'organization_public') {
      if (hasPublishWithoutReview || platformAdmin) {
        visibility = 'organization_public'
        status = 'published'
        requiresPublicReview = false
      } else {
        visibility = 'organization_private'
        status = 'pending_public_review'
        requiresPublicReview = true
        pendingPublicReview = true
      }
    }

    const course = await SimpleLmsCourse.create({
      organization: isSystemCourse ? null : orgContext.organizationId,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email,
      createdByEmail: req.user.email,
      title,
      slug: slugifyValue(req.body.slug || title, 'course'),
      summary: String(req.body.summary || '').trim().slice(0, 600),
      description: String(req.body.description || '').trim().slice(0, 16000),
      category: String(req.body.category || '').trim().slice(0, 120),
      level: ['beginner', 'intermediate', 'advanced', 'mixed'].includes(req.body.level) ? req.body.level : 'mixed',
      tags,
      banner: {
        url: String(banner.url || req.body.bannerUrl || '').trim().slice(0, 2000),
        publicId: String(banner.publicId || req.body.bannerPublicId || '').trim().slice(0, 400),
        provider: banner.provider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
        storageKey: String(banner.storageKey || banner.publicId || '').trim().slice(0, 600),
        storageContainer: String(banner.storageContainer || '').trim().slice(0, 100),
        width: banner.width,
        height: banner.height
      },
      pricing: {
        amount: Number.isFinite(Number(req.body.pricingAmount))
          ? Math.max(0, Math.round(Number(req.body.pricingAmount)))
          : 0,
        currency: normalizeCurrencyCode(req.body.pricingCurrency, currencySettings.defaultCurrency),
        paymentMode: req.body.paymentMode === 'paid' ? 'paid' : 'free'
      },
      visibility,
      status,
      isSystemCourse,
      requiresPublicReview,
      publishedWithoutReview: visibility === 'organization_public' && !requiresPublicReview,
      chapters
    })

    if (pendingPublicReview) {
      const request = await SimpleLmsRequest.create({
        organization: orgContext.organizationId,
        requestedBy: req.user._id,
        requestType: 'public_course_publish',
        status: 'pending',
        title: `Publish course publicly: ${title}`,
        message: String(req.body.publicationRequestMessage || '').trim(),
        course: course._id,
        targetVisibility: 'organization_public'
      })

      await notifySystemAdminsForRequest({
        organizationId: orgContext.organizationId,
        senderId: req.user._id,
        subject: 'Simple LMS public publish request',
        html: `
          <p>A new Simple LMS course publication request is pending review.</p>
          <p><strong>Course:</strong> ${htmlEscape(course.title)}<br><strong>Organization:</strong> ${htmlEscape(orgContext.organizationName)}</p>
          <p><a href="/simple-lms?view=requests">Open Simple LMS Requests</a></p>
        `,
        text: `Simple LMS publish request\nCourse: ${course.title}\nOrganization: ${orgContext.organizationName}\nOpen /simple-lms?view=requests`
      })

      return res.status(201).json({
        message: 'Course created and queued for public publishing review.',
        course,
        requestId: request._id
      })
    }

    res.status(201).json({
      message: 'Course created successfully.',
      course
    })
  } catch (error) {
    console.error('Simple LMS create course error:', error)
    res.status(500).json({ error: 'Failed to create course.' })
  }
})

apiRouter.put('/courses/:courseId', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const [scope, course, hasPublishWithoutReview] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole
      }),
      SimpleLmsCourse.findById(courseId),
      Promise.resolve(hasLmsPermission(orgContext, 'publish_courses'))
    ])

    if (!course || !course.isActive) {
      return res.status(404).json({ error: 'Course not found.' })
    }

    const ownsCourse = toIdString(course.createdBy) === toIdString(req.user._id)
    const hasEditPermission = hasLmsPermission(orgContext, 'edit_any_course') ||
      (ownsCourse && hasLmsPermission(orgContext, 'edit_own_courses'))
    if (!hasEditPermission) {
      return res.status(403).json({
        error: 'The IdP has not granted permission to edit this course.',
        code: 'IDP_PERMISSION_REQUIRED'
      })
    }

    const platformAdmin = isPlatformAdmin(req.user)
    const canEdit = canManageCourse({
      course,
      accountId: req.user._id,
      memberRole: orgContext.memberRole,
      scope: {
        ...scope,
        organizationId: orgContext.organizationId
      },
      platformAdmin,
      lmsPermissions: orgContext.lmsPermissions
    })
    if (!canEdit) {
      return res.status(403).json({ error: 'You do not have permission to update this course.' })
    }

    const title = String(req.body.title || course.title || '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Course title is required.' })
    }

    const chapters = req.body.chapters !== undefined
      ? sanitizeChaptersInput(parseJsonInput(req.body.chapters, []))
      : course.chapters
    const currencySettings = getSimpleLmsCurrencySettings(orgContext.organization)

    course.title = title
    course.slug = slugifyValue(req.body.slug || title, 'course')
    course.summary = String(req.body.summary ?? course.summary ?? '').trim().slice(0, 600)
    course.description = String(req.body.description ?? course.description ?? '').trim().slice(0, 16000)
    course.category = String(req.body.category ?? course.category ?? '').trim().slice(0, 120)
    course.level = ['beginner', 'intermediate', 'advanced', 'mixed'].includes(req.body.level)
      ? req.body.level
      : (course.level || 'mixed')
    course.tags = normalizeStringList(req.body.tags ?? course.tags).slice(0, 20)

    const banner = parseJsonInput(req.body.banner, null)
    if (banner) {
      course.banner = {
        url: String(banner.url || '').trim().slice(0, 2000),
        publicId: String(banner.publicId || '').trim().slice(0, 400),
        provider: banner.provider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
        storageKey: String(banner.storageKey || banner.publicId || '').trim().slice(0, 600),
        storageContainer: String(banner.storageContainer || '').trim().slice(0, 100),
        width: banner.width,
        height: banner.height
      }
    }

    if (req.body.pricingAmount !== undefined || req.body.paymentMode !== undefined || req.body.pricingCurrency !== undefined) {
      course.pricing.amount = Number.isFinite(Number(req.body.pricingAmount))
        ? Math.max(0, Math.round(Number(req.body.pricingAmount)))
        : course.pricing.amount
      course.pricing.currency = normalizeCurrencyCode(
        req.body.pricingCurrency,
        course.pricing.currency || currencySettings.defaultCurrency
      )
      course.pricing.paymentMode = req.body.paymentMode === 'paid'
        ? 'paid'
        : 'free'
    }

    course.chapters = chapters

    if (req.body.status && ['draft', 'published', 'archived'].includes(req.body.status)) {
      course.status = req.body.status
    }

    if (req.body.visibility) {
      const visibility = String(req.body.visibility).trim()
      if (visibility === 'system_public' && platformAdmin) {
        course.visibility = 'system_public'
        course.isSystemCourse = true
        course.status = 'published'
      } else if (visibility === 'organization_public') {
        if (platformAdmin || hasPublishWithoutReview) {
          course.visibility = 'organization_public'
          course.status = 'published'
          course.publishedWithoutReview = true
          course.requiresPublicReview = false
        } else {
          course.visibility = 'organization_private'
          course.status = 'pending_public_review'
          course.requiresPublicReview = true
        }
      } else if (visibility === 'organization_private') {
        course.visibility = 'organization_private'
      }
    }

    await course.save()
    res.json({
      message: 'Course updated successfully.',
      course
    })
  } catch (error) {
    console.error('Simple LMS update course error:', error)
    res.status(500).json({ error: 'Failed to update course.' })
  }
})

apiRouter.post('/courses/:courseId/archive', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const [scope, course] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole
      }),
      SimpleLmsCourse.findById(courseId)
    ])

    if (!course || !course.isActive) {
      return res.status(404).json({ error: 'Course not found.' })
    }

    const ownsCourse = toIdString(course.createdBy) === toIdString(req.user._id)
    const hasDeletePermission = hasLmsPermission(orgContext, 'delete_any_course') ||
      (ownsCourse && hasLmsPermission(orgContext, 'delete_own_courses'))
    if (!hasDeletePermission) {
      return res.status(403).json({
        error: 'The IdP has not granted permission to archive this course.',
        code: 'IDP_PERMISSION_REQUIRED'
      })
    }

    const platformAdmin = isPlatformAdmin(req.user)
    const canEdit = canManageCourse({
      course,
      accountId: req.user._id,
      memberRole: orgContext.memberRole,
      scope: {
        ...scope,
        organizationId: orgContext.organizationId
      },
      platformAdmin,
      lmsPermissions: orgContext.lmsPermissions,
      ownPermission: 'delete_own_courses',
      anyPermission: 'delete_any_course'
    })
    if (!canEdit) {
      return res.status(403).json({ error: 'You do not have permission to archive this course.' })
    }

    course.status = 'archived'
    course.isActive = false
    course.archivedAt = new Date()
    await course.save()

    res.json({ message: 'Course archived.' })
  } catch (error) {
    console.error('Simple LMS archive course error:', error)
    res.status(500).json({ error: 'Failed to archive course.' })
  }
})

apiRouter.post('/courses/:courseId/request-publication', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const [course, hasPublishWithoutReview] = await Promise.all([
      SimpleLmsCourse.findOne({
        _id: courseId,
        organization: orgContext.organizationId
      }),
      Promise.resolve(hasLmsPermission(orgContext, 'publish_courses'))
    ])

    if (!course) {
      return res.status(404).json({ error: 'Course not found in your organization.' })
    }

    const ownsCourse = toIdString(course.createdBy) === toIdString(req.user._id)
    const canRequest = hasLmsPermission(orgContext, 'publish_courses') ||
      (ownsCourse && hasLmsPermission(orgContext, 'edit_own_courses'))
    if (!canRequest) {
      return res.status(403).json({ error: 'Only the course owner or org managers can request publication.' })
    }

    if (hasPublishWithoutReview || isPlatformAdmin(req.user)) {
      course.status = 'published'
      course.visibility = 'organization_public'
      course.requiresPublicReview = false
      course.publishedWithoutReview = true
      course.approvedPublicBy = req.user._id
      course.approvedPublicAt = new Date()
      await course.save()

      return res.json({
        message: 'Course published publicly without review.',
        course
      })
    }

    const existingPending = await SimpleLmsRequest.findOne({
      organization: orgContext.organizationId,
      course: course._id,
      requestType: 'public_course_publish',
      status: 'pending'
    })
    if (existingPending) {
      return res.status(400).json({ error: 'This course already has a pending publication request.' })
    }

    course.status = 'pending_public_review'
    course.visibility = 'organization_private'
    await course.save()

    const request = await SimpleLmsRequest.create({
      organization: orgContext.organizationId,
      requestedBy: req.user._id,
      requestType: 'public_course_publish',
      status: 'pending',
      title: `Publish course publicly: ${course.title}`,
      message: String(req.body.message || '').trim(),
      course: course._id,
      targetVisibility: 'organization_public'
    })

    await notifySystemAdminsForRequest({
      organizationId: orgContext.organizationId,
      senderId: req.user._id,
      subject: 'Simple LMS public publish request',
      html: `
        <p>A new Simple LMS publication request is waiting for review.</p>
        <p><strong>Course:</strong> ${htmlEscape(course.title)}<br>
        <strong>Organization:</strong> ${htmlEscape(orgContext.organizationName)}</p>
        <p><a href="/simple-lms?view=requests">Review requests</a></p>
      `,
      text: `Simple LMS publication request\nCourse: ${course.title}\nOrganization: ${orgContext.organizationName}`
    })

    res.json({
      message: 'Publication request submitted for review.',
      request
    })
  } catch (error) {
    console.error('Simple LMS publication request error:', error)
    res.status(500).json({ error: 'Failed to submit publication request.' })
  }
})

apiRouter.post('/programs', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'manage_course_content', 'The IdP has not granted program creation.')) return

    const scope = await getSimpleLmsAccessScope({
      organizationId: orgContext.organizationId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole
    })
    const canCreatePrograms = hasLmsPermission(orgContext, 'manage_course_content')
    if (!canCreatePrograms) {
      return res.status(403).json({ error: 'You do not have permission to create programs.' })
    }

    const name = String(req.body.name || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Program name is required.' })
    }
    const banner = parseJsonInput(req.body.banner, {})

    const rawSteps = parseJsonInput(req.body.steps, [])
    const steps = Array.isArray(rawSteps)
      ? rawSteps
        .map((step, index) => ({
          course: toIdString(step?.course || step?.courseId),
          order: Number.isFinite(Number(step?.order)) ? Number(step.order) : index + 1,
          required: step?.required !== false
        }))
        .filter(step => mongoose.Types.ObjectId.isValid(step.course))
      : []

    if (steps.length === 0) {
      return res.status(400).json({ error: 'Add at least one course step to the program.' })
    }

    const courseIds = steps.map(step => step.course)
    const courses = await SimpleLmsCourse.find({
      _id: { $in: courseIds },
      organization: orgContext.organizationId,
      isActive: true
    })
      .select('_id title estimatedDurationMinutes')
      .lean()

    if (courses.length !== courseIds.length) {
      return res.status(400).json({ error: 'One or more selected courses are invalid for your organization.' })
    }

    const titleById = new Map(courses.map(course => [toIdString(course._id), course.title]))
    const totalMinutes = courses.reduce((sum, course) => sum + (Number(course.estimatedDurationMinutes) || 0), 0)
    const normalizedSteps = steps.map((step, index) => ({
      course: step.course,
      titleSnapshot: titleById.get(step.course) || `Course ${index + 1}`,
      order: index + 1,
      required: step.required !== false
    }))

    const program = await SimpleLmsProgram.create({
      organization: orgContext.organizationId,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email,
      name,
      description: String(req.body.description || '').trim().slice(0, 8000),
      objective: String(req.body.objective || '').trim().slice(0, 2000),
      banner: {
        url: String(banner?.url || '').trim().slice(0, 2000),
        publicId: String(banner?.publicId || '').trim().slice(0, 400),
        provider: banner?.provider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
        storageKey: String(banner?.storageKey || banner?.publicId || '').trim().slice(0, 600),
        storageContainer: String(banner?.storageContainer || '').trim().slice(0, 100)
      },
      visibility: req.body.visibility === 'organization_public' ? 'organization_public' : 'organization_private',
      status: req.body.status === 'published' ? 'published' : 'draft',
      tags: normalizeStringList(req.body.tags).slice(0, 20),
      steps: normalizedSteps,
      estimatedDurationMinutes: Math.max(0, Math.round(totalMinutes))
    })

    res.status(201).json({
      message: 'Program created successfully.',
      program
    })
  } catch (error) {
    console.error('Simple LMS create program error:', error)
    res.status(500).json({ error: 'Failed to create program.' })
  }
})

apiRouter.put('/programs/:programId', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'manage_course_content', 'The IdP has not granted program editing.')) return

    const programId = String(req.params.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return res.status(400).json({ error: 'Invalid program id.' })
    }

    const scope = await getSimpleLmsAccessScope({
      organizationId: orgContext.organizationId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole
    })
    const canEditPrograms = hasLmsPermission(orgContext, 'manage_course_content')
    if (!canEditPrograms) {
      return res.status(403).json({ error: 'You do not have permission to update programs.' })
    }

    const program = await SimpleLmsProgram.findOne({
      _id: programId,
      organization: orgContext.organizationId
    })
    if (!program) {
      return res.status(404).json({ error: 'Program not found.' })
    }

    if (!hasLmsPermission(orgContext, 'edit_any_course') && toIdString(program.createdBy) !== toIdString(req.user._id)) {
      return res.status(403).json({ error: 'Only the program owner or org managers can edit this program.' })
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim()
      if (!name) {
        return res.status(400).json({ error: 'Program name cannot be empty.' })
      }
      program.name = name
    }
    if (req.body.description !== undefined) {
      program.description = String(req.body.description || '').trim().slice(0, 8000)
    }
    if (req.body.objective !== undefined) {
      program.objective = String(req.body.objective || '').trim().slice(0, 2000)
    }
    if (req.body.banner !== undefined) {
      const banner = parseJsonInput(req.body.banner, {})
      program.banner = {
        url: String(banner?.url || '').trim().slice(0, 2000),
        publicId: String(banner?.publicId || '').trim().slice(0, 400),
        provider: banner?.provider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
        storageKey: String(banner?.storageKey || banner?.publicId || '').trim().slice(0, 600),
        storageContainer: String(banner?.storageContainer || '').trim().slice(0, 100)
      }
    }
    if (req.body.visibility !== undefined) {
      program.visibility = req.body.visibility === 'organization_public' ? 'organization_public' : 'organization_private'
    }
    if (req.body.status !== undefined && ['draft', 'published', 'archived'].includes(req.body.status)) {
      program.status = req.body.status
    }
    if (req.body.tags !== undefined) {
      program.tags = normalizeStringList(req.body.tags).slice(0, 20)
    }

    if (req.body.steps !== undefined) {
      const rawSteps = parseJsonInput(req.body.steps, [])
      const steps = Array.isArray(rawSteps)
        ? rawSteps
          .map((step, index) => ({
            course: toIdString(step?.course || step?.courseId),
            order: Number.isFinite(Number(step?.order)) ? Number(step.order) : index + 1,
            required: step?.required !== false
          }))
          .filter(step => mongoose.Types.ObjectId.isValid(step.course))
        : []

      if (steps.length === 0) {
        return res.status(400).json({ error: 'Program must include at least one course step.' })
      }

      const courses = await SimpleLmsCourse.find({
        _id: { $in: steps.map(step => step.course) },
        organization: orgContext.organizationId,
        isActive: true
      })
        .select('_id title estimatedDurationMinutes')
        .lean()
      if (courses.length !== steps.length) {
        return res.status(400).json({ error: 'Program contains invalid courses.' })
      }

      const titleById = new Map(courses.map(course => [toIdString(course._id), course.title]))
      program.steps = steps.map((step, index) => ({
        course: step.course,
        titleSnapshot: titleById.get(step.course) || `Course ${index + 1}`,
        order: index + 1,
        required: step.required !== false
      }))
      program.estimatedDurationMinutes = courses.reduce((sum, course) => sum + (Number(course.estimatedDurationMinutes) || 0), 0)
    }

    await program.save()
    res.json({
      message: 'Program updated successfully.',
      program
    })
  } catch (error) {
    console.error('Simple LMS update program error:', error)
    res.status(500).json({ error: 'Failed to update program.' })
  }
})

apiRouter.post('/assignments/course', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'manage_enrollments', 'The IdP has not granted course assignment.')) return

    const [scope, orgMembersResult] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole,
        canManageOrganization: hasOrganizationWideLmsScope(orgContext)
      }),
      getOrganizationMembersWithTeamContext({ organizationId: orgContext.organizationId })
    ])
    const canAssignCourses = hasLmsPermission(orgContext, 'manage_enrollments')
    if (!canAssignCourses) {
      return res.status(403).json({ error: 'You do not have permission to assign courses.' })
    }

    const courseId = String(req.body.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Valid course is required.' })
    }

    const course = await SimpleLmsCourse.findById(courseId)
    if (!course || !course.isActive) {
      return res.status(404).json({ error: 'Course not found.' })
    }

    const isPublicCourse = ['organization_public', 'system_public'].includes(course.visibility) && course.status === 'published'
    if (!isPublicCourse && toIdString(course.organization) !== orgContext.organizationId) {
      return res.status(403).json({ error: 'This course cannot be assigned in your organization.' })
    }

    const targetType = String(req.body.targetType || '').trim() || 'member'
    const targetMemberId = String(req.body.targetMemberId || '').trim()
    const targetTeamId = String(req.body.targetTeamId || '').trim()
    const dueAt = parseDueDate(req.body.dueAt)

    const memberIds = buildAssignableMemberIds({
      targetType,
      targetMemberId,
      targetTeamId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole,
      scope,
      orgMembers: orgMembersResult.members || [],
      teams: scope.teams || []
    })

    const assignmentType = targetType === 'organization'
      ? 'organization'
      : (targetType === 'team' ? 'team' : (targetType === 'self' ? 'self' : 'member'))

    const result = await assignCourseToMembers({
      organizationId: orgContext.organizationId,
      course,
      memberIds,
      assignedBy: req.user._id,
      assignmentType,
      assignedTeam: assignmentType === 'team' ? targetTeamId : null,
      dueAt,
      source: 'manual'
    })

    res.json({
      message: 'Course assignment completed.',
      ...result
    })
  } catch (error) {
    console.error('Simple LMS assign course error:', error)
    res.status(500).json({ error: error.message || 'Failed to assign course.' })
  }
})

apiRouter.post('/assignments/program', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'manage_enrollments', 'The IdP has not granted program assignment.')) return

    const [scope, orgMembersResult] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole,
        canManageOrganization: hasOrganizationWideLmsScope(orgContext)
      }),
      getOrganizationMembersWithTeamContext({ organizationId: orgContext.organizationId })
    ])
    const canAssignCourses = hasLmsPermission(orgContext, 'manage_enrollments')
    if (!canAssignCourses) {
      return res.status(403).json({ error: 'You do not have permission to assign programs.' })
    }

    const programId = String(req.body.programId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(programId)) {
      return res.status(400).json({ error: 'Valid program is required.' })
    }

    const program = await SimpleLmsProgram.findOne({
      _id: programId,
      organization: orgContext.organizationId
    })
      .populate('steps.course')

    if (!program) {
      return res.status(404).json({ error: 'Program not found.' })
    }

    const targetType = String(req.body.targetType || '').trim() || 'member'
    const targetMemberId = String(req.body.targetMemberId || '').trim()
    const targetTeamId = String(req.body.targetTeamId || '').trim()
    const dueAt = parseDueDate(req.body.dueAt)

    const memberIds = buildAssignableMemberIds({
      targetType,
      targetMemberId,
      targetTeamId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole,
      scope,
      orgMembers: orgMembersResult.members || [],
      teams: scope.teams || []
    })

    const assignmentType = targetType === 'organization'
      ? 'organization'
      : (targetType === 'team' ? 'team' : (targetType === 'self' ? 'self' : 'program'))

    let assignedCount = 0
    let updatedCount = 0
    for (const step of program.steps || []) {
      if (!step?.course?._id) continue
      const result = await assignCourseToMembers({
        organizationId: orgContext.organizationId,
        course: step.course,
        memberIds,
        assignedBy: req.user._id,
        assignmentType,
        assignedTeam: assignmentType === 'team' ? targetTeamId : null,
        dueAt,
        source: 'program_assignment',
        programId: program._id
      })
      assignedCount += result.assignedCount
      updatedCount += result.updatedCount
    }

    res.json({
      message: 'Program assignment completed.',
      assignedCount,
      updatedCount
    })
  } catch (error) {
    console.error('Simple LMS assign program error:', error)
    res.status(500).json({ error: error.message || 'Failed to assign program.' })
  }
})

apiRouter.post('/enrollments/:enrollmentId/lessons/:lessonKey/complete', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'view_lessons', 'The IdP has not granted lesson access.')) return

    const enrollmentId = String(req.params.enrollmentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: 'Invalid enrollment id.' })
    }

    const enrollment = await SimpleLmsEnrollment.findOne({
      _id: enrollmentId,
      organization: orgContext.organizationId
    })
      .populate('course')

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' })
    }

    const ownerId = toIdString(enrollment.enrolledMember)
    if (ownerId !== toIdString(req.user._id)) {
      return res.status(403).json({ error: 'You can only update your own learning progress.' })
    }

    const lessonKey = String(req.params.lessonKey || '').trim()
    const lessonKeys = extractLessonKeys(enrollment.course)
    if (!lessonKeys.includes(lessonKey)) {
      return res.status(400).json({ error: 'Lesson not found in this course.' })
    }

    const completedSet = new Set((enrollment.completedLessonKeys || []).map(key => String(key)))
    completedSet.add(lessonKey)
    enrollment.completedLessonKeys = Array.from(completedSet)

    const progress = calculateProgress({
      course: enrollment.course,
      completedLessonKeys: enrollment.completedLessonKeys
    })

    enrollment.progressPercent = progress.progressPercent
    enrollment.lastActivityAt = new Date()
    enrollment.status = progress.isCompleted ? 'completed' : 'in_progress'
    if (progress.isCompleted) {
      enrollment.completedAt = new Date()
    }
    await enrollment.save()

    res.json({
      message: progress.isCompleted
        ? 'Course completed. Great work!'
        : 'Lesson marked as completed.',
      enrollment: {
        id: enrollment._id,
        status: enrollment.status,
        progressPercent: enrollment.progressPercent,
        completedLessonKeys: enrollment.completedLessonKeys
      }
    })
  } catch (error) {
    console.error('Simple LMS lesson completion error:', error)
    res.status(500).json({ error: 'Failed to update lesson progress.' })
  }
})

apiRouter.post('/enrollments/:enrollmentId/quizzes/:lessonKey/submit', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'take_quizzes', 'The IdP has not granted quiz participation.')) return

    const enrollmentId = String(req.params.enrollmentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: 'Invalid enrollment id.' })
    }

    const enrollment = await SimpleLmsEnrollment.findOne({
      _id: enrollmentId,
      organization: orgContext.organizationId
    })
      .populate('course')

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' })
    }

    const ownerId = toIdString(enrollment.enrolledMember)
    if (ownerId !== toIdString(req.user._id)) {
      return res.status(403).json({ error: 'You can only submit quizzes for your own enrollment.' })
    }

    const lessonKey = String(req.params.lessonKey || '').trim()
    const lesson = (() => {
      for (const chapter of enrollment.course?.chapters || []) {
        for (const entry of chapter.lessons || []) {
          if (String(entry.key) === lessonKey) {
            return entry
          }
        }
      }
      return null
    })()

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found.' })
    }

    const quizQuestions = Array.isArray(lesson.quizQuestions) ? lesson.quizQuestions : []
    if (quizQuestions.length === 0) {
      return res.status(400).json({ error: 'This lesson does not include a quiz.' })
    }

    const answers = Array.isArray(req.body.answers)
      ? req.body.answers.map(answer => Number.parseInt(answer, 10))
      : []

    let score = 0
    quizQuestions.forEach((question, index) => {
      const choices = Array.isArray(question.choices) ? question.choices : []
      const correctIndex = choices.findIndex(choice => choice.isCorrect)
      if (correctIndex >= 0 && answers[index] === correctIndex) {
        score += 1
      }
    })

    const maxScore = quizQuestions.length
    enrollment.quizAttempts.push({
      lessonKey,
      score,
      maxScore,
      answers,
      attemptedAt: new Date()
    })
    enrollment.latestQuizScore = maxScore > 0
      ? Number(((score / maxScore) * 100).toFixed(2))
      : 0
    enrollment.lastActivityAt = new Date()
    if (enrollment.status === 'assigned') {
      enrollment.status = 'in_progress'
      enrollment.startedAt = enrollment.startedAt || new Date()
    }
    await enrollment.save()

    res.json({
      message: 'Quiz submitted successfully.',
      score,
      maxScore,
      percentage: maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(2)) : 0
    })
  } catch (error) {
    console.error('Simple LMS quiz submit error:', error)
    res.status(500).json({ error: 'Failed to submit quiz.' })
  }
})

apiRouter.post('/enrollments/:enrollmentId/viewed', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'view_own_progress', 'The IdP has not granted learning progress access.')) return

    const enrollmentId = String(req.params.enrollmentId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res.status(400).json({ error: 'Invalid enrollment id.' })
    }

    const enrollment = await SimpleLmsEnrollment.findOne({
      _id: enrollmentId,
      organization: orgContext.organizationId,
      enrolledMember: req.user._id
    })

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found.' })
    }

    enrollment.lastViewedAt = new Date()
    enrollment.lastActivityAt = enrollment.lastActivityAt || new Date()
    await enrollment.save()

    res.json({ message: 'Enrollment marked as viewed.' })
  } catch (error) {
    console.error('Simple LMS mark viewed error:', error)
    res.status(500).json({ error: 'Failed to mark enrollment viewed.' })
  }
})

apiRouter.post('/system-courses/:courseId/request-access', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!requireLmsPermission(res, orgContext, 'enroll_courses', 'The IdP has not granted course enrolment.')) return

    const [scope, planAccess, orgMembersResult] = await Promise.all([
      getSimpleLmsAccessScope({
        organizationId: orgContext.organizationId,
        accountId: req.user._id,
        memberRole: orgContext.memberRole,
        canManageOrganization: hasOrganizationWideLmsScope(orgContext)
      }),
      getLmsPlanAccess(orgContext.organizationId),
      getOrganizationMembersWithTeamContext({ organizationId: orgContext.organizationId })
    ])

    if (!planAccess.hasLmsFeature) {
      return res.status(403).json({ error: 'Simple LMS is not enabled for your organization.' })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid system course id.' })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isSystemCourse: true,
      status: 'published',
      visibility: 'system_public',
      isActive: true
    })
    if (!course) {
      return res.status(404).json({ error: 'System course not found or not available.' })
    }

    const approvedCount = await SimpleLmsRequest.countDocuments({
      organization: orgContext.organizationId,
      requestType: 'system_course_access',
      status: 'approved'
    })
    const maxSystemCourses = planAccess.maxSystemCourses
    if (maxSystemCourses !== null && Number.isFinite(Number(maxSystemCourses)) && approvedCount >= Number(maxSystemCourses)) {
      return res.status(403).json({
        error: 'Your plan has reached the maximum number of approved system courses.',
        maxSystemCourses: Number(maxSystemCourses),
        approvedCount
      })
    }

    const existingPendingRequest = await SimpleLmsRequest.findOne({
      organization: orgContext.organizationId,
      requestType: 'system_course_access',
      course: course._id,
      status: 'pending'
    })
    if (existingPendingRequest) {
      return res.status(400).json({ error: 'A request for this course is already pending.' })
    }

    const targetType = String(req.body.targetType || 'self').trim()
    const targetMemberId = String(req.body.targetMemberId || '').trim()
    const targetTeamId = String(req.body.targetTeamId || '').trim()

    if (targetType !== 'self' && !hasLmsPermission(orgContext, 'manage_enrollments')) {
      return res.status(403).json({
        error: 'The IdP has not granted learning assignment for other members.',
        code: 'IDP_PERMISSION_REQUIRED',
        permission: 'lms:manage_enrollments'
      })
    }

    buildAssignableMemberIds({
      targetType,
      targetMemberId,
      targetTeamId,
      accountId: req.user._id,
      memberRole: orgContext.memberRole,
      scope,
      orgMembers: orgMembersResult.members || [],
      teams: scope.teams || []
    })

    const requestMessage = String(req.body.message || '').trim().slice(0, 5000)
    const paymentStatus = course.pricing?.paymentMode === 'paid' ? 'pending' : 'not_required'
    const paymentAmount = course.pricing?.paymentMode === 'paid'
      ? Number(course.pricing?.amount || 0)
      : 0
    const paymentCurrency = normalizeCurrencyCode(
      course.pricing?.currency,
      getSimpleLmsCurrencySettings(orgContext.organization).defaultCurrency
    )

    const request = await SimpleLmsRequest.create({
      organization: orgContext.organizationId,
      requestedBy: req.user._id,
      requestType: 'system_course_access',
      status: 'pending',
      title: `System course access: ${course.title}`,
      message: requestMessage,
      course: course._id,
      notificationRecipient: course.createdBy || null,
      payment: {
        status: paymentStatus,
        amount: paymentAmount,
        currency: paymentCurrency
      },
      metadata: {
        targetType,
        targetMemberId,
        targetTeamId,
        dueAt: String(req.body.dueAt || '').trim()
      }
    })

    const recipientIds = new Set()
    if (course.createdBy) {
      recipientIds.add(toIdString(course.createdBy))
    }
    if (recipientIds.size === 0) {
      const admins = await Account.findSystemAdmins().select('_id').lean()
      admins.forEach(admin => recipientIds.add(toIdString(admin._id)))
    }

    const recipients = await Account.find({
      _id: { $in: Array.from(recipientIds) }
    })
      .select('email profile.name')
      .lean()

    await Promise.all(recipients.map((recipient) => createNotification({
      organizationId: orgContext.organizationId,
      senderId: req.user._id,
      recipient,
      subject: 'Simple LMS system course request',
      html: `
        <p>A new system course access request needs review.</p>
        <p><strong>Course:</strong> ${htmlEscape(course.title)}<br>
        <strong>Organization:</strong> ${htmlEscape(orgContext.organizationName)}</p>
        <p><a href="/simple-lms?view=requests">Open requests queue</a></p>
      `,
      text: `Simple LMS request\nCourse: ${course.title}\nOrganization: ${orgContext.organizationName}`
    })))

    res.status(201).json({
      message: 'System course access request submitted.',
      request
    })
  } catch (error) {
    console.error('Simple LMS system course request error:', error)
    res.status(500).json({ error: error.message || 'Failed to submit system course request.' })
  }
})

apiRouter.post('/permissions/publish-without-review/request', rejectIdpManagedLmsPermission, async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    const existingPending = await SimpleLmsRequest.findOne({
      organization: orgContext.organizationId,
      requestedBy: req.user._id,
      requestType: 'publish_without_review',
      status: 'pending'
    })
    if (existingPending) {
      return res.status(400).json({ error: 'You already have a pending publish-without-review request.' })
    }

    const request = await SimpleLmsRequest.create({
      organization: orgContext.organizationId,
      requestedBy: req.user._id,
      requestType: 'publish_without_review',
      status: 'pending',
      title: 'Request publish without review permission',
      message: String(req.body.message || '').trim().slice(0, 5000),
      targetAccount: req.user._id
    })

    const managers = await Account.find({
      _id: {
        $in: orgContext.organization.members
          .filter(member => member.status === 'active' && SIMPLE_LMS_ORG_MANAGER_ROLES.includes(member.role))
          .map(member => member.account)
      }
    })
      .select('email profile.name')
      .lean()

    await Promise.all(managers.map((manager) => createNotification({
      organizationId: orgContext.organizationId,
      senderId: req.user._id,
      recipient: manager,
      subject: 'Simple LMS publish permission request',
      html: `
        <p>A member requested <strong>publish without review</strong> permission in Simple LMS.</p>
        <p><a href="/simple-lms?view=requests">Review request</a></p>
      `,
      text: 'Simple LMS publish-without-review request pending review.'
    })))

    res.status(201).json({
      message: 'Permission request submitted.',
      request
    })
  } catch (error) {
    console.error('Simple LMS publish permission request error:', error)
    res.status(500).json({ error: 'Failed to submit permission request.' })
  }
})

apiRouter.post('/permissions/publish-without-review/:accountId/grant', rejectIdpManagedLmsPermission, async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!canManageOrganizationData(orgContext.memberRole)) {
      return res.status(403).json({ error: 'Only owner, admin, or HR manager can grant this permission.' })
    }

    const targetAccountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(targetAccountId)) {
      return res.status(400).json({ error: 'Invalid account id.' })
    }

    const permission = await SimpleLmsPermission.findOneAndUpdate(
      {
        organization: orgContext.organizationId,
        account: targetAccountId
      },
      {
        $set: {
          canPublishWithoutReview: true,
          isActive: true,
          grantedBy: req.user._id,
          grantedAt: new Date(),
          revokedBy: null,
          revokedAt: null
        }
      },
      {
        upsert: true,
        new: true
      }
    )

    const targetAccount = await Account.findById(targetAccountId)
      .select('email profile.name')
      .lean()
    await createNotification({
      organizationId: orgContext.organizationId,
      senderId: req.user._id,
      recipient: targetAccount,
      subject: 'Simple LMS publish permission granted',
      html: `
        <p>You can now publish public Simple LMS courses without review in <strong>${htmlEscape(orgContext.organizationName)}</strong>.</p>
        <p><a href="/simple-lms?view=course-studio">Open Simple LMS Course Studio</a></p>
      `,
      text: `Simple LMS publish permission granted in ${orgContext.organizationName}.`
    })

    res.json({
      message: 'Permission granted successfully.',
      permission
    })
  } catch (error) {
    console.error('Simple LMS grant publish permission error:', error)
    res.status(500).json({ error: 'Failed to grant permission.' })
  }
})

apiRouter.post('/permissions/publish-without-review/:accountId/revoke', rejectIdpManagedLmsPermission, async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }
    if (!canManageOrganizationData(orgContext.memberRole)) {
      return res.status(403).json({ error: 'Only owner, admin, or HR manager can revoke this permission.' })
    }

    const targetAccountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(targetAccountId)) {
      return res.status(400).json({ error: 'Invalid account id.' })
    }

    const permission = await SimpleLmsPermission.findOneAndUpdate(
      {
        organization: orgContext.organizationId,
        account: targetAccountId
      },
      {
        $set: {
          canPublishWithoutReview: false,
          isActive: false,
          revokedBy: req.user._id,
          revokedAt: new Date()
        }
      },
      {
        new: true
      }
    )

    res.json({
      message: 'Permission revoked successfully.',
      permission
    })
  } catch (error) {
    console.error('Simple LMS revoke publish permission error:', error)
    res.status(500).json({ error: 'Failed to revoke permission.' })
  }
})

apiRouter.post('/requests/:requestId/review', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: 'Invalid request id.' })
    }

    const request = await SimpleLmsRequest.findById(requestId)
    if (!request) {
      return res.status(404).json({ error: 'Request not found.' })
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request has already been processed.' })
    }

    const action = String(req.body.action || '').trim().toLowerCase()
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject.' })
    }

    const platformAdmin = isPlatformAdmin(req.user)
    const sameOrganization = toIdString(request.organization) === orgContext.organizationId
    const canReviewOrgRequest = sameOrganization && (
      hasLmsPermission(orgContext, 'manage_enrollments') ||
      hasLmsPermission(orgContext, 'publish_courses')
    )
    const canReviewPlatformRequest =
      platformAdmin ||
      (request.notificationRecipient && toIdString(request.notificationRecipient) === toIdString(req.user._id))

    if (request.requestType === 'publish_without_review') {
      return res.status(409).json({
        error: 'Publishing permissions are managed in the IdP permission matrix.',
        code: 'IDP_ACCESS_CONTROL_REQUIRED',
        manageUrl: `/organizations/${orgContext.organizationId}/access-control`
      })
    }
    if (['system_course_access', 'public_course_publish'].includes(request.requestType) && !canReviewPlatformRequest) {
      return res.status(403).json({ error: 'You do not have permission to review this request.' })
    }

    const reviewNotes = String(req.body.notes || '').trim().slice(0, 3000)
    const requesterAccount = await Account.findById(request.requestedBy)
      .select('email profile.name')
      .lean()

    if (action === 'reject') {
      await request.reject({ reviewerId: req.user._id, notes: reviewNotes })
      await sendRequestDecisionNotification({
        request,
        recipient: requesterAccount,
        decidedBy: req.user,
        approved: false
      })
      return res.json({
        message: 'Request rejected.',
        request
      })
    }

    if (request.requestType === 'publish_without_review') {
      const accountToGrant = request.targetAccount || request.requestedBy
      await SimpleLmsPermission.findOneAndUpdate(
        {
          organization: request.organization,
          account: accountToGrant
        },
        {
          $set: {
            canPublishWithoutReview: true,
            isActive: true,
            grantedBy: req.user._id,
            grantedAt: new Date(),
            notes: reviewNotes
          }
        },
        {
          upsert: true,
          new: true
        }
      )
    }

    if (request.requestType === 'public_course_publish') {
      const course = await SimpleLmsCourse.findById(request.course)
      if (!course) {
        return res.status(404).json({ error: 'Course for this request was not found.' })
      }

      course.status = 'published'
      course.visibility = 'organization_public'
      course.approvedPublicBy = req.user._id
      course.approvedPublicAt = new Date()
      await course.save()
    }

    if (request.requestType === 'system_course_access') {
      const course = await SimpleLmsCourse.findById(request.course)
      if (!course || !course.isActive) {
        return res.status(404).json({ error: 'Requested system course was not found.' })
      }

      const organization = await Organization.findById(request.organization)
        .select('members')
        .lean()
      if (!organization) {
        return res.status(404).json({ error: 'Request organization not found.' })
      }

      const requesterRole = organization.members.find(entry => toIdString(entry.account) === toIdString(request.requestedBy) && entry.status === 'active')?.role || 'staff'
      const [scope, orgMembersResult, teams] = await Promise.all([
        getSimpleLmsAccessScope({
          organizationId: toIdString(request.organization),
          accountId: request.requestedBy,
          memberRole: requesterRole
        }),
        getOrganizationMembersWithTeamContext({ organizationId: toIdString(request.organization) }),
        Team.find({ organization: request.organization })
          .select('_id name members.account members.status')
          .lean()
      ])

      const targetType = String(getMetadataValue(request.metadata, 'targetType', 'self') || 'self')
      const targetMemberId = String(getMetadataValue(request.metadata, 'targetMemberId', '') || '')
      const targetTeamId = String(getMetadataValue(request.metadata, 'targetTeamId', '') || '')
      const dueAtRaw = String(getMetadataValue(request.metadata, 'dueAt', '') || '')
      const dueAt = parseDueDate(dueAtRaw)

      const memberIds = buildAssignableMemberIds({
        targetType,
        targetMemberId,
        targetTeamId,
        accountId: request.requestedBy,
        memberRole: requesterRole,
        scope,
        orgMembers: orgMembersResult.members || [],
        teams
      })

      const assignmentType = targetType === 'organization'
        ? 'organization'
        : (targetType === 'team' ? 'team' : (targetType === 'self' ? 'self' : 'member'))

      await assignCourseToMembers({
        organizationId: request.organization,
        course,
        memberIds,
        assignedBy: req.user._id,
        assignmentType,
        assignedTeam: assignmentType === 'team' ? targetTeamId : null,
        dueAt,
        source: 'system_course_request'
      })
    }

    const markPaid = req.body.markPaid === true || req.body.markPaid === 'true'
    await request.approve({
      reviewerId: req.user._id,
      notes: reviewNotes,
      markPaid
    })

    await sendRequestDecisionNotification({
      request,
      recipient: requesterAccount,
      decidedBy: req.user,
      approved: true
    })

    res.json({
      message: 'Request approved successfully.',
      request
    })
  } catch (error) {
    console.error('Simple LMS review request error:', error)
    res.status(500).json({ error: error.message || 'Failed to review request.' })
  }
})

apiRouter.post('/requests/:requestId/cancel', async (req, res) => {
  try {
    const orgContext = await resolveCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.status(400).json({ error: orgContext.error })
    }

    const requestId = String(req.params.requestId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: 'Invalid request id.' })
    }

    const request = await SimpleLmsRequest.findOne({
      _id: requestId,
      organization: orgContext.organizationId,
      requestedBy: req.user._id
    })
    if (!request) {
      return res.status(404).json({ error: 'Request not found.' })
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled.' })
    }

    request.status = 'cancelled'
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reviewNotes = 'Cancelled by requester'
    await request.save()

    res.json({
      message: 'Request cancelled.',
      request
    })
  } catch (error) {
    console.error('Simple LMS cancel request error:', error)
    res.status(500).json({ error: 'Failed to cancel request.' })
  }
})

export { pageRouter as simpleLmsRouter, apiRouter as simpleLmsApiRouter }
export default pageRouter
