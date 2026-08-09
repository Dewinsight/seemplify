const mongoose = require('mongoose');

/**
 * Development Plan Schema
 * Career growth plans linked to performance reviews
 */
const DevelopmentPlanSchema = new mongoose.Schema({
  // Owner
  userId: {
    type: String,
    required: true,
    index: true
  },
  managerId: {
    type: String,
    required: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  
  // Plan metadata
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  
  // Timeline
  startDate: {
    type: Date,
    required: true
  },
  targetDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'on_hold', 'completed', 'cancelled'],
    default: 'draft'
  },
  
  // Career goals
  careerGoals: [{
    title: { type: String, required: true },
    description: String,
    targetRole: String, // e.g., "Senior Engineer", "Tech Lead"
    timeframe: String, // "6 months", "1 year", "2 years"
    progress: { type: Number, default: 0, min: 0, max: 100 }
  }],
  
  // Skills to develop
  skillDevelopment: [{
    skillName: { type: String, required: true },
    currentLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'expert'],
      default: 'beginner'
    },
    targetLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'expert'],
      default: 'intermediate'
    },
    category: {
      type: String,
      enum: ['technical', 'soft_skills', 'leadership', 'domain', 'tools']
    },
    resources: [{
      type: { type: String, enum: ['course', 'book', 'mentor', 'project', 'certification', 'other'] },
      name: String,
      url: String,
      completed: { type: Boolean, default: false },
      completedAt: Date
    }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    notes: String
  }],
  
  // Learning activities
  learningActivities: [{
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ['training', 'course', 'certification', 'mentoring', 'stretch_assignment', 'internal_project', 'shadowing', 'conference', 'reading', 'other']
    },
    description: String,
    dueDate: Date,
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'skipped'],
      default: 'not_started'
    },
    completedAt: Date,
    evidence: String, // Link or description of completion evidence
    feedback: String
  }],
  
  // Stretch assignments
  stretchAssignments: [{
    title: { type: String, required: true },
    description: String,
    skills: [String], // Skills this develops
    startDate: Date,
    endDate: Date,
    status: {
      type: String,
      enum: ['proposed', 'approved', 'in_progress', 'completed', 'cancelled'],
      default: 'proposed'
    },
    outcome: String,
    managerFeedback: String
  }],
  
  // Mentoring
  mentoring: {
    hasMentor: { type: Boolean, default: false },
    mentorId: String,
    mentorName: String,
    mentorRole: String,
    focusAreas: [String],
    meetingFrequency: String,
    notes: String
  },
  
  // Linked to performance review
  linkedReviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PerformanceReview'
  },
  linkedAppraisalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appraisal',
    index: true
  },
  source: {
    type: String,
    enum: ['manual', 'appraisal', 'onboarding', 'role_change'],
    default: 'manual'
  },
  linkedOKRs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OKR'
  }],
  
  // Progress tracking
  overallProgress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  checkIns: [{
    date: { type: Date, default: Date.now },
    notes: String,
    progressUpdate: Number,
    blockers: String,
    addedBy: String
  }],
  milestones: [{
    title: { type: String, required: true },
    description: String,
    ownerId: String,
    dueDate: Date,
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'cancelled'],
      default: 'not_started'
    },
    evidence: [String],
    completedAt: Date
  }],
  reviewDates: [Date],
  
  // AI recommendations
  aiRecommendations: {
    suggestedSkills: [String],
    suggestedResources: [{
      name: String,
      type: String,
      reason: String
    }],
    careerPathSuggestions: [String],
    generatedAt: Date
  },
  
  // Approvals
  approvedByManager: {
    approved: { type: Boolean, default: false },
    approvedAt: Date,
    comments: String
  },
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
DevelopmentPlanSchema.index({ userId: 1, status: 1 });
DevelopmentPlanSchema.index({ managerId: 1 });
DevelopmentPlanSchema.index(
  { organizationId: 1, linkedAppraisalId: 1 },
  { unique: true, partialFilterExpression: { linkedAppraisalId: { $exists: true } } }
);

// Pre-save middleware
DevelopmentPlanSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate overall progress
  let totalProgress = 0;
  let count = 0;
  
  if (this.skillDevelopment.length > 0) {
    totalProgress += this.skillDevelopment.reduce((sum, s) => sum + s.progress, 0) / this.skillDevelopment.length;
    count++;
  }
  
  if (this.learningActivities.length > 0) {
    const completed = this.learningActivities.filter(a => a.status === 'completed').length;
    totalProgress += (completed / this.learningActivities.length) * 100;
    count++;
  }
  
  if (this.careerGoals.length > 0) {
    totalProgress += this.careerGoals.reduce((sum, g) => sum + g.progress, 0) / this.careerGoals.length;
    count++;
  }
  
  this.overallProgress = count > 0 ? Math.round(totalProgress / count) : 0;
  
  next();
});

DevelopmentPlanSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.DevelopmentPlan || mongoose.model('DevelopmentPlan', DevelopmentPlanSchema);






