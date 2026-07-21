const mongoose = require('mongoose');

const AIAuditEventSchema = new mongoose.Schema({
  category: { type: String, enum: ['configuration', 'credential', 'alert', 'health'], required: true, index: true },
  action: { type: String, required: true, index: true },
  status: { type: String, enum: ['success', 'failed', 'sent', 'suppressed'], default: 'success' },
  actorAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  actorEmail: String,
  targetType: String,
  targetId: String,
  quotaGroup: String,
  model: String,
  message: String,
  metadata: mongoose.Schema.Types.Mixed,
  dedupeKey: String,
  ipAddress: String,
  userAgent: String
}, { timestamps: true, minimize: false });

AIAuditEventSchema.index({ createdAt: -1 });
AIAuditEventSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AIAuditEvent', AIAuditEventSchema);
