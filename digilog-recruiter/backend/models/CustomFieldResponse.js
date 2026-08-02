const mongoose = require('mongoose');

const CustomFieldResponseSchema = new mongoose.Schema({
  // Organization isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },

  // Interview and feedback context
  interviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Interview',
    required: true
  },

  interviewCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewComment',
    required: true
  },

  // Custom field reference
  customFieldId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomField',
    required: true
  },

  // Field metadata (denormalized for performance)
  fieldName: {
    type: String,
    required: true,
    trim: true
  },

  fieldLabel: {
    type: String,
    required: true,
    trim: true
  },

  fieldType: {
    type: String,
    required: true,
    enum: ['text', 'textarea', 'rating', 'radio', 'checkbox', 'calculated']
  },

  // Response value (flexible based on field type)
  responseValue: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // For text/textarea: String
  // For rating: Number
  // For radio: String (single value)
  // For checkbox: Array of Strings
  // For calculated: Number

  // Respondent information
  respondentType: {
    type: String,
    enum: ['internal', 'public'],
    required: true
  },

  respondentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // null for public respondents
  },

  respondentName: {
    type: String,
    trim: true
  },

  respondentEmail: {
    type: String,
    trim: true,
    lowercase: true
  },

  // Calculated field metadata
  calculationFormula: {
    type: String, // Store formula used for calculated fields
    trim: true
  },

  sourceFieldValues: {
    type: Map,
    of: mongoose.Schema.Types.Mixed // Store the values used in calculation
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient querying
CustomFieldResponseSchema.index({ organization: 1, interviewId: 1 });
CustomFieldResponseSchema.index({ organization: 1, interviewCommentId: 1 });
CustomFieldResponseSchema.index({ organization: 1, customFieldId: 1 });
CustomFieldResponseSchema.index({ fieldType: 1 });
CustomFieldResponseSchema.index({ createdAt: -1 });

// Compound index for analytics queries
CustomFieldResponseSchema.index({ 
  organization: 1, 
  customFieldId: 1, 
  createdAt: -1 
});

// Pre-save middleware
CustomFieldResponseSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to get display value
CustomFieldResponseSchema.methods.getDisplayValue = function() {
  switch (this.fieldType) {
    case 'checkbox':
      return Array.isArray(this.responseValue) 
        ? this.responseValue.join(', ') 
        : this.responseValue;
    case 'rating':
      return `${this.responseValue}/${this.fieldMetadata?.ratingConfig?.scale || 5}`;
    case 'calculated':
      return `${this.responseValue} (calculated)`;
    default:
      return this.responseValue;
  }
};

// Static method to find responses for an interview
CustomFieldResponseSchema.statics.findByInterview = function(interviewId) {
  return this.find({ interviewId }).populate('customFieldId').sort({ createdAt: 1 });
};

// Static method to find responses for an interview comment
CustomFieldResponseSchema.statics.findByComment = function(commentId) {
  return this.find({ interviewCommentId: commentId }).populate('customFieldId');
};

// Static method to get aggregated statistics for a custom field
CustomFieldResponseSchema.statics.getFieldStatistics = async function(organizationId, customFieldId, options = {}) {
  const { startDate, endDate } = options;
  
  const matchStage = {
    organization: mongoose.Types.ObjectId(organizationId),
    customFieldId: mongoose.Types.ObjectId(customFieldId)
  };

  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$fieldType',
        count: { $sum: 1 },
        responses: { $push: '$responseValue' }
      }
    }
  ];

  const results = await this.aggregate(pipeline);
  
  if (results.length === 0) {
    return null;
  }

  const result = results[0];
  const fieldType = result._id;

  // Calculate statistics based on field type
  const stats = {
    fieldType,
    totalResponses: result.count
  };

  if (fieldType === 'rating') {
    const values = result.responses.filter(v => typeof v === 'number');
    if (values.length > 0) {
      stats.average = values.reduce((a, b) => a + b, 0) / values.length;
      stats.min = Math.min(...values);
      stats.max = Math.max(...values);
      stats.median = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    }
  } else if (fieldType === 'radio' || fieldType === 'checkbox') {
    // Count occurrences of each option
    const counts = {};
    result.responses.forEach(response => {
      const values = Array.isArray(response) ? response : [response];
      values.forEach(val => {
        counts[val] = (counts[val] || 0) + 1;
      });
    });
    stats.optionCounts = counts;
    stats.mostCommon = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([option, count]) => ({ option, count }));
  } else if (fieldType === 'text' || fieldType === 'textarea') {
    const values = result.responses.filter(v => v && v.length > 0);
    stats.responseCount = values.length;
    stats.averageLength = values.reduce((sum, val) => sum + val.length, 0) / values.length || 0;
  }

  return stats;
};

// Static method to bulk create responses
CustomFieldResponseSchema.statics.bulkCreateResponses = async function(responses) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return [];
  }
  
  return this.insertMany(responses, { ordered: false });
};

module.exports = mongoose.model('CustomFieldResponse', CustomFieldResponseSchema);

