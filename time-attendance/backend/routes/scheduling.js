const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const {
    requireAuth, requireOrganization, isHRAdmin, isLineManager, isDepartmentHead, getDepartmentHeadScope,
} = require('../middleware/auth');
const {
    ShiftTemplate, Shift, Availability, ShiftRequest, SchedulePublication, AttendancePolicy, EmployeeRoster,
} = require('../models');
const { findShiftConflicts } = require('../services/schedulingService');
const { buildApprovalWorkflow } = require('../services/approvalConfigurationService');
const { normalizeSchedulingSettings, requestPolicy } = require('../services/schedulingPolicyService');
const { validateShiftAssignment } = require('../services/shiftAssignmentPolicyService');
const { buildShiftGenerationKey, enumerateTemplateShifts } = require('../services/shiftTemplateGenerationService');
const { createNotification } = require('../services/notificationService');
const { reconcileOrganization } = require('../services/rosterReconciliationService');

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

function normalizeTemplateRotation(scheduleType, rotation) {
    if (scheduleType !== 'rotating') return undefined;
    const cycleDays = Number(rotation?.cycleDays || 0);
    const activeDays = [...new Set((rotation?.activeDays || []).map(Number))].sort((a, b) => a - b);
    if (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 365) {
        throw new Error('A rotating template needs a cycle between 1 and 365 days.');
    }
    if (!activeDays.length || activeDays.some(day => !Number.isInteger(day) || day < 0 || day >= cycleDays)) {
        throw new Error('Choose at least one active zero-based day inside the rotation cycle.');
    }
    return { cycleDays, activeDays };
}

function managedTeamIds(req) {
    return new Set([
        ...(req.user.teams || [])
            .filter(team => team.organizationId === req.organizationId && ['line_manager', 'team_lead'].includes(team.role))
            .map(team => String(team.id)),
        ...getDepartmentHeadScope(req).scopedTeams.map(team => String(team.id)),
    ]);
}

function canOverrideConflicts(req, policy, reason) {
    return isHRAdmin(req)
        && normalizeSchedulingSettings(policy.schedulingSettings).allowConflictOverride
        && String(reason || '').trim().length >= 10;
}

function canReviewLevel(req, request, level) {
    if (!level) return false;
    if (level.approverType === 'explicit') return String(level.approverId) === String(req.user.id);
    if (level.approverType === 'hr') return isHRAdmin(req);
    if (level.approverType === 'department_head') {
        return isHRAdmin(req) || (isDepartmentHead(req) && canManage(req, request.subjectUserId || request.targetUserId));
    }
    return isHRAdmin(req) || canManage(req, request.subjectUserId || request.targetUserId);
}

function assignmentErrorResponse(res, validation) {
    return res.status(409).json({
        error: validation.errors[0]?.message || 'The shift assignment conflicts with scheduling policy.',
        code: validation.errors[0]?.code || 'SHIFT_POLICY_CONFLICT',
        conflict: validation,
    });
}

async function validateRequestAssignment(request, policy) {
    const shift = request.shiftId;
    const offeredShift = request.offeredShiftId;
    if (request.type === 'release') return { valid: true, errors: [], warnings: [] };
    const excludeShiftIds = [shift._id, offeredShift?._id].filter(Boolean);
    const validations = [];
    if (request.type === 'cover') {
        validations.push(await validateShiftAssignment({
            organizationId: request.organizationId,
            userId: request.targetUserId,
            shift,
            attendancePolicy: policy,
            excludeShiftIds,
        }));
    } else if (request.type === 'swap') {
        validations.push(await validateShiftAssignment({
            organizationId: request.organizationId,
            userId: request.targetUserId,
            shift,
            attendancePolicy: policy,
            excludeShiftIds,
        }));
        validations.push(await validateShiftAssignment({
            organizationId: request.organizationId,
            userId: request.requestedBy,
            shift: offeredShift,
            attendancePolicy: policy,
            excludeShiftIds,
        }));
    }
    return {
        valid: validations.every(item => item.valid),
        errors: validations.flatMap(item => item.errors || []),
        warnings: validations.flatMap(item => item.warnings || []),
    };
}

