const mongoose = require('mongoose');

const AutomationRequestNonceSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

module.exports = mongoose.model('PayrollAutomationRequestNonce', AutomationRequestNonceSchema);
