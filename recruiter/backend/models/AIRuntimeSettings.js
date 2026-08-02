const mongoose = require('mongoose');
const { createDefaultRuntimeSettings } = require('../config/aiRuntimeCatalog');

const defaults = createDefaultRuntimeSettings();

const AIRuntimeSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },
  providerEnabled: { type: Boolean, default: true },
  models: { type: [mongoose.Schema.Types.Mixed], default: () => defaults.models },
  routes: { type: [mongoose.Schema.Types.Mixed], default: () => defaults.routes },
  quotaGroups: { type: [mongoose.Schema.Types.Mixed], default: () => defaults.quotaGroups },
  alerts: { type: mongoose.Schema.Types.Mixed, default: () => defaults.alerts },
  localFailover: { type: mongoose.Schema.Types.Mixed, default: () => defaults.localFailover },
  rollout: { type: mongoose.Schema.Types.Mixed, default: () => defaults.rollout },
  version: { type: Number, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('AIRuntimeSettings', AIRuntimeSettingsSchema);
