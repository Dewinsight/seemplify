const express = require('express');
const router = express.Router();
const {
    requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope,
} = require('../middleware/auth');
const {
    ALLOWED_APPLICATIONS, PresenceSession, PresenceEvent, PresenceDailySummary, ApplicationAssignment,
    PresenceAccessLog, PresencePrivacyRequest,
    AttendancePolicy, EmployeeRoster,
} = require('../models');
const {
    HEARTBEAT_INTERVAL_SECONDS, STALE_AFTER_SECONDS, appendEvent, compareAttendancePresence,
    expectedApplications, hashIp, userAgentFamily,
} = require('../services/presenceService');

router.use(requireAuth, requireOrganization);

function cleanSessionId(value) {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{12,128}$/.test(normalized) ? normalized : null;
}

function cleanFeatureCode(value) {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9._:-]{1,80}$/.test(normalized) ? normalized : null;
}

function dateRange(query, defaultDurationMs) {
    const end = query.end ? new Date(query.end) : new Date();
    const start = query.start ? new Date(query.start) : new Date(end.getTime() - defaultDurationMs);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
    return { start, end };
}

function managementScope(req) {
    const ids = new Set(getDepartmentHeadScope(req).directReports || []);
    for (const team of req.user.teams || []) {
        if (team.organizationId !== req.organizationId || !['line_manager', 'team_lead'].includes(team.role)) continue;
        for (const id of [...(team.directReports || []), ...(team.directReportAccountIds || [])]) ids.add(String(id));
    }
    return ids;
}

router.get('/notice', async (req, res) => {
    const policy = await AttendancePolicy.findOne({ organizationId: req.organizationId }).select('presence').lean();
    return res.json({
    enabled: policy?.presence?.enabled !== false,
    purpose: 'Application-presence events support attendance review and system-access troubleshooting. They are not productivity scores.',
    captured: ['application', 'session start/end', 'visible-tab heartbeat', 'last meaningful navigation or action time'],
    excluded: ['keystrokes', 'field values', 'document contents', 'screenshots', 'camera images', 'biometrics'],
    heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    rawRetentionDays: Math.min(90, Number(policy?.presence?.rawEventRetentionDays || 90)),
    dailySummaryRetentionDays: Number(policy?.presence?.dailySummaryRetentionDays || 730),
    safeguards: ['supporting evidence only', 'employee self-access', 'scoped manager access', 'audited HR access', 'no automated pay, discipline or performance decisions'],
    });
});

