const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { Timesheet, TimeEntry } = require('../models');
const { startOfMonth, endOfMonth, parseISO, subMonths, format } = require('date-fns');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);
router.use(requireHRAdmin);

// Get monthly attendance report
router.get('/monthly', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { date } = req.query; // YYYY-MM-DD (any day in the month)

        let targetDate = date ? parseISO(date) : new Date();
        const start = startOfMonth(targetDate);
        const end = endOfMonth(targetDate);

        // Aggregate timesheet data for the month
        const report = await Timesheet.aggregate([
            {
                $match: {
                    organizationId,
                    startDate: { $gte: start },
                    endDate: { $lte: end },
                    status: 'approved',
                },
            },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    teamName: { $first: '$teamName' },
                    totalHours: { $sum: '$summary.totalHours' },
                    overtimeHours: { $sum: '$summary.overtimeHours' },
                    daysWorked: { $sum: '$summary.daysWorked' },
                    daysAbsent: { $sum: '$summary.daysAbsent' },
                    daysOnLeave: { $sum: '$summary.daysOnLeave' },
                    lateDays: { $sum: '$summary.lateDays' },
                    timesheets: { $sum: 1 },
                },
            },
            { $sort: { teamName: 1, userName: 1 } },
        ]);

        res.json({
            period: { start, end },
            report,
        });
    } catch (error) {
        console.error('Monthly report error:', error);
        res.status(500).json({ error: 'Failed to generate monthly report' });
    }
});

// Get overtime report
router.get('/overtime', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { startDate, endDate } = req.query; // YYYY-MM-DD

        let start = startDate ? parseISO(startDate) : startOfMonth(new Date());
        let end = endDate ? parseISO(endDate) : endOfMonth(new Date());

        const report = await Timesheet.aggregate([
            {
                $match: {
                    organizationId,
                    startDate: { $gte: start },
                    endDate: { $lte: end },
                    status: 'approved',
                    'summary.overtimeHours': { $gt: 0 },
                },
            },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    teamName: { $first: '$teamName' },
                    totalOvertimeHours: { $sum: '$summary.overtimeHours' },
                    occurrences: { $sum: 1 },
                },
            },
            { $sort: { totalOvertimeHours: -1 } },
        ]);

        res.json({ report });
    } catch (error) {
        console.error('Overtime report error:', error);
        res.status(500).json({ error: 'Failed to generate overtime report' });
    }
});

// Get lateness/absenteeism report
router.get('/lateness', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { months = 3 } = req.query;

        const end = new Date();
        const start = subMonths(end, parseInt(months));

        const report = await Timesheet.aggregate([
            {
                $match: {
                    organizationId,
                    startDate: { $gte: start },
                    endDate: { $lte: end },
                },
            },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    teamName: { $first: '$teamName' },
                    lateDays: { $sum: '$summary.lateDays' },
                    earlyDepartures: { $sum: '$summary.earlyDepartures' },
                    incompleteEntries: { $sum: '$summary.incompleteEntries' },
                },
            },
            {
                $match: {
                    $or: [
                        { lateDays: { $gt: 0 } },
                        { earlyDepartures: { $gt: 0 } },
                        { incompleteEntries: { $gt: 0 } },
                    ]
                }
            },
            { $sort: { lateDays: -1 } },
        ]);

        res.json({ report });
    } catch (error) {
        console.error('Lateness report error:', error);
        res.status(500).json({ error: 'Failed to generate lateness report' });
    }
});

// Get geofence violations report
router.get('/geofence-violations', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { startDate, endDate, userId } = req.query;

        let start = startDate ? parseISO(startDate) : startOfMonth(new Date());
        let end = endDate ? parseISO(endDate) : endOfMonth(new Date());

        const matchQuery = {
            organizationId,
            timestamp: { $gte: start, $lte: end },
            'location.latitude': { $exists: true, $ne: null },
            'location.verified': false, // Only violations (outside geofence)
        };

        if (userId) {
            matchQuery.userId = userId;
        }

        const violations = await TimeEntry.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    userEmail: { $first: '$userEmail' },
                    teamName: { $first: '$teamName' },
                    violations: {
                        $push: {
                            entryId: '$_id',
                            entryType: '$entryType',
                            timestamp: '$timestamp',
                            location: '$location',
                            source: '$source',
                        }
                    },
                    violationCount: { $sum: 1 },
                },
            },
            { $sort: { violationCount: -1 } },
        ]);

        res.json({
            period: { start, end },
            totalViolations: violations.reduce((sum, v) => sum + v.violationCount, 0),
            violations,
        });
    } catch (error) {
        console.error('Geofence violations report error:', error);
        res.status(500).json({ error: 'Failed to generate geofence violations report' });
    }
});

