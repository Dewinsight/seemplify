const mongoose = require('mongoose');

/**
 * Appraisal Schema
 * Represents an individual employee's performance appraisal within a cycle
 * Contains self-assessment, manager review, OKR achievements, and final ratings
 */
const appraisalSchema = new mongoose.Schema({
  // References
  cycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AppraisalCycle',
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },

  // Employee being appraised
  employee: {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    jobTitle: String,
    department: String,
    teamId: String,
    teamName: String,
    startDate: Date // Employment start date for tenure context
  },

  // Manager conducting the review
  manager: {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    jobTitle: String
  },

  // Secondary reviewers (skip-level, HR, etc.)
  additionalReviewers: [{
    userId: String,
    name: String,
    email: String,
    role: { type: String, enum: ['skip_level', 'hr', 'peer', 'mentor', 'project_lead'] },
    hasReviewed: { type: Boolean, default: false },
    reviewedAt: Date
  }],

  // Workflow Status
  status: {
    type: String,
    enum: [
      'not_started',
      'goal_setting',
      'goal_approval_pending',  // Manager needs to approve goals
      'self_assessment_pending',
      'self_assessment_in_progress',
      'self_assessment_submitted',
      'manager_review_pending',
      'manager_review_in_progress',
      'manager_review_submitted',
      'discussion_scheduled',
      'discussion_completed',
      'calibration_pending',
      'calibration_in_progress',
      'calibration_completed',
      'final_review_pending',
      'employee_acknowledged',
      'completed',
      'cancelled'
    ],
    default: 'not_started'
  },

  // === SELF ASSESSMENT SECTION ===
  selfAssessment: {
    submittedAt: Date,
    lastSavedAt: Date,

    // Overall self-reflection
    overallSummary: {
      achievements: String,      // Key achievements this period
      challenges: String,        // Challenges faced
      learnings: String,         // What they learned
      improvements: String,      // Areas for improvement
      goals: String              // Goals for next period
    },

    // Competency self-ratings
    competencyRatings: [{
      competencyId: String,
      competencyName: String,
      selfRating: { type: Number, min: 1, max: 5 },
      selfComments: String,
      evidenceDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AppraisalDocument' }]
    }],

    // OKR self-assessment
    okrAssessment: [{
      okrId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
      okrTitle: String,
      targetValue: Number,
      achievedValue: Number,
      completionPercentage: Number,
      selfComments: String,
      evidenceDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AppraisalDocument' }]
    }],

    // Overall self-rating
    overallSelfRating: {
      type: Number,
      min: 1,
      max: 5
    },

    // AI-generated insights on self-assessment
    aiInsights: {
      strengths: [String],
      developmentAreas: [String],
      suggestions: [String],
      sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'mixed']
      },
      generatedAt: Date
    }
  },

  // === MANAGER REVIEW SECTION ===
  managerReview: {
    submittedAt: Date,
    lastSavedAt: Date,

    // Overall manager assessment
    overallSummary: {
      achievements: String,      // Manager's view on achievements
      strengths: String,         // Key strengths observed
      improvements: String,      // Areas needing improvement
      recommendations: String,   // Development recommendations
      promotionReadiness: {
        type: String,
        enum: ['not_ready', 'developing', 'ready', 'overdue']
      }
    },

    // Competency manager ratings
    competencyRatings: [{
      competencyId: String,
      competencyName: String,
      managerRating: { type: Number, min: 1, max: 5 },
      managerComments: String,
      gapFromSelf: Number // Difference from self-rating
    }],

    // OKR manager assessment
    okrAssessment: [{
      okrId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
      okrTitle: String,
      managerVerifiedCompletion: Number,
      managerComments: String,
      qualityRating: { type: Number, min: 1, max: 5 }
    }],

    // Overall manager rating
    overallManagerRating: {
      type: Number,
      min: 1,
      max: 5
    },

    // AI-assisted review
    aiAssist: {
      suggestedRating: Number,
      ratingJustification: String,
      biasCheck: {
        hasPotentialBias: Boolean,
        biasType: String,
        suggestion: String
      },
      developmentPlanSuggestions: [String],
      generatedAt: Date
    }
  },

  // === DISCUSSION SECTION ===
  discussion: {
    scheduledDate: Date,
    completedDate: Date,
    duration: Number, // in minutes
    location: String, // or 'virtual'
    meetingLink: String,

    // Discussion notes
    notes: {
      agreedStrengths: [String],
      agreedImprovements: [String],
      developmentPlan: String,
      careerAspirations: String,
      supportNeeded: String,
      nextSteps: String
    },

    // Both parties must acknowledge
    employeeAcknowledged: { type: Boolean, default: false },
    employeeAcknowledgedAt: Date,
    managerAcknowledged: { type: Boolean, default: false },
    managerAcknowledgedAt: Date
  },

  // === CALIBRATION SECTION ===
  calibration: {
    originalRating: Number,
    calibratedRating: Number,
    calibratedBy: {
      userId: String,
      name: String
    },
    calibratedAt: Date,
    justification: String,
    calibrationSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calibration' }
  },

  // === FINAL RATING ===
  finalRating: {
    overall: { type: Number, min: 1, max: 5 },
    okrScore: Number,         // Weighted OKR score
    competencyScore: Number,  // Weighted competency score
    ratingLabel: String,      // e.g., "Exceeds Expectations"
    ratingColor: String,

    // Breakdown
    breakdown: {
      okrWeight: Number,
      okrContribution: Number,
      competencyWeight: Number,
      competencyContribution: Number
    },

    finalizedAt: Date,
    finalizedBy: {
      userId: String,
      name: String
    }
  },

  // === CHAT/DISCUSSION THREAD ===
  chatThread: [{
    messageId: { type: mongoose.Schema.Types.ObjectId, auto: true },
    sender: {
      userId: String,
      name: String,
      role: { type: String, enum: ['employee', 'manager', 'hr', 'ai'] }
    },
    message: String,
    messageType: {
      type: String,
      enum: ['text', 'suggestion', 'question', 'feedback', 'system', 'ai_insight'],
      default: 'text'
    },
    attachments: [{
      documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AppraisalDocument' },
      fileName: String,
      fileType: String
    }],
    isRead: {
      byEmployee: { type: Boolean, default: false },
      byManager: { type: Boolean, default: false }
    },
    aiContext: {
      isAiGenerated: { type: Boolean, default: false },
      promptUsed: String,
      modelUsed: String
    },
    createdAt: { type: Date, default: Date.now }
  }],

  // === DOCUMENTS ===
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AppraisalDocument'
  }],

  // === NOTIFICATIONS ===
  notifications: [{
    type: { type: String },
    message: String,
    sentAt: Date,
    readAt: Date
  }],

  // === AUDIT TRAIL ===
  auditLog: [{
    action: String,
    performedBy: {
      userId: String,
      name: String,
      role: String
    },
    details: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  }],

  // Deadlines
  deadlines: {
    selfAssessmentDue: Date,
    managerReviewDue: Date,
    discussionDue: Date,
    signOffDue: Date
  },

  // Flags
  flags: {
    isOverdue: { type: Boolean, default: false },
    hasDispute: { type: Boolean, default: false },
    needsAttention: { type: Boolean, default: false },
    disputeReason: String
  }
}, {
  timestamps: true
});