async function applyApprovedRequest(request, actor) {
    const history = {
        action: `request_${request.type}_approved`,
        actorId: actor.id,
        actorName: actor.name,
        at: new Date(),
        details: String(request._id),
    };
    if (request.type === 'cover') {
        const shift = await Shift.findOneAndUpdate(
            {
                _id: request.shiftId._id,
                organizationId: request.organizationId,
                status: 'published',
                openShift: true,
                $or: [{ userId: null }, { userId: { $exists: false } }],
            },
            { $set: { userId: request.targetUserId, openShift: false, updatedBy: actor.id }, $push: { changeHistory: history } },
            { new: true }
        );
        if (!shift) throw Object.assign(new Error('The open shift was already claimed or changed.'), { code: 'SHIFT_ALREADY_CLAIMED' });
        request.shiftId = shift;
        return;
    }
    if (request.type === 'release') {
        const shift = await Shift.findOneAndUpdate(
            { _id: request.shiftId._id, organizationId: request.organizationId, status: 'published', userId: request.requestedBy },
            { $set: { userId: null, openShift: true, updatedBy: actor.id }, $push: { changeHistory: history } },
            { new: true }
        );
        if (!shift) throw Object.assign(new Error('The assigned shift was already changed.'), { code: 'SHIFT_ASSIGNMENT_CHANGED' });
        request.shiftId = shift;
        return;
    }

    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const first = await Shift.findOneAndUpdate(
                { _id: request.shiftId._id, organizationId: request.organizationId, status: 'published', userId: request.requestedBy },
                { $set: { userId: request.targetUserId, updatedBy: actor.id }, $push: { changeHistory: history } },
                { new: true, session }
            );
            const second = await Shift.findOneAndUpdate(
                { _id: request.offeredShiftId._id, organizationId: request.organizationId, status: 'published', userId: request.targetUserId },
                { $set: { userId: request.requestedBy, updatedBy: actor.id }, $push: { changeHistory: history } },
                { new: true, session }
            );
            if (!first || !second) throw Object.assign(new Error('One of the swap shifts was already changed.'), { code: 'SHIFT_ASSIGNMENT_CHANGED' });
            request.shiftId = first;
            request.offeredShiftId = second;
        });
    } finally {
        await session.endSession();
    }
}

function rosterMemberIsEligible(roster, at) {
    if (!roster || roster.status === 'inactive') return false;
    if (roster.appAccess?.mode === 'selected' && !(roster.appAccess.appIds || []).includes('time-attendance')) return false;
    return !roster.effectiveExitAt || new Date(at) < new Date(roster.effectiveExitAt);
}

function visibleRosterQuery(req) {
    const query = {
        organizationId: req.organizationId,
        status: { $in: ['active', 'scheduled_exit'] },
        $or: [
            { 'appAccess.mode': { $exists: false } },
            { 'appAccess.mode': 'all' },
            { 'appAccess.mode': 'selected', 'appAccess.appIds': 'time-attendance' },
        ],
    };
    if (!isHRAdmin(req)) query.userId = { $in: [...managedUserIds(req)] };
    return query;
}

async function rosterResponse(req, synchronization = {}) {
    const roster = await EmployeeRoster.find(visibleRosterQuery(req))
        .select('userId employeeId email name role teamIds teamAssignments managerId departmentId effectiveExitAt lastReconciledAt')
        .sort({ name: 1, email: 1 })
        .lean();

    const teamNames = new Map();
    for (const team of req.user.teams || []) {
        if (team.organizationId === req.organizationId && team.id) teamNames.set(String(team.id), team.name || 'Unnamed team');
    }
    for (const member of roster) {
        for (const team of member.teamAssignments || []) {
            if (team.teamId && team.name) teamNames.set(String(team.teamId), team.name);
        }
    }
    const teamIds = new Set(roster.flatMap(member => member.teamIds || []).map(String));
    const teams = [...teamIds].map(teamId => ({ teamId, name: teamNames.get(teamId) || 'Unnamed IDP team' }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const members = roster.map(member => ({
        userId: member.userId,
        employeeId: member.employeeId,
        name: member.name || member.email || 'Unnamed member',
        email: member.email,
        role: member.role,
        teamIds: member.teamIds || [],
        managerId: member.managerId,
        departmentId: member.departmentId,
        effectiveExitAt: member.effectiveExitAt,
    }));
    const lastReconciledAt = roster.reduce((latest, member) => {
        if (!member.lastReconciledAt) return latest;
        return !latest || new Date(member.lastReconciledAt) > new Date(latest) ? member.lastReconciledAt : latest;
    }, null);
    return {
        source: 'idp_sync',
        members,
        teams,
        synchronization: {
            state: members.length ? 'ready' : 'empty',
            lastReconciledAt,
            ...synchronization,
        },
    };
}

router.get('/roster', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    return res.json(await rosterResponse(req));
});

router.post('/roster/reconcile', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    try {
        const result = await reconcileOrganization(req.organizationId);
        return res.json(await rosterResponse(req, {
            state: 'reconciled',
            reconciledAt: new Date(),
            applied: result.applied,
            deactivatedMissing: result.deactivatedMissing,
        }));
    } catch (error) {
        console.error('Schedule roster reconciliation failed:', error);
        return res.status(502).json({
            error: 'The IDP organization roster could not be synchronized. Check the IDP service connection and try again.',
            code: 'IDP_ROSTER_SYNC_FAILED',
        });
    }
});

