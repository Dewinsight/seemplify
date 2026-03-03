import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import mongoose from 'mongoose'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import authRouter from './routes/auth.js'
import setupRouter from './routes/setup.js'
import { simpleLmsRouter, simpleLmsApiRouter } from './routes/simpleLms.js'
import { optionalAuth, requireAuth } from './middleware/auth.js'
import { SimpleLmsCourse } from './models/SimpleLmsCourse.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

app.set('view engine', 'ejs')
app.set('views', join(__dirname, 'views'))

app.use(express.urlencoded({ extended: true }))
app.use(express.json({ limit: '4mb' }))
app.use(cookieParser())
app.use(session({
  name: 'seemplify_learning_session',
  secret: process.env.SESSION_SECRET || 'seemplify-learning-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}))

app.use('/css', express.static(join(__dirname, 'public/css')))
app.use('/js', express.static(join(__dirname, 'public/js')))

app.use(optionalAuth)

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

const normalizeCurrencyCode = (value, fallback = 'NGN') => {
  const normalized = String(value || '').trim().toUpperCase().slice(0, 3)
  if (normalized.length === 3) return normalized
  return String(fallback || 'NGN').trim().toUpperCase().slice(0, 3) || 'NGN'
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
    previewSummary: summary || fallbackSummary || 'No course summary yet.',
    authorName: String(course?.createdByName || '').trim() || 'Seemplify Learning',
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

    res.render('public-home', {
      title: 'Seemplify Learning',
      user: req.user || null,
      activePage: 'home',
      featuredCourses,
      totalCourses,
      totalLessons: Number(stats.totalLessons) || 0,
      totalDurationHours: Math.round(((Number(stats.totalDurationMinutes) || 0) / 60) * 10) / 10,
      topCategories
    })
  } catch (error) {
    console.error('Failed to load public home:', error)
    res.status(500).send('Failed to load Seemplify Learning homepage.')
  }
})

app.get('/courses', async (req, res) => {
  try {
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

    res.render('public-courses', {
      title: 'Explore Courses - Seemplify Learning',
      user: req.user || null,
      activePage: 'courses',
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
    if (canonicalSlug && requestedSlug !== canonicalSlug) {
      return res.redirect(`/courses/${courseRaw._id}/${canonicalSlug}`)
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
      title: `${course.title} - Seemplify Learning`,
      user: req.user || null,
      activePage: 'courses',
      course,
      chapters,
      relatedCourses
    })
  } catch (error) {
    console.error('Failed to load public course detail:', error)
    res.status(500).send('Failed to load course details.')
  }
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'seemplify-learning' })
})

app.get('/plans', requireAuth, (req, res) => {
  res.render('placeholder', {
    title: 'Plans - Seemplify Learning',
    user: req.user,
    heading: 'Plan Management',
    message: 'Plan administration remains controlled from your central admin stack. LMS access here is enabled by default unless restricted by subscription data.'
  })
})

app.get('/subscription', requireAuth, (req, res) => {
  res.render('placeholder', {
    title: 'Subscription - Seemplify Learning',
    user: req.user,
    heading: 'Subscription',
    message: 'Subscription actions for Seemplify Learning are managed from your organization admin.'
  })
})

app.use(authRouter)
app.use('/setup', setupRouter)
app.use('/simple-lms', simpleLmsRouter)
app.use('/api/simple-lms', simpleLmsApiRouter)

app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error)
  res.status(500).send('Internal server error')
})

const port = Number(process.env.PORT || 5012)
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/seemplify'

mongoose.connect(mongoUri)
  .then(() => {
    console.log(`Seemplify Learning connected to MongoDB`) // eslint-disable-line no-console
    app.listen(port, () => {
      console.log(`Seemplify Learning running on port ${port}`) // eslint-disable-line no-console
    })
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error) // eslint-disable-line no-console
    process.exit(1)
  })

export default app
