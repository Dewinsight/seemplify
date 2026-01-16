const mongoose = require('mongoose');

/**
 * Screening Question Model
 * Supports dynamic question types with conditional logic and auto-actions
 */
const ScreeningQuestionSchema = new mongoose.Schema({
  // Reference to the job this question belongs to
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },

  // Question type determines UI component
  type: {
    type: String,
    required: [true, 'Question type is required'],
    enum: ['radio', 'checkbox', 'text', 'select', 'multiselect', 'date', 'number'],
    default: 'text'
  },

  // The question text
  question: {
    type: String,
    required: [true, 'Question text is required'],
    trim: true,
    maxlength: 500
  },

  // Optional description or helper text
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },

  // Whether this question must be answered
  isRequired: {
    type: Boolean,
    default: true
  },

  // Order in which questions are displayed
  order: {
    type: Number,
    required: true,
    default: 0
  },

  // Options for radio, checkbox, select, multiselect
  options: [{
    value: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    }
  }],

  // Conditional logic to show/hide this question
  condition: {
    dependsOn: {
      type: String, // Question ID to watch
      trim: true
    },
    operator: {
      type: String,
      enum: ['equals', 'not_equals', 'contains', 'not_contains'],
      default: 'equals'
    },
    value: {
      type: mongoose.Schema.Types.Mixed, // Can be string, boolean, number, array
      required: true
    }
  },

  // Auto-action triggered by specific answer
  action: {
    value: {
      type: mongoose.Schema.Types.Mixed, // Answer value that triggers action
    },
    actionType: {
      type: String,
      enum: ['shortlist', 'reject', 'flag'],
      default: 'shortlist'
    },
    reason: {
      type: String,
      trim: true
    }
  },

  // Metadata
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
ScreeningQuestionSchema.index({ job: 1, order: 1 });
ScreeningQuestionSchema.index({ job: 1, isActive: 1 });

module.exports = mongoose.model('ScreeningQuestion', ScreeningQuestionSchema);
