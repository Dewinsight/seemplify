const mongoose = require('mongoose');

const CVProcessingBatchSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  jobs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CVProcessingJob' }],
  rejected: [{ fileName: String, error: String }],
  totalFiles: { type: Number, required: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
}, { timestamps: true });

CVProcessingBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CVProcessingBatch', CVProcessingBatchSchema);
