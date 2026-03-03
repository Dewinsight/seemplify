import mongoose from 'mongoose'

const simpleLmsQuizAttemptSchema = new mongoose.Schema({
  lessonKey: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  score: {
    type: Number,
    min: 0,
    default: 0
  },
  maxScore: {
    type: Number,
    min: 1,
    default: 1
  },
  answers: {
    type: [Number],
    default: []
  },
  attemptedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false })

const SimpleLmsEnrollmentSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true,
    index: true
  },
  program: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsProgram',
    default: null
  },
  enrolledMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  enrolledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  assignmentType: {
    type: String,
    enum: ['organization', 'team', 'member', 'self', 'program'],
    default: 'member'
  },
  assignedTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinTeam',
    default: null
  },
  source: {
    type: String,
    enum: ['manual', 'self_enroll', 'system_course_request', 'program_assignment'],
    default: 'manual'
  },
  status: {
    type: String,
    enum: ['assigned', 'in_progress', 'completed'],
    default: 'assigned',
    index: true
  },
  dueAt: Date,
  assignedAt: {
    type: Date,
    default: Date.now
  },
  startedAt: Date,
  completedAt: Date,
  lastActivityAt: Date,
  progressPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  completedLessonKeys: {
    type: [String],
    default: []
  },
  quizAttempts: {
    type: [simpleLmsQuizAttemptSchema],
    default: []
  },
  latestQuizScore: {
    type: Number,
    min: 0,
    default: 0
  },
  lastViewedAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 3000
  }
}, {
  timestamps: true
})

SimpleLmsEnrollmentSchema.index(
  { organization: 1, course: 1, enrolledMember: 1 },
  { unique: true }
)
SimpleLmsEnrollmentSchema.index({ organization: 1, enrolledMember: 1, status: 1, updatedAt: -1 })
SimpleLmsEnrollmentSchema.index({ organization: 1, assignedTeam: 1, status: 1, updatedAt: -1 })

SimpleLmsEnrollmentSchema.pre('save', function(next) {
  this.completedLessonKeys = Array.from(new Set((this.completedLessonKeys || []).map(value => String(value || '').trim()).filter(Boolean)))

  if (this.status === 'in_progress' && !this.startedAt) {
    this.startedAt = new Date()
  }
  if (this.status === 'completed') {
    if (!this.completedAt) {
      this.completedAt = new Date()
    }
    this.progressPercent = 100
  }
  if (!this.lastActivityAt) {
    this.lastActivityAt = new Date()
  }
  next()
})

const SimpleLmsEnrollment =
  mongoose.models.AiinSimpleLmsEnrollment ||
  mongoose.model('AiinSimpleLmsEnrollment', SimpleLmsEnrollmentSchema)

export { SimpleLmsEnrollment }
export default SimpleLmsEnrollment
