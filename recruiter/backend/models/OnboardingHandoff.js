const mongoose = require('mongoose');

const OnboardingHandoffSchema = new mongoose.Schema({
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
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
    index: true
  },
  workflowItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingWorkflowItem'
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  target: {
    type: String,
    enum: ['internal_employee_profile', 'payroll', 'identity_provider', 'custom'],
    default: 'internal_employee_profile'
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  attempts: {
    type: Number,
    default: 0
  },
  lastError: {
    type: String,
    trim: true
  },
  completedAt: Date
}, { timestamps: true });

OnboardingHandoffSchema.index({ organization: 1, status: 1, updatedAt: -1 });
OnboardingHandoffSchema.index({ onboarding: 1, target: 1 }, { unique: true });

module.exports = mongoose.model('OnboardingHandoff', OnboardingHandoffSchema);
