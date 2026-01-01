const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubscriptionRequestSchema = new Schema({
  requestType: {
    type: String,
    enum: ['user', 'organization'],
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    default: null
  },
  currentPlan: {
    type: String,
    required: true,
    default: 'personal'
  },
  requestedPlan: {
    type: String,
    required: true
    // No enum validation - we validate against Plan model in controller instead
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'approved', 'rejected', 'invoiced'],
    default: 'pending'
  },
  notes: {
    type: String,
    default: ''
  },
  adminNotes: {
    type: String,
    default: ''
  },
  invoiceDetails: {
    invoiceNumber: String,
    amount: Number,
    currency: String,
    dueDate: Date,
    paid: {
      type: Boolean,
      default: false
    }
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  approvalDate: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
SubscriptionRequestSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('SubscriptionRequest', SubscriptionRequestSchema);
