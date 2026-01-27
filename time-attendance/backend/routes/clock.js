const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization } = require('../middleware/auth');
const { TimeEntry, Timesheet } = require('../models');

// Apply auth middleware to all clock routes
router.use(requireAuth);
router.use(requireOrganization);

// Get current clock status
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        // Get current clock status
        const clockStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);

        // Get today's entries
        const todayEntries = await TimeEntry.getTodayEntries(userId, organizationId);

        // Calculate time worked today
        let timeWorkedMinutes = 0;
        let breakMinutes = 0;
        let clockInTime = null;

        for (let i = 0; i < todayEntries.length; i++) {
            const entry = todayEntries[i];

            if (entry.entryType === 'clock_in') {
                clockInTime = entry.timestamp;
            } else if (entry.entryType === 'clock_out' && clockInTime) {
                timeWorkedMinutes += (entry.timestamp - clockInTime) / (1000 * 60);
                clockInTime = null;
            } else if (entry.entryType === 'break_start') {
                // Find matching break end
                const breakEnd = todayEntries.slice(i + 1).find(e => e.entryType === 'break_end');
                if (breakEnd) {
                    breakMinutes += (breakEnd.timestamp - entry.timestamp) / (1000 * 60);
                }
            }
        }

        // If still clocked in, add time until now
        if (clockStatus.isClockedIn && clockInTime) {
            timeWorkedMinutes += (Date.now() - clockInTime) / (1000 * 60);
        }

        // Subtract break time
        timeWorkedMinutes -= breakMinutes;

        res.json({
            isClockedIn: clockStatus.isClockedIn,
            isOnBreak: breakStatus.onBreak,
            lastClockEntry: clockStatus.lastEntry,
            lastBreakEntry: breakStatus.lastBreakEntry,
            todayEntries,
            timeWorked: {
                minutes: Math.round(timeWorkedMinutes),
                hours: parseFloat((timeWorkedMinutes / 60).toFixed(2)),
                formatted: formatDuration(timeWorkedMinutes),
            },
            breakTime: {
                minutes: Math.round(breakMinutes),
                formatted: formatDuration(breakMinutes),
            },
        });
    } catch (error) {
        console.error('Get clock status error:', error);
        res.status(500).json({ error: 'Failed to get clock status' });
    }
});

// Clock In
router.post('/in', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note, location } = req.body;

        console.log('🕐 Clock in attempt:', { userId, organizationId, email: req.user.email });

        // Check if already clocked in
        const currentStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        console.log('📊 Current status:', currentStatus);
        if (currentStatus.isClockedIn) {
            return res.status(400).json({
                error: 'Already clocked in',
                code: 'ALREADY_CLOCKED_IN',
                lastEntry: currentStatus.lastEntry,
            });
        }

        // Get user's team info
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        // Create clock in entry
        const entry = new TimeEntry({
            userId,
            userEmail: req.user.email,
            userName: req.user.name,
            organizationId,
            organizationName: req.organizationName,
            teamId: userTeam?.id,
            teamName: userTeam?.name,
            entryType: 'clock_in',
            timestamp: new Date(),
            timezone: req.body.timezone || 'UTC',
            source: 'web',
            note,
            location,
        });

        await entry.save();

        // Update or create today's timesheet
        const timesheet = await Timesheet.findOrCreateCurrentWeek(userId, organizationId, {
            email: req.user.email,
            name: req.user.name,
            organizationName: req.organizationName,
            teamId: userTeam?.id,
            teamName: userTeam?.name,
        });

        res.json({
            success: true,
            entry,
            message: 'Clocked in successfully',
        });
    } catch (error) {
        console.error('Clock in error:', error);
        res.status(500).json({ error: 'Failed to clock in' });
    }
});

// Clock Out
router.post('/out', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note, location } = req.body;

        // Check if clocked in
        const currentStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        if (!currentStatus.isClockedIn) {
            return res.status(400).json({
                error: 'Not clocked in',
                code: 'NOT_CLOCKED_IN',
            });
        }

        // End any active break first
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);
        if (breakStatus.onBreak) {
            const breakEndEntry = new TimeEntry({
                userId,
                userEmail: req.user.email,
                userName: req.user.name,
                organizationId,
                organizationName: req.organizationName,
                entryType: 'break_end',
                timestamp: new Date(),
                source: 'auto',
                note: 'Auto-ended break on clock out',
            });
            await breakEndEntry.save();
        }

        // Create clock out entry
        const entry = new TimeEntry({
            userId,
            userEmail: req.user.email,
            userName: req.user.name,
            organizationId,
            organizationName: req.organizationName,
            entryType: 'clock_out',
            timestamp: new Date(),
            timezone: req.body.timezone || 'UTC',
            source: 'web',
            note,
            location,
        });

        await entry.save();

        // Calculate hours worked for this session
        const clockInEntry = currentStatus.lastEntry;
        const hoursWorked = (entry.timestamp - clockInEntry.timestamp) / (1000 * 60 * 60);

        res.json({
            success: true,
            entry,
            hoursWorked: parseFloat(hoursWorked.toFixed(2)),
            message: 'Clocked out successfully',
        });
    } catch (error) {
        console.error('Clock out error:', error);
        res.status(500).json({ error: 'Failed to clock out' });
    }
});

// Start Break
router.post('/break/start', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note } = req.body;

        // Must be clocked in
        const clockStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        if (!clockStatus.isClockedIn) {
            return res.status(400).json({
                error: 'Must be clocked in to start break',
                code: 'NOT_CLOCKED_IN',
            });
        }

        // Check if already on break
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);
        if (breakStatus.onBreak) {
            return res.status(400).json({
                error: 'Already on break',
                code: 'ALREADY_ON_BREAK',
            });
        }

        const entry = new TimeEntry({
            userId,
            userEmail: req.user.email,
            userName: req.user.name,
            organizationId,
            organizationName: req.organizationName,
            entryType: 'break_start',
            timestamp: new Date(),
            source: 'web',
            note,
        });

        await entry.save();

        res.json({
            success: true,
            entry,
            message: 'Break started',
        });
    } catch (error) {
        console.error('Start break error:', error);
        res.status(500).json({ error: 'Failed to start break' });
    }
});

// End Break
router.post('/break/end', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note } = req.body;

        // Check if on break
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);
        if (!breakStatus.onBreak) {
            return res.status(400).json({
                error: 'Not on break',
                code: 'NOT_ON_BREAK',
            });
        }

        const entry = new TimeEntry({
            userId,
            userEmail: req.user.email,
            userName: req.user.name,
            organizationId,
            organizationName: req.organizationName,
            entryType: 'break_end',
            timestamp: new Date(),
            source: 'web',
            note,
        });

        await entry.save();

        // Calculate break duration
        const breakStart = breakStatus.lastBreakEntry.timestamp;
        const breakDuration = (entry.timestamp - breakStart) / (1000 * 60);

        res.json({
            success: true,
            entry,
            breakDuration: Math.round(breakDuration),
            message: 'Break ended',
        });
    } catch (error) {
        console.error('End break error:', error);
        res.status(500).json({ error: 'Failed to end break' });
    }
});

// Get time entries for a date range
router.get('/entries', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { startDate, endDate } = req.query;

        const query = { userId, organizationId };

        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const entries = await TimeEntry.find(query).sort({ timestamp: -1 }).limit(100);

        res.json({ entries });
    } catch (error) {
        console.error('Get entries error:', error);
        res.status(500).json({ error: 'Failed to get entries' });
    }
});

// Helper function to format duration
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

module.exports = router;
