const mongoose = require('mongoose');

const CustomFieldSchema = new mongoose.Schema({
  // Organization isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },

  // Field identity
  name: {
    type: String,
    required: [true, 'Field name is required'],
    trim: true,
    maxlength: [100, 'Field name cannot exceed 100 characters']
  },

  label: {
    type: String,
    required: [true, 'Field label is required'],
    trim: true,
    maxlength: [200, 'Field label cannot exceed 200 characters']
  },

  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Field description cannot exceed 500 characters']
  },

  // Field type and configuration
  type: {
    type: String,
    required: [true, 'Field type is required'],
    enum: ['text', 'textarea', 'rating', 'radio', 'checkbox', 'calculated'],
    default: 'text'
  },

  // Options for radio and checkbox fields
  options: [{
    label: {
      type: String,
      required: true,
      trim: true
    },
    value: {
      type: String,
      required: true,
      trim: true
    }
  }],

  // Validation rules
  validation: {
    required: {
      type: Boolean,
      default: false
    },
    minLength: {
      type: Number,
      min: 0
    },
    maxLength: {
      type: Number,
      min: 0
    },
    min: {
      type: Number // For rating fields
    },
    max: {
      type: Number // For rating fields
    },
    pattern: {
      type: String // Regex pattern for text validation
    },
    errorMessage: {
      type: String // Custom error message
    }
  },

  // Rating field configuration
  ratingConfig: {
    scale: {
      type: Number,
      enum: [3, 5, 10],
      default: 5
    },
    minLabel: {
      type: String,
      default: 'Poor'
    },
    maxLabel: {
      type: String,
      default: 'Excellent'
    },
    displayStyle: {
      type: String,
      enum: ['stars', 'numbers', 'slider'],
      default: 'stars'
    }
  },

  // Calculated field configuration
  calculationFormula: {
    type: String,
    trim: true
  },

  // Usage tracking
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  updatedBy: {
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
  },

  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },

  deletedAt: {
    type: Date
  },

  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Indexes
CustomFieldSchema.index({ organization: 1, name: 1 });
CustomFieldSchema.index({ organization: 1, isDeleted: 1 });
CustomFieldSchema.index({ type: 1 });

// Pre-save middleware to update timestamps
CustomFieldSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for checking if field can be deleted
CustomFieldSchema.virtual('canDelete').get(function() {
  return this.usageCount === 0;
});

// Method to increment usage count
CustomFieldSchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  return this.save();
};

// Method to decrement usage count
CustomFieldSchema.methods.decrementUsage = async function() {
  if (this.usageCount > 0) {
    this.usageCount -= 1;
    return this.save();
  }
};

// Method to validate formula for calculated fields
CustomFieldSchema.methods.validateFormula = function(availableFields) {
  if (this.type !== 'calculated' || !this.calculationFormula) {
    return { isValid: true };
  }

  const formula = this.calculationFormula;
  
  // Extract field references from formula (simple regex for field names)
  const fieldReferences = formula.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
  
  // Remove operators and numbers
  const operators = ['and', 'or', 'if', 'then', 'else'];
  const referencedFields = fieldReferences.filter(ref => 
    !operators.includes(ref.toLowerCase()) && isNaN(ref)
  );

  // Check if all referenced fields exist
  const invalidFields = referencedFields.filter(ref => 
    !availableFields.includes(ref)
  );

  if (invalidFields.length > 0) {
    return {
      isValid: false,
      error: `Formula references unknown fields: ${invalidFields.join(', ')}`
    };
  }

  // Basic syntax validation - check for balanced parentheses
  const openParens = (formula.match(/\(/g) || []).length;
  const closeParens = (formula.match(/\)/g) || []).length;
  
  if (openParens !== closeParens) {
    return {
      isValid: false,
      error: 'Formula has unbalanced parentheses'
    };
  }

  return { isValid: true };
};

// Static method to find fields by organization
CustomFieldSchema.statics.findByOrganization = function(organizationId, includeDeleted = false) {
  const query = { organization: organizationId };
  if (!includeDeleted) {
    query.isDeleted = false;
  }
  return this.find(query).sort({ name: 1 });
};

// Static method to find fields by type
CustomFieldSchema.statics.findByType = function(organizationId, type) {
  return this.find({
    organization: organizationId,
    type: type,
    isDeleted: false
  }).sort({ name: 1 });
};

CustomFieldSchema.set('toJSON', { virtuals: true });
CustomFieldSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('CustomField', CustomFieldSchema);

