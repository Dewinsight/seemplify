const mongoose = require('mongoose');

const AutomationEventOutboxSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  organizationId: { type: String, required: true, index: true },
  envelope: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'delivering', 'failed', 'delivered', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 12 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseUntil: Date,
  responseStatus: Number,
  lastError: String,
  deliveredAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('PayrollAutomationEventOutbox', AutomationEventOutboxSchema);
