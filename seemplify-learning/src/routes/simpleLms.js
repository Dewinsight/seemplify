
import express from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { Account } from '../models/Account.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { SimpleLmsProgram } from '../models/SimpleLmsProgram.js'
import { SimpleLmsPayment } from '../models/SimpleLmsPayment.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../services/cloudinaryService.js'
import { createFlutterwavePaymentLink, verifyFlutterwaveTransaction, isFlutterwaveConfigured, getFlutterwavePublicKey } from '../services/flutterwaveService.js'

const pageRouter = express.Router()
const apiRouter = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
})

const ROLES = ['super_admin', 'admin', 'creator', 'learner']
const VIEW_MODES = ['overview', 'catalog', 'my-learning', 'course-studio', 'program-studio', 'admin']
const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed']
const SORT_OPTIONS = ['newest', 'popular', 'title_asc', 'duration_desc']
const PUBLIC_VISIBILITY_VALUES = ['organization_public', 'system_public']
const CURRENCY_CODES = ['NGN', 'USD', 'EUR', 'GBP', 'KES', 'GHS', 'ZAR']
const PROGRAM_VISIBILITY_VALUES = ['organization_public']

const LEVEL_LABELS = Object.freeze({
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Mixed'
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
const canCreateCourses = (role) => canManagePlatform(role) || role === 'creator'

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

const isCoursePaidContent = (course) => {
  const paymentMode = String(course?.pricing?.paymentMode || '').trim().toLowerCase()
  const amount = Number.isFinite(Number(course?.pricing?.amount)) ? Number(course.pricing.amount) : 0
  return paymentMode === 'paid' && amount > 0
}

const buildAppBaseUrl = (req) => {
  const configured = String(process.env.APP_BASE_URL || '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  return `${req.protocol}://${req.get('host')}`
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
  return role === 'creator' && toIdString(course.createdBy) === toIdString(accountId)
}

const canManageProgram = ({ role, accountId, program }) => {
  if (!program) return false
  if (canManagePlatform(role)) return true
  return role === 'creator' && toIdString(program.createdBy) === toIdString(accountId)
}

const parseViewMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'studio' || normalized === 'course-studio' || normalized === 'manage') return 'course-studio'
  if (normalized === 'program-studio' || normalized === 'pathways') return 'program-studio'
  return VIEW_MODES.includes(normalized) ? normalized : 'overview'
}

const parseCourseStatus = (value, fallback = 'draft') => {
  const normalized = String(value || '').trim().toLowerCase()
  return ['draft', 'published', 'archived'].includes(normalized) ? normalized : fallback
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
  for (const chapter of course?.chapters || []) {
    const chapterKey = String(chapter?.key || '')
    const chapterTitle = String(chapter?.title || 'Chapter')
    for (const lesson of chapter?.lessons || []) {
      const lessonKey = String(lesson?.key || '').trim()
      if (!lessonKey) continue
      entries.push({
        chapterKey,
        chapterTitle,
        lessonKey,
        title: String(lesson?.title || 'Lesson'),
        description: String(lesson?.description || ''),
        content: String(lesson?.content || ''),
        videoUrl: String(lesson?.videoUrl || ''),
        durationMinutes: Number.isFinite(Number(lesson?.durationMinutes)) ? Number(lesson.durationMinutes) : 0,
        resources: Array.isArray(lesson?.resources) ? lesson.resources : [],
        quizQuestions: Array.isArray(lesson?.quizQuestions) ? lesson.quizQuestions : []
      })
    }
  }
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

const resolveVideoEmbedUrl = (rawUrl) => {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v')
      if (videoId) return `https://www.youtube.com/embed/${videoId}`
    }
    if (hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0]
      if (videoId) return `https://www.youtube.com/embed/${videoId}`
    }
    if (hostname.includes('drive.google.com')) {
      const parts = parsed.pathname.split('/')
      const dIndex = parts.findIndex(part => part === 'd')
      if (dIndex >= 0 && parts[dIndex + 1]) {
        return `https://drive.google.com/file/d/${parts[dIndex + 1]}/preview`
      }
    }
  } catch {
    return ''
  }
  return ''
}

