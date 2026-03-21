import mongoose from 'mongoose'

const { Schema } = mongoose

const campaignEventSchema = new Schema({
  campaign: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaign',
    required: true,
    index: true
  },
  batch: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignBatch',
    index: true
  },
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignRecipient',
    index: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['sent', 'delivered', 'opened', 'proxy_open', 'click', 'hardBounce', 'softBounce', 'unsubscribed', 'spam', 'signup', 'demo_request'],
    required: true
  },
  source: {
    type: String,
    enum: ['brevo_webhook', 'brevo_reconcile', 'local_tracking'],
    default: 'brevo_webhook'
  },
  eventTime: {
    type: Date,
    required: true
  },
  ipAddress: String,
  linkUrl: String,
  reason: String,
  fingerprint: String,
  brevo: {
    webhookId: Number,
    campaignId: Number,
    messageId: String,
    tag: String
  },
  raw: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_campaign_events'
})

campaignEventSchema.index({ campaign: 1, eventTime: -1 })
campaignEventSchema.index({ recipient: 1, eventTime: -1 })
campaignEventSchema.index({ fingerprint: 1 }, { unique: true, sparse: true })

const CampaignEvent = mongoose.models.AiinCampaignEvent || mongoose.model('AiinCampaignEvent', campaignEventSchema)

export default CampaignEvent
