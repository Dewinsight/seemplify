const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, isHRAdmin, isLineManager } = require('../middleware/auth');
const { TimeEntry, Timesheet, AttendancePolicy } = require('../models');
const { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays, format } = require('date-fns');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);

// Get dashboard statistics
router.get('/dashboard', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        // Get clock status
        const clockStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);

        // Get today's work time
        const todayEntries = await TimeEntry.getTodayEntries(userId, organizationId);
        const todayStats = calculateDayStats(todayEntries);

        // Get current week stats
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

        const weekEntries = await TimeEntry.find({
            userId,
            organizationId,
            timestamp: { $gte: weekStart, $lte: weekEnd },
        }).sort({ timestamp: 1 });

        const weekStats = calculateWeekStats(weekEntries);

        // Get current timesheet
        const currentTimesheet = await Timesheet.findOne({
            userId,
            organizationId,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() },
        });

        // Get pending approvals count (for managers)
        let pendingApprovalsCount = 0;
        if (isHRAdmin(req) || isLineManager(req)) {
            pendingApprovalsCount = await Timesheet.countDocuments({
                organizationId,
                status: 'submitted',
                ...(isLineManager(req) && !isHRAdmin(req)
                    ? { 'assignedApprover.userId': userId }
                    : {}
                ),
            });
        }

        res.json({
            clock: {
                isClockedIn: clockStatus.isClockedIn,
                isOnBreak: breakStatus.onBreak,
                clockInTime: clockStatus.lastEntry?.timestamp,
            },
            today: todayStats,
            week: weekStats,
            currentTimesheet: currentTimesheet ? {
                id: currentTimesheet._id,
                status: currentTimesheet.status,
                weekNumber: currentTimesheet.weekNumber,
                summary: currentTimesheet.summary,
            } : null,
            pendingApprovals: pendingApprovalsCount,
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

// Get team attendance (for managers)
router.get('/team', async (req, res) => {
    try {
        const organizationId = req.organizationId;

        if (!isHRAdmin(req) && !isLineManager(req)) {
            return res.status(403).json({ error: 'Manager access required' });
        }

        // Get all users who have clocked in today
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const todayActivity = await TimeEntry.aggregate([
            {
                $match: {
                    organizationId,
                    timestamp: { $gte: todayStart, $lte: todayEnd },
                },
            },
            {
                $sort: { timestamp: -1 },
            },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    userEmail: { $first: '$userEmail' },
                    teamName: { $first: '$teamName' },
                    lastEntry: { $first: '$$ROOT' },
                    entries: { $push: '$$ROOT' },
                },
            },
            {
                $project: {
                    userId: '$_id',
                    userName: 1,
                    userEmail: 1,
                    teamName: 1,
                    lastEntry: 1,
                    entryCount: { $size: '$entries' },
                },
            },
        ]);

        // Determine current status for each user
        const teamStatus = todayActivity.map(user => {
            const isClockedIn = user.lastEntry.entryType === 'clock_in' ||
                user.lastEntry.entryType === 'break_end';
            const isOnBreak = user.lastEntry.entryType === 'break_start';

            return {
                userId: user.userId,
                userName: user.userName,
                userEmail: user.userEmail,
                teamName: user.teamName,
                status: isOnBreak ? 'on_break' : (isClockedIn ? 'working' : 'clocked_out'),
                lastActivity: user.lastEntry.timestamp,
                lastActivityType: user.lastEntry.entryType,
            };
        });

        // Count by status
        const summary = {
            total: teamStatus.length,
            working: teamStatus.filter(u => u.status === 'working').length,
            onBreak: teamStatus.filter(u => u.status === 'on_break').length,
            clockedOut: teamStatus.filter(u => u.status === 'clocked_out').length,
        };

        res.json({
            team: teamStatus,
            summary,
        });
    } catch (error) {
        console.error('Get team attendance error:', error);
        res.status(500).json({ error: 'Failed to get team attendance' });
    }
});

