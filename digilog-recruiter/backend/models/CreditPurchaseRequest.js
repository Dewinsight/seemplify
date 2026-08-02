const mongoose = require('mongoose');

const CreditPurchaseRequestSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  creditPack: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditPack',
    required: true
  },
  // Store pack details at time of request (in case pack changes later)
  packDetails: {
    name: String,
    code: String,
    credits: Number,
    bonusCredits: Number,
    totalCredits: Number,
    price: Number,
    currency: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  notes: {
    type: String,
    trim: true
  },
  // Admin actions
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  reviewedAt: {
    type: Date
  },
  reviewNotes: {
    type: String,
    trim: true
  },
  // Tracking
  creditsGranted: {
    type: Boolean,
    default: false
  },
  grantedAt: {
    type: Date
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

// Indexes for better performance
CreditPurchaseRequestSchema.index({ organization: 1, status: 1 });
CreditPurchaseRequestSchema.index({ requestedBy: 1 });
CreditPurchaseRequestSchema.index({ status: 1, createdAt: -1 });

// Pre-save middleware to update timestamp
CreditPurchaseRequestSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to approve request
CreditPurchaseRequestSchema.methods.approve = function(adminId, notes = '') {
  this.status = 'approved';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.reviewNotes = notes;
  return this;
};

// Method to reject request
CreditPurchaseRequestSchema.methods.reject = function(adminId, notes = '') {
  this.status = 'rejected';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.reviewNotes = notes;
  return this;
};

// Method to mark credits as granted
CreditPurchaseRequestSchema.methods.markCreditsGranted = function() {
  this.creditsGranted = true;
  this.grantedAt = new Date();
  return this;
};

module.exports = mongoose.model('CreditPurchaseRequest', CreditPurchaseRequestSchema);

