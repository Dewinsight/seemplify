const mongoose = require('mongoose');

const AIUsageEventSchema = new mongoose.Schema({
  requestId: { type: String, required: true, index: true },
  providerRequestId: String,
  sourceApp: { type: String, default: 'recruiter', index: true },
  activity: { type: String, required: true, index: true },
  provider: { type: String, required: true, index: true },
  model: { type: String, required: true, index: true },
  reasoningEffort: String,
  routeVersion: Number,
  promptVersion: { type: String, default: '1' },
  credential: { type: mongoose.Schema.Types.ObjectId, ref: 'AIProviderCredential', index: true },
  credentialLabel: String,
  quotaGroup: { type: String, index: true },
  organizationId: { type: String, index: true },
  organizationName: String,
  actorId: { type: String, index: true },
  actorName: String,
  actorEmail: String,
  interviewId: { type: String, index: true },
  sessionId: String,
  jobId: { type: String, index: true },
  candidateId: { type: String, index: true },
  status: { type: String, enum: ['success', 'failed'], required: true, index: true },
  httpStatus: Number,
  errorCode: String,
  errorMessage: String,
  attempts: { type: Number, default: 1 },
  failovers: { type: Number, default: 0 },
  failoverFrom: String,
  failoverReason: String,
  attemptErrors: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  latencyMs: Number,
  promptBytes: Number,
  responseBytes: Number,
  // Keep this tri-state for backwards compatibility. Historical events created
  // before provider metering capture have no value; new unmetered events are
  // explicitly false and metered events are true.
  usageReported: { type: Boolean, index: true },
  usageSource: String,
  inputTokens: { type: Number, default: 0 },
  cachedInputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  reasoningTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  estimatedCostUsd: { type: Number, default: 0 },
  rateLimit: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, minimize: false });

AIUsageEventSchema.index({ createdAt: -1 });
AIUsageEventSchema.index({ organizationId: 1, createdAt: -1 });
AIUsageEventSchema.index({ actorId: 1, createdAt: -1 });
AIUsageEventSchema.index({ activity: 1, model: 1, createdAt: -1 });

module.exports = mongoose.model('AIUsageEvent', AIUsageEventSchema);
