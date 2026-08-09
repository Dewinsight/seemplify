const { Shift, LeaveSnapshot } = require('../models');

async function findShiftConflicts({ organizationId, userId, startAt, endAt, excludeShiftId, minimumRestMinutes = 0 }) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const errors = [];
    const warnings = [];
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        errors.push({ code: 'INVALID_RANGE', message: 'Shift end must be after shift start' });
        return { valid: false, errors, warnings };
    }
    if (!userId) return { valid: true, errors, warnings };

    const overlap = await Shift.findOne({
        organizationId,
        userId,
        status: { $ne: 'cancelled' },
        ...(excludeShiftId ? { _id: { $ne: excludeShiftId } } : {}),
        startAt: { $lt: end },
        endAt: { $gt: start },
    }).lean();
    if (overlap) errors.push({ code: 'SHIFT_OVERLAP', message: 'This employee already has an overlapping shift', shiftId: overlap._id });

    const leave = await LeaveSnapshot.findOne({
        organizationId,
        userId,
        status: 'approved',
        startAt: { $lt: end },
        endAt: { $gt: start },
    }).lean();
    if (leave) errors.push({ code: 'LEAVE_CONFLICT', message: 'This shift overlaps approved leave', leaveId: leave.externalLeaveId });

    if (minimumRestMinutes > 0) {
        const previous = await Shift.findOne({ organizationId, userId, status: { $ne: 'cancelled' }, endAt: { $lte: start } }).sort({ endAt: -1 }).lean();
        const next = await Shift.findOne({ organizationId, userId, status: { $ne: 'cancelled' }, startAt: { $gte: end } }).sort({ startAt: 1 }).lean();
        if (previous && (start - new Date(previous.endAt)) / 60000 < minimumRestMinutes) warnings.push({ code: 'INSUFFICIENT_REST', message: 'Rest before this shift is below policy', shiftId: previous._id });
        if (next && (new Date(next.startAt) - end) / 60000 < minimumRestMinutes) warnings.push({ code: 'INSUFFICIENT_REST', message: 'Rest after this shift is below policy', shiftId: next._id });
    }
    return { valid: errors.length === 0, errors, warnings };
}

module.exports = { findShiftConflicts };
