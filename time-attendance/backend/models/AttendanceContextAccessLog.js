const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AttendanceContextAccessLogSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },
    viewerId: { type: String, required: true, index: true },
    viewerRole: String,
    sourceApplication: { type: String, default: 'performance-management' },
    purpose: { type: String, default: 'performance_review_context' },
    reviewId: String,
    periodStart: Date,
    periodEnd: Date,
    correlationId: String,
    ipHash: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
AttendanceContextAccessLogSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

module.exports = mongoose.model('AttendanceContextAccessLog', AttendanceContextAccessLogSchema);