// Get location accuracy metrics report
router.get('/location-accuracy', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { startDate, endDate } = req.query;

        let start = startDate ? parseISO(startDate) : startOfMonth(new Date());
        let end = endDate ? parseISO(endDate) : endOfMonth(new Date());

        const metrics = await TimeEntry.aggregate([
            {
                $match: {
                    organizationId,
                    timestamp: { $gte: start, $lte: end },
                    'location.latitude': { $exists: true, $ne: null },
                    'location.accuracy': { $exists: true, $ne: null },
                },
            },
            {
                $group: {
                    _id: null,
                    totalEntries: { $sum: 1 },
                    avgAccuracy: { $avg: '$location.accuracy' },
                    minAccuracy: { $min: '$location.accuracy' },
                    maxAccuracy: { $max: '$location.accuracy' },
                    poorAccuracyCount: {
                        $sum: {
                            $cond: [{ $gt: ['$location.accuracy', 100] }, 1, 0]
                        }
                    },
                    goodAccuracyCount: {
                        $sum: {
                            $cond: [{ $lte: ['$location.accuracy', 50] }, 1, 0]
                        }
                    },
                    verifiedCount: {
                        $sum: {
                            $cond: [{ $eq: ['$location.verified', true] }, 1, 0]
                        }
                    },
                    unverifiedCount: {
                        $sum: {
                            $cond: [{ $eq: ['$location.verified', false] }, 1, 0]
                        }
                    },
                },
            },
        ]);

        const byUser = await TimeEntry.aggregate([
            {
                $match: {
                    organizationId,
                    timestamp: { $gte: start, $lte: end },
                    'location.latitude': { $exists: true, $ne: null },
                    'location.accuracy': { $exists: true, $ne: null },
                },
            },
            {
                $group: {
                    _id: '$userId',
                    userName: { $first: '$userName' },
                    userEmail: { $first: '$userEmail' },
                    avgAccuracy: { $avg: '$location.accuracy' },
                    entryCount: { $sum: 1 },
                },
            },
            { $sort: { avgAccuracy: -1 } },
        ]);

        res.json({
            period: { start, end },
            summary: metrics[0] || {
                totalEntries: 0,
                avgAccuracy: 0,
                minAccuracy: 0,
                maxAccuracy: 0,
                poorAccuracyCount: 0,
                goodAccuracyCount: 0,
                verifiedCount: 0,
                unverifiedCount: 0,
            },
            byUser,
        });
    } catch (error) {
        console.error('Location accuracy report error:', error);
        res.status(500).json({ error: 'Failed to generate location accuracy report' });
    }
});

// Get location history per employee
router.get('/location-history', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { userId, startDate, endDate, limit = 100 } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        let start = startDate ? parseISO(startDate) : subMonths(new Date(), 1);
        let end = endDate ? parseISO(endDate) : new Date();

        const history = await TimeEntry.find({
            organizationId,
            userId,
            timestamp: { $gte: start, $lte: end },
            'location.latitude': { $exists: true, $ne: null },
        })
            .select('entryType timestamp location source')
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .lean();

        // Group by date for easier display
        const groupedByDate = history.reduce((acc, entry) => {
            const dateKey = format(entry.timestamp, 'yyyy-MM-dd');
            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push(entry);
            return acc;
        }, {});

        res.json({
            period: { start, end },
            totalEntries: history.length,
            history,
            groupedByDate,
        });
    } catch (error) {
        console.error('Location history report error:', error);
        res.status(500).json({ error: 'Failed to generate location history report' });
    }
});

module.exports = router;
