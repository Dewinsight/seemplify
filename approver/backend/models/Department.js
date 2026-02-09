const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// Unique department name per organization
DepartmentSchema.index({ name: 1, organization: 1 }, { unique: true });

module.exports = mongoose.model('Department', DepartmentSchema);
