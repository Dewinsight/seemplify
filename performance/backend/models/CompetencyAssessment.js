'use strict';
const mongoose = require('mongoose');
const mixed = mongoose.Schema.Types.Mixed;
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  cycleId: { type: String, required: true }, cycleVersion: Number, cycleRevision: Number,
  appraisalId: { type: String, default: null }, participant: { type: mixed, required: true },
  assessors: [mixed], assessorIds: [String], definitionSnapshot: { type: mixed, required: true },
  status: { type: String, enum: ['draft','in_progress','finalised','published','reopened'], default: 'draft' },
  revision: { type: Number, default: 1 }, mutationLock: { type: String, default: null }, mutationLeaseUntil: Date, items: [mixed], managerFeedback: [mixed],
  createdBy: mixed, currentResultNumber: Number,
  // Single-document publication is atomic even on standalone Mongo. Historical
  // result documents are embedded authoritative snapshots, never rewritten.
  results: [mixed], reopenHistory: [mixed],
}, { timestamps: true, strict: 'throw', minimize: false });
schema.index({ organizationId: 1, cycleId: 1, cycleVersion: 1, 'participant.userId': 1 }, { unique: true });
schema.index({ organizationId: 1, appraisalId: 1 }, { unique: true, partialFilterExpression: { appraisalId: { $type: 'string' } } });
schema.index({ organizationId: 1, 'participant.userId': 1, createdAt: -1 });
module.exports = mongoose.models.CompetencyAssessment || mongoose.model('CompetencyAssessment', schema);
