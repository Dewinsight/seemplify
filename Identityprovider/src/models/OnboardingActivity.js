import mongoose from 'mongoose'

const OnboardingActivitySchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOnboardingAssignment',
    required: true,
    index: true
  },
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  type: {
    type: String,
    enum: ['assignment_created', 'assignment_completed', 'assignment_cancelled'],
    required: true,
    index: true
  },
  metadata: {
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinOnboardingTemplate'
    },
    previousStatus: {
      type: String,
      trim: true
    },
    nextStatus: {
      type: String,
      trim: true
    },
    triggerItemId: {
      type: mongoose.Schema.Types.ObjectId
    },
    triggerItemType: {
      type: String,
      trim: true
    },
    dueAt: {
      type: Date
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

OnboardingActivitySchema.index({ organization: 1, createdAt: -1 })
OnboardingActivitySchema.index({ organization: 1, type: 1, createdAt: -1 })
OnboardingActivitySchema.index({ assignment: 1, type: 1 }, { unique: true })

// Keep activity feed lean and self-cleaning (180 days).
OnboardingActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 })

export const OnboardingActivity = mongoose.model('AiinOnboardingActivity', OnboardingActivitySchema)
