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
  }]
}, { timestamps: true });

CandidateOnboardingSchema.index({ organization: 1, candidate: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('CandidateOnboarding', CandidateOnboardingSchema);
