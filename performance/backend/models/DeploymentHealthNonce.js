'use strict';

const mongoose = require('mongoose');

const DeploymentHealthNonceSchema = new mongoose.Schema({
  // A string _id makes nonce uniqueness an intrinsic MongoDB guarantee even
  // before Mongoose has finished creating the secondary unique index.
  _id: { type: String, required: true },
  nonce: {
    type: String,
    required: true,
    unique: true,
    minlength: 16,
    maxlength: 128
  },
  requestTimestamp: { type: Date, required: true },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.DeploymentHealthNonce
  || mongoose.model('DeploymentHealthNonce', DeploymentHealthNonceSchema);
