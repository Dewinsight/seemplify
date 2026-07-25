const mongoose = require('mongoose');

const CVStorageCleanupTaskSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  provider: {
    type: String,
    required: true,
    enum: ['gridfs', 'cloudinary'],
    index: true
  },
  state: {
    type: String,
    required: true,
    enum: ['pending', 'failed', 'completed'],
    default: 'pending',
    index: true
  },
  resource: {
    bucket: String,
    fileId: String,
    publicId: String,
    assetId: String,
    resourceType: String,
    deliveryType: String
  },
  reason: { type: String, required: true },
  jobPublicId: { type: String, index: true },
  attempts: { type: Number, default: 0, min: 0 },
  lastAttemptAt: Date,
  nextAttemptAt: { type: Date, index: true },
  lastError: String,
  completedAt: Date,
  expiresAt: Date
}, { timestamps: true, minimize: false });

CVStorageCleanupTaskSchema.index({ state: 1, nextAttemptAt: 1, createdAt: 1 });
CVStorageCleanupTaskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CVStorageCleanupTask', CVStorageCleanupTaskSchema);
