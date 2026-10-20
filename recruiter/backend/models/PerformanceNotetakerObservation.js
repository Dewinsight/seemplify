'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  organizationId: { type: String, required: true }, ownerSubject: { type: String, required: true }, externalId: { type: String, required: true },
  state: String, meetingState: String, lastCheckedAt: Date,
  events: [{ _id: false, state: String, meetingState: String, observedAt: Date }]
}, { timestamps: true });
schema.index({ organizationId: 1, ownerSubject: 1, externalId: 1 }, { unique: true });
module.exports = mongoose.models.PerformanceNotetakerObservation || mongoose.model('PerformanceNotetakerObservation', schema);
