import mongoose from 'mongoose'

const { Schema } = mongoose

const audienceContactSchema = new Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  normalizedEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  role: { type: String, trim: true },
  jobTitle: { type: String, trim: true },
  jobLevel: { type: String, trim: true },
  department: { type: String, trim: true },
  companyName: { type: String, trim: true },
  industry: { type: String, trim: true },
  companyHeadCount: { type: String, trim: true },
  location: { type: String, trim: true },
  companyDescription: { type: String, trim: true },
  tailoredMessage: { type: String, trim: true },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['active', 'invalid', 'suppressed'],
    default: 'active'
  },
  importErrors: {
    type: [String],
    default: []
  },
  sourceRowNumber: Number
}, {
  _id: true
})

const campaignAudienceSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  sourceType: {
    type: String,
    enum: ['csv', 'excel', 'manual', 'saved'],
    default: 'csv'
  },
  sourceFileName: {
    type: String,
    trim: true
  },
  columnMap: {
    type: Schema.Types.Mixed,
    default: {}
  },
  importSummary: {
    totalRows: { type: Number, default: 0 },
    validRecipients: { type: Number, default: 0 },
    invalidRecipients: { type: Number, default: 0 },
    duplicateRecipients: { type: Number, default: 0 },
    skippedRecipients: { type: Number, default: 0 },
    lastImportedAt: Date
  },
  contacts: {
    type: [audienceContactSchema],
    default: []
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'AiinAccount'
  }
}, {
  timestamps: true,
  collection: 'aiin_campaign_audiences'
})

campaignAudienceSchema.index({ slug: 1 }, { unique: true })
campaignAudienceSchema.index({ updatedAt: -1 })

const CampaignAudience = mongoose.models.AiinCampaignAudience || mongoose.model('AiinCampaignAudience', campaignAudienceSchema)

export default CampaignAudience
