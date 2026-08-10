const mongoose = require('mongoose');

const { Schema } = mongoose;

const TaxRegistrationSchema = new Schema({
  authorityCode: { type: String, required: true, uppercase: true, trim: true, maxlength: 64 },
  registrationType: { type: String, required: true, trim: true, maxlength: 80 },
  registrationReference: { type: String, required: true, trim: true, maxlength: 160 },
  evidenceReference: { type: String, required: true, trim: true, maxlength: 240 },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  status: {
    type: String,
    enum: ['unverified', 'reviewed', 'revoked'],
    default: 'unverified',
  },
  reviewedBy: { type: String, trim: true, default: '' },
  reviewedAt: { type: Date, default: null },
}, { _id: true });

const PayrollEmployerEntitySchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
  legalName: { type: String, required: true, trim: true, maxlength: 180 },
  employerType: {
    type: String,
    enum: ['company', 'subsidiary', 'registered_branch', 'employer_of_record'],
    default: 'company',
  },
  countryCode: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{2}$/ },
  jurisdictionCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{2}(?:-[A-Z0-9]{1,12})*$/,
  },
  defaultCurrency: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{3}$/ },
  registeredAddress: {
    line1: { type: String, trim: true, default: '' },
    line2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    subdivision: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    countryCode: { type: String, uppercase: true, trim: true, default: '' },
  },
  taxRegistrations: { type: [TaxRegistrationSchema], default: [] },
  taxJurisdictionConfigId: { type: Schema.Types.ObjectId, ref: 'TaxJurisdictionConfig', default: null },
  taxJurisdictionVersionId: { type: Schema.Types.ObjectId, default: null },
  taxAdapterCandidateId: { type: String, uppercase: true, trim: true, default: '' },
  status: { type: String, enum: ['draft', 'active', 'inactive'], default: 'draft', index: true },
  createdBy: { type: String, required: true },
  lastModifiedBy: { type: String, default: '' },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

PayrollEmployerEntitySchema.index({ organizationId: 1, code: 1 }, { unique: true });
PayrollEmployerEntitySchema.index({ organizationId: 1, status: 1, legalName: 1 });

PayrollEmployerEntitySchema.pre('validate', function validateJurisdiction(next) {
  if (this.countryCode && this.jurisdictionCode && !this.jurisdictionCode.startsWith(`${this.countryCode}`)) {
    this.invalidate('jurisdictionCode', 'Jurisdiction code must belong to the employer country');
  }
  if (this.registeredAddress?.countryCode && this.countryCode
    && this.registeredAddress.countryCode !== this.countryCode) {
    this.invalidate('registeredAddress.countryCode', 'Registered address country must match the legal employer country');
  }
  next();
});

module.exports = mongoose.models.PayrollEmployerEntity
  || mongoose.model('PayrollEmployerEntity', PayrollEmployerEntitySchema);
