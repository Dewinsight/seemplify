const mongoose = require('mongoose');

const CurrencySchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Currency code is required'],
    uppercase: true,
    trim: true,
    minlength: [3, 'Currency code must be exactly 3 characters'],
    maxlength: [3, 'Currency code must be exactly 3 characters'],
    match: [/^[A-Z]{3}$/, 'Currency code must be 3 uppercase letters (ISO 4217)']
  },
  symbol: {
    type: String,
    required: [true, 'Currency symbol is required'],
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Currency name is required'],
    trim: true
  },
  locale: {
    type: String,
    trim: true,
    default: 'en-US'
  },
  isSystem: {
    type: Boolean,
    default: false,
    index: true
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null, // null means system currency
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound unique index: code must be unique per organization
// System currencies (organization: null) have unique codes globally
CurrencySchema.index({ code: 1, organization: 1 }, { unique: true });

// Pre-save middleware to update timestamp
CurrencySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to get all available currencies for an organization
CurrencySchema.statics.getAvailableForOrganization = async function(organizationId) {
  // Return system currencies + organization-specific currencies
  return this.find({
    $or: [
      { isSystem: true, organization: null }, // System currencies
      { organization: organizationId } // Organization-specific currencies
    ]
  }).sort({ isSystem: -1, name: 1 }); // System currencies first, then alphabetical
};

// Static method to check if currency is in use
CurrencySchema.statics.getUsageCount = async function(currencyCode, organizationId) {
  const Job = mongoose.model('Job');
  
  const query = {
    'salary.currency': currencyCode
  };
  
  if (organizationId) {
    query.organization = organizationId;
  }
  
  const activeCount = await Job.countDocuments({ ...query, status: { $in: ['draft', 'active', 'paused'] } });
  const archivedCount = await Job.countDocuments({ ...query, status: { $in: ['closed', 'archived'] } });
  
  return {
    active: activeCount,
    archived: archivedCount,
    total: activeCount + archivedCount
  };
};

// Instance method to check if can be deleted
CurrencySchema.methods.canBeDeleted = async function() {
  if (this.isSystem) {
    return { canDelete: false, reason: 'System currencies cannot be deleted' };
  }
  
  const usage = await this.constructor.getUsageCount(this.code, this.organization);
  
  if (usage.active > 0) {
    return { 
      canDelete: false, 
      reason: `Currency is currently used in ${usage.active} active job(s)`,
      usage 
    };
  }
  
  return { canDelete: true, usage };
};

// Ensure virtual fields are serialized
CurrencySchema.set('toJSON', { virtuals: true });
CurrencySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Currency', CurrencySchema);
