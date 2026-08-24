import mongoose from 'mongoose'
import {
  attributionTouchSchema,
  campaignMetricSchema
} from './marketingSchemas.js'

const { Schema } = mongoose

const campaignRecipientSchema = new Schema({
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
  audience: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignAudience'
  },
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
  headcount: { type: String, trim: true },
  location: { type: String, trim: true },
  companyDescription: { type: String, trim: true },
  tailoredMessage: { type: String, trim: true },
  rawAttributes: {
    type: Schema.Types.Mixed,
    default: {}
  },
  personalization: {
    type: Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['queued', 'suppressed', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'complained', 'converted', 'failed'],
    default: 'queued'
  },
  brevo: {
    contactId: Number,
    childCampaignId: Number,
    listId: Number,
    emailBlacklisted: Boolean,
    smsBlacklisted: Boolean,
    messageId: String
  },
  eventCounts: {
    type: campaignMetricSchema,
    default: () => ({})
  },
  lastEventAt: Date,
  lastClickedUrl: String,
  sentAt: Date,
  deliveredAt: Date,
  openedAt: Date,
  clickedAt: Date,
  bouncedAt: Date,
  unsubscribedAt: Date,
  complainedAt: Date,
  sequence: {
    lastSentStepIndex: { type: Number, default: -1 },
    lastSentStepId: { type: Schema.Types.ObjectId, default: null },
    lastSentAt: Date,
    completedAt: Date,
    exitReason: {
      type: String,
      enum: ['completed', 'converted', 'unsubscribed', 'complained', 'bounced', 'condition_not_met', 'cancelled'],
      default: undefined
    }
  },
  conversion: {
    type: {
      type: String,
      enum: ['signup', 'demo_request']
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'AiinAccount'
    },
    demoRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'AiinDemoRequest'
    },
    visitorId: String,
    convertedAt: Date
  },
  attribution: {
    token: String,
    firstTouch: attributionTouchSchema,
    lastTouch: attributionTouchSchema
  }
}, {
  timestamps: true,
  collection: 'aiin_campaign_recipients'
})

campaignRecipientSchema.index({ campaign: 1, normalizedEmail: 1 }, { unique: true })
campaignRecipientSchema.index({ batch: 1, status: 1 })

const CampaignRecipient = mongoose.models.AiinCampaignRecipient || mongoose.model('AiinCampaignRecipient', campaignRecipientSchema)

export default CampaignRecipient
