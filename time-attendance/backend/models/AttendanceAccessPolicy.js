const mongoose = require('mongoose');

const { Schema } = mongoose;

const AttendanceAccessPolicySchema = new Schema({
    organizationId: { type: String, required: true, unique: true, index: true },
    roles: [{
        _id: false,
        key: { type: String, required: true },
        name: { type: String, required: true },
        description: String,
        scope: { type: String, enum: ['self', 'reports', 'organization'], required: true },
        sourceRoles: [String],
        permissions: [String],
        locked: { type: Boolean, default: false },
    }],
    assignments: [{
        _id: false,
        userId: { type: String, required: true },
        userName: String,
        userEmail: String,
        roleKeys: [String],
        assignedBy: String,
        assignedByName: String,
        assignedAt: Date,
    }],
    auditLog: [{
        action: String,
        actorId: String,
        actorName: String,
        at: { type: Date, default: Date.now },
        details: String,
    }],
    updatedBy: String,
}, { timestamps: true });

AttendanceAccessPolicySchema.index({ organizationId: 1, 'assignments.userId': 1 });

module.exports = mongoose.model('AttendanceAccessPolicy', AttendanceAccessPolicySchema);
