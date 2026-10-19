'use strict';
const mongoose = require('mongoose');
// Optional searchable projection. The assessment's embedded atomic result is
// authoritative; a projection write can never make a failed publication succeed.
const schema = new mongoose.Schema({ organizationId: String, assessmentId: String, number: Number, snapshot: mongoose.Schema.Types.Mixed,
  definitionHash: String, reportHash: String, createdBy: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, assessmentId: 1, number: 1 }, { unique: true });
schema.pre(['updateOne','updateMany','findOneAndUpdate','replaceOne'], function() { throw new Error('Published result revisions are immutable.'); });
module.exports = mongoose.models.CompetencyResultRevision || mongoose.model('CompetencyResultRevision', schema);
