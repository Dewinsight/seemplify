const mongoose = require('mongoose');

const InterviewSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: false },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  interviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Stage Relationship
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewStage',
    required: false
  },
  stageName: String, // Denormalized for performance
  stageOrder: Number, // Which round this is
  interviewRound: {
    type: Number,
    default: 1
  },
  
  // Nylas v3 integration fields
  nylasEventId: String,
  nylasGrantId: String, // v3 grant ID instead of access token
  schedulingConfigurationId: String, // v3 scheduler configuration
  bookingId: String, // v3 booking ID
  
  // Interview details
  title: String,
  subject: { 
    type: String, 
    default: function() {
      // Dynamic default subject based on candidate and job
      return `Interview Invitation - ${this.jobTitle || 'Position'}`;
    }
  },
  description: String,
  scheduledAt: Date,
  duration: { type: Number, default: 60 }, // minutes
  location: String,
  meetingLink: String,
  timezone: { type: String, default: 'UTC' },
  
  // v3 conferencing integration
  conferencing: {
    provider: { type: String, enum: ['google_meet', 'zoom', 'teams', 'webex'] },
    details: {
      meetingCode: String,
      password: String,
      url: String,
      phoneNumbers: [String]
    }
  },
  
  // Participants
  participants: [{
    email: String,
    name: String,
    role: { type: String, enum: ['interviewer', 'candidate', 'observer'] },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
  }],
  
  // Interview status and workflow
  status: {
    type: String,
    enum: ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'missed', 'no_show'],
    default: 'scheduled'
  },
  
  // Status-specific timestamps
  missedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  
  // Interview type and format
  type: {
    type: String,
    enum: ['phone', 'video', 'in_person', 'technical', 'behavioral', 'panel'],
    default: 'video'
  },
  
  // Scheduling metadata
  schedulingSource: {
    type: String,
    enum: ['manual', 'pipeline', 'scheduler_widget', 'api'],
    default: 'pipeline'
  },
  
  // Rescheduling tracking
  rescheduleHistory: [{
    originalDate: Date,
    newDate: Date,
    reason: String,
    rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rescheduledAt: { type: Date, default: Date.now }
  }],
  
  // Interview feedback and notes
  notes: String,
  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comments: String,
    strengths: [String],
    concerns: [String],
    recommendation: { type: String, enum: ['hire', 'no_hire', 'maybe', 'pending'] }
  },
  
  // Enhanced Feedback
  structuredFeedback: {
    scores: [{
      criterionId: String,
      criterionName: String,
      score: {
        type: Number,
        min: 1,
        max: 10
      },
      notes: String
    }],
    overallScore: {
      type: Number,
      min: 1,
      max: 100
    },
    recommendation: {
      type: String,
      enum: ['strong_yes', 'yes', 'maybe', 'no', 'strong_no']
    },
    strengths: [String],
    concerns: [String],
    additionalNotes: String
  },
  
  // Notification and reminder settings
  notifications: {
    candidateReminder: { type: Boolean, default: true },
    interviewerReminder: { type: Boolean, default: true },
    reminderTime: { type: Number, default: 24 }, // hours before interview
    lastReminderSent: Date,
    
    // Interviewer questions notification
    sendQuestionsToInterviewers: { type: Boolean, default: false },
    questionsSendTime: { type: Number, default: 60 }, // minutes before interview
    questionsSentAt: Date,
    selectedQuestions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InterviewQuestion'
    }]
  },
  
  // Cancellation details
  cancellationReason: String,
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  
  // Webhook and sync status
  webhookStatus: {
    lastSync: Date,
    syncErrors: [String],
    eventVersion: String
  },
  
  // Notetaker fields
  notetakerEnabled: {
    type: Boolean,
    default: false
  },
  notetakerId: {
    type: String,
    default: null
  },
  notetakerStatus: {
    type: String,
    enum: ['pending', 'scheduled', 'enabled', 'joining', 'joined', 'recording', 'processing', 'completed', 'failed', 'cancelled', 'stopped', 'deleted'],
    default: null
  },
  transcript: {
    content: {
      type: String,
      default: null
    },
    summary: {
      type: String,
      default: null
    },
    keyPoints: [{
      type: String
    }],
    actionItems: [{
      type: String
    }],
    participants: [{
      name: String,
      email: String,
      speakingTime: Number // in seconds
    }],
    duration: {
      type: Number, // in seconds
      default: null
    },
    language: {
      type: String,
      default: 'en'
    },
    confidence: {
      type: Number, // 0-1 confidence score
      default: null
    }
  },
  transcriptAvailableAt: {
    type: Date,
    default: null
  },
  recordingUrl: {
    type: String,
    default: null
  },
  
  // Team Comments and Feedback
  teamComments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewComment'
  }],
  
  // AI-Generated Interview Summary (based on transcript, role, context)
  aiInterviewSummary: {
    generated: {
      type: Boolean,
      default: false
    },
    generatedAt: Date,
    content: String,
    keyInsights: [String],
    candidateStrengths: [String],
    candidateConcerns: [String],
    recommendation: {
      type: String,
      enum: ['strong_yes', 'yes', 'maybe', 'no', 'strong_no']
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100
    },
    methodology: String // Description of how the summary was generated
  },
  
  // AI Analysis of Team Comments
  teamFeedbackAnalysis: {
    analyzed: {
      type: Boolean,
      default: false
    },
    analyzedAt: Date,
    totalComments: Number,
    participantCount: Number,
    
    // Sentiment analysis of all comments
    overallSentiment: {
      type: String,
      enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative']
    },
    sentimentScore: {
      type: Number,
      min: 0,
      max: 100
    },
    
    // Consensus analysis
    consensus: {
      level: {
        type: String,
        enum: ['strong_consensus', 'consensus', 'mixed', 'no_consensus', 'polarized']
      },
      areas: [{
        topic: String,
        agreement: {
          type: String,
          enum: ['unanimous', 'majority', 'split', 'minority']
        },
        details: String
      }]
    },
    
    // Aggregated feedback themes
    commonThemes: [{
      theme: String,
      frequency: Number,
      sentiment: String,
      examples: [String]
    }],
    
    // Strengths identified by team
    identifiedStrengths: [{
      strength: String,
      mentionedBy: Number, // count of team members who mentioned this
      priority: {
        type: String,
        enum: ['critical', 'important', 'moderate', 'minor']
      }
    }],
    
    // Concerns raised by team
    identifiedConcerns: [{
      concern: String,
      severity: {
        type: String,
        enum: ['critical', 'high', 'medium', 'low']
      },
      mentionedBy: Number,
      consensus: {
        type: String,
        enum: ['unanimous', 'majority', 'split', 'single']
      }
    }],
    
    // Final AI recommendation based on team feedback
    finalRecommendation: {
      decision: {
        type: String,
        enum: ['strong_yes', 'yes', 'maybe', 'no', 'strong_no']
      },
      confidence: {
        type: Number,
        min: 0,
        max: 100
      },
      reasoning: String,
      keyFactors: [String],
      riskFactors: [String],
      nextSteps: [String]
    }
  },

  // AI Analysis Results
  aiAnalysis: {
    analyzed: {
      type: Boolean,
      default: false
    },
    analyzedAt: Date,
    modelVersion: String,
    
    // Insights
    insights: {
      // Sentiment Analysis
      sentimentAnalysis: {
        candidateConfidence: {
          type: Number,
          min: 0,
          max: 100
        },
        interviewerEngagement: {
          type: Number,
          min: 0,
          max: 100
        },
        overallTone: {
          type: String,
          enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative']
        },
        emotionalJourney: [{
          timestamp: String,
          sentiment: Number,
          note: String
        }]
      },
      
      // Skills Analysis
      keySkillsMentioned: [{
        skill: String,
        frequency: Number,
        context: String,
        relevanceScore: {
          type: Number,
          min: 0,
          max: 100
        },
        proficiencyIndicator: {
          type: String,
          enum: ['beginner', 'intermediate', 'advanced', 'expert']
        }
      }],
      
      // Concerns & Red Flags
      concerns: [{
        type: {
          type: String,
          enum: [
            'experience_gap',
            'skill_mismatch',
            'communication_issues',
            'culture_mismatch',
            'availability_concerns',
            'compensation_mismatch',
            'other'
          ]
        },
        severity: {
          type: String,
          enum: ['low', 'medium', 'high', 'critical']
        },
        evidence: String,
        timestamp: String,
        recommendation: String
      }],
      
      // Strengths
      strengths: [{
        area: String,
        evidence: String,
        relevanceScore: {
          type: Number,
          min: 0,
          max: 100
        },
        timestamp: String,
        examples: [String]
      }],
      
      // Communication Analysis
      communicationAnalysis: {
        clarity: {
          type: Number,
          min: 0,
          max: 100
        },
        structure: {
          type: Number,
          min: 0,
          max: 100
        },
        relevance: {
          type: Number,
          min: 0,
          max: 100
        },
        examples: {
          type: Number,
          min: 0,
          max: 100
        }
      },
      
      // Next Steps Recommendation
      recommendedNextSteps: {
        shouldProceed: Boolean,
        confidence: {
          type: Number,
          min: 0,
          max: 100
        },
        recommendation: {
          type: String,
          enum: ['advance', 'reject', 'additional_assessment', 'different_role']
        },
        suggestedFocusAreas: [String],
        suggestedInterviewers: [String],
        suggestedQuestions: [String],
        reasoning: String
      }
    },
    
    // Comparative Analysis
    comparativeAnalysis: {
      comparedAt: Date,
      totalCandidatesCompared: Number,
      percentile: {
        type: Number,
        min: 0,
        max: 100
      },
      rankings: {
        overall: Number,
        technical: Number,
        behavioral: Number,
        cultural: Number
      },
      strongerAreas: [{
        area: String,
        percentile: Number,
        description: String
      }],
      weakerAreas: [{
        area: String,
        percentile: Number,
        improvementSuggestion: String
      }]
    }
  },
  
  // Multi-candidate interview support
  isMultiCandidate: {
    type: Boolean,
    default: false
  },
  multiCandidateSessionId: String, // Groups interviews in the same session
  multiCandidateOrder: Number, // Order in the multi-candidate session
  
  // Organization reference (if needed)
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: false,
    index: true
  },
  
  // Analytics and scoring data
  analytics: {
    calculatedScore: {
      overall: {
        type: Number,
        min: 0,
        max: 5
      },
      breakdown: {
        overall: Number,
        technical: Number,
        communication: Number,
        cultural: Number,
        questionSpecific: Number,
        confidence: Number
      },
      recommendation: {
        type: String,
        enum: ['strong_hire', 'hire', 'maybe', 'no_hire', 'strong_no_hire']
      },
      metadata: {
        totalAssessors: Number,
        assessorConsensus: Number,
        calculatedAt: Date,
        lastUpdated: Date
      }
    }
  },
  
  // Comprehensive Analytics (Dynamic Scoring)
  comprehensiveAnalytics: {
    totalScore: {
      type: Number,
      min: 0,
      max: 5
    },
    normalizedScore: {
      type: Number,
      min: 0,
      max: 5
    },
    totalAssessors: Number,
    totalRatingSources: Number,
    breakdown: {
      systemFields: mongoose.Schema.Types.Mixed,
      customFields: mongoose.Schema.Types.Mixed,
      questions: mongoose.Schema.Types.Mixed,
      calculatedFields: mongoose.Schema.Types.Mixed
    },
    weights: mongoose.Schema.Types.Mixed,
    recommendation: {
      type: String,
      enum: ['strong_hire', 'hire', 'maybe', 'no_hire', 'strong_no_hire', 'pending']
    },
    assessorConsensus: {
      type: Number,
      min: 0,
      max: 1
    },
    calculatedAt: Date,
    lastUpdated: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
InterviewSchema.index({ jobId: 1, candidateId: 1 });
InterviewSchema.index({ interviewerId: 1, scheduledAt: 1 });
InterviewSchema.index({ status: 1, scheduledAt: 1 });
InterviewSchema.index({ nylasEventId: 1 });
InterviewSchema.index({ stageId: 1 });
InterviewSchema.index({ jobId: 1, stageId: 1 });
InterviewSchema.index({ multiCandidateSessionId: 1, multiCandidateOrder: 1 });

// Virtual for formatted duration
InterviewSchema.virtual('formattedDuration').get(function() {
  const hours = Math.floor(this.duration / 60);
  const minutes = this.duration % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
});

// Method to check if interview can be rescheduled
InterviewSchema.methods.canReschedule = function() {
  const now = new Date();
  const interviewTime = new Date(this.scheduledAt);
  const hoursDifference = (interviewTime - now) / (1000 * 60 * 60);
  
  return this.status === 'scheduled' && hoursDifference > 2; // Must be at least 2 hours away
};

// Method to get next available status transitions
InterviewSchema.methods.getAvailableStatusTransitions = function() {
  const transitions = {
    'scheduled': ['confirmed', 'cancelled', 'rescheduled'],
    'confirmed': ['in_progress', 'cancelled', 'rescheduled'],
    'in_progress': ['completed', 'cancelled'],
    'completed': [], // Final state
    'cancelled': ['scheduled'], // Can be rescheduled
    'rescheduled': ['scheduled', 'cancelled']
  };
  
  return transitions[this.status] || [];
};

// Static method to find upcoming interviews
InterviewSchema.statics.findUpcoming = function(userId, days = 7) {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  
  return this.find({
    $or: [
      { interviewerId: userId },
      { 'participants.email': userId }
    ],
    scheduledAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['scheduled', 'confirmed'] }
  }).populate('jobId candidateId interviewerId');
};

// Pre-save middleware to validate scheduling
InterviewSchema.pre('save', function(next) {
  // Skip validation for completed or cancelled interviews
  if (this.status === 'completed' || this.status === 'cancelled') {
    return next();
  }
  
  // Only validate future dates for new interviews or when changing the scheduled time
  if (this.isNew || this.isModified('scheduledAt')) {
    if (this.scheduledAt && this.scheduledAt <= new Date()) {
      return next(new Error('Interview cannot be scheduled in the past'));
    }
  }
  
  // Validate duration
  if (this.duration < 15 || this.duration > 480) { // 15 minutes to 8 hours
    return next(new Error('Interview duration must be between 15 minutes and 8 hours'));
  }
  
  next();
});

module.exports = mongoose.model('Interview', InterviewSchema); 