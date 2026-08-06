import mongoose from 'mongoose'
import { campaignMetricSchema } from './marketingSchemas.js'

const { Schema } = mongoose

const campaignBatchSchema = new Schema({
  campaign: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaign',
    required: true,
    index: true
  },
  sequence: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'sent', 'completed', 'failed', 'paused', 'cancelled'],
    default: 'pending'
  },
  scheduledAt: Date,
  startedAt: Date,
  finishedAt: Date,
  recipientIds: {
    type: [{
      type: Schema.Types.ObjectId,
      ref: 'AiinCampaignRecipient'
    }],
    default: []
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  lease: {
    claimedBy: String,
    claimedAt: Date,
    expiresAt: Date,
    heartbeatAt: Date
  },
  brevo: {
    childCampaignId: Number,
    listId: Number,
    folderId: Number,
    sendTriggeredAt: Date,
    reportSnapshot: { type: Schema.Types.Mixed, default: {} }
  },
  metrics: {
    type: campaignMetricSchema,
    default: () => ({})
  },
  error: {
    code: String,
    message: String,
    details: { type: Schema.Types.Mixed, default: {} },
    lastFailedAt: Date
  }
}, {
  timestamps: true,
  collection: 'aiin_campaign_batches'
})

campaignBatchSchema.index({ campaign: 1, sequence: 1 }, { unique: true })
campaignBatchSchema.index({ status: 1, scheduledAt: 1 })

const CampaignBatch = mongoose.models.AiinCampaignBatch || mongoose.model('AiinCampaignBatch', campaignBatchSchema)

export default CampaignBatch
