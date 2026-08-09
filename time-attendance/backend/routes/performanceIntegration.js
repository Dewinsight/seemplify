const crypto = require('crypto');
const express = require('express');
const { Timesheet, AttendanceContextAccessLog } = require('../models');

const router = express.Router();

function verify(req, res, next) {
    const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_PERFORMANCE_SECRET || '';
    if (!secret) {
        if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Performance integration authentication is not configured' });
        return next();
    }
    const timestamp = String(req.get('x-service-timestamp') || '');
    const signature = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
    if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) return res.status(401).json({ error: 'Expired service request' });
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
    next();
}

router.use(verify);

router.post('/attendance-summary', async (req, res) => {
    const { organizationId, employeeId, periodStart, periodEnd, viewerId, viewerRole, reviewId, correlationId } = req.body || {};
    if (!organizationId || !employeeId || !periodStart || !periodEnd || !viewerId) return res.status(400).json({ error: 'organizationId, employeeId, periodStart, periodEnd and viewerId are required' });
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return res.status(400).json({ error: 'Invalid review period' });
    const timesheets = await Timesheet.find({
        organizationId,
        userId: employeeId,
        status: { $in: ['approved', 'locked', 'payroll_pending', 'payroll_exported'] },
        startDate: { $lte: end },
        endDate: { $gte: start },
    }).sort({ startDate: 1, version: -1 }).lean();
    const latestByPeriod = new Map();
    for (const timesheet of timesheets) {
        const key = `${timesheet.periodKey || timesheet.startDate}`;
        if (!latestByPeriod.has(key)) latestByPeriod.set(key, timesheet);
    }
    const latestVersions = Array.from(latestByPeriod.values());
    const dailyEntries = latestVersions.flatMap(timesheet => (timesheet.dailyEntries || []).filter(entry => new Date(entry.date) >= start && new Date(entry.date) <= end));
    const exceptions = dailyEntries.flatMap(entry => (entry.exceptions || []).map(exception => ({ date: entry.date, type: exception.type, description: exception.description, minutes: exception.minutes, status: exception.status || 'unresolved' })));
    const summary = {
        employeeId,
        organizationId,
        reviewPeriod: { start, end },
        approvedHours: Math.round(dailyEntries.reduce((sum, entry) => sum + Number(entry.totalHours || 0), 0) * 100) / 100,
        regularHours: Math.round(dailyEntries.reduce((sum, entry) => sum + Number(entry.regularHours || 0), 0) * 100) / 100,
        overtimeHours: Math.round(dailyEntries.reduce((sum, entry) => sum + Number(entry.overtimeHours || 0), 0) * 100) / 100,
        absences: dailyEntries.filter(entry => entry.status === 'absent').length,
        leaveDays: dailyEntries.filter(entry => entry.status === 'leave').length,
        lateArrivals: exceptions.filter(exception => exception.type === 'late_arrival').length,
        punctuality: {
            scheduledDays: dailyEntries.filter(entry => !['weekend', 'leave', 'holiday'].includes(entry.status)).length,
            lateDays: exceptions.filter(exception => exception.type === 'late_arrival').length,
        },
        exceptions: {
            resolved: exceptions.filter(exception => exception.status === 'resolved'),
            unresolved: exceptions.filter(exception => exception.status !== 'resolved'),
        },
        timesheetVersions: latestVersions.map(timesheet => ({ id: timesheet._id, version: timesheet.version, status: timesheet.status, rulePack: timesheet.policySnapshot })),
        disclaimer: 'Attendance is review context only. It does not calculate or modify a performance rating.',
    };
    await AttendanceContextAccessLog.create({
        organizationId, employeeId, viewerId, viewerRole, reviewId, periodStart: start, periodEnd: end, correlationId,
        ipHash: crypto.createHash('sha256').update(`${process.env.ACCESS_LOG_HASH_SALT || 'attendance'}:${req.ip || ''}`).digest('hex'),
    });
    res.json({ summary });
});

module.exports = router;
