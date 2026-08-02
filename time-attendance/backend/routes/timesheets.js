const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope } = require('../middleware/auth');
const { Timesheet, TimeEntry, AttendancePolicy } = require('../models');
const { startOfWeek, endOfWeek, getISOWeek, getYear, format, parseISO, eachDayOfInterval } = require('date-fns');
const emailService = require('../services/emailService');
const { generateTimesheetExcelReport } = require('../services/timesheetExportService');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);

// Get current user's timesheets (or specific user for managers)
router.get('/', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { limit = 10, status, year, userId } = req.query;

        // Default to current user if not specified
        let targetUserId = req.user.id;

        if (userId && userId !== req.user.id) {
            // Permission check: HR or Manager can view others
            if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (isDepartmentHead(req) && !getDepartmentHeadScope(req).directReports.includes(String(userId))) {
                return res.status(403).json({ error: 'Access denied' });
            }
            targetUserId = userId;
        }

        const query = { userId: targetUserId, organizationId };
        if (status) query.status = status;
        if (year) query.year = parseInt(year);

        const timesheets = await Timesheet.find(query)
            .sort({ startDate: -1 })
            .limit(parseInt(limit));

        res.json({ timesheets });
    } catch (error) {
        console.error('Get timesheets error:', error);
        res.status(500).json({ error: 'Failed to get timesheets' });
    }
});

// Get current week timesheet
router.get('/current', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        const timesheet = await Timesheet.findOrCreateCurrentWeek(userId, organizationId, {
            email: req.user.email,
            name: req.user.name,
            organizationName: req.organizationName,
            teamId: userTeam?.id,
            teamName: userTeam?.name,
        });

        // Refresh daily entries with actual time data
        await refreshTimesheetEntries(timesheet);

        res.json({ timesheet });
    } catch (error) {
        console.error('Get current timesheet error:', error);
        res.status(500).json({ error: 'Failed to get current timesheet' });
    }
});

// Get specific timesheet by ID
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Check access - user can view own, managers can view team's, HR can view all
        if (timesheet.userId !== userId && !isHRAdmin(req)) {
            // Check if user is manager of this employee's team
            if (!isLineManager(req) && !isDepartmentHead(req)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (isDepartmentHead(req) && !getDepartmentHeadScope(req).directReports.includes(String(timesheet.userId))) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        res.json({ timesheet });
    } catch (error) {
        console.error('Get timesheet error:', error);
        res.status(500).json({ error: 'Failed to get timesheet' });
    }
});

// Export a detailed timesheet report as Excel (.xlsx)
router.get('/:id/export', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Check access - user can export own, managers can export team's, HR can export all
        if (timesheet.userId !== userId && !isHRAdmin(req)) {
            if (!isLineManager(req) && !isDepartmentHead(req)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (isDepartmentHead(req) && !getDepartmentHeadScope(req).directReports.includes(String(timesheet.userId))) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        // Refresh timesheet to ensure latest computed totals before export.
        await refreshTimesheetEntries(timesheet);

        const entries = await TimeEntry.find({
            userId: timesheet.userId,
            organizationId,
            timestamp: { $gte: timesheet.startDate, $lte: timesheet.endDate },
        }).sort({ timestamp: 1 }).lean();

        const { buffer, filename } = await generateTimesheetExcelReport({
            timesheet: timesheet.toObject(),
            entries,
            organizationName: req.organizationName,
            exportedByName: req.user.name,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (error) {
        console.error('Export timesheet error:', error);
        res.status(500).json({ error: 'Failed to export timesheet' });
    }
});

// Submit timesheet for approval
router.post('/:id/submit', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note } = req.body;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Treat undefined/null status as 'draft'
        const currentStatus = timesheet.status || 'draft';
        if (currentStatus !== 'draft' && currentStatus !== 'revision_requested') {
            return res.status(400).json({
                error: 'Timesheet cannot be submitted',
                code: 'INVALID_STATUS',
                currentStatus,
            });
        }

        // Refresh entries and calculate summary
        await refreshTimesheetEntries(timesheet);
        timesheet.calculateSummary();

        // Find line manager for approval
        // Note: IdP returns managerId/managerName directly on the team object
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        if (userTeam && userTeam.managerId) {
            timesheet.assignedApprover = {
                userId: userTeam.managerId,
                userName: userTeam.managerName,
                userEmail: userTeam.managerEmail || null,
                teamId: userTeam.id,
                assignedAt: new Date(),
            };
        }

        timesheet.status = 'submitted';
        timesheet.submittedAt = new Date();
        timesheet.submittedNote = note;
        timesheet.addAuditLog('submitted', userId, req.user.name, note);

        await timesheet.save();

        // Notify assigned manager on submission (if policy allows and manager email is available)
        const policy = await AttendancePolicy.findOne({ organizationId });
        if (policy?.notifications?.emailOnSubmission && timesheet.assignedApprover?.userEmail) {
            await emailService.sendTimesheetSubmitted(
                timesheet,
                timesheet.assignedApprover.userEmail,
                timesheet.assignedApprover.userName
            );
        }

        res.json({
            success: true,
            timesheet,
            message: 'Timesheet submitted for approval',
        });
    } catch (error) {
        console.error('Submit timesheet error:', error);
        res.status(500).json({ error: 'Failed to submit timesheet' });
    }
});

