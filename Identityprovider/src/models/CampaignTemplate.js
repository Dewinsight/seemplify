import mongoose from 'mongoose'

const { Schema } = mongoose

const campaignTemplateSchema = new Schema({
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
  category: {
    type: String,
    enum: ['product_launch', 'nurture', 'demo_webinar', 'newsletter_update', 'custom'],
    default: 'custom'
  },
  description: {
    type: String,
    trim: true
  },
  tags: {
    type: [String],
    default: []
  },
  systemTemplate: {
    type: Boolean,
    default: false
  },
  designMode: {
    type: String,
    enum: ['visual', 'html'],
    default: 'visual'
  },
  design: {
    type: Schema.Types.Mixed,
    default: {}
  },
  htmlContent: {
    type: String,
    default: ''
  },
  textContent: {
    type: String,
    default: ''
  },
  previewText: {
    type: String,
    default: ''
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  archivedAt: Date
}, {
  timestamps: true,
  collection: 'aiin_campaign_templates'
})

campaignTemplateSchema.index({ slug: 1 }, { unique: true })
campaignTemplateSchema.index({ category: 1, systemTemplate: 1, updatedAt: -1 })

const CampaignTemplate = mongoose.models.AiinCampaignTemplate || mongoose.model('AiinCampaignTemplate', campaignTemplateSchema)

export default CampaignTemplate
