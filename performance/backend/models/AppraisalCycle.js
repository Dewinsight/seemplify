const mongoose = require('mongoose');

/**
 * Appraisal Cycle Schema
 * Represents a performance appraisal period (e.g., Q1 2024, Annual 2024)
 * Controls the workflow phases and deadlines for all appraisals in the cycle
 */
const appraisalCycleSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },

  // Scope of the appraisal cycle
  scope: {
    type: {
      type: String,
      enum: ['organization', 'department', 'team'],
      default: 'organization'
    },
    targetIds: [{
      type: String // IDs of departments or teams
    }]
  },

  // Cycle Type
  cycleType: {
    type: String,
    enum: ['annual', 'semi-annual', 'quarterly', 'probation', 'project', 'adhoc'],
    default: 'annual'
  },

  // Period
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },

  // Workflow Phases with Deadlines
  phases: {
    // Phase 1: Goal Setting / OKR Alignment
    goalSetting: {
      startDate: Date,
      endDate: Date,
      isActive: { type: Boolean, default: false },
      isCompleted: { type: Boolean, default: false }
    },
    // Phase 2: Self Assessment
    selfAssessment: {
      startDate: Date,
      endDate: Date,
      isActive: { type: Boolean, default: false },
      isCompleted: { type: Boolean, default: false }
    },
    // Phase 3: Manager Review
    managerReview: {
      startDate: Date,
      endDate: Date,
      isActive: { type: Boolean, default: false },
      isCompleted: { type: Boolean, default: false }
    },
    // Phase 4: Calibration (HR/Leadership)
    calibration: {
      startDate: Date,
      endDate: Date,
      isActive: { type: Boolean, default: false },
      isCompleted: { type: Boolean, default: false }
    },
    // Phase 5: Final Review & Sign-off
    finalReview: {
      startDate: Date,
      endDate: Date,
      isActive: { type: Boolean, default: false },
      isCompleted: { type: Boolean, default: false }
    }
  },

  // Current Phase
  currentPhase: {
    type: String,
    enum: ['draft', 'goalSetting', 'selfAssessment', 'managerReview', 'calibration', 'finalReview', 'completed', 'cancelled'],
    default: 'draft'
  },

  // Rating Scale Configuration
  ratingScale: {
    type: {
      type: String,
      enum: ['numeric', 'descriptive', 'hybrid'],
      default: 'hybrid'
    },
    min: { type: Number, default: 1 },
    max: { type: Number, default: 5 },
    labels: [{
      value: Number,
      label: String,
      description: String,
      color: String
    }]
  },

  // Competencies to evaluate
  competencies: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: String,
    weight: { type: Number, default: 1 },
    category: {
      type: String,
      enum: ['core', 'leadership', 'technical', 'behavioral', 'custom'],
      default: 'core'
    }
  }],

  // OKR Weight in final rating
  okrWeight: {
    type: Number,
    default: 40, // 40% OKRs, 60% competencies
    min: 0,
    max: 100
  },

  // Versioned, configurable assessment design. The protected workflow state
  // machine remains canonical; this definition controls which optional stages,
  // sections, questions, evidence rules, and scoring components appear.
  workflowDefinition: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  sourceTemplate: {
    id: String,
    name: String,
    version: { type: Number, default: 1 }
  },

  // Settings
  settings: {
    allowSelfRating: { type: Boolean, default: true },
    requireDocumentUpload: { type: Boolean, default: false },
    requireOkrAlignment: { type: Boolean, default: true },
    enablePeerFeedback: { type: Boolean, default: true },
    enable360Feedback: { type: Boolean, default: false },
    enableAiAssist: { type: Boolean, default: true },
    enableChat: { type: Boolean, default: true },
    requireSignOff: { type: Boolean, default: true }
  },

  // Status
  status: {
    type: String,
    enum: ['draft', 'active', 'completed', 'cancelled'],
    default: 'draft'
  },

  // Statistics (computed)
  stats: {
    totalEmployees: { type: Number, default: 0 },
    completedAppraisals: { type: Number, default: 0 },
    pendingSelfAssessment: { type: Number, default: 0 },
    pendingManagerReview: { type: Number, default: 0 },
    pendingCalibration: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 }
  },

  // Audit
  createdBy: {
    userId: String,
    name: String,
    email: String
  },
  updatedBy: {
    userId: String,
    name: String,
    email: String
  },
  migration: {
    legacyReviewCycleId: { type: mongoose.Schema.Types.ObjectId, index: true },
    migratedAt: Date
  }
}, {
  timestamps: true
});

// Indexes
appraisalCycleSchema.index({ organizationId: 1, status: 1 });
appraisalCycleSchema.index({ organizationId: 1, periodStart: 1, periodEnd: 1 });

// Default rating scale labels
appraisalCycleSchema.pre('save', function (next) {
  if (!this.ratingScale.labels || this.ratingScale.labels.length === 0) {
    this.ratingScale.labels = [
      { value: 1, label: 'Needs Improvement', description: 'Performance consistently below expectations', color: '#ef4444' },
      { value: 2, label: 'Partially Meets', description: 'Performance sometimes meets expectations', color: '#f97316' },
      { value: 3, label: 'Meets Expectations', description: 'Performance consistently meets expectations', color: '#eab308' },
      { value: 4, label: 'Exceeds Expectations', description: 'Performance frequently exceeds expectations', color: '#22c55e' },
      { value: 5, label: 'Outstanding', description: 'Exceptional performance that significantly exceeds expectations', color: '#3b82f6' }
    ];
  }

  // Default competencies
  if (!this.competencies || this.competencies.length === 0) {
    this.competencies = [
      { id: 'communication', name: 'Communication', description: 'Ability to communicate effectively', weight: 1, category: 'core' },
      { id: 'teamwork', name: 'Teamwork', description: 'Ability to work effectively in a team', weight: 1, category: 'core' },
      { id: 'problem_solving', name: 'Problem Solving', description: 'Ability to identify and solve problems', weight: 1, category: 'core' },
      { id: 'initiative', name: 'Initiative', description: 'Takes proactive action and ownership', weight: 1, category: 'behavioral' },
      { id: 'adaptability', name: 'Adaptability', description: 'Adapts to changing circumstances', weight: 1, category: 'behavioral' }
    ];
  }

  next();
});

module.exports = mongoose.model('AppraisalCycle', appraisalCycleSchema);
