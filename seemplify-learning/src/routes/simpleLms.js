
import express from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { Account } from '../models/Account.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { SimpleLmsProgram } from '../models/SimpleLmsProgram.js'
import { SimpleLmsPayment } from '../models/SimpleLmsPayment.js'
import { SimpleLmsCommissionSetting } from '../models/SimpleLmsCommissionSetting.js'
import { SimpleLmsPlatformSetting } from '../models/SimpleLmsPlatformSetting.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../services/cloudinaryService.js'
import { createFlutterwavePaymentLink, verifyFlutterwaveTransaction, isFlutterwaveConfigured, getFlutterwavePublicKey } from '../services/flutterwaveService.js'
import { addSessionCartCourseId, clearSessionCart, getSessionCartCourseIds, hasSessionCartCourse, removeSessionCartCourseId, setSessionCartCourseIds } from '../utils/simpleLmsCart.js'

const pageRouter = express.Router()
const adminPageRouter = express.Router()
const apiRouter = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
})

const ROLES = ['super_admin', 'admin', 'creator', 'learner']
const VIEW_MODES = ['overview', 'settings', 'catalog', 'cart', 'my-learning', 'course-studio', 'program-studio', 'admin']
const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed']
const SORT_OPTIONS = ['newest', 'popular', 'title_asc', 'duration_desc']
const PUBLIC_VISIBILITY_VALUES = ['organization_public', 'system_public']
const CURRENCY_CODES = ['NGN', 'USD', 'EUR', 'GBP', 'KES', 'GHS', 'ZAR']
const PROGRAM_VISIBILITY_VALUES = ['organization_public']
const PAYMENT_STATUSES = ['initiated', 'pending', 'successful', 'failed', 'cancelled', 'refunded']
const SETTINGS_TABS = ['profile', 'creator', 'payments']
const ADMIN_SECTIONS = ['overview', 'courses', 'approvals', 'creators', 'users', 'commission', 'payments', 'settings', 'analytics']

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

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const resolveRole = (account) => {
  if (!account) return 'learner'
  if (account.isSuperAdmin) return 'super_admin'
  if (account.isSystemAdmin) return 'admin'
  const normalized = String(account.learningRole || '').trim().toLowerCase()
  return ROLES.includes(normalized) ? normalized : 'learner'
}

const canManagePlatform = (role) => ['super_admin', 'admin'].includes(role)
const canCreateCourses = (_role) => true

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

const normalizeCurrencyCode = (value, fallback = 'NGN') => {
  const normalized = String(value || '').trim().toUpperCase().slice(0, 3)
  if (CURRENCY_CODES.includes(normalized)) return normalized
  const fallbackCurrency = String(fallback || 'NGN').trim().toUpperCase().slice(0, 3)
  if (CURRENCY_CODES.includes(fallbackCurrency)) return fallbackCurrency
  return 'NGN'
}

