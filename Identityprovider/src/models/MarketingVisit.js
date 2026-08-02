import mongoose from 'mongoose'
import { attributionTouchSchema, utmSchema } from './marketingSchemas.js'

const { Schema } = mongoose

const marketingVisitSchema = new Schema({
  visitorId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  sessionId: {
    type: String,
    trim: true
  },
  eventType: {
    type: String,
    enum: ['page_view', 'cta_click', 'demo_submit', 'signup_start', 'signup_complete', 'demo_complete'],
    default: 'page_view'
  },
  sourceApp: {
    type: String,
    enum: ['marketing-site', 'identityprovider', 'email'],
    default: 'marketing-site'
  },
  pageUrl: String,
  path: String,
  referrer: String,
  ipAddress: String,
  userAgent: String,
  utm: utmSchema,
  attribution: attributionTouchSchema,
  account: {
    type: Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  demoRequest: {
    type: Schema.Types.ObjectId,
    ref: 'AiinDemoRequest'
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  occurredAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'aiin_marketing_visits'
})

marketingVisitSchema.index({ eventType: 1, occurredAt: -1 })
marketingVisitSchema.index({ 'attribution.campaignId': 1, occurredAt: -1 })

const MarketingVisit = mongoose.models.AiinMarketingVisit || mongoose.model('AiinMarketingVisit', marketingVisitSchema)

export default MarketingVisit
