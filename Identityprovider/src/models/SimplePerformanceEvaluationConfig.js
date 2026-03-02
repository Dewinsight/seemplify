import mongoose from 'mongoose'

const simplePerformanceFieldSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  createdByName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false })

const SimplePerformanceEvaluationConfigSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    unique: true,
    index: true
  },
  fields: {
    type: [simplePerformanceFieldSchema],
    default: []
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  updatedByName: {
    type: String,
    trim: true,
    maxlength: 200
  }
}, { timestamps: true })

const SimplePerformanceEvaluationConfig =
  mongoose.models.AiinSimplePerformanceEvaluationConfig ||
  mongoose.model('AiinSimplePerformanceEvaluationConfig', SimplePerformanceEvaluationConfigSchema)

export { SimplePerformanceEvaluationConfig }
export default SimplePerformanceEvaluationConfig
