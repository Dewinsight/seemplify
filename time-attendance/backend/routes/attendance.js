const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, isHRAdmin, isLineManager } = require('../middleware/auth');
const { TimeEntry, Timesheet, AttendancePolicy } = require('../models');
const emailService = require('../services/emailService');
const { startOfDay, endOfDay, startOfWeek, endOfWeek, subDays, format } = require('date-fns');

const MANAGER_ROLES = ['line_manager', 'team_lead'];

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

// Get team attendance table dataset (for line managers/admins)
router.get('/team', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const selectedTeamId = req.query.teamId ? String(req.query.teamId) : null;

        if (!isHRAdmin(req) && !isLineManager(req)) {
            return res.status(403).json({ error: 'Manager access required' });
        }

        const managedTeams = getManagedTeams(req, organizationId);

        if (!isHRAdmin(req) && managedTeams.length === 0) {
            return res.json({
                team: [],
                summary: {
                    total: 0,
                    working: 0,
                    onBreak: 0,
                    clockedOut: 0,
                    notClockedIn: 0,
                },
            });
        }

        if (selectedTeamId && !isHRAdmin(req)) {
            const hasAccess = managedTeams.some(team => team.id === selectedTeamId);
            if (!hasAccess) {
                return res.status(403).json({ error: 'Access denied to this team' });
            }
        }

        const scopedTeams = selectedTeamId
            ? managedTeams.filter(team => team.id === selectedTeamId)
            : managedTeams;

        const memberSeed = getManagedUserSeed(scopedTeams);
        let targetUserIds = Array.from(memberSeed.keys());

        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const todayQuery = {
            organizationId,
            timestamp: { $gte: todayStart, $lte: todayEnd },
        };

        if (selectedTeamId) {
            todayQuery.teamId = selectedTeamId;
        }

        if (targetUserIds.length > 0) {
            todayQuery.userId = { $in: targetUserIds };
        } else if (!isHRAdmin(req)) {
            return res.json({
                team: [],
                summary: {
                    total: 0,
                    working: 0,
                    onBreak: 0,
                    clockedOut: 0,
                    notClockedIn: 0,
                },
            });
        }

        const todayEntries = await TimeEntry.find(todayQuery)
            .sort({ userId: 1, timestamp: 1 })
            .lean();

        // HR admin fallback: if no direct reports are available from claims,
        // roster is derived from users with activity today.
        if (isHRAdmin(req) && targetUserIds.length === 0) {
            for (const entry of todayEntries) {
                if (!memberSeed.has(entry.userId)) {
                    memberSeed.set(entry.userId, {
                        userId: entry.userId,
                        teamId: entry.teamId || null,
                        teamName: entry.teamName || null,
                    });
                }
            }
            targetUserIds = Array.from(memberSeed.keys());
        }

        if (targetUserIds.length === 0) {
            return res.json({
                team: [],
                summary: {
                    total: 0,
                    working: 0,
                    onBreak: 0,
                    clockedOut: 0,
                    notClockedIn: 0,
                },
            });
        }

        const [latestEntryMap, latestTimesheetMap] = await Promise.all([
            getLatestEntryMap(organizationId, targetUserIds),
            getLatestTimesheetMap(organizationId, targetUserIds),
        ]);

        const entriesByUser = getEntriesByUser(todayEntries);
        const rows = buildTeamRows({
            targetUserIds,
            memberSeed,
            entriesByUser,
            latestEntryMap,
            latestTimesheetMap,
        });

        const summary = {
            total: rows.length,
            working: rows.filter(row => row.status === 'working').length,
            onBreak: rows.filter(row => row.status === 'on_break').length,
            clockedOut: rows.filter(row => row.status === 'clocked_out' || row.status === 'not_clocked_in').length,
            notClockedIn: rows.filter(row => row.status === 'not_clocked_in').length,
        };

        res.json({
            team: rows,
            summary,
        });
    } catch (error) {
        console.error('Get team attendance error:', error);
        res.status(500).json({ error: 'Failed to get team attendance' });
    }
});

