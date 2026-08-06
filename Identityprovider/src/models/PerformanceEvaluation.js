import mongoose from 'mongoose'

const ratingEntrySchema = new mongoose.Schema({
  fieldKey: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  fieldLabel: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  value: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  }
}, { _id: false })

const PerformanceEvaluationSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  evaluator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  evaluatorName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  evaluatorEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320
  },
  evaluatorScopeRole: {
    type: String,
    enum: ['line_manager', 'team_lead'],
    required: true
  },
  evaluatedMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  evaluatedMemberName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  evaluatedMemberEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320
  },
  evaluatedMemberRole: {
    type: String,
    enum: ['member', 'line_manager', 'team_lead'],
    default: 'member'
  },
  evaluatedTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinTeam'
  },
  evaluatedTeamName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  evaluatedTeamPath: [{
    type: String,
    trim: true,
    maxlength: 200
  }],
  evaluationDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  ratings: {
    type: [ratingEntrySchema],
    default: [],
    validate: {
      validator: value => Array.isArray(value) && value.length > 0,
      message: 'At least one rating is required'
    }
  },
  improvements: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  additionalNotes: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  needsOneOnOne: {
    type: Boolean,
    default: false
  }
}, { timestamps: true })

PerformanceEvaluationSchema.index({ organization: 1, evaluatedMember: 1, evaluationDate: -1 })
PerformanceEvaluationSchema.index({ organization: 1, evaluator: 1, evaluationDate: -1 })
PerformanceEvaluationSchema.index({ organization: 1, createdAt: -1 })

const PerformanceEvaluation =
  mongoose.models.AiinPerformanceEvaluation ||
  mongoose.model('AiinPerformanceEvaluation', PerformanceEvaluationSchema)

export { PerformanceEvaluation }
export default PerformanceEvaluation
