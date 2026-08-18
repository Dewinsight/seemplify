const mongoose = require('mongoose');

const CVStorageCleanupTaskSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  provider: {
    type: String,
    required: true,
    enum: ['gridfs', 'cloudinary', 'embedding'],
    index: true
  },
  state: {
    type: String,
    required: true,
    enum: ['held', 'pending', 'failed', 'completed'],
    default: 'pending',
    index: true
  },
  // Held erasure tasks are activated only after the candidate tombstone is
  // durably committed. This prevents a failed delete write from racing a
  // cleanup worker and erasing assets belonging to a still-visible record.
  activationKey: { type: String, index: true },
  resource: {
    bucket: String,
    fileId: String,
    publicId: String,
    storageProvider: { type: String, enum: ['cloudinary', 'azure-blob'] },
    storageKey: String,
    storageContainer: String,
    assetId: String,
    resourceType: String,
    deliveryType: String,
    candidateId: String
  },
  reason: { type: String, required: true },
  jobPublicId: { type: String, index: true },
  attempts: { type: Number, default: 0, min: 0 },
  lastAttemptAt: Date,
  // Provider side effects such as an in-flight Cloudinary upload can have an
  // uncertain outcome for a short period. Keep the receipt durable but do not
  // declare a not-found delete complete until this fence has elapsed.
  notBefore: Date,
  reconcileUntil: Date,
  nextAttemptAt: { type: Date, index: true },
  lastError: String,
  completedAt: Date,
  expiresAt: Date
}, { timestamps: true, minimize: false });

CVStorageCleanupTaskSchema.index({ state: 1, nextAttemptAt: 1, createdAt: 1 });
// Only completed receipts are eligible for TTL expiry. Held/pending/failed
// receipts may be the sole durable pointer to a deleted candidate's asset.
CVStorageCleanupTaskSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { state: 'completed' },
    name: 'expire_completed_cv_cleanup_tasks'
  }
);

module.exports = mongoose.model('CVStorageCleanupTask', CVStorageCleanupTaskSchema);
