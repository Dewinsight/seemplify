import mongoose from 'mongoose'

const SubscriptionSchema = new mongoose.Schema({
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

  // Billing
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },
  priceAtPurchase: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'NGN',
    uppercase: true
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'suspended', 'pending_renewal'],
    default: 'active'
  },

  // Dates
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  gracePeriodEnd: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  suspendedAt: {
    type: Date
  },

  // Renewal
  autoRenew: {
    type: Boolean,
    default: false
  },
  renewalReminderSent: {
    type: Boolean,
    default: false
  },
  renewalReminder7DaysSent: {
    type: Boolean,
    default: false
  },
  renewalReminder3DaysSent: {
    type: Boolean,
    default: false
  },
  renewalReminder1DaySent: {
    type: Boolean,
    default: false
  },
  accessRemovalEmailSent: {
    type: Boolean,
    default: false
  },
  lastRenewalDate: {
    type: Date
  },

  // Limits Override (admin can customize per-org)
  customLimits: {
    maxMembers: { type: Number },
    maxTeams: { type: Number },
    maxStorage: { type: Number },
    maxSystemCourses: { type: Number }
  },

  // Features Override (admin can grant additional features)
  customFeatures: {
    recruiter: { type: Boolean },
    leaveManagement: { type: Boolean },
    payrollManagement: { type: Boolean },
    performanceManagement: { type: Boolean },
    timeAttendance: { type: Boolean },
    outlineDocs: { type: Boolean },
    aiChat: { type: Boolean },
    lms: { type: Boolean },
    workspace: { type: Boolean },
    experienceManagement: { type: Boolean },
    approver: { type: Boolean }
  },

  // Audit Trail
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  approvedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  },

  // History tracking
  previousSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },
  upgradeFromPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan'
  },
  downgradeFromPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan'
  },

  // Request reference
  originatingRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscriptionRequest'
  },

  // Cancellation info
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  }
}, {
  timestamps: true,
  collection: 'aiin_subscriptions'
})

// Indexes
SubscriptionSchema.index({ organization: 1, status: 1 })
SubscriptionSchema.index({ endDate: 1, status: 1 })
SubscriptionSchema.index({ status: 1 })
SubscriptionSchema.index({ gracePeriodEnd: 1 })
SubscriptionSchema.index({ plan: 1 })

// Virtual: isExpired
SubscriptionSchema.virtual('isExpired').get(function() {
  return this.endDate < new Date() && this.status !== 'cancelled'
})

// Virtual: isInGracePeriod
SubscriptionSchema.virtual('isInGracePeriod').get(function() {
  const now = new Date()
  return this.endDate < now && this.gracePeriodEnd && this.gracePeriodEnd > now
})

// Virtual: daysUntilExpiry
SubscriptionSchema.virtual('daysUntilExpiry').get(function() {
  const diff = this.endDate - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
})

// Virtual: isActive (considering grace period)
SubscriptionSchema.virtual('isActiveOrGrace').get(function() {
  if (this.status === 'active') return true
  if (this.status === 'expired' && this.isInGracePeriod) return true
  return false
})

// Virtual: Formatted price
SubscriptionSchema.virtual('formattedPrice').get(function() {
  const amount = this.priceAtPurchase / 100
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: this.currency
  }).format(amount)
})

// Method: Get effective features (plan + custom overrides)
SubscriptionSchema.methods.getEffectiveFeatures = async function() {
  await this.populate('plan')

  if (!this.plan) {
    return {
      recruiter: false,
      leaveManagement: false,
      payrollManagement: false,
      performanceManagement: false,
      timeAttendance: false,
      outlineDocs: false,
      aiChat: false,
      lms: false,
      workspace: false,
      experienceManagement: false,
      approver: false
    }
  }

  const planFeatures = this.plan.features.toObject()
  const customFeatures = this.customFeatures?.toObject() || {}

  // Custom features override plan features (only if explicitly set to true/false)
  return Object.keys(planFeatures).reduce((acc, key) => {
    acc[key] = customFeatures[key] !== undefined && customFeatures[key] !== null
      ? customFeatures[key]
      : planFeatures[key]
    return acc
  }, {})
}

// Method: Get effective limits
SubscriptionSchema.methods.getEffectiveLimits = async function() {
  await this.populate('plan')

  if (!this.plan) {
    return {
      maxMembers: 0,
      maxTeams: 0,
      maxStorage: 0,
      maxSystemCourses: null
    }
  }

  const planLimits = this.plan.limits.toObject()
  const customLimits = this.customLimits?.toObject() || {}
  const limitKeys = ['maxMembers', 'maxTeams', 'maxStorage', 'maxSystemCourses']

  return limitKeys.reduce((acc, key) => {
    const planValue = Object.prototype.hasOwnProperty.call(planLimits, key)
      ? planLimits[key]
      : null
    acc[key] = customLimits[key] !== undefined && customLimits[key] !== null
      ? customLimits[key]
      : planValue
    return acc
  }, {})
}