router.get('/templates', async (req, res) => {
    const templates = await ShiftTemplate.find({ organizationId: req.organizationId, isActive: { $ne: false } }).sort({ name: 1 });
    res.json({ templates });
});

router.get('/policy', async (req, res) => {
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    return res.json({
        schedulingSettings: normalizeSchedulingSettings(policy.schedulingSettings),
        restRules: policy.restRules,
        maximumWeeklyHours: policy.workSchedule?.maximumHoursPerWeek || 48,
        timezone: policy.timezone,
    });
});

router.post('/templates', async (req, res) => {
    if (!isHRAdmin(req)) return res.status(403).json({ error: 'HR administrator access required' });
    try {
        const rotation = normalizeTemplateRotation(req.body.scheduleType, req.body.rotation);
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
            rotation,
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
    try {
        const current = await ShiftTemplate.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!current) return res.status(404).json({ error: 'Shift template not found' });
        const allowed = {};
        for (const key of ['name', 'scheduleType', 'startTime', 'endTime', 'breakMinutes', 'workMode', 'locationId', 'activityCode', 'costCentreCode', 'isActive']) {
            if (req.body[key] !== undefined) allowed[key] = req.body[key];
        }
        const nextScheduleType = allowed.scheduleType || current.scheduleType;
        if (req.body.rotation !== undefined || req.body.scheduleType !== undefined) {
            allowed.rotation = normalizeTemplateRotation(nextScheduleType, req.body.rotation ?? current.rotation);
        }
        allowed.updatedBy = req.user.id;
        const template = await ShiftTemplate.findOneAndUpdate(
            { _id: req.params.id, organizationId: req.organizationId },
            { $set: allowed },
            { new: true, runValidators: true }
        );
        return res.json({ template });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to update shift template' });
    }
});

router.get('/shifts', async (req, res) => {
    const query = { organizationId: req.organizationId };
    const requestedUserId = req.query.userId;
    if (requestedUserId && requestedUserId !== req.user.id) {
        if (!canManage(req, requestedUserId)) return res.status(403).json({ error: 'Access denied' });
        query.userId = requestedUserId;
    } else if (requestedUserId) {
        query.userId = requestedUserId;
    } else if (req.query.open !== 'true' && !isHRAdmin(req)) {
        query.userId = (isLineManager(req) || isDepartmentHead(req))
            ? { $in: [...managedUserIds(req)] }
            : req.user.id;
    }
    if (req.query.start) query.endAt = { $gte: new Date(req.query.start) };
    if (req.query.end) query.startAt = { $lte: new Date(req.query.end) };
    if (req.query.status) query.status = req.query.status;
    if (req.query.open === 'true') query.openShift = true;
    const shiftDocuments = await Shift.find(query).sort({ startAt: 1 }).limit(1000).populate('templateId');
    const shifts = shiftDocuments.map(shift => shift.toObject());
    const userIds = [...new Set(shifts.map(shift => shift.userId).filter(Boolean).map(String))];
    const teamIds = [...new Set(shifts.map(shift => shift.teamId).filter(Boolean).map(String))];
    const roster = (userIds.length || teamIds.length)
        ? await EmployeeRoster.find({
            organizationId: req.organizationId,
            $or: [
                ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
                ...(teamIds.length ? [{ teamIds: { $in: teamIds } }] : []),
            ],
        }).select('userId employeeId email name teamAssignments').lean()
        : [];
    const membersById = new Map(roster.map(member => [String(member.userId), member]));
    const teamNames = new Map();
    for (const member of roster) {
        for (const team of member.teamAssignments || []) {
            if (team.teamId && team.name) teamNames.set(String(team.teamId), team.name);
        }
    }
    return res.json({
        shifts: shifts.map(shift => {
            const member = shift.userId ? membersById.get(String(shift.userId)) : null;
            return {
                ...shift,
                assignee: member ? { userId: member.userId, name: member.name || member.email || 'Unnamed member', email: member.email, employeeId: member.employeeId } : null,
                team: shift.teamId ? { teamId: shift.teamId, name: teamNames.get(String(shift.teamId)) || null } : null,
            };
        }),
    });
});

