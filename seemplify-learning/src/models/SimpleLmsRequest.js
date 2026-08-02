import mongoose from 'mongoose'

const simpleLmsRequestPaymentSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['not_required', 'pending', 'paid'],
    default: 'not_required'
  },
  amount: {
    type: Number,
    min: 0,
    default: 0
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'NGN'
  },
  paidAt: Date
}, { _id: false })

const SimpleLmsRequestSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: false,
    default: null,
    index: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  requestType: {
    type: String,
    enum: ['system_course_access', 'public_course_publish', 'publish_without_review'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    trim: true,
    maxlength: 5000
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    default: null
  },
  program: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsProgram',
    default: null
  },
  targetAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  targetVisibility: {
    type: String,
    enum: ['organization_public', 'system_public', null],
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  reviewedAt: Date,
  reviewNotes: {
    type: String,
    trim: true,
    maxlength: 3000
  },
  payment: {
    type: simpleLmsRequestPaymentSchema,
    default: () => ({})
  },
  notificationRecipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  expiresAt: Date,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
})

SimpleLmsRequestSchema.index({ organization: 1, status: 1, requestType: 1, createdAt: -1 })
SimpleLmsRequestSchema.index({ requestedBy: 1, status: 1, createdAt: -1 })

SimpleLmsRequestSchema.methods.approve = function({ reviewerId, notes = '', markPaid = false }) {
  this.status = 'approved'
  this.reviewedBy = reviewerId
  this.reviewedAt = new Date()
  this.reviewNotes = String(notes || '').trim()

  if (markPaid && this.payment) {
    this.payment.status = 'paid'
    this.payment.paidAt = new Date()
  }

  return this.save()
}

SimpleLmsRequestSchema.methods.reject = function({ reviewerId, notes = '' }) {
  this.status = 'rejected'
  this.reviewedBy = reviewerId
  this.reviewedAt = new Date()
  this.reviewNotes = String(notes || '').trim()
  return this.save()
}

const SimpleLmsRequest =
  mongoose.models.AiinSimpleLmsRequest ||
  mongoose.model('AiinSimpleLmsRequest', SimpleLmsRequestSchema)

export { SimpleLmsRequest }
export default SimpleLmsRequest
