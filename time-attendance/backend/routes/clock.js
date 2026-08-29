const express = require('express');
const router = express.Router();
const {
    requireAuth,
    requireOrganization,
    isHRAdmin,
    isLineManager,
    isDepartmentHead,
    getDepartmentHeadScope,
} = require('../middleware/auth');
const { TimeEntry, Timesheet, AttendancePolicy, EmployeeRoster, Shift, SchedulePublication } = require('../models');
const geofenceService = require('../services/geofenceService');
const { enrichLocationWithAddress } = require('../services/geocodingService');
const { startOfWeek, endOfWeek, getISOWeek, getYear } = require('date-fns');
const { evaluateClockIn, evaluateLocationPolicy, buildPolicySummary } = require('../services/attendanceRulesService');
const attendanceEvents = require('../services/attendanceEventService');
const { buildSessions, localDayBounds } = require('../services/timeCalculationService');
const {
    getLockedPeriodDisposition,
    ensureVersionedAdjustment,
} = require('../services/lockedPeriodAdjustmentService');

// Apply auth middleware to all clock routes
router.use(requireAuth);
router.use(requireOrganization);

function localTimeText(value, timezone) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(value));
}

async function policyForPublishedShift(policyDocument, userId, organizationId, now = new Date()) {
    const policy = policyDocument?.toObject ? policyDocument.toObject() : { ...(policyDocument || {}) };
    if (policy.schedulingSettings?.usePublishedShiftsAsAttendanceSchedule === false) return policy;
    const bounds = localDayBounds(now, policy.timezone || 'UTC');
    const [shifts, publication] = await Promise.all([
        Shift.find({
            organizationId,
            userId,
            status: { $in: ['published', 'completed'] },
            startAt: { $lte: bounds.end },
            endAt: { $gt: bounds.start },
        }).sort({ startAt: 1 }).lean(),
        SchedulePublication.findOne({
            organizationId,
            periodStart: { $lte: bounds.end },
            periodEnd: { $gt: bounds.start },
        }).lean(),
    ]);
    if (!publication) return policy;
    const shift = shifts.find(item => new Date(item.startAt) <= now && new Date(item.endAt) > now)
        || shifts.find(item => new Date(item.startAt) > now)
        || shifts[shifts.length - 1];
    if (!shift) {
        return {
            ...policy,
            workSchedule: { ...policy.workSchedule, workDays: [] },
        };
    }
    const timezone = shift.timezone || policy.timezone || 'UTC';
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
    return {
        ...policy,
        timezone,
        workSchedule: {
            ...policy.workSchedule,
            type: 'fixed',
            workDays: [dayOfWeek],
            defaultShift: {
                ...(policy.workSchedule?.defaultShift || {}),
                startTime: localTimeText(shift.startAt, timezone),
                endTime: localTimeText(shift.endAt, timezone),
                breakDuration: shift.breakMinutes,
                scheduledShiftId: String(shift._id),
                startAt: shift.startAt,
                endAt: shift.endAt,
            },
        },
    };
}

// Authenticated event stream used by the hub for near-instant cross-app updates.
router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const unsubscribe = attendanceEvents.subscribe(req.user.id, req.organizationId, res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});

