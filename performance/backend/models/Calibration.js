const mongoose = require('mongoose');

/**
 * Calibration Session Schema
 * HR admin review calibration workflow
 */
const CalibrationSchema = new mongoose.Schema({
  // Session metadata
  title: {
    type: String,
    required: true,
    trim: true
  },
  reviewCycleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReviewCycle',
    required: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  
  // Session details
  scheduledDate: Date,
  status: {
    type: String,
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  
  // Participants (HR admins, senior managers)
  facilitator: {
    userId: String,
    name: String
  },
  participants: [{
    userId: String,
    name: String,
    role: String,
    department: String
  }],
  
  // Teams/departments being calibrated
  scope: {
    type: String,
    enum: ['organization', 'department', 'team'],
    default: 'team'
  },
  teamIds: [String],
  departmentIds: [String],
  
  // Reviews being calibrated
  reviewsUnderCalibration: [{
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PerformanceReview'
    },
    employeeId: String,
    employeeName: String,
    managerId: String,
    managerName: String,
    
    // Original ratings
    originalSelfRating: Number,
    originalManagerRating: Number,
    originalPeerRating: Number,
    
    // Calibrated rating
    calibratedRating: Number,
    calibrationNotes: String,
    
    // Rating distribution bucket
    performanceBucket: {
      type: String,
      enum: ['exceeds', 'meets_plus', 'meets', 'developing', 'needs_improvement']
    },
    
    // Flags
    flagged: { type: Boolean, default: false },
    flagReason: String,
    
    // Calibration decision
    decision: {
      type: String,
      enum: ['approved', 'adjusted', 'pending_review', 'deferred'],
      default: 'pending_review'
    },
    decisionBy: String,
    decisionAt: Date
  }],
  
  // Rating distribution targets
  distributionTargets: {
    exceeds: { type: Number, default: 10 }, // percentage
    meets_plus: { type: Number, default: 20 },
    meets: { type: Number, default: 50 },
    developing: { type: Number, default: 15 },
    needs_improvement: { type: Number, default: 5 }
  },
  
  // Actual distribution after calibration
  actualDistribution: {
    exceeds: { type: Number, default: 0 },
    meets_plus: { type: Number, default: 0 },
    meets: { type: Number, default: 0 },
    developing: { type: Number, default: 0 },
    needs_improvement: { type: Number, default: 0 }
  },
  
  // Discussion points
  discussionNotes: [{
    topic: String,
    discussion: String,
    decision: String,
    addedBy: String,
    addedAt: { type: Date, default: Date.now }
  }],
  
  // AI insights
  aiInsights: {
    ratingDistributionAnalysis: String,
    potentialBiasFlags: [{
      type: String,
      description: String,
      affectedReviews: [String]
    }],
    recommendedAdjustments: [{
      reviewId: String,
      currentRating: Number,
      suggestedRating: Number,
      reason: String
    }],
    generatedAt: Date
  },
  
  // Audit trail
  auditLog: [{
    action: String,
    reviewId: String,
    previousValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    changedBy: String,
    changedAt: { type: Date, default: Date.now },
    reason: String
  }],
  
  // Summary
  summary: {
    totalReviews: { type: Number, default: 0 },
    reviewsAdjusted: { type: Number, default: 0 },
    reviewsApproved: { type: Number, default: 0 },
    averageOriginalRating: Number,
    averageCalibratedRating: Number
  },
  
  // Metadata
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: Date
});

// Indexes
// Note: organizationId already has index: true on field definition
CalibrationSchema.index({ reviewCycleId: 1, status: 1 });

// Pre-save middleware
CalibrationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate actual distribution
  if (this.reviewsUnderCalibration.length > 0) {
    const total = this.reviewsUnderCalibration.length;
    const distribution = { exceeds: 0, meets_plus: 0, meets: 0, developing: 0, needs_improvement: 0 };
    
    this.reviewsUnderCalibration.forEach(r => {
      if (r.performanceBucket && distribution[r.performanceBucket] !== undefined) {
        distribution[r.performanceBucket]++;
      }
    });
    
    Object.keys(distribution).forEach(key => {
      this.actualDistribution[key] = Math.round((distribution[key] / total) * 100);
    });
    
    // Update summary
    this.summary.totalReviews = total;
    this.summary.reviewsAdjusted = this.reviewsUnderCalibration.filter(r => r.decision === 'adjusted').length;
    this.summary.reviewsApproved = this.reviewsUnderCalibration.filter(r => r.decision === 'approved').length;
  }
  
  next();
});

CalibrationSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.Calibration || mongoose.model('Calibration', CalibrationSchema);






