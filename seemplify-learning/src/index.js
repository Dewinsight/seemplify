import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import mongoose from 'mongoose'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import authRouter from './routes/auth.js'
import setupRouter from './routes/setup.js'
import { simpleLmsRouter, simpleLmsAdminRouter, simpleLmsApiRouter, simpleLmsReportsApiRouter } from './routes/simpleLms.js'
import partnerRouter from './routes/partner.js'
import agentRouter from './routes/agent.js'
import superUserApiRouter from './routes/superUser.js'
import partnerApiRouter from './routes/partnerApi.js'
import { optionalAuth, requireAuth } from './middleware/auth.js'
import { csrfGuard } from './middleware/csrf.js'
import { SimpleLmsCourse } from './models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from './models/SimpleLmsEnrollment.js'
import { SimpleLmsPayment } from './models/SimpleLmsPayment.js'
import { getSimpleLmsCurrencyCatalog, normalizeSimpleLmsCurrencyCode, parseMajorAmountToMinor } from './services/simpleLmsCurrencyService.js'
import { resolveBranding, resolveTeachBrand } from './utils/branding.js'
import { getSessionCartCourseIds } from './utils/simpleLmsCart.js'
import { normalizeAgentReferralCode } from './utils/agentReferral.js'
import { resolveLearningRole as resolveLearningRoleFromAccount } from './utils/learningRoles.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

app.set('view engine', 'ejs')
app.set('views', join(__dirname, 'views'))