const decorateCourse = (course) => {
  const paymentMode = course?.pricing?.paymentMode === 'paid' ? 'paid' : 'free'
  const amount = Number.isFinite(Number(course?.pricing?.amount)) ? Math.max(0, Number(course.pricing.amount)) : 0
  const currency = normalizeCurrencyCode(course?.pricing?.currency)
  const displayPrice = paymentMode === 'paid' && amount > 0 ? formatCurrencyAmount(amount, currency) : 'Free'

  return {
    ...course,
    levelLabel: LEVEL_LABELS[course?.level] || 'Mixed',
    summaryText: String(course?.summary || '').trim() || String(course?.description || '').trim() || 'No summary yet.',
    displayPrice,
    visibilityDisplay: visibilityToDisplay(course?.visibility),
    lessonCount: Number.isFinite(Number(course?.lessonCount)) ? Number(course.lessonCount) : 0,
    estimatedDurationMinutes: Number.isFinite(Number(course?.estimatedDurationMinutes)) ? Number(course.estimatedDurationMinutes) : 0,
    courseUrl: `/courses/${course._id}${course.slug ? `/${course.slug}` : ''}`,
    authorName: String(course?.createdByName || '').trim() || 'Seemplify Learning'
  }
}

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
  return res.redirect(query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path)
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

      lessons.push({
        key: lessonKey || `${chapterKey}-lesson-${lessonIndex + 1}`,
        title: lessonTitle.slice(0, 200),
        description: String(rawLesson?.description || '').trim().slice(0, 3000),
        videoUrl: String(rawLesson?.videoUrl || '').trim().slice(0, 2000),
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

const parseCoursePayload = ({ body, role, existingCourse = null }) => {
  const title = String(body.title || '').trim()
  if (!title) {
    throw new Error('Course title is required.')
  }

  const level = LEVELS.includes(String(body.level || '').trim()) ? String(body.level).trim() : 'mixed'
  const status = parseCourseStatus(body.status || existingCourse?.status || 'draft', 'draft')
  const visibility = normalizeVisibility(body.visibility || existingCourse?.visibility, role)
  const chapters = sanitizeChaptersInput(parseJsonInput(body.chaptersJson, []))
  const bannerPayload = parseJsonInput(body.bannerPayload, {})
  const paymentMode = String(body.paymentMode || '').trim() === 'paid' ? 'paid' : 'free'
  const amount = paymentMode === 'paid' ? Math.max(0, Math.round(Number(body.amount || 0))) : 0
  const currency = normalizeCurrencyCode(body.currency, existingCourse?.pricing?.currency || 'NGN')

  const payload = {
    title: title.slice(0, 200),
    summary: String(body.summary || '').trim().slice(0, 600),
    description: String(body.description || '').trim().slice(0, 16000),
    category: String(body.category || '').trim().slice(0, 120),
    level,
    tags: parseTags(body.tags),
    status,
    visibility,
    chapters,
    pricing: {
      paymentMode,
      amount,
      currency
    }
  }

  if (bannerPayload && typeof bannerPayload === 'object' && String(bannerPayload.url || '').trim()) {
    payload.banner = {
      url: String(bannerPayload.url || '').trim().slice(0, 2000),
      publicId: String(bannerPayload.publicId || '').trim().slice(0, 400),
      width: Number.isFinite(Number(bannerPayload.width)) ? Number(bannerPayload.width) : undefined,
      height: Number.isFinite(Number(bannerPayload.height)) ? Number(bannerPayload.height) : undefined
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

  if (canManagePlatform(role)) {
    payload.isSystemCourse = body.isSystemCourse === true || body.isSystemCourse === 'on'
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

pageRouter.get('/take/:courseId', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.redirect('/courses')
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    }).lean()

    if (!course) return res.redirect('/courses')

    if (isCoursePaidContent(course)) {
      const hasSuccessfulPayment = await SimpleLmsPayment.exists({
        account: req.user._id,
        course: course._id,
        status: 'successful'
      })
      if (!hasSuccessfulPayment) {
        return redirectWithMessage({
          res,
          path: '/simple-lms?view=catalog',
          error: `Payment required before starting "${course.title}".`
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

pageRouter.post('/courses/:courseId/pay', requirePageAuth, async (req, res) => {
  try {
    if (!isFlutterwaveConfigured()) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Flutterwave is not configured yet. Contact an admin.'
      })
    }

    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Invalid course selected for payment.'
      })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isActive: true,
      status: 'published',
      visibility: { $in: PUBLIC_VISIBILITY_VALUES }
    }).lean()

    if (!course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: 'Course not found or unavailable.'
      })
    }

    if (!isCoursePaidContent(course)) {
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
      return redirectWithMessage({
        res,
        path: `/simple-lms/take/${course._id}`,
        success: 'Payment already completed for this course.'
      })
    }

    const txRef = generateTxRef()
    const amountMinor = Math.max(0, Math.round(Number(course?.pricing?.amount || 0)))
    const currency = normalizeCurrencyCode(course?.pricing?.currency || 'NGN')
    const payment = await SimpleLmsPayment.create({
      account: req.user._id,
      course: course._id,
      txRef,
      amountMinor,
      currency,
      provider: 'flutterwave',
      status: 'initiated',
      customerEmail: req.user.email || '',
      customerName: req.user.profile?.name || req.user.email || 'Learner'
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
        initResponse: checkout.raw
      }
      await payment.save()

      return res.redirect(checkout.link)
    } catch (error) {
      payment.status = 'failed'
      payment.flutterwaveStatus = 'init_error'
      payment.metadata = {
        initError: String(error?.message || 'Failed to initialize payment')
      }
      await payment.save()

      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
        error: error.message || 'Failed to initialize payment checkout.'
      })
    }
  } catch (error) {
    console.error('Create payment error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
      error: 'Could not start payment for this course.'
    })
  }
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

    if (payment.status === 'successful') {
      return redirectWithMessage({
        res,
        path: `/simple-lms/take/${payment.course._id}`,
        success: 'Payment already verified.'
      })
    }

    if (!transactionId || (status && !['successful', 'completed'].includes(status))) {
      payment.status = status === 'cancelled' ? 'cancelled' : 'failed'
      payment.flutterwaveStatus = status || 'failed'
      payment.verifiedAt = new Date()
      await payment.save()
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=catalog',
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
        path: '/simple-lms?view=catalog',
        error: 'Payment verification failed.'
      })
    }

    payment.status = 'successful'
    payment.paidAt = new Date()
    await payment.save()

    await createOrUpdateEnrollment({
      courseId: payment.course._id,
      learnerId: req.user._id,
      actorId: req.user._id,
      assignmentType: 'self',
      source: 'self_enroll'
    })

    return redirectWithMessage({
      res,
      path: `/simple-lms/take/${payment.course._id}`,
      success: 'Payment verified. Course unlocked.'
    })
  } catch (error) {
    console.error('Flutterwave callback error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=catalog',
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

    const embedUrl = resolveVideoEmbedUrl(currentLesson.videoUrl)
    const chapterSections = (enrollment.course.chapters || []).map((chapter) => ({
      key: String(chapter?.key || ''),
      title: String(chapter?.title || 'Chapter'),
      lessons: (chapter?.lessons || [])
        .map((lesson) => ({
          key: String(lesson?.key || '').trim(),
          title: String(lesson?.title || 'Lesson'),
          durationMinutes: Number.isFinite(Number(lesson?.durationMinutes)) ? Number(lesson.durationMinutes) : 0
        }))
        .filter((lesson) => lesson.key)
    }))

    return res.render('simple-lms-player', {
      title: `${enrollment.course.title} - Learning Player`,
      user: req.user,
      activePage: 'simple-lms',
      role,
      enrollment,
      course: decorateCourse(enrollment.course),
      lessons,
      currentLesson,
      embedUrl,
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
    const enrollmentId = String(req.params.enrollmentId || '').trim()
    const lessonKey = String(req.params.lessonKey || '').trim()
    if (!mongoose.Types.ObjectId.isValid(enrollmentId) || !lessonKey) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=my-learning',
        error: 'Invalid quiz submission request.'
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
        error: 'You can only submit quizzes for your own lessons.'
      })
    }

    const lessons = flattenCourseLessons(enrollment.course)
    const lesson = lessons.find(entry => entry.lessonKey === lessonKey)
    if (!lesson) {
      return redirectWithMessage({
        res,
        path: `/simple-lms/learn/${enrollment._id}`,
        error: 'Lesson not found.'
      })
    }

    const questions = lesson.quizQuestions || []
    if (questions.length === 0) {
      return redirectWithMessage({
        res,
        path: `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(lessonKey)}`,
        error: 'No quiz is available for this lesson.'
      })
    }

    const answers = questions.map((_, index) => {
      const raw = req.body[`answer_${index}`]
      const parsed = Number.parseInt(String(raw ?? '-1'), 10)
      return Number.isInteger(parsed) ? parsed : -1
    })

    let score = 0
    questions.forEach((question, questionIndex) => {
      const choices = Array.isArray(question?.choices) ? question.choices : []
      const correctIndex = choices.findIndex(choice => Boolean(choice?.isCorrect))
      if (correctIndex >= 0 && answers[questionIndex] === correctIndex) {
        score += 1
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

    return redirectWithMessage({
      res,
      path: `/simple-lms/learn/${enrollment._id}/${encodeURIComponent(lessonKey)}`,
      success: `Quiz submitted. Score: ${score}/${maxScore} (${percentage}%).`
    })
  } catch (error) {
    console.error('Submit quiz error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=my-learning',
      error: 'Failed to submit quiz.'
    })
  }
})
pageRouter.post('/courses/create', requirePageAuth, async (req, res) => {
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Only admins and course creators can create courses.'
      })
    }

    const payload = parseCoursePayload({ body: req.body, role })
    await SimpleLmsCourse.create({
      ...payload,
      organization: null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Course Creator',
      createdByEmail: req.user.email || ''
    })

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      success: 'Course created successfully.'
    })
  } catch (error) {
    console.error('Create course error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      error: error.message || 'Failed to create course.'
    })
  }
})

