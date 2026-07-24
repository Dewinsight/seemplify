const mongoose = require('mongoose');

const CVProcessingJobSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  statusTokenHash: { type: String, required: true, select: false },
  idempotencyKey: { type: String, index: true },
  state: {
    type: String,
    enum: ['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  jobAppliedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  source: { type: String, enum: ['private', 'public', 'bulk', 'ai-interview'], required: true },
  originalName: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  resumeText: { type: String, required: true, select: false },
  cloudinary: {
    resumeUrl: String,
    publicId: String,
    resourceType: String
  },
  formData: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 },
  lastError: {
    code: String,
    message: String,
    at: Date
  },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
}, { timestamps: true, minimize: false });

CVProcessingJobSchema.index(
  { organization: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
CVProcessingJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CVProcessingJob', CVProcessingJobSchema);
