const mongoose = require('mongoose');

const InterviewQuestionSchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: [true, 'Job reference is required'],
    index: true
  },
  question: {
    type: String,
    required: [true, 'Question text is required'],
    trim: true,
    maxlength: [1000, 'Question cannot exceed 1000 characters']
  },
  type: {
    type: String,
    required: [true, 'Question type is required'],
    enum: ['technical', 'behavioral', 'situational', 'cultural_fit', 'general', 'skills_based', 'experience_based'],
    default: 'general'
  },
  category: {
    type: String,
    trim: true,
    maxlength: [100, 'Category cannot exceed 100 characters']
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  interviewStage: {
    type: String,
    enum: ['screening', 'first_round', 'technical', 'final', 'hr', 'panel'],
    default: 'first_round'
  },
  expectedAnswer: {
    type: String,
    trim: true,
    maxlength: [2000, 'Expected answer cannot exceed 2000 characters']
  },
  scoringCriteria: [{
    criterion: {
      type: String,
      required: true,
      trim: true
    },
    weight: {
      type: Number,
      min: 0,
      max: 100,
      default: 10
    },
    description: {
      type: String,
      trim: true
    }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  timeLimit: {
    type: Number, // in minutes
    min: 0,
    max: 120
  },
  followUpQuestions: [{
    question: {
      type: String,
      required: true,
      trim: true
    },
    condition: {
      type: String,
      trim: true
    }
  }],
  // AI-generated fields
  isAIGenerated: {
    type: Boolean,
    default: false
  },
  aiGenerationMetadata: {
    generatedAt: Date,
    model: String,
    prompt: String,
    promptVersion: String,
    requestId: String,
    routeVersion: Number,
    confidence: Number,
    questionType: String
  },
  // Advanced AI quality metrics
  qualityMetrics: {
    semanticQualityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    qualityIssues: [{ type: String, trim: true }],
    analysisStatus: {
      type: String,
      enum: ['pending', 'complete', 'manual_review'],
      default: 'pending'
    },
    difficultyCalibration: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    diversityIndex: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    biasScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    legalCompliance: {
      type: Boolean,
      default: null
    },
    // Detailed bias analysis breakdown
    biasAnalysis: {
      age: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },
      gender: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },
      nationality: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },
      familyStatus: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },
      religious: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      }
    },
    // Enhanced AI bias analysis with detailed factors
    detectedBiasFactors: [{
      type: {
        type: String,
        required: true,
        trim: true
      },
      score: {
        type: Number,
        min: 0,
        max: 1,
        required: true
      },
      keywordsFound: [{
        type: String,
        trim: true
      }],
      explanation: {
        type: String,
        required: true,
        trim: true
      }
    }],
    // AI analysis metadata
    overallBiasScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    isBiased: {
      type: Boolean,
      default: null
    },
    aiNeutralityConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    aiRecommendation: {
      type: String,
      trim: true
    },
    lastAnalyzed: {
      type: Date,
      default: null
    }
  },
  // Usage tracking
  usage: {
    timesUsed: {
      type: Number,
      default: 0
    },
    averageScore: {
      type: Number,
      min: 0,
      max: 10
    },
    lastUsed: Date,
    successRate: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    }
  },
  // Feedback and analytics
  candidateFeedback: [{
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'Comment cannot exceed 500 characters']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate'
    }
  }],
  interviewerFeedback: [{
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    effectiveness: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'Comment cannot exceed 500 characters']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    interviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  // Performance tracking
  responsePatterns: [{
    responseType: {
      type: String,
      enum: ['excellent', 'good', 'average', 'poor', 'no_response'],
      required: true
    },
    frequency: {
      type: Number,
      default: 0
    },
    successCorrelation: {
      type: Number,
      min: -1,
      max: 1,
      default: 0
    }
  }],
  // Creator and modification tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
InterviewQuestionSchema.index({ jobId: 1, type: 1 });
InterviewQuestionSchema.index({ jobId: 1, interviewStage: 1 });
InterviewQuestionSchema.index({ jobId: 1, isActive: 1, order: 1 });
InterviewQuestionSchema.index({ tags: 1 });
InterviewQuestionSchema.index({ createdBy: 1 });

InterviewQuestionSchema.index({ 'usage.successRate': 1 });
InterviewQuestionSchema.index({ isAIGenerated: 1 });

// Update 'updatedAt' field before saving
InterviewQuestionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for job details
InterviewQuestionSchema.virtual('job', {
  ref: 'Job',
  localField: 'jobId',
  foreignField: '_id',
  justOne: true
});

// Virtual for creator details
InterviewQuestionSchema.virtual('creator', {
  ref: 'User',
  localField: 'createdBy',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
InterviewQuestionSchema.set('toJSON', { virtuals: true });
InterviewQuestionSchema.set('toObject', { virtuals: true });

// Static methods
InterviewQuestionSchema.statics.findByJob = function(jobId, options = {}) {
  const query = { jobId, isActive: true };
  
  if (options.type) query.type = options.type;
  if (options.stage) query.interviewStage = options.stage;
  if (options.difficulty) query.difficulty = options.difficulty;
  
  return this.find(query).sort({ order: 1, createdAt: 1 });
};

InterviewQuestionSchema.statics.findByJobAndStage = function(jobId, stage) {
  return this.find({ 
    jobId, 
    interviewStage: stage, 
    isActive: true 
  }).sort({ order: 1, createdAt: 1 });
};

// Instance methods
InterviewQuestionSchema.methods.markAsUsed = function() {
  this.usage.timesUsed += 1;
  this.usage.lastUsed = new Date();
  return this.save();
};

InterviewQuestionSchema.methods.updateAverageScore = function(newScore) {
  const currentAvg = this.usage.averageScore || 0;
  const timesUsed = this.usage.timesUsed || 1;
  
  // Calculate new average
  this.usage.averageScore = ((currentAvg * (timesUsed - 1)) + newScore) / timesUsed;
  return this.save();
};

// New enhanced methods
InterviewQuestionSchema.methods.addCandidateFeedback = function(feedback) {
  this.candidateFeedback.push({
    rating: feedback.rating,
    comment: feedback.comment,
    candidateId: feedback.candidateId,
    timestamp: new Date()
  });
  
  // Update average candidate rating
  const totalRating = this.candidateFeedback.reduce((sum, fb) => sum + fb.rating, 0);
  this.qualityMetrics.candidateRating = totalRating / this.candidateFeedback.length;
  
  return this.save();
};

InterviewQuestionSchema.methods.addInterviewerFeedback = function(feedback) {
  this.interviewerFeedback.push({
    rating: feedback.rating,
    effectiveness: feedback.effectiveness,
    comment: feedback.comment,
    interviewerId: feedback.interviewerId,
    timestamp: new Date()
  });
  
  // Update average effectiveness score
  const totalEffectiveness = this.interviewerFeedback.reduce((sum, fb) => sum + fb.effectiveness, 0);
  this.qualityMetrics.effectivenessScore = totalEffectiveness / this.interviewerFeedback.length;
  
  return this.save();
};

InterviewQuestionSchema.methods.updateResponsePattern = function(responseType, wasSuccessful) {
  // Find existing pattern or create new one
  let pattern = this.responsePatterns.find(p => p.responseType === responseType);
  
  if (!pattern) {
    pattern = {
      responseType: responseType,
      frequency: 0,
      successCorrelation: 0
    };
    this.responsePatterns.push(pattern);
  }
  
  pattern.frequency += 1;
  
  // Update success correlation (simple moving average)
  const successValue = wasSuccessful ? 1 : 0;
  pattern.successCorrelation = ((pattern.successCorrelation * (pattern.frequency - 1)) + successValue) / pattern.frequency;
  
  // Update overall success rate
  const totalResponses = this.responsePatterns.reduce((sum, p) => sum + p.frequency, 0);
  const weightedSuccess = this.responsePatterns.reduce((sum, p) => sum + (p.frequency * p.successCorrelation), 0);
  this.usage.successRate = totalResponses > 0 ? weightedSuccess / totalResponses : 0;
  
  return this.save();
};

InterviewQuestionSchema.methods.calculateQualityScore = function() {
  const metrics = this.qualityMetrics;
  
  // Weighted quality score calculation
  const weights = {
    difficultyCalibration: 0.3,
    diversityIndex: 0.2,
    biasScore: 0.25, // Lower bias score is better, so we'll invert this
    legalCompliance: 0.25
  };
  
  const qualityScore = 
    (metrics.difficultyCalibration * weights.difficultyCalibration) +
    (metrics.diversityIndex * weights.diversityIndex) +
    ((1 - metrics.biasScore) * weights.biasScore) + // Invert bias score
    ((metrics.legalCompliance ? 1 : 0) * weights.legalCompliance);
  
  return Math.round(qualityScore * 100) / 100; // Round to 2 decimal places
};

InterviewQuestionSchema.methods.getPerformanceInsights = function() {
  const insights = {
    overallRating: this.calculateQualityScore(),
    usageStats: {
      timesUsed: this.usage.timesUsed,
      successRate: this.usage.successRate,
      averageScore: this.usage.averageScore
    },
    feedback: {
      candidateCount: this.candidateFeedback.length,
      interviewerCount: this.interviewerFeedback.length,
      averageCandidateRating: this.candidateFeedback.length > 0 
        ? this.candidateFeedback.reduce((sum, fb) => sum + fb.rating, 0) / this.candidateFeedback.length 
        : 0,
      averageInterviewerRating: this.interviewerFeedback.length > 0 
        ? this.interviewerFeedback.reduce((sum, fb) => sum + fb.rating, 0) / this.interviewerFeedback.length 
        : 0
    },
    responsePatterns: this.responsePatterns.map(pattern => ({
      type: pattern.responseType,
      frequency: pattern.frequency,
      successRate: pattern.successCorrelation
    })),
    recommendations: this._generateRecommendations()
  };
  
  return insights;
};

InterviewQuestionSchema.methods._generateRecommendations = function() {
  const recommendations = [];
  
  // Usage-based recommendations
  if (this.usage.timesUsed < 5) {
    recommendations.push('This question needs more usage data to provide reliable insights.');
  }
  
  if (this.usage.successRate < 0.6) {
    recommendations.push('Consider revising this question as it has a low success rate.');
  }
  
  // Quality-based recommendations
  if (this.qualityMetrics.biasScore > 0.3) {
    recommendations.push('Review this question for potential bias issues.');
  }
  

  
  // Feedback-based recommendations
  const avgCandidateRating = this.candidateFeedback.length > 0 
    ? this.candidateFeedback.reduce((sum, fb) => sum + fb.rating, 0) / this.candidateFeedback.length 
    : 0;
    
  if (avgCandidateRating < 3) {
    recommendations.push('Candidates find this question challenging or unclear. Consider simplifying or providing more context.');
  }
  
  return recommendations;
};

module.exports = mongoose.model('InterviewQuestion', InterviewQuestionSchema);
