const mongoose = require('mongoose');

// Permanent, non-PII materialization of one logical AI request. Provider
// attempts remain in the TTL-backed event ledger and daily cost rollups.
const AIUsageLogicalRequestSchema = new mongoose.Schema({
  requestKey: { type: String, required: true },
  sourceApp: { type: String, required: true, index: true },
  activity: { type: String, required: true, index: true },
  day: { type: Date, required: true, index: true },
  status: { type: String, enum: ['success', 'failed'], required: true, index: true },
  latencyTotalMs: { type: Number, default: 0 },
  latencyMaxMs: { type: Number, default: 0 },
  failovers: { type: Number, default: 0 },
  executionCount: { type: Number, default: 0 },
  meteredExecutions: { type: Number, default: 0 },
  unmeteredExecutions: { type: Number, default: 0 },
  unknownMeteringExecutions: { type: Number, default: 0 },
  projectionWatermark: { type: Number, required: true },
  projectionVersion: { type: Number, required: true },
  projectionHash: { type: String, required: true },
  projectedAt: { type: Date, required: true }
}, { timestamps: true });

AIUsageLogicalRequestSchema.index(
  { requestKey: 1 },
  { unique: true, name: 'uniq_ai_usage_logical_request' }
);

module.exports = mongoose.model('AIUsageLogicalRequest', AIUsageLogicalRequestSchema);
