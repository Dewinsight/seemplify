import mongoose from 'mongoose'

const LearningSyncEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  event: {
    type: String,
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  subjectId: {
    type: String,
    required: true,
    index: true
  },
  envelope: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'delivering', 'delivered', 'failed', 'dead'],
    default: 'pending',
    index: true
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastAttemptAt: Date,
  deliveredAt: Date,
  lastError: {
    type: String,
    default: '',
    maxlength: 2000
  }
}, { timestamps: true })

LearningSyncEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 })
LearningSyncEventSchema.index({ deliveredAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })

const LearningSyncEvent = mongoose.models.AiinLearningSyncEvent
  || mongoose.model('AiinLearningSyncEvent', LearningSyncEventSchema)

export { LearningSyncEvent }
export default LearningSyncEvent
