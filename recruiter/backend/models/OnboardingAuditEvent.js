const mongoose = require('mongoose');

const OnboardingAuditEventSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  onboarding: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateOnboarding',
    index: true
  },
  envelope: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingEnvelope',
    index: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocument'
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    index: true
  },
  actorType: {
    type: String,
    enum: ['user', 'candidate', 'system'],
    default: 'system'
  },
  actorUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  actorCandidateAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateAccount'
  },
  actorEmail: String,
  action: {
    type: String,
    required: true,
    index: true
  },
  ip: String,
  userAgent: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: { createdAt: true, updatedAt: false } });

OnboardingAuditEventSchema.index({ envelope: 1, createdAt: 1 });
OnboardingAuditEventSchema.index({ onboarding: 1, createdAt: 1 });
OnboardingAuditEventSchema.index({ organization: 1, createdAt: -1 });
OnboardingAuditEventSchema.index({ 'metadata.eventId': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('OnboardingAuditEvent', OnboardingAuditEventSchema);
