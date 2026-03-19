import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import crypto from 'crypto'

const OrganizationInviteSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  role: {
    type: String,
    enum: ['admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'],
    default: 'recruiter'
  },
  designation: {
    type: String,
    required: true,
    trim: true,
    maxLength: 120
  },
  employeeId: {
    type: String,
    trim: true,
    maxLength: 80
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinTeam',
    default: null
  },
  appAccess: {
    mode: {
      type: String,
      enum: ['all', 'selected'],
      default: 'all'
    },
    appIds: {
      type: [String],
      default: []
    }
  },
  // CRITICAL: Store HASHED token, not plain token
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending',
    index: true
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
    ref: 'AiinAccount'
  },
  // Track email used for acceptance (security audit)
  acceptedWithEmail: {
    type: String
  },
  rejectedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
})

// Compound indexes for efficient queries
OrganizationInviteSchema.index({ organization: 1, status: 1 })
OrganizationInviteSchema.index({ email: 1, organization: 1 })
OrganizationInviteSchema.index({ createdAt: -1 })
// TTL index: keep invites for 30 days after expiration for auditability
OrganizationInviteSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 }
)

// Pre-save middleware to update timestamp
OrganizationInviteSchema.pre('save', function(next) {
  this.updatedAt = Date.now()
  next()
})

// Generate secure token and hash it
// Returns { plainToken, tokenHash }
OrganizationInviteSchema.statics.generateToken = async function() {
  // Generate 32-byte cryptographically secure random token
  const plainToken = crypto.randomBytes(32).toString('hex')

  // Hash token with bcrypt (10 rounds)
  const tokenHash = await bcrypt.hash(plainToken, 10)

  return { plainToken, tokenHash }
}

// Verify token
OrganizationInviteSchema.methods.verifyToken = async function(plainToken) {
  return await bcrypt.compare(plainToken, this.tokenHash)
}

// Check if invitation is valid
OrganizationInviteSchema.methods.isValid = function() {
  return this.status === 'pending' && this.expiresAt > new Date()
}

// Virtual to check if invite is expired
OrganizationInviteSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date()
})

// Accept invitation with email verification
// CRITICAL: Verify email matches invitation
OrganizationInviteSchema.methods.accept = async function(accountId, userEmail) {
  // CRITICAL: Verify email matches invitation
  if (this.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error('Email mismatch: invitation was sent to different email')
  }

  // Verify account email matches
  const Account = mongoose.model('AiinAccount')
  const account = await Account.findById(accountId)
  if (!account || account.email.toLowerCase() !== this.email.toLowerCase()) {
    throw new Error('Account email does not match invitation email')
  }

  if (this.status !== 'pending') {
    throw new Error('Invitation already processed')
  }

  if (this.expiresAt < new Date()) {
    this.status = 'expired'
    await this.save()
    throw new Error('Invitation has expired')
  }

  this.status = 'accepted'
  this.acceptedAt = new Date()
  this.acceptedBy = accountId
  this.acceptedWithEmail = userEmail // Audit trail

  await this.save()
  return this
}

// Reject invitation
OrganizationInviteSchema.methods.reject = async function(accountId, userEmail) {
  // Verify email matches
  if (this.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error('Email mismatch')
  }

  if (this.status !== 'pending') {
    throw new Error('Invitation already processed')
  }

  this.status = 'rejected'
  this.rejectedAt = new Date()
  this.rejectedBy = accountId

  await this.save()
  return this
}

// Mark as expired
OrganizationInviteSchema.methods.expire = function() {
  this.status = 'expired'
  return this
}

// Cleanup expired invites (scheduled job)
OrganizationInviteSchema.statics.cleanupExpiredInvites = async function() {
  const result = await this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: new Date() }
    },
    {
      $set: { status: 'expired' }
    }
  )
  return result
}

// Static method to get pending invites for an organization
OrganizationInviteSchema.statics.getPendingInvites = function(organizationId) {
  return this.find({
    organization: organizationId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('invitedBy', 'email profile.name')
}

// Static method to check for existing pending invite
OrganizationInviteSchema.statics.hasPendingInvite = async function(organizationId, email) {
  const existing = await this.findOne({
    organization: organizationId,
    email: email.toLowerCase(),
    status: 'pending',
    expiresAt: { $gt: new Date() }
  })
  return !!existing
}

// Static method to find invitation by token (requires verification)
// Note: This method finds potential matches, caller must verify token
OrganizationInviteSchema.statics.findPendingInvites = function(email) {
  return this.find({
    email: email.toLowerCase(),
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('organization', 'name')
}

// Ensure virtual fields are serialized
OrganizationInviteSchema.set('toJSON', { virtuals: true })

export const OrganizationInvite = mongoose.model('AiinOrganizationInvite', OrganizationInviteSchema)
