import express from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { requireAdminAuth, auditLog, adminRateLimit } from '../middleware/adminAuth.js'
import { uploadBufferToCloudinary } from '../services/cloudinaryService.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { slugifyValue } from '../utils/simpleLms.js'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
})

const COURSE_STATUSES = new Set(['draft', 'published', 'archived', 'pending_public_review'])
const EDITABLE_STATUSES = new Set(['draft', 'published', 'archived'])
const COURSE_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'mixed'])

const parseJsonInput = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const sanitizeQuizChoices = (choicesInput = [], correctIndexInput = -1) => {
  const choices = Array.isArray(choicesInput)
    ? choicesInput
      .map((choice) => {
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
        .map((question) => {
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

const sanitizeBanner = (bannerInput = {}, body = {}) => ({
  url: String(bannerInput?.url || body.bannerUrl || '').trim().slice(0, 2000),
  publicId: String(bannerInput?.publicId || body.bannerPublicId || '').trim().slice(0, 400),
  provider: bannerInput?.provider === 'azure-blob' ? 'azure-blob' : 'cloudinary',
  storageKey: String(bannerInput?.storageKey || bannerInput?.publicId || '').trim().slice(0, 600),
  storageContainer: String(bannerInput?.storageContainer || '').trim().slice(0, 100),
  width: Number.isFinite(Number(bannerInput?.width)) ? Number(bannerInput.width) : undefined,
  height: Number.isFinite(Number(bannerInput?.height)) ? Number(bannerInput.height) : undefined
})

const sanitizePricing = (body = {}, fallback = {}) => {
  const amount = Number.isFinite(Number(body.pricingAmount))
    ? Math.max(0, Math.round(Number(body.pricingAmount)))
    : (Number.isFinite(Number(fallback.amount)) ? Number(fallback.amount) : 0)
  const currency = String(body.pricingCurrency || fallback.currency || 'NGN')
    .trim()
    .toUpperCase()
    .slice(0, 3)
  const paymentMode = body.paymentMode === 'paid'
    ? 'paid'
    : (fallback.paymentMode === 'paid' ? 'paid' : 'free')

  return { amount, currency, paymentMode }
}

const buildCourseFilter = ({ status, query }) => {
  const filter = { isSystemCourse: true }
  const normalizedStatus = String(status || 'all').trim()
  if (normalizedStatus !== 'all' && COURSE_STATUSES.has(normalizedStatus)) {
    filter.status = normalizedStatus
  }

  const search = String(query || '').trim()
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [
      { title: regex },
      { summary: regex },
      { description: regex },
      { category: regex },
      { tags: regex }
    ]
  }

  return filter
}

router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 300, windowMs: 15 * 60 * 1000, keyPrefix: 'admin-simple-lms' }))

router.get('/system-courses', async (req, res) => {
  try {
    const filter = buildCourseFilter({
      status: req.query.status,
      query: req.query.q
    })

    const requestedLimit = Number.parseInt(String(req.query.limit || '200'), 10)
    const limit = Number.isFinite(requestedLimit) ? Math.max(10, Math.min(300, requestedLimit)) : 200

    const [courses, totalCount, publishedCount, draftCount, archivedCount] = await Promise.all([
      SimpleLmsCourse.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate('createdBy', 'email profile.name')
        .lean(),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'published' }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'draft' }),
      SimpleLmsCourse.countDocuments({ isSystemCourse: true, status: 'archived' })
    ])

    res.json({
      courses,
      summary: {
        total: totalCount,
        published: publishedCount,
        draft: draftCount,
        archived: archivedCount
      }
    })
  } catch (error) {
    console.error('Admin Simple LMS list system courses error:', error)
    res.status(500).json({ error: 'Failed to load system courses.' })
  }
})

router.post('/upload/banner', upload.single('banner'), auditLog('admin_simple_lms_upload_banner'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Banner image file is required.' })
    }
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed.' })
    }
    const uploadResult = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      folder: 'seemplify/simple-lms/system/banners',
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
    console.error('Admin Simple LMS banner upload error:', error)
    res.status(500).json({ error: 'Failed to upload banner image.' })
  }
})