app.use(express.urlencoded({ extended: true }))
app.use(express.json({
  limit: '4mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer?.toString('utf8') || ''
  }
}))
app.use(cookieParser())
app.use(session({
  name: 'seemplify_learning_session',
  secret: process.env.SESSION_SECRET || 'seemplify-learning-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}))
app.use(csrfGuard())

app.use('/css', express.static(join(__dirname, 'public/css')))
app.use('/js', express.static(join(__dirname, 'public/js')))
app.use('/images', express.static(join(__dirname, 'public/images')))

app.use(optionalAuth)
app.use((req, res, next) => {
  const hostname = String(req.hostname || req.get('host') || '').trim().toLowerCase()
  const branding = resolveBranding(hostname)
  res.locals.branding = branding
  res.locals.brandKey = branding.brandKey
  res.locals.brandName = branding.brandName
  res.locals.brandLearningName = branding.learningName
  res.locals.teachBrand = branding.brandName
  res.locals.teachLabel = branding.teachLabel
  const cartCourseIds = getSessionCartCourseIds(req)
  res.locals.simpleLmsCartCount = cartCourseIds.length
  next()
})

const PUBLIC_COURSE_FILTER = {
  status: 'published',
  visibility: { $in: ['organization_public', 'system_public'] },
  isActive: true
}

const VALID_LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed']

const COURSE_LEVEL_LABELS = Object.freeze({
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Mixed'
})

const resolveLearningRole = (account) => {
  return resolveLearningRoleFromAccount(account)
}

const slugifyValue = (value, fallback = 'item') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

const appendQuery = (path, entries = {}) => {
  const params = new URLSearchParams()
  Object.entries(entries).forEach(([key, rawValue]) => {
    const value = String(rawValue || '').trim()
    if (value) params.set(key, value)
  })
  const query = params.toString()
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

const buildStarterChapters = ({ courseTitle, topic }) => {
  const normalizedTopic = String(topic || courseTitle || 'your subject').trim()
  const chapterOneKey = `welcome-${slugifyValue(normalizedTopic, 'topic')}`
  const chapterTwoKey = `core-${slugifyValue(normalizedTopic, 'topic')}`

  return [
    {
      key: chapterOneKey,
      title: 'Getting Started',
      description: `Introduce learners to ${normalizedTopic} and define outcomes.`,
      order: 1,
      lessons: [
        {
          key: `${chapterOneKey}-lesson-1`,
          title: 'Welcome and Course Outcomes',
          description: 'Set expectations and explain who this course is for.',
          content: `Welcome to ${courseTitle}. In this first lesson, introduce your audience, what they will learn, and how they can apply it.`,
          durationMinutes: 8,
          resources: [],
          quizQuestions: [],
          order: 1
        },
        {
          key: `${chapterOneKey}-lesson-2`,
          title: 'How to Navigate This Course',
          description: 'Explain structure, milestones, and support channels.',
          content: 'Share the course roadmap, suggested pace, and any prerequisites.',
          durationMinutes: 6,
          resources: [],
          quizQuestions: [],
          order: 2
        }
      ]
    },
    {
      key: chapterTwoKey,
      title: 'Core Concepts',
      description: `Cover foundational concepts in ${normalizedTopic}.`,
      order: 2,
      lessons: [
        {
          key: `${chapterTwoKey}-lesson-1`,
          title: 'Core Principle 1',
          description: 'Teach the first key concept with examples.',
          content: `Explain one core concept in ${normalizedTopic}, then provide a practical example learners can replicate.`,
          durationMinutes: 12,
          resources: [],
          quizQuestions: [],
          order: 1
        }
      ]
    }
  ]
}

const normalizeCurrencyCode = (value, fallback = 'NGN') => {
  return normalizeSimpleLmsCurrencyCode(value, fallback)
}

const formatCurrencyAmount = (amountMinor, currencyCode) => {
  const amount = Number.isFinite(Number(amountMinor))
    ? Math.max(0, Math.round(Number(amountMinor)))
    : 0
  const major = amount / 100
  const currency = normalizeCurrencyCode(currencyCode, 'NGN')

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(major)
  } catch {
    return `${currency} ${major.toFixed(2)}`
  }
}

const decoratePublicCourse = (course) => {
  const paymentMode = course?.pricing?.paymentMode === 'paid' ? 'paid' : 'free'
  const amount = Number.isFinite(Number(course?.pricing?.amount))
    ? Math.max(0, Math.round(Number(course.pricing.amount)))
    : 0
  const currency = normalizeCurrencyCode(course?.pricing?.currency, 'NGN')
  const displayPrice = paymentMode === 'paid' && amount > 0
    ? formatCurrencyAmount(amount, currency)
    : 'Free'

  const summary = String(course?.summary || '').trim()
  const fallbackSummary = String(course?.description || '').trim()

  return {
    ...course,
    levelLabel: COURSE_LEVEL_LABELS[course?.level] || 'Mixed',
    displayPrice,
    requiresPayment: paymentMode === 'paid' && amount > 0,
    previewSummary: summary || fallbackSummary || 'No course summary yet.',
    authorName: String(course?.createdByName || '').trim() || 'Learning Team',
    lessonCount: Number.isFinite(Number(course?.lessonCount))
      ? Math.max(0, Number(course.lessonCount))
      : 0,
    estimatedDurationMinutes: Number.isFinite(Number(course?.estimatedDurationMinutes))
      ? Math.max(0, Number(course.estimatedDurationMinutes))
      : 0
  }
}

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

app.get('/', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const [featuredRaw, totalCourses, statsAggregate, categoryBreakdown] = await Promise.all([
      SimpleLmsCourse.find(PUBLIC_COURSE_FILTER)
        .select('title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdByName createdByEmail updatedAt enrollmentCount')
        .sort({ enrollmentCount: -1, updatedAt: -1 })
        .limit(8)
        .lean(),
      SimpleLmsCourse.countDocuments(PUBLIC_COURSE_FILTER),
      SimpleLmsCourse.aggregate([
        { $match: PUBLIC_COURSE_FILTER },
        {
          $group: {
            _id: null,
            totalLessons: { $sum: '$lessonCount' },
            totalDurationMinutes: { $sum: '$estimatedDurationMinutes' }
          }
        }
      ]),
      SimpleLmsCourse.aggregate([
        { $match: PUBLIC_COURSE_FILTER },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 8 }
      ])
    ])

    const featuredCourses = featuredRaw.map(decoratePublicCourse)
    const stats = statsAggregate[0] || { totalLessons: 0, totalDurationMinutes: 0 }
    const topCategories = categoryBreakdown
      .filter((entry) => String(entry?._id || '').trim())
      .map((entry) => ({
        name: String(entry._id).trim(),
        count: Number(entry.count) || 0
      }))

    const teachBrand = resolveTeachBrand(req.hostname || req.get('host'))
    const teachCtaHref = req.user
      ? '/teach/get-started'
      : appendQuery('/register', {
          intent: 'teach',
          source: 'public_home',
          return_to: '/teach/get-started'
        })
    const learnRegisterHref = appendQuery('/register', {
      intent: 'learn',
      source: 'public_home',
      return_to: '/simple-lms'
    })

    res.render('public-home', {
      title: branding.learningName,
      user: req.user || null,
      activePage: 'home',
      teachBrand,
      teachCtaHref,
      learnRegisterHref,
      featuredCourses,
      totalCourses,
      totalLessons: Number(stats.totalLessons) || 0,
      totalDurationHours: Math.round(((Number(stats.totalDurationMinutes) || 0) / 60) * 10) / 10,
      topCategories
    })
  } catch (error) {
    console.error('Failed to load public home:', error)
    res.status(500).send('Failed to load learning homepage.')
  }
})

