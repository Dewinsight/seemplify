const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * CurrencySyncSettings
 *
 * Stores organization-level preferences for exchange-rate sync so payroll can
 * keep daily rates fresh while still allowing HR to override individual pairs.
 */
const CurrencySyncSettingsSchema = new Schema({
  organizationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  provider: {
    type: String,
    enum: ['open_er_api'],
    default: 'open_er_api',
  },

  providerBaseCurrency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
    maxlength: 3,
  },

  autoSyncEnabled: {
    type: Boolean,
    default: true,
  },

  preserveManualOverrides: {
    type: Boolean,
    default: true,
  },

  autoSeedOnEmpty: {
    type: Boolean,
    default: true,
  },

  lastSyncStatus: {
    type: String,
    enum: ['never', 'success', 'partial', 'failed'],
    default: 'never',
  },

  lastSyncMessage: String,
  lastSyncAt: Date,
  lastSyncStartedAt: Date,
  lastSyncCompletedAt: Date,
  lastSyncedRates: {
    type: Number,
    default: 0,
  },
  skippedManualOverrides: {
    type: Number,
    default: 0,
  },

  lastProviderUpdateAt: Date,
  nextProviderUpdateAt: Date,
  lastProviderBaseCurrency: String,
  lastProviderResult: String,

  createdBy: String,
  createdByName: String,
  updatedBy: String,
  updatedByName: String,
}, {
  timestamps: true,
});

module.exports = mongoose.model('CurrencySyncSettings', CurrencySyncSettingsSchema);
