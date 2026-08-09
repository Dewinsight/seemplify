const mongoose = require('mongoose');

const CVProcessingBatchSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: { type: String, index: true },
  requestFingerprint: { type: String, select: false },
  intakeState: {
    type: String,
    enum: ['accepting', 'accepted'],
    default: 'accepted',
    index: true
  },
  acceptedAt: Date,
  intakeLeaseId: { type: String, select: false },
  intakeLeaseAt: Date,
  jobs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' }],
  rejected: [{ index: Number, fileName: String, error: String }],
  totalFiles: { type: Number, required: true },
  // Active/accepting batches have no TTL. The service sets this only after
  // every child has reached a terminal state.
  expiresAt: Date
}, { timestamps: true });

CVProcessingBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CVProcessingBatchSchema.index(
  { organization: 1, actor: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'uniq_cv_batch_submission'
  }
);

module.exports = mongoose.model('CVProcessingBatch', CVProcessingBatchSchema);
