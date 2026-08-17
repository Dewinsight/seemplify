const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  organizationId: { type: String, required: true, index: true },
  envelope: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'delivering', 'delivered', 'failed', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 8 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseUntil: Date,
  deliveredAt: Date,
  responseStatus: Number,
  lastError: { type: String, default: '' },
}, { timestamps: true });

schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
module.exports = mongoose.models.LeaveAutomationEventOutbox
  || mongoose.model('LeaveAutomationEventOutbox', schema);
