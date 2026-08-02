const mongoose = require('mongoose');

const InterviewCommentSchema = new mongoose.Schema({
  interviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Interview',
    required: true
  },
  
  // Question-based feedback
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewQuestion',
    required: false // null for general feedback
  },
  
  // Interview stage information (denormalized for reporting)
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewStage',
    required: false
  },
  stageName: {
    type: String,
    required: false // e.g., "Technical Round", "HR Round", etc.
  },
  stageOrder: {
    type: Number,
    required: false // The order/round number of the stage
  },
  
  // Author information (for internal feedback)
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // null for public feedback
  },
  authorName: {
    type: String,
    required: true // Store denormalized for performance
  },
  authorRole: {
    type: String,
    enum: ['hr_manager', 'recruiter', 'interviewer', 'hiring_manager', 'team_lead', 'admin', 'public'],
    required: true
  },
  
  // Public feedback information (when authorId is null)
  publicFeedback: {
    email: {
      type: String,
      required: false // required when authorId is null
    },
    name: {
      type: String,
      required: false // required when authorId is null
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationToken: String,
    verifiedAt: Date
  },
  
  // Comment content
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  
  // Comment type and context
  commentType: {
    type: String,
    enum: ['general', 'feedback', 'assessment', 'concern', 'strength', 'recommendation'],
    default: 'general'
  },
  
  // Rating if provided
  rating: {
    overall: {
      type: Number,
      min: 1,
      max: 5
    },
    technical: {
      type: Number,
      min: 1,
      max: 5
    },
    communication: {
      type: Number,
      min: 1,
      max: 5
    },
    cultural: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  
  // Structured feedback categories
  categories: [{
    type: String,
    enum: [
      'technical_skills',
      'communication',
      'problem_solving',
      'cultural_fit',
      'experience',
      'motivation',
      'leadership',
      'collaboration',
      'adaptability',
      'growth_potential',
      'red_flags',
      'next_steps',
      'question_feedback', // For question-based feedback
      'public_feedback',   // For public feedback
      'general'           // For general feedback
    ]
  }],
  
  // Privacy and visibility
  visibility: {
    type: String,
    enum: ['team', 'interviewers', 'hiring_managers', 'private'],
    default: 'team'
  },
  
  // Organization for data isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  
  // Edit tracking
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    editedAt: {
      type: Date,
      default: Date.now
    },
    previousContent: String,
    editReason: String
  }],
  
  // Reactions and engagement
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['like', 'agree', 'disagree', 'insightful', 'concern'],
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Reply thread (if this is a reply to another comment)
  parentCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewComment'
  },
  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewComment'
  }],
  
  // Status and moderation
  status: {
    type: String,
    enum: ['active', 'hidden', 'flagged', 'deleted'],
    default: 'active'
  },
  
  // AI analysis flags
  aiFlags: {
    sentiment: {
      type: String,
      enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative']
    },
    toxicity: {
      type: Number,
      min: 0,
      max: 1 // 0 = not toxic, 1 = very toxic
    },
    keyTopics: [String],
    confidence: {
      type: Number,
      min: 0,
      max: 1
    }
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
InterviewCommentSchema.index({ interviewId: 1, createdAt: -1 });
InterviewCommentSchema.index({ authorId: 1, createdAt: -1 });
InterviewCommentSchema.index({ organization: 1, createdAt: -1 });
InterviewCommentSchema.index({ commentType: 1, createdAt: -1 });
InterviewCommentSchema.index({ parentCommentId: 1 });
InterviewCommentSchema.index({ status: 1 });

// Virtual for comment depth (for threading)
InterviewCommentSchema.virtual('depth').get(function() {
  return this.parentCommentId ? 1 : 0; // Simple 2-level threading
});

// Virtual for reply count
InterviewCommentSchema.virtual('replyCount').get(function() {
  return this.replies ? this.replies.length : 0;
});

// Virtual for reaction summary
InterviewCommentSchema.virtual('reactionSummary').get(function() {
  const summary = {};
  if (this.reactions && this.reactions.length > 0) {
    this.reactions.forEach(reaction => {
      summary[reaction.type] = (summary[reaction.type] || 0) + 1;
    });
  }
  return summary;
});

// Method to check if user can edit this comment
InterviewCommentSchema.methods.canEdit = function(userId) {
  return this.authorId.toString() === userId.toString();
};

// Method to check if user can delete this comment
InterviewCommentSchema.methods.canDelete = function(userId, userRole) {
  return this.authorId.toString() === userId.toString() || 
         ['admin', 'hr_manager'].includes(userRole);
};

// Method to add a reaction
InterviewCommentSchema.methods.addReaction = function(userId, reactionType) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(r => r.userId.toString() !== userId.toString());
  
  // Add new reaction
  this.reactions.push({
    userId: userId,
    type: reactionType
  });
  
  return this.save();
};

