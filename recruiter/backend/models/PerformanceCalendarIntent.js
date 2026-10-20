'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true },
  browserProofHash: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  identity: { type: mongoose.Schema.Types.Mixed, required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  previousGrantId: { type: String, default: null },
  returnPath: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });
module.exports = mongoose.models.PerformanceCalendarIntent || mongoose.model('PerformanceCalendarIntent', schema);