router.post('/sessions', async (req, res) => {
    const appId = String(req.body.appId || '').trim();
    const clientSessionId = cleanSessionId(req.body.clientSessionId);
    if (appId !== 'time-attendance') return res.status(403).json({ error: 'This reporter can submit only Time & Attendance evidence' });
    if (!clientSessionId) return res.status(400).json({ error: 'A valid clientSessionId is required' });
    const policy = await AttendancePolicy.findOne({ organizationId: req.organizationId }).select('presence.enabled').lean();
    if (policy?.presence?.enabled === false) return res.status(403).json({ error: 'Presence reporting is disabled for this organization' });
    const now = new Date();
    const session = await PresenceSession.findOneAndUpdate(
        { organizationId: req.organizationId, userId: req.user.id, appId, clientSessionId },
        {
            $setOnInsert: { startedAt: now, ipHash: hashIp(req.ip), userAgentFamily: userAgentFamily(req.get('user-agent')) },
            $set: { lastHeartbeatAt: now, visible: req.body.visible !== false, status: 'active', appVersion: String(req.body.appVersion || '').slice(0, 80) },
            $unset: { endedAt: 1, endReason: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await appendEvent(session, 'started');
    return res.status(201).json({ session, heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS, staleAfterSeconds: STALE_AFTER_SECONDS });
});

async function ownSession(req, res) {
    const session = await PresenceSession.findOne({ _id: req.params.id, organizationId: req.organizationId, userId: req.user.id });
    if (!session) res.status(404).json({ error: 'Presence session not found' });
    return session;
}

router.post('/sessions/:id/heartbeat', async (req, res) => {
    const session = await ownSession(req, res);
    if (!session) return;
    const visible = req.body.visible !== false;
    session.visible = visible;
    session.lastHeartbeatAt = new Date();
    session.status = 'active';
    await session.save();
    await appendEvent(session, visible ? 'heartbeat' : 'hidden');
    return res.json({ accepted: true, nextHeartbeatSeconds: HEARTBEAT_INTERVAL_SECONDS });
});

router.post('/sessions/:id/activity', async (req, res) => {
    const session = await ownSession(req, res);
    if (!session) return;
    const activityKind = ['navigation', 'action'].includes(req.body.activityKind) ? req.body.activityKind : null;
    const featureCode = cleanFeatureCode(req.body.featureCode);
    if (!activityKind || !featureCode) return res.status(400).json({ error: 'A safe activityKind and featureCode are required' });
    session.lastActivityAt = new Date();
    session.lastHeartbeatAt = new Date();
    session.status = 'active';
    await session.save();
    await appendEvent(session, 'activity', { activityKind, featureCode });
    return res.json({ accepted: true });
});

router.post('/sessions/:id/end', async (req, res) => {
    const session = await ownSession(req, res);
    if (!session) return;
    session.endedAt = new Date();
    session.status = 'ended';
    session.endReason = String(req.body.reason || 'client_end').slice(0, 80);
    await session.save();
    await appendEvent(session, 'ended');
    return res.json({ accepted: true });
});

router.get('/me', async (req, res) => {
    const range = dateRange(req.query, 7 * 24 * 60 * 60 * 1000);
    if (!range) return res.status(400).json({ error: 'A valid start and end date range is required' });
    const { start, end } = range;
    if (end - start > 31 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'The maximum range is 31 days' });
    const teamIds = (req.user.teams || []).filter(team => team.organizationId === req.organizationId).map(team => String(team.id));
    const roles = [req.organizationRole, ...(req.user.teams || []).map(team => team.role)].filter(Boolean);
    const expected = await expectedApplications({ organizationId: req.organizationId, userId: req.user.id, teamIds, roles, at: end });
    const comparison = await compareAttendancePresence({ organizationId: req.organizationId, userId: req.user.id, start, end, expectedApps: expected });
    const sessions = await PresenceSession.find({ organizationId: req.organizationId, userId: req.user.id, startedAt: { $gte: start, $lte: end } }).sort({ startedAt: -1 }).limit(250).lean();
    const summaries = await PresenceDailySummary.find({ organizationId: req.organizationId, userId: req.user.id, day: { $gte: start.toISOString().slice(0, 10), $lte: end.toISOString().slice(0, 10) } }).sort({ day: -1, appId: 1 }).lean();
    return res.json({ period: { start, end }, comparison, sessions, summaries });
});

router.get('/me/export', async (req, res) => {
    const sessions = await PresenceSession.find({ organizationId: req.organizationId, userId: req.user.id }).sort({ startedAt: -1 }).lean();
    const events = await PresenceEvent.find({ organizationId: req.organizationId, userId: req.user.id }).sort({ occurredAt: -1 }).lean();
    const summaries = await PresenceDailySummary.find({ organizationId: req.organizationId, userId: req.user.id }).sort({ day: -1 }).lean();
    await PresenceAccessLog.create({ organizationId: req.organizationId, actorId: req.user.id, subjectUserIds: [req.user.id], action: 'export_own', purpose: 'Employee access request' });
    return res.json({ generatedAt: new Date(), sessions, events, summaries });
});

router.post('/privacy-requests', async (req, res) => {
    if (!['access', 'correction', 'deletion', 'objection'].includes(req.body.type)) return res.status(400).json({ error: 'Invalid privacy request type' });
    const request = await PresencePrivacyRequest.create({ organizationId: req.organizationId, userId: req.user.id, type: req.body.type, reason: String(req.body.reason || '').slice(0, 2000) });
    await PresenceAccessLog.create({ organizationId: req.organizationId, actorId: req.user.id, subjectUserIds: [req.user.id], action: 'privacy_request', purpose: req.body.type });
    return res.status(201).json({ request });
});

router.get('/privacy-requests', async (req, res) => {
    const query = { organizationId: req.organizationId };
    if (!isHRAdmin(req)) query.userId = req.user.id;
    const requests = await PresencePrivacyRequest.find(query).sort({ createdAt: -1 }).limit(250);
    return res.json({ requests });
});

router.patch('/privacy-requests/:id', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    if (!['in_review', 'completed', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid request status' });
    const request = await PresencePrivacyRequest.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!request) return res.status(404).json({ error: 'Privacy request not found' });
    request.status = req.body.status; request.reviewedBy = req.user.id; request.reviewNote = String(req.body.reviewNote || '').slice(0, 2000); await request.save();
    await PresenceAccessLog.create({ organizationId: req.organizationId, actorId: req.user.id, subjectUserIds: [request.userId], action: 'review_privacy', purpose: `${request.type}:${request.status}` });
    if (request.type === 'deletion' && request.status === 'completed') {
        await Promise.all([
            PresenceEvent.deleteMany({ organizationId: req.organizationId, userId: request.userId }),
            PresenceSession.deleteMany({ organizationId: req.organizationId, userId: request.userId }),
            PresenceDailySummary.deleteMany({ organizationId: req.organizationId, userId: request.userId }),
        ]);
        await PresenceAccessLog.create({ organizationId: req.organizationId, actorId: req.user.id, subjectUserIds: [request.userId], action: 'delete_presence_data', purpose: request.reviewNote || 'Approved employee deletion request' });
    }
    return res.json({ request });
});

router.get('/access-logs', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    const logs = await PresenceAccessLog.find({ organizationId: req.organizationId }).sort({ at: -1 }).limit(500);
    return res.json({ logs });
});

router.get('/impact-assessment-checklist', async (req, res) => res.json({
    checklist: [
        'Document the attendance purpose and reject productivity-scoring use cases.',
        'Confirm each assigned application is necessary for the employee, team, role or shift.',
        'Publish the employee notice before enabling reporting.',
        'Set the shortest workable raw-event retention, never more than 90 days.',
        'Review manager and HR permissions, access logs, export and deletion handling.',
        'Consult employees or representatives where local policy or law requires it.',
        'Test that unavailable evidence cannot change pay, discipline, timesheet approval or performance ratings.',
    ],
}));

router.get('/team', async (req, res) => {
    if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req)) return res.status(403).json({ error: 'Manager access required' });
    const requested = String(req.query.userId || '');
    let userIds = requested ? [requested] : [...managementScope(req)];
    if (!isHRAdmin(req) && userIds.some(id => !managementScope(req).has(id))) return res.status(403).json({ error: 'Employee is outside your management scope' });
    if (isHRAdmin(req) && !requested) userIds = (await EmployeeRoster.find({ organizationId: req.organizationId, status: 'active' }).select('userId').limit(1000).lean()).map(item => item.userId);
    const range = dateRange(req.query, 24 * 60 * 60 * 1000);
    if (!range || range.end - range.start > 31 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'A valid range of no more than 31 days is required' });
    const { start, end } = range;
    const sessions = await PresenceSession.find({ organizationId: req.organizationId, userId: { $in: userIds }, startedAt: { $lte: end }, $or: [{ endedAt: null }, { endedAt: { $gte: start } }] }).sort({ userId: 1, startedAt: -1 }).lean();
    await PresenceAccessLog.create({ organizationId: req.organizationId, actorId: req.user.id, subjectUserIds: userIds, action: 'view_summary', purpose: String(req.query.purpose || 'Attendance management').slice(0, 200) });
    return res.json({ period: { start, end }, sessions });
});

router.get('/assignments', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    const assignments = await ApplicationAssignment.find({ organizationId: req.organizationId }).sort({ scopeType: 1, scopeId: 1, appId: 1 });
    return res.json({ assignments, applications: ALLOWED_APPLICATIONS });
});

router.put('/assignments', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    if (!ALLOWED_APPLICATIONS.includes(req.body.appId)) return res.status(400).json({ error: 'Application is not registered' });
    if (!['organization', 'team', 'role', 'employee', 'shift'].includes(req.body.scopeType) || !req.body.scopeId) return res.status(400).json({ error: 'A valid assignment scope is required' });
    const assignment = await ApplicationAssignment.findOneAndUpdate(
        { organizationId: req.organizationId, appId: req.body.appId, scopeType: req.body.scopeType, scopeId: req.body.scopeId },
        { $set: { expected: req.body.expected !== false, effectiveFrom: req.body.effectiveFrom || new Date(), effectiveTo: req.body.effectiveTo, createdBy: req.user.id } },
        { upsert: true, new: true, runValidators: true }
    );
    return res.json({ assignment });
});

module.exports = router;
