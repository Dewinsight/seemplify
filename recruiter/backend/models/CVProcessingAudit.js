const mongoose = require('mongoose');

const CV_PROCESSING_STAGES = [
  'received', 'ingesting', 'uploading', 'stored', 'extracting', 'analyzing',
  'profile_creation', 'finalizing', 'retry_scheduled', 'completed', 'failed',
  'cancelled'
];
const configuredRetentionDays = Number(process.env.CV_PROCESSING_AUDIT_RETENTION_DAYS || 180);
const auditRetentionMs = (
  Number.isFinite(configuredRetentionDays) && configuredRetentionDays > 0
    ? configuredRetentionDays
    : 180
) * 24 * 60 * 60 * 1000;

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
    enum: ['private', 'public', 'bulk', 'replacement', 'ai-interview'],
    required: true,
    index: true
  },
  state: {
    type: String,
    enum: ['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed', 'cancelled'],
    required: true,
    index: true
  },
  stage: {
    type: String,
    enum: CV_PROCESSING_STAGES
  },
  stageStartedAt: Date,
  stageHistory: [{
    stage: { type: String, enum: CV_PROCESSING_STAGES, required: true },
    state: { type: String, required: true },
    progress: { type: Number, min: 0, max: 100, required: true },
    attempt: { type: Number, min: 0, default: 0 },
    at: { type: Date, required: true },
    errorCode: String,
    errorMessage: String
  }],
  artifacts: {
    receivedAt: Date,
    durableStoredAt: Date,
    cloudinaryStoredAt: Date,
    textExtractedAt: Date,
    extractedTextLength: { type: Number, min: 0, default: 0 },
    analysisCompletedAt: Date,
    profileCommittedAt: Date
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
    errorMessage: String,
    requestedBy: AuditRetryActorSchema
  }],
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  organizationKey: { type: String, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorKey: String,
  jobAppliedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  jobKey: String,
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  linkedCandidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingBatch' },
  batchPublicId: String,
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' },
  revision: { type: Number, min: 1, default: 1 },
  originalName: String,
  fileType: String,
  fileSize: Number,
  jobCreatedAt: { type: Date, required: true, index: true },
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  cancelledAt: Date,
  lastUpdatedAt: { type: Date, required: true, index: true },
  producerSequence: { type: Number, min: 0 },
  waitMs: Number,
  processingMs: Number,
  errorCode: String,
  error: {
    code: String,
    message: String,
    stage: String,
    at: Date
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + auditRetentionMs)
  },
  transitions: [{
    eventKey: { type: String, required: true },
    phase: {
      type: String,
      enum: ['queued', 'waiting_for_chatgpt', 'processing', 'retrying', 'completed', 'failed', 'cancelled'],
      required: true
    },
    stage: {
      type: String,
      enum: CV_PROCESSING_STAGES
    },
    state: {
      type: String,
      enum: ['queued', 'waiting_for_chatgpt', 'processing', 'completed', 'failed', 'cancelled'],
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
CVProcessingAuditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
