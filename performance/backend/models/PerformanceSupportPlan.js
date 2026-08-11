const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  label: { type: String, trim: true, maxlength: 240 },
  url: { type: String, trim: true, maxlength: 1200 },
  note: { type: String, trim: true, maxlength: 2000 },
  addedBy: { type: String, trim: true, maxlength: 240 },
  addedAt: { type: Date, default: Date.now }
}, { _id: true });

const objectiveSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 240 },
  measure: { type: String, required: true, trim: true, maxlength: 1000 },
  target: { type: String, required: true, trim: true, maxlength: 1000 },
  dueDate: { type: Date, required: true },
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'achieved', 'not_achieved'],
    default: 'not_started'
  },
  progress: { type: Number, min: 0, max: 100 },
  evidence: [evidenceSchema]
}, { _id: true });

const commitmentSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true, maxlength: 1200 },
  ownerType: { type: String, enum: ['manager', 'hr', 'organization'], default: 'manager' },
  ownerId: { type: String, trim: true, maxlength: 240 },
  dueDate: Date,
  status: { type: String, enum: ['open', 'completed'], default: 'open' },
  completedAt: Date
}, { _id: true });

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 240 },
  dueDate: { type: Date, required: true },
  status: { type: String, enum: ['upcoming', 'due', 'completed', 'missed'], default: 'upcoming' },
  employeeUpdate: { type: String, trim: true, maxlength: 4000 },
  managerResponse: { type: String, trim: true, maxlength: 4000 },
  updatedAt: Date
}, { _id: true });

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true, maxlength: 120 },
  actorId: { type: String, required: true, trim: true, maxlength: 240 },
  actorRole: { type: String, trim: true, maxlength: 80 },
  at: { type: Date, default: Date.now },
  details: { type: mongoose.Schema.Types.Mixed }
}, { _id: true });

const performanceSupportPlanSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  employee: {
    userId: { type: String, required: true },
    name: String,
    email: String,
    jobTitle: String,
    teamId: String,
    teamName: String
  },
  manager: {
    userId: { type: String, required: true },
    name: String,
    email: String
  },
  planType: { type: String, enum: ['informal_support', 'formal_improvement'], required: true },
  state: {
    type: String,
    enum: ['draft', 'hr_review', 'changes_requested', 'employee_review', 'active', 'review_due', 'completed', 'extended', 'escalated', 'cancelled'],
    default: 'draft',
    index: true
  },
  title: { type: String, required: true, trim: true, maxlength: 240 },
  summary: { type: String, required: true, trim: true, maxlength: 5000 },
  concerns: [{
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    expectedStandard: { type: String, required: true, trim: true, maxlength: 2000 },
    evidence: [evidenceSchema]
  }],
  objectives: {
    type: [objectiveSchema],
    validate: [items => Array.isArray(items) && items.length > 0, 'At least one measurable objective is required.']
  },
  supportCommitments: {
    type: [commitmentSchema],
    validate: [items => Array.isArray(items) && items.length > 0, 'At least one organization support commitment is required.']
  },
  milestones: [milestoneSchema],
  reviewDates: [{ type: Date }],
  hrReview: {
    reviewerId: String,
    decision: { type: String, enum: ['approved', 'changes_requested'] },
    comment: { type: String, trim: true, maxlength: 4000 },
    decidedAt: Date
  },
  employeeResponse: {
    acknowledgement: { type: String, enum: ['acknowledged', 'acknowledged_with_comments'] },
    comment: { type: String, trim: true, maxlength: 4000 },
    respondedAt: Date
  },
  checkIns: [{
    authorId: { type: String, required: true },
    authorRole: { type: String, required: true },
    progress: { type: Number, min: 0, max: 100 },
    update: { type: String, required: true, trim: true, maxlength: 5000 },
    blockers: { type: String, trim: true, maxlength: 3000 },
    supportNeeded: { type: String, trim: true, maxlength: 3000 },
    createdAt: { type: Date, default: Date.now }
  }],
  outcome: {
    decision: { type: String, enum: ['completed', 'extended', 'escalated', 'cancelled'] },
    reason: { type: String, trim: true, maxlength: 5000 },
    decidedBy: String,
    decidedAt: Date,
    nextReviewDate: Date
  },
  aiAssistance: [{
    activity: String,
    status: { type: String, enum: ['suggested', 'accepted', 'rejected'], default: 'suggested' },
    evidenceSummary: String,
    output: mongoose.Schema.Types.Mixed,
    requestedBy: String,
    reviewedBy: String,
    reviewedAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  audit: [auditSchema]
}, { timestamps: true });

performanceSupportPlanSchema.index({ organizationId: 1, 'employee.userId': 1, state: 1, updatedAt: -1 });
performanceSupportPlanSchema.index({ organizationId: 1, 'manager.userId': 1, state: 1, updatedAt: -1 });

module.exports = mongoose.models.PerformanceSupportPlan
  || mongoose.model('PerformanceSupportPlan', performanceSupportPlanSchema);
