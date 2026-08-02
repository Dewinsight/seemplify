import mongoose from 'mongoose'

const AgentSaleAttributionSchema = new mongoose.Schema({
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsPayment',
    required: true,
    index: true,
    unique: true
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  partnerOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true,
    index: true
  },
  commissionRatePercent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  commissionAmountMinor: {
    type: Number,
    min: 0,
    required: true
  },
  saleAmountMinor: {
    type: Number,
    min: 0,
    required: true
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 3,
    default: 'NGN'
  },
  status: {
    type: String,
    enum: ['pending', 'recommended', 'approved', 'paid', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  referralCode: {
    type: String,
    trim: true,
    maxlength: 80,
    default: ''
  },
  attributedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  recommendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  recommendedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  approvedAt: Date,
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  paidAt: Date,
  transactionRef: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_agent_sale_attributions'
})

AgentSaleAttributionSchema.index({ agent: 1, status: 1, createdAt: -1 })
AgentSaleAttributionSchema.index({ partnerOrganization: 1, status: 1, createdAt: -1 })
AgentSaleAttributionSchema.index({ course: 1, status: 1, createdAt: -1 })

export const AgentSaleAttribution =
  mongoose.models.AiinAgentSaleAttribution ||
  mongoose.model('AiinAgentSaleAttribution', AgentSaleAttributionSchema)

export default AgentSaleAttribution
