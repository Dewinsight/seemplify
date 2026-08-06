const mongoose = require('mongoose');

const AIUsageEventSchema = new mongoose.Schema({
  // eventId is the idempotency boundary for a single provider outcome. A
  // request may legitimately have more than one event (for example, a local
  // failure followed by a Groq success), so requestId alone is not unique.
  eventId: String,
  eventFingerprint: String,
  // Monotonic sequence used as a projection watermark. ObjectIds are not a
  // reliable insertion-order clock when several application processes write
  // concurrently.
  projectionSequence: { type: Number, index: true },
  dailyRollupProjectedAt: Date,
  logicalRollupProjectedAt: Date,
  quotaProjectedAt: Date,
  projectionLastError: String,
  projectionExcluded: { type: Boolean, default: false, index: true },
  projectionDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'AIUsageEvent' },
  recordedAt: { type: Date, default: Date.now, index: true },
  requestId: { type: String, required: true, index: true },
  providerRequestId: String,
  gatewayExecutionId: { type: String, index: true },
  meteringOrigin: {
    type: String,
    enum: ['local-gateway-at-source', 'backend-response', 'reconciled'],
    index: true
  },
  atSourceOnly: { type: Boolean, default: false, index: true },
  reconciledAt: Date,
  sourceApp: { type: String, default: 'recruiter', index: true },
  activity: { type: String, required: true, index: true },
  provider: { type: String, required: true, index: true },
  model: { type: String, required: true, index: true },
  // Whose plan paid for the work: the platform's shared capacity or the
  // acting user's own connected ChatGPT account.
  runtimeOwner: { type: String, enum: ['platform', 'user'], default: 'platform', index: true },
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
}, {
  timestamps: true,
  minimize: false,
  // The compatibility pass assigns/deduplicates eventId values before it
  // explicitly creates the unique index. Auto-building it during connect
  // would race that repair on an existing deployment.
  autoIndex: false
});

AIUsageEventSchema.index({ createdAt: -1 });
AIUsageEventSchema.index({ organizationId: 1, createdAt: -1 });
AIUsageEventSchema.index({ actorId: 1, createdAt: -1 });
AIUsageEventSchema.index({ activity: 1, model: 1, createdAt: -1 });
AIUsageEventSchema.index(
  { eventId: 1 },
  {
    unique: true,
    name: 'uniq_ai_usage_event_id',
    partialFilterExpression: { eventId: { $type: 'string' } }
  }
);
AIUsageEventSchema.index({
  dailyRollupProjectedAt: 1,
  logicalRollupProjectedAt: 1,
  quotaProjectedAt: 1,
  projectionSequence: 1
});

module.exports = mongoose.model('AIUsageEvent', AIUsageEventSchema);
