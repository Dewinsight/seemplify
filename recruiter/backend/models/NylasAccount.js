const mongoose = require('mongoose');
const configLoader = require('../config/configLoader');

/**
 * NylasAccount Model
 * Stores multiple Nylas accounts for grant pooling (system-wide, not per-org)
 */
const nylasAccountSchema = new mongoose.Schema({
  // Account identification
  name: {
    type: String,
    required: true,
    trim: true,
    // e.g., "Production US", "Sandbox Europe"
  },
  
  // Nylas credentials
  clientId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  apiKey: {
    type: String,
    required: true,
    select: false // Don't return in queries by default (security)
  },
  clientSecret: {
    type: String,
    required: true,
    select: false
  },
  region: {
    type: String,
    enum: ['us', 'eu', 'au'],
    default: 'us'
  },
  apiUri: {
    type: String,
    default: function() {
      return `https://api.${this.region}.nylas.com`;
    }
  },
  redirectUri: {
    type: String,
    select: false, // Don't return by default - this field is deprecated
    // DEPRECATED: This field is no longer used in the OAuth flow
    // The configLoader dynamically provides the correct callback URL based on NODE_ENV
    // Keeping field for backward compatibility with existing database records
    default: function() {
      return configLoader.getCallbackUrl();
    }
  },
  
  // Grant limits
  maxGrants: {
    type: Number,
    default: 5,
    min: 1,
    max: 100,
    required: true
  },
  
  // Current usage (denormalized for performance)
  currentGrantCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Account status
  active: {
    type: Boolean,
    default: true,
    index: true
  },
  verified: {
    type: Boolean,
    default: false
    // Set to true after successful API test
  },
  isDefault: {
    type: Boolean,
    default: false
    // Mark the account migrated from .env
  },
  
  // Priority for allocation (higher = preferred)
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Metadata
  accountType: {
    type: String,
    enum: ['production', 'sandbox'],
    default: 'sandbox'
  },
  notes: {
    type: String,
    trim: true
  },
  
  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  lastUsed: Date,
  lastVerified: Date,
  lastError: String
}, {
  timestamps: true
});

// Indexes for efficient queries
nylasAccountSchema.index({ active: 1, priority: -1, createdAt: 1 });
nylasAccountSchema.index({ verified: 1, active: 1 });

// Virtual for utilization percentage
nylasAccountSchema.virtual('utilizationPercentage').get(function() {
  if (this.maxGrants === 0) return 0;
  return Math.round((this.currentGrantCount / this.maxGrants) * 100);
});

// Instance method to check if account has space
nylasAccountSchema.methods.hasAvailableSlots = function() {
  return this.currentGrantCount < this.maxGrants;
};

// Instance method to get available slots
nylasAccountSchema.methods.getAvailableSlots = function() {
  return Math.max(0, this.maxGrants - this.currentGrantCount);
};

// Static method to find account with space
nylasAccountSchema.statics.findAvailableAccount = async function() {
  const accounts = await this.find({
    active: true,
    verified: true
  })
  .select('+apiKey +clientSecret')
  .sort({ priority: -1, createdAt: 1 });
  
  for (const account of accounts) {
    if (account.hasAvailableSlots()) {
      return account;
    }
  }
  
  return null;
};

// Static method to get total system capacity
nylasAccountSchema.statics.getSystemCapacity = async function() {
  const accounts = await this.find({ active: true });
  
  const totalMax = accounts.reduce((sum, acc) => sum + acc.maxGrants, 0);
  const totalUsed = accounts.reduce((sum, acc) => sum + acc.currentGrantCount, 0);
  
  return {
    totalMax,
    totalUsed,
    availableSlots: totalMax - totalUsed,
    accountCount: accounts.length,
    utilizationPercentage: totalMax > 0 ? Math.round((totalUsed / totalMax) * 100) : 0
  };
};

module.exports = mongoose.model('NylasAccount', nylasAccountSchema);
