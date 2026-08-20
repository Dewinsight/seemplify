const mongoose = require('mongoose');

const PayrollDeliverySchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollCycle', required: true, index: true },
  requestKey: { type: String, required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollAccountingContact', default: null },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true },
  artifactIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PayrollArtifact' }],
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed', 'expired', 'revoked'], default: 'pending' },
  attemptCount: { type: Number, default: 0 },
  lastAttemptAt: Date,
  sentAt: Date,
  openedAt: Date,
  downloadedAt: Date,
  nextRetryAt: Date,
  providerMessageId: String,
  failureCode: String,
  tokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: Date,
  revokedBy: String,
  audit: [{
    action: { type: String, enum: ['created', 'sent', 'failed', 'opened', 'downloaded', 'expired', 'revoked'] },
    actorId: String,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

PayrollDeliverySchema.index({ organizationId: 1, cycleId: 1, recipientEmail: 1 });
PayrollDeliverySchema.index({ organizationId: 1, cycleId: 1, recipientEmail: 1, requestKey: 1 }, { unique: true });
module.exports = mongoose.model('PayrollDelivery', PayrollDeliverySchema);
