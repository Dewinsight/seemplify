'use strict';
const mongoose = require('mongoose');
const peer = new mongoose.Schema({ id: String, claimId: String, seenAt: Date, consentAt: Date }, { _id: false });
const schema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  manager: peer, employee: peer,
  offer: mongoose.Schema.Types.Mixed, answer: mongoose.Schema.Types.Mixed,
  recordingPeer: String, recordingUntil: Date, recordingActive: Boolean,
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });
module.exports = mongoose.model('AppraisalCall', schema);
