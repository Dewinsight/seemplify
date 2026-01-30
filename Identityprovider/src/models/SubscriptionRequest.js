import mongoose from 'mongoose'

const SubscriptionRequestSchema = new mongoose.Schema({
  // References
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan',
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },

  // Billing
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },

  // Request Type
  requestType: {
    type: String,
    enum: ['new', 'upgrade', 'downgrade', 'renewal'],
    default: 'new'
  },

  // Current subscription (for upgrades/downgrades/renewals)
  currentSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },

  // Contact Information (required for all requests)
  contactInfo: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    alternatePhone: {
      type: String,
      trim: true
    }
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'expired'],
    default: 'pending'
  },

  // Request Details
  message: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Admin Processing
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  processedAt: {
    type: Date
  },
  adminNotes: {
    type: String,
    trim: true
  },
  rejectionReason: {
    type: String,
    trim: true
  },

  // Created Subscription (set after approval)
  createdSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },

  // Price at time of request (for record keeping)
  priceAtRequest: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'NGN',
    uppercase: true
  },

  // Expiry (requests expire after a certain time if not processed)
  expiresAt: {
    type: Date
  },

  // Email tracking
  adminNotificationSent: {
    type: Boolean,
    default: false
  },
  adminNotificationSentAt: {
    type: Date
  },
  userNotificationSent: {
    type: Boolean,
    default: false
  },
  userNotificationSentAt: {
    type: Date
  }
}, {
  timestamps: true,
  collection: 'aiin_subscription_requests'
})

// Indexes
SubscriptionRequestSchema.index({ organization: 1, status: 1 })
SubscriptionRequestSchema.index({ status: 1, createdAt: -1 })
SubscriptionRequestSchema.index({ requestedBy: 1 })
SubscriptionRequestSchema.index({ plan: 1 })
SubscriptionRequestSchema.index({ expiresAt: 1 })
SubscriptionRequestSchema.index({ processedBy: 1 })

// Pre-save: Set expiry date if not set (30 days from creation)
SubscriptionRequestSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
  next()
})

// Virtual: isExpired
SubscriptionRequestSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date() && this.status === 'pending'
})

// Virtual: isPending
SubscriptionRequestSchema.virtual('isPending').get(function() {
  return this.status === 'pending' && !this.isExpired
})

// Virtual: daysUntilExpiry
SubscriptionRequestSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.expiresAt) return null
  const diff = this.expiresAt - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
})

// Virtual: Formatted price
SubscriptionRequestSchema.virtual('formattedPrice').get(function() {
  const amount = this.priceAtRequest / 100
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: this.currency
  }).format(amount)
})

// Virtual: Request type display name
SubscriptionRequestSchema.virtual('requestTypeDisplay').get(function() {
  const types = {
    new: 'New Subscription',
    upgrade: 'Plan Upgrade',
    downgrade: 'Plan Downgrade',
    renewal: 'Subscription Renewal'
  }
  return types[this.requestType] || this.requestType
})

// Virtual: Status display with color
SubscriptionRequestSchema.virtual('statusInfo').get(function() {
  const info = {
    pending: { label: 'Pending Review', color: 'yellow', icon: 'clock' },
    approved: { label: 'Approved', color: 'green', icon: 'check' },
    rejected: { label: 'Rejected', color: 'red', icon: 'x' },
    cancelled: { label: 'Cancelled', color: 'gray', icon: 'ban' },
    expired: { label: 'Expired', color: 'gray', icon: 'clock' }
  }

  // Override with expired status if applicable
  if (this.isExpired) {
    return info.expired
  }

  return info[this.status] || { label: this.status, color: 'gray', icon: 'question' }
})

// Method: Approve request
SubscriptionRequestSchema.methods.approve = async function(adminId, notes, subscriptionId) {
  this.status = 'approved'
  this.processedBy = adminId
  this.processedAt = new Date()
  this.adminNotes = notes
  this.createdSubscription = subscriptionId
  return this.save()
}

