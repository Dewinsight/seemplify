const mongoose = require('mongoose');

/**
 * 1:1 Meeting Schema
 * Comprehensive model for manager-employee check-ins with:
 * - Nylas calendar/video integration
 * - Transcript storage and analysis
 * - AI-based and manager scoring
 * - Chat-based discussion option
 */
const OneOnOneSchema = new mongoose.Schema({
  // Participants
  managerId: {
    type: String,
    required: true,
    index: true
  },
  managerInfo: {
    name: String,
    email: String,
    avatar: String
  },
  employeeId: {
    type: String,
    required: true,
    index: true
  },
  employeeInfo: {
    name: String,
    email: String,
    avatar: String,
    title: String
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },

  // Meeting details
  title: {
    type: String,
    default: '1:1 Meeting'
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  actualStartTime: Date,
  actualEndTime: Date,
  duration: {
    type: Number, // in minutes
    default: 30
  },
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show'],
    default: 'scheduled'
  },
  meetingType: {
    type: String,
    enum: ['weekly', 'biweekly', 'monthly', 'adhoc', 'performance_review', 'career_discussion'],
    default: 'weekly'
  },

  // Meeting format - video call or chat-based
  meetingFormat: {
    type: String,
    enum: ['video', 'audio', 'chat', 'in_person'],
    default: 'video'
  },

  // Nylas Integration
  nylas: {
    eventId: String,
    calendarId: String,
    conferenceUrl: String,
    conferenceProvider: {
      type: String,
      enum: ['google_meet', 'zoom', 'teams', 'other']
    },
    conferenceDetails: mongoose.Schema.Types.Mixed,
    htmlLink: String,
    grantId: String,
    syncStatus: {
      type: String,
      enum: ['synced', 'pending', 'failed', 'not_synced'],
      default: 'not_synced'
    },
    lastSyncAt: Date
  },

  // Recording and Transcript
  recording: {
    url: String,
    provider: String, // 'google_meet', 'zoom', etc.
    duration: Number, // seconds
    fileSize: Number, // bytes
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed', 'expired'],
      default: 'pending'
    },
    expiresAt: Date
  },
  transcript: {
    content: String, // Full transcript text
    segments: [{
      speaker: String, // 'manager', 'employee', 'unknown'
      speakerName: String,
      text: String,
      startTime: Number, // seconds
      endTime: Number,
      confidence: Number
    }],
    language: { type: String, default: 'en' },
    wordCount: Number,
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
      default: 'pending'
    },
    processedAt: Date,
    source: {
      type: String,
      enum: ['auto', 'manual_upload', 'live_transcription'],
      default: 'auto'
    }
  },

  // Chat-based meeting (alternative to video)
  chatThread: [{
    messageId: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    sender: {
      type: String,
      enum: ['manager', 'employee', 'ai_assistant'],
      required: true
    },
    senderInfo: {
      userId: String,
      name: String,
      avatar: String
    },
    content: {
      type: String,
      required: true
    },
    messageType: {
      type: String,
      enum: ['text', 'suggestion', 'action_item', 'mood_check', 'summary'],
      default: 'text'
    },
    metadata: mongoose.Schema.Types.Mixed,
    reactions: [{
      userId: String,
      emoji: String,
      createdAt: { type: Date, default: Date.now }
    }],
    isEdited: { type: Boolean, default: false },
    editedAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],

  // Agenda items (prepared beforehand)
  agendaItems: [{
    topic: String,
    description: String,
    addedBy: String, // 'manager' or 'employee'
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    discussed: { type: Boolean, default: false },
    discussedAt: Date,
    notes: String,
    timeSpent: Number // minutes
  }],

  // Discussion notes
  privateManagerNotes: {
    type: String // Only visible to manager
  },
  sharedNotes: {
    type: String // Visible to both
  },
  employeeNotes: {
    type: String // Only visible to employee (and HR admin)
  },

  // Action items from meeting
  actionItems: [{
    id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    description: { type: String, required: true },
    assignedTo: { type: String, enum: ['manager', 'employee'] },
    assignedToName: String,
    category: {
      type: String,
      enum: ['task', 'development', 'follow_up', 'blocker_resolution', 'career', 'other'],
      default: 'task'
    },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    dueDate: Date,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending'
    },
    completedAt: Date,
    notes: String,
    createdAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['manual', 'ai_extracted'], default: 'manual' }
  }],

  // Talking points templates
  talkingPoints: [{
    category: {
      type: String,
      enum: ['wellbeing', 'career', 'feedback', 'blockers', 'wins', 'goals', 'development', 'other']
    },
    content: String,
    response: String,
    discussed: { type: Boolean, default: false }
  }],

  // Employee mood/pulse check
  employeeMood: {
    score: { type: Number, min: 1, max: 5 }, // 1-5 scale
    label: { type: String, enum: ['very_low', 'low', 'neutral', 'good', 'great'] },
    comment: String,
    recordedAt: Date,
    factors: [String] // e.g., ['workload', 'team', 'growth', 'recognition']
  },

  // AI Analysis Results
  aiAnalysis: {
    summary: String,
    keyTopics: [{
      topic: String,
      description: String,
      timeDiscussed: Number // minutes
    }],
    sentiment: {
      overall: { type: String, enum: ['positive', 'neutral', 'negative'] },
      employeeSentiment: String,
      managerSentiment: String,
      progression: [String]
    },
    engagementLevel: {
      type: String,
      enum: ['high', 'moderate', 'low']
    },
    concerns: [{
      issue: String,
      severity: { type: String, enum: ['high', 'medium', 'low'] },
      recommendation: String
    }],
    highlights: [String],
    careerDevelopmentTopics: [String],
    blockers: [{
      description: String,
      suggestedResolution: String
    }],
    suggestedFollowUps: [String],
    analyzedAt: Date,
    analysisVersion: String
  },

  // AI-based Scoring (automatic)
  aiScoring: {
    employee: {
      overallScore: { type: Number, min: 1, max: 5 },
      dimensions: {
        communication: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        },
        engagement: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        },
        problemSolving: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        },
        accountability: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        },
        growthMindset: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        },
        collaboration: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          recommendation: String
        }
      },
      strengths: [String],
      areasForImprovement: [String],
      recommendations: [String],
      confidenceLevel: { type: String, enum: ['high', 'moderate', 'low'] },
      scoredAt: Date
    },
    manager: {
      overallScore: { type: Number, min: 1, max: 5 },
      dimensions: {
        supportiveness: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          coachingSuggestion: String
        },
        feedbackQuality: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          coachingSuggestion: String
        },
        listening: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          coachingSuggestion: String
        },
        careerDevelopment: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          coachingSuggestion: String
        },
        followThrough: {
          score: { type: Number, min: 1, max: 5 },
          evidence: String,
          coachingSuggestion: String
        }
      },
      strengths: [String],
      developmentAreas: [String],
      coachingTips: [String],
      scoredAt: Date
    }
  },

  // Manager's Manual Scoring
  managerScoring: {
    overallScore: { type: Number, min: 1, max: 5 },
    performanceRating: {
      type: String,
      enum: ['exceeds_expectations', 'meets_expectations', 'needs_improvement', 'unsatisfactory']
    },
    dimensions: {
      preparedness: { type: Number, min: 1, max: 5 },
      communication: { type: Number, min: 1, max: 5 },
      problemOwnership: { type: Number, min: 1, max: 5 },
      initiative: { type: Number, min: 1, max: 5 },
      receptivenessToFeedback: { type: Number, min: 1, max: 5 },
      actionItemCompletion: { type: Number, min: 1, max: 5 }
    },
    strengths: String,
    areasForGrowth: String,
    additionalComments: String,
    scoredAt: Date,
    isVisible: { type: Boolean, default: false } // Whether employee can see this
  },

  // Employee's feedback on the meeting
  employeeFeedback: {
    meetingQuality: { type: Number, min: 1, max: 5 },
    managerRating: { type: Number, min: 1, max: 5 },
    helpful: Boolean,
    suggestions: String,
    submittedAt: Date
  },

  // Recurring meeting settings
  recurring: {
    isRecurring: { type: Boolean, default: false },
    frequency: { type: String, enum: ['weekly', 'biweekly', 'monthly'] },
    dayOfWeek: Number, // 0-6 (Sunday-Saturday)
    time: String, // HH:MM format
    timezone: String,
    seriesId: String, // Links related recurring meetings
    instanceNumber: Number,
    skippedDates: [Date]
  },

  // Links to related data
  relatedOkrs: [{
    okrId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
    title: String,
    progress: Number,
    discussedAt: Date
  }],
  relatedReviews: [{
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceReview' },
    reviewCycle: String,
    discussedAt: Date
  }],

  // Preparation suggestions (AI-generated)
  prepSuggestions: {
    suggestedTopics: [String],
    questionsForEmployee: [String],
    previousItemsToReview: [String],
    developmentQuestions: [String],
    generatedAt: Date
  },

  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: Date,
  createdBy: String
});

