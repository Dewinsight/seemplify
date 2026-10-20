'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true },
  ownerSubject: { type: String, required: true },
  externalId: { type: String, required: true },
  grantId: String,
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'NylasAccount' },
  state: { type: String, default: 'provisioning' },
  eventId: String,
  calendarId: String,
  conferenceUrl: String,
  notetakerId: String,
  recordingState: String,
  recordingPolicyVersion: String,
  recordingAuthorization: mongoose.Schema.Types.Mixed,
  participantSubjects: [String],
  recordingCancellationUncertain: Boolean,
  scheduledDate: Date,
  duration: Number
}, { timestamps: true });
schema.index({ organizationId: 1, ownerSubject: 1, externalId: 1 }, { unique: true });
module.exports = mongoose.model('PerformanceMeeting', schema);
