const mongoose = require('mongoose');

const OnboardingApprovalSchema = new mongoose.Schema({
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
    index: true
  },
  formSubmission: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingFormSubmission',
    index: true
  },
  workflowItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingWorkflowItem'
  },
  type: {
    type: String,
    enum: ['sensitive_data', 'exception', 'completion'],
    default: 'sensitive_data',
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  requestedBy: {
    type: String,
    enum: ['candidate', 'user', 'system'],
    default: 'system'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  notes: {
    type: String,
    trim: true
  }
}, { timestamps: true });

OnboardingApprovalSchema.index({ organization: 1, status: 1, createdAt: -1 });
OnboardingApprovalSchema.index({ onboarding: 1, status: 1 });

module.exports = mongoose.model('OnboardingApproval', OnboardingApprovalSchema);
