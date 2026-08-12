import mongoose from 'mongoose'

const simpleLmsResourceSchema = new mongoose.Schema({
  label: {
    type: String,
    trim: true,
    maxlength: 120
  },
  url: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  type: {
    type: String,
    enum: ['link', 'file', 'document'],
    default: 'link'
  }
}, { _id: false })

const simpleLmsQuizChoiceSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 600
  },
  isCorrect: {
    type: Boolean,
    default: false
  }
}, { _id: false })

const simpleLmsQuizQuestionSchema = new mongoose.Schema({
  prompt: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  choices: {
    type: [simpleLmsQuizChoiceSchema],
    default: [],
    validate: {
      validator: (choices) => Array.isArray(choices) && choices.length >= 2,
      message: 'Each quiz question must include at least two choices'
    }
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: 2000
  }
}, { _id: false })

const simpleLmsLessonMediaSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['cloudinary', 'external'],
    default: 'cloudinary'
  },
  url: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  publicId: {
    type: String,
    trim: true,
    maxlength: 400
  },
  resourceType: {
    type: String,
    enum: ['video', 'audio', 'raw', 'link'],
    default: 'video'
  },
  format: {
    type: String,
    trim: true,
    maxlength: 40
  },
  bytes: {
    type: Number,
    min: 0,
    default: 0
  },
  width: {
    type: Number,
    min: 0,
    default: 0
  },
  height: {
    type: Number,
    min: 0,
    default: 0
  },
  durationSeconds: {
    type: Number,
    min: 0,
    default: 0
  },
  sourceLabel: {
    type: String,
    trim: true,
    maxlength: 120
  }
}, { _id: false })

const simpleLmsLessonSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  videoUrl: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  media: {
    type: simpleLmsLessonMediaSchema,
    default: null
  },
  content: {
    type: String,
    trim: true,
    maxlength: 40000
  },
  durationMinutes: {
    type: Number,
    min: 0,
    default: 0
  },
  resources: {
    type: [simpleLmsResourceSchema],
    default: []
  },
  quizQuestions: {
    type: [simpleLmsQuizQuestionSchema],
    default: []
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: false })

const simpleLmsChapterSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  order: {
    type: Number,
    default: 0
  },
  lessons: {
    type: [simpleLmsLessonSchema],
    default: []
  }
}, { _id: false })

const bannerSchema = new mongoose.Schema({
  url: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  publicId: {
    type: String,
    trim: true,
    maxlength: 400
  },
  width: Number,
  height: Number
}, { _id: false })

const pricingSchema = new mongoose.Schema({
  amount: {
    type: Number,
    min: 0,
    default: 0
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'NGN'
  },
  paymentMode: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  }
}, { _id: false })

const partnerSellingSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  creatorSharePercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 70
  },
  partnerSharePercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 20
  }
}, { _id: false })

const sellingOrganizationSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true
  },
  organizationName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  partnerType: {
    type: String,
    enum: ['partner', 'channel_partner'],
    default: 'partner'
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  creatorSharePercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 70
  },
  partnerSharePercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 20
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false })

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)

const courseAudienceSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ['all_members', 'learning_roles', 'selected_members'],
    default: 'all_members'
  },
  learningRoles: {
    type: [String],
    enum: ['learner', 'instructor', 'learning_manager', 'learning_admin'],
    default: []
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  }]
}, { _id: false })

const SimpleLmsCourseSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    index: true,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  createdByName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  createdByEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  slug: {
    type: String,
    trim: true,
    maxlength: 100
  },
  summary: {
    type: String,
    trim: true,
    maxlength: 600
  },
  description: {
    type: String,
    trim: true,
    maxlength: 16000
  },
  category: {
    type: String,
    trim: true,
    maxlength: 120
  },
  level: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'mixed'],
    default: 'mixed'
  },
  tags: {
    type: [String],
    default: []
  },
  banner: {
    type: bannerSchema,
    default: () => ({})
  },
  pricing: {
    type: pricingSchema,
    default: () => ({})
  },
  partnerSelling: {
    type: partnerSellingSchema,
    default: () => ({})
  },
  sellingOrganizations: {
    type: [sellingOrganizationSchema],
    default: []
  },
  visibility: {
    type: String,
    enum: ['organization_private', 'organization_public', 'system_public'],
    default: 'organization_private',
    index: true
  },
  audience: {
    type: courseAudienceSchema,
    default: () => ({ mode: 'all_members', learningRoles: [], members: [] })
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived', 'pending_public_review'],
    default: 'draft',
    index: true
  },
  isSystemCourse: {
    type: Boolean,
    default: false,
    index: true
  },
  requiresPublicReview: {
    type: Boolean,
    default: true
  },
  publishedWithoutReview: {
    type: Boolean,
    default: false
  },
  publishedAt: Date,
  submittedForPublicReviewAt: Date,
  approvedPublicAt: Date,
  approvedPublicBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  reviewDecision: {
    type: String,
    enum: ['none', 'pending', 'approved', 'changes_requested', 'denied'],
    default: 'none',
    index: true
  },
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  reviewNotes: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  archivedAt: Date,
  chapters: {
    type: [simpleLmsChapterSchema],
    default: []
  },
  lessonCount: {
    type: Number,
    min: 0,
    default: 0
  },
  estimatedDurationMinutes: {
    type: Number,
    min: 0,
    default: 0
  },
  enrollmentCount: {
    type: Number,
    min: 0,
    default: 0
  },
  completionCount: {
    type: Number,
    min: 0,
    default: 0
  },
  ratingAverage: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  ratingCount: {
    type: Number,
    min: 0,
    default: 0
  },
  commentCount: {
    type: Number,
    min: 0,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
})

