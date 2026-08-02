const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', unique: true },
    minPassScore: { type: Number, default: 70 }, // percentage required to auto‑approve
    // future config fields can be added here
});

module.exports = mongoose.model('Settings', SettingsSchema);