app.get('/courses', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const query = String(req.query.q || '').trim()
    const selectedCategory = String(req.query.category || '').trim()
    const selectedLevel = String(req.query.level || '').trim().toLowerCase()

    const filter = { ...PUBLIC_COURSE_FILTER }
    if (query) {
      const safeQuery = escapeRegExp(query)
      filter.$or = [
        { title: { $regex: safeQuery, $options: 'i' } },
        { summary: { $regex: safeQuery, $options: 'i' } },
        { description: { $regex: safeQuery, $options: 'i' } },
        { category: { $regex: safeQuery, $options: 'i' } }
      ]
    }
    if (selectedCategory) {
      filter.category = selectedCategory
    }
    if (VALID_LEVELS.includes(selectedLevel)) {
      filter.level = selectedLevel
    }

    const [coursesRaw, categoriesRaw] = await Promise.all([
      SimpleLmsCourse.find(filter)
        .select('title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdByName createdByEmail updatedAt enrollmentCount')
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean(),
      SimpleLmsCourse.distinct('category', {
        ...PUBLIC_COURSE_FILTER,
        category: { $exists: true, $nin: [null, ''] }
      })
    ])

    const courses = coursesRaw.map(decoratePublicCourse)
    const categories = (categoriesRaw || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    const teachBrand = resolveTeachBrand(req.hostname || req.get('host'))
    const teachCtaHref = req.user
      ? '/teach/get-started'
      : appendQuery('/register', {
          intent: 'teach',
          source: 'public_catalog',
          return_to: '/teach/get-started'
        })

    res.render('public-courses', {
      title: `Explore Courses - ${branding.learningName}`,
      user: req.user || null,
      activePage: 'courses',
      teachBrand,
      teachCtaHref,
      courses,
      filters: {
        query,
        category: selectedCategory,
        level: VALID_LEVELS.includes(selectedLevel) ? selectedLevel : ''
      },
      categories,
      levels: VALID_LEVELS.map((level) => ({
        value: level,
        label: COURSE_LEVEL_LABELS[level] || level
      }))
    })
  } catch (error) {
    console.error('Failed to load public course catalog:', error)
    res.status(500).send('Failed to load course catalog.')
  }
})

