const mongoose = require('mongoose');

const WorkflowStageSchema = new mongoose.Schema({
    stageKey: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    requiredRoleKeys: [{ type: String, required: true, trim: true }],
    minApprovals: { type: Number, min: 1, default: 1 },
    onReject: { type: String, enum: ['REJECT', 'ESCALATE_TO_NEXT'], default: 'REJECT' },
    pendingStatusLabel: { type: String, default: '' },
    approvedStatusLabel: { type: String, default: '' },
    rejectedStatusLabel: { type: String, default: '' }
}, { _id: false });

const TierWorkflowSchema = new mongoose.Schema({
    tier: { type: Number, required: true, min: 1, max: 3 },
    label: { type: String, required: true, trim: true },
    minPriorityScore: { type: Number, required: true },
    maxPriorityScore: { type: Number, required: true },
    stages: [WorkflowStageSchema]
}, { _id: false });

const WorkflowPolicySchema = new mongoose.Schema({
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    name: { type: String, required: true, default: 'Default Workflow Policy' },
    description: { type: String, default: '' },
    isSystem: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    aiGate: {
        rejectBelow: { type: Number, default: 1.5 },
        enhancedOversightMax: { type: Number, default: 2.0 }
    },
    escalation: {
        forcedTierOnEscalation: { type: Number, enum: [1, 2, 3], default: 3 }
    },
    tiers: [TierWorkflowSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

WorkflowPolicySchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

WorkflowPolicySchema.index({ organization: 1 }, { unique: true });

module.exports = mongoose.model('WorkflowPolicy', WorkflowPolicySchema);
