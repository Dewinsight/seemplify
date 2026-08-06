const mongoose = require('mongoose');

const AIUsageProjectionStateSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: Number, default: 0 },
  compatibilityVersion: Number,
  compatibilityStatus: {
    type: String,
    enum: ['running', 'complete', 'failed']
  },
  compatibilityOwner: String,
  compatibilityLeaseUntil: Date,
  compatibilityStartedAt: Date,
  compatibilityCompletedAt: Date,
  compatibilityLastError: String,
  compatibilityResult: mongoose.Schema.Types.Mixed,
  repairStatus: {
    type: String,
    enum: ['idle', 'running', 'complete', 'failed']
  },
  repairOwner: String,
  repairStartedAt: Date,
  repairCompletedAt: Date,
  repairLastError: String,
  repairProcessed: Number,
  repairRemaining: Number
}, {
  timestamps: true,
  versionKey: false
});

module.exports = mongoose.model('AIUsageProjectionState', AIUsageProjectionStateSchema);
