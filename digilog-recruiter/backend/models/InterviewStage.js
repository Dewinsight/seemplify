const mongoose = require('mongoose');

const evaluationCriterionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  weight: { type: Number, required: true, min: 0, max: 100 },
  type: {
    type: String,
    enum: ['technical', 'behavioral', 'cultural', 'communication', 'leadership'],
    required: true
  },
  scoringGuidelines: String
});

const aiQuestionConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  questionTypes: [String],
  questionCount: { type: Number, default: 10 },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    default: 'medium'
  },
  focusAreas: [String]
});

const progressionConditionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['score_threshold', 'unanimous_approval', 'manager_approval', 'ai_recommendation', 'custom'],
    required: true
  },
  value: mongoose.Schema.Types.Mixed,
  action: {
    type: String,
    enum: ['advance', 'reject', 'hold_for_review'],
    required: true
  },
  priority: { type: Number, default: 0 }
});

const progressionRulesSchema = new mongoose.Schema({
  autoProgress: { type: Boolean, default: false },
  minimumScore: Number,
  requiredApprovals: { type: Number, default: 1 },
  conditions: [progressionConditionSchema]
});

const interviewStageSchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  order: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['phone_screen', 'technical', 'behavioral', 'panel', 'hr', 'executive', 'case_study', 'culture_fit', 'custom'],
    required: true
  },
  description: String,
  isActive: {
    type: Boolean,
    default: true
  },
  defaultDuration: {
    type: Number,
    required: true,
    min: 15,
    max: 480,
    default: 60
  },
  requiredInterviewers: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    default: 1
  },
  interviewerRoles: [String],
  evaluationCriteria: [evaluationCriterionSchema],
  aiQuestionGeneration: aiQuestionConfigSchema,
  defaultQuestions: [String],
  
  // Feedback Form Configuration for this stage
  feedbackFormConfig: {
    useTemplate: {
      type: Boolean,
      default: true
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackFormTemplate'
    },
    overrides: {
      systemFields: [{
        fieldId: String,
        isVisible: Boolean,
        isRequired: Boolean,
        order: Number,
        label: String
      }],
      customFields: [{
        customFieldId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'CustomField'
        },
        isVisible: Boolean,
        isRequired: Boolean,
        order: Number,
        label: String
      }]
    }
  },
  
  progressionRules: progressionRulesSchema,
  interviewCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
interviewStageSchema.index({ jobId: 1, order: 1 });
interviewStageSchema.index({ jobId: 1, isActive: 1 });

// Virtual for getting interviews associated with this stage
interviewStageSchema.virtual('interviews', {
  ref: 'Interview',
  localField: '_id',
  foreignField: 'stageId'
});

// Method to check if stage can be deleted
interviewStageSchema.methods.canDelete = async function() {
  const Interview = mongoose.model('Interview');
  const count = await Interview.countDocuments({ stageId: this._id });
  return count === 0;
};

// Static method to reorder stages
interviewStageSchema.statics.reorderStages = async function(jobId, stageOrder) {
  const bulkOps = stageOrder.map(({ stageId, newOrder }) => ({
    updateOne: {
      filter: { _id: stageId, jobId },
      update: { order: newOrder }
    }
  }));
  
  return await this.bulkWrite(bulkOps);
};

module.exports = mongoose.model('InterviewStage', interviewStageSchema); 