// Method: Reject request
SubscriptionRequestSchema.methods.reject = async function(adminId, reason, notes) {
  this.status = 'rejected'
  this.processedBy = adminId
  this.processedAt = new Date()
  this.rejectionReason = reason
  this.adminNotes = notes
  return this.save()
}

// Method: Cancel request (by user)
SubscriptionRequestSchema.methods.cancel = async function() {
  if (this.status !== 'pending') {
    throw new Error('Can only cancel pending requests')
  }
  this.status = 'cancelled'
  return this.save()
}

// Method: Mark as expired
SubscriptionRequestSchema.methods.markExpired = async function() {
  this.status = 'expired'
  return this.save()
}

// Method: Mark admin notification sent
SubscriptionRequestSchema.methods.markAdminNotified = async function() {
  this.adminNotificationSent = true
  this.adminNotificationSentAt = new Date()
  return this.save()
}

// Method: Mark user notification sent
SubscriptionRequestSchema.methods.markUserNotified = async function() {
  this.userNotificationSent = true
  this.userNotificationSentAt = new Date()
  return this.save()
}

// Static: Find pending requests
SubscriptionRequestSchema.statics.findPending = function() {
  return this.find({
    status: 'pending',
    $or: [
      { expiresAt: { $gte: new Date() } },
      { expiresAt: null }
    ]
  })
    .sort({ createdAt: -1 })
    .populate(['organization', 'plan', 'requestedBy'])
}

// Static: Find pending requests for organization
SubscriptionRequestSchema.statics.findPendingForOrg = function(organizationId) {
  return this.find({
    organization: organizationId,
    status: 'pending',
    $or: [
      { expiresAt: { $gte: new Date() } },
      { expiresAt: null }
    ]
  })
    .sort({ createdAt: -1 })
    .populate('plan')
}

// Static: Find all requests for organization
SubscriptionRequestSchema.statics.findAllForOrg = function(organizationId) {
  return this.find({ organization: organizationId })
    .sort({ createdAt: -1 })
    .populate(['plan', 'processedBy', 'createdSubscription'])
}

// Static: Find expired pending requests
SubscriptionRequestSchema.statics.findExpiredPending = function() {
  return this.find({
    status: 'pending',
    expiresAt: { $lt: new Date() }
  }).populate(['organization', 'plan', 'requestedBy'])
}

// Static: Find requests by status
SubscriptionRequestSchema.statics.findByStatus = function(status) {
  return this.find({ status })
    .sort({ createdAt: -1 })
    .populate(['organization', 'plan', 'requestedBy'])
}

// Static: Count pending requests
SubscriptionRequestSchema.statics.countPending = function() {
  return this.countDocuments({
    status: 'pending',
    $or: [
      { expiresAt: { $gte: new Date() } },
      { expiresAt: null }
    ]
  })
}

// Static: Find requests needing admin notification
SubscriptionRequestSchema.statics.findNeedingAdminNotification = function() {
  return this.find({
    status: 'pending',
    adminNotificationSent: false
  }).populate(['organization', 'plan', 'requestedBy'])
}

// Static: Get request statistics
SubscriptionRequestSchema.statics.getStats = async function() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [total, pending, approved, rejected, recentRequests] = await Promise.all([
    this.countDocuments(),
    this.countDocuments({
      status: 'pending',
      $or: [
        { expiresAt: { $gte: now } },
        { expiresAt: null }
      ]
    }),
    this.countDocuments({ status: 'approved' }),
    this.countDocuments({ status: 'rejected' }),
    this.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
  ])

  return {
    total,
    pending,
    approved,
    rejected,
    cancelled: total - pending - approved - rejected,
    recentRequests,
    approvalRate: total > 0 ? ((approved / total) * 100).toFixed(1) : 0
  }
}

// Ensure virtuals are included in JSON
SubscriptionRequestSchema.set('toJSON', { virtuals: true })
SubscriptionRequestSchema.set('toObject', { virtuals: true })

const SubscriptionRequest = mongoose.model('AiinSubscriptionRequest', SubscriptionRequestSchema)

export default SubscriptionRequest
