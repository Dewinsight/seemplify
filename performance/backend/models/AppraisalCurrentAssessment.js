'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true }, appraisalId: { type: mongoose.Schema.Types.ObjectId, required: true }, userId: { type: String, required: true },
  identity: { type: mongoose.Schema.Types.Mixed, select: false }, profile: { type: mongoose.Schema.Types.Mixed, select: false },
  enabled: { type: Boolean, default: true }, state: { type: String, default: 'pending', enum: ['pending', 'processing', 'ready', 'failed', 'paused'] },
  revision: { type: Number, default: 1 }, attempts: { type: Number, default: 0 }, nextCheckAt: Date, leaseUntil: Date, leaseToken: String,
  sourceHash: String, content: String, generatedAt: Date, phase: String, model: String, reasoningEffort: String,
  coverage: mongoose.Schema.Types.Mixed, history: [mongoose.Schema.Types.Mixed], errorCode: String
}, { timestamps: true });
schema.index({ organizationId: 1, appraisalId: 1, userId: 1 }, { unique: true });
schema.index({ enabled: 1, nextCheckAt: 1 });
module.exports = mongoose.models.AppraisalCurrentAssessment || mongoose.model('AppraisalCurrentAssessment', schema);