// Method to remove a reaction
InterviewCommentSchema.methods.removeReaction = function(userId) {
  this.reactions = this.reactions.filter(r => r.userId.toString() !== userId.toString());
  return this.save();
};

// Static method to get comments for an interview
InterviewCommentSchema.statics.getForInterview = function(interviewId, options = {}) {
  const {
    includeReplies = true,
    visibility = 'team',
    limit = 50,
    sort = 'createdAt'
  } = options;
  
  let query = this.find({
    interviewId: interviewId,
    status: 'active',
    visibility: { $in: Array.isArray(visibility) ? visibility : [visibility] }
  });
  
  if (!includeReplies) {
    query = query.where({ parentCommentId: null });
  }
  
  return query
    .populate('authorId', 'profile.firstName profile.lastName email')
    .populate('questionId', 'question type category difficulty')
    .populate('replies')
    .sort({ [sort]: sort === 'createdAt' ? 1 : -1 })
    .limit(limit);
};

// Static method to get comment analytics for an interview
InterviewCommentSchema.statics.getAnalytics = function(interviewId) {
  return this.aggregate([
    { $match: { interviewId: new mongoose.Types.ObjectId(interviewId), status: 'active' } },
    {
      $group: {
        _id: null,
        totalComments: { $sum: 1 },
        avgRating: { $avg: '$rating.overall' },
        commentTypes: { $push: '$commentType' },
        categories: { $push: '$categories' },
        sentiments: { $push: '$aiFlags.sentiment' }
      }
    },
    {
      $project: {
        totalComments: 1,
        avgRating: { $round: ['$avgRating', 2] },
        commentTypeDistribution: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$commentTypes'] },
              as: 'type',
              in: {
                k: '$$type',
                v: {
                  $size: {
                    $filter: {
                      input: '$commentTypes',
                      cond: { $eq: ['$$this', '$$type'] }
                    }
                  }
                }
              }
            }
          }
        },
        sentimentDistribution: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$sentiments'] },
              as: 'sentiment',
              in: {
                k: '$$sentiment',
                v: {
                  $size: {
                    $filter: {
                      input: '$sentiments',
                      cond: { $eq: ['$$this', '$$sentiment'] }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  ]);
};

// Pre-save middleware for AI analysis
InterviewCommentSchema.pre('save', async function(next) {
  if (this.isModified('content') && this.content) {
    try {
      // Basic AI analysis (sentiment, toxicity, key topics)
      // This would integrate with your AI service
      // For now, we'll set basic flags
      
      // Simple sentiment analysis based on keywords
      const positiveWords = ['good', 'great', 'excellent', 'strong', 'impressive', 'skilled'];
      const negativeWords = ['poor', 'weak', 'concerning', 'lacking', 'insufficient', 'problematic'];
      
      const content = this.content.toLowerCase();
      const positiveCount = positiveWords.filter(word => content.includes(word)).length;
      const negativeCount = negativeWords.filter(word => content.includes(word)).length;
      
      if (positiveCount > negativeCount) {
        this.aiFlags.sentiment = 'positive';
      } else if (negativeCount > positiveCount) {
        this.aiFlags.sentiment = 'negative';
      } else {
        this.aiFlags.sentiment = 'neutral';
      }
      
      // Basic toxicity check (very simple)
      const toxicWords = ['terrible', 'awful', 'horrible', 'stupid', 'incompetent'];
      const toxicCount = toxicWords.filter(word => content.includes(word)).length;
      this.aiFlags.toxicity = Math.min(toxicCount * 0.3, 1);
      
      this.aiFlags.confidence = 0.6; // Basic confidence
      
    } catch (error) {
      console.warn('AI analysis failed for comment:', error.message);
    }
  }
  
  next();
});

module.exports = mongoose.model('InterviewComment', InterviewCommentSchema); 