// Indexes
OneOnOneSchema.index({ managerId: 1, scheduledDate: -1 });
OneOnOneSchema.index({ employeeId: 1, scheduledDate: -1 });
OneOnOneSchema.index({ 'recurring.seriesId': 1 });
OneOnOneSchema.index({ organizationId: 1, scheduledDate: -1 });
OneOnOneSchema.index({ 'nylas.eventId': 1 });
OneOnOneSchema.index({ status: 1, scheduledDate: -1 });

// Pre-save middleware
OneOnOneSchema.pre('save', function(next) {
  this.updatedAt = Date.now();

  // Calculate word count if transcript exists
  if (this.transcript?.content && !this.transcript.wordCount) {
    this.transcript.wordCount = this.transcript.content.split(/\s+/).length;
  }

  next();
});

// Virtual for overdue action items
OneOnOneSchema.virtual('overdueActionItems').get(function() {
  const now = new Date();
  return this.actionItems.filter(item =>
    item.status !== 'completed' && item.status !== 'cancelled' &&
    item.dueDate && new Date(item.dueDate) < now
  );
});

// Virtual for pending action items count
OneOnOneSchema.virtual('pendingActionItemsCount').get(function() {
  return this.actionItems.filter(item =>
    item.status === 'pending' || item.status === 'in_progress'
  ).length;
});