router.post('/shifts', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    if (req.body.userId && req.body.openShift === true) {
        return res.status(400).json({ error: 'An open shift cannot already have an assignee.', code: 'OPEN_SHIFT_CANNOT_BE_ASSIGNED' });
    }
    if (req.body.userId && !canManage(req, req.body.userId)) return res.status(403).json({ error: 'The employee is outside your management scope' });
    const shiftStart = new Date(req.body.startAt);
    if (Number.isNaN(shiftStart.getTime())) return res.status(400).json({ error: 'A valid shift start is required' });
    if (req.body.userId) {
        const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: req.body.userId }).lean();
        if (!roster) {
            return res.status(409).json({
                error: 'This person is not in the active IDP organization roster',
                code: 'ROSTER_MEMBER_NOT_FOUND',
            });
        }
        if (!rosterMemberIsEligible(roster, shiftStart)) {
            return res.status(409).json({
                error: 'This employee is not attendance-eligible at the shift start time',
                code: 'EMPLOYEE_NOT_ELIGIBLE',
                effectiveExitAt: roster.effectiveExitAt,
            });
        }
        if (req.body.teamId && !(roster.teamIds || []).map(String).includes(String(req.body.teamId))) {
            return res.status(409).json({ error: 'The selected employee is not an active member of that IDP team', code: 'TEAM_MEMBERSHIP_MISMATCH' });
        }
    } else if (!req.body.openShift) {
        return res.status(400).json({ error: 'Select an IDP organization member or create an open shift', code: 'SHIFT_ASSIGNEE_REQUIRED' });
    } else if (req.body.teamId) {
        if (!isHRAdmin(req)) {
            const allowedTeams = new Set([
                ...(req.user.teams || []).filter(team => team.organizationId === req.organizationId && ['line_manager', 'team_lead'].includes(team.role)).map(team => String(team.id)),
                ...getDepartmentHeadScope(req).scopedTeams.map(team => String(team.id)),
            ]);
            if (!allowedTeams.has(String(req.body.teamId))) return res.status(403).json({ error: 'The selected team is outside your management scope' });
        }
        const teamExists = await EmployeeRoster.exists({ organizationId: req.organizationId, status: { $in: ['active', 'scheduled_exit'] }, teamIds: String(req.body.teamId) });
        if (!teamExists) return res.status(409).json({ error: 'This team is not in the active IDP organization roster', code: 'ROSTER_TEAM_NOT_FOUND' });
    }
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    const conflict = await validateShiftAssignment({
        organizationId: req.organizationId,
        userId: req.body.userId,
        shift: {
            ...req.body,
            timezone: req.body.timezone || policy.timezone || 'UTC',
            breakMinutes: req.body.breakMinutes || 0,
        },
        attendancePolicy: policy,
    });
    if (!conflict.valid && !(req.body.overrideConflicts === true && canOverrideConflicts(req, policy, req.body.reason))) {
        return assignmentErrorResponse(res, conflict);
    }
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
    const nextOpenShift = req.body.openShift ?? shift.openShift;
    if (next.userId && nextOpenShift) {
        return res.status(400).json({ error: 'An open shift cannot already have an assignee.', code: 'OPEN_SHIFT_CANNOT_BE_ASSIGNED' });
    }
    if (next.userId && !canManage(req, next.userId)) return res.status(403).json({ error: 'The employee is outside your management scope' });
    if (!next.userId && nextOpenShift && (req.body.teamId ?? shift.teamId) && !isHRAdmin(req) && !managedTeamIds(req).has(String(req.body.teamId ?? shift.teamId))) {
        return res.status(403).json({ error: 'The selected team is outside your management scope' });
    }
    if (next.userId) {
        const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: next.userId }).lean();
        if (!roster) return res.status(409).json({ error: 'This person is not in the active IDP organization roster', code: 'ROSTER_MEMBER_NOT_FOUND' });
        if (!rosterMemberIsEligible(roster, next.startAt)) {
            return res.status(409).json({ error: 'This employee is not attendance-eligible at the shift start time', code: 'EMPLOYEE_NOT_ELIGIBLE' });
        }
        const nextTeamId = req.body.teamId ?? shift.teamId;
        if (nextTeamId && !(roster.teamIds || []).map(String).includes(String(nextTeamId))) {
            return res.status(409).json({ error: 'The selected employee is not an active member of that IDP team', code: 'TEAM_MEMBERSHIP_MISMATCH' });
        }
    }
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    const conflict = await validateShiftAssignment({
        organizationId: req.organizationId,
        userId: next.userId,
        shift: {
            ...shift.toObject(),
            ...next,
            teamId: req.body.teamId ?? shift.teamId,
            timezone: req.body.timezone || shift.timezone || policy.timezone || 'UTC',
            breakMinutes: req.body.breakMinutes ?? shift.breakMinutes,
        },
        attendancePolicy: policy,
        excludeShiftIds: [shift._id],
    });
    if (!conflict.valid && !(req.body.overrideConflicts === true && canOverrideConflicts(req, policy, req.body.reason))) {
        return assignmentErrorResponse(res, conflict);
    }
    if (req.body.status !== undefined && req.body.status !== 'cancelled') {
        return res.status(400).json({ error: 'Publish shifts through the schedule publish action; only cancellation is allowed here.', code: 'INVALID_SHIFT_STATUS_TRANSITION' });
    }
    if (shift.status === 'cancelled') return res.status(409).json({ error: 'A cancelled shift cannot be edited.' });
    const scheduleFields = ['userId', 'teamId', 'templateId', 'startAt', 'endAt', 'timezone', 'breakMinutes', 'workMode', 'locationId', 'activityCode', 'costCentreCode', 'openShift'];
    const scheduleChanged = scheduleFields.some(key => req.body[key] !== undefined);
    for (const key of [...scheduleFields, 'status']) {
        if (req.body[key] !== undefined) shift[key] = req.body[key];
    }
    if (shift.status === 'published' && scheduleChanged && req.body.status !== 'cancelled') {
        shift.status = 'draft';
        shift.publicationVersion = undefined;
        shift.acknowledgement = { status: 'pending' };
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
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
        return res.status(400).json({ error: 'A valid publication period is required.' });
    }
    const latest = await SchedulePublication.findOne({ organizationId: req.organizationId, periodStart, periodEnd }).sort({ version: -1 });
    const shiftQuery = { organizationId: req.organizationId, startAt: { $lt: periodEnd }, endAt: { $gt: periodStart }, status: 'draft' };
    if (!isHRAdmin(req)) {
        shiftQuery.$or = [
            { userId: { $in: [...managedUserIds(req)] } },
            { userId: null, teamId: { $in: [...managedTeamIds(req)] } },
        ];
    }
    const shifts = await Shift.find(shiftQuery);
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    for (const shift of shifts) {
        const validation = await validateShiftAssignment({
            organizationId: req.organizationId,
            userId: shift.userId,
            shift,
            attendancePolicy: policy,
            excludeShiftIds: [shift._id],
        });
        if (!validation.valid && !(req.body.overrideConflicts === true && canOverrideConflicts(req, policy, req.body.note))) {
            return res.status(409).json({
                error: `Shift starting ${new Date(shift.startAt).toLocaleString()} no longer meets scheduling policy.`,
                code: 'PUBLICATION_SHIFT_POLICY_CONFLICT',
                shiftId: shift._id,
                conflict: validation,
            });
        }
    }
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
    const type = String(req.body.type || '');
    if (!['cover', 'release', 'swap'].includes(type)) return res.status(400).json({ error: 'Choose cover, release, or swap.' });
    const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
    const settings = normalizeSchedulingSettings(policy.schedulingSettings);
    if (type === 'release' && !settings.allowEmployeeRelease) return res.status(403).json({ error: 'Shift release requests are disabled by policy.' });
    if (type === 'swap' && !settings.allowShiftSwap) return res.status(403).json({ error: 'Shift swaps are disabled by policy.' });
    const isOpenCover = type === 'cover';
    const shift = await Shift.findOne({
        _id: req.body.shiftId,
        organizationId: req.organizationId,
        status: 'published',
        ...(isOpenCover ? { openShift: true } : { userId: req.user.id }),
    });
    if (!shift) return res.status(404).json({ error: 'An eligible published shift was not found.' });

    let offeredShift = null;
    if (type === 'swap') {
        if (!req.body.targetUserId || String(req.body.targetUserId) === String(req.user.id) || !req.body.offeredShiftId) {
            return res.status(400).json({ error: 'A swap requires another employee and one of their published shifts.' });
        }
        offeredShift = await Shift.findOne({
            _id: req.body.offeredShiftId,
            organizationId: req.organizationId,
            userId: req.body.targetUserId,
            status: 'published',
            openShift: { $ne: true },
        });
        if (!offeredShift) return res.status(409).json({ error: 'The offered shift is no longer assigned to that employee.', code: 'OFFERED_SHIFT_CHANGED' });
    }

    const targetUserId = isOpenCover ? req.user.id : req.body.targetUserId;
    const subjectUserId = isOpenCover ? req.user.id : req.user.id;
    const duplicate = await ShiftRequest.exists({
        organizationId: req.organizationId,
        type,
        shiftId: shift._id,
        requestedBy: req.user.id,
        status: { $in: ['pending_target', 'pending'] },
    });
    if (duplicate) return res.status(409).json({ error: 'You already have an active request for this shift.', code: 'DUPLICATE_SHIFT_REQUEST' });

    const configuredRequestPolicy = requestPolicy(policy, type);
    const requesterRoster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: subjectUserId }).lean();
    const approval = configuredRequestPolicy.approvalRequired
        ? buildApprovalWorkflow(configuredRequestPolicy, { managerId: requesterRoster?.managerId, teamId: shift.teamId })
        : { workflow: { mode: configuredRequestPolicy.approvalMode, currentLevel: 0, levels: [] }, assignedApprover: undefined };
    const targetResponse = type === 'swap'
        ? { status: 'pending' }
        : { status: 'not_required' };
    const initialStatus = type === 'swap' ? 'pending_target' : 'pending';
    const validationRequest = {
        organizationId: req.organizationId,
        type,
        shiftId: shift,
        offeredShiftId: offeredShift,
        requestedBy: req.user.id,
        targetUserId,
    };
    const validation = await validateRequestAssignment(validationRequest, policy);
    if (!validation.valid) return assignmentErrorResponse(res, validation);

    const request = await ShiftRequest.create({
        organizationId: req.organizationId,
        type,
        shiftId: shift._id,
        requestedBy: req.user.id,
        subjectUserId,
        targetUserId,
        offeredShiftId: offeredShift?._id,
        reason: req.body.reason,
        status: initialStatus,
        targetResponse,
        assignedApprover: approval.assignedApprover,
        approvalWorkflow: approval.workflow,
        requestPolicySnapshot: configuredRequestPolicy,
        changeHistory: [{ action: 'created', actorId: req.user.id, actorName: req.user.name, details: type }],
    });
    await request.populate('shiftId offeredShiftId');
    if (type !== 'swap' && !configuredRequestPolicy.approvalRequired) {
        await applyApprovedRequest(request, req.user);
        request.status = 'approved';
        request.reviewedBy = 'system:scheduling-policy';
        request.reviewedAt = new Date();
        request.reviewNote = 'Approval was not required by the active scheduling policy.';
        request.changeHistory.push({ action: 'auto_approved', actorId: 'system:scheduling-policy', actorName: 'Scheduling policy', details: type });
        await request.save();
    }
    return res.status(201).json({ request });
});

