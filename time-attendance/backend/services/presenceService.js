const crypto = require('crypto');
const {
    PresenceSession, PresenceEvent, PresenceDailySummary, ApplicationAssignment,
    AttendancePolicy, TimeEntry,
} = require('../models');

const HEARTBEAT_INTERVAL_SECONDS = 120;
const STALE_AFTER_SECONDS = 300;

function hashIp(ip) {
    const salt = process.env.PRESENCE_IP_HASH_SALT || process.env.SESSION_SECRET || 'presence';
    return crypto.createHmac('sha256', salt).update(String(ip || '')).digest('hex');
}

function userAgentFamily(userAgent) {
    const value = String(userAgent || '').toLowerCase();
    if (value.includes('firefox')) return 'Firefox';
    if (value.includes('edg/')) return 'Edge';
    if (value.includes('chrome')) return 'Chrome';
    if (value.includes('safari')) return 'Safari';
    return 'Other';
}

async function appendEvent(session, type, details = {}) {
    return PresenceEvent.create({
        organizationId: session.organizationId,
        userId: session.userId,
        sessionId: session._id,
        appId: session.appId,
        type,
        occurredAt: new Date(),
        activityKind: details.activityKind,
        featureCode: details.featureCode,
    });
}

async function markStaleSessions(now = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000);
    const result = await PresenceSession.updateMany(
        { status: 'active', lastHeartbeatAt: { $lt: cutoff } },
        { $set: { status: 'stale' } }
    );
    return { stale: result.modifiedCount };
}

function attendanceIntervals(entries, rangeEnd) {
    const intervals = [];
    let open = null;
    for (const entry of entries) {
        if (entry.entryType === 'clock_in') {
            if (open) intervals.push({ start: open, end: entry.timestamp });
            open = entry.timestamp;
        } else if (entry.entryType === 'clock_out' && open) {
            intervals.push({ start: open, end: entry.timestamp });
            open = null;
        }
    }
    if (open) intervals.push({ start: open, end: rangeEnd });
    return intervals;
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
    return leftStart <= rightEnd && leftEnd >= rightStart;
}

async function expectedApplications({ organizationId, userId, teamIds = [], roles = [], shiftIds = [], at = new Date() }) {
    const scopePairs = [
        { scopeType: 'organization', scopeId: organizationId },
        { scopeType: 'employee', scopeId: userId },
        ...teamIds.map(scopeId => ({ scopeType: 'team', scopeId })),
        ...roles.map(scopeId => ({ scopeType: 'role', scopeId })),
        ...shiftIds.map(scopeId => ({ scopeType: 'shift', scopeId })),
    ];
    const assignments = await ApplicationAssignment.find({
        organizationId,
        expected: true,
        $or: scopePairs,
        effectiveFrom: { $lte: at },
        $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }] }],
    }).lean();
    return [...new Set(assignments.map(item => item.appId))];
}

async function compareAttendancePresence({ organizationId, userId, start, end, expectedApps = [] }) {
    const [sessions, attendance] = await Promise.all([
        PresenceSession.find({ organizationId, userId, startedAt: { $lte: end }, $or: [{ endedAt: null }, { endedAt: { $gte: start } }] }).lean(),
        TimeEntry.find({ organizationId, userId, timestamp: { $gte: start, $lte: end } }).sort({ timestamp: 1 }).lean(),
    ]);
    const intervals = attendanceIntervals(attendance, end);
    const sessionsDuringAttendance = sessions.filter((session) => intervals.some(interval => overlaps(
        new Date(session.startedAt), new Date(session.endedAt || session.lastHeartbeatAt || end),
        new Date(interval.start), new Date(interval.end)
    )));
    const outsideSessions = sessions.filter(session => !sessionsDuringAttendance.includes(session));
    const cutoff = new Date(end.getTime() - STALE_AFTER_SECONDS * 1000);
    const recentSessions = sessionsDuringAttendance.filter(session =>
        session.visible !== false && new Date(session.lastHeartbeatAt || session.startedAt) >= cutoff
    );
    const appsSeen = [...new Set(recentSessions.map(session => session.appId))];
    const lastClockEvent = [...attendance].reverse().find(entry => ['clock_in', 'clock_out'].includes(entry.entryType));
    const clockedIn = lastClockEvent?.entryType === 'clock_in';
    const clockedOut = lastClockEvent?.entryType === 'clock_out';
    const missingExpectedApps = expectedApps.filter(appId => !appsSeen.includes(appId));
    let state = 'evidence_unavailable';
    if (clockedIn && expectedApps.length && missingExpectedApps.length === 0) state = 'matched';
    else if (clockedIn && missingExpectedApps.length) state = 'clocked_without_expected_evidence';
    else if (!clockedIn && sessions.some(session => new Date(session.lastHeartbeatAt || session.startedAt) >= cutoff)) state = 'activity_outside_attendance';
    return {
        state, clockedIn, clockedOut, appsSeen, expectedApps, missingExpectedApps,
        sessionCount: sessions.length, sessionsDuringAttendance: sessionsDuringAttendance.length,
        recentSessionsDuringAttendance: recentSessions.length, sessionsOutsideAttendance: outsideSessions.length,
    };
}

