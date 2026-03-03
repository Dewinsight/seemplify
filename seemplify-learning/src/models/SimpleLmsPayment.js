import mongoose from 'mongoose'

const SimpleLmsPaymentSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true,
    index: true
  },
  provider: {
    type: String,
    enum: ['flutterwave'],
    default: 'flutterwave'
  },
  txRef: {
    type: String,
    required: true,
    unique: true,
    index: true,
    maxlength: 120
  },
  flutterwaveTxId: {
    type: String,
    trim: true,
    maxlength: 120
  },
  checkoutUrl: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  amountMinor: {
    type: Number,
    min: 0,
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
    enum: ['initiated', 'pending', 'successful', 'failed', 'cancelled', 'refunded'],
    default: 'initiated',
    index: true
  },
  flutterwaveStatus: {
    type: String,
    trim: true,
    maxlength: 120
  },
  customerEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320
  },
  customerName: {
    type: String,
    trim: true,
    maxlength: 200
  },
  paidAt: Date,
  verifiedAt: Date,
  verificationPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
})

SimpleLmsPaymentSchema.index({ account: 1, course: 1, status: 1, createdAt: -1 })
SimpleLmsPaymentSchema.index({ course: 1, status: 1, createdAt: -1 })
SimpleLmsPaymentSchema.index({ provider: 1, flutterwaveTxId: 1 })

const SimpleLmsPayment =
  mongoose.models.AiinSimpleLmsPayment ||
  mongoose.model('AiinSimpleLmsPayment', SimpleLmsPaymentSchema)

export { SimpleLmsPayment }
export default SimpleLmsPayment