router.post('/templates/:id/generate', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    const template = await ShiftTemplate.findOne({ _id: req.params.id, organizationId: req.organizationId, isActive: { $ne: false } }).lean();
    if (!template) return res.status(404).json({ error: 'Active shift template not found.' });
    const userId = req.body.openShift ? null : req.body.userId;
    if (!userId && !req.body.openShift) return res.status(400).json({ error: 'Choose an employee or generate open shifts.' });
    if (userId && !canManage(req, userId)) return res.status(403).json({ error: 'The employee is outside your management scope.' });
    if (req.body.openShift && req.body.teamId && !isHRAdmin(req) && !managedTeamIds(req).has(String(req.body.teamId))) {
        return res.status(403).json({ error: 'The selected team is outside your management scope.' });
    }
    try {
        const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
        const generated = enumerateTemplateShifts({
            template,
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            timezone: req.body.timezone || policy.timezone || 'UTC',
            activeDays: req.body.activeDays,
        }).map(item => {
            const shift = {
                ...item,
                organizationId: req.organizationId,
                userId,
                teamId: req.body.teamId,
                templateId: template._id,
                openShift: Boolean(req.body.openShift),
            };
            return { ...shift, generationKey: buildShiftGenerationKey(shift) };
        });
        if (!generated.length) return res.status(400).json({ error: 'The selected range contains no active template days.' });

        const existingGenerated = await Shift.find({
            organizationId: req.organizationId,
            generationKey: { $in: generated.map(shift => shift.generationKey) },
        }).select('generationKey').lean();
        const existingKeys = new Set(existingGenerated.map(shift => shift.generationKey));
        const pendingGeneration = generated.filter(shift => !existingKeys.has(shift.generationKey));

        const validations = [];
        for (const shift of pendingGeneration) {
            const validation = await validateShiftAssignment({
                organizationId: req.organizationId,
                userId,
                shift,
                attendancePolicy: policy,
            });
            if (!validation.valid) return assignmentErrorResponse(res, validation);
            validations.push(validation);
        }
        const batchWeeks = new Map();
        for (const validation of validations) {
            const weekly = validation.weeklySchedule;
            if (!weekly) continue;
            const key = new Date(weekly.weekStart).toISOString();
            const current = batchWeeks.get(key) || { existingHours: weekly.existingHours, generatedHours: 0, maximumHours: weekly.maximumHours };
            current.generatedHours += weekly.currentShiftHours;
            batchWeeks.set(key, current);
        }
        for (const weekly of batchWeeks.values()) {
            if (weekly.existingHours + weekly.generatedHours > weekly.maximumHours + 0.001) {
                return res.status(409).json({
                    error: `This template batch would schedule ${(weekly.existingHours + weekly.generatedHours).toFixed(2)} hours against the ${weekly.maximumHours}-hour weekly policy.`,
                    code: 'MAXIMUM_WEEKLY_HOURS_EXCEEDED',
                });
            }
        }
        for (let index = 1; index < pendingGeneration.length; index += 1) {
            const restMinutes = (new Date(pendingGeneration[index].startAt) - new Date(pendingGeneration[index - 1].endAt)) / 60000;
            const requiredRest = Math.max(validations[index - 1].minimumRestMinutes || 0, validations[index].minimumRestMinutes || 0);
            if (restMinutes < requiredRest) {
                return res.status(409).json({
                    error: `The generated rotation leaves ${Math.max(0, Math.round(restMinutes))} minutes between shifts; policy requires ${requiredRest} minutes.`,
                    code: 'INSUFFICIENT_REST',
                });
            }
        }

        const operations = pendingGeneration.map(shift => {
            return {
                updateOne: {
                    filter: { generationKey: shift.generationKey },
                    update: { $setOnInsert: {
                        ...shift,
                        createdBy: req.user.id,
                        updatedBy: req.user.id,
                        changeHistory: [{ action: 'generated', actorId: req.user.id, actorName: req.user.name, details: template.name }],
                    } },
                    upsert: true,
                },
            };
        });
        const result = operations.length
            ? await Shift.bulkWrite(operations, { ordered: true })
            : { upsertedCount: 0 };
        return res.status(201).json({
            generatedCount: result.upsertedCount || 0,
            existingCount: generated.length - (result.upsertedCount || 0),
            requestedCount: generated.length,
        });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'The template could not be generated.' });
    }
});

