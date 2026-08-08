const mongoose = require('mongoose');

const AuditRetryActorSchema = new mongoose.Schema({
  type: String,
  id: String,
  name: String,
  email: String
}, { _id: false });

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
    enum: ['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed'],
    required: true,
    index: true
  },
  stage: {
    type: String,
    enum: ['ingesting', 'uploading', 'extracting', 'analyzing', 'finalizing', 'completed', 'failed']
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  attempts: { type: Number, default: 0 },
  processingAttempts: { type: Number, default: 0 },
  retry: {
    manualRequests: { type: Number, default: 0, min: 0 },
    deferredCycles: { type: Number, default: 0, min: 0 },
    nextAttemptAt: Date,
    lastDeferredAt: Date,
    availableUntil: Date,
    requestedStage: String,
    lastRequestedAt: Date,
    lastRequestedBy: AuditRetryActorSchema
  },
  attemptHistory: [{
    attemptId: String,
    number: Number,
    trigger: String,
    requestedStage: String,
    status: String,
    stage: String,
    startedAt: Date,
    finishedAt: Date,
    errorCode: String,
    requestedBy: AuditRetryActorSchema
  }],
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
      enum: ['queued', 'waiting_for_chatgpt', 'processing', 'retrying', 'completed', 'failed'],
      required: true
    },
    stage: {
      type: String,
      enum: ['ingesting', 'uploading', 'extracting', 'analyzing', 'finalizing', 'completed', 'failed']
    },
    state: {
      type: String,
      enum: ['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed'],
      required: true
    },
    progress: { type: Number, min: 0, max: 100 },
    attempts: { type: Number, min: 0 },
    processingAttempts: { type: Number, min: 0 },
    trigger: String,
    requestedStage: String,
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
