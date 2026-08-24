import mongoose from 'mongoose'

const { Schema } = mongoose

const campaignSuppressionSchema = new Schema({
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
  reason: {
    type: String,
    enum: ['unsubscribed', 'complained', 'hard_bounce', 'manual'],
    required: true
  },
  source: {
    type: String,
    enum: ['brevo_webhook', 'admin', 'import'],
    default: 'brevo_webhook'
  },
  campaign: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaign',
    default: null
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignRecipient',
    default: null
  },
  details: {
    type: Schema.Types.Mixed,
    default: {}
  },
  suppressedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'aiin_campaign_suppressions'
})

campaignSuppressionSchema.index({ normalizedEmail: 1 }, { unique: true })
campaignSuppressionSchema.index({ reason: 1, updatedAt: -1 })

const CampaignSuppression = mongoose.models.AiinCampaignSuppression || mongoose.model('AiinCampaignSuppression', campaignSuppressionSchema)

export default CampaignSuppression
