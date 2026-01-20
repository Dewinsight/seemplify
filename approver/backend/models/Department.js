const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: String,
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Department', DepartmentSchema);