// Virtual for meeting duration in human readable format
OneOnOneSchema.virtual('durationFormatted').get(function() {
  if (this.actualStartTime && this.actualEndTime) {
    const minutes = Math.round((this.actualEndTime - this.actualStartTime) / 60000);
    return `${minutes} minutes`;
  }
  return `${this.duration} minutes (scheduled)`;
});

// Virtual for combined score (average of AI and manager scores)
OneOnOneSchema.virtual('combinedEmployeeScore').get(function() {
  const aiScore = this.aiScoring?.employee?.overallScore;
  const managerScore = this.managerScoring?.overallScore;

  if (aiScore && managerScore) {
    return ((aiScore + managerScore) / 2).toFixed(2);
  }
  return aiScore || managerScore || null;
});

OneOnOneSchema.set('toJSON', { virtuals: true });
OneOnOneSchema.set('toObject', { virtuals: true });

// Static method to get meeting history between two users
OneOnOneSchema.statics.getMeetingHistory = async function(managerId, employeeId, limit = 10) {
  return this.find({
    managerId,
    employeeId,
    status: 'completed'
  })
    .sort({ scheduledDate: -1 })
    .limit(limit)
    .select('scheduledDate aiScoring.employee.overallScore managerScoring.overallScore employeeMood aiAnalysis.keyTopics');
};

// Static method to get upcoming meetings for a user
OneOnOneSchema.statics.getUpcoming = async function(userId, role = 'any', limit = 10) {
  const now = new Date();
  const query = {
    scheduledDate: { $gte: now },
    status: 'scheduled'
  };

  if (role === 'manager') {
    query.managerId = userId;
  } else if (role === 'employee') {
    query.employeeId = userId;
  } else {
    query.$or = [{ managerId: userId }, { employeeId: userId }];
  }

  return this.find(query)
    .sort({ scheduledDate: 1 })
    .limit(limit);
};

// Instance method to add chat message
OneOnOneSchema.methods.addChatMessage = async function(sender, content, messageType = 'text', senderInfo = {}) {
  this.chatThread.push({
    sender,
    senderInfo,
    content,
    messageType,
    createdAt: new Date()
  });
  return this.save();
};

// Instance method to mark action item complete
OneOnOneSchema.methods.completeActionItem = async function(actionItemId) {
  const item = this.actionItems.id(actionItemId);
  if (item) {
    item.status = 'completed';
    item.completedAt = new Date();
    return this.save();
  }
  throw new Error('Action item not found');
};

module.exports = mongoose.models.OneOnOne || mongoose.model('OneOnOne', OneOnOneSchema);




