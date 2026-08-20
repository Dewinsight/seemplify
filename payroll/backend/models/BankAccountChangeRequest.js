const mongoose = require('mongoose');

const { Schema } = mongoose;

const ProposedAccountSchema = new Schema({
  isPrimary: { type: Boolean, default: true },
  country: { type: String, trim: true, default: 'Other' },
  countryCode: { type: String, uppercase: true, trim: true, maxlength: 2, default: '' },
  accountName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  bankName: { type: String, required: true, trim: true },
  branchName: { type: String, trim: true, default: '' },
  branchCode: { type: String, trim: true, default: '' },
  swiftCode: { type: String, uppercase: true, trim: true, default: '' },
  routingNumber: { type: String, trim: true, default: '' },
  iban: { type: String, uppercase: true, trim: true, default: '' },
  accountType: { type: String, enum: ['checking', 'savings', 'current'], default: 'checking' },
  splitPercentage: { type: Number, min: 1, max: 100, default: 100 },
}, { _id: false });

const BankAccountChangeRequestSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  userName: { type: String, trim: true, default: '' },
  requestedBy: { type: String, required: true },
  requestedByName: { type: String, trim: true, default: '' },
  proposedAccount: { type: ProposedAccountSchema, required: true, select: false },
  proposedAccountFingerprint: { type: String, required: true, select: false },
  proposedAccountSummary: {
    bankName: { type: String, trim: true, default: '' },
    countryCode: { type: String, uppercase: true, trim: true, default: '' },
    accountLast4: { type: String, trim: true, default: '' },
    accountType: { type: String, trim: true, default: '' },
  },
  previousAccountFingerprint: { type: String, select: false, default: '' },
  previousAccountSummary: {
    bankName: { type: String, trim: true, default: '' },
    countryCode: { type: String, uppercase: true, trim: true, default: '' },
    accountLast4: { type: String, trim: true, default: '' },
    accountType: { type: String, trim: true, default: '' },
  },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'approved', 'rejected', 'cancelled', 'superseded'],
    default: 'pending',
    index: true,
  },
  reviewedBy: { type: String, default: '' },
  reviewedByName: { type: String, trim: true, default: '' },
  reviewComment: { type: String, trim: true, maxlength: 1000, default: '' },
  reviewedAt: Date,
  appliedAt: Date,
}, { timestamps: true });

BankAccountChangeRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
BankAccountChangeRequestSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('BankAccountChangeRequest', BankAccountChangeRequestSchema);
