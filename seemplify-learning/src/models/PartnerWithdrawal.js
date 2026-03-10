import mongoose from 'mongoose'

const payoutProfileSnapshotSchema = new mongoose.Schema({
  accountName: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  accountNumber: {
    type: String,
    trim: true,
    maxlength: 64,
    default: ''
  },
  bankName: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  bankCode: {
    type: String,
    trim: true,
    maxlength: 80,
    default: ''
  },
  swiftCode: {
    type: String,
    trim: true,
    maxlength: 80,
    default: ''
  },
  paymentEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320,
    default: ''
  },
  country: {
    type: String,
    trim: true,
    maxlength: 80,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1200,
    default: ''
  }
}, { _id: false })

const PartnerWithdrawalSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  amountMinor: {
    type: Number,
    min: 1,
    required: true
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'NGN'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1200,
    default: ''
  },
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: ''
  },
  payoutProfileSnapshot: {
    type: payoutProfileSnapshotSchema,
    default: () => ({})
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  reviewedAt: Date,
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  paidAt: Date,
  transactionRef: {
    type: String,
    trim: true,
    maxlength: 120,
    default: ''
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_partner_withdrawals'
})

PartnerWithdrawalSchema.index({ organization: 1, status: 1, createdAt: -1 })
PartnerWithdrawalSchema.index({ requestedBy: 1, status: 1, createdAt: -1 })
PartnerWithdrawalSchema.index({ status: 1, createdAt: -1 })

export const PartnerWithdrawal =
  mongoose.models.AiinPartnerWithdrawal ||
  mongoose.model('AiinPartnerWithdrawal', PartnerWithdrawalSchema)

export default PartnerWithdrawal
