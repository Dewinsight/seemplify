const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { Timesheet, TimeEntry } = require('../models');
const { startOfMonth, endOfMonth, parseISO, subMonths } = require('date-fns');

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

module.exports = router;
