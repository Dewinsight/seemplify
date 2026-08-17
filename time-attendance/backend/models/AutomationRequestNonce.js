const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

module.exports = mongoose.models.TimeAutomationRequestNonce
    || mongoose.model('TimeAutomationRequestNonce', schema);
