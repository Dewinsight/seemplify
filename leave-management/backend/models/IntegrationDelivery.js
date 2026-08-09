const mongoose = require('mongoose');

const IntegrationDeliverySchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  event: { type: String, required: true, index: true },
  target: {
    type: String,
    enum: ['time_attendance', 'performance'],
    default: 'time_attendance',
    index: true,
  },
  endpoint: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  // Time Attendance uses the stable leave signature stored here. Performance
  // is signed immediately before each attempt because its timestamp is part of
  // the signature and must stay inside the receiver's replay window.
  signature: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'delivering', 'delivered', 'failed', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 10 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseUntil: Date,
  lastError: String,
  responseStatus: Number,
  deliveredAt: Date,
}, { timestamps: true });
IntegrationDeliverySchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });

module.exports = mongoose.model('LeaveIntegrationDelivery', IntegrationDeliverySchema);
