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

const ScoringWeightsSchema = new mongoose.Schema({
    strategicAlignment: { type: Number, default: 25, min: 0, max: 100 },
    regulatoryRisk: { type: Number, default: 25, min: 0, max: 100 },
    businessImpact: { type: Number, default: 20, min: 0, max: 100 },
    implementationComplexity: { type: Number, default: 15, min: 0, max: 100 },
    timeToValue: { type: Number, default: 10, min: 0, max: 100 },
    resourceRequirements: { type: Number, default: 5, min: 0, max: 100 }
}, { _id: false });

const DepartmentScoringWeightsSchema = new mongoose.Schema({
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    weights: { type: ScoringWeightsSchema, default: () => ({}) }
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
    scoringWeights: { type: ScoringWeightsSchema, default: () => ({}) },
    departmentScoringWeights: [DepartmentScoringWeightsSchema],
    tiers: [TierWorkflowSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

WorkflowPolicySchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('WorkflowPolicy', WorkflowPolicySchema);
