'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true }, assessmentId: { type: String, required: true }, participantId: String,
  title: String, prompts: [mongoose.Schema.Types.Mixed], callType: { type: String, enum: ['manual','nylas','native'], default: 'manual' },
  callId: String, source: mongoose.Schema.Types.Mixed, consent: mongoose.Schema.Types.Mixed,
  occurredAt: Date, timeZone: { type: String, default: 'UTC' }, participants: [mongoose.Schema.Types.Mixed],
  status: { type: String, enum: ['draft','submitted'], default: 'draft' }, submittedAt: Date, versions: [mongoose.Schema.Types.Mixed],
  evidenceId: String, sourceWithdrawnAt: Date,
  creationKey: String,
  visibility: { type: String, enum: ['participant','assessors'], default: 'assessors' },
  createdBy: mongoose.Schema.Types.Mixed, updatedBy: mongoose.Schema.Types.Mixed, revision: { type: Number, default: 1 },
}, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, assessmentId: 1 });
schema.index({ organizationId: 1, assessmentId: 1, 'createdBy.userId': 1, creationKey: 1 }, { unique: true, partialFilterExpression: { creationKey: { $type: 'string' } } });
module.exports = mongoose.models.CompetencyOralSession || mongoose.model('CompetencyOralSession', schema);
