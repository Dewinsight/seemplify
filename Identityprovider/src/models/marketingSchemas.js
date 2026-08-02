import mongoose from 'mongoose'

const { Schema } = mongoose

export const utmSchema = new Schema({
  source: { type: String, trim: true },
  medium: { type: String, trim: true },
  campaign: { type: String, trim: true },
  term: { type: String, trim: true },
  content: { type: String, trim: true }
}, {
  _id: false
})

export const attributionTouchSchema = new Schema({
  sourceType: {
    type: String,
    enum: ['website_visit', 'campaign_click', 'signup', 'demo_request', 'manual', 'unknown'],
    default: 'unknown'
  },
  source: { type: String, trim: true },
  channel: { type: String, trim: true },
  campaignId: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaign'
  },
  batchId: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignBatch'
  },
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'AiinCampaignRecipient'
  },
  campaignName: { type: String, trim: true },
  brevoCampaignId: Number,
  brevoMessageId: String,
  signedToken: String,
  visitorId: String,
  sessionId: String,
  email: { type: String, trim: true, lowercase: true },
  landingPage: String,
  referrer: String,
  utm: utmSchema,
  metadata: { type: Schema.Types.Mixed, default: {} },
  occurredAt: Date
}, {
  _id: false
})

export const senderSnapshotSchema = new Schema({
  senderId: Number,
  name: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  domain: { type: String, trim: true, lowercase: true },
  active: Boolean,
  readinessBand: {
    type: String,
    enum: ['red', 'amber', 'green'],
    default: 'amber'
  },
  readinessReasons: {
    type: [String],
    default: []
  }
}, {
  _id: false
})

export const campaignMetricSchema = new Schema({
  queued: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  opened: { type: Number, default: 0 },
  proxyOpens: { type: Number, default: 0 },
  clicked: { type: Number, default: 0 },
  hardBounces: { type: Number, default: 0 },
  softBounces: { type: Number, default: 0 },
  unsubscribes: { type: Number, default: 0 },
  spam: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
  signups: { type: Number, default: 0 },
  demoRequests: { type: Number, default: 0 }
}, {
  _id: false
})
