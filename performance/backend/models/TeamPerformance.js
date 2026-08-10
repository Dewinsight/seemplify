const mongoose = require('mongoose');

const TeamPerformanceSchema = new mongoose.Schema({
  teamId: { 
    type: String, 
    required: true 
  },
  organizationId: { 
    type: String, 
    required: true 
  },
  period: { 
    type: String, 
    required: true 
  }, // "Q1 2025", "H1 2025", etc.
  
  // Aggregated Metrics
  metrics: {
    okrCompletionRate: Number, // Percentage
    averageRating: Number,
    reviewCount: Number,
    sentimentScore: Number,
    improvementRate: Number
  },
  
  // Team Comparison (AI-Generated)
  benchmarkComparison: {
    similarTeams: [{
      teamId: String,
      teamName: String,
      performanceScore: Number
    }],
    industryAverage: Number,
    recommendations: [String]
  },
  aiInsights: {
    strengths: [String],
    risks: [String],
    coachingPriorities: [String],
    recommendedActions: [String],
    generatedAt: Date
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

// Indexes for performance
TeamPerformanceSchema.index({ teamId: 1, organizationId: 1, period: 1 });

module.exports = mongoose.model('TeamPerformance', TeamPerformanceSchema);
