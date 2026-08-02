import mongoose from 'mongoose'

const DemoRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  company: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  message: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  source: {
    type: String,
    trim: true,
    default: 'identityprovider'
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'scheduled', 'closed', 'spam'],
    default: 'new'
  },
  adminNotes: {
    type: String,
    trim: true
  },
  respondedAt: Date,
  scheduledFor: Date,
  processedAt: Date,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  adminNotificationSent: {
    type: Boolean,
    default: false
  },
  adminNotificationSentAt: Date,
  requesterConfirmationSent: {
    type: Boolean,
    default: false
  },
  requesterConfirmationSentAt: Date,
  visitorId: {
    type: String,
    trim: true
  },
  attribution: {
    firstTouch: {
      sourceType: {
        type: String,
        enum: ['website_visit', 'campaign_click', 'signup', 'demo_request', 'manual', 'unknown'],
        default: 'unknown'
      },
      source: String,
      channel: String,
      campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaign'
      },
      batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignBatch'
      },
      recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignRecipient'
      },
      campaignName: String,
      brevoCampaignId: Number,
      brevoMessageId: String,
      signedToken: String,
      visitorId: String,
      sessionId: String,
      email: String,
      landingPage: String,
      referrer: String,
      utm: {
        source: String,
        medium: String,
        campaign: String,
        term: String,
        content: String
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      occurredAt: Date
    },
    lastTouch: {
      sourceType: {
        type: String,
        enum: ['website_visit', 'campaign_click', 'signup', 'demo_request', 'manual', 'unknown'],
        default: 'unknown'
      },
      source: String,
      channel: String,
      campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaign'
      },
      batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignBatch'
      },
      recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignRecipient'
      },
      campaignName: String,
      brevoCampaignId: Number,
      brevoMessageId: String,
      signedToken: String,
      visitorId: String,
      sessionId: String,
      email: String,
      landingPage: String,
      referrer: String,
      utm: {
        source: String,
        medium: String,
        campaign: String,
        term: String,
        content: String
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      occurredAt: Date
    },
    conversionSource: {
      type: String,
      enum: ['website', 'campaign', 'manual', 'unknown'],
      default: 'unknown'
    }
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    referrer: String,
    path: String
  }
}, {
  timestamps: true,
  collection: 'aiin_demo_requests'
})

DemoRequestSchema.index({ status: 1, createdAt: -1 })
DemoRequestSchema.index({ email: 1, createdAt: -1 })
DemoRequestSchema.index({ company: 1, createdAt: -1 })
DemoRequestSchema.index({ processedBy: 1, processedAt: -1 })

DemoRequestSchema.statics.getStats = async function () {
  const [rows, total] = await Promise.all([
    this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]),
    this.countDocuments()
  ])

  const stats = {
    total,
    new: 0,
    contacted: 0,
    scheduled: 0,
    closed: 0,
    spam: 0
  }

  rows.forEach((row) => {
    if (row?._id && Object.prototype.hasOwnProperty.call(stats, row._id)) {
      stats[row._id] = row.count
    }
  })

  return stats
}

const DemoRequest = mongoose.models.AiinDemoRequest || mongoose.model('AiinDemoRequest', DemoRequestSchema)

export default DemoRequest
