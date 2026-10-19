const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true, index: true }, name: { type: String, required: true }, slug: { type: String, required: true }, sourceType: { type: String, enum: ['sfia', 'internal'], required: true }, description: String, licenseProvenance: String, currentVersionId: mongoose.Schema.Types.ObjectId, revision: { type: Number, default: 1 }, archivedAt: Date, createdBy: { userId: String, name: String } }, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, slug: 1 }, { unique: true });
module.exports = mongoose.models.CompetencyFramework || mongoose.model('CompetencyFramework', schema);
