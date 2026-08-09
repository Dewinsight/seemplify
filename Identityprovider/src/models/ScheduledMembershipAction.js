import mongoose from 'mongoose'

const ScheduledMembershipActionSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  operation: { type: String, enum: ['deactivate'], required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  effectiveAt: { type: Date, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'cancelled', 'failed', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 10 },
  leaseUntil: Date,
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lastError: String,
  completedAt: Date,
}, { timestamps: true })

ScheduledMembershipActionSchema.index({ status: 1, effectiveAt: 1, nextAttemptAt: 1, leaseUntil: 1 })

export const ScheduledMembershipAction = mongoose.model('AiinScheduledMembershipAction', ScheduledMembershipActionSchema)
