import mongoose from 'mongoose'

/**
 * LMS Access Request Schema
 * 
 * Handles requests from users who want access to LMS but don't have
 * admin privileges to self-assign roles. Admins review and approve/deny.
 */
const LmsAccessRequestSchema = new mongoose.Schema({
  // The user requesting access
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  
  // The organization context
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  
  // The role being requested - matches Frappe LMS roles
  requestedRole: {
    type: String,
    enum: [
      'student',           // LMS Student
      'course_creator',    // Course Creator
      'moderator',         // Moderator (full admin)
      'batch_evaluator',   // Batch Evaluator
      'course_evaluator'   // Course Evaluator
    ],
    required: true
  },
  
  // Request status
  status: {
    type: String,
    enum: ['pending', 'approved', 'denied'],
    default: 'pending',
    index: true
  },
  
  // Reason for the request (optional message from requester)
  requestReason: {
    type: String,
    maxlength: 500
  },
  
  // Admin who reviewed the request
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  
  // When it was reviewed
  reviewedAt: {
    type: Date
  },
  
  // Admin's notes on approval/denial
  reviewNotes: {
    type: String,
    maxlength: 500
  },
  
  // When the request was created
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // When the request expires (auto-deny after 30 days)
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}, {
  timestamps: true
})

// Compound index to prevent duplicate pending requests
LmsAccessRequestSchema.index(
  { requestedBy: 1, organization: 1, status: 1 },
  { 
    unique: true,
    partialFilterExpression: { status: 'pending' }
  }
)

// Index for admin queries
LmsAccessRequestSchema.index({ organization: 1, status: 1, createdAt: -1 })

/**
 * Create a new access request
 */
LmsAccessRequestSchema.statics.createRequest = async function(accountId, organizationId, role, reason = '') {
  // Check for existing pending request
  const existing = await this.findOne({
    requestedBy: accountId,
    organization: organizationId,
    status: 'pending'
  })
  
  if (existing) {
    throw new Error('You already have a pending access request for this organization')
  }
  
  return this.create({
    requestedBy: accountId,
    organization: organizationId,
    requestedRole: role,
    requestReason: reason
  })
}

/**
 * Get pending requests for an organization
 */
LmsAccessRequestSchema.statics.getPendingRequests = async function(organizationId) {
  return this.find({
    organization: organizationId,
    status: 'pending'
  })
  .populate('requestedBy', 'email profile.name')
  .sort({ createdAt: -1 })
}

/**
 * Approve a request
 */
LmsAccessRequestSchema.statics.approveRequest = async function(requestId, reviewerId, notes = '') {
  const request = await this.findById(requestId)
  
  if (!request) {
    throw new Error('Request not found')
  }
  
  if (request.status !== 'pending') {
    throw new Error('Request has already been processed')
  }
  
  request.status = 'approved'
  request.reviewedBy = reviewerId
  request.reviewedAt = new Date()
  request.reviewNotes = notes
  
  await request.save()
  
  // Import LmsRole and assign the role
  const { LmsRole } = await import('./LmsRole.js')
  await LmsRole.assignRole(
    request.requestedBy,
    request.organization,
    request.requestedRole,
    reviewerId
  )
  
  return request
}

/**
 * Deny a request
 */
LmsAccessRequestSchema.statics.denyRequest = async function(requestId, reviewerId, notes = '') {
  const request = await this.findById(requestId)
  
  if (!request) {
    throw new Error('Request not found')
  }
  
  if (request.status !== 'pending') {
    throw new Error('Request has already been processed')
  }
  
  request.status = 'denied'
  request.reviewedBy = reviewerId
  request.reviewedAt = new Date()
  request.reviewNotes = notes
  
  return request.save()
}

/**
 * Get request history for a user
 */
LmsAccessRequestSchema.statics.getUserRequests = async function(accountId) {
  return this.find({ requestedBy: accountId })
    .populate('organization', 'name')
    .sort({ createdAt: -1 })
}

/**
 * Clean up expired requests
 */
LmsAccessRequestSchema.statics.cleanupExpired = async function() {
  return this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: new Date() }
    },
    {
      status: 'denied',
      reviewNotes: 'Auto-denied: Request expired after 30 days'
    }
  )
}

export const LmsAccessRequest = mongoose.model('LmsAccessRequest', LmsAccessRequestSchema)