router.get('/shifts/:id/swap-options', async (req, res) => {
    const source = await Shift.findOne({
        _id: req.params.id,
        organizationId: req.organizationId,
        userId: req.user.id,
        status: 'published',
    }).lean();
    if (!source) return res.status(404).json({ error: 'Published shift not found.' });
    const roster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: req.user.id }).select('teamIds').lean();
    const teamIds = source.teamId ? [String(source.teamId)] : (roster?.teamIds || []).map(String);
    const candidateShifts = await Shift.find({
        organizationId: req.organizationId,
        status: 'published',
        openShift: { $ne: true },
        userId: { $nin: [null, req.user.id] },
        ...(teamIds.length ? { teamId: { $in: teamIds } } : { _id: null }),
        startAt: { $gte: new Date() },
    }).sort({ startAt: 1 }).limit(100).lean();
    const userIds = [...new Set(candidateShifts.map(item => String(item.userId)))];
    const members = await EmployeeRoster.find({ organizationId: req.organizationId, userId: { $in: userIds } }).select('userId name email employeeId').lean();
    const byId = new Map(members.map(member => [String(member.userId), member]));
    return res.json({
        options: candidateShifts.map(shift => ({
            shiftId: shift._id,
            targetUserId: shift.userId,
            startAt: shift.startAt,
            endAt: shift.endAt,
            workMode: shift.workMode,
            teamId: shift.teamId,
            assignee: {
                name: byId.get(String(shift.userId))?.name || byId.get(String(shift.userId))?.email || 'Team member',
                employeeId: byId.get(String(shift.userId))?.employeeId,
            },
        })),
    });
});

