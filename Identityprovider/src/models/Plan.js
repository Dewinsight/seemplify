import mongoose from 'mongoose'

const PlanSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },

  // Pricing (in smallest currency unit - kobo for NGN, cents for USD)
  pricing: {
    monthly: { type: Number, default: 0 },
    yearly: { type: Number, default: 0 },
    yearlyDiscount: { type: Number, default: 0 }, // Percentage discount for yearly
    currency: { type: String, default: 'NGN', uppercase: true }
  },

  // Limits
  limits: {
    maxMembers: { type: Number, default: null }, // null = unlimited
    maxTeams: { type: Number, default: null },   // null = unlimited
    maxStorage: { type: Number, default: null }  // In GB, null = unlimited
  },

  // App Access Toggles
  features: {
    recruiter: { type: Boolean, default: false },
    leaveManagement: { type: Boolean, default: false },
    payrollManagement: { type: Boolean, default: false },
    performanceManagement: { type: Boolean, default: false },
    outlineDocs: { type: Boolean, default: false },
    aiChat: { type: Boolean, default: false },
    lms: { type: Boolean, default: false }
  },

  // Additional Feature Flags (for extensibility)
  additionalFeatures: [{
    key: { type: String, required: true },
    value: mongoose.Schema.Types.Mixed,
    description: String
  }],

  // Plan Status
  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true }, // Visible to organizations
  isFeatured: { type: Boolean, default: false }, // Highlight in UI
  isTrial: { type: Boolean, default: false }, // Trial plan flag
  trialDays: { type: Number, default: 14 }, // Trial period in days

  // Display
  displayOrder: { type: Number, default: 0 },
  badgeText: { type: String, trim: true }, // e.g., "Most Popular", "Best Value"
  color: { type: String, default: '#3b82f6' }, // Brand color for plan

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' }
}, {
  timestamps: true,
  collection: 'aiin_plans'
})

// Indexes
PlanSchema.index({ slug: 1 })
PlanSchema.index({ isActive: 1, isPublic: 1 })
PlanSchema.index({ displayOrder: 1 })
PlanSchema.index({ 'pricing.monthly': 1 })

// Pre-save: Generate slug from name if not provided
PlanSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
  next()
})

// Virtual: Get formatted monthly price
PlanSchema.virtual('formattedMonthlyPrice').get(function() {
  if (this.pricing.monthly === 0) return 'Free'
  const amount = this.pricing.monthly / 100
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: this.pricing.currency
  }).format(amount)
})

// Virtual: Get formatted yearly price
PlanSchema.virtual('formattedYearlyPrice').get(function() {
  if (this.pricing.yearly === 0) return 'Free'
  const amount = this.pricing.yearly / 100
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: this.pricing.currency
  }).format(amount)
})

// Virtual: Get feature list as array
PlanSchema.virtual('featureList').get(function() {
  const featureNames = {
    recruiter: 'Recruiter (SmartHR)',
    leaveManagement: 'Leave Management',
    payrollManagement: 'Payroll Management',
    performanceManagement: 'Performance Management',
    outlineDocs: 'Outline Docs',
    aiChat: 'AI Chat Assistant',
    lms: 'Learning Management System'
  }

  return Object.entries(this.features.toObject())
    .filter(([, enabled]) => enabled)
    .map(([key]) => featureNames[key] || key)
})

// Method: Check if plan has specific feature
PlanSchema.methods.hasFeature = function(featureKey) {
  return this.features[featureKey] === true
}

// Method: Get price for billing cycle
PlanSchema.methods.getPriceForCycle = function(cycle) {
  return cycle === 'yearly' ? this.pricing.yearly : this.pricing.monthly
}

// Static: Find active public plans
PlanSchema.statics.findPublicPlans = function() {
  return this.find({ isActive: true, isPublic: true })
    .sort({ displayOrder: 1 })
}

// Static: Find by slug
PlanSchema.statics.findBySlug = function(slug) {
  return this.findOne({ slug: slug.toLowerCase() })
}

// Ensure virtuals are included in JSON
PlanSchema.set('toJSON', { virtuals: true })
PlanSchema.set('toObject', { virtuals: true })

const Plan = mongoose.model('AiinPlan', PlanSchema)

export default Plan
