const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    criteria: { type: String, required: true }, // The logical rule prompt for AI
    weight: { type: Number, min: 1, max: 10, default: 1 },
    isMandatory: { type: Boolean, default: false },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' }, // Null = Global within org
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Rule', RuleSchema);