router.get('/requests', async (req, res) => {
    const query = { organizationId: req.organizationId };
    if (!isHRAdmin(req) && !isLineManager(req) && !isDepartmentHead(req)) {
        query.$or = [{ requestedBy: req.user.id }, { targetUserId: req.user.id }];
    } else if (!isHRAdmin(req)) {
        const managed = [...managedUserIds(req)];
        query.$or = [
            { subjectUserId: { $in: managed } },
            { targetUserId: { $in: managed } },
            { requestedBy: req.user.id },
            { targetUserId: req.user.id },
        ];
    }
    const requests = await ShiftRequest.find(query).sort({ createdAt: -1 }).populate('shiftId offeredShiftId');
    return res.json({ requests });
});

router.post('/requests/:id/respond', async (req, res) => {
    const request = await ShiftRequest.findOne({
        _id: req.params.id,
        organizationId: req.organizationId,
        type: 'swap',
        targetUserId: req.user.id,
        status: 'pending_target',
    }).populate('shiftId offeredShiftId');
    if (!request) return res.status(404).json({ error: 'Pending swap response not found.' });
    const accepted = req.body.accepted === true;
    request.targetResponse = { status: accepted ? 'accepted' : 'rejected', respondedAt: new Date(), note: req.body.note };
    request.changeHistory.push({ action: accepted ? 'target_accepted' : 'target_rejected', actorId: req.user.id, actorName: req.user.name, details: req.body.note });
    if (!accepted) {
        request.status = 'rejected';
    } else if (request.requestPolicySnapshot?.approvalRequired !== false) {
        request.status = 'pending';
    } else {
        const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
        const validation = await validateRequestAssignment(request, policy);
        if (!validation.valid) return assignmentErrorResponse(res, validation);
        await applyApprovedRequest(request, req.user);
        request.status = 'approved';
        request.reviewedBy = 'system:scheduling-policy';
        request.reviewedAt = new Date();
        request.reviewNote = 'The other employee accepted and manager approval was disabled by policy.';
    }
    await request.save();
    return res.json({ request });
});

