const mongoose = require('mongoose');

// Keep legacy values while exposing the complete ingestion lifecycle. Older
// jobs using `ingesting`/`finalizing` remain readable during a rolling deploy.
const CV_PROCESSING_STAGES = [
  'received',
  'ingesting',
  'uploading',
  'stored',
  'extracting',
  'analyzing',
  'profile_creation',
  'finalizing',
  'retry_scheduled',
  'completed',
  'failed',
  'cancelled'
];

const CV_PROCESSING_STATES = [
  'queued',
  'waiting_for_chatgpt',
  'processing',
  'completed',
  'failed',
  'cancelled'
];

const CompletionEffectSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'skipped'],
    default: 'pending'
  },
  attempts: { type: Number, default: 0, min: 0 },
  claimToken: String,
  claimedAt: Date,
  completedAt: Date,
  lastError: {
    message: String,
    at: Date
  }
}, { _id: false });

const RetryActorSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['system', 'user', 'admin']
  },
  id: String,
  name: String,
  email: String
}, { _id: false });

const ProcessingAttemptSchema = new mongoose.Schema({
  attemptId: { type: String, required: true },
  number: { type: Number, required: true, min: 1 },
  trigger: {
    type: String,
    enum: ['initial', 'automatic', 'manual'],
    required: true
  },
  requestedStage: {
    type: String,
    enum: ['failed', 'parsing', 'analysis'],
    default: 'failed'
  },
  status: {
    type: String,
    enum: ['processing', 'waiting_for_runtime', 'failed', 'completed', 'cancelled'],
    default: 'processing'
  },
  stage: {
    type: String,
    enum: CV_PROCESSING_STAGES
  },
  startedAt: { type: Date, required: true },
  finishedAt: Date,
  errorCode: String,
  errorMessage: String,
  requestedBy: RetryActorSchema
}, { _id: false });

const CVProcessingJobSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  statusTokenHash: { type: String, required: true, select: false },
  idempotencyKey: { type: String, index: true },
  requestFingerprint: { type: String, select: false },
  // A short lease owns the request-to-GridFS handoff. The job itself is the
  // durable intake receipt, so a sweeper can never delete bytes that a later
  // write will blindly attach to a newly-created job.
  intakeLeaseId: { type: String, select: false },
  intakeLeaseAt: Date,
  state: {
    type: String,
    enum: CV_PROCESSING_STATES,
    default: 'queued',
    index: true
  },
  stage: {
    type: String,
    enum: CV_PROCESSING_STAGES,
    index: true
  },
  stageStartedAt: Date,
  stageHistory: {
    type: [{
      stage: { type: String, enum: CV_PROCESSING_STAGES, required: true },
      state: { type: String, enum: CV_PROCESSING_STATES, required: true },
      progress: { type: Number, min: 0, max: 100, required: true },
      attempt: { type: Number, min: 0, default: 0 },
      at: { type: Date, required: true },
      errorCode: String,
      errorMessage: String
    }],
    default: []
  },
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
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  jobAppliedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  source: { type: String, enum: ['private', 'public', 'bulk', 'replacement', 'ai-interview'], required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingBatch', index: true },
  batchPublicId: { type: String, index: true },
  billing: {
    required: { type: Boolean, default: false },
    action: String,
    cost: Number,
    state: {
      type: String,
      enum: ['not_required', 'pending', 'charged', 'failed'],
      default: 'not_required'
    },
    idempotencyKey: String,
    attempts: { type: Number, default: 0, min: 0 },
    failureDisposition: {
      type: String,
      enum: ['retryable', 'permanent']
    },
    nextAttemptAt: Date,
    terminalAt: Date,
    chargedAt: Date,
    lastAttemptAt: Date,
    lastError: {
      code: String,
      message: String
    }
  },
  publicApplicationReservation: {
    reserved: { type: Boolean, default: false },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    creditCost: Number,
    applicationCount: Number,
    limitReached: { type: Boolean, default: false },
    reservedAt: Date
  },
  completionEffects: {
    candidateNotification: { type: CompletionEffectSchema, default: () => ({}) },
    gptCacheInvalidation: { type: CompletionEffectSchema, default: () => ({}) },
    websocketBroadcast: { type: CompletionEffectSchema, default: () => ({}) },
    embedding: { type: CompletionEffectSchema, default: () => ({}) },
    limitReachedNotification: { type: CompletionEffectSchema, default: () => ({}) }
  },
  completionEffectsCompletedAt: Date,
  originalName: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  resumeText: { type: String, default: '', select: false },
  durableFile: {
    provider: { type: String, enum: ['gridfs'] },
    bucket: String,
    fileId: String,
    sha256: String,
    length: Number,
    persistedAt: Date,
    releasedAt: Date,
    cleanupState: {
      type: String,
      enum: ['retained', 'pending', 'deleted', 'failed'],
      default: 'retained'
    },
    cleanupAttempts: { type: Number, default: 0, min: 0 },
    cleanupAttemptedAt: Date,
    cleanupNextAttemptAt: Date,
    cleanupError: String
  },
  cloudinary: {
    resumeUrl: String,
    publicId: String,
    assetId: String,
    resourceType: String,
    deliveryType: String,
    cleanupState: {
      type: String,
      enum: ['retained', 'pending', 'deleted', 'failed'],
      default: 'retained'
    },
    cleanupAttempts: { type: Number, default: 0, min: 0 },
    cleanupAttemptedAt: Date,
    cleanupNextAttemptAt: Date,
    releasedAt: Date,
    cleanupError: String
  },
  // Persisted before the external upload begins. If the worker exits after
  // Cloudinary accepts the bytes but before `cloudinary` metadata commits,
  // deletion/recovery still has a deterministic provider pointer to erase or
  // safely overwrite.
  cloudinaryUploadIntent: {
    publicId: String,
    resourceType: String,
    deliveryType: String,
    generation: String,
    preparedAt: Date
  },
  formData: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 },
  processingAttempts: { type: Number, default: 0, min: 0 },
  processingLeaseId: { type: String, select: false },
  boundedFailureAttempts: { type: Number, default: 0, min: 0 },
  retry: {
    pendingTrigger: {
      type: String,
      enum: ['initial', 'automatic', 'manual'],
      default: 'initial'
    },
    requestedStage: {
      type: String,
      enum: ['failed', 'parsing', 'analysis'],
      default: 'failed'
    },
    manualRequests: { type: Number, default: 0, min: 0 },
    deferredCycles: { type: Number, default: 0, min: 0 },
    nextAttemptAt: Date,
    lastDeferredAt: Date,
    availableUntil: Date,
    lastRequestedAt: Date,
    lastRequestedBy: RetryActorSchema
  },
  attemptHistory: {
    type: [ProcessingAttemptSchema],
    default: []
  },
  lastError: {
    code: String,
    message: String,
    stage: String,
    at: Date
  },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  // Set when the CV is uploaded against a candidate that already exists
  // (e.g. created up-front from a public application form). When present,
  // completion enriches this candidate instead of creating a new one.
  linkedCandidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' },
  revision: { type: Number, min: 1, default: 1 },
  // The TTL is assigned only after a job reaches a terminal state. Queued,
  // processing, and offline-waiting jobs must survive an arbitrarily long
  // hosted ChatGPT outage.
  expiresAt: Date
}, { timestamps: true, minimize: false });

CVProcessingJobSchema.index(
  { organization: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
CVProcessingJobSchema.index(
  { organization: 1, source: 1, jobAppliedFor: 1, linkedCandidate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source: 'public',
      linkedCandidate: { $type: 'objectId' }
    },
    name: 'uniq_public_candidate_cv_ingestion'
  }
);
CVProcessingJobSchema.index({ state: 1, createdAt: 1 });
CVProcessingJobSchema.index({ completedAt: -1 });
CVProcessingJobSchema.index({ failedAt: -1 });
CVProcessingJobSchema.index({ updatedAt: -1 });
CVProcessingJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CVProcessingJobSchema.index({ state: 1, 'durableFile.cleanupNextAttemptAt': 1 });
CVProcessingJobSchema.index({ state: 1, 'cloudinary.cleanupNextAttemptAt': 1 });
CVProcessingJobSchema.index({ state: 1, 'retry.availableUntil': 1 });
CVProcessingJobSchema.index({
  source: 1,
  'billing.state': 1,
  'billing.failureDisposition': 1,
  'billing.nextAttemptAt': 1
});

module.exports = mongoose.model('CVProcessingJob', CVProcessingJobSchema);
