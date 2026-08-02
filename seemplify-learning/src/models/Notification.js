import mongoose from 'mongoose'

const NotificationSchema = new mongoose.Schema({
  // Organization context
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: false,
    default: null,
    index: true
  },

  // Who sent the notification
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },

  // Target type and ID
  targetType: {
    type: String,
    enum: ['organization', 'team', 'member'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  // Email content
  subject: {
    type: String,
    required: true,
    maxLength: 200
  },
  htmlContent: {
    type: String,
    required: true,
    maxLength: 50000 // ~50KB limit
  },
  textContent: {
    type: String,
    maxLength: 10000
  },

  // Delivery tracking
  status: {
    type: String,
    enum: ['pending', 'sending', 'completed', 'partial', 'failed'],
    default: 'pending'
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  sentCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },

  // Per-recipient tracking (for audit/retry)
  recipients: [{
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount'
    },
    email: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },
    sentAt: Date,
    error: String
  }],

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date
})

// Indexes for efficient queries
NotificationSchema.index({ organization: 1, createdAt: -1 })
NotificationSchema.index({ sentBy: 1, createdAt: -1 })
NotificationSchema.index({ status: 1 })
NotificationSchema.index({ createdAt: -1 })

// TTL index to auto-delete old notifications after 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

// Static method to get notifications for an organization
NotificationSchema.statics.findByOrganization = function(organizationId, options = {}) {
  const { page = 1, limit = 20, status } = options
  const skip = (page - 1) * limit

  const query = { organization: organizationId }
  if (status) {
    query.status = status
  }

  return this.find(query)
    .populate('sentBy', 'email profile.name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
}

// Static method to count notifications for pagination
NotificationSchema.statics.countByOrganization = function(organizationId, status) {
  const query = { organization: organizationId }
  if (status) {
    query.status = status
  }
  return this.countDocuments(query)
}

// Ensure virtual fields are serialized
NotificationSchema.set('toJSON', { virtuals: true })

export const Notification = mongoose.model('AiinNotification', NotificationSchema)