const normalizeCreatorSettings = (raw = {}) => {
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
    defaultCurrency: normalizeCurrencyCode(raw?.defaultCurrency, CREATOR_SETTING_DEFAULTS.defaultCurrency),
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

const normalizePlatformSettings = (raw = {}) => {
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
    defaultCurrency: normalizeCurrencyCode(raw?.defaultCurrency, PLATFORM_SETTING_DEFAULTS.defaultCurrency),
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

const getPlatformSettings = async () => {
  const raw = await SimpleLmsPlatformSetting.findOne({}).lean()
  if (!raw) return normalizePlatformSettings(PLATFORM_SETTING_DEFAULTS)
  return normalizePlatformSettings(raw)
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
  const account = await Account.findOne({ sub })
  if (!account) {
    return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
  }
  req.user = account
  return next()
}

const requireAdminPageAuth = async (req, res, next) => {
  const sub = String(req.session?.accountId || '').trim()
  if (!sub) {
    return res.redirect(`/admin/login?return_to=${encodeURIComponent(req.originalUrl || '/admin')}`)
  }
  const account = await Account.findOne({ sub })
  if (!account) {
    return res.redirect(`/admin/login?return_to=${encodeURIComponent(req.originalUrl || '/admin')}`)
  }
  req.user = account
  return next()
}

const requireApiAuth = async (req, res, next) => {
  const sub = String(req.session?.accountId || '').trim()
  if (!sub) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  const account = await Account.findOne({ sub })
  if (!account) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.user = account
  return next()
}

const canManageCourse = ({ role, accountId, course }) => {
  if (!course) return false
  if (canManagePlatform(role)) return true
  return toIdString(course.createdBy) === toIdString(accountId)
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
        videoUrl: String(lesson?.videoUrl || lesson?.mediaUrl || lesson?.audioUrl || ''),
        durationMinutes: Number.isFinite(Number(lesson?.durationMinutes)) ? Number(lesson.durationMinutes) : 0,
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

const resolveLessonMedia = (rawUrl) => {
  const value = String(rawUrl || '').trim()
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
    authorName: String(course?.createdByName || '').trim() || 'Learning Team'
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

      const mediaUrl = String(rawLesson?.mediaUrl || rawLesson?.videoUrl || rawLesson?.audioUrl || '').trim().slice(0, 2000)

      lessons.push({
        key: lessonKey || `${chapterKey}-lesson-${lessonIndex + 1}`,
        title: lessonTitle.slice(0, 200),
        description: String(rawLesson?.description || '').trim().slice(0, 3000),
        videoUrl: mediaUrl,
        content: String(rawLesson?.content || '').trim().slice(0, 40000),
        durationMinutes: Number.isFinite(Number(rawLesson?.durationMinutes)) ? Math.max(0, Math.round(Number(rawLesson.durationMinutes))) : 0,
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
  platformSettings = PLATFORM_SETTING_DEFAULTS
}) => {
  const title = String(body.title || '').trim()
  if (!title) {
    throw new Error('Course title is required.')
  }

  const normalizedCreatorSettings = normalizeCreatorSettings(creatorSettings)
  const normalizedPlatformSettings = normalizePlatformSettings(platformSettings)
  const level = LEVELS.includes(String(body.level || '').trim())
    ? String(body.level).trim()
    : (existingCourse?.level || normalizedCreatorSettings.defaultLevel || 'mixed')
  const requestedStatus = parseCourseStatus(
    body.status || existingCourse?.status || normalizedPlatformSettings.defaultCourseStatus || 'draft',
    'draft'
  )
  const requiresApproval = !canManagePlatform(role) && normalizedPlatformSettings.requirePublicReviewForCreators
  const status = (requestedStatus === 'published' && requiresApproval)
    ? 'pending_public_review'
    : requestedStatus
  const visibilityInput = body.visibility
    || existingCourse?.visibility
    || normalizedCreatorSettings.defaultVisibility
    || normalizedPlatformSettings.defaultCourseVisibility
  const visibility = normalizeVisibility(visibilityInput, role)
  const chapters = sanitizeChaptersInput(parseJsonInput(body.chaptersJson, []))
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
  let amount = paymentMode === 'paid' ? Math.max(0, Math.round(Number(body.amount || existingCourse?.pricing?.amount || 0))) : 0
  amount = Math.max(normalizedPlatformSettings.minCoursePriceMinor, Math.min(amount, normalizedPlatformSettings.maxCoursePriceMinor))
  const currency = normalizeCurrencyCode(
    body.currency,
    existingCourse?.pricing?.currency || normalizedCreatorSettings.defaultCurrency || normalizedPlatformSettings.defaultCurrency || 'NGN'
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
  checkoutContext = 'direct'
}) => {
  if (!course || !course._id) {
    return redirectWithMessage({
      res,
      path: fallbackPath,
      error: 'Course not found or unavailable.'
    })
  }

  if (!isFlutterwaveConfigured()) {
    return redirectWithMessage({
      res,
      path: fallbackPath,
      error: 'Flutterwave is not configured yet. Contact an admin.'
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

  const normalizedCheckoutContext = String(checkoutContext || '').trim().toLowerCase() === 'cart'
    ? 'cart'
    : 'direct'
  const finalNextPath = sanitizeInternalPath(nextPath, `/simple-lms/take/${course._id}`)
  const finalFallbackPath = sanitizeInternalPath(fallbackPath, '/simple-lms?view=catalog')

  const recentPendingPayment = await SimpleLmsPayment.findOne({
    account: req.user._id,
    course: course._id,
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
            checkoutContext: normalizedCheckoutContext
          }
        }
      }
    )
    return res.redirect(recentPendingPayment.checkoutUrl)
  }

  const txRef = generateTxRef()
  const amountMinor = Math.max(0, Math.round(Number(course?.pricing?.amount || 0)))
  const currency = normalizeCurrencyCode(course?.pricing?.currency || 'NGN')

  const payment = await SimpleLmsPayment.create({
    account: req.user._id,
    course: course._id,
    creatorAccount: course.createdBy || null,
    txRef,
    amountMinor,
    currency,
    provider: 'flutterwave',
    status: 'initiated',
    customerEmail: req.user.email || '',
    customerName: req.user.profile?.name || req.user.email || 'Learner',
    metadata: {
      nextPath: finalNextPath,
      fallbackPath: finalFallbackPath,
      checkoutContext: normalizedCheckoutContext
    }
  })

  try {
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

    payment.checkoutUrl = checkout.link
    payment.status = 'pending'
    payment.flutterwaveStatus = 'pending'
    payment.metadata = {
      ...(payment.metadata || {}),
      nextPath: finalNextPath,
      fallbackPath: finalFallbackPath,
      checkoutContext: normalizedCheckoutContext,
      initResponse: checkout.raw
    }
    await payment.save()

    return res.redirect(checkout.link)
  } catch (error) {
    payment.status = 'failed'
    payment.flutterwaveStatus = 'init_error'
    payment.metadata = {
      ...(payment.metadata || {}),
      nextPath: finalNextPath,
      fallbackPath: finalFallbackPath,
      checkoutContext: normalizedCheckoutContext,
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
      course
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

    const previewEditUrl = managesCourse
      ? (canManagePlatform(role)
          ? `/admin/course-studio?editCourse=${course._id}`
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
      .select('_id pricing')
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
      account: req.user._id
    })
      .populate('course')

    if (!payment || !payment.course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Payment record not found.'
      })
    }
    const nextPath = sanitizeInternalPath(payment.metadata?.nextPath, `/simple-lms/take/${payment.course._id}`)
    const fallbackPath = sanitizeInternalPath(payment.metadata?.fallbackPath, '/simple-lms?view=catalog')
    const checkoutContext = String(payment.metadata?.checkoutContext || '').trim().toLowerCase() === 'cart'
      ? 'cart'
      : 'direct'
    const cartSuccessRedirect = async ({ defaultMessage }) => {
      if (checkoutContext !== 'cart') {
        return redirectWithMessage({
          res,
          path: nextPath,
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

    if (payment.status === 'successful') {
      await createOrUpdateEnrollment({
        courseId: payment.course._id,
        learnerId: req.user._id,
        actorId: req.user._id,
        assignmentType: 'self',
        source: 'self_enroll'
      })
      return cartSuccessRedirect({ defaultMessage: 'Payment already verified.' })
    }

    if (!transactionId || (status && !['successful', 'completed'].includes(status))) {
      payment.status = status === 'cancelled' ? 'cancelled' : 'failed'
      payment.flutterwaveStatus = status || 'failed'
      payment.verifiedAt = new Date()
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment was not completed.'
      })
    }

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

    payment.flutterwaveTxId = String(verifiedData?.id || transactionId)
    payment.flutterwaveStatus = verifiedStatus || status || 'unknown'
    payment.verificationPayload = verification
    payment.verifiedAt = new Date()

    if (!statusMatches || !txRefMatches || !amountMatches || verifiedCurrency !== payment.currency) {
      payment.status = 'failed'
      await payment.save()
      return redirectWithMessage({
        res,
        path: fallbackPath,
        error: 'Payment verification failed.'
      })
    }

    payment.status = 'successful'
    payment.paidAt = new Date()
    const commissionSettings = await getCommissionSettings()
    const creatorId = payment.course?.createdBy || payment.creatorAccount
    const commissionRate = resolveCommissionRate({
      settings: commissionSettings,
      creatorId,
      courseId: payment.course?._id || payment.course
    })
    const split = splitCommission({
      amountMinor: payment.amountMinor,
      ratePercent: commissionRate
    })
    payment.creatorAccount = creatorId || payment.creatorAccount || null
    payment.creatorCommissionRate = commissionRate
    payment.creatorCommissionMinor = split.creatorCommissionMinor
    payment.platformShareMinor = split.platformShareMinor
    await payment.save()
    removeSessionCartCourseId(req, payment.course._id)

    await createOrUpdateEnrollment({
      courseId: payment.course._id,
      learnerId: req.user._id,
      actorId: req.user._id,
      assignmentType: 'self',
      source: 'self_enroll'
    })

    return cartSuccessRedirect({ defaultMessage: 'Payment verified. Course unlocked.' })
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

    const lessonMedia = resolveLessonMedia(currentLesson.videoUrl)
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

    const platformSettings = await getPlatformSettings()
    const payload = parseCoursePayload({
      body: req.body,
      role,
      studioContext: req.body?.studioContext || '',
      creatorSettings: req.user.creatorSettings || CREATOR_SETTING_DEFAULTS,
      platformSettings
    })
    const createdCourse = await SimpleLmsCourse.create({
      ...payload,
      organization: null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Course Creator',
      createdByEmail: req.user.email || ''
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

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to update this course.'
      })
    }

    const platformSettings = await getPlatformSettings()
    const payload = parseCoursePayload({
      body: req.body,
      role,
      existingCourse: course,
      studioContext: req.body?.studioContext || '',
      creatorSettings: req.user.creatorSettings || CREATOR_SETTING_DEFAULTS,
      platformSettings
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
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'You do not have permission to duplicate courses.'
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

    if (!canManageCourse({ role, accountId: req.user._id, course: sourceCourse })) {
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
      organization: null,
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

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
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

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
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

    course.status = 'published'
    course.isActive = true
    course.publishedAt = course.publishedAt || new Date()
    course.approvedPublicAt = new Date()
    course.approvedPublicBy = req.user._id
    course.reviewedAt = new Date()
    course.reviewedBy = req.user._id
    course.reviewNotes = String(req.body.reviewNotes || '').trim().slice(0, 2000)
    await course.save()

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

pageRouter.post('/courses/:courseId/reject-public', requirePageAuth, async (req, res) => {
  const returnTo = resolveAdminReturnPath(req)
  try {
    const role = resolveRole(req.user)
    if (!canManagePlatform(role)) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Only admins can reject public course submissions.'
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

    course.status = 'draft'
    course.reviewedAt = new Date()
    course.reviewedBy = req.user._id
    course.reviewNotes = String(req.body.reviewNotes || '').trim().slice(0, 2000)
    await course.save()

    return redirectWithMessage({
      res,
      path: returnTo,
      success: `Course returned to draft: ${course.title}.`
    })
  } catch (error) {
    console.error('Reject course error:', error)
    return redirectWithMessage({
      res,
      path: returnTo,
      error: 'Failed to reject this course submission.'
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
    if (!course || !canManageCourse({ role, accountId: req.user._id, course })) {
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
    const allowedRoleUpdates = ['learner', 'admin', 'super_admin']
    if (!mongoose.Types.ObjectId.isValid(accountId) || !allowedRoleUpdates.includes(nextRole)) {
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
    if (currentTargetRole === 'super_admin' && nextRole !== 'super_admin') {
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

    target.learningRole = nextRole
    target.isSuperAdmin = nextRole === 'super_admin'
    target.isSystemAdmin = ['super_admin', 'admin'].includes(nextRole)
    await target.save()

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
      error: 'Failed to update role.'
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
    })

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

    const currentPlatformSettings = await getPlatformSettings()
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
    })

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

    const transactionId = String(req.body?.transactionId || payment.flutterwaveTxId || '').trim()
    if (!transactionId) {
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Provider transaction ID is required for re-verification.'
      })
    }

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

    payment.flutterwaveTxId = String(verifiedData?.id || transactionId)
    payment.flutterwaveStatus = verifiedStatus || payment.flutterwaveStatus || 'unknown'
    payment.verificationPayload = verification
    payment.verifiedAt = new Date()

    if (!statusMatches || !txRefMatches || !amountMatches || verifiedCurrency !== payment.currency) {
      payment.status = 'failed'
      await payment.save()
      return redirectWithMessage({
        res,
        path: returnTo,
        error: 'Payment verification mismatch. Record kept as failed.'
      })
    }

    const commissionSettings = await getCommissionSettings()
    const creatorId = payment.course?.createdBy || payment.creatorAccount
    const commissionRate = resolveCommissionRate({
      settings: commissionSettings,
      creatorId,
      courseId: payment.course?._id || payment.course
    })
    const split = splitCommission({
      amountMinor: payment.amountMinor,
      ratePercent: commissionRate
    })

    payment.status = 'successful'
    payment.paidAt = payment.paidAt || new Date()
    payment.creatorAccount = creatorId || payment.creatorAccount || null
    payment.creatorCommissionRate = commissionRate
    payment.creatorCommissionMinor = split.creatorCommissionMinor
    payment.platformShareMinor = split.platformShareMinor
    await payment.save()

    await createOrUpdateEnrollment({
      courseId: payment.course._id,
      learnerId: payment.account,
      actorId: payment.account,
      assignmentType: 'self',
      source: 'self_enroll'
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
    const { cartCourses, cartSummary } = await resolveCartWorkspaceState({
      req,
      accountId: req.user._id
    })
    res.locals.simpleLmsCartCount = cartSummary.itemCount
    const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'

    return res.render('simple-lms-cart', {
      title: `${learningName} - Cart`,
      user: req.user,
      activePage: 'simple-lms',
      activeLmsView: 'workspace',
      cartCourses,
      cartSummary,
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

const renderWorkspacePage = async (
  req,
  res,
  { forcedViewMode = '', adminPortal = false, studioPortal = false, studioContext = '', adminSection = '' } = {}
) => {
  try {
    const role = resolveRole(req.user)
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
      return CURRENCY_CODES.includes(normalized) ? normalized : 'all'
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
    const managedFilter = canManagePlatform(role) && !isCreatorStudioContext
      ? {}
      : { createdBy: req.user._id }
    const managedProgramFilter = canManagePlatform(role) && !isCreatorStudioContext
      ? {}
      : { createdBy: req.user._id }

    const [catalogRaw, managedRaw, myEnrollmentsRaw, categoriesRaw, totalAccounts, totalCreators, completedEnrollments, adminAccountsRaw, totalPublishedCourses, catalogProgramsRaw, managedProgramsRaw, totalPublishedPrograms, assignableAccountsRaw, myPaymentsRaw, adminPaymentsRaw, pendingReviewCoursesRaw, commissionSettingsRaw, platformSettingsRaw] = await Promise.all([
      SimpleLmsCourse.find(catalogFilter)
        .sort(mapSortToMongo(sortFilter))
        .limit(240)
        .lean(),
      canCreateCourses(role)
        ? SimpleLmsCourse.find({ ...managedFilter })
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
          .select('email profile.name learningRole isSystemAdmin isSuperAdmin createdAt')
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
        .select('course amountMinor currency paidAt txRef flutterwaveTxId')
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
      getPlatformSettings()
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

    const managedCourses = managedRaw.map(course => decorateCourse(course))
    const catalogProgramsDecorated = catalogProgramsRaw.map(program => decorateProgram(program, programCourseMap))
    const managedPrograms = managedProgramsRaw.map(program => decorateProgram(program, programCourseMap))

    let editingCourse = null
    if (editCourseId && mongoose.Types.ObjectId.isValid(editCourseId) && canCreateCourses(role)) {
      const candidate = managedRaw.find(course => toIdString(course._id) === editCourseId)
      if (candidate) {
        editingCourse = decorateCourse(candidate)
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

    const adminAccounts = adminAccountsRaw.map((account) => ({
      ...account,
      resolvedRole: resolveRole(account),
      displayName: account.profile?.name || account.email || 'User'
    }))

    const roleBreakdown = {
      super_admin: adminAccounts.filter(account => account.resolvedRole === 'super_admin').length,
      admin: adminAccounts.filter(account => account.resolvedRole === 'admin').length,
      creator: adminAccounts.filter(account => account.resolvedRole === 'creator').length,
      learner: adminAccounts.filter(account => account.resolvedRole === 'learner').length
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
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency)
    }))

    const managedCourseIdList = managedRaw.map((course) => course._id)
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

    const commissionSettings = {
      globalRatePercent: normalizeCommissionRate(commissionSettingsRaw?.globalRatePercent, 70),
      accountOverrides: Array.isArray(commissionSettingsRaw?.accountOverrides) ? commissionSettingsRaw.accountOverrides : [],
      courseOverrides: Array.isArray(commissionSettingsRaw?.courseOverrides) ? commissionSettingsRaw.courseOverrides : []
    }
    const platformSettings = normalizePlatformSettings(platformSettingsRaw || PLATFORM_SETTING_DEFAULTS)
    const creatorSettings = normalizeCreatorSettings(req.user.creatorSettings || CREATOR_SETTING_DEFAULTS)

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
        platformShareDisplay: formatCurrencyAmount(platformShareMinor, payment.currency)
      }
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

    let adminPayments = (adminPaymentsRaw || []).map((payment) => ({
      ...payment,
      learnerName: payment.account?.profile?.name || payment.account?.email || 'Learner',
      learnerEmail: payment.account?.email || '',
      courseTitle: payment.course?.title || 'Course',
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency),
      creatorCommissionDisplay: formatCurrencyAmount(payment.creatorCommissionMinor || 0, payment.currency),
      platformShareDisplay: formatCurrencyAmount(payment.platformShareMinor || 0, payment.currency),
      statusLabel: String(payment.status || '').replace(/_/g, ' ')
    }))

    if (paymentSearchFilter) {
      const needle = paymentSearchFilter.toLowerCase()
      adminPayments = adminPayments.filter((payment) => {
        const haystack = [
          payment.txRef,
          payment.flutterwaveTxId,
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
          saleCount: Math.max(0, Number(salesStats.saleCount || 0)),
          uniqueLearnerCount: salesStats.uniqueLearnerIds instanceof Set ? salesStats.uniqueLearnerIds.size : 0,
          grossMinor: Math.max(0, Number(salesStats.grossMinor || 0)),
          grossDisplay: formatCurrencyAmount(salesStats.grossMinor || 0, 'NGN'),
          creatorCommissionMinor: Math.max(0, Number(salesStats.creatorCommissionMinor || 0)),
          creatorCommissionDisplay: formatCurrencyAmount(salesStats.creatorCommissionMinor || 0, 'NGN'),
          platformShareMinor: Math.max(0, Number(salesStats.platformShareMinor || 0)),
          platformShareDisplay: formatCurrencyAmount(salesStats.platformShareMinor || 0, 'NGN'),
          commissionRatePercent,
          hasCommissionOverride,
          commissionOverrideRatePercent: hasCommissionOverride
            ? normalizeCommissionRate(commissionOverrideByAccountId.get(creatorId), commissionSettings.globalRatePercent)
            : null,
          topCourses,
          coursesPath: `/admin/courses?creatorId=${encodeURIComponent(creatorId)}`,
          creatorPath: `/admin/creators?creatorId=${encodeURIComponent(creatorId)}`
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
    const approvalQueueCourses = canManagePlatform(role)
      ? managedCourses
        .filter((course) => {
          const status = String(course.status || '').trim().toLowerCase()
          return course.isActive !== false && (status === 'pending_public_review' || status === 'draft')
        })
        .map((course) => ({
          ...course,
          creatorName: course.createdByName || course.authorName || 'Author',
          creatorEmail: course.createdByEmail || '',
          submittedAt: course.submittedForPublicReviewAt || course.updatedAt || course.createdAt
        }))
        .sort((a, b) => {
          const bTime = new Date(b.submittedAt || 0).getTime()
          const aTime = new Date(a.submittedAt || 0).getTime()
          return bTime - aTime
        })
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
      adminStudioPath: '/admin/course-studio',
      courseStudioReturnTo: resolvedStudioContext === 'admin' ? '/admin/course-studio' : '/simple-lms/studio/courses',
      settingsTab,
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
      myPayments,
      myCreatorSales,
      creatorStats,
      creatorCourseInsights,
      creatorSettings,
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
        returnTo: adminCoursesReturnTo
      },
      adminCreatorFilters: {
        creatorId: adminCreatorFilterId,
        returnTo: adminCreatorsReturnTo
      },
      paymentStatuses: PAYMENT_STATUSES,
      paymentCurrencies: CURRENCY_CODES,
      paymentStats: {
        ...paymentStats,
        revenueDisplay: formatCurrencyAmount(paymentStats.revenueMinor, 'NGN'),
        creatorPayoutDisplay: formatCurrencyAmount(paymentStats.creatorPayoutMinor, 'NGN')
      },
      analytics,
      platformSettings,
      flutterwave: {
        enabled: isFlutterwaveConfigured(),
        publicKey: getFlutterwavePublicKey()
      },
      pendingReviewCourses,
      approvalQueueCourses,
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
        ? (studioContext === 'admin' ? '/admin/course-studio' : '/simple-lms/studio/courses')
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
adminPageRouter.get('/creators', requireAdminPageAuth, renderAdminPortalSection('creators'))
adminPageRouter.get('/users', requireAdminPageAuth, renderAdminPortalSection('users'))
adminPageRouter.get('/commission', requireAdminPageAuth, renderAdminPortalSection('commission'))
adminPageRouter.get('/payments', requireAdminPageAuth, renderAdminPortalSection('payments'))
adminPageRouter.get('/settings', requireAdminPageAuth, renderAdminPortalSection('settings'))
adminPageRouter.get('/analytics', requireAdminPageAuth, renderAdminPortalSection('analytics'))

adminPageRouter.get('/course-studio', requireAdminPageAuth, async (req, res) => (
  renderWorkspacePage(req, res, {
    forcedViewMode: 'course-studio',
    adminPortal: true,
    studioPortal: true,
    studioContext: 'admin'
  })
))

apiRouter.post('/payments/flutterwave/webhook', async (req, res) => {
  try {
    const configuredHash = String(process.env.FLUTTERWAVE_WEBHOOK_HASH || '').trim()
    if (configuredHash) {
      const receivedHash = String(req.headers['verif-hash'] || '').trim()
      if (!receivedHash || receivedHash !== configuredHash) {
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

    const payment = await SimpleLmsPayment.findOne({ txRef })
    if (!payment || payment.status === 'successful') {
      return res.json({ ok: true })
    }

    const verification = await verifyFlutterwaveTransaction(transactionId)
    const verifiedData = verification?.data || {}
    const verifiedStatus = String(verifiedData?.status || '').toLowerCase()
    const verifiedCurrency = normalizeCurrencyCode(verifiedData?.currency || payment.currency)
    const verifiedAmountMajor = Number(verifiedData?.amount || 0)
    const expectedAmountMajor = Number(payment.amountMinor || 0) / 100
    const amountMatches = Math.abs(verifiedAmountMajor - expectedAmountMajor) < 0.01
    const txRefMatches = String(verifiedData?.tx_ref || '').trim() === payment.txRef
    const statusMatches = verifiedStatus === 'successful'

    payment.flutterwaveTxId = String(verifiedData?.id || transactionId)
    payment.flutterwaveStatus = verifiedStatus || 'unknown'
    payment.verificationPayload = verification
    payment.verifiedAt = new Date()

    if (statusMatches && amountMatches && txRefMatches && verifiedCurrency === payment.currency) {
      const courseForCommission = await SimpleLmsCourse.findById(payment.course)
        .select('_id createdBy')
        .lean()
      const commissionSettings = await getCommissionSettings()
      const creatorId = courseForCommission?.createdBy || payment.creatorAccount
      const commissionRate = resolveCommissionRate({
        settings: commissionSettings,
        creatorId,
        courseId: courseForCommission?._id || payment.course
      })
      const split = splitCommission({
        amountMinor: payment.amountMinor,
        ratePercent: commissionRate
      })
      payment.status = 'successful'
      payment.paidAt = new Date()
      payment.creatorAccount = creatorId || payment.creatorAccount || null
      payment.creatorCommissionRate = commissionRate
      payment.creatorCommissionMinor = split.creatorCommissionMinor
      payment.platformShareMinor = split.platformShareMinor
      await payment.save()

      await createOrUpdateEnrollment({
        courseId: payment.course,
        learnerId: payment.account,
        actorId: payment.account,
        assignmentType: 'self',
        source: 'self_enroll'
      })
    } else {
      payment.status = 'failed'
      await payment.save()
    }

    return res.json({ ok: true })
  } catch (error) {
    console.error('Flutterwave webhook error:', error)
    return res.status(500).json({ error: 'Webhook processing failed.' })
  }
})

pageRouter.post('/profile/payout', requirePageAuth, async (req, res) => {
  const returnTo = sanitizeInternalPath(
    req.body?.returnTo || '/simple-lms?view=settings&settingsTab=payments',
    '/simple-lms?view=settings&settingsTab=payments'
  )
  try {
    req.user.payoutProfile = req.user.payoutProfile || {}
    req.user.payoutProfile.accountName = String(req.body.accountName || '').trim().slice(0, 200)
    req.user.payoutProfile.accountNumber = String(req.body.accountNumber || '').trim().slice(0, 64)
    req.user.payoutProfile.bankName = String(req.body.bankName || '').trim().slice(0, 200)
    req.user.payoutProfile.bankCode = String(req.body.bankCode || '').trim().slice(0, 80)
    req.user.payoutProfile.swiftCode = String(req.body.swiftCode || '').trim().slice(0, 80)
    req.user.payoutProfile.currency = normalizeCurrencyCode(req.body.currency, req.user.payoutProfile.currency || 'NGN')
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

apiRouter.get('/workspace', async (_req, res) => res.redirect('/simple-lms'))

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

export { pageRouter as simpleLmsRouter, adminPageRouter as simpleLmsAdminRouter, apiRouter as simpleLmsApiRouter }
export default pageRouter

