'use strict';

const mongoose = require('mongoose');

const AIUserRuntimeAccountSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true, trim: true },
  subjectKey: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['disconnected', 'pending', 'connected'],
    default: 'disconnected',
    index: true
  },
  connectedEmail: { type: String, default: '' },
  planType: { type: String, default: '' },
  connectedAt: { type: Date, default: null },
  lastVerifiedAt: { type: Date, default: null },
  disconnectedAt: { type: Date, default: null },
  dataSharingAcknowledgedAt: { type: Date, default: null },
  rateLimits: { type: mongoose.Schema.Types.Mixed, default: null },
  usageLimit: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: '' }
}, { timestamps: true });

AIUserRuntimeAccountSchema.methods.isRoutable = function isRoutable() {
  return this.status === 'connected' && Boolean(this.dataSharingAcknowledgedAt);
};

AIUserRuntimeAccountSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    status: this.status,
    connectedEmail: this.connectedEmail || null,
    planType: this.planType || null,
    connectedAt: this.connectedAt,
    lastVerifiedAt: this.lastVerifiedAt,
    dataSharingAcknowledgedAt: this.dataSharingAcknowledgedAt,
    routable: this.isRoutable(),
    rateLimits: this.rateLimits || null,
    usageLimit: this.usageLimit || null,
    lastError: this.lastError || null
  };
};

module.exports = mongoose.model('AIUserRuntimeAccount', AIUserRuntimeAccountSchema);
