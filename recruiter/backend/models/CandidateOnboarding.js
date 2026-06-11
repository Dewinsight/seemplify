const mongoose = require('mongoose');

const CandidateOnboardingSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
    index: true
  },
  candidateAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateAccount',
    index: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  },
  processType: {
    type: String,
    enum: ['onboarding', 'exit', 'retirement'],
    default: 'onboarding',
    index: true
  },
  // Orthogonal to processType (the life-event axis). workflowType is the
  // content/purpose axis absorbed from the retired IdP onboarding feature.
  workflowType: {
    type: String,
    enum: ['onboarding', 'agreement', 'policy', 'general'],
    default: 'onboarding',
    index: true
  },
  // Denormalized from candidate.isInternalCandidate at start time so
  // dashboards/portal can branch copy/branding without a populate.
  audience: {
    type: String,
    enum: ['external', 'internal'],
    default: 'external',
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },
  title: {
    type: String,
    trim: true,
    default: 'Candidate onboarding'
  },
  notes: {
    type: String,
    trim: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingTemplate'
  },
  templateSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  progress: {
    totalItems: { type: Number, default: 0 },
    completedItems: { type: Number, default: 0 },
    percent: { type: Number, default: 0 }
  },
  dueAt: Date,
  startedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  cancelledAt: Date,
  inviteTokenHash: {
    type: String,
    select: false,
    index: true
  },
  inviteTokenExpiresAt: {
    type: Date,
    index: true
  },
  portalInviteUrl: String,
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocument'
  }],
  envelopes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingEnvelope'
  }],
  workflowItems: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingWorkflowItem'
  }],
  forms: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingFormSubmission'
  }],
  approvals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingApproval'
  }],
  handoffs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingHandoff'
  }],
  // Manual IdP provisioning: a recruiter invites this person into the IdP with a
  // role once onboarding is done (distinct from the automatic profile write-back).
  idpProvision: {
    status: { type: String, enum: ['invited', 'invite_pending', 'already_member'] },
    role: { type: String, trim: true },
    inviteId: { type: String, trim: true },
    memberId: { type: String, trim: true },
    provisionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    provisionedAt: { type: Date }
  }
}, { timestamps: true });

CandidateOnboardingSchema.index({ organization: 1, candidate: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, status: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, processType: 1, status: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, workflowType: 1, status: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, audience: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('CandidateOnboarding', CandidateOnboardingSchema);
