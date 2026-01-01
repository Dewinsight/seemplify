const mongoose = require('mongoose');

const CreditPackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  description: {
    type: String,
    trim: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  features: [{
    type: String,
    trim: true
  }],
  bonusCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCredits: {
    type: Number // credits + bonusCredits - computed on save
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

// Pre-save hook to calculate total credits and update timestamp
CreditPackSchema.pre('save', function(next) {
  this.totalCredits = this.credits + (this.bonusCredits || 0);
  this.updatedAt = Date.now();
  next();
});

// Virtual for price per credit
CreditPackSchema.virtual('pricePerCredit').get(function() {
  return this.totalCredits > 0 ? (this.price / this.totalCredits).toFixed(2) : 0;
});

// Method to convert to public JSON
CreditPackSchema.methods.toPublicJSON = function() {
  const packObject = this.toObject({ virtuals: true });
  return packObject;
};

// Ensure virtuals are serialized
CreditPackSchema.set('toJSON', { virtuals: true });
CreditPackSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('CreditPack', CreditPackSchema);

