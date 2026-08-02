const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schema for evaluation criteria
const EvaluationCriterionSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['technical', 'behavioral', 'communication', 'cultural_fit', 'cultural', 'leadership', 'custom'],
    default: 'custom'
  },
  weight: {
    type: Number,
    min: 0,
    max: 100,
    default: 20
  },
  description: String
}, { _id: false });

// Sub-schema for AI question generation
const AIQuestionGenSchema = new Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  questionTypes: [{
    type: String,
    enum: ['behavioral', 'technical', 'situational', 'experience_based', 'hypothetical']
  }],
  questionCount: {
    type: Number,
    min: 1,
    max: 20,
    default: 5
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  }
}, { _id: false });

// Sub-schema for individual stage
const TemplateStageSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['phone_screen', 'technical', 'behavioral', 'panel', 'hr', 'executive', 'case_study', 'culture_fit', 'presentation', 'assessment', 'final', 'offer', 'custom'],
    default: 'custom'
  },
  order: {
    type: Number,
    required: true,
    min: 1
  },
  defaultDuration: {
    type: Number,
    default: 60
  },
  description: String,
  evaluationCriteria: [EvaluationCriterionSchema],
  requiredInterviewers: {
    type: Number,
    min: 0,
    default: 1
  },
  interviewerRoles: [{
    type: String,
    trim: true
  }],
  aiQuestionGeneration: AIQuestionGenSchema,
  defaultQuestions: [{
    question: String,
    category: String,
    expectedAnswer: String
  }],
  progressionRules: {
    autoAdvance: {
      type: Boolean,
      default: false
    },
    minimumScore: {
      type: Number,
      min: 0,
      max: 100
    },
    requiredApprovals: {
      type: Number,
      min: 0,
      default: 0
    }
  }
}, { _id: false });

// Main StageTemplate Schema
const StageTemplateSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    minlength: [3, 'Template name must be at least 3 characters'],
    maxlength: [100, 'Template name must not exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description must not exceed 500 characters']
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'Organization ID is required'],
    index: true
  },
  stages: {
    type: [TemplateStageSchema],
    required: true,
    validate: {
      validator: function(stages) {
        return stages && stages.length >= 1;
      },
      message: 'Template must have at least 1 stage'
    }
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastUsedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'stagetemplates'
});

// Compound Indexes
StageTemplateSchema.index({ organizationId: 1, isActive: 1 });
StageTemplateSchema.index({ organizationId: 1, name: 1 }, { unique: true });

// Virtual field: stageCount
StageTemplateSchema.virtual('stageCount').get(function() {
  return this.stages ? this.stages.length : 0;
});

// Instance method: incrementUsageCount
StageTemplateSchema.methods.incrementUsageCount = async function() {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  return this.save();
};

// Instance method: isUsed
StageTemplateSchema.methods.isUsed = function() {
  return this.usageCount > 0;
};

// Static method: findActiveByOrganization
StageTemplateSchema.statics.findActiveByOrganization = function(organizationId) {
  return this.find({ organizationId, isActive: true })
    .populate('createdBy', 'name email')
    .sort({ name: 1 });
};

// Validation: Ensure stages are sequentially ordered
StageTemplateSchema.pre('validate', function(next) {
  if (this.stages && this.stages.length > 0) {
    // Sort stages by order
    this.stages.sort((a, b) => a.order - b.order);
    
    // Validate sequential ordering
    for (let i = 0; i < this.stages.length; i++) {
      if (this.stages[i].order !== i + 1) {
        return next(new Error(`Stage order must be sequential. Expected ${i + 1}, got ${this.stages[i].order}`));
      }
    }
  }
  next();
});

module.exports = mongoose.model('StageTemplate', StageTemplateSchema);