app.get('/courses/:courseId/:slug?', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(404).send('Course not found.')
    }

    const courseRaw = await SimpleLmsCourse.findOne({
      _id: courseId,
      ...PUBLIC_COURSE_FILTER
    })
      .select('title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdByName createdByEmail chapters updatedAt')
      .lean()

    if (!courseRaw) {
      return res.status(404).send('Course not found.')
    }

    const canonicalSlug = String(courseRaw.slug || '').trim()
    const requestedSlug = String(req.params.slug || '').trim()
    const incomingReferralCode = normalizeAgentReferralCode(req.query.ref || '')
    if (incomingReferralCode && req.session) {
      req.session.simpleLmsAgentReferrals = req.session.simpleLmsAgentReferrals || {}
      req.session.simpleLmsAgentReferrals[String(courseRaw._id)] = incomingReferralCode
    }
    const persistedReferralCode = normalizeAgentReferralCode(
      req.session?.simpleLmsAgentReferrals?.[String(courseRaw._id)] || ''
    )
    const detailPath = `/courses/${courseRaw._id}${canonicalSlug ? `/${canonicalSlug}` : ''}${persistedReferralCode ? `?ref=${encodeURIComponent(persistedReferralCode)}` : ''}`

    if (canonicalSlug && requestedSlug !== canonicalSlug) {
      return res.redirect(detailPath)
    }

    const relatedRaw = await SimpleLmsCourse.find({
      ...PUBLIC_COURSE_FILTER,
      _id: { $ne: courseRaw._id },
      ...(courseRaw.category
        ? { category: courseRaw.category }
        : {})
    })
      .select('title slug summary description category level banner lessonCount estimatedDurationMinutes pricing createdByName createdByEmail updatedAt')
      .sort({ updatedAt: -1 })
      .limit(4)
      .lean()

    const course = decoratePublicCourse(courseRaw)
    const cartCourseIds = getSessionCartCourseIds(req)
    const courseIdString = String(courseRaw._id)
    const inCart = cartCourseIds.includes(courseIdString)

    let isEnrolled = false
    let hasSuccessfulPayment = false
    if (req.user?._id) {
      const enrollmentPromise = SimpleLmsEnrollment.exists({
        course: courseRaw._id,
        enrolledMember: req.user._id
      })
      const paymentPromise = course.requiresPayment
        ? SimpleLmsPayment.exists({
            account: req.user._id,
            course: courseRaw._id,
            status: 'successful'
          })
        : Promise.resolve(null)
      const [enrollmentExists, paymentExists] = await Promise.all([enrollmentPromise, paymentPromise])
      isEnrolled = Boolean(enrollmentExists)
      hasSuccessfulPayment = Boolean(paymentExists)
    }

    const canStartNow = !course.requiresPayment || hasSuccessfulPayment || isEnrolled
    const relatedCourses = relatedRaw.map(decoratePublicCourse)

    const chapters = Array.isArray(courseRaw.chapters)
      ? courseRaw.chapters.map((chapter, chapterIndex) => ({
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

    res.render('public-course-detail', {
      title: `${course.title} - ${branding.learningName}`,
      user: req.user || null,
      activePage: 'courses',
      detailPath,
      referralCode: persistedReferralCode,
      course,
      chapters,
      relatedCourses,
      inCart,
      cartCount: cartCourseIds.length,
      canStartNow,
      isEnrolled,
      hasSuccessfulPayment,
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Failed to load public course detail:', error)
    res.status(500).send('Failed to load course details.')
  }
})

app.get('/teach', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const teachBrand = resolveTeachBrand(req.hostname || req.get('host'))
    const teachLabel = `Teach on ${teachBrand}`

    if (!req.user && req.session) {
      req.session.pendingRegistrationIntent = {
        intent: 'teach',
        source: 'teach_landing',
        returnTo: '/teach/get-started'
      }
    }

    const currentRole = resolveLearningRole(req.user || null)
    const canOpenWorkspace = Boolean(req.user) && ['learner', 'creator', 'admin', 'super_admin'].includes(currentRole)

    res.render('teach-landing', {
      title: `${teachLabel} - ${branding.learningName}`,
      user: req.user || null,
      activePage: 'teach',
      teachBrand,
      teachLabel,
      canOpenWorkspace,
      error: String(req.query.error || ''),
      success: String(req.query.success || ''),
      info: String(req.query.info || ''),
      registerHref: appendQuery('/register', {
        intent: 'teach',
        source: 'teach_landing',
        return_to: '/teach/get-started'
      }),
      loginHref: appendQuery('/login', {
        intent: 'teach',
        source: 'teach_landing',
        return_to: '/teach/get-started'
      }),
      getStartedHref: '/teach/get-started',
      browseHref: '/courses'
    })
  } catch (error) {
    console.error('Failed to load teach landing page:', error)
    res.status(500).send('Failed to load teach page.')
  }
})

app.get('/teach/get-started', requireAuth, async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const teachBrand = resolveTeachBrand(req.hostname || req.get('host'))
    const role = resolveLearningRole(req.user)

    req.user.learningProfile = req.user.learningProfile || {}
    req.user.learningProfile.registrationIntent = req.user.learningProfile.registrationIntent || 'teach'
    if (!req.user.learningProfile.intentSource || req.user.learningProfile.intentSource === 'direct') {
      req.user.learningProfile.intentSource = 'teach_get_started'
    }
    req.user.learningProfile.instructorActivatedAt = req.user.learningProfile.instructorActivatedAt || new Date()
    await req.user.save()

    const [courseCount, latestCourse, currencyCatalog] = await Promise.all([
      SimpleLmsCourse.countDocuments({ createdBy: req.user._id, isActive: true }),
      SimpleLmsCourse.findOne({ createdBy: req.user._id })
        .select('title status updatedAt _id')
        .sort({ updatedAt: -1 })
        .lean(),
      getSimpleLmsCurrencyCatalog()
    ])

    res.render('teach-onboarding', {
      title: `Teach Setup - ${branding.learningName}`,
      user: req.user,
      activePage: 'teach',
      teachBrand,
      role,
      roleWasUpgraded: false,
      courseCount,
      latestCourse,
      supportedCurrencies: currencyCatalog.currencies,
      defaultCourseCurrency: currencyCatalog.defaultCurrencyCode || 'NGN',
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Failed to load teach onboarding:', error)
    res.redirect(appendQuery('/teach', { error: 'Failed to load onboarding wizard.' }))
  }
})

