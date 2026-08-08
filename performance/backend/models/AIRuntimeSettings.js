'use strict';

const mongoose = require('mongoose');

const AIRuntimeSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },
  localEnabled: { type: Boolean, default: true },
  chatgptEnabled: { type: Boolean, default: true },
  defaultRuntime: { type: String, enum: ['local', 'chatgpt'], default: 'local' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('PerformanceAIRuntimeSettings', AIRuntimeSettingsSchema);
