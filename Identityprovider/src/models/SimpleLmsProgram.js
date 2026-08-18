import mongoose from 'mongoose'

const simpleLmsProgramStepSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true
  },
  titleSnapshot: {
    type: String,
    trim: true,
    maxlength: 200
  },
  order: {
    type: Number,
    default: 0
  },
  required: {
    type: Boolean,
    default: true
  }
}, { _id: false })

const simpleLmsProgramBannerSchema = new mongoose.Schema({
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
  storageContainer: { type: String, trim: true, maxlength: 100 }
}, { _id: false })

const SimpleLmsProgramSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
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
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 8000
  },
  objective: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  banner: {
    type: simpleLmsProgramBannerSchema,
    default: () => ({})
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    index: true
  },
  visibility: {
    type: String,
    enum: ['organization_private', 'organization_public'],
    default: 'organization_private',
    index: true
  },
  tags: {
    type: [String],
    default: []
  },
  steps: {
    type: [simpleLmsProgramStepSchema],
    default: [],
    validate: {
      validator: (steps) => Array.isArray(steps) && steps.length > 0,
      message: 'Program must include at least one course step'
    }
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
  }
}, {
  timestamps: true
})

SimpleLmsProgramSchema.index({ organization: 1, status: 1, visibility: 1, updatedAt: -1 })
SimpleLmsProgramSchema.index({ createdBy: 1, updatedAt: -1 })

SimpleLmsProgramSchema.pre('save', function(next) {
  const orderedSteps = Array.isArray(this.steps) ? [...this.steps] : []
  orderedSteps.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  this.steps = orderedSteps.map((step, index) => ({
    ...step.toObject ? step.toObject() : step,
    order: index + 1
  }))
  next()
})

const SimpleLmsProgram =
  mongoose.models.AiinSimpleLmsProgram ||
  mongoose.model('AiinSimpleLmsProgram', SimpleLmsProgramSchema)

export { SimpleLmsProgram }
export default SimpleLmsProgram
