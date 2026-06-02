const mongoose = require('mongoose');

const OnboardingWorkflowItemSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  onboarding: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateOnboarding',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['document', 'form', 'task', 'approval', 'handoff'],
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['not_started', 'pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed'],
    default: 'pending',
    index: true
  },
  ownerType: {
    type: String,
    enum: ['candidate', 'user', 'system'],
    default: 'candidate',
    index: true
  },
  ownerUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  order: {
    type: Number,
    default: 0,
    index: true
  },
  dueAt: Date,
  sourceType: {
    type: String,
    enum: ['envelope', 'document', 'form_submission', 'approval', 'handoff', 'manual'],
    default: 'manual'
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId
  },
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingWorkflowItem'
  }],
  lastReminderAt: Date,
  completedAt: Date,
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

OnboardingWorkflowItemSchema.index({ organization: 1, status: 1, dueAt: 1 });
OnboardingWorkflowItemSchema.index({ onboarding: 1, order: 1 });

module.exports = mongoose.model('OnboardingWorkflowItem', OnboardingWorkflowItemSchema);
