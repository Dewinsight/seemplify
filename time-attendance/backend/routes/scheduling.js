const express = require('express');
const router = express.Router();
const {
    requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope,
} = require('../middleware/auth');
const {
    ShiftTemplate, Shift, Availability, ShiftRequest, SchedulePublication, AttendancePolicy, EmployeeRoster,
} = require('../models');
const { findShiftConflicts } = require('../services/schedulingService');
const { createNotification } = require('../services/notificationService');

router.use(requireAuth, requireOrganization);

function managedUserIds(req) {
    const ids = new Set(getDepartmentHeadScope(req).directReports || []);
    for (const team of req.user.teams || []) {
        if (team.organizationId !== req.organizationId || !['line_manager', 'team_lead'].includes(team.role)) continue;
        for (const id of [...(team.directReports || []), ...(team.directReportAccountIds || [])]) ids.add(String(id));
    }
    return ids;
}

function canManage(req, userId) {
    return isHRAdmin(req) || ((isLineManager(req) || isDepartmentHead(req)) && managedUserIds(req).has(String(userId)));
}

function requireScheduler(req, res) {
    if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req)) {
        res.status(403).json({ error: 'Schedule management access required' });
        return false;
    }
    return true;
}

router.get('/templates', async (req, res) => {
    const templates = await ShiftTemplate.find({ organizationId: req.organizationId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json({ templates });
});

router.post('/templates', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    try {
        const template = await ShiftTemplate.create({
            organizationId: req.organizationId,
            name: req.body.name,
            scheduleType: req.body.scheduleType,
            startTime: req.body.startTime,
            endTime: req.body.endTime,
            breakMinutes: req.body.breakMinutes,
            workMode: req.body.workMode,
            locationId: req.body.locationId,
            activityCode: req.body.activityCode,
            costCentreCode: req.body.costCentreCode,
            rotation: req.body.rotation,
            createdBy: req.user.id,
            updatedBy: req.user.id,
        });
        return res.status(201).json({ template });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create shift template' });
    }
});

router.patch('/templates/:id', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    const allowed = {};
    for (const key of ['name', 'scheduleType', 'startTime', 'endTime', 'breakMinutes', 'workMode', 'locationId', 'activityCode', 'costCentreCode', 'rotation', 'isActive']) {
        if (req.body[key] !== undefined) allowed[key] = req.body[key];
    }
    allowed.updatedBy = req.user.id;
    const template = await ShiftTemplate.findOneAndUpdate({ _id: req.params.id, organizationId: req.organizationId }, { $set: allowed }, { new: true, runValidators: true });
    if (!template) return res.status(404).json({ error: 'Shift template not found' });
    return res.json({ template });
});

router.get('/shifts', async (req, res) => {
    const query = { organizationId: req.organizationId };
    const requestedUserId = req.query.userId;
    if (requestedUserId && requestedUserId !== req.user.id) {
        if (!canManage(req, requestedUserId)) return res.status(403).json({ error: 'Access denied' });
        query.userId = requestedUserId;
    } else if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req) && req.query.open !== 'true') {
        query.userId = req.user.id;
    } else if (requestedUserId) {
        query.userId = requestedUserId;
    }
    if (req.query.start) query.endAt = { $gte: new Date(req.query.start) };
    if (req.query.end) query.startAt = { $lte: new Date(req.query.end) };
    if (req.query.status) query.status = req.query.status;
    if (req.query.open === 'true') query.openShift = true;
    const shifts = await Shift.find(query).sort({ startAt: 1 }).limit(1000).populate('templateId');
    return res.json({ shifts });
});

