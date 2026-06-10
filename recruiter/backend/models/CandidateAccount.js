const mongoose = require('mongoose');

const CandidateAccountSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    unique: true,
    index: true,
    match: [/\S+@\S+\.\S+/, 'Please use a valid email address.']
  },
  passwordHash: {
    type: String,
    select: false
  },
  profile: {
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    timezone: { type: String, default: 'UTC' }
  },
  linkedCandidates: [{
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true
    },
    linkedAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['invited', 'active', 'disabled'],
    default: 'invited',
    index: true
  },
  // Set when an internal employee is provisioned via IdP SSO (no password).
  idpAccountId: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  provisionedVia: {
    type: String,
    enum: ['invite', 'idp_sso'],
    default: 'invite'
  },
  lastLoginAt: Date,
  lastPasswordChangeAt: Date,
  refreshTokenVersion: {
    type: Number,
    default: 1
  }
}, { timestamps: true });

CandidateAccountSchema.virtual('fullName').get(function () {
  const firstName = this.profile?.firstName || '';
  const lastName = this.profile?.lastName || '';
  return `${firstName} ${lastName}`.trim() || this.email;
});

CandidateAccountSchema.methods.linkCandidate = function (candidateId, organizationId) {
  const alreadyLinked = this.linkedCandidates.some((link) =>
    link.candidate?.toString() === candidateId.toString() &&
    link.organization?.toString() === organizationId.toString()
  );

  if (!alreadyLinked) {
    this.linkedCandidates.push({
      candidate: candidateId,
      organization: organizationId
    });
  }

  return this;
};

CandidateAccountSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('CandidateAccount', CandidateAccountSchema);