router.post('/system-courses', auditLog('admin_simple_lms_create_system_course'), async (req, res) => {
  try {
    const title = String(req.body.title || '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Course title is required.' })
    }

    const requestedStatus = String(req.body.status || 'draft').trim()
    const status = EDITABLE_STATUSES.has(requestedStatus) ? requestedStatus : 'draft'
    const chapters = sanitizeChaptersInput(parseJsonInput(req.body.chapters, []))
    const banner = sanitizeBanner(parseJsonInput(req.body.banner, {}), req.body)
    const tags = normalizeStringList(req.body.tags).slice(0, 20)
    const level = COURSE_LEVELS.has(String(req.body.level || '').trim())
      ? String(req.body.level || '').trim()
      : 'mixed'
    const now = new Date()

    const course = await SimpleLmsCourse.create({
      organization: null,
      createdBy: req.user._id,
      createdByName: req.user.profile?.name || req.user.email,
      createdByEmail: req.user.email,
      title,
      slug: slugifyValue(req.body.slug || title, 'course'),
      summary: String(req.body.summary || '').trim().slice(0, 600),
      description: String(req.body.description || '').trim().slice(0, 16000),
      category: String(req.body.category || '').trim().slice(0, 120),
      level,
      tags,
      banner,
      pricing: sanitizePricing(req.body),
      visibility: 'system_public',
      status,
      isSystemCourse: true,
      requiresPublicReview: false,
      publishedWithoutReview: status === 'published',
      publishedAt: status === 'published' ? now : undefined,
      approvedPublicAt: status === 'published' ? now : undefined,
      approvedPublicBy: status === 'published' ? req.user._id : undefined,
      chapters,
      isActive: status !== 'archived',
      archivedAt: status === 'archived' ? now : undefined
    })

    res.status(201).json({
      message: 'System course created successfully.',
      course
    })
  } catch (error) {
    console.error('Admin Simple LMS create system course error:', error)
    res.status(500).json({ error: 'Failed to create system course.' })
  }
})

router.put('/system-courses/:courseId', auditLog('admin_simple_lms_update_system_course'), async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isSystemCourse: true
    })
    if (!course) {
      return res.status(404).json({ error: 'System course not found.' })
    }

    const title = String(req.body.title || course.title || '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Course title is required.' })
    }

    const requestedStatus = String(req.body.status || course.status || 'draft').trim()
    const status = EDITABLE_STATUSES.has(requestedStatus) ? requestedStatus : 'draft'
    const chapters = req.body.chapters !== undefined
      ? sanitizeChaptersInput(parseJsonInput(req.body.chapters, []))
      : course.chapters
    const bannerInput = req.body.banner !== undefined
      ? parseJsonInput(req.body.banner, {})
      : course.banner
    const tags = req.body.tags !== undefined
      ? normalizeStringList(req.body.tags).slice(0, 20)
      : normalizeStringList(course.tags).slice(0, 20)
    const level = COURSE_LEVELS.has(String(req.body.level || '').trim())
      ? String(req.body.level || '').trim()
      : (course.level || 'mixed')
    const now = new Date()

    course.title = title
    course.slug = slugifyValue(req.body.slug || title, 'course')
    course.summary = String(req.body.summary ?? course.summary ?? '').trim().slice(0, 600)
    course.description = String(req.body.description ?? course.description ?? '').trim().slice(0, 16000)
    course.category = String(req.body.category ?? course.category ?? '').trim().slice(0, 120)
    course.level = level
    course.tags = tags
    course.banner = sanitizeBanner(bannerInput, req.body)
    course.pricing = sanitizePricing(req.body, course.pricing || {})
    course.chapters = chapters
    course.visibility = 'system_public'
    course.organization = null
    course.isSystemCourse = true
    course.requiresPublicReview = false
    course.publishedWithoutReview = status === 'published'
    course.status = status

    if (status === 'published') {
      course.isActive = true
      course.archivedAt = undefined
      course.approvedPublicAt = course.approvedPublicAt || now
      course.approvedPublicBy = course.approvedPublicBy || req.user._id
      course.publishedAt = course.publishedAt || now
    } else if (status === 'archived') {
      course.isActive = false
      course.archivedAt = now
    } else {
      course.isActive = true
      course.archivedAt = undefined
    }

    await course.save()

    res.json({
      message: 'System course updated successfully.',
      course
    })
  } catch (error) {
    console.error('Admin Simple LMS update system course error:', error)
    res.status(500).json({ error: 'Failed to update system course.' })
  }
})

router.post('/system-courses/:courseId/archive', auditLog('admin_simple_lms_archive_system_course'), async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: 'Invalid course id.' })
    }

    const course = await SimpleLmsCourse.findOne({
      _id: courseId,
      isSystemCourse: true
    })
    if (!course) {
      return res.status(404).json({ error: 'System course not found.' })
    }

    const restore = req.body?.restore === true || req.body?.restore === 'true'
    if (restore) {
      const restoreToPublished = req.body?.status === 'published'
      course.status = restoreToPublished ? 'published' : 'draft'
      course.isActive = true
      course.archivedAt = undefined
      if (restoreToPublished) {
        course.publishedAt = course.publishedAt || new Date()
      }
    } else {
      course.status = 'archived'
      course.isActive = false
      course.archivedAt = new Date()
    }

    await course.save()

    res.json({
      message: restore ? 'System course restored.' : 'System course archived.',
      course
    })
  } catch (error) {
    console.error('Admin Simple LMS archive system course error:', error)
    res.status(500).json({ error: 'Failed to update system course archive state.' })
  }
})

export default router
