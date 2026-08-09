const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EmployeeRosterSchema = new Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    idpAccountId: { type: String, index: true },
    employeeId: String,
    email: { type: String, lowercase: true, trim: true },
    name: String,
    status: { type: String, enum: ['active', 'inactive', 'scheduled_exit'], default: 'active', index: true },
    role: String,
    teamIds: [String],
    managerId: String,
    departmentId: String,
    jurisdiction: {
        countryCode: { type: String, uppercase: true },
        subdivisionCode: { type: String, uppercase: true },
    },
    appAccess: {
        mode: { type: String, enum: ['all', 'selected'], default: 'all' },
        appIds: [String],
    },
    employmentStartAt: Date,
    effectiveExitAt: Date,
    sourceUpdatedAt: Date,
    lastReconciledAt: Date,
    lastEventId: String,
}, { timestamps: true });
EmployeeRosterSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
EmployeeRosterSchema.index({ organizationId: 1, idpAccountId: 1 }, { sparse: true });
EmployeeRosterSchema.index({ organizationId: 1, status: 1, teamIds: 1 });

module.exports = mongoose.model('EmployeeRoster', EmployeeRosterSchema);
