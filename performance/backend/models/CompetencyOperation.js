const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true }, actorId: { type: String, required: true }, action: { type: String, required: true }, key: { type: String, required: true }, requestHash: String, status: { type: String, enum: ['pending', 'complete', 'failed'], default: 'pending' }, result: mongoose.Schema.Types.Mixed, leaseUntil: Date, expiresAt: Date }, { timestamps: true });
schema.index({ organizationId: 1, actorId: 1, action: 1, key: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.CompetencyOperation || mongoose.model('CompetencyOperation', schema);