router.post('/requests/:id/review', async (req, res) => {
    if (!requireScheduler(req, res)) return;
    const request = await ShiftRequest.findOne({ _id: req.params.id, organizationId: req.organizationId, status: 'pending' }).populate('shiftId offeredShiftId');
    if (!request) return res.status(404).json({ error: 'Pending request not found' });
    if (request.type === 'swap' && request.targetResponse?.status !== 'accepted') {
        return res.status(409).json({ error: 'The other employee must accept the swap before manager review.', code: 'SWAP_TARGET_ACCEPTANCE_REQUIRED' });
    }
    const levels = request.approvalWorkflow?.levels || [];
    const currentIndex = Number(request.approvalWorkflow?.currentLevel || 0);
    const level = levels[currentIndex];
    if (!canReviewLevel(req, request, level)) return res.status(403).json({ error: 'You are not the assigned approver for this stage.' });
    if (String(request.requestedBy) === String(req.user.id)) {
        return res.status(409).json({ error: 'You cannot approve your own shift request.', code: 'SEPARATION_OF_DUTIES_REQUIRED' });
    }
    const approved = req.body.approved === true;
    level.status = approved ? 'approved' : 'rejected';
    level.decidedBy = req.user.id;
    level.decidedByName = req.user.name;
    level.decidedAt = new Date();
    level.comment = req.body.note;
    request.changeHistory.push({ action: approved ? 'stage_approved' : 'rejected', actorId: req.user.id, actorName: req.user.name, details: level.name });
    if (!approved) {
        request.status = 'rejected';
    } else if (currentIndex < levels.length - 1) {
        const nextIndex = currentIndex + 1;
        const next = levels[nextIndex];
        request.approvalWorkflow.currentLevel = nextIndex;
        request.assignedApprover = {
            userId: next.approverId,
            userName: next.approverName || next.name,
            userEmail: next.approverEmail,
            teamId: request.shiftId?.teamId,
            assignedAt: new Date(),
        };
    } else {
        const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organizationName, req.user.id);
        const validation = await validateRequestAssignment(request, policy);
        if (!validation.valid) return assignmentErrorResponse(res, validation);
        await applyApprovedRequest(request, req.user);
        request.status = 'approved';
        request.approvalWorkflow.completedAt = new Date();
        request.reviewedBy = req.user.id;
        request.reviewedAt = new Date();
        request.reviewNote = req.body.note;
    }
    await request.save();
    return res.json({ request });
});

router.post('/requests/:id/cancel', async (req, res) => {
    const request = await ShiftRequest.findOne({
        _id: req.params.id,
        organizationId: req.organizationId,
        requestedBy: req.user.id,
        status: { $in: ['pending_target', 'pending'] },
    });
    if (!request) return res.status(404).json({ error: 'Active request not found.' });
    request.status = 'cancelled';
    request.changeHistory.push({ action: 'cancelled', actorId: req.user.id, actorName: req.user.name, details: req.body.note });
    await request.save();
    return res.json({ request });
});

module.exports = router;
module.exports.rosterMemberIsEligible = rosterMemberIsEligible;
module.exports.rosterResponse = rosterResponse;