async function summarizeAndDeleteExpiredPresence(now = new Date()) {
    await markStaleSessions(now);
    const policies = await AttendancePolicy.find({ 'presence.enabled': { $ne: false } })
        .select('organizationId presence').lean();
    let eventsDeleted = 0;
    let sessionsDeleted = 0;
    let summariesDeleted = 0;

    for (const policy of policies) {
        const rawDays = Math.min(90, Math.max(1, Number(policy.presence?.rawEventRetentionDays || 90)));
        const summaryDays = Math.max(30, Number(policy.presence?.dailySummaryRetentionDays || 730));
        const rawCutoff = new Date(now.getTime() - rawDays * 86400000);
        const summaryCutoffDay = new Date(now.getTime() - summaryDays * 86400000).toISOString().slice(0, 10);
        const rows = await PresenceEvent.aggregate([
            { $match: { organizationId: policy.organizationId, occurredAt: { $lt: rawCutoff } } },
            { $group: {
                _id: {
                    userId: '$userId', appId: '$appId',
                    day: { $dateToString: { date: '$occurredAt', format: '%Y-%m-%d', timezone: 'UTC' } },
                },
                sessionIds: { $addToSet: '$sessionId' },
                visibleHeartbeatCount: { $sum: { $cond: [{ $in: ['$type', ['heartbeat', 'visible']] }, 1, 0] } },
                meaningfulActivityCount: { $sum: { $cond: [{ $eq: ['$type', 'activity'] }, 1, 0] } },
                firstEvidenceAt: { $min: '$occurredAt' },
                lastEvidenceAt: { $max: '$occurredAt' },
            } },
        ]);
        for (const row of rows) {
            await PresenceDailySummary.updateOne(
                { organizationId: policy.organizationId, userId: row._id.userId, appId: row._id.appId, day: row._id.day },
                { $set: {
                    sessionCount: row.sessionIds.length,
                    visibleHeartbeatCount: row.visibleHeartbeatCount,
                    meaningfulActivityCount: row.meaningfulActivityCount,
                    firstEvidenceAt: row.firstEvidenceAt,
                    lastEvidenceAt: row.lastEvidenceAt,
                    summarizedThrough: rawCutoff,
                } },
                { upsert: true }
            );
        }
        eventsDeleted += (await PresenceEvent.deleteMany({ organizationId: policy.organizationId, occurredAt: { $lt: rawCutoff } })).deletedCount;
        sessionsDeleted += (await PresenceSession.deleteMany({
            organizationId: policy.organizationId,
            $or: [{ endedAt: { $lt: rawCutoff } }, { endedAt: null, lastHeartbeatAt: { $lt: rawCutoff } }],
        })).deletedCount;
        summariesDeleted += (await PresenceDailySummary.deleteMany({ organizationId: policy.organizationId, day: { $lt: summaryCutoffDay } })).deletedCount;
    }
    return { organizations: policies.length, eventsDeleted, sessionsDeleted, summariesDeleted };
}

module.exports = {
    HEARTBEAT_INTERVAL_SECONDS,
    STALE_AFTER_SECONDS,
    appendEvent,
    compareAttendancePresence,
    expectedApplications,
    hashIp,
    markStaleSessions,
    summarizeAndDeleteExpiredPresence,
    userAgentFamily,
};
