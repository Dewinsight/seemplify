const { AttendancePolicy, EmployeeRoster } = require('../models');
const { defaultSchedulingSettings } = require('./schedulingPolicyService');

async function seedDefaultAttendancePolicies({ organizationIds, actorId = 'system:default-policy-seed' } = {}) {
    const discovered = organizationIds || [
        ...await AttendancePolicy.distinct('organizationId'),
        ...await EmployeeRoster.distinct('organizationId'),
    ];
    const ids = [...new Set(discovered.map(String).filter(Boolean))];
    let created = 0;
    let updated = 0;

    for (const organizationId of ids) {
        const existing = await AttendancePolicy.findOne({ organizationId }).select('_id schedulingSettings workSchedule.maximumHoursPerWeek').lean();
        if (!existing) {
            await AttendancePolicy.getOrCreateDefault(organizationId, '', actorId);
            created += 1;
            continue;
        }
        const set = {};
        if (!existing.schedulingSettings) set.schedulingSettings = defaultSchedulingSettings();
        if (existing.workSchedule?.maximumHoursPerWeek == null) set['workSchedule.maximumHoursPerWeek'] = 48;
        if (Object.keys(set).length) {
            await AttendancePolicy.updateOne(
                { organizationId },
                { $set: { ...set, updatedBy: actorId, updatedAt: new Date() } }
            );
            updated += 1;
        }
    }
    return { organizations: ids.length, created, updated };
}

module.exports = { seedDefaultAttendancePolicies };
