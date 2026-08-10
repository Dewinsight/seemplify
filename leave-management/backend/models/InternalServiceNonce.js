'use strict';

const mongoose = require('mongoose');

const internalServiceNonceSchema = new mongoose.Schema({
  serviceId: {
    type: String,
    required: true,
    maxlength: 100,
  },
  nonceHash: {
    type: String,
    required: true,
    maxlength: 64,
  },
  requestTimestamp: {
    type: Date,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
}, {
  timestamps: true,
  versionKey: false,
});

// The database, rather than process memory, is the replay boundary so this
// remains safe when Leave Management is running on multiple instances.
internalServiceNonceSchema.index(
  { serviceId: 1, nonceHash: 1 },
  { unique: true, name: 'unique_internal_service_nonce' }
);

module.exports = mongoose.models.InternalServiceNonce
  || mongoose.model('InternalServiceNonce', internalServiceNonceSchema);
