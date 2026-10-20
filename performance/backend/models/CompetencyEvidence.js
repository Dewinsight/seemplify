'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true }, assessmentId: { type: String, required: true }, participantId: { type: String, required: true },
  title: String, kind: { type: String, enum: ['manual','file','oral','call'] }, criterionIds: [String],
  documentType: { type: String, enum: ['cv','supporting_evidence'], default: 'supporting_evidence' },
  visibility: { type: String, enum: ['participant','assessors'], default: 'assessors' },
  status: { type: String, enum: ['draft','ready','deletion_pending','deletion_failed','deleted'], default: 'ready' },
  text: String, spans: [mongoose.Schema.Types.Mixed], sha256: String, storageKey: { type: String, select: false },
  originalName: String, mimeType: String, size: Number, scanner: mongoose.Schema.Types.Mixed,
  source: mongoose.Schema.Types.Mixed, consent: mongoose.Schema.Types.Mixed, createdBy: mongoose.Schema.Types.Mixed,
  retention: mongoose.Schema.Types.Mixed, deletedAt: Date, deletedBy: mongoose.Schema.Types.Mixed,
  deletionError: String, legalHold: { type: Boolean, default: false }, revision: { type: Number, default: 1 },
  creationKey: String,
}, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, assessmentId: 1, status: 1 });
schema.index({ organizationId: 1, assessmentId: 1, 'createdBy.userId': 1, creationKey: 1 }, { unique: true, partialFilterExpression: { creationKey: { $type: 'string' } } });
module.exports = mongoose.models.CompetencyEvidence || mongoose.model('CompetencyEvidence', schema);
