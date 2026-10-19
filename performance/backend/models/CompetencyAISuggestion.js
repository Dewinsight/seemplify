'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true }, assessmentId: { type: String, required: true }, participantId: String,
  actor: mongoose.Schema.Types.Mixed, definitionHash: String, evidenceHashes: [mongoose.Schema.Types.Mixed],
  status: { type: String, enum: ['pending','running','ready','failed','accepted','edited','dismissed','cancelled'], default: 'pending' },
  observations: [mongoose.Schema.Types.Mixed], text: String, originalText: String, reviewedBy: mongoose.Schema.Types.Mixed, reviewedAt: Date,
  consent: mongoose.Schema.Types.Mixed, attempts: { type: Number, default: 0 }, leaseUntil: Date, errorCode: String,
  revision: { type: Number, default: 1 },
  model: { type: String, default: null }, provider: { type: String, default: null }, generatedAt: Date,
}, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, assessmentId: 1 });
schema.index({ organizationId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
module.exports = mongoose.models.CompetencyAISuggestion || mongoose.model('CompetencyAISuggestion', schema);
