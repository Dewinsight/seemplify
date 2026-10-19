const mongoose = require('mongoose');
const schema = new mongoose.Schema({ organizationId: { type: String, required: true, index: true }, action: { type: String, required: true }, resourceType: String, resourceId: String, actor: { userId: String, name: String }, details: mongoose.Schema.Types.Mixed }, { timestamps: true });
schema.index({ organizationId: 1, resourceType: 1, resourceId: 1, createdAt: -1 });
module.exports = mongoose.models.CompetencyAuditEvent || mongoose.model('CompetencyAuditEvent', schema);
