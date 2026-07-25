const mongoose = require('mongoose');

const AIUsageDailyRollupSchema = new mongoose.Schema({
  day: { type: Date, required: true, index: true },
  sourceApp: { type: String, required: true },
  activity: { type: String, required: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  quotaGroup: { type: String, default: '' },
  organizationId: { type: String, default: '' },
  organizationName: { type: String, default: '' },
  actorId: { type: String, default: '' },
  actorName: { type: String, default: '' },
  calls: { type: Number, default: 0 },
  successes: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  cachedInputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  reasoningTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  estimatedCostUsd: { type: Number, default: 0 },
  latencyTotalMs: { type: Number, default: 0 },
  latencyMaxMs: { type: Number, default: 0 },
  meteredExecutions: { type: Number, default: 0 },
  unmeteredExecutions: { type: Number, default: 0 },
  unknownMeteringExecutions: { type: Number, default: 0 },
  // Materialized-view metadata. The watermark prevents a slower projection
  // from replacing totals which already include newer events.
  projectionWatermark: Number,
  projectionVersion: Number,
  projectionHash: String,
  projectedAt: Date
}, { timestamps: true });

AIUsageDailyRollupSchema.index({
  day: 1,
  sourceApp: 1,
  activity: 1,
  provider: 1,
  model: 1,
  quotaGroup: 1,
  organizationId: 1,
  actorId: 1
}, { unique: true });

module.exports = mongoose.model('AIUsageDailyRollup', AIUsageDailyRollupSchema);
