const mongoose = require('mongoose');

/**
 * Review Cycle Schema
 * Represents a performance review cycle (e.g., "Q4 2024 Performance Review")
 */
const ReviewCycleSchema = new mongoose.Schema({
  title: {
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
    required: true
  },
  
  // Review type
  type: {
    type: String,
    enum: ['360', 'manager-only', 'self-only', 'peer'],
    default: 'manager-only'
  },
  
  // Cycle dates
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  
  // Specific phase dates
  phases: {
    selfReviewStart: Date,
    selfReviewEnd: Date,
    peerReviewStart: Date,
    peerReviewEnd: Date,
    managerReviewStart: Date,
    managerReviewEnd: Date,
    calibrationStart: Date,
    calibrationEnd: Date
  },
  
  // Cycle status
  status: {
    type: String,
    enum: ['draft', 'planning', 'active', 'calibration', 'closed'],
    default: 'draft'
  },
  
  // Settings
  settings: {
    requireSelfReview: {
      type: Boolean,
      default: true
    },
    requirePeerReview: {
      type: Boolean,
      default: false
    },
    minPeerReviewers: {
      type: Number,
      default: 0
    },
    maxPeerReviewers: {
      type: Number,
      default: 5
    },
    allowAnonymousPeerFeedback: {
      type: Boolean,
      default: false
    },
    ratingScale: {
      type: Number,
      enum: [3, 4, 5],
      default: 5
    },
    includeOKRProgress: {
      type: Boolean,
      default: true
    },
    includeFeedbackSummary: {
      type: Boolean,
      default: true
    }
  },
  
  // Questions/form template
  questions: [{
    category: {
      type: String,
      required: true,
      enum: ['achievements', 'challenges', 'goals', 'development', 'values', 'custom']
    },
    question: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['text', 'rating', 'scale', 'multiple_choice'],
      default: 'text'
    },
    required: {
      type: Boolean,
      default: true
    },
    options: [String], // For multiple choice
    appliesTo: {
      type: [String],
      enum: ['self', 'manager', 'peer'],
      default: ['self', 'manager']
    }
  }],
  
  // Created/managed by
  createdBy: {
    type: String,
    required: true
  },
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
ReviewCycleSchema.index({ organizationId: 1, status: 1 });
ReviewCycleSchema.index({ startDate: 1, endDate: 1 });

// Pre-save middleware
ReviewCycleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for current phase
ReviewCycleSchema.virtual('currentPhase').get(function() {
  const now = new Date();
  
  if (this.status === 'closed') return 'completed';
  if (this.status === 'draft' || this.status === 'planning') return 'not_started';
  if (this.status === 'calibration') return 'calibration';
  
  if (this.phases) {
    if (now >= this.phases.selfReviewStart && now <= this.phases.selfReviewEnd) {
      return 'self_review';
    }
    if (now >= this.phases.peerReviewStart && now <= this.phases.peerReviewEnd) {
      return 'peer_review';
    }
    if (now >= this.phases.managerReviewStart && now <= this.phases.managerReviewEnd) {
      return 'manager_review';
    }
    if (now >= this.phases.calibrationStart && now <= this.phases.calibrationEnd) {
      return 'calibration';
    }
  }
  
  return 'active';
});

// Methods
ReviewCycleSchema.methods.isActive = function() {
  return this.status === 'active';
};

ReviewCycleSchema.methods.canSubmitSelfReview = function() {
  if (!this.isActive()) return false;
  if (!this.settings.requireSelfReview) return false;
  
  const now = new Date();
  if (this.phases?.selfReviewEnd && now > this.phases.selfReviewEnd) {
    return false;
  }
  return true;
};

ReviewCycleSchema.methods.canSubmitManagerReview = function() {
  if (!this.isActive() && this.status !== 'calibration') return false;
  
  const now = new Date();
  if (this.phases?.managerReviewEnd && now > this.phases.managerReviewEnd) {
    return false;
  }
  return true;
};

// Ensure virtuals are included in JSON
ReviewCycleSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.ReviewCycle || mongoose.model('ReviewCycle', ReviewCycleSchema);






