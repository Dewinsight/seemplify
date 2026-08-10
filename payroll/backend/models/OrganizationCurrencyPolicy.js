const mongoose = require('mongoose');

const { Schema } = mongoose;

const EnabledCurrencySchema = new Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
  },
  paymentEnabled: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const CustomCurrencySchema = new Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
  },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  symbol: { type: String, required: true, trim: true, maxlength: 12 },
  minorUnits: { type: Number, min: 0, max: 6, default: 2 },
  isActive: { type: Boolean, default: true },
  usage: {
    type: String,
    enum: ['reporting_only'],
    default: 'reporting_only',
  },
  nonStatutoryOnly: { type: Boolean, default: true, immutable: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const OrganizationCurrencyPolicySchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  functionalCurrency: {
    type: String,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
    default: 'USD',
  },
  reportingCurrency: {
    type: String,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
    default: 'USD',
  },
  enabledCurrencies: { type: [EnabledCurrencySchema], default: [] },
  customCurrencies: { type: [CustomCurrencySchema], default: [] },
  taxCurrencyCatalogVersion: { type: Number, min: 0, default: 0 },
  requireConfiguredPaymentCurrency: { type: Boolean, default: true },
  lastModifiedBy: {
    userId: { type: String, default: '' },
    name: { type: String, default: '' },
  },
}, { timestamps: true });

OrganizationCurrencyPolicySchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    organizationId: this.organizationId,
    functionalCurrency: this.functionalCurrency,
    reportingCurrency: this.reportingCurrency,
    enabledCurrencies: this.enabledCurrencies || [],
    customCurrencies: this.customCurrencies || [],
    taxCurrencyCatalogVersion: this.taxCurrencyCatalogVersion || 0,
    requireConfiguredPaymentCurrency: this.requireConfiguredPaymentCurrency !== false,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.models.OrganizationCurrencyPolicy
  || mongoose.model('OrganizationCurrencyPolicy', OrganizationCurrencyPolicySchema);