// Send a manual clock-out reminder to a team member with an active session
router.post('/team/:userId/notify-clock-out', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const targetUserId = req.params.userId;
        const managerUserId = req.user.id;
        const managerName = req.user.name || req.user.email || req.user.id;

        if (!isHRAdmin(req) && !isLineManager(req)) {
            return res.status(403).json({ error: 'Manager access required' });
        }

        if (!isHRAdmin(req) && !canManagerAccessUser(req, targetUserId, organizationId)) {
            return res.status(403).json({ error: 'Access denied to this team member' });
        }

        const activeClockIn = await getActiveClockInEntry(organizationId, targetUserId);
        if (!activeClockIn) {
            return res.status(400).json({ error: 'This team member is not currently clocked in' });
        }

        const recentManualReminderAt = activeClockIn.autoClockOut?.manualReminderSentAt
            ? new Date(activeClockIn.autoClockOut.manualReminderSentAt)
            : null;
        const now = new Date();
        if (recentManualReminderAt && (now - recentManualReminderAt) < 5 * 60 * 1000) {
            return res.status(429).json({
                error: 'A reminder was sent recently. Please wait a few minutes before sending another one.',
            });
        }

        const policy = await AttendancePolicy.findOne({ organizationId }).lean();
        const thresholdHours = Math.max(
            1,
            Number(policy?.clockSettings?.autoClockOut?.afterHours) || 10
        );
        const maxWarningMinutes = Math.max(1, Math.floor(thresholdHours * 60) - 1);
        const configuredWarning = Number(policy?.clockSettings?.autoClockOut?.warningMinutesBefore) || 30;
        const warningMinutes = Math.max(1, Math.min(configuredWarning, maxWarningMinutes));

        const sendResult = await emailService.sendAutoClockOutWarning(
            {
                userName: activeClockIn.userName,
                deadlineAt: new Date(activeClockIn.timestamp.getTime() + thresholdHours * 60 * 60 * 1000),
                warningMinutes,
                thresholdHours,
            },
            activeClockIn.userEmail
        );

        if (!sendResult.success) {
            return res.status(500).json({
                error: sendResult.reason || sendResult.error || 'Failed to send reminder email',
            });
        }

        activeClockIn.autoClockOut = {
            ...(activeClockIn.autoClockOut || {}),
            warningSentAt: now,
            warningEmailMessageId: sendResult.messageId || activeClockIn.autoClockOut?.warningEmailMessageId || null,
            manualReminderSentAt: now,
            manualReminderEmailMessageId: sendResult.messageId || null,
            manualReminderSentBy: managerUserId,
        };
        await activeClockIn.save();

        res.json({
            success: true,
            message: `Clock-out reminder sent to ${activeClockIn.userName || activeClockIn.userEmail}`,
            userId: targetUserId,
            userEmail: activeClockIn.userEmail,
            sentBy: managerName,
            sentAt: now.toISOString(),
        });
    } catch (error) {
        console.error('Send clock-out reminder error:', error);
        res.status(500).json({ error: 'Failed to send clock-out reminder' });
    }
});

// Get detailed attendance information for a single team member
router.get('/team/:userId', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const targetUserId = req.params.userId;

        if (!isHRAdmin(req) && !isLineManager(req)) {
            return res.status(403).json({ error: 'Manager access required' });
        }

        if (!isHRAdmin(req) && !canManagerAccessUser(req, targetUserId, organizationId)) {
            return res.status(403).json({ error: 'Access denied to this team member' });
        }

        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());

        const [todayEntries, recentEntries, latestTimesheet] = await Promise.all([
            TimeEntry.find({
                organizationId,
                userId: targetUserId,
                timestamp: { $gte: todayStart, $lte: todayEnd },
            }).sort({ timestamp: 1 }).lean(),
            TimeEntry.find({
                organizationId,
                userId: targetUserId,
            }).sort({ timestamp: -1 }).limit(50).lean(),
            Timesheet.findOne({
                organizationId,
                userId: targetUserId,
            }).sort({ startDate: -1 }).lean(),
        ]);

        const managerTeam = getManagedTeams(req, organizationId).find(team =>
            Array.isArray(team.directReports) && team.directReports.includes(targetUserId)
        );

        const member = buildTeamMemberRow({
            userId: targetUserId,
            seed: managerTeam
                ? {
                    userId: targetUserId,
                    teamId: managerTeam.id || null,
                    teamName: managerTeam.name || null,
                }
                : null,
            todayEntries,
            latestEntry: recentEntries[0] || null,
            latestTimesheet,
        });

        const todaySummary = calculateTodayMemberStats(todayEntries);

        res.json({
            member,
            todaySummary: {
                workedMinutes: todaySummary.workedMinutes,
                workedHours: todaySummary.workedHours,
                breakMinutes: todaySummary.breakMinutes,
                activeClockInAt: todaySummary.activeClockIn?.timestamp || null,
                latestClockOutAt: todaySummary.latestClockOut?.timestamp || null,
            },
            todayEntries,
            recentEntries,
        });
    } catch (error) {
        console.error('Get team member detail error:', error);
        res.status(500).json({ error: 'Failed to get team member detail' });
    }
});