pageRouter.post('/courses/:courseId/update', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Course not found.'
      })
    }

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'You do not have permission to update this course.'
      })
    }

    const payload = parseCoursePayload({
      body: req.body,
      role,
      existingCourse: course
    })

    Object.assign(course, payload)
    await course.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      success: 'Course updated successfully.'
    })
  } catch (error) {
    console.error('Update course error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      error: error.message || 'Failed to update course.'
    })
  }
})

pageRouter.post('/courses/:courseId/archive', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Course not found.'
      })
    }

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'You do not have permission to archive this course.'
      })
    }

    course.status = 'archived'
    course.isActive = false
    course.archivedAt = new Date()
    await course.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      success: 'Course archived.'
    })
  } catch (error) {
    console.error('Archive course error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      error: 'Failed to archive course.'
    })
  }
})

pageRouter.post('/courses/:courseId/restore', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    const course = await SimpleLmsCourse.findById(courseId)
    if (!course) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Course not found.'
      })
    }

    if (!canManageCourse({ role, accountId: req.user._id, course })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'You do not have permission to restore this course.'
      })
    }

    course.status = 'draft'
    course.isActive = true
    course.archivedAt = null
    await course.save()

    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      success: 'Course restored to draft.'
    })
  } catch (error) {
    console.error('Restore course error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
      error: 'Failed to restore course.'
    })
  }
})

