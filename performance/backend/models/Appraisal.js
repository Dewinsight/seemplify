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
  goals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OKR' }],
  // Immutable evidence captured when the appraisal is launched. Appraisal
  // rendering and scoring use these snapshots so later goal edits cannot
  // rewrite historical performance evidence.
  goalSnapshots: [{
    sourceGoalId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR', required: true },
    sourceVersion: { type: Number, default: 1 },
    legacySnapshot: { type: Boolean, default: false },
    period: {
      id: String,
      label: String,
      startDate: Date,
      endDate: Date
    },
    scope: { type: String, default: 'individual' },
    ownerId: String,
    source: String,
    createdBy: mongoose.Schema.Types.Mixed,
    assignedBy: mongoose.Schema.Types.Mixed,
    alignment: mongoose.Schema.Types.Mixed,
    definition: {
      title: String,
      objectives: mongoose.Schema.Types.Mixed
    },
    finalCheckIn: mongoose.Schema.Types.Mixed,
    achievement: {
      rated: Boolean,
      score: Number,
      reason: String
    },
    evidence: [mongoose.Schema.Types.Mixed],
    capturedAt: Date,
    cutoffAt: Date
  }],
  goalEvidenceSummary: {
    rated: { type: Boolean, default: false },
    score: Number,
    ratedGoals: { type: Number, default: 0 },
    totalGoals: { type: Number, default: 0 },
    okrWeight: Number,
    capturedAt: Date,
    cutoffAt: Date,
    unavailableReason: String
  },
  // Frozen at launch so later cycle/template changes cannot alter the review
  // questions, scoring, or evidence requirements for an active appraisal.
  cycleConfigurationSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  customResponses: [{
    sectionId: { type: String, required: true },
    questionId: { type: String, required: true },
    respondentRole: { type: String, enum: ['employee', 'manager'], required: true },
    respondentId: String,
    value: mongoose.Schema.Types.Mixed,
    evidence: [mongoose.Schema.Types.Mixed],
    score: Number,
    lastSavedAt: Date,
    submittedAt: Date
  }],
  feedbackEvidence: [{
    feedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Feedback', required: true },
    type: String,
    content: String,
    contextType: String,
    contextLabel: String,
    senderDisplay: String,
    receivedAt: Date,
    selectedAt: Date,
    selectedBy: String
  }],
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  migration: {
    legacyPerformanceReviewId: { type: mongoose.Schema.Types.ObjectId, index: true },
    migratedAt: Date
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

  // === CONVERSATIONAL ASSESSMENT STATE ===
  conversationAssessment: {
    mode: {
      type: String,
      enum: ['conversation', 'form', 'hybrid'],
      default: 'conversation'
    },
    currentPhase: {
      type: String,
      enum: [
        'initialized',
        'okr_reflection',
        'achievements',
        'challenges',
        'learnings',
        'future_goals',
        'competencies',
        'cycle_questions',
        'report_generation',
        'review',
        'completed'
      ],
      default: 'initialized'
    },
    currentOkrIndex: { type: Number, default: 0 },
    completedPhases: [String],
    cycleQuestionProgress: {
      currentIndex: { type: Number, default: 0 },
      completedKeys: [String],
      skippedKeys: [String],
      startedAt: Date,
      completedAt: Date
    },

    // Extracted data from conversation
    extractedData: {
      achievements: [{
        text: String,
        linkedOkrId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
        confidence: { type: Number, min: 0, max: 1 },
        extractedFrom: { type: String, enum: ['conversation', 'document'] }
      }],
      challenges: [{
        text: String,
        resolution: String,
        learnings: String
      }],
      skills: [{
        skill: String,
        evidence: String,
        selfRating: { type: Number, min: 1, max: 5 }
      }],
      goals: [{
        goal: String,
        measurable: { type: Boolean, default: false },
        timeframe: String
      }]
    },

    // Context for AI (summarized to manage token usage)
    conversationSummary: String,
    lastContextUpdate: Date,
    totalTokensUsed: { type: Number, default: 0 },

    // Conversation metadata
    startedAt: Date,
    lastActivityAt: Date,
    messageCount: { type: Number, default: 0 }
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

    // AI rating suggestion shown to the employee (not the employee's final self-rating)
    aiRatingSuggestion: {
      suggestedRating: { type: Number, min: 1, max: 5 },
      ratingJustification: String,
      keyStrengths: [String],
      developmentAreas: [String],
      calibrationNotes: String,
      confidence: { type: Number, min: 0, max: 1 },
      modelUsed: String,
      generatedAt: Date
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
    justification: String,

    // Breakdown
    breakdown: {
      okrWeight: Number,
      okrContribution: Number,
      competencyWeight: Number,
      competencyContribution: Number,
      customSections: [mongoose.Schema.Types.Mixed]
    },

    override: {
      applied: { type: Boolean, default: false },
      calculatedRating: Number,
      selectedRating: Number,
      reason: String,
      changedBy: {
        userId: String,
        name: String
      },
      changedAt: Date
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
      role: { type: String, enum: ['employee', 'manager', 'hr', 'ai', 'system'] }
    },
    message: String,
    messageType: {
      type: String,
      enum: ['text', 'suggestion', 'question', 'feedback', 'system', 'ai_insight', 'prompt', 'document_analysis', 'phase_transition', 'report_draft'],
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
    // Conversation tracking fields
    phase: String, // Which phase this message belongs to
    questionRef: {
      sectionId: String,
      questionId: String
    },
    linkedOkrId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' }, // If discussing specific OKR
    linkedDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AppraisalDocument' }, // If referencing uploaded document
    structuredData: {
      // Extracted structured information from this exchange
      type: { type: String, enum: ['achievement', 'challenge', 'learning', 'goal', 'skill', 'competency', 'report'] },
      data: mongoose.Schema.Types.Mixed
    },
    aiContext: {
      isAiGenerated: { type: Boolean, default: false },
      fallback: { type: Boolean, default: false },
      promptUsed: String,
      modelUsed: String,
      tokensUsed: Number,
      confidence: { type: Number, min: 0, max: 1 }
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

  // AI output is advisory. Suggestions retain the evidence used to produce
  // them and require an explicit human accept/reject decision; acceptance
  // never writes a rating or appraisal narrative automatically.
  aiSuggestionReviews: [{
    suggestionId: { type: String, required: true },
    suggestionType: {
      type: String,
      enum: ['self_rating', 'manager_rating', 'bias_check', 'development_plan', 'writing_assist', 'other'],
      default: 'other'
    },
    suggestion: mongoose.Schema.Types.Mixed,
    evidence: mongoose.Schema.Types.Mixed,
    modelUsed: String,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    generatedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: {
      userId: String,
      name: String,
      role: String
    },
    reviewComment: String,
    applied: { type: Boolean, default: false }
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
appraisalSchema.virtual('isCurrentlyOverdue').get(function () {
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
appraisalSchema.methods.addAuditLog = function (action, user, details) {
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
appraisalSchema.methods.addChatMessage = function (sender, message, messageType = 'text', attachments = []) {
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