// Get attendance summary for a period
router.get('/summary', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        let { startDate, endDate, period = 'month', userId } = req.query;

        // Default to current user if not specified
        if (!userId) {
            userId = req.user.id;
        } else if (userId !== req.user.id) {
            // If requesting for another user, check permissions
            if (!isHRAdmin(req) && !isLineManager(req)) {
                return res.status(403).json({ error: 'Access denied' });
            }

            if (!isHRAdmin(req) && !canManagerAccessUser(req, userId, organizationId)) {
                return res.status(403).json({ error: 'Access denied to this team member' });
            }
        }

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

function getManagedTeams(req, organizationId) {
    return (req.user.teams || []).filter(team =>
        team.organizationId === organizationId &&
        MANAGER_ROLES.includes(team.role)
    );
}

function getManagedUserSeed(teams) {
    const seed = new Map();

    for (const team of teams) {
        const reports = Array.isArray(team.directReports) ? team.directReports : [];

        for (const userId of reports) {
            if (!seed.has(userId)) {
                seed.set(userId, {
                    userId,
                    teamId: team.id || null,
                    teamName: team.name || null,
                });
            }
        }
    }

    return seed;
}

function canManagerAccessUser(req, userId, organizationId) {
    if (isHRAdmin(req)) {
        return true;
    }

    const managedTeams = getManagedTeams(req, organizationId);
    return managedTeams.some(team =>
        Array.isArray(team.directReports) && team.directReports.includes(userId)
    );
}

async function getActiveClockInEntry(organizationId, userId) {
    const latestClockIn = await TimeEntry.findOne({
        organizationId,
        userId,
        entryType: 'clock_in',
    }).sort({ timestamp: -1 });

    if (!latestClockIn) {
        return null;
    }

    const clockOutAfter = await TimeEntry.findOne({
        organizationId,
        userId,
        entryType: 'clock_out',
        timestamp: { $gt: latestClockIn.timestamp },
    })
        .select('_id timestamp')
        .lean();

    if (clockOutAfter) {
        return null;
    }

    return latestClockIn;
}

function getEntriesByUser(entries) {
    const entriesByUser = new Map();

    for (const entry of entries) {
        if (!entriesByUser.has(entry.userId)) {
            entriesByUser.set(entry.userId, []);
        }
        entriesByUser.get(entry.userId).push(entry);
    }

    return entriesByUser;
}

async function getLatestEntryMap(organizationId, userIds) {
    if (!userIds.length) {
        return new Map();
    }

    const latestEntries = await TimeEntry.aggregate([
        {
            $match: {
                organizationId,
                userId: { $in: userIds },
            },
        },
        { $sort: { timestamp: -1 } },
        {
            $group: {
                _id: '$userId',
                entry: { $first: '$$ROOT' },
            },
        },
    ]);

    return new Map(latestEntries.map(item => [item._id, item.entry]));
}

async function getLatestTimesheetMap(organizationId, userIds) {
    if (!userIds.length) {
        return new Map();
    }

    const latestTimesheets = await Timesheet.aggregate([
        {
            $match: {
                organizationId,
                userId: { $in: userIds },
            },
        },
        { $sort: { startDate: -1 } },
        {
            $group: {
                _id: '$userId',
                timesheet: {
                    $first: {
                        userName: '$userName',
                        userEmail: '$userEmail',
                        teamId: '$teamId',
                        teamName: '$teamName',
                    },
                },
            },
        },
    ]);

    return new Map(latestTimesheets.map(item => [item._id, item.timesheet]));
}

function buildTeamRows({ targetUserIds, memberSeed, entriesByUser, latestEntryMap, latestTimesheetMap }) {
    const rows = targetUserIds.map(userId => {
        const todayEntries = entriesByUser.get(userId) || [];
        return buildTeamMemberRow({
            userId,
            seed: memberSeed.get(userId),
            todayEntries,
            latestEntry: latestEntryMap.get(userId) || null,
            latestTimesheet: latestTimesheetMap.get(userId) || null,
        });
    });

    const statusOrder = {
        working: 0,
        on_break: 1,
        clocked_out: 2,
        not_clocked_in: 3,
    };

    return rows.sort((a, b) => {
        const statusDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
        if (statusDiff !== 0) return statusDiff;

        return (a.userName || '').localeCompare(b.userName || '');
    });
}

function buildTeamMemberRow({ userId, seed, todayEntries, latestEntry, latestTimesheet }) {
    const todayStats = calculateTodayMemberStats(todayEntries || []);
    const latestReference = latestEntry || todayStats.lastEntryToday || null;

    const userName =
        latestReference?.userName ||
        latestTimesheet?.userName ||
        seed?.userName ||
        `User ${String(userId).slice(0, 8)}`;

    const userEmail =
        latestReference?.userEmail ||
        latestTimesheet?.userEmail ||
        seed?.userEmail ||
        null;

    const teamId =
        seed?.teamId ||
        latestReference?.teamId ||
        latestTimesheet?.teamId ||
        null;

    const teamName =
        seed?.teamName ||
        latestReference?.teamName ||
        latestTimesheet?.teamName ||
        null;

    return {
        userId,
        userName,
        userEmail,
        teamId,
        teamName,
        status: deriveStatusFromEntry(latestReference),
        clockInAt: todayStats.latestClockIn?.timestamp || null,
        clockOutAt: todayStats.latestClockOut?.timestamp || null,
        clockInLocation: todayStats.latestClockIn?.location || null,
        clockOutLocation: todayStats.latestClockOut?.location || null,
        workedMinutesToday: todayStats.workedMinutes,
        workedHoursToday: todayStats.workedHours,
        breakMinutesToday: todayStats.breakMinutes,
        hasActiveSession: Boolean(todayStats.activeClockIn),
        lastActivity: latestReference?.timestamp || null,
        lastActivityType: latestReference?.entryType || null,
    };
}

function calculateTodayMemberStats(entries) {
    if (!entries || entries.length === 0) {
        return {
            workedMinutes: 0,
            workedHours: 0,
            breakMinutes: 0,
            latestClockIn: null,
            latestClockOut: null,
            activeClockIn: null,
            lastEntryToday: null,
        };
    }

    const sortedEntries = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let activeClockIn = null;
    let latestClockIn = null;
    let latestClockOut = null;
    let breakStart = null;
    let totalMinutes = 0;
    let breakMinutes = 0;

    for (const entry of sortedEntries) {
        switch (entry.entryType) {
            case 'clock_in':
                activeClockIn = entry;
                latestClockIn = entry;
                breakStart = null;
                break;
            case 'break_start':
                if (activeClockIn) {
                    breakStart = new Date(entry.timestamp);
                }
                break;
            case 'break_end':
                if (breakStart) {
                    breakMinutes += (new Date(entry.timestamp) - breakStart) / (1000 * 60);
                    breakStart = null;
                }
                break;
            case 'clock_out':
                if (activeClockIn) {
                    totalMinutes += (new Date(entry.timestamp) - new Date(activeClockIn.timestamp)) / (1000 * 60);
                    activeClockIn = null;
                }
                latestClockOut = entry;
                breakStart = null;
                break;
            default:
                break;
        }
    }

    const now = Date.now();

    if (activeClockIn) {
        totalMinutes += (now - new Date(activeClockIn.timestamp).getTime()) / (1000 * 60);
    }

    if (breakStart) {
        breakMinutes += (now - breakStart.getTime()) / (1000 * 60);
    }

    const workedMinutes = Math.max(0, totalMinutes - breakMinutes);

    return {
        workedMinutes: Math.round(workedMinutes),
        workedHours: parseFloat((workedMinutes / 60).toFixed(2)),
        breakMinutes: Math.round(breakMinutes),
        latestClockIn,
        latestClockOut,
        activeClockIn,
        lastEntryToday: sortedEntries[sortedEntries.length - 1] || null,
    };
}

function deriveStatusFromEntry(entry) {
    if (!entry) return 'not_clocked_in';

    if (entry.entryType === 'break_start') return 'on_break';
    if (entry.entryType === 'clock_in' || entry.entryType === 'break_end') return 'working';
    if (entry.entryType === 'clock_out') return 'clocked_out';

    return 'clocked_out';
}

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
            default:
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

    for (const [, dayEntries] of Object.entries(dayStats)) {
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
