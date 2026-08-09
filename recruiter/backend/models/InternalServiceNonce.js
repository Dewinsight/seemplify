'use strict';

const mongoose = require('mongoose');

// A unique, expiring replay claim shared by every Recruiter replica. Mongo is
// already required for authenticated requests, so replay protection fails
// closed instead of silently becoming process-local when Redis is unavailable.
const InternalServiceNonceSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, maxlength: 260 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('InternalServiceNonce', InternalServiceNonceSchema);
