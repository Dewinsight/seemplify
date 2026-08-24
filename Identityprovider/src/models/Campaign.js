import mongoose from 'mongoose'
import {
  campaignMetricSchema,
  senderSnapshotSchema
} from './marketingSchemas.js'

const { Schema } = mongoose

const campaignContentSchema = new Schema({
  subject: { type: String, default: '' },
  previewText: { type: String, default: '' },
  replyTo: { type: String, trim: true, lowercase: true },
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
  template: {
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'AiinCampaignTemplate'
    },
    name: String,
    slug: String,
    category: String
  }
}, { _id: false })

const sequenceStepSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Message'
  },
  position: {
    type: Number,
    required: true,
    min: 0
  },
  delay: {
    value: { type: Number, min: 0, default: 0 },
    unit: {
      type: String,
      enum: ['minutes', 'hours', 'days'],
      default: 'days'
    }
  },
  condition: {
    type: String,
    enum: ['all', 'not_opened_previous', 'opened_previous', 'not_clicked_previous', 'clicked_previous'],
    default: 'all'
  },
  content: {
    type: campaignContentSchema,
    default: () => ({})
  }
}, { timestamps: true })

const campaignSchema = new Schema({
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
  status: {
    type: String,
    enum: ['draft', 'ready', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'],
    default: 'draft'
  },
  sender: senderSnapshotSchema,
  audience: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignAudience'
  },
  audienceSnapshot: {
    audienceId: {
      type: Schema.Types.ObjectId,
      ref: 'AiinCampaignAudience'
    },
    name: String,
    totalRecipients: { type: Number, default: 0 },
    validRecipients: { type: Number, default: 0 },
    excludedRecipients: { type: Number, default: 0 }
  },
  content: {
    type: campaignContentSchema,
    default: () => ({})
  },
  sequence: {
    enabled: { type: Boolean, default: false },
    stopOnConversion: { type: Boolean, default: true },
    stopOnUnsubscribe: { type: Boolean, default: true },
    stopOnBounce: { type: Boolean, default: true },
    steps: {
      type: [sequenceStepSchema],
      default: []
    }
  },
  pacing: {
    batchSize: { type: Number, default: 200 },
    intervalMinutes: { type: Number, default: 30 },
    nextBatchAt: Date,
    startAt: Date,
    batchCount: { type: Number, default: 0 }
  },
  tracking: {
    utmSource: { type: String, default: 'seemplify' },
    utmMedium: { type: String, default: 'email' },
    utmCampaign: String,
    allowExternalLinkDecoration: { type: Boolean, default: false }
  },
  brevo: {
    folderId: Number,
    webhookId: Number,
    senderId: Number,
    childCampaignIds: {
      type: [Number],
      default: []
    }
  },
  metrics: {
    type: campaignMetricSchema,
    default: () => ({})
  },
  clickedUrls: {
    type: [{
      url: String,
      uniqueClicks: Number,
      totalClicks: Number,
      lastClickedAt: Date
    }],
    default: []
  },
  testSendEmails: {
    type: [String],
    default: []
  },
  lastBrevoSyncAt: Date,
  lastReconciledAt: Date,
  launchedAt: Date,
  pausedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  failureReason: String,
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
  collection: 'aiin_campaigns'
})

campaignSchema.index({ slug: 1 }, { unique: true })
campaignSchema.index({ status: 1, updatedAt: -1 })

const Campaign = mongoose.models.AiinCampaign || mongoose.model('AiinCampaign', campaignSchema)

export default Campaign