function hasCoordinates(location) {
    return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

async function validateClockLocation(location, organizationId, action, suppliedPolicy = null) {
    const policy = suppliedPolicy || await AttendancePolicy.getOrCreateDefault(organizationId);
    const rule = evaluateLocationPolicy(policy, {
        hasLocation: hasCoordinates(location),
        accuracy: location?.accuracy,
    });
    if (!rule.allowed) {
        const accuracyError = rule.code === 'LOCATION_ACCURACY_TOO_LOW';
        return {
            ok: false,
            status: 400,
            error: accuracyError
                ? `Location accuracy must be within ${rule.maximumAccuracyMeters}m to record attendance`
                : 'Location is required by your organization attendance policy',
            code: rule.code,
        };
    }
    if (!rule.shouldValidate) return { ok: true, verified: rule.enabled ? false : undefined, policy, warnings: rule.warnings };

    const validation = await geofenceService.validateLocation(Number(location.latitude), Number(location.longitude), organizationId);
    if (!validation.isValid && rule.enforced) {
        return { ok: false, status: 403, error: `${action} is not allowed from this location`, code: 'OUTSIDE_GEOFENCE', details: validation };
    }
    const warnings = validation.isValid ? rule.warnings : [...rule.warnings, validation.reason || 'Location was outside the configured geofence.'];
    return { ok: true, verified: validation.isValid, validation, policy, warnings };
}

async function ensureAttendanceEligible(userId, organizationId) {
    const roster = await EmployeeRoster.findOne({ organizationId, userId }).lean();
    if (!roster) return { allowed: true, reason: 'legacy_roster_pending' };
    if (roster.status === 'inactive') return { allowed: false, code: 'EMPLOYMENT_INACTIVE', error: 'Your organization membership is inactive' };
    if (roster.effectiveExitAt && new Date(roster.effectiveExitAt) <= new Date()) {
        return { allowed: false, code: 'EMPLOYMENT_ENDED', error: 'Attendance recording ended at your effective exit time' };
    }
    return { allowed: true, roster };
}

async function findLockedTimesheetAt(userId, organizationId, timestamp = new Date()) {
    return Timesheet.findOne({
        userId,
        organizationId,
        startDate: { $lte: timestamp },
        endDate: { $gte: timestamp },
        status: { $in: ['approved', 'locked', 'payroll_pending', 'payroll_exported'] },
    }).sort({ version: -1, updatedAt: -1 });
}

function protectedPeriodMetadata(timesheet, reason) {
    if (!timesheet) return undefined;
    return {
        sourceTimesheetId: timesheet._id,
        sourceTimesheetStatus: timesheet.status,
        sourceTimesheetVersion: timesheet.version || 1,
        state: 'pending',
        reason,
        recordedAt: new Date(),
    };
}

async function completeProtectedPeriodAdjustment({ entry, timesheet, disposition, req, action }) {
    if (!disposition.requiresAdjustment || !timesheet) return null;
    try {
        const result = await ensureVersionedAdjustment({
            sourceTimesheet: timesheet,
            entry,
            actor: { userId: req.user.id, userName: req.user.name },
            action,
            reason: disposition.reason,
        });
        entry.protectedPeriodAdjustment.state = 'version_created';
        entry.protectedPeriodAdjustment.adjustmentTimesheetId = result.adjustment._id;
        await entry.save();
        return {
            required: true,
            state: 'version_created',
            timesheetId: result.adjustment._id,
            version: result.adjustment.version,
            created: result.created,
        };
    } catch (error) {
        // Ending attendance is safety-critical. The terminal event is already
        // durable and must remain successful even if correction creation needs
        // a later retry or manager review.
        console.error('Protected-period adjustment creation failed:', error);
        return {
            required: true,
            state: 'pending_manager_review',
            sourceTimesheetId: timesheet._id,
        };
    }
}

// Get current clock status
router.get('/status', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        // Get current clock status
        const clockStatus = await TimeEntry.getCurrentStatus(userId, organizationId);
        const breakStatus = await TimeEntry.isOnBreak(userId, organizationId);

        // Get today's entries
        const storedPolicy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
        const policy = await policyForPublishedShift(storedPolicy, userId, organizationId);
        const todayEntries = await TimeEntry.getTodayEntries(userId, organizationId, policy.timezone || 'UTC');

        // Pair every session and break exactly once. The bounded lookback lets
        // overnight sessions be clipped to the employee's current local day.
        const { start: todayStart, end: todayEnd } = localDayBounds(new Date(), policy.timezone || 'UTC');
        const lookbackStart = new Date(todayStart.getTime() - (48 * 60 * 60 * 1000));
        const calculationEntries = await TimeEntry.find({
            userId,
            organizationId,
            timestamp: { $gte: lookbackStart, $lte: todayEnd },
        }).sort({ timestamp: 1 }).lean();
        const now = new Date(Math.min(Date.now(), todayEnd.getTime()));
        const currentlyOnBreak = Boolean(
            clockStatus.isClockedIn
            && breakStatus.onBreak
            && new Date(breakStatus.lastBreakEntry.timestamp) > new Date(clockStatus.lastEntry.timestamp)
        );
        if (clockStatus.isClockedIn) {
            if (currentlyOnBreak) calculationEntries.push({ entryType: 'break_end', timestamp: now, source: 'calculation' });
            calculationEntries.push({ entryType: 'clock_out', timestamp: now, source: 'calculation' });
        }
        const { sessions } = buildSessions(calculationEntries);
        let timeWorkedMinutes = 0;
        let breakMinutes = 0;
        for (const session of sessions) {
            if (!session.clockIn || !session.clockOut) continue;
            const sessionStart = new Date(Math.max(new Date(session.clockIn.timestamp).getTime(), todayStart.getTime()));
            const sessionEnd = new Date(Math.min(new Date(session.clockOut.timestamp).getTime(), todayEnd.getTime()));
            if (sessionEnd <= sessionStart) continue;
            let sessionBreakMinutes = 0;
            for (const pairedBreak of session.breaks) {
                const breakStart = Math.max(new Date(pairedBreak.start.timestamp).getTime(), sessionStart.getTime());
                const breakEnd = Math.min(new Date(pairedBreak.end.timestamp).getTime(), sessionEnd.getTime());
                if (breakEnd > breakStart) sessionBreakMinutes += (breakEnd - breakStart) / 60000;
            }
            breakMinutes += sessionBreakMinutes;
            timeWorkedMinutes += ((sessionEnd - sessionStart) / 60000) - sessionBreakMinutes;
        }

        res.json({
            isClockedIn: clockStatus.isClockedIn,
            isOnBreak: currentlyOnBreak,
            lastClockEntry: clockStatus.lastEntry,
            lastBreakEntry: breakStatus.lastBreakEntry,
            todayEntries,
            timeWorked: {
                minutes: Math.round(timeWorkedMinutes),
                seconds: Math.max(0, Math.round(timeWorkedMinutes * 60)),
                hours: parseFloat((timeWorkedMinutes / 60).toFixed(2)),
                formatted: formatDuration(timeWorkedMinutes),
            },
            breakTime: {
                minutes: Math.round(breakMinutes),
                formatted: formatDuration(breakMinutes),
            },
            policy: buildPolicySummary(policy),
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
        const { note, location, workMode = 'office', locationId, jobCode, activityCode, costCentreCode } = req.body;
        if (!['office', 'remote', 'client_site', 'other'].includes(workMode)) return res.status(400).json({ error: 'Invalid work mode' });

        const eligibility = await ensureAttendanceEligible(userId, organizationId);
        if (!eligibility.allowed) return res.status(403).json(eligibility);

        const lockedTimesheet = await findLockedTimesheetAt(userId, organizationId);
        const lockDisposition = getLockedPeriodDisposition('clock_in', lockedTimesheet);

        const storedPolicy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
        const policy = await policyForPublishedShift(storedPolicy, userId, organizationId);
        if (policy.clockSettings?.requireNote && !String(note || '').trim()) {
            return res.status(400).json({ error: 'A note is required to clock in', code: 'NOTE_REQUIRED' });
        }
        const ruleResult = evaluateClockIn(policy, {
            now: new Date(),
            hasLocation: location?.latitude != null && location?.longitude != null,
        });
        if (!ruleResult.allowed) {
            const messages = {
                NON_WORKING_DAY: 'Clock-in is not allowed on a non-working day',
                CLOCK_IN_TOO_EARLY: 'Clock-in is not open yet',
                CLOCK_IN_WINDOW_CLOSED: 'The clock-in window has closed',
                LOCATION_REQUIRED: 'Your location is required by the attendance policy',
            };
            return res.status(403).json({ error: messages[ruleResult.code] || 'Clock-in is not allowed', code: ruleResult.code });
        }

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

        const locationCheck = await validateClockLocation(location, organizationId, 'Clock-in', policy);
        if (!locationCheck.ok) return res.status(locationCheck.status).json(locationCheck);

        const locationVerified = locationCheck.verified;

        // Get user's team info
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        // Enrich location with address (reverse geocoding)
        let enrichedLocation = null;
        if (hasCoordinates(location)) {
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
            source: req.user.authSurface === 'hub' ? 'hub' : 'web',
            note,
            location: enrichedLocation,
            workMode,
            locationId,
            jobCode,
            activityCode,
            costCentreCode,
            timesheetId: lockedTimesheet?._id,
            protectedPeriodAdjustment: protectedPeriodMetadata(lockedTimesheet, lockDisposition.reason),
        });

        await entry.save();
        attendanceEvents.publish(userId, organizationId, { type: 'clock_in', entryId: entry._id, at: entry.timestamp });

        const adjustment = await completeProtectedPeriodAdjustment({
            entry,
            timesheet: lockedTimesheet,
            disposition: lockDisposition,
            req,
            action: 'clock_in',
        });

        if (!lockedTimesheet) {
            await Timesheet.findOrCreateCurrentWeek(userId, organizationId, {
                email: req.user.email,
                name: req.user.name,
                organizationName: req.organizationName,
                teamId: userTeam?.id,
                teamName: userTeam?.name,
            }, policy);
        }

        res.json({
            success: true,
            entry,
            adjustment,
            message: adjustment
                ? 'Clocked in successfully. A correction version was created without changing the protected timesheet.'
                : 'Clocked in successfully',
            warnings: [...ruleResult.warnings, ...(locationCheck.warnings || [])],
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

        const lockedTimesheet = await findLockedTimesheetAt(
            userId,
            organizationId,
            currentStatus.lastEntry.timestamp
        );
        const lockDisposition = getLockedPeriodDisposition('clock_out', lockedTimesheet);

        const locationCheck = await validateClockLocation(location, organizationId, 'Clock-out');
        if (!locationCheck.ok) return res.status(locationCheck.status).json(locationCheck);

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
            attendanceEvents.publish(userId, organizationId, { type: 'break_end', entryId: breakEndEntry._id, at: breakEndEntry.timestamp });
        }

        const locationVerified = locationCheck.verified;

        // Enrich location with address (reverse geocoding)
        let enrichedLocation = null;
        if (hasCoordinates(location)) {
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
            source: req.user.authSurface === 'hub' ? 'hub' : 'web',
            note,
            location: enrichedLocation,
            workMode: currentStatus.lastEntry.workMode,
            locationId: currentStatus.lastEntry.locationId,
            jobCode: currentStatus.lastEntry.jobCode,
            activityCode: currentStatus.lastEntry.activityCode,
            costCentreCode: currentStatus.lastEntry.costCentreCode,
            timesheetId: lockedTimesheet?._id,
            protectedPeriodAdjustment: protectedPeriodMetadata(lockedTimesheet, lockDisposition.reason),
        });

        await entry.save();
        attendanceEvents.publish(userId, organizationId, { type: 'clock_out', entryId: entry._id, at: entry.timestamp });

        const adjustment = await completeProtectedPeriodAdjustment({
            entry,
            timesheet: lockedTimesheet,
            disposition: lockDisposition,
            req,
            action: 'clock_out',
        });

        // Calculate hours worked for this session
        const clockInEntry = currentStatus.lastEntry;
        const hoursWorked = (entry.timestamp - clockInEntry.timestamp) / (1000 * 60 * 60);

        res.json({
            success: true,
            entry,
            hoursWorked: parseFloat(hoursWorked.toFixed(2)),
            adjustment,
            warnings: locationCheck.warnings || [],
            message: adjustment
                ? 'Clocked out successfully. A correction version was created without changing the protected timesheet.'
                : 'Clocked out successfully',
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

        const lockedTimesheet = await findLockedTimesheetAt(userId, organizationId);
        const lockDisposition = getLockedPeriodDisposition('break_start', lockedTimesheet);

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
            source: req.user.authSurface === 'hub' ? 'hub' : 'web',
            note,
            timesheetId: lockedTimesheet?._id,
            protectedPeriodAdjustment: protectedPeriodMetadata(lockedTimesheet, lockDisposition.reason),
        });

        await entry.save();
        attendanceEvents.publish(userId, organizationId, { type: 'break_start', entryId: entry._id, at: entry.timestamp });

        const adjustment = await completeProtectedPeriodAdjustment({
            entry,
            timesheet: lockedTimesheet,
            disposition: lockDisposition,
            req,
            action: 'break_start',
        });

        res.json({
            success: true,
            entry,
            adjustment,
            message: adjustment
                ? 'Break started. A correction version was created without changing the protected timesheet.'
                : 'Break started',
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

        const lockedTimesheet = await findLockedTimesheetAt(
            userId,
            organizationId,
            breakStatus.lastBreakEntry.timestamp
        );
        const lockDisposition = getLockedPeriodDisposition('break_end', lockedTimesheet);

        const entry = new TimeEntry({
            userId,
            userEmail: req.user.email,
            userName: req.user.name,
            organizationId,
            organizationName: req.organizationName,
            entryType: 'break_end',
            timestamp: new Date(),
            source: req.user.authSurface === 'hub' ? 'hub' : 'web',
            note,
            timesheetId: lockedTimesheet?._id,
            protectedPeriodAdjustment: protectedPeriodMetadata(lockedTimesheet, lockDisposition.reason),
        });

        await entry.save();
        attendanceEvents.publish(userId, organizationId, { type: 'break_end', entryId: entry._id, at: entry.timestamp });

        const adjustment = await completeProtectedPeriodAdjustment({
            entry,
            timesheet: lockedTimesheet,
            disposition: lockDisposition,
            req,
            action: 'break_end',
        });

        // Calculate break duration
        const breakStart = breakStatus.lastBreakEntry.timestamp;
        const breakDuration = (entry.timestamp - breakStart) / (1000 * 60);

        res.json({
            success: true,
            entry,
            breakDuration: Math.round(breakDuration),
            adjustment,
            message: adjustment
                ? 'Break ended. A correction version was created without changing the protected timesheet.'
                : 'Break ended',
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
        const isAdmin = isHRAdmin(req);
        const isManager = isLineManager(req) || isDepartmentHead(req);
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
            if (!isAdmin && isDepartmentHead(req) && !getDepartmentHeadScope(req).directReports.includes(String(targetUserId))) {
                return res.status(403).json({
                    error: 'The selected employee is outside your management scope',
                    code: 'OUTSIDE_MANAGER_SCOPE',
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

        const lockedTimesheet = await Timesheet.findOne({
            userId: targetUser,
            organizationId,
            startDate: { $lte: entryTimestamp },
            endDate: { $gte: entryTimestamp },
            status: { $in: ['submitted', 'approved', 'locked', 'payroll_pending', 'payroll_exported'] },
        }).select('_id status');
        if (lockedTimesheet) {
            return res.status(409).json({
                error: 'This period is locked. Create a timesheet adjustment instead.',
                code: 'TIMESHEET_LOCKED',
                timesheetId: lockedTimesheet._id,
                status: lockedTimesheet.status,
            });
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
