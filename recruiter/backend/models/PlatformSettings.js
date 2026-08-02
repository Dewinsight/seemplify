const mongoose = require('mongoose');
const {
  DEFAULT_PLATFORM_FEATURE_FLAGS,
  PLATFORM_FEATURE_KEYS
} = require('../config/platformFeatures');

const featureFlagSchema = PLATFORM_FEATURE_KEYS.reduce((schema, key) => {
  schema[key] = {
    type: Boolean,
    default: DEFAULT_PLATFORM_FEATURE_FLAGS[key]
  };
  return schema;
}, {});

const PlatformSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'global',
    unique: true,
    immutable: true
  },
  featureFlags: featureFlagSchema,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PlatformSettings', PlatformSettingsSchema);
