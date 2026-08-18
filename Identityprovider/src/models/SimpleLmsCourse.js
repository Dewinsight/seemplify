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
  provider: { type: String, enum: ['cloudinary', 'azure-blob'], default: 'cloudinary' },
  storageKey: { type: String, trim: true, maxlength: 600 },
  storageContainer: { type: String, trim: true, maxlength: 100 },
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

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)

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
  visibility: {
    type: String,
    enum: ['organization_private', 'organization_public', 'system_public'],
    default: 'organization_private',
    index: true
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
  approvedPublicAt: Date,
  approvedPublicBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
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
      lessonCount += 1
      totalMinutes += Number.isFinite(Number(lesson.durationMinutes))
        ? Number(lesson.durationMinutes)
        : 0
    })
  }

  this.lessonCount = lessonCount
  this.estimatedDurationMinutes = Math.max(0, Math.round(totalMinutes))

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
