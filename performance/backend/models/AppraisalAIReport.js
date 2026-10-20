'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true },
  appraisalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  state: { type: String, enum: ['pending', 'processing', 'ready', 'failed'], default: 'pending' },
  identity: { type: mongoose.Schema.Types.Mixed, select: false },
  revision: { type: Number, default: 1 }, attempts: { type: Number, default: 0 },
  leaseUntil: Date, leaseToken: String, nextAttemptAt: Date,
  content: String, sourceHash: String, coverage: mongoose.Schema.Types.Mixed,
  generatedAt: Date, model: String, errorCode: String
}, { timestamps: true });
schema.index({ organizationId: 1, appraisalId: 1 }, { unique: true });
schema.index({ state: 1, nextAttemptAt: 1, leaseUntil: 1 });
module.exports = mongoose.models.AppraisalAIReport || mongoose.model('AppraisalAIReport', schema);
