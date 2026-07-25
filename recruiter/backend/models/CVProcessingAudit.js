const mongoose = require('mongoose');

const CVProcessingAuditSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  producer: {
    type: String,
    enum: ['recruiter', 'ai-interview'],
    default: 'recruiter',
    required: true,
    index: true
  },
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
  stage: {
    type: String,
    enum: ['ingesting', 'uploading', 'extracting', 'analyzing', 'finalizing', 'completed', 'failed']
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  attempts: { type: Number, default: 0 },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  organizationKey: { type: String, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorKey: String,
  jobAppliedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  jobKey: String,
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  originalName: String,
  fileType: String,
  fileSize: Number,
  jobCreatedAt: { type: Date, required: true, index: true },
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  lastUpdatedAt: { type: Date, required: true, index: true },
  producerSequence: { type: Number, min: 0 },
  waitMs: Number,
  processingMs: Number,
  errorCode: String,
  transitions: [{
    eventKey: { type: String, required: true },
    phase: {
      type: String,
      enum: ['queued', 'waiting_for_local_runtime', 'processing', 'retrying', 'completed', 'failed'],
      required: true
    },
    stage: {
      type: String,
      enum: ['ingesting', 'uploading', 'extracting', 'analyzing', 'finalizing', 'completed', 'failed']
    },
    state: {
      type: String,
      enum: ['queued', 'waiting_for_local_runtime', 'processing', 'completed', 'failed'],
      required: true
    },
    progress: { type: Number, min: 0, max: 100 },
    attempts: { type: Number, min: 0 },
    sequence: { type: Number, min: 0 },
    at: { type: Date, required: true },
    errorCode: String
  }]
}, { timestamps: true, minimize: false });

CVProcessingAuditSchema.index({ state: 1, jobCreatedAt: -1 });
CVProcessingAuditSchema.index({ source: 1, jobCreatedAt: -1 });
CVProcessingAuditSchema.index({ organization: 1, jobCreatedAt: -1 });
CVProcessingAuditSchema.index(
  { producer: 1, state: 1, lastUpdatedAt: -1, publicId: -1 },
  { name: 'cv_audit_producer_active_recent' }
);
CVProcessingAuditSchema.index(
  { producer: 1, lastUpdatedAt: -1, publicId: -1 },
  { name: 'cv_audit_producer_recent' }
);
CVProcessingAuditSchema.index(
  { producer: 1, state: 1, completedAt: -1 },
  { name: 'cv_audit_producer_completed_rates' }
);
CVProcessingAuditSchema.index(
  { producer: 1, state: 1, failedAt: -1 },
  { name: 'cv_audit_producer_failed_rates' }
);
CVProcessingAuditSchema.index(
  { producer: 1, state: 1, attempts: 1 },
  { name: 'cv_audit_producer_retries' }
);
CVProcessingAuditSchema.index(
  { producer: 1, state: 1, jobCreatedAt: 1 },
  { name: 'cv_audit_producer_oldest' }
);

module.exports = mongoose.model('CVProcessingAudit', CVProcessingAuditSchema);
