const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    repoUrl: { type: String },
    filePath: { type: String }, // For local analysis if needed
    analysisResult: { type: Object }, // Store entire AI response
    approvalStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Under Review'], default: 'Pending' },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Under Review'], default: 'Pending' },
    score: { type: Number, default: 0 },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overrideReason: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Project', ProjectSchema);
