const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true, index: true }, strategyId: { type: mongoose.Schema.Types.ObjectId, required: true }, title: String, description: String, sourceRef: mongoose.Schema.Types.Mixed, version: { type: Number, required: true }, revision: { type: Number, default: 1 }, status: { type: String, enum: ['draft', 'published'], default: 'draft' }, criteria: [mongoose.Schema.Types.Mixed], levels: [mongoose.Schema.Types.Mixed], contentHash: String, createdBy: { userId: String, name: String }, publishedBy: { userId: String, name: String }, publishedAt: Date }, { timestamps: true, strict: 'throw' });
const contentFields = ['name', 'title', 'description', 'responsibilities', 'requirements', 'criteria', 'levels', 'source', 'sourceRef', 'licenseProvenance', 'contentHash', 'status', 'roleId', 'frameworkId', 'strategyId', 'version', 'sourceType', 'sourceDocumentId', 'publishedBy', 'publishedAt'];
schema.pre('save', async function () { if (!this.isNew && contentFields.some(field => this.isModified(field))) {
    const current = await this.constructor.findById(this._id).select('status');
    if (current?.status === 'published')
        throw new (require('../contracts/competency').DomainError)(409, 'IMMUTABLE_VERSION', 'Create a new version to change published content.');
} });
schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndReplace'], async function () { const update = this.getUpdate() || {}; const changed = [...Object.keys(update).filter(k => !k.startsWith('$')), ...Object.keys(update.$set || {}), ...Object.keys(update.$unset || {}), ...Object.keys(update.$inc || {}), ...Object.keys(update.$push || {}), ...Object.keys(update.$pull || {})]; if (Array.isArray(update) || changed.some(path => contentFields.includes(path.split('.')[0]))) {
    if (await this.model.exists({ ...this.getFilter(), status: 'published' }))
        throw new (require('../contracts/competency').DomainError)(409, 'IMMUTABLE_VERSION', 'Create a new version to change published content.');
} });
schema.index({ organizationId: 1, strategyId: 1, version: 1 }, { unique: true });
module.exports = mongoose.models.CompetencyStrategyVersion || mongoose.model('CompetencyStrategyVersion', schema);
