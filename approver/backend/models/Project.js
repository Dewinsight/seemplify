const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    repoUrl: { type: String },
    filePath: { type: String }, // For local analysis if needed
    analysisResult: { type: Object }, // Store entire AI response

    // Multi-stage approval status for tiered workflow
    approvalStatus: { type: String, default: 'Pending' },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Under Review'], default: 'Pending' }, // Simple status for backward compatibility
    score: { type: Number, default: 0 },

    // New fields for AI Initiative Intake
    formData: { type: Object }, // Store complete initiative form data
    tier: { type: Number, enum: [1, 2, 3] }, // Initiative tier (1=Low Risk, 2=Moderate, 3=High Risk)
    priorityScore: { type: Number }, // Calculated priority score (1.0 - 5.0)
    scoringBreakdown: { type: Object }, // Individual scores for each parameter
    escalationTriggers: [{ type: String }], // List of triggered escalation reasons
    needEnhancedOversight: { type: Boolean, default: false }, // Priority Score 1.5–2.0: requires enhanced oversight
    workflowStage: { type: String, default: 'Screening' },
    workflowPolicy: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowPolicy' },
    currentStageKey: { type: String, default: null },
    workflowPlan: { type: Object, default: null },

    // Approval history for audit trail
    approvalHistory: [{
        stage: { type: String },
        action: { type: String, enum: ['Approved', 'Rejected', 'Escalated'] },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        score: Number,
        timestamp: { type: Date, default: Date.now }
    }],

    submittedAt: { type: Date },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overrideReason: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Project', ProjectSchema);
