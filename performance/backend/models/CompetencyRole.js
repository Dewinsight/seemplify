const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true, index: true }, name: { type: String, required: true }, slug: { type: String, required: true }, description: { type: String, default: '' }, currentVersionId: mongoose.Schema.Types.ObjectId, archivedAt: Date, revision: { type: Number, default: 1 }, createdBy: { userId: String, name: String } }, { timestamps: true, strict: 'throw' });
schema.index({ organizationId: 1, slug: 1 }, { unique: true });
module.exports = mongoose.models.CompetencyRole || mongoose.model('CompetencyRole', schema);
