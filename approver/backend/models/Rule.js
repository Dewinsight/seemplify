const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    criteria: { type: String, required: true }, // The logical rule prompt for AI
    weight: { type: Number, min: 1, max: 10, default: 1 },
    isMandatory: { type: Boolean, default: false },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' }, // Null = Global within org
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false }, // System rules: cannot be deleted, only toggled/hidden
    isHidden: { type: Boolean, default: false }, // Hidden from default view; admins can unhide
    category: { type: String }, // GATE, ESCALATION, SCORING, STRATEGIC, BOOST, PENALTY, CAP
    effects: [{
        type: {
            type: String,
            enum: ['SET_TIER', 'ROUTE_TO_STAGE', 'SET_FLAG']
        },
        params: { type: mongoose.Schema.Types.Mixed, default: {} }
    }],
    embeddingStatus: {
        state: {
            type: String,
            enum: ['pending', 'indexed', 'failed', 'disabled'],
            default: 'pending'
        },
        indexedAt: { type: Date, default: null },
        lastAttemptAt: { type: Date, default: null },
        source: { type: String, default: '' },
        error: { type: String, default: '' }
    },
    systemRuleId: { type: Number }, // Id from mosaic_approver_rules_v2.json atomic_rules for deduplication
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Rule', RuleSchema);
