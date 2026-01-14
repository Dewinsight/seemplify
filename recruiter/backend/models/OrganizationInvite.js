const mongoose = require('mongoose');

const OrganizationInviteSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'],
    default: 'recruiter'
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  acceptedAt: {
    type: Date
  },
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

// Indexes for better performance
OrganizationInviteSchema.index({ token: 1 });
OrganizationInviteSchema.index({ email: 1 });
OrganizationInviteSchema.index({ organization: 1 });
OrganizationInviteSchema.index({ expiresAt: 1 });
OrganizationInviteSchema.index({ status: 1 });
OrganizationInviteSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamp
OrganizationInviteSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual to check if invite is expired
OrganizationInviteSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

// Methods
OrganizationInviteSchema.methods.accept = function(userId) {
  this.status = 'accepted';
  this.acceptedAt = new Date();
  this.acceptedBy = userId;
  return this;
};

OrganizationInviteSchema.methods.reject = function(userId) {
  this.status = 'rejected';
  this.rejectedAt = new Date();
  this.rejectedBy = userId;
  return this;
};

OrganizationInviteSchema.methods.expire = function() {
  this.status = 'expired';
  return this;
};

OrganizationInviteSchema.methods.isValid = function() {
  return this.status === 'pending' && !this.isExpired;
};

// Static method to clean up expired invites
OrganizationInviteSchema.statics.cleanupExpiredInvites = async function() {
  const result = await this.updateMany(
    { 
      expiresAt: { $lt: new Date() }, 
      status: 'pending' 
    },
    { 
      status: 'expired' 
    }
  );
  
  return result.modifiedCount;
};

// Static method to get pending invites for an organization
OrganizationInviteSchema.statics.getPendingInvites = function(organizationId) {
  return this.find({
    organization: organizationId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('invitedBy', 'profile.firstName profile.lastName email');
};

// Ensure virtual fields are serialized
OrganizationInviteSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('OrganizationInvite', OrganizationInviteSchema); 