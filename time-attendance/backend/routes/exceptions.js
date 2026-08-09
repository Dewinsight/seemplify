const express = require('express');
const router = express.Router();
const {
    requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope,
} = require('../middleware/auth');
const { AttendanceException, EmployeeRoster } = require('../models');
const { createNotification } = require('../services/notificationService');

router.use(requireAuth, requireOrganization);

function managedUserIds(req) {
    const ids = new Set((getDepartmentHeadScope(req).directReports || []).map(String));
    for (const team of req.user.teams || []) {
        if (team.organizationId !== req.organizationId || !['line_manager', 'team_lead'].includes(team.role)) continue;
        for (const id of [...(team.directReports || []), ...(team.directReportAccountIds || [])]) ids.add(String(id));
    }
    return ids;
}

function canManage(req, userId) {
    return isHRAdmin(req) || ((isLineManager(req) || isDepartmentHead(req)) && managedUserIds(req).has(String(userId)));
}

router.get('/', async (req, res) => {
    const targetUserId = req.query.userId || req.user.id;
    if (targetUserId !== req.user.id && !canManage(req, targetUserId)) return res.status(403).json({ error: 'Access denied' });
    const query = { organizationId: req.organizationId, userId: targetUserId };
    if (req.query.status && req.query.status !== 'all') query.status = req.query.status;
    if (req.query.type) query.type = req.query.type;
    if (req.query.start || req.query.end) query.occurrenceDate = {};
    if (req.query.start) query.occurrenceDate.$gte = new Date(req.query.start);
    if (req.query.end) query.occurrenceDate.$lte = new Date(req.query.end);
    const exceptions = await AttendanceException.find(query).sort({ occurrenceDate: -1 }).limit(Math.min(Number(req.query.limit || 100), 250));
    res.json({
        exceptions,
        disclaimer: 'Exceptions are explainable review flags. They do not make disciplinary, pay or performance decisions.',
    });
});

router.post('/:id/correction-requests', async (req, res) => {
    const exception = await AttendanceException.findOne({ _id: req.params.id, organizationId: req.organizationId, userId: req.user.id });
    if (!exception) return res.status(404).json({ error: 'Attendance exception not found' });
    if (!String(req.body.explanation || '').trim()) return res.status(400).json({ error: 'An explanation is required' });
    const evidence = (Array.isArray(req.body.evidence) ? req.body.evidence : []).slice(0, 10).map(item => ({
        name: String(item.name || '').slice(0, 200),
        url: /^https?:\/\//i.test(String(item.url || '')) ? item.url : undefined,
        note: String(item.note || '').slice(0, 1000),
    }));
    exception.status = 'correction_requested';
    exception.correctionRequest = {
        explanation: String(req.body.explanation).trim(),
        requestedAt: new Date(),
        evidence,
        requestedChanges: req.body.requestedChanges || {},
        decision: 'pending',
    };
    exception.auditLog.push({ action: 'correction_requested', actorId: req.user.id, actorName: req.user.name, details: exception.correctionRequest.explanation });
    await exception.save();
    const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: req.user.id }).lean();
    if (roster?.managerId) await createNotification({
        organizationId: req.organizationId, userId: roster.managerId,
        type: 'general', title: 'Attendance correction requested',
        message: `${req.user.name || req.user.email} requested a correction for ${exception.type.replace(/_/g, ' ')}.`,
        actionUrl: `/exceptions?userId=${encodeURIComponent(req.user.id)}`, priority: 'high',
        eventKey: `exception-correction:${exception._id}:${exception.correctionRequest.requestedAt.toISOString()}`,
    });
    res.status(201).json({ exception });
});

router.post('/:id/review', async (req, res) => {
    const exception = await AttendanceException.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!exception) return res.status(404).json({ error: 'Attendance exception not found' });
    if (!canManage(req, exception.userId)) return res.status(403).json({ error: 'Manager access required' });
    if (exception.status !== 'correction_requested') return res.status(409).json({ error: 'No correction request is awaiting review' });
    const accepted = req.body.accepted === true;
    exception.status = accepted ? 'resolved' : 'open';
    exception.correctionRequest.decision = accepted ? 'accepted' : 'rejected';
    exception.correctionRequest.reviewedBy = req.user.id;
    exception.correctionRequest.reviewedAt = new Date();
    exception.correctionRequest.reviewNote = String(req.body.note || '').slice(0, 2000);
    exception.auditLog.push({ action: accepted ? 'correction_accepted' : 'correction_rejected', actorId: req.user.id, actorName: req.user.name, details: exception.correctionRequest.reviewNote });
    await exception.save();
    await createNotification({
        organizationId: req.organizationId, userId: exception.userId, userEmail: exception.userEmail,
        type: 'general', title: accepted ? 'Attendance correction accepted' : 'Attendance correction not accepted',
        message: exception.correctionRequest.reviewNote || `Your correction request was ${accepted ? 'accepted' : 'not accepted'}.`,
        actionUrl: '/exceptions', priority: accepted ? 'normal' : 'high',
        eventKey: `exception-reviewed:${exception._id}:${exception.correctionRequest.reviewedAt.toISOString()}`,
    });
    res.json({ exception, nextStep: accepted ? 'Any time change must use the versioned timesheet correction workflow.' : undefined });
});

module.exports = router;