// Indexes
appraisalSchema.index({ cycleId: 1, 'employee.userId': 1 }, { unique: true });
appraisalSchema.index({ organizationId: 1, status: 1 });
appraisalSchema.index({ 'manager.userId': 1, status: 1 });
appraisalSchema.index({ cycleId: 1, status: 1 });

// Virtual for computing if overdue
appraisalSchema.virtual('isCurrentlyOverdue').get(function() {
  const now = new Date();
  if (this.status === 'self_assessment_pending' || this.status === 'self_assessment_in_progress') {
    return this.deadlines.selfAssessmentDue && now > this.deadlines.selfAssessmentDue;
  }
  if (this.status === 'manager_review_pending' || this.status === 'manager_review_in_progress') {
    return this.deadlines.managerReviewDue && now > this.deadlines.managerReviewDue;
  }
  return false;
});

// Add to audit log
appraisalSchema.methods.addAuditLog = function(action, user, details) {
  this.auditLog.push({
    action,
    performedBy: {
      userId: user.userId || user.id,
      name: user.name,
      role: user.role
    },
    details,
    timestamp: new Date()
  });
};

// Add chat message
appraisalSchema.methods.addChatMessage = function(sender, message, messageType = 'text', attachments = []) {
  this.chatThread.push({
    sender: {
      userId: sender.userId || sender.id,
      name: sender.name,
      role: sender.role
    },
    message,
    messageType,
    attachments,
    createdAt: new Date()
  });
};

module.exports = mongoose.model('Appraisal', appraisalSchema);