router.post('/shifts', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    if (req.body.userId && !canManage(req, req.body.userId)) return res.status(403).json({ error: 'The employee is outside your management scope' });
    const shiftStart = new Date(req.body.startAt);
    if (Number.isNaN(shiftStart.getTime())) return res.status(400).json({ error: 'A valid shift start is required' });
    if (req.body.userId) {
        const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: req.body.userId }).lean();
        if (roster?.status === 'inactive' || (roster?.effectiveExitAt && shiftStart >= new Date(roster.effectiveExitAt))) {
            return res.status(409).json({
                error: 'This employee is not attendance-eligible at the shift start time',
                code: 'EMPLOYEE_NOT_ELIGIBLE',
                effectiveExitAt: roster.effectiveExitAt,
            });
        }
    }
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    const conflict = await findShiftConflicts({
        organizationId: req.organizationId,
        userId: req.body.userId,
        startAt: req.body.startAt,
        endAt: req.body.endAt,
        minimumRestMinutes: Number(req.body.minimumRestMinutes || 0),
    });
    if (!conflict.valid && req.body.overrideConflicts !== true) return res.status(409).json({ error: 'Shift conflicts must be resolved', conflict });
    try {
        const shift = await Shift.create({
            organizationId: req.organizationId,
            userId: req.body.userId || null,
            teamId: req.body.teamId,
            templateId: req.body.templateId,
            startAt: req.body.startAt,
            endAt: req.body.endAt,
            timezone: req.body.timezone || policy.timezone || 'UTC',
            breakMinutes: req.body.breakMinutes || 0,
            workMode: req.body.workMode || 'office',
            locationId: req.body.locationId,
            activityCode: req.body.activityCode,
            costCentreCode: req.body.costCentreCode,
            openShift: Boolean(req.body.openShift),
            createdBy: req.user.id,
            updatedBy: req.user.id,
            changeHistory: [{ action: 'created', actorId: req.user.id, actorName: req.user.name, details: conflict.warnings.map(item => item.code).join(', ') }],
        });
        return res.status(201).json({ shift, conflict });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to create shift' });
    }
});

router.patch('/shifts/:id', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    const shift = await Shift.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.userId && !canManage(req, shift.userId)) return res.status(403).json({ error: 'Access denied' });
    const next = { startAt: req.body.startAt || shift.startAt, endAt: req.body.endAt || shift.endAt, userId: req.body.userId ?? shift.userId };
    if (next.userId) {
        const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: next.userId }).lean();
        if (roster?.status === 'inactive' || (roster?.effectiveExitAt && new Date(next.startAt) >= new Date(roster.effectiveExitAt))) {
            return res.status(409).json({ error: 'This employee is not attendance-eligible at the shift start time', code: 'EMPLOYEE_NOT_ELIGIBLE' });
        }
    }
    const conflict = await findShiftConflicts({ organizationId: req.organizationId, ...next, excludeShiftId: shift._id, minimumRestMinutes: Number(req.body.minimumRestMinutes || 0) });
    if (!conflict.valid && req.body.overrideConflicts !== true) return res.status(409).json({ error: 'Shift conflicts must be resolved', conflict });
    for (const key of ['userId', 'teamId', 'templateId', 'startAt', 'endAt', 'timezone', 'breakMinutes', 'workMode', 'locationId', 'activityCode', 'costCentreCode', 'openShift', 'status']) {
        if (req.body[key] !== undefined) shift[key] = req.body[key];
    }
    shift.updatedBy = req.user.id;
    shift.changeHistory.push({ action: 'updated', actorId: req.user.id, actorName: req.user.name, details: req.body.reason || 'Schedule edited' });
    await shift.save();
    return res.json({ shift, conflict });
});