pageRouter.post('/courses/:courseId/assign', requirePageAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Invalid course selected.'
      })
    }

    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
        error: 'Only creators and admins can assign courses.'
      })
    }

    const course = await SimpleLmsCourse.findById(courseId).lean()
    if (!course || !canManageCourse({ role, accountId: req.user._id, course })) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=course-studio',
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
        path: '/simple-lms?view=course-studio',
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
      path: '/simple-lms?view=course-studio',
      success: `Course assigned to ${targetAccount.profile?.name || targetAccount.email}.`
    })
  } catch (error) {
    console.error('Assign course error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=course-studio',
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
        error: 'Only admins and course creators can create programs.'
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
        error: 'Only creators and admins can assign programs.'
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
  try {
    const actorRole = resolveRole(req.user)
    if (!canManagePlatform(actorRole)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=admin',
        error: 'Only admins can update roles.'
      })
    }

    const accountId = String(req.params.accountId || '').trim()
    const nextRole = String(req.body.role || '').trim().toLowerCase()
    if (!mongoose.Types.ObjectId.isValid(accountId) || !ROLES.includes(nextRole)) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=admin',
        error: 'Invalid role update request.'
      })
    }

    const target = await Account.findById(accountId)
    if (!target) {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=admin',
        error: 'Account not found.'
      })
    }

    if (nextRole === 'super_admin' && actorRole !== 'super_admin') {
      return redirectWithMessage({
        res,
        path: '/simple-lms?view=admin',
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
          path: '/simple-lms?view=admin',
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
      path: '/simple-lms?view=admin',
      success: 'Role updated successfully.'
    })
  } catch (error) {
    console.error('Role update error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms?view=admin',
      error: 'Failed to update role.'
    })
  }
})
pageRouter.get('/', requirePageAuth, async (req, res) => {
  try {
    const role = resolveRole(req.user)
    const viewMode = parseViewMode(req.query.view)
    const query = String(req.query.q || '').trim()
    const categoryFilter = String(req.query.category || '').trim()
    const levelFilter = String(req.query.level || '').trim().toLowerCase()
    const sortFilter = normalizeSort(req.query.sort)
    const editCourseId = String(req.query.editCourse || req.query.edit || '').trim()
    const editProgramId = String(req.query.editProgram || '').trim()

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

    const managedFilter = canManagePlatform(role) ? {} : { createdBy: req.user._id }
    const managedProgramFilter = canManagePlatform(role) ? {} : { createdBy: req.user._id }

    const [catalogRaw, managedRaw, myEnrollmentsRaw, categoriesRaw, totalAccounts, totalCreators, completedEnrollments, adminAccountsRaw, totalPublishedCourses, catalogProgramsRaw, managedProgramsRaw, totalPublishedPrograms, assignableAccountsRaw, myPaymentsRaw, adminPaymentsRaw] = await Promise.all([
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
      Account.countDocuments({
        $or: [
          { learningRole: 'creator' },
          { learningRole: 'admin' },
          { learningRole: 'super_admin' },
          { isSystemAdmin: true },
          { isSuperAdmin: true }
        ]
      }),
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
        .sort({ paidAt: -1, createdAt: -1 })
        .lean(),
      canManagePlatform(role)
        ? SimpleLmsPayment.find({})
          .populate('account', 'email profile.name')
          .populate('course', 'title')
          .sort({ createdAt: -1 })
          .limit(200)
          .lean()
        : Promise.resolve([])
    ])

    const myEnrollments = myEnrollmentsRaw
      .filter(entry => entry.course && entry.course.isActive)
      .map((entry) => {
        const lessons = flattenCourseLessons(entry.course)
        const progress = calculateProgress({ lessons, completedLessonKeys: entry.completedLessonKeys || [] })
        return {
          ...entry,
          course: decorateCourse(entry.course),
          lessonCount: progress.lessonCount,
          completedCount: progress.completedCount,
          progressPercent: Number.isFinite(Number(entry.progressPercent)) ? Number(entry.progressPercent) : progress.progressPercent,
          nextLessonKey: progress.nextLessonKey,
          isCompleted: progress.isCompleted
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
        canStart: !requiresPayment || isPaid || isEnrolled
      }
    })
    const recommendedCourses = catalogCourses.filter(course => !course.isEnrolled).slice(0, 8)
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
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency)
    }))

    const adminPayments = (adminPaymentsRaw || []).map((payment) => ({
      ...payment,
      learnerName: payment.account?.profile?.name || payment.account?.email || 'Learner',
      learnerEmail: payment.account?.email || '',
      courseTitle: payment.course?.title || 'Course',
      amountDisplay: formatCurrencyAmount(payment.amountMinor, payment.currency),
      statusLabel: String(payment.status || '').replace(/_/g, ' ')
    }))

    const paymentStats = {
      totalCount: adminPayments.length,
      successfulCount: adminPayments.filter(payment => payment.status === 'successful').length,
      pendingCount: adminPayments.filter(payment => payment.status === 'pending' || payment.status === 'initiated').length,
      failedCount: adminPayments.filter(payment => ['failed', 'cancelled'].includes(payment.status)).length,
      revenueMinor: adminPayments
        .filter(payment => payment.status === 'successful')
        .reduce((sum, payment) => sum + Math.max(0, Number(payment.amountMinor || 0)), 0)
    }

    return res.render('simple-lms', {
      title: 'Seemplify Learning - Workspace',
      user: req.user,
      activePage: 'simple-lms',
      role,
      viewMode,
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
      recommendedCourses,
      catalogPrograms,
      recommendedPrograms,
      managedCourses,
      managedPrograms,
      myEnrollments,
      myPrograms,
      editingCourse,
      editingProgram,
      studioCourses,
      assignableAccounts,
      adminAccounts,
      myPayments,
      adminPayments,
      paymentStats: {
        ...paymentStats,
        revenueDisplay: formatCurrencyAmount(paymentStats.revenueMinor, 'NGN')
      },
      flutterwave: {
        enabled: isFlutterwaveConfigured(),
        publicKey: getFlutterwavePublicKey()
      },
      roleBreakdown,
      stats: {
        publishedCourseCount: totalPublishedCourses,
        publishedProgramCount: totalPublishedPrograms,
        learnerCount: totalAccounts,
        creatorCount: totalCreators,
        completionCount: completedEnrollments,
        myEnrollmentCount: myEnrollments.length,
        myPaidCourseCount: myPayments.length
      },
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Simple LMS load error:', error)
    return redirectWithMessage({
      res,
      path: '/simple-lms',
      error: 'Failed to load workspace.'
    })
  }
})

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
      payment.status = 'successful'
      payment.paidAt = new Date()
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

apiRouter.use(requireApiAuth)

apiRouter.get('/workspace', async (_req, res) => res.redirect('/simple-lms'))

apiRouter.post('/upload/banner', upload.single('banner'), async (req, res) => {
  try {
    const role = resolveRole(req.user)
    if (!canCreateCourses(role)) {
      return res.status(403).json({ error: 'Only admins and creators can upload banners.' })
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

export { pageRouter as simpleLmsRouter, apiRouter as simpleLmsApiRouter }
export default pageRouter