// Get attendance summary for a period
router.get('/summary', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { startDate, endDate, period = 'month' } = req.query;

        let start, end;
        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else {
            // Default to last 30 days
            end = new Date();
            start = subDays(end, 30);
        }

        const timesheets = await Timesheet.find({
            userId,
            organizationId,
            startDate: { $gte: start },
            endDate: { $lte: end },
        }).sort({ startDate: -1 });

        // Aggregate stats
        let totalHours = 0;
        let regularHours = 0;
        let overtimeHours = 0;
        let daysWorked = 0;
        let lateDays = 0;

        for (const ts of timesheets) {
            if (ts.summary) {
                totalHours += ts.summary.totalHours || 0;
                regularHours += ts.summary.regularHours || 0;
                overtimeHours += ts.summary.overtimeHours || 0;
                daysWorked += ts.summary.daysWorked || 0;
                lateDays += ts.summary.lateDays || 0;
            }
        }

        res.json({
            period: { start, end },
            summary: {
                totalHours: parseFloat(totalHours.toFixed(2)),
                regularHours: parseFloat(regularHours.toFixed(2)),
                overtimeHours: parseFloat(overtimeHours.toFixed(2)),
                daysWorked,
                lateDays,
                timesheetCount: timesheets.length,
            },
            timesheets: timesheets.map(ts => ({
                id: ts._id,
                weekNumber: ts.weekNumber,
                year: ts.year,
                status: ts.status,
                summary: ts.summary,
            })),
        });
    } catch (error) {
        console.error('Get attendance summary error:', error);
        res.status(500).json({ error: 'Failed to get attendance summary' });
    }
});

// Helper function to calculate day stats from entries
function calculateDayStats(entries) {
    let clockInTime = null;
    let totalMinutes = 0;
    let breakMinutes = 0;
    let breakStartTime = null;

    for (const entry of entries) {
        switch (entry.entryType) {
            case 'clock_in':
                clockInTime = entry.timestamp;
                break;
            case 'clock_out':
                if (clockInTime) {
                    totalMinutes += (entry.timestamp - clockInTime) / (1000 * 60);
                    clockInTime = null;
                }
                break;
            case 'break_start':
                breakStartTime = entry.timestamp;
                break;
            case 'break_end':
                if (breakStartTime) {
                    breakMinutes += (entry.timestamp - breakStartTime) / (1000 * 60);
                    breakStartTime = null;
                }
                break;
        }
    }

    // If still clocked in, add time until now
    if (clockInTime) {
        totalMinutes += (Date.now() - clockInTime) / (1000 * 60);
    }

    // If still on break, add break time until now
    if (breakStartTime) {
        breakMinutes += (Date.now() - breakStartTime) / (1000 * 60);
    }

    const workMinutes = Math.max(0, totalMinutes - breakMinutes);

    return {
        hoursWorked: parseFloat((workMinutes / 60).toFixed(2)),
        minutesWorked: Math.round(workMinutes),
        breakMinutes: Math.round(breakMinutes),
        formatted: formatDuration(workMinutes),
    };
}

// Helper function to calculate week stats
function calculateWeekStats(entries) {
    const dayStats = {};

    for (const entry of entries) {
        const dateKey = format(entry.timestamp, 'yyyy-MM-dd');
        if (!dayStats[dateKey]) {
            dayStats[dateKey] = [];
        }
        dayStats[dateKey].push(entry);
    }

    let totalHours = 0;
    let daysWorked = 0;

    for (const [date, dayEntries] of Object.entries(dayStats)) {
        const stats = calculateDayStats(dayEntries);
        totalHours += stats.hoursWorked;
        if (stats.hoursWorked > 0) daysWorked++;
    }

    return {
        totalHours: parseFloat(totalHours.toFixed(2)),
        daysWorked,
        averageHoursPerDay: daysWorked > 0 ? parseFloat((totalHours / daysWorked).toFixed(2)) : 0,
    };
}

// Helper function to format duration
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
}

module.exports = router;
