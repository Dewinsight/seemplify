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

const SimpleLmsWithdrawalSchema = new mongoose.Schema({
  creatorAccount: {
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
  timestamps: true
})

SimpleLmsWithdrawalSchema.index({ creatorAccount: 1, status: 1, createdAt: -1 })
SimpleLmsWithdrawalSchema.index({ status: 1, createdAt: -1 })

const SimpleLmsWithdrawal =
  mongoose.models.AiinSimpleLmsWithdrawal ||
  mongoose.model('AiinSimpleLmsWithdrawal', SimpleLmsWithdrawalSchema)

export { SimpleLmsWithdrawal }
export default SimpleLmsWithdrawal
