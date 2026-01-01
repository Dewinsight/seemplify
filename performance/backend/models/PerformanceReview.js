const mongoose = require('mongoose');

// Import ReviewCycle from separate model file to avoid duplication
const ReviewCycle = require('./ReviewCycle');

const PerformanceReviewSchema = new mongoose.Schema({
  cycleId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ReviewCycle' 
  },
  userId: { 
    type: String, 
    required: true 
  }, // Reviewee
  managerId: { 
    type: String, 
    required: true 
  }, // Reviewer (Line Manager)
  status: { 
    type: String, 
    enum: ['draft', 'submitted', 'manager-review', 'completed'] 
  },
  
  // Sections with AI Assistance
  selfEvaluation: {
    content: String,
    rating: Number,
    submittedAt: Date,
    aiRefinement: String // AI-improved version of self-evaluation
  },
  managerEvaluation: {
    content: String,
    rating: Number,
    submittedAt: Date,
    aiSummary: String, // GPT-4.1 summary of feedback
    biasDetection: {
      hasBias: Boolean,
      flaggedAreas: [String],
      suggestions: [String]
    }
  },
  peerReviews: [{
    reviewerId: String,
    content: String,
    rating: Number,
    status: { 
      type: String, 
      enum: ['requested', 'submitted'] 
    },
    aiCategorization: {
      category: String, // e.g., "communication", "technical skill"
      sentiment: String, // "positive", "neutral", "negative"
      keyPoints: [String] // Extracted by AI
    }
  }],
  
  // AI Components
  aiInsights: {
    strengths: [String],
    improvements: [String],
    growthPlan: String,
    predictedPerformance: Number,
    confidenceScore: Number
  }
});

// Indexes for performance
PerformanceReviewSchema.index({ cycleId: 1, userId: 1, managerId: 1 });
PerformanceReviewSchema.index({ userId: 1, status: 1 });
PerformanceReviewSchema.index({ managerId: 1, status: 1 });

const PerformanceReview = mongoose.models.PerformanceReview || mongoose.model('PerformanceReview', PerformanceReviewSchema);

module.exports = { 
  ReviewCycle,
  PerformanceReview
};