const mongoose = require('mongoose');

const AIQuotaSnapshotSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  quotaGroup: { type: String, required: true },
  model: { type: String, required: true },
  requestLimitDaily: Number,
  requestRemainingDaily: Number,
  requestResetAt: Date,
  tokenLimitMinute: Number,
  tokenRemainingMinute: Number,
  tokenResetAt: Date,
  localDay: Date,
  localRequestsToday: { type: Number, default: 0 },
  localTokensToday: { type: Number, default: 0 },
  localMinute: Date,
  localRequestsMinute: { type: Number, default: 0 },
  localTokensMinute: { type: Number, default: 0 },
  observedAt: { type: Date, default: Date.now },
  blockedUntil: Date,
  blockedReason: String,
  projectionWatermark: Number,
  projectionVersion: Number,
  projectionHash: String,
  projectedAt: Date
}, { timestamps: true });

AIQuotaSnapshotSchema.index({ provider: 1, quotaGroup: 1, model: 1 }, { unique: true });

module.exports = mongoose.model('AIQuotaSnapshot', AIQuotaSnapshotSchema);
