const mongoose = require('mongoose');

const AuditSchema = new mongoose.Schema({
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    action: { type: String, enum: ['override', 'governance_review', 'executive_review', 'coe_review'], required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    previousStatus: { type: String, required: true },
    newStatus: { type: String, required: true },
    reason: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Audit', AuditSchema);
