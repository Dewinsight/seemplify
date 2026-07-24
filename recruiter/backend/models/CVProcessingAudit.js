const mongoose = require('mongoose');

const CVProcessingAuditSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  source: {
    type: String,
    enum: ['private', 'public', 'bulk', 'ai-interview'],
    required: true,
    index: true
  },
  state: {
    type: String,
    enum: ['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'],
    required: true,
    index: true
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  attempts: { type: Number, default: 0 },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  jobAppliedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  originalName: String,
  fileType: String,
  fileSize: Number,
  jobCreatedAt: { type: Date, required: true, index: true },
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  lastUpdatedAt: { type: Date, required: true, index: true },
  waitMs: Number,
  processingMs: Number,
  errorCode: String
}, { timestamps: true, minimize: false });

CVProcessingAuditSchema.index({ state: 1, jobCreatedAt: -1 });
CVProcessingAuditSchema.index({ source: 1, jobCreatedAt: -1 });
CVProcessingAuditSchema.index({ organization: 1, jobCreatedAt: -1 });

module.exports = mongoose.model('CVProcessingAudit', CVProcessingAuditSchema);