app.post('/teach/get-started/create-first-course', requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 200)
    const summary = String(req.body.summary || '').trim().slice(0, 600)
    const description = String(req.body.description || '').trim().slice(0, 16000)
    const category = String(req.body.category || '').trim().slice(0, 120)
    const levelInput = String(req.body.level || '').trim().toLowerCase()
    const level = VALID_LEVELS.includes(levelInput) ? levelInput : 'mixed'
    const paymentMode = String(req.body.paymentMode || '').trim().toLowerCase() === 'paid'
      ? 'paid'
      : 'free'
    const currencyCatalog = await getSimpleLmsCurrencyCatalog()
    const amount = paymentMode === 'paid' ? parseMajorAmountToMinor(req.body.amount) : 0
    const currency = normalizeSimpleLmsCurrencyCode(
      req.body.currency,
      currencyCatalog.defaultCurrencyCode || 'NGN',
      currencyCatalog.codes
    )

    if (!title) {
      return res.redirect(appendQuery('/teach/get-started', {
        error: 'Course title is required.'
      }))
    }
    if (paymentMode === 'paid' && amount <= 0) {
      return res.redirect(appendQuery('/teach/get-started', {
        error: 'Paid courses need a valid price greater than 0.'
      }))
    }

    const starterCourse = await SimpleLmsCourse.create({
      organization: null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email || 'Course Author',
      createdByEmail: req.user.email || '',
      title,
      summary,
      description,
      category,
      level,
      tags: [],
      status: 'draft',
      visibility: 'organization_private',
      pricing: {
        paymentMode,
        amount,
        currency
      },
      chapters: buildStarterChapters({
        courseTitle: title,
        topic: category || title
      }),
      isActive: true
    })

    req.user.learningProfile = req.user.learningProfile || {}
    req.user.learningProfile.registrationIntent = 'teach'
    req.user.learningProfile.intentSource = req.user.learningProfile.intentSource || 'teach_get_started'
    req.user.learningProfile.instructorActivatedAt = req.user.learningProfile.instructorActivatedAt || new Date()
    req.user.learningProfile.instructorOnboardingCompleted = true
    req.user.learningProfile.firstCourseCreatedAt = req.user.learningProfile.firstCourseCreatedAt || new Date()
    req.user.learningProfile.firstCourse = req.user.learningProfile.firstCourse || starterCourse._id
    await req.user.save()

    return res.redirect(appendQuery(`/simple-lms?view=course-studio&editCourse=${starterCourse._id}`, {
      success: 'Starter course created. Continue in Course Studio to upload banner, videos, and quizzes.',
      info: 'Use Program Studio next to bundle this course into a pathway.'
    }))
  } catch (error) {
    console.error('Failed to create starter course:', error)
    return res.redirect(appendQuery('/teach/get-started', {
      error: 'Failed to create starter course.'
    }))
  }
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'seemplify-learning' })
})

app.get('/plans', requireAuth, (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  res.render('placeholder', {
    title: `Plans - ${branding.learningName}`,
    user: req.user,
    heading: 'Plan Management',
    message: 'Plan administration remains controlled from your central admin stack. LMS access here is enabled by default unless restricted by subscription data.'
  })
})

app.get('/subscription', requireAuth, (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  res.render('placeholder', {
    title: `Subscription - ${branding.learningName}`,
    user: req.user,
    heading: 'Subscription',
    message: `Subscription actions for ${branding.learningName} are managed from your organization admin.`
  })
})

app.use(authRouter)
app.use('/setup', setupRouter)
app.use('/simple-lms', simpleLmsRouter)
app.use('/admin', simpleLmsAdminRouter)
app.use('/api/simple-lms', simpleLmsApiRouter)
app.use('/api/reports', simpleLmsReportsApiRouter)
app.use('/partner-dashboard', requireAuth, partnerRouter)
app.use('/agent-dashboard', requireAuth, agentRouter)
app.use('/api/super-users', requireAuth, superUserApiRouter)
app.use('/api/partners', requireAuth, partnerApiRouter)

app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error)
  res.status(500).send('Internal server error')
})

const port = Number(process.env.PORT || 5012)
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/seemplify'

mongoose.connect(mongoUri)
  .then(async () => {
    console.log(`Seemplify Learning connected to MongoDB`) // eslint-disable-line no-console
    try {
      await getSimpleLmsCurrencyCatalog({ forceRefresh: true })
      console.log('Simple LMS currencies ready') // eslint-disable-line no-console
    } catch (currencyError) {
      console.error('Simple LMS currency seed failed:', currencyError) // eslint-disable-line no-console
    }
    app.listen(port, () => {
      console.log(`Seemplify Learning running on port ${port}`) // eslint-disable-line no-console
    })
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error) // eslint-disable-line no-console
    process.exit(1)
  })

export default app
