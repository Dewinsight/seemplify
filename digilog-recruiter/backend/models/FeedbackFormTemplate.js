const mongoose = require('mongoose');

const FieldConfigSchema = new mongoose.Schema({
  fieldId: {
    type: String,
    required: true
  },
  fieldType: {
    type: String,
    enum: ['system', 'custom'],
    required: true
  },
  customFieldRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomField'
  },
  isVisible: {
    type: Boolean,
    default: true
  },
  isRequired: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    required: true
  },
  label: {
    type: String, // Optional label override
    trim: true
  }
}, { _id: false });

const FeedbackFormTemplateSchema = new mongoose.Schema({
  // Organization isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },

  // Template identity
  name: {
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    maxlength: [100, 'Template name cannot exceed 100 characters']
  },

  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Template description cannot exceed 500 characters']
  },

  // Default template flag
  isDefault: {
    type: Boolean,
    default: false
  },

  // System fields configuration
  // System field IDs: name, email, generalFeedback, overallRating, technicalRating, communicationRating, culturalRating
  systemFields: [FieldConfigSchema],

  // Custom fields configuration
  customFields: [FieldConfigSchema],

  // Usage tracking
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Jobs using this template
  jobsUsing: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  }],

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
FeedbackFormTemplateSchema.index({ organization: 1, isDefault: 1 });
FeedbackFormTemplateSchema.index({ organization: 1, isDeleted: 1 });
FeedbackFormTemplateSchema.index({ organization: 1, name: 1 });

// Pre-save middleware
FeedbackFormTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Ensure only one default template per organization
FeedbackFormTemplateSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Unset other default templates for this organization
    await this.constructor.updateMany(
      {
        organization: this.organization,
        isDefault: true,
        _id: { $ne: this._id }
      },
      { $set: { isDefault: false } }
    );
  }
  next();
});

// Virtual for checking if template can be deleted
FeedbackFormTemplateSchema.virtual('canDelete').get(function() {
  return !this.isDefault && this.usageCount === 0;
});

// Method to get complete field configuration (with populated custom fields)
FeedbackFormTemplateSchema.methods.getCompleteConfig = async function() {
  await this.populate('customFields.customFieldRef');
  
  // Sort all fields by order
  const allFields = [
    ...this.systemFields.map(f => ({ ...f.toObject(), source: 'system' })),
    ...this.customFields.map(f => ({ ...f.toObject(), source: 'custom' }))
  ].sort((a, b) => a.order - b.order);

  return {
    _id: this._id,
    name: this.name,
    description: this.description,
    fields: allFields,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Method to increment usage count
FeedbackFormTemplateSchema.methods.incrementUsage = async function(jobId) {
  this.usageCount += 1;
  if (!this.jobsUsing.includes(jobId)) {
    this.jobsUsing.push(jobId);
  }
  return this.save();
};

// Method to decrement usage count
FeedbackFormTemplateSchema.methods.decrementUsage = async function(jobId) {
  if (this.usageCount > 0) {
    this.usageCount -= 1;
  }
  this.jobsUsing = this.jobsUsing.filter(id => !id.equals(jobId));
  return this.save();
};

// Method to duplicate template
FeedbackFormTemplateSchema.methods.duplicate = async function(userId, newName) {
  const duplicate = new this.constructor({
    organization: this.organization,
    name: newName || `${this.name} (Copy)`,
    description: this.description,
    isDefault: false,
    systemFields: this.systemFields.map(f => ({ ...f.toObject() })),
    customFields: this.customFields.map(f => ({ ...f.toObject() })),
    createdBy: userId
  });
  
  return duplicate.save();
};

// Static method to get default template for organization
FeedbackFormTemplateSchema.statics.getDefault = function(organizationId) {
  return this.findOne({
    organization: organizationId,
    isDefault: true,
    isDeleted: false
  });
};

// Static method to create default template for organization
FeedbackFormTemplateSchema.statics.createDefault = async function(organizationId, userId) {
  // Check if default already exists
  const existing = await this.getDefault(organizationId);
  if (existing) {
    return existing;
  }

  // Create default template with all system fields visible and required
  const systemFields = [
    { fieldId: 'name', fieldType: 'system', isVisible: true, isRequired: true, order: 1, label: 'Your Name' },
    { fieldId: 'email', fieldType: 'system', isVisible: true, isRequired: true, order: 2, label: 'Your Email' },
    { fieldId: 'overallRating', fieldType: 'system', isVisible: true, isRequired: true, order: 3, label: 'Overall Rating' },
    { fieldId: 'technicalRating', fieldType: 'system', isVisible: true, isRequired: true, order: 4, label: 'Technical Skills' },
    { fieldId: 'communicationRating', fieldType: 'system', isVisible: true, isRequired: true, order: 5, label: 'Communication Skills' },
    { fieldId: 'culturalRating', fieldType: 'system', isVisible: true, isRequired: true, order: 6, label: 'Cultural Fit' },
    { fieldId: 'generalFeedback', fieldType: 'system', isVisible: true, isRequired: true, order: 7, label: 'General Feedback' }
  ];

  const defaultTemplate = new this({
    organization: organizationId,
    name: 'Default Feedback Form',
    description: 'Default feedback form template with all standard fields',
    isDefault: true,
    systemFields: systemFields,
    customFields: [],
    createdBy: userId
  });

  return defaultTemplate.save();
};

// Static method to find templates by organization
FeedbackFormTemplateSchema.statics.findByOrganization = function(organizationId, includeDeleted = false) {
  const query = { organization: organizationId };
  if (!includeDeleted) {
    query.isDeleted = false;
  }
  return this.find(query).sort({ isDefault: -1, name: 1 });
};

FeedbackFormTemplateSchema.set('toJSON', { virtuals: true });
FeedbackFormTemplateSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FeedbackFormTemplate', FeedbackFormTemplateSchema);