// Recall submitted timesheet
router.post('/:id/recall', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        if (timesheet.status !== 'submitted') {
            return res.status(400).json({
                error: 'Only submitted timesheets can be recalled',
                code: 'INVALID_STATUS',
            });
        }

        timesheet.status = 'draft';
        timesheet.addAuditLog('recalled', userId, req.user.name, 'Recalled for editing');

        await timesheet.save();

        res.json({
            success: true,
            timesheet,
            message: 'Timesheet recalled',
        });
    } catch (error) {
        console.error('Recall timesheet error:', error);
        res.status(500).json({ error: 'Failed to recall timesheet' });
    }
});

// Update daily entry note (for draft timesheets only)
router.patch('/:id/daily/:date', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { notes } = req.body;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        if (timesheet.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot modify submitted timesheet' });
        }

        const targetDate = parseISO(req.params.date);
        const dailyEntry = timesheet.dailyEntries.find(
            e => format(e.date, 'yyyy-MM-dd') === format(targetDate, 'yyyy-MM-dd')
        );

        if (!dailyEntry) {
            return res.status(404).json({ error: 'Daily entry not found' });
        }

        dailyEntry.notes = notes;
        timesheet.addAuditLog('updated', userId, req.user.name, null, `Updated notes for ${format(targetDate, 'MMM d')}`);

        await timesheet.save();

        res.json({ success: true, timesheet });
    } catch (error) {
        console.error('Update daily entry error:', error);
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

// Helper function to refresh timesheet with actual time entries
async function refreshTimesheetEntries(timesheet) {
    const entries = await TimeEntry.find({
        userId: timesheet.userId,
        organizationId: timesheet.organizationId,
        timestamp: { $gte: timesheet.startDate, $lte: timesheet.endDate },
    }).sort({ timestamp: 1 });

    // Group entries by date
    const entriesByDate = {};
    for (const entry of entries) {
        const dateKey = format(entry.timestamp, 'yyyy-MM-dd');
        if (!entriesByDate[dateKey]) {
            entriesByDate[dateKey] = [];
        }
        entriesByDate[dateKey].push(entry);
    }

    // Update daily entries
    for (const dailyEntry of timesheet.dailyEntries) {
        const dateKey = format(dailyEntry.date, 'yyyy-MM-dd');
        const dayEntries = entriesByDate[dateKey] || [];

        if (dayEntries.length === 0) {
            // No entries for this day
            const dayOfWeek = dailyEntry.date.getDay();
            dailyEntry.status = (dayOfWeek === 0 || dayOfWeek === 6) ? 'weekend' : 'absent';
            dailyEntry.clockIn = null;
            dailyEntry.clockOut = null;
            dailyEntry.totalMinutes = 0;
            dailyEntry.totalHours = 0;
            continue;
        }

        // Find clock in/out
        const clockIn = dayEntries.find(e => e.entryType === 'clock_in');
        const clockOut = [...dayEntries].reverse().find(e => e.entryType === 'clock_out');

        dailyEntry.clockIn = clockIn?.timestamp;
        dailyEntry.clockOut = clockOut?.timestamp;
        dailyEntry.timeEntryIds = dayEntries.map(e => e._id);

        // Copy geolocation data from time entries to daily entry
        if (clockIn?.location) {
            dailyEntry.clockInLocation = {
                latitude: clockIn.location.latitude,
                longitude: clockIn.location.longitude,
                address: clockIn.location.address,
                area: clockIn.location.area,
                city: clockIn.location.city,
                state: clockIn.location.state,
                country: clockIn.location.country,
                displayName: clockIn.location.displayName,
                accuracy: clockIn.location.accuracy,
                verified: clockIn.location.verified,
            };
        } else {
            dailyEntry.clockInLocation = null;
        }

        if (clockOut?.location) {
            dailyEntry.clockOutLocation = {
                latitude: clockOut.location.latitude,
                longitude: clockOut.location.longitude,
                address: clockOut.location.address,
                area: clockOut.location.area,
                city: clockOut.location.city,
                state: clockOut.location.state,
                country: clockOut.location.country,
                displayName: clockOut.location.displayName,
                accuracy: clockOut.location.accuracy,
                verified: clockOut.location.verified,
            };
        } else {
            dailyEntry.clockOutLocation = null;
        }

        // Calculate break duration
        let breakMinutes = 0;
        for (let i = 0; i < dayEntries.length; i++) {
            if (dayEntries[i].entryType === 'break_start') {
                const breakEnd = dayEntries.slice(i + 1).find(e => e.entryType === 'break_end');
                if (breakEnd) {
                    breakMinutes += (breakEnd.timestamp - dayEntries[i].timestamp) / (1000 * 60);
                }
            }
        }
        dailyEntry.breakDuration = Math.round(breakMinutes);

        // Check if any manual entries exist for this day
        const hasManualEntries = dayEntries.some(e => e.isManualEntry || e.source === 'manual');
        if (hasManualEntries) {
            dailyEntry.exceptions = dailyEntry.exceptions || [];
            if (!dailyEntry.exceptions.some(e => e.type === 'manual_entry')) {
                const manualEntry = dayEntries.find(e => e.isManualEntry || e.source === 'manual');
                dailyEntry.exceptions.push({ 
                    type: 'manual_entry', 
                    description: manualEntry?.note || 'Contains manual time entries'
                });
            }
        }

        // Calculate total time
        if (clockIn && clockOut) {
            const totalMinutes = (clockOut.timestamp - clockIn.timestamp) / (1000 * 60) - breakMinutes;
            dailyEntry.totalMinutes = Math.round(Math.max(0, totalMinutes));
            dailyEntry.totalHours = parseFloat((dailyEntry.totalMinutes / 60).toFixed(2));
            dailyEntry.status = 'present';

            // Calculate regular vs overtime (assuming 8 hour threshold)
            if (dailyEntry.totalHours > 8) {
                dailyEntry.regularHours = 8;
                dailyEntry.overtimeHours = parseFloat((dailyEntry.totalHours - 8).toFixed(2));
            } else {
                dailyEntry.regularHours = dailyEntry.totalHours;
                dailyEntry.overtimeHours = 0;
            }
        } else if (clockIn && !clockOut) {
            // Clocked in but not out
            dailyEntry.status = 'partial';
            dailyEntry.exceptions = dailyEntry.exceptions || [];
            if (!dailyEntry.exceptions.some(e => e.type === 'no_clock_out')) {
                dailyEntry.exceptions.push({ type: 'no_clock_out', description: 'Missing clock out' });
            }
        }
    }

    timesheet.calculateSummary();
    await timesheet.save();

    return timesheet;
}

// Export both router and helper function
module.exports = router;
module.exports.refreshTimesheetEntries = refreshTimesheetEntries;
