import mongoose from 'mongoose'

const MembershipOperationSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  operation: { type: String, enum: ['provision', 'deactivate', 'reactivate'], required: true, index: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  subjectId: { type: String, index: true },
  requestedBy: String,
  requestHash: { type: String, required: true },
  status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing', index: true },
  response: mongoose.Schema.Types.Mixed,
  error: String,
  attempts: { type: Number, default: 1 },
  completedAt: Date,
}, { timestamps: true })

MembershipOperationSchema.index({ organizationId: 1, operation: 1, createdAt: -1 })

export const MembershipOperation = mongoose.model('AiinMembershipOperation', MembershipOperationSchema)
