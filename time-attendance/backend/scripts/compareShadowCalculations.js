const mongoose = require('mongoose');
const {
    Timesheet, TimeEntry, AttendancePolicy, EmployeeRoster, LeaveSnapshot, PublicHolidaySnapshot,
} = require('../models');
const { calculatePeriod } = require('../services/timeCalculationService');
const { resolveCalculationPolicy } = require('../services/rulePackService');

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function numeric(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function summaryDiff(stored = {}, shadow = {}) {
    const fields = [
        'totalHours', 'regularHours', 'overtimeHours', 'breakTime', 'daysWorked',
        'daysAbsent', 'daysOnLeave', 'lateDays', 'earlyDepartures', 'incompleteEntries',
    ];
    return Object.fromEntries(fields.map(field => [field, {
        stored: numeric(stored[field]),
        shadow: numeric(shadow[field]),
        delta: numeric(Number(shadow[field] || 0) - Number(stored[field] || 0)),
    }]));
}

async function shadowTimesheet(timesheet) {
    const [policy, roster, entries, leaves, holidays] = await Promise.all([
        AttendancePolicy.findOne({ organizationId: timesheet.organizationId }).lean(),
        EmployeeRoster.findOne({ organizationId: timesheet.organizationId, userId: timesheet.userId }).lean(),
        TimeEntry.find({
            organizationId: timesheet.organizationId,
            userId: timesheet.userId,
            timestamp: { $gte: timesheet.startDate, $lte: timesheet.endDate },
        }).sort({ timestamp: 1 }).lean(),
        LeaveSnapshot.find({ organizationId: timesheet.organizationId, userId: timesheet.userId, status: 'approved', startAt: { $lte: timesheet.endDate }, endAt: { $gte: timesheet.startDate } }).lean(),
        PublicHolidaySnapshot.find({ organizationId: timesheet.organizationId, status: 'active', $or: [{ date: { $gte: timesheet.startDate, $lte: timesheet.endDate } }, { isRecurring: true }] }).lean(),
    ]);
    const basePolicy = policy || new AttendancePolicy({
        organizationId: timesheet.organizationId,
        organizationName: timesheet.organizationName,
    }).toObject();
    const effective = await resolveCalculationPolicy({
        policy: basePolicy,
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        teamId: timesheet.teamId || roster?.teamIds?.[0],
        countryCode: roster?.jurisdiction?.countryCode,
        subdivisionCode: roster?.jurisdiction?.subdivisionCode,
        rulePackId: roster?.rulePackAssignment?.rulePackId,
        at: timesheet.endDate,
    });
    const calculation = calculatePeriod(entries, { start: timesheet.startDate, end: timesheet.endDate }, effective.policy, { leaves, holidays });
    const differences = summaryDiff(timesheet.summary, calculation.summary);
    const materialFields = Object.entries(differences).filter(([, value]) => Math.abs(value.delta) > 0.01).map(([field]) => field);
    return {
        timesheetId: timesheet._id,
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        version: timesheet.version || 1,
        status: timesheet.status,
        period: { startAt: timesheet.startDate, endAt: timesheet.endDate },
        appliedRulePacks: effective.applied.map(item => ({ key: item.key, version: item.version })),
        materialFields,
        differences,
    };
}

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    const organizationId = argument('--organization', '');
    const limit = Math.min(10000, Math.max(1, Number(argument('--limit', '500'))));
    await mongoose.connect(uri);
    try {
        const query = organizationId ? { organizationId } : {};
        const timesheets = await Timesheet.find(query).sort({ endDate: -1 }).limit(limit);
        const results = [];
        for (const timesheet of timesheets) results.push(await shadowTimesheet(timesheet));
        const mismatches = results.filter(item => item.materialFields.length > 0);
        console.log(JSON.stringify({
            readOnly: true,
            organizationId: organizationId || 'all',
            compared: results.length,
            matching: results.length - mismatches.length,
            mismatching: mismatches.length,
            mismatches,
        }, null, 2));
        if (mismatches.length) process.exitCode = 2;
    } finally {
        await mongoose.disconnect();
    }
}

run().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
