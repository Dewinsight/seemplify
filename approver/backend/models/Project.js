const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    repoUrl: { type: String },
    filePath: { type: String }, // For local analysis if needed
    analysisResult: { type: Object }, // Store entire AI response

    // Multi-stage approval status for tiered workflow
    approvalStatus: {
        type: String,
        enum: [
            'Pending',              // Initial state
            'AI Analyzing',         // AI is processing
            'AI Approved',          // AI approved - final for Tier 1
            'AI Rejected',          // AI rejected - may escalate for Tier 2/3
            'Pending Governance',   // Waiting for Governance Committee
            'Governance Approved',  // Governance approved - final for Tier 2
            'Governance Rejected',  // Governance rejected - may escalate for Tier 3
            'Pending Executive',    // Waiting for Executive approval
            'Executive Approved',   // Final approval for Tier 3
            'Executive Rejected',   // Final rejection
            'Approved',             // Legacy/simple approved
            'Rejected',             // Legacy/simple rejected
            'Under Review'          // Legacy
        ],
        default: 'Pending'
    },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Under Review'], default: 'Pending' }, // Simple status for backward compatibility
    score: { type: Number, default: 0 },

    // New fields for AI Initiative Intake
    formData: { type: Object }, // Store complete initiative form data
    tier: { type: Number, enum: [1, 2, 3] }, // Initiative tier (1=Low Risk, 2=Moderate, 3=High Risk)
    priorityScore: { type: Number }, // Calculated priority score (1.0 - 5.0)
    scoringBreakdown: { type: Object }, // Individual scores for each parameter
    escalationTriggers: [{ type: String }], // List of triggered escalation reasons
    workflowStage: {
        type: String,
        enum: ['Screening', 'Analysis', 'AI Review', 'Governance Committee', 'Executive Approval', 'Complete'],
        default: 'Screening'
    },

    // Approval history for audit trail
    approvalHistory: [{
        stage: { type: String, enum: ['AI', 'Governance', 'Executive'] },
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