router.post('/publish', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    const periodStart = new Date(req.body.periodStart);
    const periodEnd = new Date(req.body.periodEnd);
    const latest = await SchedulePublication.findOne({ organizationId: req.organizationId, periodStart, periodEnd }).sort({ version: -1 });
    const shifts = await Shift.find({ organizationId: req.organizationId, startAt: { $lte: periodEnd }, endAt: { $gte: periodStart }, status: 'draft' });
    const publication = await SchedulePublication.create({
        organizationId: req.organizationId,
        periodStart,
        periodEnd,
        version: (latest?.version || 0) + 1,
        shiftIds: shifts.map(shift => shift._id),
        publishedBy: req.user.id,
        note: req.body.note,
    });
    await Shift.updateMany({ _id: { $in: publication.shiftIds } }, { $set: { status: 'published', publicationVersion: publication.version, 'acknowledgement.status': 'pending' } });
    await Promise.all(shifts.filter(shift => shift.userId).map(shift => createNotification({
        organizationId: req.organizationId,
        userId: shift.userId,
        type: 'schedule_changed',
        title: 'Schedule published',
        message: `Your shift starting ${new Date(shift.startAt).toLocaleString()} has been published.`,
        actionUrl: '/schedule',
        priority: 'normal',
        eventKey: `schedule-published:${publication._id}:${shift._id}`,
    })));
    return res.json({ publication, publishedCount: shifts.length });
});

router.post('/shifts/:id/acknowledge', async (req, res) => {
    const shift = await Shift.findOne({ _id: req.params.id, organizationId: req.organizationId, userId: req.user.id, status: 'published' });
    if (!shift) return res.status(404).json({ error: 'Published shift not found' });
    shift.acknowledgement = { status: req.body.accepted === false ? 'declined' : 'acknowledged', at: new Date(), note: req.body.note };
    shift.changeHistory.push({ action: shift.acknowledgement.status, actorId: req.user.id, actorName: req.user.name, details: req.body.note });
    await shift.save();
    return res.json({ shift });
});

router.get('/availability', async (req, res) => {
    const target = req.query.userId || req.user.id;
    if (target !== req.user.id && !canManage(req, target)) return res.status(403).json({ error: 'Access denied' });
    const availability = await Availability.find({ organizationId: req.organizationId, userId: target }).sort({ date: 1 });
    return res.json({ availability });
});

router.put('/availability/:date', async (req, res) => {
    const date = new Date(req.params.date);
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const availability = await Availability.findOneAndUpdate(
        { organizationId: req.organizationId, userId: req.user.id, date },
        { $set: { available: req.body.available !== false, startTime: req.body.startTime, endTime: req.body.endTime, note: req.body.note } },
        { upsert: true, new: true, runValidators: true }
    );
    return res.json({ availability });
});

router.post('/requests', async (req, res) => {
    const isOpenCover = req.body.type === 'cover';
    const shift = await Shift.findOne({
        _id: req.body.shiftId,
        organizationId: req.organizationId,
        ...(isOpenCover ? { openShift: true, status: 'published' } : { userId: req.user.id }),
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const request = await ShiftRequest.create({
        organizationId: req.organizationId,
        type: req.body.type,
        shiftId: shift._id,
        requestedBy: req.user.id,
        targetUserId: isOpenCover ? req.user.id : req.body.targetUserId,
        offeredShiftId: req.body.offeredShiftId,
        reason: req.body.reason,
    });
    return res.status(201).json({ request });
});

router.get('/requests', async (req, res) => {
    const query = { organizationId: req.organizationId };
    if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req)) query.requestedBy = req.user.id;
    const requests = await ShiftRequest.find(query).sort({ createdAt: -1 }).populate('shiftId offeredShiftId');
    return res.json({ requests });
});

router.post('/requests/:id/review', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    const request = await ShiftRequest.findOne({ _id: req.params.id, organizationId: req.organizationId, status: 'pending' }).populate('shiftId');
    if (!request) return res.status(404).json({ error: 'Pending request not found' });
    if (request.shiftId?.userId && !canManage(req, request.shiftId.userId)) return res.status(403).json({ error: 'Access denied' });
    request.status = req.body.approved ? 'approved' : 'rejected';
    request.reviewedBy = req.user.id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body.note;
    if (req.body.approved && request.targetUserId) {
        request.shiftId.userId = request.targetUserId;
        request.shiftId.openShift = false;
        request.shiftId.changeHistory.push({ action: 'request_approved', actorId: req.user.id, actorName: req.user.name, details: request.type });
        await request.shiftId.save();
    }
    await request.save();
    return res.json({ request });
});

module.exports = router;