// Method: Check if org can access a specific app
SubscriptionSchema.methods.canAccessApp = async function(appKey) {
  if (this.status !== 'active') {
    return false
  }

  if (!this.endDate || this.endDate < new Date()) {
    return false
  }

  const features = await this.getEffectiveFeatures()
  return features[appKey] === true
}

// Method: Check if can add more members
SubscriptionSchema.methods.canAddMembers = async function(currentMemberCount) {
  const limits = await this.getEffectiveLimits()

  // null means unlimited
  if (limits.maxMembers === null) return true

  return currentMemberCount < limits.maxMembers
}

// Method: Extend subscription. An expired subscription is a renewal: give the
// organization the full extension from today and restore active access.
SubscriptionSchema.methods.extend = function(days) {
  const extensionDays = Number(days)
  if (!Number.isInteger(extensionDays) || extensionDays < 1) {
    throw new Error('Extension days must be a positive whole number')
  }
  if (this.status === 'cancelled') {
    throw new Error('Cancelled subscriptions cannot be extended')
  }

  const now = new Date()
  const currentEndDate = this.endDate instanceof Date ? this.endDate : new Date(this.endDate)
  const baseDate = Number.isFinite(currentEndDate.getTime()) && currentEndDate > now
    ? currentEndDate
    : now

  this.endDate = new Date(baseDate.getTime() + extensionDays * 24 * 60 * 60 * 1000)
  this.gracePeriodEnd = new Date(this.endDate.getTime() + 7 * 24 * 60 * 60 * 1000)
  this.lastRenewalDate = now
  this.accessRemovalEmailSent = false
  this.renewalReminderSent = false
  this.renewalReminder7DaysSent = false
  this.renewalReminder3DaysSent = false
  this.renewalReminder1DaySent = false

  if (this.status === 'expired' || this.status === 'pending_renewal') {
    this.status = 'active'
  }

  return this.save()
}

// Method: Expire subscription immediately and start grace period now
SubscriptionSchema.methods.expire = function(graceDays = 7) {
  const now = new Date()
  const safeGraceDays = Number.isFinite(Number(graceDays)) && Number(graceDays) >= 0
    ? Math.floor(Number(graceDays))
    : 7

  this.status = 'expired'
  this.endDate = now
  this.gracePeriodEnd = new Date(now.getTime() + safeGraceDays * 24 * 60 * 60 * 1000)
  this.accessRemovalEmailSent = false

  return this.save()
}

// Method: Cancel subscription
SubscriptionSchema.methods.cancel = function(reason, cancelledBy) {
  this.status = 'cancelled'
  this.cancelledAt = new Date()
  this.cancellationReason = reason
  this.cancelledBy = cancelledBy
  return this.save()
}

// Method: Suspend subscription
SubscriptionSchema.methods.suspend = function(reason) {
  this.status = 'suspended'
  this.suspendedAt = new Date()
  if (reason) this.notes = (this.notes ? this.notes + '\n' : '') + `Suspended: ${reason}`
  return this.save()
}

// Method: Reactivate subscription
SubscriptionSchema.methods.reactivate = function() {
  this.status = 'active'
  this.suspendedAt = null
  return this.save()
}

// Static: Find active subscription for organization
SubscriptionSchema.statics.findActiveForOrg = function(organizationId) {
  return this.findOne({
    organization: organizationId,
    status: { $in: ['active', 'expired'] }, // Include expired to check grace period
    $or: [
      { endDate: { $gte: new Date() } },
      { gracePeriodEnd: { $gte: new Date() } }
    ]
  }).populate('plan')
}

// Static: Find all subscriptions for organization
SubscriptionSchema.statics.findAllForOrg = function(organizationId) {
  return this.find({ organization: organizationId })
    .sort({ createdAt: -1 })
    .populate('plan')
}

// Static: Find expiring soon subscriptions
SubscriptionSchema.statics.findExpiringSoon = function(days = 7) {
  const now = new Date()
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  return this.find({
    status: 'active',
    endDate: { $gte: now, $lte: futureDate }
  }).populate(['plan', 'organization'])
}

// Static: Find expired subscriptions needing status update
SubscriptionSchema.statics.findExpiredNeedingUpdate = function() {
  return this.find({
    status: 'active',
    endDate: { $lt: new Date() }
  }).populate(['plan', 'organization'])
}

// Static: Find subscriptions past grace period (that haven't been notified yet)
SubscriptionSchema.statics.findPastGracePeriod = function() {
  return this.find({
    status: 'expired',
    gracePeriodEnd: { $lt: new Date() },
    accessRemovalEmailSent: false
  }).populate(['plan', 'organization'])
}

// Ensure virtuals are included in JSON
SubscriptionSchema.set('toJSON', { virtuals: true })
SubscriptionSchema.set('toObject', { virtuals: true })

const Subscription = mongoose.model('AiinSubscription', SubscriptionSchema)

export default Subscription