SimpleLmsCourseSchema.index({ organization: 1, status: 1, visibility: 1, updatedAt: -1 })
SimpleLmsCourseSchema.index({ isSystemCourse: 1, status: 1, visibility: 1, updatedAt: -1 })
SimpleLmsCourseSchema.index({ organization: 1, slug: 1 })
SimpleLmsCourseSchema.index({ 'sellingOrganizations.organization': 1, status: 1, visibility: 1, updatedAt: -1 })

SimpleLmsCourseSchema.pre('save', function(next) {
  if (!this.slug) {
    this.slug = slugify(this.title)
  } else {
    this.slug = slugify(this.slug)
  }

  let lessonCount = 0
  let totalMinutes = 0

  for (const chapter of this.chapters || []) {
    chapter.key = String(chapter.key || slugify(chapter.title) || `chapter_${lessonCount + 1}`)
    chapter.lessons = Array.isArray(chapter.lessons) ? chapter.lessons : []
    chapter.lessons.forEach((lesson, lessonIndex) => {
      lesson.key = String(lesson.key || `${chapter.key}_lesson_${lessonIndex + 1}`)
      if (lesson?.media?.url && !lesson.videoUrl) {
        lesson.videoUrl = String(lesson.media.url)
      }
      if ((!Number.isFinite(Number(lesson.durationMinutes)) || Number(lesson.durationMinutes) <= 0) && Number(lesson?.media?.durationSeconds) > 0) {
        lesson.durationMinutes = Math.max(1, Math.ceil(Number(lesson.media.durationSeconds) / 60))
      }
      lessonCount += 1
      totalMinutes += Number.isFinite(Number(lesson.durationMinutes))
        ? Number(lesson.durationMinutes)
        : 0
    })
  }

  this.lessonCount = lessonCount
  this.estimatedDurationMinutes = Math.max(0, Math.round(totalMinutes))

  if (!this.partnerSelling) {
    this.partnerSelling = {}
  }
  this.partnerSelling.enabled = Boolean(this.partnerSelling.enabled)
  this.partnerSelling.creatorSharePercent = Math.min(100, Math.max(0, Number(this.partnerSelling.creatorSharePercent ?? 70) || 70))
  this.partnerSelling.partnerSharePercent = Math.min(100, Math.max(0, Number(this.partnerSelling.partnerSharePercent ?? 20) || 20))
  if ((this.partnerSelling.creatorSharePercent + this.partnerSelling.partnerSharePercent) > 100) {
    return next(new Error('Creator share and partner share cannot exceed 100%.'))
  }

  const assignmentMap = new Map()
  this.sellingOrganizations = (Array.isArray(this.sellingOrganizations) ? this.sellingOrganizations : [])
    .filter((entry) => entry?.organization)
    .map((entry) => ({
      ...entry,
      organizationName: String(entry.organizationName || '').trim().slice(0, 200),
      partnerType: ['partner', 'channel_partner'].includes(String(entry.partnerType || '').trim().toLowerCase())
        ? String(entry.partnerType).trim().toLowerCase()
        : 'partner',
      status: String(entry.status || '').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      creatorSharePercent: Math.min(100, Math.max(0, Number(entry.creatorSharePercent ?? this.partnerSelling.creatorSharePercent) || this.partnerSelling.creatorSharePercent)),
      partnerSharePercent: Math.min(100, Math.max(0, Number(entry.partnerSharePercent ?? this.partnerSelling.partnerSharePercent) || this.partnerSelling.partnerSharePercent)),
      assignedAt: entry.assignedAt || new Date(),
      updatedAt: new Date()
    }))
    .filter((entry) => {
      const totalShare = Number(entry.creatorSharePercent || 0) + Number(entry.partnerSharePercent || 0)
      if (totalShare > 100) {
        return false
      }
      const key = String(entry.organization)
      if (assignmentMap.has(key)) return false
      assignmentMap.set(key, true)
      return true
    })

  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date()
  }
  if (this.status === 'archived' && !this.archivedAt) {
    this.archivedAt = new Date()
  }

  next()
})

const SimpleLmsCourse =
  mongoose.models.AiinSimpleLmsCourse ||
  mongoose.model('AiinSimpleLmsCourse', SimpleLmsCourseSchema)

export { SimpleLmsCourse }
export default SimpleLmsCourse
