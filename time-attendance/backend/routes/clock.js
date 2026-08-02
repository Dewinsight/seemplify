const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization } = require('../middleware/auth');
const { TimeEntry, Timesheet, AttendancePolicy } = require('../models');
const geofenceService = require('../services/geofenceService');
const { enrichLocationWithAddress } = require('../services/geocodingService');
const { startOfWeek, endOfWeek, getISOWeek, getYear } = require('date-fns');

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

        // Validate geofencing if location provided
        let locationVerified = false;
        if (location?.latitude && location?.longitude) {
            const validation = await geofenceService.validateLocation(
                location.latitude,
                location.longitude,
                organizationId
            );

            // Check if geofencing is enforced
            const policy = await AttendancePolicy.findOne({ organizationId });
            const isEnforced = policy?.geofencing?.enabled && policy?.geofencing?.enforced;

            if (!validation.isValid) {
                if (isEnforced) {
                    // Enforcement enabled - reject clock-in
                    console.warn('❌ Clock-in blocked (outside geofence):', validation);
                    return res.status(403).json({
                        error: 'Clock-in not allowed from this location',
                        code: 'OUTSIDE_GEOFENCE',
                        details: validation,
                    });
                } else {
                    // Warning only - allow but log
                    console.warn('⚠️  Clock-in outside geofence (warning only):', validation);
                }
            } else {
                console.log('✅ Location verified:', validation.message);
            }

            locationVerified = validation.isValid;
        }

        // Get user's team info
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        // Enrich location with address (reverse geocoding)
        let enrichedLocation = null;
        if (location?.latitude && location?.longitude) {
            enrichedLocation = await enrichLocationWithAddress({
                ...location,
                verified: locationVerified,
            });
            console.log('📍 Location enriched:', enrichedLocation?.address || 'No address found');
        }

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
            location: enrichedLocation,
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

        // Validate geofencing if location provided (optional for clock-out)
        let locationVerified = false;
        if (location?.latitude && location?.longitude) {
            const validation = await geofenceService.validateLocation(
                location.latitude,
                location.longitude,
                organizationId
            );
            locationVerified = validation.isValid;
            
            if (!validation.isValid) {
                console.warn('⚠️  Clock-out outside geofence:', validation);
            }
        }

        // Enrich location with address (reverse geocoding)
        let enrichedLocation = null;
        if (location?.latitude && location?.longitude) {
            enrichedLocation = await enrichLocationWithAddress({
                ...location,
                verified: locationVerified,
            });
            console.log('📍 Clock-out location enriched:', enrichedLocation?.address || 'No address found');
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
            location: enrichedLocation,
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

// Manual Time Entry (for corrections or when GPS/system fails)
router.post('/manual', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { entryType, timestamp, note, targetUserId } = req.body;

        console.log('✏️  Manual entry attempt:', { userId, entryType, timestamp });

        // 1. Validate entry type
        const validTypes = ['clock_in', 'clock_out', 'break_start', 'break_end'];
        if (!validTypes.includes(entryType)) {
            return res.status(400).json({ error: 'Invalid entry type' });
        }

        // 2. Validate timestamp
        if (!timestamp) {
            return res.status(400).json({ error: 'Timestamp is required' });
        }

        const entryTimestamp = new Date(timestamp);
        if (isNaN(entryTimestamp.getTime())) {
            return res.status(400).json({ error: 'Invalid timestamp format' });
        }

        // Cannot add future entries
        if (entryTimestamp > new Date()) {
            return res.status(400).json({ 
                error: 'Cannot add future entries',
                code: 'FUTURE_ENTRY'
            });
        }

        // 3. Require explanation note (min 10 characters)
        if (!note || note.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Explanation note required (minimum 10 characters)',
                code: 'NOTE_REQUIRED'
            });
        }

        // 4. Check authorization
        const { AttendancePolicy } = require('../models');
        const policy = await AttendancePolicy.findOne({ organizationId });
        
        // Check if user is HR admin or manager
        const isAdmin = req.user.roles?.includes('hr_admin');
        const isManager = req.user.roles?.includes('manager');
        const canManualEntry = policy?.clockSettings?.allowManualEntry || false;

        // Determine target user
        let targetUser = userId;
        let targetUserEmail = req.user.email;
        let targetUserName = req.user.name;

        if (targetUserId && targetUserId !== userId) {
            // Trying to add entry for someone else - must be admin or manager
            if (!isAdmin && !isManager) {
                return res.status(403).json({ 
                    error: 'Only HR admins and managers can add entries for other users',
                    code: 'INSUFFICIENT_PERMISSIONS'
                });
            }
            
            targetUser = targetUserId;
            // Note: We don't have full user details for targetUserId
            // In a real system, we'd fetch from IdP or user cache
            targetUserEmail = `user-${targetUserId}@unknown`;
            targetUserName = `User ${targetUserId}`;
        } else {
            // Adding entry for self - check if policy allows it
            if (!canManualEntry && !isAdmin && !isManager) {
                return res.status(403).json({ 
                    error: 'Manual time entry is not allowed',
                    code: 'MANUAL_ENTRY_DISABLED'
                });
            }
        }

        // 5. Get user's team info
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        // 6. Create manual entry
        const entry = new TimeEntry({
            userId: targetUser,
            userEmail: targetUserEmail,
            userName: targetUserName,
            organizationId,
            organizationName: req.organizationName,
            teamId: userTeam?.id,
            teamName: userTeam?.name,
            entryType,
            timestamp: entryTimestamp,
            timezone: req.body.timezone || 'UTC',
            source: 'manual',
            note,
            isManualEntry: true,
            modifiedBy: {
                userId,
                userName: req.user.name,
                modifiedAt: new Date(),
                reason: note,
            },
        });

        await entry.save();

        console.log('✅ Manual entry created:', { userId: targetUser, entryType, timestamp });

        // Find or create the timesheet for the week containing this entry
        // and refresh it so the manual entry appears
        try {
            const entryDate = new Date(entryTimestamp);
            const weekStart = startOfWeek(entryDate, { weekStartsOn: 1 }); // Monday
            const weekEnd = endOfWeek(entryDate, { weekStartsOn: 1 });
            const weekNumber = getISOWeek(entryDate);
            const year = getYear(entryDate);

            // Find existing timesheet for this week
            let timesheet = await Timesheet.findOne({
                userId: targetUser,
                organizationId,
                year,
                weekNumber,
            });

            // If no timesheet exists, create one
            if (!timesheet) {
                const dailyEntries = [];
                const currentDate = new Date(weekStart);

                while (currentDate <= weekEnd) {
                    dailyEntries.push({
                        date: new Date(currentDate),
                        dayOfWeek: currentDate.getDay(),
                        status: currentDate.getDay() === 0 || currentDate.getDay() === 6 ? 'weekend' : 'absent',
                    });
                    currentDate.setDate(currentDate.getDate() + 1);
                }

                timesheet = new Timesheet({
                    userId: targetUser,
                    userEmail: targetUserEmail,
                    userName: targetUserName,
                    organizationId,
                    organizationName: req.organizationName,
                    teamId: userTeam?.id,
                    teamName: userTeam?.name,
                    periodType: 'weekly',
                    startDate: weekStart,
                    endDate: weekEnd,
                    weekNumber,
                    year,
                    dailyEntries,
                    summary: {},
                });

                timesheet.addAuditLog('created', userId, req.user.name, null, 'Created for manual entry');
                await timesheet.save();
            }

            // Import and call refreshTimesheetEntries
            const { refreshTimesheetEntries } = require('./timesheets');
            await refreshTimesheetEntries(timesheet);

            console.log('✅ Timesheet refreshed with manual entry');
        } catch (timesheetError) {
            // Log but don't fail - the entry was created successfully
            console.warn('⚠️  Could not refresh timesheet:', timesheetError.message);
        }

        res.json({
            success: true,
            entry,
            message: 'Manual time entry created successfully',
            timesheetUpdated: true,
        });
    } catch (error) {
        console.error('Manual entry error:', error);
        res.status(500).json({ error: 'Failed to create manual entry' });
    }
});

// Helper function to format duration
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

module.exports = router;
